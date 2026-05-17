"""
매매 전략 계산 모듈
입력: features_row (features 테이블 row dict, close 포함)
출력: action / entry / exit_targets / position / holding / warnings / risk_level
"""

import math
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).parent.parent / "data" / "stocks.db"


def _safe(val, default=None):
    if val is None:
        return default
    try:
        if math.isnan(float(val)):
            return default
    except (TypeError, ValueError):
        return default
    return val


def _pct(ratio: Optional[float]) -> str:
    if ratio is None:
        return "—"
    sign = "+" if ratio >= 0 else ""
    return f"{sign}{ratio * 100:.1f}%"


def _fetch_close(symbol: str, date: str) -> Optional[float]:
    try:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                "SELECT close FROM prices WHERE symbol=? AND date<=? ORDER BY date DESC LIMIT 1",
                (symbol, date),
            ).fetchone()
        return float(row[0]) if row else None
    except Exception:
        return None


def _position_sizing(atr_pct: float) -> Dict[str, Any]:
    # 한국 시장 ATR 분포 기준 (p50≈5%, p75≈8%, p90≈11%)
    if atr_pct <= 0.05:
        return {"weight_pct": 5, "weight_label": "낮음"}
    if atr_pct <= 0.10:
        return {"weight_pct": 3, "weight_label": "중간"}
    if atr_pct <= 0.15:
        return {"weight_pct": 2, "weight_label": "높음"}
    return {"weight_pct": 1, "weight_label": "최소"}


def _risk_level(warnings: List[str], atr_pct: float) -> str:
    # 실제 데이터 분포 기준: p50≈5%, p75≈8%, p90≈11%
    # atr_pct > 15%는 상위 12% (진짜 고변동성), > 7%는 상위 50%
    n = len(warnings)
    if n >= 2 or atr_pct > 0.15:
        return "높음"
    if n == 1 or atr_pct > 0.07:
        return "중간"
    return "낮음"


def _build_action(
    risk: str,
    warnings: List[str],
    ret_5d: Optional[float],
    rsi_14: Optional[float],
) -> Dict[str, str]:
    n = len(warnings)

    # 관망: 변동성 높음 + 복수 경고 (추격 매수 위험)
    if risk == "높음" and n >= 2:
        parts: List[str] = []
        if ret_5d is not None and ret_5d > 0.30:
            parts.append(f"+{ret_5d * 100:.0f}% 급등")
        if rsi_14 is not None and rsi_14 > 80:
            parts.append(f"RSI {rsi_14:.0f} 과매수")
        intro = ", ".join(parts) if parts else "복수 위험 신호"
        reason = (
            f"{intro} — 모델은 이 종목을 상위로 봤지만 "
            f"단기 과열로 추격 매수 시 고점 매수 위험이 큼. "
            f"눌림목·조정 구간 재진입 검토 권장."
        )
        return {"action_label": "관망 권장", "action_reason": reason}

    # 신중: 변동성 높음(경고<2), 중간 변동성, 또는 경고 1개
    if risk in ("높음", "중간") or n >= 1:
        if n >= 1:
            trigger = warnings[0].split("—")[0].strip()
            vol_note = " 고변동성 종목이므로" if risk == "높음" else ""
            reason = (
                f"{trigger} —{vol_note} 리스크 요인이 존재하므로 "
                f"분할 매수(2~3회)로 진입하고 손절선을 반드시 지키세요."
            )
        elif risk == "높음":
            reason = (
                "고변동성(ATR 15% 초과) 종목 — 급등락 위험이 크므로 "
                "소량 분할 매수 및 엄격한 손절 적용이 필수입니다."
            )
        else:
            reason = (
                "변동성 보통 구간 — 분할 매수 및 손절선 설정 후 진입하세요."
            )
        return {"action_label": "신중 진입", "action_reason": reason}

    # 적극: 낮은 변동성 + 경고 없음
    return {
        "action_label": "적극 고려",
        "action_reason": (
            "변동성 낮고 기술적 과열 신호 없음 — 제시된 진입가·목표가 전략대로 정상 진입 가능."
        ),
    }


def calculate_strategy(
    symbol: str,
    date: str,
    features_row: Dict[str, Any],
) -> Dict[str, Any]:
    close = _safe(features_row.get("close"))
    if close is None:
        close = _fetch_close(symbol, date)
    if not close or close <= 0:
        return {}

    atr     = _safe(features_row.get("atr_14"), 0.0)
    atr_pct = _safe(features_row.get("atr_pct"))
    if atr_pct is None:
        atr_pct = atr / close if close else 0.0

    rsi_14  = _safe(features_row.get("rsi_14"))
    ret_5d  = _safe(features_row.get("ret_5d"))
    gap_pct = _safe(features_row.get("gap_pct"))

    vol_log = _safe(features_row.get("vol_krw_20d"))
    vol_raw = math.expm1(vol_log) if vol_log is not None else None

    # ── 경고 먼저 계산 (action 판단에 필요) ───────────────────
    warnings: List[str] = []
    if ret_5d is not None and ret_5d > 0.30:
        warnings.append(f"이미 5일간 +{ret_5d * 100:.1f}% 상승 — 단기 조정 가능성")
    if rsi_14 is not None and rsi_14 > 80:
        warnings.append(f"RSI {rsi_14:.0f} 과매수 — 진입 타이밍 늦었을 수 있음")
    if vol_raw is not None and vol_raw < 5_000_000_000:
        bil = vol_raw / 1_000_000_000
        warnings.append(f"20일 평균 거래대금 {bil:.0f}억 미만 — 슬리피지 주의")

    risk   = _risk_level(warnings, atr_pct)
    action = _build_action(risk, warnings, ret_5d, rsi_14)

    # ── 진입 가격대 ────────────────────────────────────────────
    entry_warning: Optional[str] = None
    if gap_pct is not None and gap_pct > 0.05:
        entry_warning = f"갭상승 {gap_pct * 100:.1f}% 초과 — 추격 매수 위험"

    entry: Dict[str, Any] = {
        "buy_price_low":  round(close * 0.98),
        "buy_price_high": round(close * 1.01),
        "buy_low_pct":    _pct(-0.02),
        "buy_high_pct":   _pct(0.01),
        "warning":        entry_warning,
    }
    if action["action_label"] == "관망 권장":
        entry["caution"] = "추격 매수 비권장 — 아래 수치는 참고용"

    # ── 목표가 · 손절가 ────────────────────────────────────────
    if atr and atr > 0:
        t1_price = close + atr * 1.5
        t2_price = close + atr * 3.0
        sl_price = close - atr * 1.5
    else:
        t1_price = close * 1.05
        t2_price = close * 1.10
        sl_price = close * 0.96

    t1_ratio = (t1_price - close) / close
    t2_ratio = (t2_price - close) / close
    sl_ratio = (sl_price - close) / close

    exit_targets = {
        "target1_price":    round(t1_price),
        "target1_pct":      _pct(t1_ratio),
        "target1_action":   "보유 물량 50% 매도 후 손절선 추격",
        "target2_price":    round(t2_price),
        "target2_pct":      _pct(t2_ratio),
        "target2_action":   "나머지 전량 매도",
        "stop_loss_price":  round(sl_price),
        "stop_loss_pct":    _pct(sl_ratio),
        "stop_loss_action": "즉시 전량 손절",
    }

    return {
        **action,                          # action_label, action_reason (최상위)
        "entry":        entry,
        "exit_targets": exit_targets,
        "position":     _position_sizing(atr_pct),
        "holding": {
            "max_days": 5,
            "strategy": "5거래일 내 목표가 1 도달 시 50% 익절 후 손절선 추격, 5일 경과 시 전량 청산",
        },
        "warnings":   warnings,
        "risk_level": risk,
    }

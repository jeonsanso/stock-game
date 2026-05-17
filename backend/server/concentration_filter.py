"""
종목 집중도 관련 실시간 필터

filter_cooldown  — 최근 N일 추천 종목 재진입 차단 (실시간 적용)
filter_overheat  — 모멘텀 과열 종목 제외 (백테스트 검증 결과 역효과, 미사용)
RecommendationLog — 일별 추천 종목 로그 (backend/data/recommendation_log.json)
"""
import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BACKEND_DIR / "data" / "stocks.db"

logger = logging.getLogger(__name__)

_LOG_PATH = BACKEND_DIR / "data" / "recommendation_log.json"
_MAX_LOG_DAYS = 30


# ── 추천 로그 ─────────────────────────────────────────────────

class RecommendationLog:
    """
    일별 추천 종목을 backend/data/recommendation_log.json에 보관.

    구조: {"20250507": ["005930", "000660", ...], ...}
    - 30일 초과 항목 자동 삭제
    - 파일 쓰기는 temp → os.replace() 방식으로 atomic 보장 (Windows 포함)
    """

    def __init__(self, path: Path = _LOG_PATH) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # ── 내부 IO ──────────────────────────────────────────────

    def _read(self) -> Dict[str, List[str]]:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("추천 로그 읽기 실패: %s", e)
            return {}

    def _write(self, data: Dict[str, List[str]]) -> None:
        """temp 파일에 쓴 뒤 원자적으로 교체 (race condition / 파일 손상 방지)."""
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)  # Windows에서도 atomic
        except Exception as e:
            logger.error("추천 로그 쓰기 실패: %s", e)
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    @staticmethod
    def _cutoff_date() -> str:
        return (datetime.now() - timedelta(days=_MAX_LOG_DAYS)).strftime("%Y%m%d")

    # ── 공개 API ──────────────────────────────────────────────

    def append(self, date: str, symbols: List[str]) -> None:
        """date 날짜의 추천 종목을 저장. 30일 초과 항목 자동 정리."""
        data = self._read()
        data[date] = list(symbols)
        cutoff = self._cutoff_date()
        data = {k: v for k, v in data.items() if k >= cutoff}
        self._write(data)
        logger.debug("추천 로그 저장: %s (%d종목)", date, len(symbols))

    def recent_symbols(self, cooldown_days: int, exclude_date: Optional[str] = None) -> Set[str]:
        """
        가장 최근 cooldown_days개 로그 항목에 등장한 종목 심볼 집합 반환.
        exclude_date: 해당 날짜 항목은 제외 (오늘 날짜 자기 참조 방지).
        """
        data = self._read()
        if not data:
            return set()
        sorted_dates = sorted(d for d in data if d != exclude_date)
        recent = sorted_dates[-cooldown_days:]
        result: Set[str] = set()
        for d in recent:
            result.update(data[d])
        return result

    def all_entries(self) -> Dict[str, List[str]]:
        """로그 전체 반환 (디버깅·모니터링용)."""
        return self._read()


# ── 쿨다운 필터 (실시간 적용) ─────────────────────────────────

def filter_cooldown(
    predictions: List[Dict[str, Any]],
    log: RecommendationLog,
    cooldown_days: int = 5,
    today: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    최근 cooldown_days개 추천 일자에 등장한 종목 제외.

    Args:
        predictions:   공시 필터 통과 후 전체 예측 리스트
        log:           RecommendationLog 인스턴스
        cooldown_days: 재진입 차단 일수 (로그 항목 수 기준)
        today:         오늘 날짜 (로그 자기 참조 방지용, YYYYMMDD)

    Returns:
        (filtered, excluded_cooldown)
        excluded_cooldown: [{"symbol": "...", "reason": "쿨다운 (최근 5일 추천)"}, ...]
    """
    if cooldown_days <= 0 or not predictions:
        return predictions, []

    cooldown_syms = log.recent_symbols(cooldown_days, exclude_date=today)
    if not cooldown_syms:
        return predictions, []

    filtered:  List[Dict[str, Any]] = []
    excluded:  List[Dict[str, Any]] = []
    reason_str = f"쿨다운 (최근 {cooldown_days}일 추천)"

    for p in predictions:
        sym = p.get("symbol", "")
        if sym in cooldown_syms:
            excluded.append({"symbol": sym, "reason": reason_str, "rank": p.get("rank")})
        else:
            filtered.append(p)

    if excluded:
        logger.info("쿨다운 제외 %d건: %s", len(excluded), [e["symbol"] for e in excluded])

    return filtered, excluded


# ── 과열 필터 (백테스트 전용, 실시간 미사용) ──────────────────
# 검증 결과: cooldown만 유효, overheat는 역효과 확인
# 백테스트 실험을 위해 코드 보존

def filter_overheat(
    predictions: List[Dict[str, Any]],
    date: str,
    rsi_threshold: float = 80.0,
    ret_5d_threshold: float = 0.30,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    [미사용 — 역효과 확인으로 실시간 비활성화]
    예측 결과에서 모멘텀 과열 종목 제외.
    과열 기준: rsi_14 >= rsi_threshold OR ret_5d >= ret_5d_threshold
    """
    if not predictions:
        return predictions, []

    symbols = [p["symbol"] for p in predictions if p.get("symbol")]
    if not symbols:
        return predictions, []

    try:
        ph = ",".join("?" * len(symbols))
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                f"SELECT symbol, rsi_14, ret_5d FROM features "
                f"WHERE date = ? AND symbol IN ({ph})",
                (date, *symbols),
            ).fetchall()
    except Exception as e:
        logger.warning("과열 필터 DB 조회 실패, 필터 미적용: %s", e)
        return predictions, []

    feat_map: Dict[str, Dict[str, Any]] = {
        row[0]: {"rsi_14": row[1], "ret_5d": row[2]} for row in rows
    }

    filtered: List[Dict[str, Any]] = []
    excluded: List[Dict[str, Any]] = []

    for p in predictions:
        sym  = p.get("symbol", "")
        feat = feat_map.get(sym, {})
        rsi  = feat.get("rsi_14")
        ret5 = feat.get("ret_5d")

        reasons: List[str] = []
        if rsi  is not None and rsi  >= rsi_threshold:
            reasons.append(f"RSI {rsi:.1f}")
        if ret5 is not None and ret5 >= ret_5d_threshold:
            reasons.append(f"5일수익률 {ret5 * 100:.1f}%")

        if reasons:
            excluded.append({"symbol": sym, "reason": ", ".join(reasons)})
        else:
            filtered.append(p)

    if excluded:
        logger.info("과열 제외 %d건: %s", len(excluded), [e["symbol"] for e in excluded])

    return filtered, excluded

"""
필터 조합 비교 백테스트

시나리오:
  1. Baseline        — 필터 없음 (현재)
  2. Cooldown 5일    — 매수 후 5거래일 내 재매수 차단
  3. Cooldown + 과열  — 쿨다운 5일 + RSI≥80 또는 5일수익률≥30% 종목 제외

출력: 콘솔 + models/target_5d_*/filter_comparison_report.txt

실행:
  cd backend/ml
  python compare_filters.py
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from dataset import FEATURE_COLS, build_dataset
from evaluate import MIN_VOLUME_KRW, _max_drawdown, _net_ret, _sharpe

MODELS_DIR = Path(__file__).parent.parent / "models"

report: list[str] = []


def _log(msg: str = "") -> None:
    print(msg, flush=True)
    report.append(msg)


def _find_latest_5d() -> Path:
    candidates = sorted(MODELS_DIR.glob("target_5d_*/model.lgb"))
    if not candidates:
        raise FileNotFoundError("target_5d 모델 없음")
    return candidates[-1].parent


# ── 시나리오 실행 ─────────────────────────────────────────────

def _run_scenario(
    df: pd.DataFrame,
    top_k: int = 10,
    cooldown_days: int = 0,
    exclude_overheat: bool = False,
    overheat_rsi: float = 80.0,
    overheat_ret_5d: float = 0.30,
) -> dict:
    """
    5일 리밸런싱 백테스트 실행.
    df 필요 컬럼: symbol, date, ret_fwd_5d, y_proba, (volume_krw 선택),
                 (rsi_14, ret_5d — 과열 필터 사용 시)
    반환: 성과 지표 dict + 선택 종목 DataFrame
    """
    unique_dates = sorted(df["date"].unique())
    rebal_dates  = unique_dates[::5]
    date_to_idx  = {d: i for i, d in enumerate(unique_dates)}

    last_bought_idx: Dict[str, int] = {}

    net_list:   list[float] = []
    gross_list: list[float] = []
    sel_rows:   list[pd.DataFrame] = []

    for date in rebal_dates:
        grp = df[df["date"] == date].copy()
        cur_idx = date_to_idx[date]

        # 유동성 필터
        if "volume_krw" in grp.columns:
            grp = grp[grp["volume_krw"] >= MIN_VOLUME_KRW]

        # 쿨다운 필터
        if cooldown_days > 0 and last_bought_idx:
            cooldown_syms = {
                sym for sym, last_idx in last_bought_idx.items()
                if (cur_idx - last_idx) <= cooldown_days
            }
            if cooldown_syms:
                grp = grp[~grp["symbol"].isin(cooldown_syms)]

        # 과열 필터
        if exclude_overheat:
            oh_mask = pd.Series(False, index=grp.index)
            if "rsi_14" in grp.columns:
                oh_mask |= grp["rsi_14"].fillna(0) >= overheat_rsi
            if "ret_5d" in grp.columns:
                oh_mask |= grp["ret_5d"].fillna(0) >= overheat_ret_5d
            grp = grp[~oh_mask]

        top = grp.sort_values("y_proba", ascending=False).head(top_k)
        if top.empty:
            continue

        # 쿨다운 업데이트
        if cooldown_days > 0:
            for sym in top["symbol"]:
                last_bought_idx[sym] = cur_idx

        gross_list.append(float(top["ret_fwd_5d"].mean()))
        net_list.append(float(top["ret_fwd_5d"].apply(_net_ret).mean()))

        top_copy = top[["symbol", "ret_fwd_5d", "y_proba"]].copy()
        top_copy["net_ret"] = top_copy["ret_fwd_5d"].apply(_net_ret)
        sel_rows.append(top_copy)

    if not net_list:
        return {"empty": True, "selected": pd.DataFrame()}

    ns = pd.Series(net_list)
    gs = pd.Series(gross_list)
    net_cum = (1 + ns).cumprod() - 1

    sel_df = pd.concat(sel_rows, ignore_index=True) if sel_rows else pd.DataFrame()

    return {
        "empty":          False,
        "net_cum_pct":    float(net_cum.iloc[-1]) * 100,
        "gross_cum_pct":  float((1 + gs).prod() - 1) * 100,
        "sharpe":         _sharpe(ns, 252 / 5),
        "mdd_pct":        _max_drawdown(net_cum) * 100,
        "win_rate_pct":   float((ns > 0).mean()) * 100,
        "periods":        len(net_list),
        "selected":       sel_df,
    }


# ── 분석 헬퍼 ────────────────────────────────────────────────

def _freq_distribution(sel_df: pd.DataFrame) -> list[dict]:
    """종목별 거래 빈도 분포 계산."""
    if sel_df.empty:
        return []
    trade_count = sel_df.groupby("symbol").size()
    buckets = [
        ("1회",    trade_count == 1),
        ("2~5회",  (trade_count >= 2) & (trade_count <= 5)),
        ("6~10회", (trade_count >= 6) & (trade_count <= 10)),
        ("11회+",  trade_count >= 11),
    ]
    result = []
    for label, mask in buckets:
        syms = trade_count[mask].index.tolist()
        grp  = sel_df[sel_df["symbol"].isin(syms)]
        if grp.empty:
            result.append({"label": label, "n_sym": 0, "n_trades": 0,
                           "avg_ret": None, "win_rate": None})
        else:
            result.append({
                "label":    label,
                "n_sym":    len(syms),
                "n_trades": len(grp),
                "avg_ret":  grp["net_ret"].mean() * 100,
                "win_rate": (grp["net_ret"] > 0).mean() * 100,
            })
    return result


def _top10_concentration(sel_df: pd.DataFrame) -> float:
    """상위 10개 종목의 누적 기여 비중 (%)."""
    if sel_df.empty:
        return 0.0
    by_sym = sel_df.groupby("symbol")["net_ret"].sum().sort_values(ascending=False)
    total  = by_sym.sum()
    if total == 0:
        return 0.0
    return float(by_sym.head(10).sum() / total * 100)


# ── 출력 헬퍼 ────────────────────────────────────────────────

def _print_metrics_table(scenarios: list[tuple[str, dict]]) -> None:
    _log("\n" + "=" * 70)
    _log("시나리오별 성과 비교")
    _log("=" * 70)

    labels   = [s[0] for s in scenarios]
    col_w    = 20
    header   = f"  {'지표':<22}" + "".join(f"{lb:>{col_w}}" for lb in labels)
    _log(header)
    _log("  " + "-" * (22 + col_w * len(labels)))

    rows = [
        ("Net 누적수익률",  "net_cum_pct",   "%"),
        ("Gross 누적수익률", "gross_cum_pct", "%"),
        ("Sharpe (연환산)", "sharpe",        ""),
        ("MDD",            "mdd_pct",       "%"),
        ("Win Rate",       "win_rate_pct",  "%"),
        ("리밸런싱 횟수",   "periods",       ""),
        ("상위10 기여비중", "top10_conc",    "%"),
    ]

    for row_label, key, unit in rows:
        line = f"  {row_label:<22}"
        for _, res in scenarios:
            if res.get("empty"):
                line += f"{'N/A':>{col_w}}"
            else:
                val = res.get(key, 0)
                if key == "periods":
                    line += f"{int(val):>{col_w}}"
                else:
                    line += f"{val:>{col_w - len(unit)}.2f}{unit:>{len(unit) if unit else 1}}"
        _log(line)


def _print_freq_table(label: str, freq: list[dict]) -> None:
    _log(f"\n  [{label}] 거래 빈도 분포:")
    _log(f"  {'구간':<10} {'종목수':>7} {'총거래':>8} {'평균수익률':>12} {'Win Rate':>10}")
    _log("  " + "-" * 52)
    for b in freq:
        if b["avg_ret"] is None:
            _log(f"  {b['label']:<10} {b['n_sym']:>7} {b['n_trades']:>8} {'N/A':>12} {'N/A':>10}")
        else:
            _log(
                f"  {b['label']:<10} {b['n_sym']:>7} {b['n_trades']:>8} "
                f"{b['avg_ret']:>11.2f}% {b['win_rate']:>9.1f}%"
            )


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

def main() -> None:
    model_dir = _find_latest_5d()
    _log(f"모델: {model_dir.name}")

    booster = lgb.Booster(model_file=str(model_dir / "model.lgb"))

    _log("데이터셋 로드 (val_days=252)...")
    X_train, y_train, X_val, y_val, val_meta = build_dataset(
        target_col="target_5d", val_days=252
    )
    _log(f"  train={len(X_train):,}  val={len(X_val):,}")

    available = [c for c in FEATURE_COLS if c in X_val.columns]
    y_proba   = booster.predict(X_val[available].astype(float).values)

    # 베이스 df 조립 (val_meta + 예측 확률 + 과열 필터용 피처)
    df = val_meta.copy().reset_index(drop=True)
    df["y_proba"]    = y_proba
    df["ret_fwd_5d"] = df["ret_fwd_5d"].fillna(0.0)
    if "volume_krw" in df.columns:
        df["volume_krw"] = df["volume_krw"].fillna(0)

    x_reset = X_val.reset_index(drop=True)
    for col in ("rsi_14", "ret_5d"):
        if col in x_reset.columns:
            df[col] = x_reset[col].values
        else:
            _log(f"  [경고] {col} 컬럼 없음 — 과열 필터 미적용")

    has_overheat_cols = "rsi_14" in df.columns and "ret_5d" in df.columns

    # ── 3개 시나리오 실행 ────────────────────────────────────
    _log("\n시나리오 1/3: Baseline (필터 없음)...")
    r1 = _run_scenario(df)

    _log("시나리오 2/3: Cooldown 5일...")
    r2 = _run_scenario(df, cooldown_days=5)

    _log("시나리오 3/3: Cooldown 5일 + 과열 필터 (RSI≥80, 5일수익률≥30%)...")
    r3 = _run_scenario(
        df,
        cooldown_days=5,
        exclude_overheat=has_overheat_cols,
        overheat_rsi=80.0,
        overheat_ret_5d=0.30,
    )

    # 상위10 기여비중 계산
    for r in (r1, r2, r3):
        if not r.get("empty"):
            r["top10_conc"] = _top10_concentration(r["selected"])

    scenarios = [
        ("Baseline",          r1),
        ("Cooldown 5일",      r2),
        ("Cooldown+과열필터", r3),
    ]

    # ── 출력 ────────────────────────────────────────────────
    _log("\n" + "=" * 70)
    _log(f"필터 조합 비교 백테스트  |  모델: {model_dir.name}")
    _log(f"검증 기간: {df['date'].min()} ~ {df['date'].max()}  ({df['date'].nunique()}거래일)")
    _log(f"과열 필터 기준: RSI ≥ 80.0  |  5일수익률 ≥ 30%")
    _log("=" * 70)

    _print_metrics_table(scenarios)

    _log("\n\n" + "=" * 70)
    _log("시나리오별 거래 빈도 분포")
    _log("=" * 70)
    for label, res in scenarios:
        if not res.get("empty"):
            freq = _freq_distribution(res["selected"])
            _print_freq_table(label, freq)

    # cooldown 효과 요약
    if not r1.get("empty") and not r2.get("empty"):
        f1 = _freq_distribution(r1["selected"])
        f2 = _freq_distribution(r2["selected"])
        _log("\n" + "=" * 70)
        _log("Cooldown 효과 요약 (6~10회 구간 변화)")
        _log("=" * 70)
        b1 = next((b for b in f1 if b["label"] == "6~10회"), {})
        b2 = next((b for b in f2 if b["label"] == "6~10회"), {})
        _log(f"  Baseline   6~10회 구간: {b1.get('n_sym', 0):>4}종목 / {b1.get('n_trades', 0):>5}건")
        _log(f"  Cooldown   6~10회 구간: {b2.get('n_sym', 0):>4}종목 / {b2.get('n_trades', 0):>5}건")
        diff_sym = b2.get("n_sym", 0) - b1.get("n_sym", 0)
        _log(f"  차이: {diff_sym:+d}종목  ({'감소' if diff_sym < 0 else '증가 또는 동일'})")

    report_path = model_dir / "filter_comparison_report.txt"
    report_path.write_text("\n".join(report), encoding="utf-8")
    _log(f"\n리포트 저장: {report_path}")


if __name__ == "__main__":
    main()

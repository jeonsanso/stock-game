"""
종목 집중도 진단 스크립트

분석 1: 종목별 누적 기여도 (5일 리밸런싱 Top-10 포트폴리오)
분석 2: 상위 10개 기여 종목 제외 후 백테스트 성과 비교
분석 3: 거래 빈도 분포 (1회 / 2~5회 / 6~10회 / 11회+)
분석 4: 상위 기여 종목 특징 (확률, ATR, 거래대금, 수익률 분포)

실행:
  cd backend/ml
  python diagnose_concentration.py
"""

import sys
from pathlib import Path

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


def _build_selected(
    df: pd.DataFrame, top_k: int = 10
) -> pd.DataFrame:
    """5일 리밸런싱 백테스트에서 선택된 종목 전체 row 반환. df에는 y_proba 컬럼 필요."""
    unique_dates = sorted(df["date"].unique())
    rebal_dates = unique_dates[::5]

    rows = []
    for date in rebal_dates:
        grp = df[df["date"] == date].copy()
        if "volume_krw" in grp.columns:
            grp = grp[grp["volume_krw"] >= MIN_VOLUME_KRW]
        top = grp.sort_values("y_proba", ascending=False).head(top_k)
        rows.append(top)

    if not rows:
        return pd.DataFrame()

    sel = pd.concat(rows, ignore_index=True)
    sel["net_ret"] = sel["ret_fwd_5d"].apply(_net_ret)
    return sel


# ══════════════════════════════════════════════════════════════
# 분석 1: 종목별 기여도
# ══════════════════════════════════════════════════════════════

def analysis_1_contribution(sel: pd.DataFrame) -> list[str]:
    """상위 20개 종목의 누적 기여도 표시. 상위 10개 종목 심볼 리스트 반환."""
    _log("\n" + "=" * 60)
    _log("분석 1: 종목별 누적 기여도 (5일 리밸런싱 Top-10)")
    _log("=" * 60)

    by_sym = (
        sel.groupby("symbol")["net_ret"]
        .agg(["count", "mean", "sum"])
        .rename(columns={"count": "trades", "mean": "avg_ret", "sum": "total_ret"})
        .sort_values("total_ret", ascending=False)
    )
    total_profit = by_sym["total_ret"].sum()

    _log(f"\n  전체 선택 종목 수: {len(by_sym):,}개  총 거래 횟수: {sel.shape[0]:,}건")
    _log(f"  포트폴리오 총 누적 수익 (합산): {total_profit * 100:.2f}%p")
    _log(f"\n  상위 20개 종목 기여도:")
    _log(f"  {'순위':>4} {'종목':>10} {'거래수':>6} {'평균수익률':>10} {'누적기여':>10} {'기여비중':>8}")
    _log("  " + "-" * 56)

    for rank, (sym, row) in enumerate(by_sym.head(20).iterrows(), 1):
        share = row["total_ret"] / total_profit * 100 if total_profit != 0 else 0
        _log(
            f"  {rank:>4} {sym:>10} {int(row['trades']):>6} "
            f"{row['avg_ret'] * 100:>9.2f}% {row['total_ret'] * 100:>9.2f}%p {share:>7.1f}%"
        )

    top3_share = by_sym.head(3)["total_ret"].sum() / total_profit * 100 if total_profit != 0 else 0
    top10_share = by_sym.head(10)["total_ret"].sum() / total_profit * 100 if total_profit != 0 else 0
    bottom_half = by_sym.tail(max(len(by_sym) // 2, 1))["total_ret"].sum()
    bottom_share = bottom_half / total_profit * 100 if total_profit != 0 else 0

    _log(f"\n  상위  3개 종목 기여 비중: {top3_share:.1f}%")
    _log(f"  상위 10개 종목 기여 비중: {top10_share:.1f}%")
    _log(f"  하위 절반 종목 기여 비중: {bottom_share:.1f}%")

    if abs(top3_share) > 50:
        _log("  [주의] 수익의 절반 이상이 상위 3종목에서 발생 — 집중 위험")
    elif abs(top10_share) > 80:
        _log("  [주의] 수익의 80%가 상위 10종목에서 발생 — 분산 필요")
    else:
        _log("  [양호] 기여도 분산 수준 양호")

    return list(by_sym.head(10).index)


# ══════════════════════════════════════════════════════════════
# 분석 2: 상위 기여 종목 제외 백테스트
# ══════════════════════════════════════════════════════════════

def analysis_2_exclude_backtest(
    df_full: pd.DataFrame, top10_symbols: list[str], top_k: int = 10
) -> None:
    _log("\n" + "=" * 60)
    _log("분석 2: 상위 10개 기여 종목 제외 후 백테스트")
    _log("=" * 60)
    _log(f"\n  제외 종목: {', '.join(top10_symbols)}")

    def _run_bt(df: pd.DataFrame) -> dict:
        unique_dates = sorted(df["date"].unique())
        rebal_dates = unique_dates[::5]
        net_list, gross_list = [], []
        for date in rebal_dates:
            grp = df[df["date"] == date].copy()
            if "volume_krw" in grp.columns:
                grp = grp[grp["volume_krw"] >= MIN_VOLUME_KRW]
            top = grp.sort_values("y_proba", ascending=False).head(top_k)
            if top.empty:
                continue
            gross_list.append(float(top["ret_fwd_5d"].mean()))
            net_list.append(float(top["ret_fwd_5d"].apply(_net_ret).mean()))
        if not net_list:
            return {}
        ns = pd.Series(net_list)
        gs = pd.Series(gross_list)
        net_cum = (1 + ns).cumprod() - 1
        return {
            "net_cum":   float(net_cum.iloc[-1]),
            "gross_cum": float((1 + gs).prod() - 1),
            "sharpe":    _sharpe(ns, 252 / 5),
            "mdd":       _max_drawdown(net_cum),
            "win_rate":  float((ns > 0).mean()),
            "periods":   len(net_list),
        }

    r_base = _run_bt(df_full)
    r_excl = _run_bt(df_full[~df_full["symbol"].isin(top10_symbols)].copy())

    _log(f"\n  {'지표':<20} {'전체 (기본)':>14} {'상위10종목 제외':>16} {'차이':>10}")
    _log("  " + "-" * 64)

    if r_base and r_excl:
        comparisons = [
            ("Net 누적수익률", r_base["net_cum"] * 100,   r_excl["net_cum"] * 100,   "%"),
            ("Gross 누적수익률", r_base["gross_cum"] * 100, r_excl["gross_cum"] * 100, "%"),
            ("Sharpe (연환산)", r_base["sharpe"],           r_excl["sharpe"],           ""),
            ("MDD",             r_base["mdd"] * 100,       r_excl["mdd"] * 100,       "%"),
            ("Win Rate",        r_base["win_rate"] * 100,  r_excl["win_rate"] * 100,  "%"),
        ]
        for name, bv, ev, unit in comparisons:
            diff = ev - bv
            _log(f"  {name:<20} {bv:>13.2f}{unit} {ev:>15.2f}{unit} {diff:>+9.2f}{unit}")

        net_diff = r_excl["net_cum"] - r_base["net_cum"]
        _log(f"\n  → 상위 10종목 제외 시 Net 수익률 변화: {net_diff * 100:+.2f}%p")
        if abs(net_diff) > 0.10:
            _log("  [주의] 특정 종목 의존도 높음 — 집중 위험 존재")
        else:
            _log("  [양호] 수익이 특정 종목에 과도하게 집중되지 않음")
    else:
        _log("  데이터 부족으로 비교 불가")


# ══════════════════════════════════════════════════════════════
# 분석 3: 거래 빈도 분포
# ══════════════════════════════════════════════════════════════

def analysis_3_frequency(sel: pd.DataFrame) -> None:
    _log("\n" + "=" * 60)
    _log("분석 3: 거래 빈도 분포")
    _log("=" * 60)

    trade_count = sel.groupby("symbol").size().rename("trades")
    buckets = [
        ("1회",    trade_count == 1),
        ("2~5회",  (trade_count >= 2) & (trade_count <= 5)),
        ("6~10회", (trade_count >= 6) & (trade_count <= 10)),
        ("11회+",  trade_count >= 11),
    ]

    _log(f"\n  {'구간':<10} {'종목수':>7} {'총거래':>8} {'평균수익률':>12} {'Win Rate':>10}")
    _log("  " + "-" * 52)

    for label, mask in buckets:
        syms = trade_count[mask].index.tolist()
        grp = sel[sel["symbol"].isin(syms)]
        if grp.empty:
            _log(f"  {label:<10} {'0':>7} {'0':>8} {'N/A':>12} {'N/A':>10}")
            continue
        avg_ret = grp["net_ret"].mean() * 100
        win_rate = (grp["net_ret"] > 0).mean() * 100
        _log(f"  {label:<10} {len(syms):>7} {len(grp):>8} {avg_ret:>11.2f}% {win_rate:>9.1f}%")

    top_freq = trade_count.sort_values(ascending=False).head(10)
    _log(f"\n  최다 등장 Top-10 종목:")
    _log(f"  {'종목':>10} {'등장횟수':>8} {'평균수익률':>12} {'총기여':>12}")
    _log("  " + "-" * 48)
    for sym, cnt in top_freq.items():
        sym_rows = sel[sel["symbol"] == sym]
        avg_r = sym_rows["net_ret"].mean() * 100
        tot_r = sym_rows["net_ret"].sum() * 100
        _log(f"  {sym:>10} {cnt:>8} {avg_r:>11.2f}% {tot_r:>11.2f}%p")


# ══════════════════════════════════════════════════════════════
# 분석 4: 상위 기여 종목 특징
# ══════════════════════════════════════════════════════════════

def analysis_4_characteristics(
    sel: pd.DataFrame,
    top10_symbols: list[str],
) -> None:
    _log("\n" + "=" * 60)
    _log("분석 4: 상위 기여 종목 특징 분석")
    _log("=" * 60)

    top10_rows  = sel[sel["symbol"].isin(top10_symbols)]
    others_rows = sel[~sel["symbol"].isin(top10_symbols)]

    _log(f"\n  상위 10개 종목 vs 나머지 종목 비교 (선택 시점 기준)")
    _log(f"  상위 10종목 거래 수: {len(top10_rows):,}  나머지: {len(others_rows):,}")
    _log(f"\n  {'지표':<22} {'상위10 종목':>14} {'나머지 종목':>14}")
    _log("  " + "-" * 54)

    if "y_proba" in sel.columns:
        _log(
            f"  {'선택 시 확률':<22} {top10_rows['y_proba'].mean():>13.3f} "
            f"{others_rows['y_proba'].mean():>13.3f}"
        )

    _log(
        f"  {'평균 net수익률':<22} {top10_rows['net_ret'].mean() * 100:>12.2f}% "
        f"{others_rows['net_ret'].mean() * 100:>12.2f}%"
    )
    _log(
        f"  {'Win Rate':<22} {(top10_rows['net_ret'] > 0).mean() * 100:>12.1f}% "
        f"{(others_rows['net_ret'] > 0).mean() * 100:>12.1f}%"
    )

    feat_labels = {
        "atr_pct":    ("ATR%",            False),
        "vol_krw_20d":("20일평균거래대금",  True),
        "pbr":        ("PBR",             False),
        "rsi_14":     ("RSI(14)",         False),
        "ret_5d":     ("5일수익률",        False),
    }
    for col, (label, is_won) in feat_labels.items():
        if col not in sel.columns:
            continue
        t10_val = top10_rows[col].mean()
        oth_val = others_rows[col].mean()
        if is_won:
            _log(f"  {label:<22} {t10_val / 1e8:>12.1f}억 {oth_val / 1e8:>12.1f}억")
        else:
            _log(f"  {label:<22} {t10_val:>13.3f} {oth_val:>13.3f}")

    _log(f"\n  상위 10개 종목 5일 수익률 분포 (net 기준):")
    r = top10_rows["net_ret"]
    _log(f"  평균={r.mean() * 100:.2f}%  중앙값={r.median() * 100:.2f}%  표준편차={r.std() * 100:.2f}%")
    _log(f"  최대={r.max() * 100:.2f}%  최소={r.min() * 100:.2f}%  왜도={r.skew():.2f}")
    _log(f"  양수={(r > 0).mean() * 100:.1f}%  >+5%={(r > 0.05).mean() * 100:.1f}%  <-5%={(r < -0.05).mean() * 100:.1f}%")


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
    y_proba = booster.predict(X_val[available].astype(float).values)

    # val_meta에 예측 확률 + 피처 컬럼 부착
    df = val_meta.copy().reset_index(drop=True)
    df["y_proba"]   = y_proba
    df["ret_fwd_5d"] = df["ret_fwd_5d"].fillna(0.0)
    if "volume_krw" in df.columns:
        df["volume_krw"] = df["volume_krw"].fillna(0)

    feat_attach = ["atr_pct", "vol_krw_20d", "pbr", "rsi_14", "ret_5d"]
    x_reset = X_val.reset_index(drop=True)
    for col in feat_attach:
        if col in x_reset.columns:
            df[col] = x_reset[col].values

    sel = _build_selected(df)
    if sel.empty:
        _log("선택된 종목 없음 — 종료")
        return

    top10_symbols = analysis_1_contribution(sel)
    analysis_2_exclude_backtest(df, top10_symbols)
    analysis_3_frequency(sel)
    analysis_4_characteristics(sel, top10_symbols)

    report_path = model_dir / "concentration_report.txt"
    report_path.write_text("\n".join(report), encoding="utf-8")
    _log(f"\n리포트 저장: {report_path}")


if __name__ == "__main__":
    main()

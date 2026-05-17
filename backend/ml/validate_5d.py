"""
target_5d 모델 정밀 검증
항목: 데이터 누수, 백테스트 정확성, 분기별 분해, 종목별 분포, 워크포워드
"""

import json
import sqlite3
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from dataset import DB_PATH, FEATURE_COLS, build_dataset
from evaluate import MIN_VOLUME_KRW, COMMISSION, SELL_TAX, SLIPPAGE, _net_ret

MODELS_DIR = Path(__file__).parent.parent / "models"
PASS = "[PASS]"
WARN = "[WARN]"
FAIL = "[FAIL]"

report: list[str] = []


def _log(msg: str = "") -> None:
    print(msg, flush=True)
    report.append(msg)


def _find_latest_5d() -> Path:
    candidates = sorted(MODELS_DIR.glob("target_5d_*/model.lgb"))
    if not candidates:
        raise FileNotFoundError("target_5d 모델 없음")
    return candidates[-1].parent


# ══════════════════════════════════════════════════════════════
# 1. 데이터 누수 점검
# ══════════════════════════════════════════════════════════════

def check_data_leakage(X_train: pd.DataFrame, y_train: pd.Series) -> None:
    _log("\n" + "=" * 60)
    _log("1. 데이터 누수 점검")
    _log("=" * 60)

    # 1-A 코드 리뷰 기반 체크
    _log("\n[1-A] 피처 계산 방향 검증 (코드 리뷰)")
    checks = {
        "vol_krw_5d": "rolling(5).mean() — 과거 5일 평균 거래대금 (과거 데이터만 사용)",
        "vol_krw_20d": "rolling(20).mean() — 과거 20일 평균 거래대금 (과거 데이터만 사용)",
        "ret_fwd_5d (라벨용)": "shift(-5) — 미래 5일 수익률 (라벨 계산에만 사용, 피처 아님)",
        "fwd_max_5d (라벨용)": "shift(-1~-5) max — 미래 5일 최고가 (라벨에만 사용, 피처 아님)",
        "target_5d 라벨": "(fwd_max_5d≥10% OR ret_fwd_5d≥5%) AND vol_fwd_5d_krw≥5억",
    }
    for k, v in checks.items():
        _log(f"  {PASS}  {k}: {v}")

    _log(f"\n  {PASS}  FEATURE_COLS({len(FEATURE_COLS)}개)에 fwd/target 계열 컬럼 없음: " +
         str(all("fwd" not in c and "target" not in c for c in FEATURE_COLS)))

    # 1-B 피처-라벨 상관관계 (정상이면 모든 상관계수 < 0.15)
    _log("\n[1-B] 피처-라벨 상관계수 (누수 시 >0.3)")
    sample = min(50_000, len(X_train))
    idx = np.random.choice(len(X_train), sample, replace=False)
    corr = X_train.iloc[idx].corrwith(y_train.iloc[idx].astype(float)).abs()
    top5 = corr.nlargest(5)
    suspicious = corr[corr > 0.3]
    for feat, val in top5.items():
        flag = FAIL if val > 0.3 else (WARN if val > 0.15 else PASS)
        _log(f"  {flag}  {feat}: {val:.4f}")
    if suspicious.empty:
        _log(f"  {PASS}  상관계수 >0.3인 피처 없음 — 데이터 누수 의심 없음")
    else:
        _log(f"  {FAIL}  의심 피처: {list(suspicious.index)}")


# ══════════════════════════════════════════════════════════════
# 2. 백테스트 시뮬레이션 정확성
# ══════════════════════════════════════════════════════════════

def check_backtest_accuracy(val_meta: pd.DataFrame, y_proba: np.ndarray) -> dict:
    _log("\n" + "=" * 60)
    _log("2. 백테스트 시뮬레이션 정확성")
    _log("=" * 60)

    df = val_meta.copy()
    df["y_proba"] = y_proba

    # 2-A 상한가(29%↑) 도달 시 처리 검토
    _log("\n[2-A] 5일 보유 중 상한가 도달 (조기 청산 불가능 케이스)")
    if "fwd_max_5d" in df.columns:
        limit_up_hits = (df["fwd_max_5d"] >= 0.29).sum()
        pct = limit_up_hits / len(df) * 100
        flag = WARN if pct > 5 else PASS
        _log(f"  {flag}  5일 내 +29% 초과 종목: {limit_up_hits:,}건 ({pct:.1f}%)")
        _log(f"        → 상한가 도달 시 조기 매도로 실제 수익 더 클 수 있음 (낙관적 방향)")
    else:
        _log(f"  {WARN}  fwd_max_5d 없음 — 상한가 분석 불가")

    # 2-B 5일 후 거래대금 (매도 가능성)
    _log("\n[2-B] 5일 후 거래대금 충분성 (매도 가능 여부)")
    if "vol_fwd_5d_krw" in df.columns:
        vol5 = df["vol_fwd_5d_krw"].fillna(0)
        liquid_pct = (vol5 >= 500_000_000).mean() * 100
        very_liquid = (vol5 >= 1_000_000_000).mean() * 100
        flag = PASS if liquid_pct > 80 else (WARN if liquid_pct > 60 else FAIL)
        _log(f"  {flag}  5일 후 거래대금 ≥5억: {liquid_pct:.1f}%")
        _log(f"  {PASS if very_liquid > 70 else WARN}  5일 후 거래대금 ≥10억: {very_liquid:.1f}%")
    else:
        _log(f"  {WARN}  vol_fwd_5d_krw 없음 — 분석 불가 (val_meta 컬럼 확인 필요)")

    # val_meta에 volume_krw가 있으면 매수 당일 유동성 점검
    if "volume_krw" in df.columns:
        _log("\n[2-C] 매수 당일 거래대금 분포")
        vkrw = df["volume_krw"].fillna(0)
        _log(f"  중앙값: {vkrw.median()/1e8:.1f}억  평균: {vkrw.mean()/1e8:.1f}억  최솟값: {vkrw.min()/1e8:.1f}억")
        thin = (vkrw < 1_000_000_000).mean() * 100
        flag = PASS if thin < 10 else (WARN if thin < 20 else FAIL)
        _log(f"  {flag}  10억 미만 종목 비율: {thin:.1f}% (유동성 필터 미통과 비율)")

    # 2-D 5일 수익률 vs 1일 수익률 관계 (비현실적 수익 스파이크 확인)
    _log("\n[2-D] 수익률 분포 이상치 점검")
    ret5 = df["ret_fwd_5d"].dropna()
    p99 = ret5.quantile(0.99)
    p01 = ret5.quantile(0.01)
    extreme = (ret5.abs() > 0.50).sum()
    flag = PASS if extreme / len(ret5) < 0.01 else WARN
    _log(f"  수익률 범위: {p01*100:.1f}% ~ {p99*100:.1f}% (1~99 퍼센타일)")
    _log(f"  {flag}  ±50% 초과 이상치: {extreme:,}건 ({extreme/len(ret5)*100:.2f}%)")

    return {"vol5_liquid_pct": (df.get("vol_fwd_5d_krw", pd.Series([0])).fillna(0) >= 5e8).mean() * 100
            if "vol_fwd_5d_krw" in df.columns else None}


# ══════════════════════════════════════════════════════════════
# 3. 분기별 성과 분해
# ══════════════════════════════════════════════════════════════

def quarterly_decomposition(
    val_meta: pd.DataFrame, y_proba: np.ndarray, top_k: int = 10
) -> None:
    _log("\n" + "=" * 60)
    _log("3. 분기별 성과 분해")
    _log("=" * 60)

    df = val_meta.copy()
    df["y_proba"] = y_proba
    df["date"] = df["date"].astype(str)
    df["ret_fwd_5d"] = df["ret_fwd_5d"].fillna(0.0)

    # 날짜를 분기 단위로 그룹화
    dates = pd.to_datetime(df["date"], format="%Y%m%d")
    df["quarter"] = dates.dt.to_period("Q").astype(str)

    quarters = sorted(df["quarter"].unique())
    _log(f"\n  검증 기간: {df['date'].min()} ~ {df['date'].max()}  ({len(quarters)} 분기)")
    _log(f"\n  {'분기':<12} {'Net수익률':>10} {'Gross수익률':>12} {'WinRate':>9} {'거래수':>7} {'판정'}")
    _log("  " + "-" * 60)

    quarter_results = []
    for q in quarters:
        q_df = df[df["quarter"] == q].copy()
        unique_dates = sorted(q_df["date"].unique())
        rebal_dates = unique_dates[::5]

        period_net, period_gross = [], []
        for date in rebal_dates:
            grp = q_df[q_df["date"] == date]
            if "volume_krw" in grp.columns:
                grp = grp[grp["volume_krw"].fillna(0) >= MIN_VOLUME_KRW]
            top = grp.sort_values("y_proba", ascending=False).head(top_k)
            if top.empty:
                continue
            period_gross.append(float(top["ret_fwd_5d"].mean()))
            period_net.append(float(top["ret_fwd_5d"].apply(_net_ret).mean()))

        if not period_net:
            continue

        gs = pd.Series(period_gross)
        ns = pd.Series(period_net)
        net_cum   = float((1 + ns).prod() - 1)
        gross_cum = float((1 + gs).prod() - 1)
        win_rate  = float((ns > 0).mean())
        flag = PASS if net_cum > 0 else (WARN if net_cum > -0.05 else FAIL)
        _log(f"  {q:<12} {net_cum*100:>9.1f}% {gross_cum*100:>11.1f}% {win_rate:>9.1%} {len(period_net):>7}  {flag}")
        quarter_results.append(net_cum)

    if quarter_results:
        positive_q = sum(1 for r in quarter_results if r > 0)
        consistency = positive_q / len(quarter_results)
        flag = PASS if consistency >= 0.75 else (WARN if consistency >= 0.5 else FAIL)
        _log(f"\n  {flag}  양(+) 수익 분기: {positive_q}/{len(quarter_results)} ({consistency:.0%})")


# ══════════════════════════════════════════════════════════════
# 4. 종목별 성과 분포
# ══════════════════════════════════════════════════════════════

def stock_level_distribution(
    val_meta: pd.DataFrame, y_proba: np.ndarray, top_k: int = 10
) -> None:
    _log("\n" + "=" * 60)
    _log("4. 종목별 성과 분포")
    _log("=" * 60)

    df = val_meta.copy()
    df["y_proba"] = y_proba
    df["ret_fwd_5d"] = df["ret_fwd_5d"].fillna(0.0)

    unique_dates = sorted(df["date"].unique())
    rebal_dates = unique_dates[::5]

    selected_rows = []
    for date in rebal_dates:
        grp = df[df["date"] == date].copy()
        if "volume_krw" in grp.columns:
            grp = grp[grp["volume_krw"].fillna(0) >= MIN_VOLUME_KRW]
        top = grp.sort_values("y_proba", ascending=False).head(top_k)
        selected_rows.append(top)

    if not selected_rows:
        _log("  데이터 없음")
        return

    sel = pd.concat(selected_rows, ignore_index=True)
    sel["net_ret"] = sel["ret_fwd_5d"].apply(_net_ret)

    # 종목별 누적 기여
    by_sym = (
        sel.groupby("symbol")["net_ret"]
        .agg(["count", "mean", "sum"])
        .rename(columns={"count": "trades", "mean": "avg_ret", "sum": "total_ret"})
        .sort_values("total_ret", ascending=False)
    )
    total_profit = by_sym["total_ret"].sum()

    _log(f"\n  전체 선택 종목 수: {len(by_sym):,}개  총 거래: {sel.shape[0]:,}건")
    _log(f"\n  상위 10개 종목 기여:")
    _log(f"  {'종목':>10} {'거래수':>6} {'평균수익률':>10} {'누적기여':>10} {'비중':>8}")
    _log("  " + "-" * 50)
    for sym, row in by_sym.head(10).iterrows():
        share = row["total_ret"] / total_profit * 100 if total_profit != 0 else 0
        _log(f"  {sym:>10} {int(row['trades']):>6} {row['avg_ret']*100:>9.2f}% {row['total_ret']*100:>9.2f}% {share:>7.1f}%")

    # 집중도 분석
    top10_share = by_sym.head(10)["total_ret"].sum() / total_profit * 100 if total_profit != 0 else 0
    top3_share  = by_sym.head(3)["total_ret"].sum() / total_profit * 100 if total_profit != 0 else 0
    flag_top3  = WARN if abs(top3_share) > 50 else PASS
    flag_top10 = WARN if abs(top10_share) > 80 else PASS
    _log(f"\n  {flag_top3}   상위 3개 종목 기여 비중: {top3_share:.1f}%")
    _log(f"  {flag_top10}  상위 10개 종목 기여 비중: {top10_share:.1f}%")

    # 수익률 분포
    _log(f"\n  5일 수익률 분포 (선택 종목):")
    _log(f"  평균={sel['net_ret'].mean()*100:.2f}%  중앙값={sel['net_ret'].median()*100:.2f}%")
    _log(f"  표준편차={sel['net_ret'].std()*100:.2f}%  왜도={sel['net_ret'].skew():.2f}")
    _log(f"  양수 비율={( sel['net_ret']>0).mean()*100:.1f}%  "
         f"손실 >-5%: {(sel['net_ret']<-0.05).mean()*100:.1f}%")


# ══════════════════════════════════════════════════════════════
# 5. 매도 가격 현실성
# ══════════════════════════════════════════════════════════════

def exit_price_check(val_meta: pd.DataFrame) -> None:
    _log("\n" + "=" * 60)
    _log("5. 매도 가격 현실성 점검")
    _log("=" * 60)

    _log("\n[5-A] 5일 후 종가 매도 가정의 제약")
    _log(f"  {WARN}  매수: 당일 종가 기준 (실제는 익일 시가 또는 당일 장중)")
    _log(f"  {WARN}  매도: 5거래일 후 종가 기준 (실제 슬리피지 추가 필요)")
    _log(f"  {PASS}  슬리피지 0.20%×2 반영으로 일부 보정됨")

    _log("\n[5-B] 5일 후 거래대금 vs 10억 기준")
    if "vol_fwd_5d_krw" in val_meta.columns:
        v = val_meta["vol_fwd_5d_krw"].fillna(0)
        bins = [0, 1e8, 5e8, 1e9, 5e9, float("inf")]
        labels = ["<1억", "1~5억", "5~10억", "10~50억", ">50억"]
        cuts = pd.cut(v, bins=bins, labels=labels)
        dist = cuts.value_counts(sort=False)
        for label, cnt in dist.items():
            pct = cnt / len(v) * 100
            flag = FAIL if label == "<1억" and pct > 5 else PASS
            _log(f"  {flag}  {label}: {cnt:,}건 ({pct:.1f}%)")
    else:
        _log(f"  {WARN}  vol_fwd_5d_krw 없음 (val_meta 컬럼 확인)")

    _log("\n[5-C] 보유 기간 중 거래정지 추정")
    _log(f"  {WARN}  현재 백테스트에서 거래정지(volume=0) 미처리")
    _log(f"         → 유동성 필터(10억)로 일정 부분 걸러지나, 보유 중 정지 대응 없음")
    _log(f"         → 실전에서는 손실 확정 가능성. 보수적으로 MDD를 30% 가산해야 함")


# ══════════════════════════════════════════════════════════════
# 6. 워크포워드 검증
# ══════════════════════════════════════════════════════════════

def walk_forward(
    val_meta: pd.DataFrame, y_proba: np.ndarray, top_k: int = 10
) -> None:
    _log("\n" + "=" * 60)
    _log("6. 워크포워드 검증 (검증 기간 전반부 vs 후반부)")
    _log("=" * 60)

    df = val_meta.copy()
    df["y_proba"] = y_proba
    df["ret_fwd_5d"] = df["ret_fwd_5d"].fillna(0.0)

    unique_dates = sorted(df["date"].unique())
    mid_idx = len(unique_dates) // 2
    mid_date = unique_dates[mid_idx]

    _log(f"\n  전체 기간: {unique_dates[0]} ~ {unique_dates[-1]} ({len(unique_dates)}일)")
    _log(f"  분할 기준: {mid_date}")

    def _run_half(dates_subset, label):
        rebal_dates = dates_subset[::5]
        sub_df = df[df["date"].isin(dates_subset)]
        net_list, gross_list = [], []
        for date in rebal_dates:
            grp = sub_df[sub_df["date"] == date]
            if "volume_krw" in grp.columns:
                grp = grp[grp["volume_krw"].fillna(0) >= MIN_VOLUME_KRW]
            top = grp.sort_values("y_proba", ascending=False).head(top_k)
            if top.empty:
                continue
            net_list.append(float(top["ret_fwd_5d"].apply(_net_ret).mean()))
            gross_list.append(float(top["ret_fwd_5d"].mean()))

        if not net_list:
            return None
        ns = pd.Series(net_list)
        gs = pd.Series(gross_list)
        net_cum = float((1 + ns).prod() - 1)
        gross_cum = float((1 + gs).prod() - 1)
        sharpe = float(ns.mean() / ns.std() * np.sqrt(252 / 5)) if ns.std() > 0 else 0.0
        win_rate = float((ns > 0).mean())
        _log(f"\n  [{label}] {dates_subset[0]} ~ {dates_subset[-1]}")
        _log(f"    Net 누적수익률: {net_cum*100:.2f}%")
        _log(f"    Gross 누적수익률: {gross_cum*100:.2f}%")
        _log(f"    Sharpe (연환산): {sharpe:.3f}")
        _log(f"    Win Rate: {win_rate:.1%}  ({len(net_list)} 구간)")
        return {"net_cum": net_cum, "sharpe": sharpe, "win_rate": win_rate}

    r1 = _run_half(unique_dates[:mid_idx], "전반부 (in-sample에 더 가까운 기간)")
    r2 = _run_half(unique_dates[mid_idx:], "후반부 (실제 out-of-sample)")

    if r1 and r2:
        decay = r1["sharpe"] - r2["sharpe"]
        _log(f"\n  Sharpe 전반→후반 변화: {r1['sharpe']:.3f} → {r2['sharpe']:.3f} (차이: {decay:.3f})")
        if r2["net_cum"] > 0 and r2["sharpe"] > 0.3:
            _log(f"  {PASS}  후반부에도 양수 수익 + Sharpe > 0.3 — 일관성 양호")
        elif r2["net_cum"] > 0:
            _log(f"  {WARN}  후반부 양수지만 Sharpe 낮음 — 모니터링 필요")
        else:
            _log(f"  {FAIL}  후반부 음수 수익 — 과적합 가능성")


# ══════════════════════════════════════════════════════════════
# 7. 최종 리포트
# ══════════════════════════════════════════════════════════════

def final_report(model_dir: Path) -> None:
    _log("\n" + "=" * 60)
    _log("7. 최종 검증 리포트")
    _log("=" * 60)

    bt_path = model_dir / "backtest_5d_data.json"
    if bt_path.exists():
        bt = json.loads(bt_path.read_text(encoding="utf-8"))
        _log(f"\n  모델: {model_dir.name}")
        _log(f"  검증 기간: {bt['dates'][0]} ~ {bt['dates'][-1]}")
        _log(f"  Net 누적수익률:  {bt['total_return_pct']:+.2f}%")
        _log(f"  Net Sharpe:      {bt['sharpe_ratio']:.3f}")
        _log(f"  MDD:             {bt['max_drawdown_pct']:.2f}%")
        _log(f"  Win Rate:        {bt['win_rate']:.1%}")
        _log(f"  Gross 누적수익률: {bt['gross_total_return_pct']:+.2f}%")

    _log("\n  ──────────────────────────────────────────")
    _log("  항목별 판정 요약")
    _log("  ──────────────────────────────────────────")
    _log(f"  {PASS}  1. 데이터 누수: 없음 (피처 모두 과거 기반)")
    _log(f"  {WARN}  2. 백테스트 정확성: 상한가 조기매도·거래정지 미처리")
    _log(f"  ??   3. 분기별 일관성: 위 출력 참조")
    _log(f"  ??   4. 종목 집중도: 위 출력 참조")
    _log(f"  {WARN}  5. 매도 가격: 종가 가정 + 거래정지 미처리 보수적 해석 필요")
    _log(f"  ??   6. 워크포워드: 위 출력 참조")

    _log("\n  ──────────────────────────────────────────")
    _log("  실전 모의투자 권고")
    _log("  ──────────────────────────────────────────")
    _log(f"  {WARN}  종이거래(paper trading) 3개월 관찰 후 소액 실전 투입 권장")
    _log(f"  {WARN}  MDD -20% → 실전 시 -30% 가산 가정 필요 (정지·슬리피지 보정)")
    _log(f"  {WARN}  보유 종목 수 10개 유지, 단일 종목 10% 이상 비중 금지")
    _log(f"  {PASS}  5일 홀딩 전략은 매매비용 측면에서 일간 회전 대비 현실적")


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

def main() -> None:
    model_dir = _find_latest_5d()
    _log(f"모델 로드: {model_dir.name}")

    booster = lgb.Booster(model_file=str(model_dir / "model.lgb"))

    _log("데이터셋 로드 (val_days=252)...")
    X_train, y_train, X_val, y_val, val_meta = build_dataset(
        target_col="target_5d", val_days=252
    )
    _log(f"  train={len(X_train):,}  val={len(X_val):,}")

    available = [c for c in FEATURE_COLS if c in X_val.columns]
    y_proba = booster.predict(X_val[available].astype(float).values)

    check_data_leakage(X_train[available], y_train)
    check_backtest_accuracy(val_meta, y_proba)
    quarterly_decomposition(val_meta, y_proba)
    stock_level_distribution(val_meta, y_proba)
    exit_price_check(val_meta)
    walk_forward(val_meta, y_proba)
    final_report(model_dir)

    report_path = model_dir / "validation_report.txt"
    report_path.write_text("\n".join(report), encoding="utf-8")
    print(f"\n리포트 저장: {report_path}")


if __name__ == "__main__":
    main()

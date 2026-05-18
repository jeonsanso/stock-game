"""
예측 및 SHAP 분석 핵심 로직
모든 DB 접근, 모델 추론, SHAP 계산을 담당
"""

import json
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# ml/ 모듈을 import 경로에 추가
sys.path.insert(0, str(Path(__file__).parent.parent / "ml"))

import lightgbm as lgb
from dataset import DB_PATH, FEATURE_COLS
from trade_strategy import calculate_strategy

MODELS_DIR = Path(__file__).parent.parent / "models"

MIN_MARKET_VOL = 1_000_000_000  # 시장 추세 계산 시 최소 거래대금 (10억)

# 피처 한국어 라벨 (UI 표시용)
FEATURE_LABELS: Dict[str, str] = {
    "ret_1d": "1일 수익률", "ret_5d": "5일 수익률",
    "ret_20d": "20일 수익률", "ret_60d": "60일 수익률",
    "ma5_dev": "5일MA 이격도", "ma20_dev": "20일MA 이격도",
    "ma60_dev": "60일MA 이격도", "ma120_dev": "120일MA 이격도",
    "rsi_7": "RSI(7)", "rsi_14": "RSI(14)",
    "macd": "MACD", "macd_signal": "MACD Signal", "macd_hist": "MACD Hist",
    "bb_pct": "볼린저 위치", "bb_width": "볼린저 폭",
    "vol_ratio_5d": "거래량비(5일)", "vol_ratio_20d": "거래량비(20일)",
    "vol_surge": "거래량 급등",
    "vol_krw_5d": "거래대금(5일평균)", "vol_krw_20d": "거래대금(20일평균)",
    "atr_14": "ATR(14)", "atr_pct": "ATR 비율",
    "gap_pct": "갭 비율", "body_ratio": "몸통 비율",
    "upper_shadow": "윗꼬리", "lower_shadow": "아래꼬리",
    "up_streak": "연속 상승일", "down_streak": "연속 하락일",
    "rel_market_1d": "시장대비(1일)", "rel_market_5d": "시장대비(5일)",
    "rel_market_20d": "시장대비(20일)",
    "rel_sector_5d": "섹터대비(5일)", "rel_sector_20d": "섹터대비(20일)",
    "foreign_rate": "외국인 비율", "foreign_1d_chg": "외국인 1일변화",
    "foreign_5d_chg": "외국인 5일변화", "foreign_trend": "외국인 추세",
    "per": "PER", "pbr": "PBR",
}


# ── 모델 관련 ─────────────────────────────────────────────────

def get_market_trend(days: int = 30) -> Dict:
    """
    최근 N거래일 유동성 종목(10억+)의 중앙값 일간 수익률로 시장 추세 산출.
    반환: trend(bull/sideways/bear), label, ret_5d_pct, ret_20d_pct, confidence, badge, dates, returns
    """
    with sqlite3.connect(DB_PATH) as conn:
        df = pd.read_sql_query(
            """SELECT symbol, date, close, CAST(close AS REAL)*CAST(volume AS REAL) AS vol_krw
               FROM prices
               WHERE date >= (
                 SELECT MIN(d) FROM (
                   SELECT DISTINCT date AS d FROM prices ORDER BY date DESC LIMIT ?
                 )
               )
               ORDER BY symbol, date""",
            conn, params=(days + 5,)
        )

    if df.empty:
        return {"trend": "unknown", "label": "알 수 없음", "ret_5d_pct": 0, "ret_20d_pct": 0,
                "confidence": "low", "badge": None, "dates": [], "returns": []}

    df = df[df["vol_krw"] >= MIN_MARKET_VOL].copy()
    df["ret"] = df.groupby("symbol")["close"].pct_change()
    daily_ret = (
        df.dropna(subset=["ret"])
        .groupby("date")["ret"]
        .median()
        .sort_index()
        .tail(days)
    )

    if len(daily_ret) < 5:
        return {"trend": "unknown", "label": "알 수 없음", "ret_5d_pct": 0, "ret_20d_pct": 0,
                "confidence": "low", "badge": None, "dates": [], "returns": []}

    ret_5d  = float((1 + daily_ret.tail(5)).prod() - 1)
    ret_20d = float((1 + daily_ret.tail(20)).prod() - 1)

    if ret_20d > 0.03:
        trend, label, confidence, badge = "bull", "강세장", "high", None
    elif ret_20d < -0.03:
        trend, label, confidence, badge = "bear", "약세장", "low", "신중 권고"
    else:
        trend, label, confidence, badge = "sideways", "횡보장", "medium", None

    return {
        "trend":        trend,
        "label":        label,
        "ret_5d_pct":   round(ret_5d * 100, 2),
        "ret_20d_pct":  round(ret_20d * 100, 2),
        "confidence":   confidence,
        "badge":        badge,
        "dates":        list(daily_ret.index[-20:]),
        "returns":      [round(v * 100, 3) for v in daily_ret.tail(20).values],
    }


def find_latest_model_dir(target_col: str = "target_1d") -> Optional[Path]:
    candidates = sorted(MODELS_DIR.glob(f"{target_col}_*/model.lgb"))
    return candidates[-1].parent if candidates else None


def load_model(target_col: str = "target_1d") -> Tuple[lgb.Booster, Path]:
    model_dir = find_latest_model_dir(target_col)
    if model_dir is None:
        raise FileNotFoundError(f"저장된 모델 없음: {target_col}")
    return lgb.Booster(model_file=str(model_dir / "model.lgb")), model_dir


def load_model_info(model_dir: Path) -> Dict:
    meta_path = model_dir / "meta.json"
    if not meta_path.exists():
        return {}
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    v = meta.get("version", "")
    if len(v) >= 15:
        meta["trained_at"] = f"{v[:4]}-{v[4:6]}-{v[6:8]} {v[9:11]}:{v[11:13]}:{v[13:15]}"
    return meta


def load_backtest_data(model_dir: Path, target_col: str = "target_1d") -> Optional[Dict]:
    if target_col == "target_5d":
        p5 = model_dir / "backtest_5d_data.json"
        if p5.exists():
            return json.loads(p5.read_text(encoding="utf-8"))
    p = model_dir / "backtest_data.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


# ── DB 쿼리 ──────────────────────────────────────────────────

def get_latest_feature_date() -> str:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT MAX(date) FROM features").fetchone()
    if not row or row[0] is None:
        raise RuntimeError("features 테이블이 비어 있음")
    return row[0]


def _date_minus_days(date_str: str, days: int) -> str:
    """YYYYMMDD에서 N일 전 날짜 반환."""
    dt = datetime.strptime(date_str, "%Y%m%d")
    return (dt - timedelta(days=days)).strftime("%Y%m%d")


def _compute_rolling_price_features(prices_df: pd.DataFrame, target_date: str) -> pd.DataFrame:
    """
    prices_df (symbol, date, close, volume)에서
    vol_krw_5d, vol_krw_20d 계산 후 target_date 행만 반환.
    """
    if prices_df.empty:
        return pd.DataFrame(columns=["symbol", "vol_krw_5d", "vol_krw_20d", "log_market_cap"])

    prices_df = prices_df.copy()
    prices_df["volume_krw"] = (
        prices_df["close"].astype(float) *
        prices_df["volume"].fillna(0).astype(float)
    )
    prices_df = prices_df.sort_values(["symbol", "date"])

    prices_df["vol_krw_5d"] = prices_df.groupby("symbol")["volume_krw"].transform(
        lambda x: np.log1p(x.rolling(5, min_periods=1).mean())
    )
    prices_df["vol_krw_20d"] = prices_df.groupby("symbol")["volume_krw"].transform(
        lambda x: np.log1p(x.rolling(20, min_periods=5).mean())
    )

    return prices_df[prices_df["date"] == target_date][
        ["symbol", "vol_krw_5d", "vol_krw_20d"]
    ]


def _enrich_with_price_features(feat_df: pd.DataFrame, date: str) -> pd.DataFrame:
    """
    features DataFrame에 vol_krw_5d, vol_krw_20d, log_market_cap 컬럼 추가.
    prices 테이블 최근 35일 데이터를 로드해 rolling 계산.
    """
    if feat_df.empty:
        return feat_df

    start_date = _date_minus_days(date, 35)
    symbols = set(feat_df["symbol"].tolist())

    with sqlite3.connect(DB_PATH) as conn:
        if len(symbols) <= 50:
            ph = ",".join("?" * len(symbols))
            prices_df = pd.read_sql_query(
                f"SELECT symbol, date, close, volume FROM prices "
                f"WHERE symbol IN ({ph}) AND date>=? AND date<=? ORDER BY symbol, date",
                conn, params=(*sorted(symbols), start_date, date),
            )
        else:
            # 심볼이 많으면 날짜 범위로만 로드 후 in-memory 필터 (SQLite 파라미터 한계 회피)
            prices_df = pd.read_sql_query(
                "SELECT symbol, date, close, volume FROM prices "
                "WHERE date>=? AND date<=? ORDER BY symbol, date",
                conn, params=(start_date, date),
            )
            prices_df = prices_df[prices_df["symbol"].isin(symbols)]

    enriched = _compute_rolling_price_features(prices_df, date)

    feat_df = feat_df.copy()
    if enriched.empty:
        feat_df["vol_krw_5d"]  = np.nan
        feat_df["vol_krw_20d"] = np.nan
    else:
        feat_df = feat_df.merge(enriched, on="symbol", how="left")

    return feat_df


def _load_features_for_date(date: str) -> pd.DataFrame:
    with sqlite3.connect(DB_PATH) as conn:
        feat_df = pd.read_sql_query(
            "SELECT * FROM features WHERE date = ?", conn, params=(date,)
        )
    return _enrich_with_price_features(feat_df, date)


# ── SHAP ────────────────────────────────────────────────────

def _compute_shap(booster: lgb.Booster, X: np.ndarray) -> np.ndarray:
    """LightGBM built-in SHAP (margin space). 반환: (n_samples, n_features)"""
    contrib = booster.predict(X, pred_contrib=True)  # (n, n_features + 1)
    return contrib[:, :-1]


def _shap_entries(
    feature_names: List[str],
    raw_values: np.ndarray,
    shap_values: np.ndarray,
    top_k: Optional[int] = None,
) -> List[Dict]:
    pairs = sorted(
        zip(feature_names, raw_values, shap_values),
        key=lambda x: abs(x[2]),
        reverse=True,
    )
    if top_k is not None:
        pairs = pairs[:top_k]
    return [
        {
            "feature":   feat,
            "label":     FEATURE_LABELS.get(feat, feat),
            "value":     None if np.isnan(val) else round(float(val), 4),
            "shap":      round(float(sv), 4),
            "direction": "up" if sv > 0 else "down",
        }
        for feat, val, sv in pairs
    ]


# ── 예측 함수 ─────────────────────────────────────────────────

def _fetch_close_prices(symbols: List[str], date: str) -> Dict[str, float]:
    """종목 리스트의 해당 날짜 종가를 배치 조회."""
    if not symbols:
        return {}
    ph = ",".join("?" * len(symbols))
    try:
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                f"SELECT symbol, close FROM prices WHERE symbol IN ({ph}) AND date = ?",
                (*symbols, date),
            ).fetchall()
        return {sym: float(close) for sym, close in rows if close is not None}
    except Exception:
        return {}


def predict_today(
    booster: lgb.Booster,
    date: str,
    top_n: int = 30,
    shap_top_k: int = 6,
) -> List[Dict]:
    """특정 날짜 전종목 예측 → 확률 상위 top_n, 각 SHAP 상위 shap_top_k 포함."""
    features_df = _load_features_for_date(date)
    if features_df.empty:
        return []

    available = [c for c in FEATURE_COLS if c in features_df.columns]
    X = features_df[available].astype(float).values

    proba = booster.predict(X)

    sorted_idx = np.argsort(proba)[::-1][:top_n]
    X_top = X[sorted_idx]
    shap_vals = _compute_shap(booster, X_top)

    top_symbols = [features_df["symbol"].iloc[i] for i in sorted_idx]
    close_map = _fetch_close_prices(top_symbols, date)

    result = []
    for rank, (orig_idx, shap_row) in enumerate(zip(sorted_idx, shap_vals), start=1):
        sym = features_df["symbol"].iloc[orig_idx]
        features_row = features_df.iloc[orig_idx].to_dict()
        features_row["close"] = close_map.get(sym)

        result.append({
            "rank":        rank,
            "symbol":      sym,
            "probability": round(float(proba[orig_idx]), 4),
            "shap_top":    _shap_entries(available, X_top[rank - 1], shap_row, shap_top_k),
            "strategy":    calculate_strategy(sym, date, features_row),
        })
    return result


def predict_ticker(
    booster: lgb.Booster,
    symbol: str,
    date: str,
    price_days: int = 60,
) -> Optional[Dict]:
    """특정 종목 상세 분석 — 확률, 전체 SHAP, 가격 히스토리, 최근 피처값."""
    with sqlite3.connect(DB_PATH) as conn:
        feat_df = pd.read_sql_query(
            "SELECT * FROM features WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1",
            conn, params=(symbol, date),
        )
        price_df = pd.read_sql_query(
            "SELECT date, open, high, low, close, volume FROM prices "
            "WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT ?",
            conn, params=(symbol, date, price_days),
        )

    if feat_df.empty:
        return None

    actual_date = feat_df["date"].iloc[0]
    feat_df = _enrich_with_price_features(feat_df, actual_date)

    available = [c for c in FEATURE_COLS if c in feat_df.columns]
    X = feat_df[available].astype(float).values

    proba     = float(booster.predict(X)[0])
    shap_vals = _compute_shap(booster, X)[0]

    # 전체 종목 중 순위
    all_df = _load_features_for_date(date)
    rank   = None
    if not all_df.empty:
        avail2 = [c for c in FEATURE_COLS if c in all_df.columns]
        p_all  = booster.predict(all_df[avail2].astype(float).values)
        order  = list(all_df["symbol"].values[np.argsort(p_all)[::-1]])
        rank   = order.index(symbol) + 1 if symbol in order else None

    price_df = price_df.sort_values("date")
    price_history = [
        {
            "time":   r["date"],
            "open":   float(r["open"]),
            "high":   float(r["high"]),
            "low":    float(r["low"]),
            "close":  float(r["close"]),
            "volume": int(r["volume"]) if pd.notna(r["volume"]) else 0,
        }
        for r in price_df.to_dict(orient="records")
    ]

    recent_features = {
        col: (
            round(float(feat_df[col].iloc[0]), 4)
            if col in feat_df.columns and pd.notna(feat_df[col].iloc[0])
            else None
        )
        for col in FEATURE_COLS
    }

    features_row = feat_df.iloc[0].to_dict()
    if price_history:
        features_row["close"] = price_history[-1]["close"]

    return {
        "symbol":          symbol,
        "date":            actual_date,
        "probability":     round(proba, 4),
        "rank":            rank,
        "shap_full":       _shap_entries(available, X[0], shap_vals),
        "price_history":   price_history,
        "recent_features": recent_features,
        "strategy":        calculate_strategy(symbol, actual_date, features_row),
    }

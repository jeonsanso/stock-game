"""
features 테이블 DDL + CRUD
모든 피처는 (symbol, date) 복합 PK로 저장
"""

import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager
from typing import List, Dict, Optional

import pandas as pd

# collector의 DB와 동일한 파일 사용
DB_PATH = Path(__file__).parent.parent / "data" / "stocks.db"

logger = logging.getLogger(__name__)

DDL_FEATURES = """
CREATE TABLE IF NOT EXISTS features (
    symbol          TEXT NOT NULL,
    date            TEXT NOT NULL,

    -- ── 수익률 ──────────────────────────────────────────
    ret_1d          REAL,       -- 1일 수익률
    ret_5d          REAL,       -- 5일 수익률
    ret_20d         REAL,       -- 20일 수익률
    ret_60d         REAL,       -- 60일 수익률

    -- ── 이동평균 이격도 ──────────────────────────────────
    ma5_dev         REAL,       -- (종가/MA5) - 1
    ma20_dev        REAL,
    ma60_dev        REAL,
    ma120_dev       REAL,

    -- ── RSI ─────────────────────────────────────────────
    rsi_7           REAL,
    rsi_14          REAL,

    -- ── MACD (12/26/9) ──────────────────────────────────
    macd            REAL,       -- MACD 선
    macd_signal     REAL,       -- 시그널 선
    macd_hist       REAL,       -- 히스토그램

    -- ── 볼린저밴드 ───────────────────────────────────────
    bb_pct          REAL,       -- 밴드 내 위치 0(하단)~1(상단)
    bb_width        REAL,       -- 밴드 폭 / 중심선 (변동성 측정)

    -- ── 거래량 ──────────────────────────────────────────
    vol_ratio_5d    REAL,       -- 거래량 / 5일 평균
    vol_ratio_20d   REAL,       -- 거래량 / 20일 평균
    vol_surge       INTEGER,    -- vol_ratio_5d > 2 이면 1

    -- ── ATR ─────────────────────────────────────────────
    atr_14          REAL,       -- 14일 Average True Range
    atr_pct         REAL,       -- ATR / 종가 (정규화)

    -- ── 패턴 ─────────────────────────────────────────────
    gap_pct         REAL,       -- (시가 - 전일종가) / 전일종가
    body_ratio      REAL,       -- |종가-시가| / (고가-저가), 장대양봉 판별
    upper_shadow    REAL,       -- 윗꼬리 비율
    lower_shadow    REAL,       -- 아랫꼬리 비율
    up_streak       INTEGER,    -- 연속 상승일수
    down_streak     INTEGER,    -- 연속 하락일수

    -- ── 시장 컨텍스트 ────────────────────────────────────
    rel_market_1d   REAL,       -- 종목 1일 수익률 - 시장 평균 1일 수익률
    rel_market_5d   REAL,       -- 5일 기준
    rel_market_20d  REAL,       -- 20일 기준
    rel_sector_5d   REAL,       -- 동일 시장 섹터 대비 (시장=KOSPI/KOSDAQ)
    rel_sector_20d  REAL,

    -- ── 수급 (외국인 보유비율 기반) ──────────────────────
    foreign_rate    REAL,       -- 당일 외국인 보유비율 (%)
    foreign_1d_chg  REAL,       -- 1일 변화
    foreign_5d_chg  REAL,       -- 5일 누적 변화 (순매수 방향 proxy)
    foreign_trend   REAL,       -- 10일 선형회귀 기울기 (추세)

    -- ── 펀더멘털 ─────────────────────────────────────────
    per             REAL,       -- PER
    pbr             REAL,       -- PBR

    -- ── 시장 국면 ─────────────────────────────────────────
    kospi_ma200_ratio    REAL,  -- KOSPI 종가 / 200일 MA (>1 강세)
    kospi_volatility_20d REAL,  -- KOSPI 20일 수익률 표준편차
    kosdaq_kospi_ratio   REAL,  -- KOSDAQ 5일 수익률 - KOSPI 5일 수익률
    market_breadth       REAL,  -- 전일 대비 상승 종목 비율

    -- ── 타겟 (학습용) ────────────────────────────────────
    target          INTEGER,    -- 다음날 상승=1, 하락=0, NULL=데이터없음

    PRIMARY KEY (symbol, date),
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
);

CREATE INDEX IF NOT EXISTS idx_features_date ON features (date);
"""


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def transaction():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_REGIME_COLS = [
    ("kospi_ma200_ratio",    "REAL"),
    ("kospi_volatility_20d", "REAL"),
    ("kosdaq_kospi_ratio",   "REAL"),
    ("market_breadth",       "REAL"),
]


def _migrate_features_table(conn: sqlite3.Connection) -> None:
    """기존 features 테이블에 시장 국면 컬럼이 없으면 ALTER TABLE로 추가"""
    existing = {row[1] for row in conn.execute("PRAGMA table_info(features)")}
    for col, typ in _REGIME_COLS:
        if col not in existing:
            conn.execute(f"ALTER TABLE features ADD COLUMN {col} {typ}")
            logger.info("features 컬럼 추가: %s %s", col, typ)


def init_features_table():
    with transaction() as conn:
        conn.executescript(DDL_FEATURES)
        _migrate_features_table(conn)
    logger.info("features 테이블 초기화 완료")


def get_last_feature_date(symbol: str) -> Optional[str]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT MAX(date) FROM features WHERE symbol=?", (symbol,)
        ).fetchone()
    return row[0] if row else None


def upsert_features(records: List[Dict]):
    """
    features 테이블에 upsert (ON CONFLICT REPLACE)
    재계산 시 최신 값으로 덮어쓰기 위해 REPLACE 사용
    """
    if not records:
        return

    cols = [
        "symbol", "date",
        "ret_1d", "ret_5d", "ret_20d", "ret_60d",
        "ma5_dev", "ma20_dev", "ma60_dev", "ma120_dev",
        "rsi_7", "rsi_14",
        "macd", "macd_signal", "macd_hist",
        "bb_pct", "bb_width",
        "vol_ratio_5d", "vol_ratio_20d", "vol_surge",
        "atr_14", "atr_pct",
        "gap_pct", "body_ratio", "upper_shadow", "lower_shadow",
        "up_streak", "down_streak",
        "rel_market_1d", "rel_market_5d", "rel_market_20d",
        "rel_sector_5d", "rel_sector_20d",
        "foreign_rate", "foreign_1d_chg", "foreign_5d_chg", "foreign_trend",
        "per", "pbr",
        "kospi_ma200_ratio", "kospi_volatility_20d", "kosdaq_kospi_ratio", "market_breadth",
        "target",
    ]
    placeholders = ", ".join(f":{c}" for c in cols)
    col_list = ", ".join(cols)

    with transaction() as conn:
        conn.executemany(
            f"INSERT OR REPLACE INTO features ({col_list}) VALUES ({placeholders})",
            records,
        )


def load_prices_for_symbol(symbol: str, start: Optional[str] = None) -> pd.DataFrame:
    """prices 테이블에서 단일 종목 가격 데이터 로드"""
    q = "SELECT date, open, high, low, close, volume FROM prices WHERE symbol=?"
    params = [symbol]
    if start:
        q += " AND date >= ?"
        params.append(start)
    q += " ORDER BY date ASC"

    with get_connection() as conn:
        df = pd.read_sql_query(q, conn, params=params)
    return df


def load_all_closes(start: Optional[str] = None) -> pd.DataFrame:
    """
    전종목 종가를 date × symbol 피벗 테이블로 반환
    시장 평균 수익률 계산에 사용
    """
    q = "SELECT date, symbol, close FROM prices"
    params = []
    if start:
        q += " WHERE date >= ?"
        params.append(start)
    q += " ORDER BY date"

    with get_connection() as conn:
        df = pd.read_sql_query(q, conn, params=params)

    if df.empty:
        return pd.DataFrame()

    pivot = df.pivot(index="date", columns="symbol", values="close")
    return pivot


def load_flows(symbol: str, start: Optional[str] = None) -> pd.DataFrame:
    q = "SELECT date, foreign_net FROM flows WHERE symbol=?"
    params = [symbol]
    if start:
        q += " AND date >= ?"
        params.append(start)
    q += " ORDER BY date ASC"

    with get_connection() as conn:
        df = pd.read_sql_query(q, conn, params=params)
    return df


def load_fundamentals_latest(symbol: str) -> Dict:
    """가장 최근 PER/PBR 반환"""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT per, pbr FROM fundamentals WHERE symbol=? ORDER BY date DESC LIMIT 1",
            (symbol,),
        ).fetchone()
    if row:
        return {"per": row[0], "pbr": row[1]}
    return {"per": None, "pbr": None}


def load_all_symbols_with_market() -> List[Dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT symbol, market FROM stocks ORDER BY market, symbol"
        ).fetchall()
    return [{"symbol": r[0], "market": r[1]} for r in rows]


def load_index_closes(start: Optional[str] = None) -> pd.DataFrame:
    """
    market_index 테이블에서 KOSPI(1001)/KOSDAQ(2001) 종가를 날짜 × 코드 피벗으로 반환
    반환: DataFrame  index=date  columns=['1001','2001']
    """
    q = "SELECT date, code, close FROM market_index"
    params = []
    if start:
        q += " WHERE date >= ?"
        params.append(start)
    q += " ORDER BY date"

    with get_connection() as conn:
        df = pd.read_sql_query(q, conn, params=params)

    if df.empty:
        return pd.DataFrame(columns=["1001", "2001"])

    pivot = df.pivot(index="date", columns="code", values="close")
    pivot.columns.name = None
    return pivot

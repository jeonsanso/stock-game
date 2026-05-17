"""
SQLite 스키마 정의 및 DB 헬퍼
테이블: stocks / prices / fundamentals / flows
"""

import sqlite3
import logging
from pathlib import Path
from contextlib import contextmanager
from typing import Optional, List, Dict

DB_PATH = Path(__file__).parent / "stocks.db"

logger = logging.getLogger(__name__)

DDL = """
-- 종목 마스터
CREATE TABLE IF NOT EXISTS stocks (
    symbol      TEXT PRIMARY KEY,   -- '005930' (6자리)
    name        TEXT NOT NULL,
    market      TEXT NOT NULL,      -- 'KOSPI' | 'KOSDAQ'
    sector      TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 일별 OHLCV + 시가총액
CREATE TABLE IF NOT EXISTS prices (
    symbol      TEXT NOT NULL,
    date        TEXT NOT NULL,      -- 'YYYYMMDD'
    open        INTEGER,
    high        INTEGER,
    low         INTEGER,
    close       INTEGER,
    volume      INTEGER,
    market_cap  INTEGER,            -- 억원
    PRIMARY KEY (symbol, date),
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
);

-- 일별 PER / PBR / DIV (펀더멘털)
CREATE TABLE IF NOT EXISTS fundamentals (
    symbol      TEXT NOT NULL,
    date        TEXT NOT NULL,
    per         REAL,
    pbr         REAL,
    div_yield   REAL,
    PRIMARY KEY (symbol, date),
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
);

-- 일별 수급 데이터
-- foreign_net: 외국인 보유비율(%) — 일별 변화값으로 순매수 방향 추정
-- inst_net: 기관 순매수 (현재 미수집, 향후 확장용)
CREATE TABLE IF NOT EXISTS flows (
    symbol          TEXT NOT NULL,
    date            TEXT NOT NULL,
    foreign_net     REAL,           -- 외국인 보유비율 (%)
    inst_net        REAL,           -- 기관 순매수 (향후 확장)
    PRIMARY KEY (symbol, date),
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
);

-- 시장 지수 일봉 (KOSPI=1001, KOSDAQ=2001)
CREATE TABLE IF NOT EXISTS market_index (
    date    TEXT NOT NULL,
    code    TEXT NOT NULL,  -- '1001'=KOSPI, '2001'=KOSDAQ
    open    REAL,
    high    REAL,
    low     REAL,
    close   REAL,
    volume  REAL,
    PRIMARY KEY (date, code)
);

-- 모의투자 추적
CREATE TABLE IF NOT EXISTS paper_trades (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol            TEXT NOT NULL,
    recommended_date  TEXT NOT NULL,    -- YYYYMMDD
    recommended_rank  INTEGER,          -- 추천 순위 (1~N)
    recommended_prob  REAL,             -- 모델 확률 (0~1)
    recommended_price INTEGER,          -- 추천일 종가 (매수가 기준)
    status            TEXT NOT NULL DEFAULT 'open',  -- 'open'|'closed'|'expired'
    close_date        TEXT,             -- 청산일 YYYYMMDD
    close_price       INTEGER,          -- 청산가 (종가)
    return_pct        REAL,             -- 수익률 (%)
    holding_days      INTEGER,          -- 보유 거래일 수
    created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (symbol, recommended_date)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_prices_date    ON prices       (date);
CREATE INDEX IF NOT EXISTS idx_fund_date      ON fundamentals (date);
CREATE INDEX IF NOT EXISTS idx_flows_date     ON flows        (date);
CREATE INDEX IF NOT EXISTS idx_mktidx_code   ON market_index (code, date);
CREATE INDEX IF NOT EXISTS idx_paper_date     ON paper_trades (recommended_date);
CREATE INDEX IF NOT EXISTS idx_paper_status   ON paper_trades (status);
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


def init_db():
    """DB 파일 생성 + 스키마 적용"""
    with transaction() as conn:
        conn.executescript(DDL)
    logger.info("DB 초기화 완료: %s", DB_PATH)


def get_latest_date(symbol: str, table: str = "prices") -> Optional[str]:
    """특정 종목의 해당 테이블 마지막 날짜 반환 (증분 업데이트용)"""
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT MAX(date) FROM {table} WHERE symbol = ?", (symbol,)
        ).fetchone()
    return row[0] if row else None


def get_all_symbols() -> List[Dict]:
    """저장된 전체 종목 목록 반환"""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT symbol, name, market FROM stocks ORDER BY market, symbol"
        ).fetchall()
    return [{"symbol": r[0], "name": r[1], "market": r[2]} for r in rows]


def upsert_stocks(records: List[Dict]):
    """종목 마스터 upsert"""
    with transaction() as conn:
        conn.executemany(
            """
            INSERT INTO stocks (symbol, name, market, sector, updated_at)
            VALUES (:symbol, :name, :market, :sector, datetime('now','localtime'))
            ON CONFLICT(symbol) DO UPDATE SET
                name=excluded.name, market=excluded.market,
                sector=excluded.sector,
                updated_at=excluded.updated_at
            """,
            records,
        )


def insert_prices(records: List[Dict]):
    """prices IGNORE (이미 있는 날짜 스킵)"""
    with transaction() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO prices
                (symbol, date, open, high, low, close, volume, market_cap)
            VALUES
                (:symbol, :date, :open, :high, :low, :close, :volume, :market_cap)
            """,
            records,
        )


def insert_fundamentals(records: List[Dict]):
    with transaction() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO fundamentals (symbol, date, per, pbr, div_yield)
            VALUES (:symbol, :date, :per, :pbr, :div_yield)
            """,
            records,
        )


def insert_flows(records: List[Dict]):
    with transaction() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO flows (symbol, date, foreign_net, inst_net)
            VALUES (:symbol, :date, :foreign_net, :inst_net)
            """,
            records,
        )


def init_paper_trades_table():
    """paper_trades 테이블 생성 (없으면)"""
    with transaction() as conn:
        conn.executescript(DDL)
    logger.info("paper_trades 테이블 초기화 완료")


def get_latest_index_date(code: str) -> Optional[str]:
    """market_index 테이블에서 특정 지수의 마지막 날짜 반환"""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT MAX(date) FROM market_index WHERE code = ?", (code,)
        ).fetchone()
    return row[0] if row else None


def insert_index_ohlcv(records: List[Dict]):
    """market_index IGNORE (이미 있는 날짜 스킵)"""
    with transaction() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO market_index (date, code, open, high, low, close, volume)
            VALUES (:date, :code, :open, :high, :low, :close, :volume)
            """,
            records,
        )

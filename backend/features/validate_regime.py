"""
시장 국면 피처 검증 스크립트

실행:
  python validate_regime.py

출력:
  - market_index 테이블 상태 (행 수, 날짜 범위)
  - features 테이블의 4개 신규 컬럼 NULL 비율
  - 각 피처의 분포 (min/25%/50%/75%/max/mean/std)
  - 최근 5행 샘플
"""

import sqlite3
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).parent.parent / "data" / "stocks.db"

REGIME_COLS = [
    "kospi_ma200_ratio",
    "kospi_volatility_20d",
    "kosdaq_kospi_ratio",
    "market_breadth",
]


def _sep(title: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


import sys as _sys
if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def check_market_index(conn: sqlite3.Connection) -> None:
    _sep("1. market_index 테이블 상태")

    # 테이블 존재 확인
    exists = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='market_index'"
    ).fetchone()[0]
    if not exists:
        print("  [ERROR] market_index 테이블이 없습니다.")
        print("  → cd backend && .\\data\\.venv\\Scripts\\python.exe data\\index_collector.py --initial")
        return

    df = pd.read_sql_query(
        "SELECT code, COUNT(*) as rows, MIN(date) as first, MAX(date) as last "
        "FROM market_index GROUP BY code ORDER BY code",
        conn,
    )
    if df.empty:
        print("  [WARN] market_index 데이터 없음 - index_collector.py --initial 실행 필요")
        return

    code_map = {"1001": "KOSPI", "2001": "KOSDAQ"}
    df["name"] = df["code"].map(code_map)
    df = df[["code", "name", "rows", "first", "last"]]
    print(df.to_string(index=False))


def check_features_columns(conn: sqlite3.Connection) -> None:
    _sep("2. features 테이블 - 신규 컬럼 존재 여부")

    existing = {row[1] for row in conn.execute("PRAGMA table_info(features)")}
    for col in REGIME_COLS:
        status = "OK" if col in existing else "MISSING - ALTER TABLE 필요"
        print(f"  {col:<30} {status}")


def check_null_rates(conn: sqlite3.Connection) -> None:
    _sep("3. features 테이블 - 신규 피처 NULL 비율")

    existing = {row[1] for row in conn.execute("PRAGMA table_info(features)")}
    available = [c for c in REGIME_COLS if c in existing]
    if not available:
        print("  신규 컬럼 없음 - pipeline.py --rebuild 실행 후 다시 시도")
        return

    total = conn.execute("SELECT COUNT(*) FROM features").fetchone()[0]
    print(f"  총 행 수: {total:,}")
    print()
    print(f"  {'피처':<30} {'NULL 수':>10} {'NULL 비율':>10} {'유효 수':>10}")
    print(f"  {'-'*60}")
    for col in available:
        null_cnt = conn.execute(
            f"SELECT COUNT(*) FROM features WHERE {col} IS NULL"
        ).fetchone()[0]
        null_pct = null_cnt / total * 100 if total else 0
        valid = total - null_cnt
        print(f"  {col:<30} {null_cnt:>10,} {null_pct:>9.1f}% {valid:>10,}")


def check_distribution(conn: sqlite3.Connection) -> None:
    _sep("4. features 테이블 - 피처 분포")

    existing = {row[1] for row in conn.execute("PRAGMA table_info(features)")}
    available = [c for c in REGIME_COLS if c in existing]
    if not available:
        print("  신규 컬럼 없음")
        return

    df = pd.read_sql_query(
        f"SELECT {', '.join(available)} FROM features WHERE date >= '20240101'",
        conn,
    )
    if df.empty:
        print("  데이터 없음")
        return

    desc = df.describe(percentiles=[0.25, 0.5, 0.75]).T[
        ["count", "mean", "std", "min", "25%", "50%", "75%", "max"]
    ]
    desc["count"] = desc["count"].astype(int)
    pd.set_option("display.float_format", "{:.4f}".format)
    pd.set_option("display.max_columns", 10)
    pd.set_option("display.width", 120)
    print(desc.to_string())


def check_sample(conn: sqlite3.Connection) -> None:
    _sep("5. features 테이블 - 최근 날짜 샘플 (5행)")

    existing = {row[1] for row in conn.execute("PRAGMA table_info(features)")}
    available = [c for c in REGIME_COLS if c in existing]
    if not available:
        print("  신규 컬럼 없음")
        return

    cols = ["symbol", "date"] + available
    df = pd.read_sql_query(
        f"SELECT {', '.join(cols)} FROM features "
        f"WHERE {available[0]} IS NOT NULL "
        f"ORDER BY date DESC, symbol LIMIT 5",
        conn,
    )
    pd.set_option("display.float_format", "{:.4f}".format)
    print(df.to_string(index=False))


def main():
    print(f"DB: {DB_PATH}")
    with sqlite3.connect(DB_PATH) as conn:
        check_market_index(conn)
        check_features_columns(conn)
        check_null_rates(conn)
        check_distribution(conn)
        check_sample(conn)
    print("\n검증 완료")


if __name__ == "__main__":
    main()

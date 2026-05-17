"""
라벨 계산
  target_1d : 다음날 종가 +3% 이상 → 1
  target_5d : 이후 5거래일 내 최고 종가 +10% 이상 → 1
"""

import sqlite3
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).parent.parent / "data" / "stocks.db"

THRESHOLD_1D = 0.03
THRESHOLD_5D = 0.10


def compute_labels(conn: sqlite3.Connection) -> pd.DataFrame:
    """
    전종목 (symbol, date)에 대해 target_1d / target_5d 계산.
    미래 데이터가 부족한 마지막 행은 pd.NA.
    반환: DataFrame[symbol, date, target_1d, target_5d]
    """
    prices = pd.read_sql_query(
        "SELECT symbol, date, close FROM prices ORDER BY symbol, date",
        conn,
    )
    prices["close"] = prices["close"].astype(float)

    def _label(grp: pd.DataFrame) -> pd.DataFrame:
        c = grp["close"]
        fwd_1d = c.shift(-1) / c - 1
        fwd_max_5d = (
            pd.DataFrame(
                {i: c.shift(-i).values for i in range(1, 6)},
                index=grp.index,
            ).max(axis=1)
            / c
            - 1
        )
        return pd.DataFrame(
            {
                "target_1d": (fwd_1d >= THRESHOLD_1D).astype("Int8").where(fwd_1d.notna()),
                "target_5d": (fwd_max_5d >= THRESHOLD_5D).astype("Int8").where(fwd_max_5d.notna()),
            },
            index=grp.index,
        )

    pd_ver = tuple(int(x) for x in pd.__version__.split(".")[:2])
    if pd_ver >= (2, 2):
        labels = prices.groupby("symbol", sort=False, group_keys=False).apply(_label, include_groups=False)
    else:
        labels = prices.groupby("symbol", sort=False, group_keys=False).apply(_label)
    result = prices[["symbol", "date"]].copy()
    result["target_1d"] = labels["target_1d"]
    result["target_5d"] = labels["target_5d"]
    return result

"""
역사 시뮬레이션 거래 이력 영속 저장
- session_id: 브라우저 단위 UUID (localStorage "history-session-id")
- INSERT OR IGNORE by trade id → 멱등 sync 보장
"""

import sqlite3
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).parent.parent
DB_PATH = BACKEND_ROOT / "data" / "stocks.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def sync_trades(session_id: str, trades: list[dict[str, Any]]) -> int:
    """trades 를 history_trades 에 INSERT OR IGNORE. 실제 삽입 건수 반환."""
    if not trades:
        return 0
    rows = [
        (
            t["id"],
            session_id,
            t["symbol"],
            t["name"],
            t["type"],
            int(t["quantity"]),
            float(t["price"]),
            float(t["total"]),
            int(t["timestamp"]),
            t.get("note") or None,
        )
        for t in trades
    ]
    with _conn() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO history_trades
                (id, session_id, symbol, name, type, quantity, price, total, game_ts, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def get_trades(session_id: str) -> list[dict[str, Any]]:
    """session_id 기준 전체 거래 이력 (game_ts 오름차순)."""
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, symbol, name, type, quantity, price, total, game_ts, note
            FROM history_trades
            WHERE session_id = ?
            ORDER BY game_ts ASC
            """,
            (session_id,),
        ).fetchall()
    return [
        {
            "id":        r[0],
            "symbol":    r[1],
            "name":      r[2],
            "type":      r[3],
            "quantity":  r[4],
            "price":     r[5],
            "total":     r[6],
            "timestamp": r[7],
            "note":      r[8],
        }
        for r in rows
    ]

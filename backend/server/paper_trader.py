"""
모의투자 추적 모듈

추천 종목을 paper_trades 테이블에 기록하고,
5 거래일 후 결과를 자동 청산 처리한다.
"""

import logging
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).parent.parent / "data" / "stocks.db"

logger = logging.getLogger(__name__)

HOLDING_DAYS = 5  # 청산까지 거래일 수


def _get_nth_trading_day_after(from_date: str, n: int) -> Optional[str]:
    """KOSPI 거래일 캘린더 기준, from_date 이후 n번째 거래일 반환."""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT date FROM market_index
            WHERE code = '1001' AND date > ?
            ORDER BY date
            LIMIT 1 OFFSET ?
            """,
            (from_date, n - 1),
        ).fetchone()
    return row[0] if row else None


def _count_trading_days_between(start_excl: str, end_incl: str) -> int:
    """start_excl 초과 ~ end_incl 이하 KOSPI 거래일 수."""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) FROM market_index
            WHERE code = '1001' AND date > ? AND date <= ?
            """,
            (start_excl, end_incl),
        ).fetchone()
    return row[0] if row else 0


def record_recommendations(
    recommended_date: str,
    predictions: List[Dict[str, Any]],
) -> int:
    """
    추천 종목을 paper_trades에 삽입.
    같은 (symbol, recommended_date) 쌍은 IGNORE (중복 방지).

    predictions: get_today_predictions 응답의 predictions 리스트
    반환: 새로 삽입된 행 수
    """
    if not predictions:
        return 0

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")

        inserted = 0
        for pred in predictions:
            symbol = pred["symbol"]
            row = conn.execute(
                "SELECT close FROM prices WHERE symbol = ? AND date = ?",
                (symbol, recommended_date),
            ).fetchone()
            price = row[0] if row else None

            cur = conn.execute(
                """
                INSERT OR IGNORE INTO paper_trades
                    (symbol, recommended_date, recommended_rank,
                     recommended_prob, recommended_price)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    symbol,
                    recommended_date,
                    pred.get("rank"),
                    pred.get("probability"),
                    price,
                ),
            )
            inserted += cur.rowcount

        conn.commit()

    logger.info("[paper_trader] %s 추천 기록: %d건 삽입", recommended_date, inserted)
    return inserted


def close_expired_trades(today: str) -> Dict[str, int]:
    """
    open 상태에서 HOLDING_DAYS 거래일 경과 거래를 청산 처리.
    종가 데이터 없으면 expired로 표시.
    반환: {"closed": int, "expired": int}
    """
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")

        open_trades = conn.execute(
            """
            SELECT id, symbol, recommended_date, recommended_price
            FROM paper_trades WHERE status = 'open'
            """,
        ).fetchall()

        n_closed = 0
        n_expired = 0
        for trade_id, symbol, rec_date, rec_price in open_trades:
            target_date = _get_nth_trading_day_after(rec_date, HOLDING_DAYS)
            if target_date is None or target_date > today:
                continue

            price_row = conn.execute(
                "SELECT close FROM prices WHERE symbol = ? AND date = ?",
                (symbol, target_date),
            ).fetchone()

            if price_row is None:
                conn.execute(
                    """
                    UPDATE paper_trades
                    SET status = 'expired', close_date = ?,
                        updated_at = datetime('now','localtime')
                    WHERE id = ?
                    """,
                    (target_date, trade_id),
                )
                n_expired += 1
            else:
                close_price = price_row[0]
                return_pct = (
                    (close_price / rec_price - 1) * 100
                    if rec_price else None
                )
                holding = _count_trading_days_between(rec_date, target_date)
                conn.execute(
                    """
                    UPDATE paper_trades
                    SET status = 'closed',
                        close_date = ?, close_price = ?,
                        return_pct = ?, holding_days = ?,
                        updated_at = datetime('now','localtime')
                    WHERE id = ?
                    """,
                    (target_date, close_price, return_pct, holding, trade_id),
                )
                n_closed += 1

        conn.commit()

    logger.info("[paper_trader] %s 기준 closed=%d expired=%d", today, n_closed, n_expired)
    return {"closed": n_closed, "expired": n_expired}


def get_active_trades_enriched(today: str) -> List[Dict[str, Any]]:
    """open 거래에 현재가·미실현 손익·보유 거래일 추가해 반환."""
    trades = get_active_trades()
    if not trades:
        return trades

    with sqlite3.connect(DB_PATH) as conn:
        for t in trades:
            row = conn.execute(
                "SELECT close FROM prices WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1",
                (t["symbol"], today),
            ).fetchone()
            current_price = row[0] if row else None
            rec_price = t.get("recommended_price")
            t["current_price"] = current_price
            t["unrealized_pct"] = (
                round((current_price / rec_price - 1) * 100, 2)
                if current_price and rec_price else None
            )
            t["holding_days"] = _count_trading_days_between(t["recommended_date"], today)

    return trades


def get_active_trades() -> List[Dict[str, Any]]:
    """현재 open 상태 거래 목록 (종목명 포함)."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT pt.*, s.name
            FROM paper_trades pt
            LEFT JOIN stocks s ON pt.symbol = s.symbol
            WHERE pt.status = 'open'
            ORDER BY pt.recommended_date DESC, pt.recommended_rank
            """,
        ).fetchall()
    return [dict(r) for r in rows]


def get_performance_summary() -> Dict[str, Any]:
    """전체 성과 요약 (총 건수, 승률, 평균 수익률, best/worst, 최근 20건)."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        total = conn.execute("SELECT COUNT(*) FROM paper_trades").fetchone()[0]
        status_counts = dict(
            conn.execute(
                "SELECT status, COUNT(*) FROM paper_trades GROUP BY status"
            ).fetchall()
        )

        perf = conn.execute(
            """
            SELECT
                COUNT(*),
                SUM(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END),
                ROUND(AVG(return_pct), 2),
                ROUND(SUM(return_pct), 2),
                ROUND(AVG(holding_days), 1)
            FROM paper_trades WHERE status = 'closed'
            """,
        ).fetchone()

        best = conn.execute(
            """
            SELECT pt.symbol, s.name, pt.return_pct FROM paper_trades pt
            LEFT JOIN stocks s ON pt.symbol = s.symbol
            WHERE pt.status = 'closed' ORDER BY pt.return_pct DESC LIMIT 1
            """,
        ).fetchone()

        worst = conn.execute(
            """
            SELECT pt.symbol, s.name, pt.return_pct FROM paper_trades pt
            LEFT JOIN stocks s ON pt.symbol = s.symbol
            WHERE pt.status = 'closed' ORDER BY pt.return_pct ASC LIMIT 1
            """,
        ).fetchone()

        recent_rows = conn.execute(
            """
            SELECT pt.*, s.name FROM paper_trades pt
            LEFT JOIN stocks s ON pt.symbol = s.symbol
            ORDER BY pt.updated_at DESC LIMIT 20
            """,
        ).fetchall()
        recent_trades = [dict(r) for r in recent_rows]

    closed_cnt = perf[0] or 0
    win_count = perf[1] or 0

    return {
        "total_trades":     total,
        "open_trades":      status_counts.get("open", 0),
        "closed_trades":    status_counts.get("closed", 0),
        "expired_trades":   status_counts.get("expired", 0),
        "win_count":        win_count,
        "win_rate":         round(win_count / closed_cnt, 4) if closed_cnt else None,
        "avg_return_pct":   perf[2],
        "total_return_pct": perf[3],
        "avg_holding_days": perf[4],
        "best_trade":  {"symbol": best["symbol"],  "name": best["name"],  "return_pct": best["return_pct"]}  if best  else None,
        "worst_trade": {"symbol": worst["symbol"], "name": worst["name"], "return_pct": worst["return_pct"]} if worst else None,
        "recent_trades": recent_trades,
    }

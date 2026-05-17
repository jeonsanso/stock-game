"""
상위 200종목 빠른 수집 (KOSPI 100 + KOSDAQ 100, 1년치 OHLCV)
시간: ~3-5분
"""

import sys
import time
import logging
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from pykrx import stock as krx
from tqdm import tqdm

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from db import init_db, upsert_stocks, insert_prices

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("quick_collect.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

TOP_N        = 100    # KOSPI/KOSDAQ 각각
THREAD_WORKERS = 8
API_DELAY    = 0.1

NAVER_M_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://m.stock.naver.com/",
}


def today_str() -> str:
    return date.today().strftime("%Y%m%d")


def start_1y() -> str:
    return (date.today() - timedelta(days=365)).strftime("%Y%m%d")


def get_top_tickers_naver(market_code: int, market_name: str, top_n: int) -> list[dict]:
    """Naver Finance 시총순 목록에서 상위 N개 종목 수집 (시총 내림차순 정렬)"""
    tickers: list[str] = []
    for page in range(1, (top_n // 50) + 3):
        try:
            r = requests.get(
                "https://finance.naver.com/sise/sise_market_sum.naver",
                params={"sosok": market_code, "page": page},
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://finance.naver.com/",
                },
                timeout=15,
            )
            import re
            codes = re.findall(r"code=(\d{6})", r.text)
            if not codes:
                break
            for code in codes:
                if code not in tickers:
                    tickers.append(code)
            if len(tickers) >= top_n:
                break
            time.sleep(0.15)
        except Exception as exc:
            logger.warning("Naver %s p%d 오류: %s", market_name, page, exc)
            break

    tickers = tickers[:top_n]
    logger.info("%s 상위 %d종목 선정 완료", market_name, len(tickers))
    return [{"symbol": t, "name": t, "market": market_name, "sector": None} for t in tickers]


def fetch_stock_name(code: str) -> str:
    try:
        r = requests.get(
            f"https://m.stock.naver.com/api/stock/{code}/basic",
            headers=NAVER_M_HEADERS,
            timeout=10,
        )
        d = r.json()
        return d.get("stockName") or d.get("reutersCode") or code
    except Exception:
        return code


def collect_ohlcv(symbol: str, start: str, end: str) -> list[dict]:
    try:
        df = krx.get_market_ohlcv_by_date(start, end, symbol)
        if df is None or df.empty:
            return []
        records = []
        for dt, row in df.iterrows():
            records.append({
                "symbol":     symbol,
                "date":       dt.strftime("%Y%m%d"),
                "open":       int(row.get("시가", 0) or 0),
                "high":       int(row.get("고가", 0) or 0),
                "low":        int(row.get("저가", 0) or 0),
                "close":      int(row.get("종가", 0) or 0),
                "volume":     int(row.get("거래량", 0) or 0),
                "market_cap": None,
            })
        time.sleep(API_DELAY)
        return records
    except Exception as exc:
        logger.debug("OHLCV 오류 [%s]: %s", symbol, exc)
        return []


def main():
    start = start_1y()
    end   = today_str()
    logger.info("빠른 수집 시작: %s ~ %s (KOSPI %d + KOSDAQ %d)", start, end, TOP_N, TOP_N)

    # 1. DB 초기화
    init_db()

    # 2. 시총 상위 종목 선정 (Naver 시총순)
    kospi  = get_top_tickers_naver(0, "KOSPI",  TOP_N)
    kosdaq = get_top_tickers_naver(1, "KOSDAQ", TOP_N)
    all_stocks = kospi + kosdaq
    logger.info("총 %d개 종목 대상", len(all_stocks))

    # 3. 종목명 보완 (pykrx에서 못 가져온 경우)
    missing_name = [s for s in all_stocks if s["name"] == s["symbol"]]
    if missing_name:
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {pool.submit(fetch_stock_name, s["symbol"]): s for s in missing_name}
            for f in as_completed(futures):
                s = futures[f]
                try:
                    s["name"] = f.result()
                except Exception:
                    pass

    # 4. 종목 마스터 저장
    upsert_stocks(all_stocks)
    logger.info("종목 마스터 저장 완료")

    # 5. OHLCV 병렬 수집
    symbols = [s["symbol"] for s in all_stocks]
    total_rows = 0

    with ThreadPoolExecutor(max_workers=THREAD_WORKERS) as pool:
        futures = {
            pool.submit(collect_ohlcv, sym, start, end): sym
            for sym in symbols
        }
        for f in tqdm(as_completed(futures), total=len(futures), desc="OHLCV", unit="종목"):
            sym = futures[f]
            try:
                records = f.result()
                if records:
                    insert_prices(records)
                    total_rows += len(records)
            except Exception as exc:
                logger.error("저장 오류 [%s]: %s", sym, exc)

    logger.info("수집 완료: 총 %d행 저장", total_rows)

    # 6. 결과 확인
    import sqlite3
    from db import DB_PATH
    with sqlite3.connect(DB_PATH) as conn:
        stocks_cnt = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        prices_cnt = conn.execute("SELECT COUNT(*) FROM prices").fetchone()[0]
        mn, mx = conn.execute("SELECT MIN(date), MAX(date) FROM prices").fetchone()
    print(f"\n종목: {stocks_cnt}개 / 가격행: {prices_cnt:,}행 / 기간: {mn} ~ {mx}")


if __name__ == "__main__":
    main()

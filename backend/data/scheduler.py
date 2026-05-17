"""
매일 오후 4시 자동 실행 스케줄러
장 마감(15:30) 이후 데이터가 확정되므로 16:00에 수집

실행 방법:
  python scheduler.py                  # 포그라운드 실행
  python scheduler.py --run-now        # 즉시 한 번 실행 후 대기
  python scheduler.py --run-now --once # 즉시 한 번 실행 후 종료
"""

import logging
import argparse
import signal
import sys
from datetime import datetime, time as dtime

import schedule
import time as time_module

from collector import collect_incremental
from index_collector import collect_index_incremental

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("scheduler.log", encoding="utf-8"),
    ],
)

SCHEDULE_TIME = "16:00"   # 24시간 형식


def job():
    """스케줄러 실행 단위: 오늘치 증분 수집 (종목 OHLCV + 지수)"""
    today = datetime.now().strftime("%Y%m%d")
    logger.info("스케줄 작업 시작: %s", today)
    try:
        # 1. 종목 OHLCV / 펀더멘털 / 수급
        collect_incremental()
        # 2. KOSPI / KOSDAQ 지수 일봉
        collect_index_incremental()
        logger.info("스케줄 작업 완료: %s", today)
    except Exception as exc:
        logger.error("스케줄 작업 오류: %s", exc, exc_info=True)


def is_weekday() -> bool:
    return datetime.now().weekday() < 5   # 월(0)~금(4)


def job_with_weekday_check():
    if not is_weekday():
        logger.info("주말 — 수집 스킵")
        return
    job()


def run_scheduler(run_now: bool = False, once: bool = False):
    logger.info("스케줄러 시작 | 실행 시각: 매일(평일) %s", SCHEDULE_TIME)

    if run_now:
        logger.info("즉시 실행 옵션 감지 → 지금 바로 수집")
        job()
        if once:
            logger.info("--once 옵션 → 종료")
            return

    schedule.every().day.at(SCHEDULE_TIME).do(job_with_weekday_check)

    # SIGTERM/SIGINT 처리 (컨테이너/서비스 종료 대응)
    def _shutdown(signum, frame):
        logger.info("종료 신호 수신 (%s) → 스케줄러 중지", signum)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    logger.info("대기 중... (다음 실행: %s)", SCHEDULE_TIME)
    while True:
        schedule.run_pending()
        time_module.sleep(30)   # 30초마다 스케줄 확인


def main():
    global SCHEDULE_TIME
    parser = argparse.ArgumentParser(description="주식 데이터 수집 스케줄러")
    parser.add_argument(
        "--run-now", action="store_true",
        help="시작 시 즉시 수집 후 스케줄 대기"
    )
    parser.add_argument(
        "--once", action="store_true",
        help="--run-now와 함께 사용: 한 번 실행 후 종료"
    )
    parser.add_argument(
        "--time", type=str, default=SCHEDULE_TIME,
        help=f"실행 시각 (기본: {SCHEDULE_TIME})"
    )
    args = parser.parse_args()
    SCHEDULE_TIME = args.time

    run_scheduler(run_now=args.run_now, once=args.once)


if __name__ == "__main__":
    main()

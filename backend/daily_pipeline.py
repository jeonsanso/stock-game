"""
일일 증분 파이프라인: 오늘치 데이터 수집 → 피처 업데이트 → 서버 재시작
평일 16:30 자동 실행 (Task Scheduler 또는 수동 실행 모두 가능)

실행법:
  python daily_pipeline.py            # 바로 실행
  python daily_pipeline.py --dry-run  # 실행 없이 단계만 출력

소요 시간: 약 10~20분 (종목 수에 따라 다름)
로그: backend/pipeline_daily.log
"""

import argparse
import logging
import socket
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path

ROOT     = Path(__file__).parent
DATA_DIR = ROOT / "data"
FEAT_DIR = ROOT / "features"
SRV_DIR  = ROOT / "server"
LOG_FILE = ROOT / "pipeline_daily.log"
PYTHON   = DATA_DIR / ".venv" / "Scripts" / "python.exe"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def _sep(label: str) -> None:
    log.info("=" * 60)
    log.info("  %s", label)
    log.info("=" * 60)


def run(cmd: list, cwd: Path, label: str, dry_run: bool = False) -> None:
    full_cmd = [str(PYTHON)] + [str(c) for c in cmd]
    log.info("[실행] %s", " ".join(full_cmd))
    if dry_run:
        log.info("[DRY-RUN] 건너뜀")
        return
    t0 = time.time()
    proc = subprocess.Popen(
        full_cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    for line in proc.stdout:
        log.info("[%s] %s", label, line.rstrip())
    proc.wait()
    elapsed = time.time() - t0
    if proc.returncode != 0:
        log.error("%s 실패 (exit=%d, %.0fs)", label, proc.returncode, elapsed)
        sys.exit(proc.returncode)
    log.info("%s 완료 (%.0fs)", label, elapsed)


SERVER_PORT = 8001


def kill_port(port: int) -> None:
    subprocess.run(
        [
            "powershell", "-Command",
            f"$p=Get-NetTCPConnection -LocalPort {port} -State Listen -EA SilentlyContinue;"
            "if($p){Stop-Process -Id $p.OwningProcess -Force -EA SilentlyContinue;"
            "Write-Output 'Killed'}",
        ],
        capture_output=True,
    )
    time.sleep(2)


def restart_server(dry_run: bool = False) -> None:
    _sep(f"3단계: 서버 재시작 (포트 {SERVER_PORT})")
    if dry_run:
        log.info("[DRY-RUN] 서버 재시작 건너뜀")
        return

    kill_port(SERVER_PORT)
    log.info("기존 서버 종료 완료 — 새 프로세스로 시작합니다")

    subprocess.Popen(
        [str(PYTHON), "-m", "uvicorn", "main:app", "--port", str(SERVER_PORT)],
        cwd=str(SRV_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )

    for attempt in range(15):
        time.sleep(3)
        try:
            with socket.create_connection(("127.0.0.1", SERVER_PORT), timeout=3):
                log.info("서버 응답 확인 (시도 %d)", attempt + 1)
                break
        except OSError:
            pass
    else:
        log.warning("헬스체크 실패 — 서버 로그 확인: backend/server/server.log")


def is_weekday() -> bool:
    return datetime.now().weekday() < 5


def main() -> None:
    parser = argparse.ArgumentParser(description="일일 증분 파이프라인")
    parser.add_argument("--dry-run", action="store_true", help="실행 없이 단계만 출력")
    parser.add_argument(
        "--force-weekend", action="store_true",
        help="주말에도 강제 실행 (테스트용)"
    )
    args = parser.parse_args()

    if not is_weekday() and not args.force_weekend:
        log.info("주말 — 일일 파이프라인 스킵 (--force-weekend 로 강제 실행 가능)")
        return

    today = date.today().strftime("%Y%m%d")
    log.info("")
    log.info("=== 일일 증분 파이프라인 시작: %s ===", today)
    if args.dry_run:
        log.info("[DRY-RUN 모드]")

    # 1. 오늘치 데이터만 증분 수집 (INSERT OR IGNORE — 중복 안전)
    _sep("1단계: 오늘치 데이터 증분 수집")
    run(["collector.py"], cwd=DATA_DIR, label="수집", dry_run=args.dry_run)

    # 2. 마지막 피처 날짜 이후만 피처 계산 (자동 증분)
    _sep("2단계: 피처 증분 업데이트")
    run(["pipeline.py"], cwd=FEAT_DIR, label="피처", dry_run=args.dry_run)

    # 3. 서버 재시작 (새 피처 반영 + lifespan에서 record_recommendations 자동 호출)
    restart_server(dry_run=args.dry_run)

    # 4. 모의투자 만기 거래 청산 (lifespan 실패 시 보험)
    _sep("4단계: 모의투자 만기 거래 청산")
    if args.dry_run:
        log.info("[DRY-RUN] close_expired_trades(%s) 건너뜀", today)
    else:
        try:
            sys.path.insert(0, str(SRV_DIR))
            from paper_trader import close_expired_trades  # type: ignore[import]
            result = close_expired_trades(today)
            log.info("청산 완료: closed=%d expired=%d", result["closed"], result["expired"])
        except Exception as exc:
            log.error("모의투자 청산 오류 (비치명적): %s", exc)

    log.info("")
    log.info("=== 일일 파이프라인 완료: %s ===", today)
    log.info("로그: %s", LOG_FILE)


if __name__ == "__main__":
    main()

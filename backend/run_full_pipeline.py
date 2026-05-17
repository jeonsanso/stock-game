"""
전체 파이프라인: 전종목 3년치 수집 → 피처 → 학습 → 서버 교체
백그라운드 실행용 스크립트

실행법:
  python run_full_pipeline.py            # 전체 재학습 (50 trials, ~9분)
  python run_full_pipeline.py --quick    # 빠른 재학습 (15 trials, 수집 스킵, ~2-3분)

로그: backend/pipeline_full.log
"""

import argparse
import logging
import subprocess
import sys
import time
import socket

# Windows cp949 콘솔에서 UTF-8 문자 출력 시 UnicodeEncodeError 방지
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from datetime import date, timedelta
from pathlib import Path

# ── 경로 설정 ──────────────────────────────────────────────────
ROOT      = Path(__file__).parent          # backend/
DATA_DIR  = ROOT / "data"
FEAT_DIR  = ROOT / "features"
ML_DIR    = ROOT / "ml"
SRV_DIR   = ROOT / "server"
LOG_FILE  = ROOT / "pipeline_full.log"

START_DATE   = (date.today() - timedelta(days=3 * 365)).strftime("%Y%m%d")
END_DATE     = date.today().strftime("%Y%m%d")
TRIALS_FULL  = 50
TRIALS_QUICK = 15
VAL_DAYS     = 252  # 1년치 검증 (target_5d 기준)

# ── 로거 설정 ──────────────────────────────────────────────────
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


def run(cmd: list[str], cwd: Path, label: str) -> None:
    """서브프로세스 실행 — stdout/stderr 실시간 로그에 기록"""
    log.info("[실행] %s", " ".join(str(c) for c in cmd))
    t0 = time.time()
    proc = subprocess.Popen(
        [sys.executable] + [str(c) for c in cmd],
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
VENV_PYTHON = ROOT / "data" / ".venv" / "Scripts" / "python.exe"
SERVER_DIR  = ROOT / "server"


def kill_port(port: int) -> None:
    """지정 포트의 Listen 프로세스를 PowerShell로 종료"""
    import subprocess as sp
    sp.run(
        ["powershell", "-Command",
         f"$p=Get-NetTCPConnection -LocalPort {port} -State Listen -EA SilentlyContinue;"
         "if($p){Stop-Process -Id $p.OwningProcess -Force -EA SilentlyContinue;"
         "Write-Output 'Killed'}"],
        capture_output=True,
    )
    time.sleep(2)


def restart_server() -> None:
    """기존 서버(8001) 종료 후 새 모델로 재시작"""
    _sep("5단계: 서버 재시작")
    kill_port(SERVER_PORT)
    log.info("기존 서버 종료 완료 — 새 모델로 재시작합니다")

    subprocess.Popen(
        [str(VENV_PYTHON), "-m", "uvicorn", "main:app", "--port", str(SERVER_PORT)],
        cwd=str(SERVER_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    log.info("서버 프로세스 기동 (포트 %d)", SERVER_PORT)

    # 헬스체크
    for attempt in range(15):
        time.sleep(3)
        try:
            with socket.create_connection(("127.0.0.1", SERVER_PORT), timeout=3):
                log.info("서버 응답 확인 (시도 %d)", attempt + 1)
                break
        except OSError:
            pass
    else:
        log.warning("헬스체크 실패 — 서버 로그 확인")


# ── 메인 ──────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="전체 재학습 파이프라인")
    parser.add_argument("--quick", action="store_true",
                        help="빠른 재학습: 데이터 수집 스킵 + 15 trials (~2-3분)")
    args = parser.parse_args()

    trials = TRIALS_QUICK if args.quick else TRIALS_FULL
    mode   = "빠른 재학습" if args.quick else "전체 재학습"

    log.info("")
    log.info("★★★ %s 파이프라인 시작 ★★★", mode)
    log.info("기간: %s ~ %s | trials=%d | val_days=%d", START_DATE, END_DATE, trials, VAL_DAYS)
    log.info("")

    if not args.quick:
        # 1. 전종목 3년치 OHLCV 수집
        _sep("1단계: 전종목 데이터 수집 (3년)")
        run(
            ["collector.py", "--start", START_DATE, "--end", END_DATE],
            cwd=DATA_DIR,
            label="수집",
        )

        # 2. DB 상태 확인
        _sep("2단계: DB 확인")
        run(["check_db.py"], cwd=DATA_DIR, label="DB체크")
    else:
        log.info("[빠른 재학습] 데이터 수집 스킵 — 일일 파이프라인이 최신 데이터를 이미 수집함")

    # 3. 피처 엔지니어링 (증분 — 새 날짜만 계산)
    _sep("3단계: 피처 엔지니어링")
    run(["pipeline.py"], cwd=FEAT_DIR, label="피처")

    # 4. 모델 학습
    _sep(f"4단계: 모델 학습 ({trials} trials)")
    run(
        ["train.py", "--target", "target_5d", "--trials", str(trials),
         "--val-days", str(VAL_DAYS)],
        cwd=ML_DIR,
        label="학습",
    )

    # 5. 서버 재시작
    restart_server()

    log.info("")
    log.info("★★★ %s 파이프라인 완료 ★★★", mode)
    log.info("로그: %s", LOG_FILE)


if __name__ == "__main__":
    main()

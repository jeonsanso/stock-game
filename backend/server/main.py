"""
FastAPI 주식 예측 서버

실행:
  cd backend/server
  uvicorn main:app --port 8001
"""

import logging
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import lightgbm as lgb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from concentration_filter import RecommendationLog, filter_cooldown
from disclosure_analysis import analyze_risks
from disclosure_filter import filter_risky_predictions
from paper_trader import (
    record_recommendations,
    close_expired_trades,
    get_active_trades_enriched,
    get_performance_summary as paper_performance_summary,
)
from predictor import (
    find_latest_model_dir,
    get_latest_feature_date,
    get_market_trend,
    load_backtest_data,
    load_model,
    load_model_info,
    predict_ticker,
    predict_today,
)

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


# ── 앱 상태 ───────────────────────────────────────────────────

BACKEND_ROOT = Path(__file__).parent.parent
DB_PATH = BACKEND_ROOT / "data" / "stocks.db"

class _State:
    booster: Optional[lgb.Booster] = None
    model_dir: Optional[Path] = None
    latest_date: Optional[str] = None
    predictions_cache: Dict[str, Any] = {}
    excluded_cache: Dict[str, Any] = {}
    # 시장 추세 캐시 (날짜별 1회 계산)
    market_trend_cache: Optional[Dict[str, Any]] = None
    market_trend_date: Optional[str] = None
    # 재학습 프로세스 추적
    retrain_proc: Optional[subprocess.Popen] = None
    retrain_started_at: Optional[float] = None
    retrain_log: List[str] = []

_state = _State()

# 추천 로그 싱글톤 (서버 재시작 후에도 파일 유지)
_rec_log = RecommendationLog()
# 이미 로그에 기록된 날짜 추적 (동일 날짜 중복 쓰기 방지)
_logged_dates: set[str] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("서버 시작 — 모델 로드 중...")
    try:
        _state.booster, _state.model_dir = load_model("target_5d")
        _state.latest_date = get_latest_feature_date()
        logger.info(
            "모델 로드 완료 | dir=%s | 최신 피처 날짜=%s",
            _state.model_dir.name, _state.latest_date,
        )
        # 최신 날짜 예측을 서버 시작 시 미리 계산 (첫 요청 빠르게)
        try:
            preds = predict_today(_state.booster, _state.latest_date, top_n=100)
            filtered, excluded = filter_risky_predictions(preds, days=14)
            _state.predictions_cache[_state.latest_date] = filtered
            _state.excluded_cache[_state.latest_date] = excluded
            logger.info("공시 필터 적용: 통과 %d / 제외 %d", len(filtered), len(excluded))
            logger.info("예측 캐시 완료: %d종목", len(_state.predictions_cache[_state.latest_date]))
        except Exception as e:
            logger.warning("예측 캐시 실패: %s", e)
    except Exception as exc:
        logger.warning("모델 로드 실패 (예측 엔드포인트 사용 불가): %s", exc)

    # 모의투자: 경과 거래 자동 청산
    try:
        from datetime import date as _date
        _today = _date.today().strftime("%Y%m%d")
        result = close_expired_trades(_today)
        logger.info("모의투자 자동 청산: closed=%d expired=%d", result["closed"], result["expired"])
    except Exception as exc:
        logger.warning("모의투자 자동 청산 실패: %s", exc)

    # 모의투자: 오늘 추천 자동 기록 (캐시 있을 때만, UNIQUE로 중복 스킵)
    if _state.latest_date and _state.predictions_cache.get(_state.latest_date):
        try:
            top10 = _state.predictions_cache[_state.latest_date][:10]
            inserted = record_recommendations(_state.latest_date, top10)
            logger.info("모의투자 자동 기록: %s → %d건 삽입", _state.latest_date, inserted)
        except Exception as exc:
            logger.warning("모의투자 자동 기록 실패: %s", exc)

    yield


app = FastAPI(
    title="Stock Prediction API",
    description="LightGBM 기반 한국 주식 상승 확률 예측",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── 헬퍼 ─────────────────────────────────────────────────────

def _require_model() -> None:
    if _state.booster is None:
        raise HTTPException(status_code=503, detail="모델이 로드되지 않았습니다. 먼저 train.py를 실행하세요.")


def _get_date(date: Optional[str]) -> str:
    """?date= 파라미터가 없으면 최신 피처 날짜 사용."""
    if date:
        return date
    if _state.latest_date:
        return _state.latest_date
    return get_latest_feature_date()


def _get_market_trend_cached(target_date: str) -> Dict[str, Any]:
    """날짜가 바뀔 때만 재계산, 이외에는 캐시 반환."""
    if _state.market_trend_cache is None or _state.market_trend_date != target_date:
        _state.market_trend_cache = get_market_trend(days=30)
        _state.market_trend_date = target_date
    return _state.market_trend_cache


def _compute_market_mode(market: Dict[str, Any]) -> tuple:
    """trend → (mode, message, threshold, max_count). max_count=0은 제한 없음."""
    trend = market.get("trend", "unknown")
    if trend == "bear":
        return (
            "defensive",
            "약세장 감지 - 방어 모드 활성화 (확신도 높은 종목 최대 5개)",
            0.7,
            5,
        )
    if trend == "sideways":
        return (
            "cautious",
            "횡보장 진행 중 - 강한 신호 종목만 표시 (최대 15개)",
            0.6,
            15,
        )
    return ("aggressive", "", 0.0, 0)


# ── 엔드포인트 ────────────────────────────────────────────────

@app.get(
    "/api/predictions/today",
    summary="오늘 기준 상위 종목 예측",
    response_description="상위 N종목 목록 (확률 + SHAP 주요 피처)",
)
async def get_today_predictions(
    top_n: int = Query(default=30, ge=1, le=100, description="반환할 종목 수"),
    shap_k: int = Query(default=6, ge=1, le=20, description="종목별 SHAP 피처 수"),
    date: Optional[str] = Query(default=None, description="기준일 YYYYMMDD (미지정=최신)"),
) -> Dict[str, Any]:
    _require_model()
    target_date = _get_date(date)

    # 1단계: 공시 필터 후 전체 리스트 캐시 (top_n 미적용)
    cached = _state.predictions_cache.get(target_date)
    if cached is not None:
        all_predictions = cached
    else:
        raw = predict_today(_state.booster, target_date, top_n=100, shap_top_k=shap_k)
        all_predictions, excluded = filter_risky_predictions(raw, days=14)
        _state.predictions_cache[target_date] = all_predictions
        _state.excluded_cache[target_date] = excluded

    # 2단계: 쿨다운 필터 (최근 5거래일 추천 종목 재진입 차단)
    predictions, excl_cooldown = filter_cooldown(
        all_predictions, _rec_log, cooldown_days=5, today=target_date
    )

    # 3단계: 시장 국면 필터 (threshold + max_count)
    market = _get_market_trend_cached(target_date)
    mode, message, threshold, max_count = _compute_market_mode(market)

    if threshold > 0:
        predictions = [p for p in predictions if p["probability"] >= threshold]

    # 4단계: top_n 자르기 (시장 국면 max_count도 함께 적용)
    effective_n = min(top_n, max_count) if max_count > 0 else top_n
    predictions = predictions[:effective_n]

    # 최신 날짜 추천만 로그에 기록 (역사적 날짜 쿼리는 제외)
    if target_date == _state.latest_date and target_date not in _logged_dates:
        _rec_log.append(target_date, [p["symbol"] for p in predictions])
        _logged_dates.add(target_date)

    excluded_with_analysis = [
        {**ex, "analysis": analyze_risks(ex.get("risks", []))}
        for ex in _state.excluded_cache.get(target_date, [])
    ]

    return {
        "date":               target_date,
        "total_stocks":       len(predictions),
        "predictions":        predictions,
        "excluded":           excluded_with_analysis,
        "excluded_cooldown":  excl_cooldown,
        "market_mode":        mode,
        "market_message":     message,
        "threshold_applied":  threshold,
    }


@app.get(
    "/api/predictions/{ticker}",
    summary="특정 종목 상세 분석",
    response_description="확률, 전체 SHAP, 가격 히스토리, 최근 피처값",
)
async def get_ticker_prediction(
    ticker: str,
    date: Optional[str] = Query(default=None, description="기준일 YYYYMMDD (미지정=최신)"),
    price_days: int = Query(default=60, ge=10, le=250, description="가격 히스토리 일수"),
) -> Dict[str, Any]:
    _require_model()
    target_date = _get_date(date)
    result = predict_ticker(_state.booster, ticker, target_date, price_days=price_days)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"종목 {ticker}의 피처 없음 (date={target_date}). 피처 파이프라인을 먼저 실행하세요.",
        )
    return result


@app.get(
    "/api/backtest/performance",
    summary="백테스트 성과",
    response_description="누적 수익률, 일별 수익률, Sharpe, MDD, Win Rate",
)
async def get_backtest_performance() -> Dict[str, Any]:
    _require_model()
    meta      = load_model_info(_state.model_dir)
    backtest  = load_backtest_data(_state.model_dir, meta.get("target_col", "target_1d"))
    return {
        "model_version":     meta.get("version"),
        "target_col":        meta.get("target_col"),
        "trained_at":        meta.get("trained_at"),
        "val_auc":           meta.get("val_auc"),
        "precision_at_topk": meta.get("precision_at_topk"),
        "backtest":          backtest,  # None이면 train 후 재실행 필요
    }


@app.get(
    "/api/model/info",
    summary="모델 정보",
    response_description="버전, 학습일, AUC, 피처 목록 등 메타 정보",
)
async def get_model_info() -> Dict[str, Any]:
    _require_model()
    return load_model_info(_state.model_dir)


@app.get("/api/market/trend", summary="시장 추세")
async def market_trend_endpoint() -> Dict[str, Any]:
    """최근 20거래일 유동성 종목 중앙값 수익률 기반 시장 추세 (강세/횡보/약세)."""
    target_date = _get_date(None)
    return _get_market_trend_cached(target_date)


@app.get("/api/daily/summary", summary="일일 아침 요약")
async def daily_summary() -> Dict[str, Any]:
    """시장 상황 + 오늘의 상위 3종목 + 신뢰도 한줄 요약."""
    _require_model()
    target_date = _get_date(None)
    cached = _state.predictions_cache.get(target_date, [])
    top3 = cached[:3]
    market = _get_market_trend_cached(target_date)

    if market["trend"] == "bear":
        caution = "약세장 진행 중 — 추천 신호 신뢰도 낮음. 포지션 최소화 권장."
        model_conf = "낮음"
    elif market["trend"] == "bull":
        caution = "강세장 진행 중 — 추천 신호 활용도 양호."
        model_conf = "높음"
    else:
        caution = "횡보장 — 종목 선별 신중, 손절 기준 미리 설정 권장."
        model_conf = "보통"

    return {
        "date":             target_date,
        "market":           market,
        "top3":             top3,
        "model_confidence": model_conf,
        "caution":          caution,
    }


@app.get("/api/candles/{symbol}", summary="종목 일봉 캔들 데이터")
async def get_candles(
    symbol: str,
    days: int = Query(default=365, ge=30, le=730, description="조회 일수"),
) -> List[Dict]:
    """prices 테이블에서 OHLCV 일봉을 반환. time은 UTC 자정 Unix 초."""
    code = symbol.split(".")[0]
    if not DB_PATH.exists():
        raise HTTPException(status_code=503, detail="DB 파일 없음")
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT date, open, high, low, close, volume FROM prices "
            "WHERE symbol = ? ORDER BY date DESC LIMIT ?",
            (code, days),
        ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"종목 {code} 데이터 없음")
    result = []
    for date_str, open_, high, low, close, volume in reversed(rows):
        y, m, d = int(date_str[:4]), int(date_str[4:6]), int(date_str[6:8])
        unix_sec = int(datetime(y, m, d, 0, 0, 0, tzinfo=timezone.utc).timestamp())
        result.append({
            "time": unix_sec,
            "open": float(open_),
            "high": float(high),
            "low": float(low),
            "close": float(close),
            "volume": int(volume) if volume is not None else 0,
        })
    return result


@app.get("/health", summary="헬스 체크")
async def health() -> Dict[str, str]:
    return {
        "status":       "ok" if _state.booster is not None else "no_model",
        "latest_date":  _state.latest_date or "unknown",
        "model_dir":    _state.model_dir.name if _state.model_dir else "none",
    }


# ── 재학습 ────────────────────────────────────────────────────

def _drain_retrain_stdout(proc: subprocess.Popen) -> None:
    """Background thread — continuously drains subprocess pipe so it never deadlocks."""
    try:
        for line in proc.stdout:
            stripped = line.rstrip()
            if stripped:
                _state.retrain_log.append(stripped)
                if len(_state.retrain_log) > 200:
                    _state.retrain_log = _state.retrain_log[-200:]
    except Exception:
        pass


def _retrain_status() -> Dict[str, Any]:
    proc = _state.retrain_proc
    if proc is None:
        return {"status": "idle", "elapsed_sec": None, "log": []}

    elapsed = round(time.time() - (_state.retrain_started_at or 0))
    rc = proc.poll()
    status = "running" if rc is None else ("done" if rc == 0 else "error")

    return {
        "status": status,
        "elapsed_sec": elapsed,
        "return_code": rc,
        "log": _state.retrain_log[-50:],
    }


@app.post("/api/admin/retrain", summary="모델 재학습 시작")
async def start_retrain(
    quick: bool = Query(default=False, description="빠른 재학습: 데이터 수집 스킵 + 15 trials"),
) -> Dict[str, Any]:
    proc = _state.retrain_proc
    if proc is not None and proc.poll() is None:
        raise HTTPException(status_code=409, detail="이미 재학습이 실행 중입니다.")

    pipeline_script = BACKEND_ROOT / "run_full_pipeline.py"
    if not pipeline_script.exists():
        raise HTTPException(status_code=500, detail=f"파이프라인 스크립트를 찾을 수 없음: {pipeline_script}")

    cmd = [sys.executable, str(pipeline_script)]
    if quick:
        cmd.append("--quick")

    mode_label = "빠른 재학습" if quick else "전체 재학습"
    _state.retrain_log = [f"[시작] {mode_label} 파이프라인 실행 중..."]
    _state.retrain_started_at = time.time()
    _state.retrain_proc = subprocess.Popen(
        cmd,
        cwd=str(BACKEND_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    threading.Thread(
        target=_drain_retrain_stdout,
        args=(_state.retrain_proc,),
        daemon=True,
    ).start()
    logger.info("%s 시작 (PID=%d)", mode_label, _state.retrain_proc.pid)
    return {"status": "started", "pid": _state.retrain_proc.pid, "quick": quick}


@app.get("/api/admin/retrain/status", summary="재학습 진행 상태")
async def retrain_status() -> Dict[str, Any]:
    return _retrain_status()


# ── 모의투자 ──────────────────────────────────────────────────

@app.post("/api/paper/record", summary="오늘 추천을 모의투자 테이블에 기록")
async def paper_record(
    date: Optional[str] = Query(default=None, description="기준일 YYYYMMDD (미지정=최신)"),
    top_n: int = Query(default=10, ge=1, le=100, description="기록할 종목 수"),
) -> Dict[str, Any]:
    _require_model()
    target_date = _get_date(date)

    cached = _state.predictions_cache.get(target_date)
    if cached is None:
        raw = predict_today(_state.booster, target_date, top_n=100)
        filtered, excluded = filter_risky_predictions(raw, days=14)
        _state.predictions_cache[target_date] = filtered
        _state.excluded_cache[target_date] = excluded
        cached = filtered

    top = cached[:top_n]
    inserted = record_recommendations(target_date, top)
    return {
        "date":     target_date,
        "inserted": inserted,
        "skipped":  len(top) - inserted,
    }


@app.post("/api/paper/close-expired", summary="5거래일 경과 모의투자 자동 청산")
async def paper_close_expired() -> Dict[str, int]:
    from datetime import date as _date
    today = _state.latest_date or _date.today().strftime("%Y%m%d")
    return close_expired_trades(today)


@app.get("/api/paper/active", summary="현재 보유 중인 모의투자 종목")
async def paper_active() -> List[Dict[str, Any]]:
    from datetime import date as _date
    today = _state.latest_date or _date.today().strftime("%Y%m%d")
    return get_active_trades_enriched(today)


@app.get("/api/paper/performance", summary="모의투자 누적 성과 요약")
async def paper_performance() -> Dict[str, Any]:
    return paper_performance_summary()


_dist = BACKEND_ROOT.parent / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")

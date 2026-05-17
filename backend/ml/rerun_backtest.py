"""
기존 모델로 현실적 비용을 반영해 백테스트 재실행 (재학습 불필요)

실행:
  cd backend/ml
  python rerun_backtest.py --val-days 90
"""

import argparse
import logging
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from dataset import build_dataset
from evaluate import (
    COMMISSION, SELL_TAX, SLIPPAGE, MIN_VOLUME_KRW, LIMIT_UP,
    run_backtest, run_backtest_5d, compute_metrics, precision_at_topk,
)

MODELS_DIR = Path(__file__).parent.parent / "models"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def find_latest_model_dir(target_col: str = "target_1d") -> Path:
    candidates = sorted(MODELS_DIR.glob(f"{target_col}_*/model.lgb"))
    if not candidates:
        raise FileNotFoundError(f"저장된 모델 없음: {target_col}")
    return candidates[-1].parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target",   default="target_1d", choices=["target_1d", "target_5d"])
    parser.add_argument("--val-days", type=int, default=90)
    parser.add_argument("--top-k",    type=int, default=10)
    parser.add_argument("--mode",     default="auto", choices=["auto", "1d", "5d"],
                        help="백테스트 모드: auto=target에 맞춰 자동 선택")
    args = parser.parse_args()

    model_dir = find_latest_model_dir(args.target)
    logger.info("모델 로드: %s", model_dir.name)
    booster = lgb.Booster(model_file=str(model_dir / "model.lgb"))

    logger.info("데이터셋 로드 (val_days=%d)...", args.val_days)
    X_train, y_train, X_val, y_val, val_meta = build_dataset(
        target_col=args.target, val_days=args.val_days
    )
    n_dates = val_meta["date"].nunique()
    logger.info("  val: %d rows / %d dates", len(X_val), n_dates)

    logger.info("예측 실행...")
    val_proba = booster.predict(X_val.values)

    # ── AUC / P@K ──
    metrics = compute_metrics(y_val, val_proba)
    topk    = precision_at_topk(y_val, val_proba, val_meta)
    logger.info(
        "  AUC=%.4f | P@10=%.4f | P@20=%.4f | P@30=%.4f",
        metrics["auc"], topk.get(10, float("nan")),
        topk.get(20, float("nan")), topk.get(30, float("nan")),
    )

    # ── 백테스트 (비용 반영) ──
    use_5d = (args.mode == "5d") or (args.mode == "auto" and args.target == "target_5d")
    logger.info(
        "백테스트 실행 [%s] (top_k=%d, 수수료 %.3f%%×2, 거래세 %.2f%%, 슬리피지 %.1f%%×2, 최소거래대금 %.0f억)...",
        "5D" if use_5d else "1D",
        args.top_k, COMMISSION * 100, SELL_TAX * 100, SLIPPAGE * 100, MIN_VOLUME_KRW / 1e8,
    )
    if use_5d:
        net_cum = run_backtest_5d(
            val_proba, val_meta,
            top_k=args.top_k,
            save_path=model_dir / "backtest_5d_realistic.png",
        )
        json_name = "backtest_5d_data.json"
    else:
        net_cum = run_backtest(
            val_proba, val_meta,
            top_k=args.top_k,
            save_path=model_dir / "backtest_realistic.png",
        )
        json_name = "backtest_data.json"

    if len(net_cum) > 0:
        logger.info("=" * 55)
        logger.info("백테스트 결과 (비용 차감 후)")
        logger.info("  누적수익률: %.2f%%", float(net_cum.iloc[-1]) * 100)
        logger.info("  기간: %s ~ %s (%d구간)", net_cum.index[0], net_cum.index[-1], len(net_cum))
        logger.info("=" * 55)
        logger.info("%s 저장 완료: %s", json_name, model_dir)
    else:
        logger.warning("백테스트 결과 없음 — 데이터를 확인하세요")


if __name__ == "__main__":
    main()

"""
LightGBM 학습 + Optuna 하이퍼파라미터 튜닝

흐름:
  1. build_dataset() → X_train / X_val / val_meta
  2. Optuna: 날짜 기준 TimeSeriesSplit CV로 AUC 최대화
  3. 최적 파라미터로 전체 train 학습 (early stopping)
  4. 검증: AUC, Precision@TopK, 백테스트
  5. models/{target}_{timestamp}/ 에 모델·메타·그래프 저장
"""

import argparse
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Iterator, List, Tuple

import lightgbm as lgb
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import optuna
import pandas as pd
from sklearn.metrics import roc_auc_score

from dataset import FEATURE_COLS, build_dataset
from evaluate import compute_metrics, precision_at_topk, run_backtest, run_backtest_5d

MODELS_DIR = Path(__file__).parent.parent / "models"

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("train.log", encoding="utf-8"),
    ],
)


# ── 날짜 기준 CV (같은 날짜는 항상 같은 파티션) ────────────────

def _date_cv_splits(
    X: pd.DataFrame,
    n_splits: int = 5,
) -> Iterator[Tuple[np.ndarray, np.ndarray]]:
    """
    X의 첫 번째 레벨 정렬(날짜 기준)을 이용한 확장 윈도우 CV.
    X는 (date, symbol) 순으로 정렬되어 있어야 함.
    같은 날짜의 모든 행이 train 또는 val 한 쪽에만 속함.
    """
    n = len(X)
    # 50%~100% 구간을 n_splits 개 fold로 나눔
    fold_size = n // (2 * n_splits)
    base      = n // 2

    for i in range(1, n_splits + 1):
        tr_end = base + fold_size * (i - 1)
        va_end = base + fold_size * i
        if va_end > n:
            va_end = n
        tr_idx = np.arange(0, tr_end)
        va_idx = np.arange(tr_end, va_end)
        if len(tr_idx) > 200 and len(va_idx) > 200:
            yield tr_idx, va_idx


# ── Optuna 목적함수 ────────────────────────────────────────────

def _objective(
    trial: optuna.Trial,
    X_train: pd.DataFrame,
    y_train: pd.Series,
) -> float:
    params = {
        "objective":         "binary",
        "metric":            "auc",
        "verbosity":         -1,
        "n_estimators":      300,
        "num_leaves":        trial.suggest_int("num_leaves", 20, 200),
        "max_depth":         trial.suggest_int("max_depth", 3, 12),
        "learning_rate":     trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
        "subsample":         trial.suggest_float("subsample", 0.5, 1.0),
        "colsample_bytree":  trial.suggest_float("colsample_bytree", 0.5, 1.0),
        "reg_alpha":         trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
        "reg_lambda":        trial.suggest_float("reg_lambda", 1e-8, 10.0, log=True),
    }

    aucs = []
    for fold_i, (tr_idx, va_idx) in enumerate(_date_cv_splits(X_train, n_splits=2)):
        X_t, X_v = X_train.iloc[tr_idx], X_train.iloc[va_idx]
        y_t, y_v = y_train.iloc[tr_idx], y_train.iloc[va_idx]

        spw = (y_t == 0).sum() / max((y_t == 1).sum(), 1)
        mdl = lgb.LGBMClassifier(**params, scale_pos_weight=float(spw), random_state=42)
        mdl.fit(
            X_t, y_t,
            eval_set=[(X_v, y_v)],
            callbacks=[lgb.early_stopping(20, verbose=False), lgb.log_evaluation(-1)],
        )
        proba = mdl.predict_proba(X_v)[:, 1]
        if len(np.unique(y_v)) == 2:
            aucs.append(roc_auc_score(y_v, proba))
        trial.report(float(np.mean(aucs)), step=fold_i)
        if trial.should_prune():
            raise optuna.TrialPruned()

    return float(np.mean(aucs)) if aucs else 0.0


# ── 메인 학습 파이프라인 ───────────────────────────────────────

def train(
    target_col: str = "target_1d",
    n_trials: int = 50,
    val_days: int = 252,
) -> Path:
    """
    전체 학습 파이프라인.
    반환: 저장된 모델 디렉토리 경로.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("학습 시작 | target=%s | trials=%d | val_days=%d",
                target_col, n_trials, val_days)
    logger.info("=" * 60)

    # ── 1. 데이터셋 ──
    logger.info("[1/4] 데이터셋 로드...")
    X_train, y_train, X_val, y_val, val_meta = build_dataset(
        target_col=target_col, val_days=val_days
    )
    spw = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
    logger.info("  train=%d  val=%d  positive=%.1f%%  scale_pos_weight=%.2f",
                len(X_train), len(X_val), 100 * y_train.mean(), spw)

    # ── 2. Optuna 튜닝 ──
    logger.info("[2/4] Optuna 튜닝 (%d trials)...", n_trials)
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction="maximize",
        pruner=optuna.pruners.MedianPruner(n_startup_trials=10, n_warmup_steps=0),
    )
    study.optimize(
        lambda trial: _objective(trial, X_train, y_train),
        n_trials=n_trials,
        show_progress_bar=True,
    )
    best_params = study.best_params
    logger.info("  best_auc_cv=%.4f | params=%s", study.best_value, best_params)

    # ── 3. 최종 모델 학습 (전체 train) ──
    logger.info("[3/4] 최종 모델 학습...")
    final_params = {
        "objective":         "binary",
        "metric":            "auc",
        "verbosity":         -1,
        "n_estimators":      2000,
        "scale_pos_weight":  float(spw),
        "random_state":      42,
        **best_params,
    }
    model = lgb.LGBMClassifier(**final_params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=[lgb.early_stopping(80, verbose=False), lgb.log_evaluation(200)],
    )
    best_iter = model.best_iteration_ if model.best_iteration_ is not None else final_params["n_estimators"]
    logger.info("  best_iteration=%d", best_iter)

    # ── 4. 평가 ──
    logger.info("[4/4] 검증 평가...")
    val_proba = model.predict_proba(X_val)[:, 1]
    metrics   = compute_metrics(y_val, val_proba)
    topk      = precision_at_topk(y_val, val_proba, val_meta)
    logger.info("  AUC=%.4f | P@10=%.4f | P@20=%.4f | P@30=%.4f",
                metrics["auc"], topk.get(10, float("nan")),
                topk.get(20, float("nan")), topk.get(30, float("nan")))

    # ── 5. 저장 ──
    version  = datetime.now().strftime("%Y%m%d_%H%M%S")
    save_dir = MODELS_DIR / f"{target_col}_{version}"
    save_dir.mkdir(parents=True)

    model.booster_.save_model(str(save_dir / "model.lgb"))

    meta = {
        "target_col":        target_col,
        "version":           version,
        "val_auc":           metrics["auc"],
        "precision_at_topk": {str(k): v for k, v in topk.items()},
        "best_params":       best_params,
        "n_estimators_best": int(best_iter),
        "feature_cols":      FEATURE_COLS,
        "train_size":        len(X_train),
        "val_size":          len(X_val),
        "positive_rate":     float(y_train.mean()),
        "scale_pos_weight":  float(spw),
    }
    (save_dir / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    _plot_importance(model, FEATURE_COLS, save_dir / "feature_importance.png")
    if target_col == "target_5d":
        run_backtest_5d(val_proba, val_meta, save_path=save_dir / "backtest_5d.png")
    else:
        run_backtest(val_proba, val_meta, save_path=save_dir / "backtest.png")

    logger.info("=" * 60)
    logger.info("완료 | 저장: %s", save_dir)
    logger.info("=" * 60)
    return save_dir


# ── 피처 중요도 그래프 ─────────────────────────────────────────

def _plot_importance(
    model: lgb.LGBMClassifier,
    feature_cols: List[str],
    save_path: Path,
) -> None:
    imp = (
        pd.DataFrame({"feature": feature_cols, "importance": model.feature_importances_})
        .sort_values("importance", ascending=True)
        .tail(30)
    )
    fig, ax = plt.subplots(figsize=(10, 10))
    ax.barh(imp["feature"], imp["importance"], color="steelblue")
    ax.set_xlabel("Feature Importance (split)")
    ax.set_title("Top 30 Feature Importances")
    plt.tight_layout()
    fig.savefig(save_path, dpi=120, bbox_inches="tight")
    plt.close(fig)


# ── CLI ────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="LightGBM 학습 파이프라인")
    parser.add_argument(
        "--target", choices=["target_1d", "target_5d"], default="target_1d",
        help="학습할 라벨 컬럼",
    )
    parser.add_argument("--trials",   type=int, default=50,  help="Optuna 시도 횟수")
    parser.add_argument("--val-days", type=int, default=252, help="검증 기간 거래일 수")
    args = parser.parse_args()
    train(target_col=args.target, n_trials=args.trials, val_days=args.val_days)


if __name__ == "__main__":
    main()

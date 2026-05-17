"""
DART 공시 기반 위험 종목 필터
- 예측 결과에서 유상증자/감자/CB 발행/거래정지 등 종목 제외
- 우선주(끝자리 5/7/9) → 보통주(끝자리 0) 자동 변환
"""
import sys
import logging
from pathlib import Path

# data 폴더의 disclosure 모듈 import 경로 추가
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from data.disclosure import batch_check_risks

logger = logging.getLogger(__name__)


def _to_common_stock(code: str) -> str:
    """우선주 코드를 보통주 코드로 변환 (DART는 보통주 기준 공시)"""
    if len(code) == 6 and code[-1] in "579":
        return code[:-1] + "0"
    return code


def filter_risky_predictions(predictions, days=14):
    """
    예측 결과에서 위험 공시 보유 종목 제외.
    Returns: (filtered_predictions, excluded_list)
    """
    if not predictions:
        return predictions, []

    symbols = [p["symbol"] for p in predictions if p.get("symbol")]
    dart_map = {s: _to_common_stock(s) for s in symbols}

    try:
        risks = batch_check_risks(list(set(dart_map.values())), days=days)
    except Exception as e:
        logger.warning(f"공시 필터 실패, 필터 미적용: {e}")
        return predictions, []

    filtered, excluded = [], []
    for p in predictions:
        s = p.get("symbol")
        info = risks.get(dart_map.get(s, s), {})
        if info.get("has_risk"):
            excluded.append({"symbol": s, "risks": info["risks"], "rank": p.get("rank")})
        else:
            filtered.append(p)

    if excluded:
        logger.info(f"공시 제외 {len(excluded)}건: {[e['symbol'] for e in excluded]}")

    return filtered, excluded

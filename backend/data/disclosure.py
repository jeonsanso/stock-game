"""
DART OpenAPI 기반 공시 조회 모듈
- 위험 공시(유상증자, 감자, CB/BW 발행, 거래정지 등) 자동 탐지
- AI 추천 종목 필터링용
"""

import io
import json
import logging
import os
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from xml.etree import ElementTree

import requests

try:
    from dotenv import load_dotenv
    BACKEND_DIR = Path(__file__).resolve().parent.parent
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    BACKEND_DIR = Path(__file__).resolve().parent.parent

logger = logging.getLogger(__name__)

DART_API_KEY = os.getenv("DART_API_KEY")
CORP_CODE_CACHE_PATH = BACKEND_DIR / "data" / "corp_code_map.json"

RISK_KEYWORDS = [
    "유상증자",
    "감자결정",
    "감자",
    "전환사채",
    "신주인수권부사채",
    "교환사채",
    "주식관련사채",
    "관리종목",
    "상장폐지",
    "거래정지",
    "횡령",
    "배임",
    "불성실공시",
    "감사의견 거절",
    "감사의견 부적정",
    "감사의견 한정",
]


def download_corp_code_map() -> Dict[str, str]:
    if not DART_API_KEY:
        raise RuntimeError("DART_API_KEY가 .env에 설정되지 않았습니다.")

    url = "https://opendart.fss.or.kr/api/corpCode.xml"
    params = {"crtfc_key": DART_API_KEY}

    logger.info("DART corp_code 매핑 다운로드 중...")
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        xml_data = zf.read("CORPCODE.xml")

    root = ElementTree.fromstring(xml_data)
    mapping = {}
    for item in root.iter("list"):
        stock_code = (item.findtext("stock_code") or "").strip()
        corp_code = (item.findtext("corp_code") or "").strip()
        if stock_code and corp_code:
            mapping[stock_code] = corp_code

    logger.info(f"corp_code 매핑 로드 완료: {len(mapping)}개 상장사")
    return mapping


def load_corp_code_map(force_refresh: bool = False) -> Dict[str, str]:
    cache_path = CORP_CODE_CACHE_PATH

    if not force_refresh and cache_path.exists():
        age_days = (datetime.now().timestamp() - cache_path.stat().st_mtime) / 86400
        if age_days < 7:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)

    mapping = download_corp_code_map()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False)
    return mapping


def fetch_disclosures(corp_code: str, days: int = 14) -> List[Dict]:
    if not DART_API_KEY:
        return []

    end_de = datetime.now().strftime("%Y%m%d")
    bgn_de = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")

    url = "https://opendart.fss.or.kr/api/list.json"
    params = {
        "crtfc_key": DART_API_KEY,
        "corp_code": corp_code,
        "bgn_de": bgn_de,
        "end_de": end_de,
        "page_count": 100,
    }

    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        status = data.get("status")
        if status == "000":
            return data.get("list", [])
        elif status == "013":
            return []
        else:
            logger.warning(f"DART 응답 이상 ({corp_code}): {status} {data.get('message')}")
            return []
    except Exception as e:
        logger.warning(f"DART 공시 조회 실패 ({corp_code}): {e}")
        return []


def detect_risk_disclosures(disclosures: List[Dict]) -> List[Dict]:
    risks = []
    for d in disclosures:
        report_nm = d.get("report_nm", "")
        for kw in RISK_KEYWORDS:
            if kw in report_nm:
                risks.append({
                    "report_nm": report_nm.strip(),
                    "rcept_dt": d.get("rcept_dt", ""),
                    "matched_keyword": kw,
                    "rcept_no": d.get("rcept_no", ""),
                })
                break
    return risks


def check_stock_risk(
    stock_code: str,
    corp_code_map: Optional[Dict[str, str]] = None,
    days: int = 14,
) -> Dict:
    if corp_code_map is None:
        corp_code_map = load_corp_code_map()

    corp_code = corp_code_map.get(stock_code)
    if not corp_code:
        return {"has_risk": False, "risks": [], "checked": False}

    disclosures = fetch_disclosures(corp_code, days=days)
    risks = detect_risk_disclosures(disclosures)

    return {
        "has_risk": len(risks) > 0,
        "risks": risks,
        "checked": True,
    }


def batch_check_risks(stock_codes: List[str], days: int = 14) -> Dict[str, Dict]:
    corp_code_map = load_corp_code_map()
    results = {}
    for code in stock_codes:
        results[code] = check_stock_risk(code, corp_code_map=corp_code_map, days=days)
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    print(f"DART_API_KEY 설정: {'OK' if DART_API_KEY else 'NONE'}")
    print()

    test_codes = {
        "424870": "이뮨온시아",
        "082270": "젬백스",
        "012205": "계양전기우",
        "007610": "선도전기",
        "389470": "인벤티지랩",
    }

    print(f"테스트 종목 {len(test_codes)}개 위험 공시 조회 (최근 14일)")
    print("=" * 60)

    results = batch_check_risks(list(test_codes.keys()), days=14)

    for code, name in test_codes.items():
        result = results[code]
        flag = "[위험]" if result["has_risk"] else "[정상]"
        checked = "" if result["checked"] else " (DART 매핑 없음)"
        print(f"\n{flag} {code} {name}{checked}")
        for risk in result["risks"]:
            print(f"   [{risk['rcept_dt']}] {risk['report_nm']}")

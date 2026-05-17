"""
공시 유형별 주가 영향 분석 — 규칙 기반
severity: critical / high / medium
"""
from typing import Any, Dict, List

KEYWORD_IMPACT: Dict[str, Dict[str, Any]] = {
    "감자결정": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-30% ~ -70%",
        "timing": "공시 당일 즉각 반응",
        "analysis": (
            "발행주식 수를 강제로 줄여 기존 주주의 지분가치를 직접 훼손합니다. "
            "무상감자는 자본금 손실을 의미하며 재무적 위기의 신호입니다. "
            "단기 급락 후 반등 없이 하락 지속 패턴이 많습니다."
        ),
        "rerank_eligible": False,
    },
    "감자": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-20% ~ -60%",
        "timing": "공시 당일 ~ 3일 이내",
        "analysis": (
            "주식 수 감소로 1주당 가치가 명목상 상승하지만, "
            "시장은 재무 불안 신호로 해석해 실제 주가는 하락하는 경우가 많습니다. "
            "감자 목적이 결손보전이면 부실 상태임을 공식 인정하는 것입니다."
        ),
        "rerank_eligible": False,
    },
    "상장폐지": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "폭락",
        "range": "-50% ~ -99%",
        "timing": "즉각",
        "analysis": (
            "상장폐지 결정은 거래소 시장에서의 매매가 중단됨을 의미합니다. "
            "유가증권 회수가 사실상 불가능해지며 투자금 전액 손실 위험이 있습니다. "
            "정리매매 기간 동안 투매가 집중되어 극단적 하락이 발생합니다."
        ),
        "rerank_eligible": False,
    },
    "거래정지": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "거래 재개 후 -20% ~ -50%",
        "timing": "거래 재개 시 즉각",
        "analysis": (
            "거래정지 기간 동안 매도 불가로 손실이 확정된 채 대기하게 됩니다. "
            "거래 재개 후 누적된 매도 물량이 한꺼번에 나와 급락하는 패턴이 일반적입니다. "
            "정지 사유 해소 여부에 따라 회복 가능성이 갈립니다."
        ),
        "rerank_eligible": False,
    },
    "횡령": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-20% ~ -50%",
        "timing": "공시 당일",
        "analysis": (
            "경영진의 횡령은 기업 신뢰도를 근본적으로 훼손합니다. "
            "검찰 수사, 대표이사 구속 등으로 경영 공백이 발생하며 "
            "기관·외국인 투자자가 즉시 이탈하는 패턴을 보입니다."
        ),
        "rerank_eligible": False,
    },
    "배임": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-15% ~ -40%",
        "timing": "공시 당일",
        "analysis": (
            "배임죄는 회사 이익에 반하는 행위로 경영진 리스크가 심각함을 의미합니다. "
            "법적 제재와 함께 기업 가치 재평가가 이뤄지며 단기 급락 후 "
            "수사 진행 상황에 따라 변동성이 지속됩니다."
        ),
        "rerank_eligible": False,
    },
    "관리종목": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-20% ~ -50%",
        "timing": "공시 당일",
        "analysis": (
            "관리종목 지정은 상장폐지 심사 대상임을 의미합니다. "
            "신용거래 불가, 주식담보대출 불가 등 제한이 붙어 수급이 크게 악화됩니다. "
            "지정 사유 해소에 실패하면 상장폐지로 이어질 수 있습니다."
        ),
        "rerank_eligible": False,
    },
    "감사의견 거절": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-30% ~ -70%",
        "timing": "공시 당일",
        "analysis": (
            "회계법인이 재무제표 신뢰성을 확인할 수 없다는 의미입니다. "
            "상장폐지 요건에 해당하며 실질적으로 상장폐지 수순을 밟게 됩니다. "
            "최악의 감사 의견으로 투자자 탈출이 집중됩니다."
        ),
        "rerank_eligible": False,
    },
    "감사의견 부적정": {
        "severity": "critical",
        "severity_label": "매우 위험",
        "direction": "급락",
        "range": "-20% ~ -60%",
        "timing": "공시 당일",
        "analysis": (
            "재무제표가 회계기준을 심각하게 위반했다는 의견입니다. "
            "의견 거절과 함께 최악의 감사의견으로 분류되며 "
            "상장폐지 심사 대상이 됩니다."
        ),
        "rerank_eligible": False,
    },
    "유상증자": {
        "severity": "high",
        "severity_label": "위험",
        "direction": "하락",
        "range": "-5% ~ -20%",
        "timing": "공시 당일 ~ 1주일",
        "analysis": (
            "신주 발행으로 기존 주식의 가치가 희석됩니다. "
            "단기적으로 주가 하락 압력이 발생하며, 모집 목적이 운영자금 보충이면 "
            "부정적, 시설투자·R&D라면 중장기적으로 긍정 반전 가능성이 있습니다. "
            "증자 규모가 시가총액 대비 클수록 하락 폭이 커집니다."
        ),
        "rerank_eligible": True,
    },
    "불성실공시": {
        "severity": "high",
        "severity_label": "위험",
        "direction": "하락",
        "range": "-3% ~ -15%",
        "timing": "공시 당일",
        "analysis": (
            "거래소로부터 공시 의무 불이행 또는 허위공시로 제재를 받은 상태입니다. "
            "투명성 문제가 드러나 기관투자자 이탈이 발생하며 "
            "누적 벌점이 높아지면 관리종목 지정 위험도 있습니다."
        ),
        "rerank_eligible": True,
    },
    "감사의견 한정": {
        "severity": "high",
        "severity_label": "위험",
        "direction": "하락",
        "range": "-5% ~ -20%",
        "timing": "공시 당일 ~ 3일",
        "analysis": (
            "일부 항목에 대해 회계법인이 의견을 표명하지 못한 상태입니다. "
            "전면 부정 의견은 아니지만 재무제표 신뢰성에 의구심이 생기며 "
            "기관·외국인 투자자 이탈로 이어지는 경우가 많습니다."
        ),
        "rerank_eligible": True,
    },
    "전환사채": {
        "severity": "medium",
        "severity_label": "주의",
        "direction": "소폭 하락",
        "range": "-3% ~ -10%",
        "timing": "공시 당일 ~ 3일",
        "analysis": (
            "CB(전환사채)는 채권자가 주식으로 전환 가능한 사채입니다. "
            "전환 시 주식 수가 늘어 희석 효과가 발생하지만, "
            "자금 조달 자체는 기업 운영에 긍정적일 수 있습니다. "
            "전환가액이 현재 주가와 가까울수록 희석 우려가 큽니다."
        ),
        "rerank_eligible": True,
    },
    "신주인수권부사채": {
        "severity": "medium",
        "severity_label": "주의",
        "direction": "소폭 하락",
        "range": "-3% ~ -10%",
        "timing": "공시 당일 ~ 3일",
        "analysis": (
            "BW(신주인수권부사채)는 사채에 신주인수권이 붙은 형태입니다. "
            "신주인수권 행사 시 주식 수가 증가하여 희석이 발생합니다. "
            "전환사채와 유사하나 사채는 그대로 유지된다는 차이가 있으며, "
            "희석 효과는 BW 규모에 비례합니다."
        ),
        "rerank_eligible": True,
    },
    "교환사채": {
        "severity": "medium",
        "severity_label": "주의",
        "direction": "중립~소폭 하락",
        "range": "-2% ~ -8%",
        "timing": "공시 당일",
        "analysis": (
            "EB(교환사채)는 발행사가 보유한 다른 회사 주식으로 교환되는 사채입니다. "
            "CB·BW와 달리 신주 발행이 없어 주식 희석이 없습니다. "
            "단, 보유 주식을 처분한다는 신호로 해석될 수 있어 "
            "시장 상황에 따라 반응이 다양합니다."
        ),
        "rerank_eligible": True,
    },
    "주식관련사채": {
        "severity": "medium",
        "severity_label": "주의",
        "direction": "소폭 하락",
        "range": "-3% ~ -10%",
        "timing": "공시 당일 ~ 3일",
        "analysis": (
            "전환사채·신주인수권부사채·교환사채 등을 통칭하는 표현입니다. "
            "세부 유형에 따라 희석 효과가 다르므로 원문 공시를 통해 "
            "구체적인 전환 조건과 규모를 반드시 확인해야 합니다."
        ),
        "rerank_eligible": True,
    },
}

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2}
_SEVERITY_COLOR = {"critical": "red", "high": "orange", "medium": "yellow"}


def analyze_risks(risks: List[Dict]) -> Dict[str, Any]:
    """
    위험 공시 목록에서 가장 심각한 건을 기준으로 분석 결과 반환.
    """
    if not risks:
        return {}

    best: Dict[str, Any] = {}
    best_order = 99

    for risk in risks:
        kw = risk.get("matched_keyword", "")
        impact = KEYWORD_IMPACT.get(kw)
        if impact is None:
            continue
        order = _SEVERITY_ORDER.get(impact["severity"], 99)
        if order < best_order:
            best_order = order
            best = {**impact, "matched_keyword": kw}

    if not best:
        kw = risks[0].get("matched_keyword", "알 수 없음")
        best = {
            "severity": "high",
            "severity_label": "위험",
            "direction": "하락",
            "range": "불확실",
            "timing": "공시 후 단기",
            "analysis": f"'{kw}' 관련 공시로 단기 하락 압력이 예상됩니다. 공시 원문을 직접 확인하세요.",
            "rerank_eligible": False,
            "matched_keyword": kw,
        }

    best["color"] = _SEVERITY_COLOR.get(best["severity"], "orange")
    return best

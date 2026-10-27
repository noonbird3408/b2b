"""학원 쇼핑몰(제휴몰 모음) — 제휴몰 목록 · 상품 시드 · 과목 감지 · 가격 계산 (DB·FastAPI 와 무관한 순수 로직)

왜 학원 관리 프로그램 안에 쇼핑몰이 있어야 하는가 (학원 운영자 입장)
  1. 구매가 '운영 데이터'와 붙어 있어야 덜 산다·덜 빠뜨린다
     - 재고가 안전 재고 아래로 내려가면, 그 물품을 파는 상품을 바로 보여 준다(재고 관리 → 구매 확인 → 장바구니).
     - 이번 학기 개설한 수업(중등 수학, 파닉스 …)에 맞는 교재·교구를 먼저 추천한다.
  2. 거래처가 여러 곳이어도 장바구니·결제·지출 내역은 한 곳
     - 교재는 서점, 복사지는 문구점, 도복은 체육사 … 따로 주문·정산하던 일을 한 화면에서 끝낸다.
  3. 학원 회원가 — 원장이 '연결'한 제휴몰은 추가 할인, 일정 금액 이상 무료배송
  4. 돈 나가는 결정은 원장만 — 직원은 '결제 요청', 원장이 승인·결제 (구매 통제)
  5. 받은 물건은 '입고 처리' 한 번으로 재고 수량에 반영 → 다음 구매 판단의 근거가 됨

이 파일의 제휴몰·상품은 전시·발표용 '가상' 데이터입니다. 실제 판매처와 연결할 때는
상품 피드(products.json, POST /api/shop/sync)나 제휴몰 API 로 교체하고, 결제는 실제 PG(카카오페이 등)로 바꿉니다.
"""
from __future__ import annotations

import re
from typing import Iterable, List, Optional, Tuple

# ---------------------------------------------------------------------
# 과목 — 수업 이름·설명, 학원 소개, 학원 종류, 원장이 고른 주요 과목에서 감지
# ---------------------------------------------------------------------
SUBJECT_KEYWORDS = {
    "수학": ("수학", "연산", "산수", "미적분", "기하", "확률", "사고력수학", "math"),
    "영어": ("영어", "파닉스", "회화", "토익", "토플", "리딩", "영문법", "영단어", "english"),
    "국어": ("국어", "논술", "독서", "독해", "글쓰기", "한자", "맞춤법"),
    "과학": ("과학", "실험", "물리", "화학", "생명과학", "지구과학"),
    "코딩": ("코딩", "소프트웨어", "파이썬", "스크래치", "엔트리", "로봇", "프로그래밍", "아두이노", "coding"),
    "미술": ("미술", "드로잉", "그림", "디자인", "공예", "수채화", "소묘"),
    "음악": ("음악", "피아노", "바이올린", "첼로", "기타 레슨", "드럼", "성악", "작곡", "플루트"),
    "태권도": ("태권도", "품새", "겨루기", "합기도", "유도", "검도", "주짓수", "무도"),
    "체육": ("체육", "줄넘기", "축구", "농구", "수영", "발레", "댄스", "체조", "클라이밍", "인라인"),
}
SUBJECTS = list(SUBJECT_KEYWORDS)

# 학원 종류 → 기본 과목 (수업이 아직 없을 때의 약한 신호)
FACILITY_TYPE_SUBJECTS = {
    "어학원": ["영어"], "예체능": ["미술", "음악"], "코딩·과학": ["코딩", "과학"],
    "체육관": ["체육"], "도장": ["태권도"],
}

# 감지 근거별 가중치 — 원장이 직접 고른 과목 > 실제 개설 수업 > 학원 소개 > 학원 종류
SOURCE_WEIGHT = {"manual": 3.0, "class": 2.0, "description": 1.0, "type": 0.8}


def detect_subjects(class_texts: Iterable[Tuple[str, str]], description: str = "",
                    facility_type: str = "", manual: Optional[Iterable[str]] = None) -> List[dict]:
    """과목별 점수와 '왜 그렇게 봤는지' 근거를 반환 (점수 높은 순)

    class_texts: (수업 이름, 수업 설명) 목록
    반환: [{"subject": "수학", "score": 4.0, "evidence": "수업 '중등 수학 A'", "classes": 2}]
    """
    found: dict = {}

    def add(subject: str, weight: float, kind: str, label: str = ""):
        row = found.setdefault(subject, {"subject": subject, "score": 0.0, "classes": 0, "_class_names": [], "_kinds": set()})
        row["score"] += weight
        row["_kinds"].add(kind)
        if kind == "class":
            row["classes"] += 1
            row["_class_names"].append(label)
        elif kind == "type":
            row["_type"] = label

    for subject in manual or []:
        if subject in SUBJECT_KEYWORDS:
            add(subject, SOURCE_WEIGHT["manual"], "manual")
    for name, desc in class_texts:
        text = f"{name or ''} {desc or ''}".lower()
        for subject, words in SUBJECT_KEYWORDS.items():
            if any(w.lower() in text for w in words):
                add(subject, SOURCE_WEIGHT["class"], "class", (name or "").strip()[:20])
    text = (description or "").lower()
    for subject, words in SUBJECT_KEYWORDS.items():
        if any(w.lower() in text for w in words):
            add(subject, SOURCE_WEIGHT["description"], "description")
    for subject in FACILITY_TYPE_SUBJECTS.get(facility_type or "", []):
        add(subject, SOURCE_WEIGHT["type"], "type", facility_type)
    rows = sorted(found.values(), key=lambda r: (-r["score"], SUBJECTS.index(r["subject"])))
    for r in rows:
        # 근거 문장: 실제 개설 수업이 가장 설득력 있으므로 먼저, 그다음 원장 선택·학원 소개·학원 종류
        parts = []
        names = r.pop("_class_names")
        if names:
            parts.append(f"수업 '{names[0]}'" if len(names) == 1 else f"수업 {len(names)}개('{names[0]}' 등)")
        kinds = r.pop("_kinds")
        if "manual" in kinds:
            parts.append("원장이 고른 주요 과목")
        if "description" in kinds:
            parts.append("학원 소개 글")
        if "type" in kinds and not parts:
            parts.append(f"학원 종류 '{r.get('_type')}'")
        r.pop("_type", None)
        r["evidence"] = " · ".join(parts[:2])
        r["score"] = round(min(r["score"], 10.0), 1)       # 수업이 아주 많아도 한 과목이 추천을 독차지하지 않게
    return rows


# ---------------------------------------------------------------------
# 제휴몰 (가상) — 학원에 필요한 물건을 파는 곳 단위
#   shipping_fee / free_shipping_over: 제휴몰별 배송비 · 무료배송 기준(할인 후 금액)
#   member_rate: 원장이 '연결'한 경우 추가로 깎아 주는 학원 회원가 비율
# ---------------------------------------------------------------------
MALLS = [
    {"code": "edubooks", "name": "에듀북스", "logo": "📚", "color": "#2563EB",
     "tagline": "교과·어학·코딩 교재와 문제집, 학원 단체 할인",
     "subjects": ["수학", "영어", "국어", "과학", "코딩"], "shipping_fee": 3000, "free_shipping_over": 30000,
     "member_rate": 0.05, "delivery_days": 2},
    {"code": "munguland", "name": "문구나라", "logo": "✏️", "color": "#EA580C",
     "tagline": "복사지·보드마카·출석 스티커 등 모든 학원 공통 소모품",
     "subjects": [], "shipping_fee": 3000, "free_shipping_over": 50000, "member_rate": 0.03, "delivery_days": 1},
    {"code": "makerlab", "name": "메이커랩", "logo": "🤖", "color": "#7C3AED",
     "tagline": "코딩 로봇·과학 실험 키트 등 수업 교구",
     "subjects": ["코딩", "과학", "수학"], "shipping_fee": 3500, "free_shipping_over": 60000, "member_rate": 0.05,
     "delivery_days": 3},
    {"code": "artnmusic", "name": "아트앤뮤직", "logo": "🎨", "color": "#DB2777",
     "tagline": "미술 재료와 악기 소모품(현·리드·악보)",
     "subjects": ["미술", "음악"], "shipping_fee": 3000, "free_shipping_over": 50000, "member_rate": 0.04,
     "delivery_days": 2},
    {"code": "sportsfarm", "name": "스포츠팜", "logo": "🥋", "color": "#16A34A",
     "tagline": "도복·띠·미트·줄넘기 등 태권도·체육 용품",
     "subjects": ["태권도", "체육"], "shipping_fee": 4000, "free_shipping_over": 70000, "member_rate": 0.05,
     "delivery_days": 3},
    {"code": "prizeshop", "name": "상장나라", "logo": "🏅", "color": "#CA8A04",
     "tagline": "상장·트로피·메달·수료 기념품과 홍보물",
     "subjects": [], "shipping_fee": 3000, "free_shipping_over": 40000, "member_rate": 0.03, "delivery_days": 4},
]
MALL_BY_CODE = {m["code"]: m for m in MALLS}
# 기존 DDM(실제 외부 사이트) 상품은 'ddm' 으로 묶어 같은 화면에 보여 줍니다(가격이 없으면 견적 문의).
EXTERNAL_MALL = {"code": "ddm", "name": "DDM", "logo": "🧥", "color": "#475569",
                 "tagline": "단체복·키링·매달 주문 제작 (외부 쇼핑몰 · 견적 상담)", "subjects": ["태권도"],
                 "shipping_fee": 0, "free_shipping_over": 0, "member_rate": 0.0, "delivery_days": 10, "external": True}

CATEGORIES = ["교재", "문구·사무", "수업 교구", "미술·음악", "체육·무도 용품", "상장·기념품", "단체복·굿즈"]


def _p(mall, slug, name, category, list_price, price, unit, tags, description, min_quantity=1):
    return {"external_id": f"mall:{mall}:{slug}", "mall_code": mall, "name": name, "category": category,
            "list_price": list_price, "price": price, "unit": unit, "tags": tags, "description": description,
            "min_quantity": min_quantity, "facility_types": ""}


# 가상 상품 (정가 list_price → 판매가 price, 할인율은 화면에서 계산)
PRODUCT_SEEDS = [
    # 에듀북스 — 교재
    _p("edubooks", "math-mid1", "중등 수학 개념+유형 1-1", "교재", 16000, 14400, "권", "수학,교재,중등,문제집", "개념 정리 + 유형별 문제 · 해설지 포함"),
    _p("edubooks", "math-ele-calc", "초등 연산 마스터 (전 6권 세트)", "교재", 48000, 38400, "세트", "수학,연산,초등,교재", "하루 2쪽 연산 루틴 · 단계별 진단평가"),
    _p("edubooks", "math-think", "사고력 수학 퍼즐 워크북", "교재", 13000, 11700, "권", "수학,사고력,초등,교재", "도형·규칙·논리 퍼즐 60문항"),
    _p("edubooks", "eng-phonics", "파닉스 스타터 1~3 세트", "교재", 42000, 33600, "세트", "영어,파닉스,초등,교재", "음원 QR · 플래시카드 포함"),
    _p("edubooks", "eng-voca", "중등 영단어 1800", "교재", 15000, 13500, "권", "영어,어휘,중등,교재", "Day별 단어 테스트지 다운로드"),
    _p("edubooks", "eng-reading", "리딩 스텝업 Level 2", "교재", 17000, 14450, "권", "영어,리딩,독해,교재", "지문 24편 · 워크북 분리형"),
    _p("edubooks", "kor-essay", "초등 논술 생각 키우기", "교재", 14000, 12600, "권", "국어,논술,독서,교재", "주제별 글쓰기 · 첨삭 가이드"),
    _p("edubooks", "sci-mid", "중등 과학 개념 노트", "교재", 15000, 13500, "권", "과학,중등,교재", "실험 원리 그림 정리"),
    _p("edubooks", "coding-python", "파이썬 기초 실습서", "교재", 20000, 18000, "권", "코딩,파이썬,교재", "12주 커리큘럼 · 예제 코드 제공"),
    # 문구나라 — 공통 소모품
    _p("munguland", "a4", "A4 복사지 80g (2,500매)", "문구·사무", 29000, 24900, "박스", "복사지,소모품,문구,사무,인쇄", "주기적 재구매 품목 · 학원 무료배송 기준 포함"),
    _p("munguland", "marker", "화이트보드 마카 12색 세트", "문구·사무", 15000, 11900, "세트", "보드마카,마카,소모품,수업", "검정·파랑·빨강 포함 · 잉크 리필 가능"),
    _p("munguland", "sticker", "출석·칭찬 스티커 롤 (1,000매)", "문구·사무", 9000, 7200, "롤", "스티커,출석,칭찬,소모품", "일일 출석 체크·보상용"),
    _p("munguland", "file", "학생 개인 파일철 A4 (10개)", "문구·사무", 12000, 9600, "묶음", "파일,문구,정리,소모품", "학생별 학습지 보관"),
    _p("munguland", "toner", "레이저 프린터 토너 (호환)", "문구·사무", 45000, 36000, "개", "토너,프린터,소모품,사무,인쇄", "학습지 출력용 · 약 2,600매"),
    _p("munguland", "hand", "손 소독제 500ml (6개)", "문구·사무", 18000, 14400, "세트", "위생,소독,소모품", "입구 비치용"),
    # 메이커랩 — 교구
    _p("makerlab", "robot-kit", "코딩 로봇 입문 키트 (블록 코딩)", "수업 교구", 89000, 75650, "세트", "코딩,로봇,교구,엔트리,스크래치", "엔트리·스크래치 연동 · 교사용 지도안"),
    _p("makerlab", "arduino", "아두이노 센서 실습 키트", "수업 교구", 52000, 46800, "세트", "코딩,아두이노,교구,과학", "센서 12종 · 실습 예제 20개"),
    _p("makerlab", "sci-kit", "초등 과학 실험 키트 (12주)", "수업 교구", 66000, 52800, "세트", "과학,실험,교구,초등", "주 1회 실험 · 안전 장갑 포함"),
    _p("makerlab", "math-tool", "수학 교구 세트 (분수·도형)", "수업 교구", 38000, 32300, "세트", "수학,교구,도형,분수,초등", "분수 막대·패턴 블록·지오보드"),
    # 아트앤뮤직
    _p("artnmusic", "paint", "수채 물감 24색 (10세트)", "미술·음악", 60000, 48000, "묶음", "미술,물감,수채화,재료", "학원 단체 구매용 10세트"),
    _p("artnmusic", "sketch", "스케치북 A3 (20권)", "미술·음악", 32000, 27200, "묶음", "미술,스케치북,드로잉,재료", "200g 도화지"),
    _p("artnmusic", "piano-book", "바이엘 피아노 교본 상·하", "미술·음악", 16000, 14400, "세트", "음악,피아노,교재,악보", "어린이 첫 피아노"),
    _p("artnmusic", "strings", "바이올린 현 세트 (교체용)", "미술·음악", 28000, 23800, "세트", "음악,바이올린,소모품", "4/4 · 3/4 공용"),
    # 스포츠팜 — 태권도·체육
    _p("sportsfarm", "dobok", "태권도 도복 (아동용)", "체육·무도 용품", 39000, 31200, "벌", "태권도,도복,무도,승급", "110~160호 · 자수 무료(10벌 이상)"),
    _p("sportsfarm", "belt", "승급 띠 세트 (10색)", "체육·무도 용품", 25000, 20000, "세트", "태권도,띠,승급,심사", "흰~검정 10색"),
    _p("sportsfarm", "mitt", "더블 미트 (2개)", "체육·무도 용품", 34000, 28900, "세트", "태권도,미트,겨루기,훈련", "발차기 연습용"),
    _p("sportsfarm", "rope", "줄넘기 (20개 묶음)", "체육·무도 용품", 30000, 24000, "묶음", "체육,줄넘기,훈련", "길이 조절 · PVC"),
    _p("sportsfarm", "mat", "충격 흡수 매트 (2cm, 4장)", "체육·무도 용품", 96000, 81600, "세트", "체육,태권도,매트,안전", "퍼즐형 · 바닥 보호"),
    # 상장나라 — 행사
    _p("prizeshop", "cert", "상장 용지 + 케이스 (50매)", "상장·기념품", 35000, 28000, "묶음", "상장,시상,수료,졸업,대회", "학원 로고 인쇄 옵션"),
    _p("prizeshop", "trophy", "미니 트로피 (10개)", "상장·기념품", 55000, 46750, "묶음", "트로피,시상,대회,매달", "문구 각인 포함"),
    _p("prizeshop", "medal", "기념 메달 (30개)", "상장·기념품", 90000, 72000, "묶음", "매달,메달,대회,승급,수료", "리본 색상 선택"),
    _p("prizeshop", "flyer", "원생 모집 전단지 (1,000장)", "상장·기념품", 70000, 56000, "묶음", "홍보,모집,전단지,신규", "A4 양면 컬러 · 시안 무료"),
]

PAYMENT_METHODS = {"CARD": "법인카드", "KAKAOPAY": "카카오페이", "NAVERPAY": "네이버페이", "TRANSFER": "계좌이체"}
ORDER_STATUSES = {
    "PENDING_APPROVAL": "원장 승인 대기", "PENDING_PAYMENT": "결제 대기", "PAID": "결제 완료(배송 준비)",
    "RECEIVED": "입고 완료", "CANCELED": "취소",
}
OPEN_ORDER_STATUSES = ("PENDING_APPROVAL", "PENDING_PAYMENT", "PAID")
MAX_CART_LINES = 50
MAX_LINE_QUANTITY = 10_000


def mall_of(code: Optional[str]) -> dict:
    if code in MALL_BY_CODE:
        return MALL_BY_CODE[code]
    if code == "ddm":
        return EXTERNAL_MALL
    return {"code": code or "etc", "name": "직접 등록", "logo": "🛍️", "color": "#64748B", "tagline": "",
            "subjects": [], "shipping_fee": 0, "free_shipping_over": 0, "member_rate": 0.0, "delivery_days": 0}


def discount_rate(list_price: Optional[int], price: Optional[int]) -> int:
    """정가 대비 할인율(%) — 정가가 없거나 판매가가 더 높으면 0"""
    if not list_price or not price or price >= list_price:
        return 0
    return int(round((1 - price / list_price) * 100))


def member_price(price: int, rate: float) -> int:
    """학원 회원가 — 10원 단위 내림"""
    if rate <= 0:
        return price
    return int(price * (1 - rate)) // 10 * 10


class QuoteError(ValueError):
    pass


def quote(lines: List[dict], connected: Iterable[str]) -> dict:
    """장바구니 금액 계산 (서버 전용 — 화면이 보낸 가격은 쓰지 않음)

    lines: [{"product": {product_id, name, price, list_price, unit, mall_code, min_quantity, active}, "quantity": n, ...}]
    connected: 학원이 연결한 제휴몰 코드
    반환: 제휴몰별 묶음 + 합계(정가 합계, 상품 할인, 회원가 할인, 배송비, 결제 금액, 아낀 금액)
    """
    connected = set(connected or [])
    if not lines:
        raise QuoteError("장바구니가 비어 있습니다.")
    if len(lines) > MAX_CART_LINES:
        raise QuoteError(f"한 번에 {MAX_CART_LINES}개 상품까지 주문할 수 있습니다.")
    groups: dict = {}
    for line in lines:
        p, qty = line["product"], int(line["quantity"])
        if not p.get("active", True):
            raise QuoteError(f"'{p['name']}' 은(는) 판매가 끝난 상품입니다.")
        if p.get("price") is None:
            raise QuoteError(f"'{p['name']}' 은(는) 견적 문의 상품이라 장바구니로 주문할 수 없습니다.")
        if qty < max(1, p.get("min_quantity") or 1):
            raise QuoteError(f"'{p['name']}' 은(는) {p.get('min_quantity')}{p.get('unit') or '개'} 이상 주문해야 합니다.")
        if qty > MAX_LINE_QUANTITY:
            raise QuoteError(f"'{p['name']}' 수량이 너무 많습니다.")
        mall = mall_of(p.get("mall_code"))
        rate = mall["member_rate"] if mall["code"] in connected else 0.0
        unit_price = member_price(int(p["price"]), rate)
        list_unit = max(int(p.get("list_price") or p["price"]), int(p["price"]))
        g = groups.setdefault(mall["code"], {"mall": {k: mall[k] for k in ("code", "name", "logo", "color")},
                                             "connected": mall["code"] in connected, "member_rate": rate,
                                             "items": [], "list_subtotal": 0, "sale_subtotal": 0, "subtotal": 0})
        sale_total = int(p["price"]) * qty
        line_total = unit_price * qty
        g["items"].append({**{k: line.get(k) for k in line if k != "product"},
                           "product_id": p["product_id"], "name": p["name"], "unit": p.get("unit") or "개",
                           "quantity": qty, "list_price": list_unit, "price": int(p["price"]), "unit_price": unit_price,
                           "discount_rate": discount_rate(list_unit, unit_price), "line_total": line_total,
                           "list_total": list_unit * qty})
        g["list_subtotal"] += list_unit * qty
        g["sale_subtotal"] += sale_total
        g["subtotal"] += line_total
    out_groups, totals = [], {"list_total": 0, "product_discount": 0, "member_discount": 0, "shipping_fee": 0, "total": 0}
    for g in groups.values():
        mall = mall_of(g["mall"]["code"])
        free_over = mall["free_shipping_over"]
        fee = 0 if (not mall["shipping_fee"] or (free_over and g["subtotal"] >= free_over)) else mall["shipping_fee"]
        g["shipping_fee"] = fee
        g["free_shipping_left"] = max(0, free_over - g["subtotal"]) if fee else 0
        g["product_discount"] = g["list_subtotal"] - g["sale_subtotal"]
        g["member_discount"] = g["sale_subtotal"] - g["subtotal"]
        g["total"] = g["subtotal"] + fee
        totals["list_total"] += g["list_subtotal"]
        totals["product_discount"] += g["product_discount"]
        totals["member_discount"] += g["member_discount"]
        totals["shipping_fee"] += fee
        totals["total"] += g["total"]
        out_groups.append(g)
    totals["saved"] = totals["product_discount"] + totals["member_discount"]
    return {"groups": out_groups, **totals}


def subject_tags(tags: str) -> List[str]:
    """상품 태그 중 과목 이름"""
    words = {t.strip() for t in re.split(r"[,\s]+", tags or "") if t.strip()}
    return [s for s in SUBJECTS if s in words]

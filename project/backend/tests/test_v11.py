"""v11 학원 쇼핑몰 — 과목 감지 · 제휴몰 추천/연결 · 할인 · 장바구니 금액(서버 계산) · 모의 결제 · 입고(재고 반영) · 권한/격리"""
import main
import shop_market
from conftest import create_facility, login


# ---------------------------------------------------------------------------------------------------------
# 순수 로직
# ---------------------------------------------------------------------------------------------------------
def test_detect_subjects_weights_and_evidence():
    rows = shop_market.detect_subjects([("중등 수학 A", ""), ("초등 파닉스", "영어 기초"), ("중등 수학 B", "")],
                                       description="입시 수학 전문", facility_type="학원", manual=["국어"])
    by = {r["subject"]: r for r in rows}
    assert rows[0]["subject"] == "수학" and by["수학"]["score"] == 5.0 and by["수학"]["evidence"] == "수업 2개('중등 수학 A' 등) · 학원 소개 글"
    assert by["영어"]["score"] == 2.0 and by["국어"]["evidence"] == "원장이 고른 주요 과목"
    assert shop_market.detect_subjects([], facility_type="도장")[0]["evidence"] == "학원 종류 '도장'"
    assert shop_market.detect_subjects([], facility_type="도장")[0]["subject"] == "태권도"
    assert shop_market.detect_subjects([], description="", facility_type="학원") == []


def test_quote_discounts_member_price_and_shipping():
    p = lambda pid, price, lst, mall="edubooks", **kw: {"product_id": pid, "name": f"상품{pid}", "price": price,
                                                        "list_price": lst, "unit": "권", "mall_code": mall,
                                                        "min_quantity": 1, "active": True, **kw}
    q = shop_market.quote([{"product": p(1, 14400, 16000), "quantity": 2}], connected=[])
    g = q["groups"][0]
    assert g["subtotal"] == 28800 and g["shipping_fee"] == 3000 and g["free_shipping_left"] == 1200     # 3만원 미만
    assert q["product_discount"] == 3200 and q["member_discount"] == 0 and q["total"] == 31800
    q2 = shop_market.quote([{"product": p(1, 14400, 16000), "quantity": 2}], connected=["edubooks"])   # 회원가 5%
    assert q2["groups"][0]["items"][0]["unit_price"] == 13680 and q2["member_discount"] == 1440
    assert q2["shipping_fee"] == 3000 and q2["saved"] == 3200 + 1440
    q3 = shop_market.quote([{"product": p(1, 14400, 16000), "quantity": 3}], connected=[])               # 43,200 → 무료배송
    assert q3["shipping_fee"] == 0
    for bad, msg in [(p(2, None, None), "견적"), (p(3, 1000, 1000, active=False), "판매가 끝난"),
                     (p(4, 1000, 1000, min_quantity=30), "이상 주문")]:
        try:
            shop_market.quote([{"product": bad, "quantity": 1}], [])
            assert False, "QuoteError 가 나야 함"
        except shop_market.QuoteError as exc:
            assert msg in str(exc)
    assert shop_market.discount_rate(16000, 14400) == 10 and shop_market.discount_rate(None, 100) == 0
    assert shop_market.member_price(14399, 0.05) == 13670


# ---------------------------------------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------------------------------------
def _math_english_academy():
    owner = login("math-owner@example.com", "admin", "owner-invite-code")
    fid = create_facility(owner, "쑥쑥 수학영어 학원", facility_type="학원", description="초중등 수학·영어 전문")
    for name in ("중등 수학 심화", "초등 연산반", "파닉스 기초"):
        assert owner.post("/api/classes", json={"name": name, "teacher": "선생님"}).status_code == 201
    owner.facility_id = fid
    return owner


def _id(owner, name):
    items = owner.get("/api/shop/search", params={"q": name, "personalize": False}).json()["items"]
    return next(i for i in items if i["name"] == name)


def test_subject_based_recommendation_and_mall_connect():
    owner = _math_english_academy()
    recs = owner.get("/api/shop/recommendations", params={"limit": 8}).json()
    subjects = [s["subject"] for s in recs["context"]["subjects"]]
    assert subjects[:2] == ["수학", "영어"]
    top = recs["items"][:4]
    assert all(set(i["subjects"]) & {"수학", "영어"} for i in top), [i["name"] for i in top]   # 수학·영어 교재가 먼저
    assert any("수학" in r and "수업" in r for r in top[0]["reasons"])
    assert all(i["subjects"] != ["태권도"] for i in recs["items"])                           # 없는 과목 전용 상품은 뒤로
    malls = owner.get("/api/shop/malls").json()
    assert malls["malls"][0]["code"] == "edubooks" and malls["malls"][0]["recommended"]
    assert not next(m for m in malls["malls"] if m["code"] == "sportsfarm")["recommended"]
    # 주요 과목 직접 지정 → 저장·반영
    fid = owner.facility_id
    assert owner.put(f"/api/facilities/{fid}", json={"name": "쑥쑥 수학영어 학원", "subjects": ["코딩"]}).status_code == 200
    assert owner.put(f"/api/facilities/{fid}", json={"name": "x", "subjects": ["요리"]}).status_code == 422
    assert "코딩" in [s["subject"] for s in owner.get("/api/shop/malls").json()["subjects"]]
    # 연결 → 회원가
    book = _id(owner, "중등 수학 개념+유형 1-1")
    assert book["member_price"] is None and book["discount_rate"] == 10 and book["mall"]["code"] == "edubooks"
    assert owner.post("/api/shop/malls/nope/connect").status_code == 404
    assert owner.post("/api/shop/malls/edubooks/connect").status_code == 200
    assert owner.post("/api/shop/malls/edubooks/connect").status_code == 200            # 두 번 눌러도 한 번만
    assert _id(owner, "중등 수학 개념+유형 1-1")["member_price"] == 13680
    assert next(m for m in owner.get("/api/shop/malls").json()["malls"] if m["code"] == "edubooks")["connected"]
    q = owner.post("/api/shop/cart/quote", json={"items": [{"product_id": book["product_id"], "quantity": 2}]}).json()
    assert q["member_discount"] == 1440 and q["groups"][0]["connected"]
    assert owner.delete("/api/shop/malls/edubooks/connect").json()["connected"] is False


def test_order_approval_mock_payment_receive_and_permissions():
    owner = _math_english_academy()
    owner.post("/api/admin/accounts", json={"email": "shop-staff@example.com", "role": "staff"})
    staff = login("shop-staff@example.com", "admin")
    assert staff.post(f"/api/facilities/{owner.facility_id}/enter").status_code == 200
    paper = _id(owner, "A4 복사지 80g (2,500매)")
    inv = owner.post("/api/inventory", json={"name": "A4 복사지", "unit": "박스", "quantity": 1, "min_quantity": 2,
                                             "keyword": "복사지"}).json()
    req = staff.post("/api/inventory/requests", json={"item_id": inv["item_id"], "quantity": 3}).json()
    # 부족한 재고는 추천에서 앞쪽 + 이유 표시
    recs = owner.get("/api/shop/recommendations", params={"limit": 20}).json()
    assert any(i["product_id"] == paper["product_id"] and any("재고 부족" in r for r in i["reasons"]) for i in recs["items"])
    assert staff.post("/api/shop/malls/munguland/connect").status_code == 403           # 연결은 원장만
    # 직원 주문 → 원장 승인 대기 + 알림 (가격은 서버가 계산 — 화면 값 없음)
    order = staff.post("/api/shop/orders", json={"items": [{"product_id": paper["product_id"], "quantity": 3,
                                                            "inventory_item_id": inv["item_id"]}], "memo": "다음 주 학습지"}).json()
    assert order["status"] == "PENDING_APPROVAL" and order["total"] == 24900 * 3 and order["shipping_fee"] == 0
    assert order["saved"] == (29000 - 24900) * 3 and order["mock_payment"]
    assert any(n["kind"] == "PURCHASE" and "결제 요청" in n["title"] for n in owner.get("/api/notifications").json()["items"])
    oid = order["order_id"]
    assert staff.post(f"/api/shop/orders/{oid}/pay", json={"method": "CARD", "expected_total": order["total"]}).status_code == 403
    assert owner.post(f"/api/shop/orders/{oid}/pay", json={"method": "BITCOIN", "expected_total": order["total"]}).status_code == 400
    assert owner.post(f"/api/shop/orders/{oid}/pay", json={"method": "CARD", "expected_total": 1}).status_code == 409
    assert owner.post(f"/api/shop/orders/{oid}/receive").status_code == 409                    # 결제 전 입고 불가
    paid = owner.post(f"/api/shop/orders/{oid}/pay", json={"method": "KAKAOPAY", "expected_total": order["total"]}).json()
    assert paid["status"] == "PAID" and paid["payment_tid"].startswith("MOCK-") and paid["payment_method_label"] == "카카오페이"
    assert owner.post(f"/api/shop/orders/{oid}/pay", json={"method": "CARD", "expected_total": order["total"]}).status_code == 409
    assert staff.post(f"/api/shop/orders/{oid}/cancel", json={}).status_code == 403             # 결제된 주문은 원장만 취소
    reqs = {r["request_id"]: r for r in owner.get("/api/inventory/requests").json()}
    assert reqs[req["request_id"]]["status"] == "APPROVED"
    received = staff.post(f"/api/shop/orders/{oid}/receive").json()
    assert received["status"] == "RECEIVED" and received["inventory_applied"][0]["quantity"] == 4
    assert owner.get(f"/api/inventory/{inv['item_id']}/logs").json()[0]["reason"] == "PURCHASE"
    assert {r["request_id"]: r for r in owner.get("/api/inventory/requests").json()}[req["request_id"]]["status"] == "RECEIVED"
    assert owner.post(f"/api/shop/orders/{oid}/cancel", json={}).status_code == 409
    listing = owner.get("/api/shop/orders").json()
    assert listing["summary"]["month_spent"] == order["total"] and listing["summary"]["month_saved"] == order["saved"]
    mall = next(m for m in owner.get("/api/shop/malls").json()["malls"] if m["code"] == "munguland")
    assert mall["orders"]["count"] == 1 and mall["orders"]["spent"] == order["total"]
    # 원장 주문은 바로 결제 대기, 결제 후 취소 = 모의 환불
    mine = owner.post("/api/shop/orders", json={"items": [{"product_id": paper["product_id"], "quantity": 1}]}).json()
    assert mine["status"] == "PENDING_PAYMENT" and mine["shipping_fee"] == 3000                # 5만원 미만 배송비
    owner.post(f"/api/shop/orders/{mine['order_id']}/pay", json={"method": "TRANSFER", "expected_total": mine["total"]})
    assert owner.post(f"/api/shop/orders/{mine['order_id']}/cancel", json={"reason": "중복"}).json()["refunded"] is True
    # 외부 쇼핑몰·견적 상품·없는 상품·잘못된 수량
    ddm = next(i for i in owner.get("/api/shop/search", params={"mall": "ddm", "personalize": False}).json()["items"])
    assert ddm["purchasable"] is False
    assert owner.post("/api/shop/orders", json={"items": [{"product_id": ddm["product_id"], "quantity": 1}]}).status_code == 400
    assert owner.post("/api/shop/orders", json={"items": [{"product_id": 999999, "quantity": 1}]}).status_code == 404
    assert owner.post("/api/shop/orders", json={"items": [{"product_id": paper["product_id"], "quantity": 0}]}).status_code == 422
    assert owner.post("/api/shop/orders", json={"items": []}).status_code == 422
    # 다른 학원에서는 주문이 보이지 않음
    other = login("shop-other@example.com", "admin", "owner-invite-code")
    create_facility(other, "다른 학원")
    assert other.get(f"/api/shop/orders/{oid}").status_code == 404
    assert other.post(f"/api/shop/orders/{oid}/cancel", json={}).status_code == 404
    assert all(o["order_id"] != oid for o in other.get("/api/shop/orders").json()["orders"])
    assert not other.get("/api/shop/malls").json()["malls"][0]["connected"]


def test_staff_can_cancel_only_own_pending_request():
    owner = _math_english_academy()
    owner.post("/api/admin/accounts", json={"email": "shop-staff2@example.com", "role": "staff"})
    staff = login("shop-staff2@example.com", "admin")
    staff.post(f"/api/facilities/{owner.facility_id}/enter")
    marker = _id(owner, "화이트보드 마카 12색 세트")
    o = staff.post("/api/shop/orders", json={"items": [{"product_id": marker["product_id"], "quantity": 1}]}).json()
    own = owner.post("/api/shop/orders", json={"items": [{"product_id": marker["product_id"], "quantity": 1}]}).json()
    assert staff.post(f"/api/shop/orders/{own['order_id']}/cancel", json={}).status_code == 403
    assert staff.post(f"/api/shop/orders/{o['order_id']}/cancel", json={}).json()["status"] == "CANCELED"


def test_demo_data_follows_academy_type():
    """시연 데이터는 학원 종류를 따름 — 교과 학원이면 수학·영어 수업 + 교재몰 연결 + 입고 대기 주문"""
    owner = login("demo-math@example.com", "admin", "owner-invite-code")
    create_facility(owner, "우리 학원", facility_type="학원")
    res = owner.post("/api/admin/demo-data", json={})
    assert res.status_code == 201, res.text
    names = [c["name"] for c in owner.get("/api/classes").json()]
    assert any("수학" in n for n in names) and not any("품새" in n for n in names)
    malls = owner.get("/api/shop/malls").json()
    assert next(m for m in malls["malls"] if m["code"] == "edubooks")["connected"]
    assert [s["subject"] for s in malls["subjects"]][:2] == ["수학", "영어"]
    orders = owner.get("/api/shop/orders").json()
    assert orders["summary"]["to_receive"] == 1 and orders["orders"][0]["payment_tid"] == "MOCK-DEMO"
    recs = owner.get("/api/shop/recommendations").json()["items"]
    assert set(recs[0]["subjects"]) & {"수학", "영어"} or any("재고" in r for r in recs[0]["reasons"])

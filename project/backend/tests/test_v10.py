"""v10 기능·보안 테스트 — 서식 본문(XSS 차단) · 공지 사진 · 첨부파일 · 공지 자동 작성 · 쇼핑몰 검색 · 재고/구매 확인 · 보안 점검"""
from datetime import date, timedelta

import main
import notice_draft
import richtext
from conftest import login, parent_in

PNG_1PX = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA"
           "60e6kgAAAABJRU5ErkJggg==")
JPG_THUMB = PNG_1PX.replace("image/png", "image/jpeg")   # 형식 검사만 통과하면 됨(내용은 같은 1px)


def _member(owner, name, phone):
    res = owner.post("/api/members", json={"name": name, "gender": "M", "age": 10,
                                          "enrollment_date": main._today().isoformat(), "mother_phone": phone})
    assert res.status_code == 201, res.text
    return res.json()["member_id"]


# ---------------------------------------------------------------------------------------------------------
# 서식 본문 — 허용 목록 정리
# ---------------------------------------------------------------------------------------------------------
def test_sanitizer_removes_scripts_and_event_handlers():
    html, text = richtext.sanitize_html(
        '<p onclick="steal()">안녕<script>alert(1)</script><b style="color:red;position:fixed">굵게</b></p>'
        '<img src=x onerror=alert(1)><a href="javascript:alert(1)">링크</a><a href="https://ok.example">정상</a>'
        '<span style="font-family: \'Nanum Gothic\'; background-image:url(x)">글꼴</span><iframe src="//evil"></iframe>')
    assert "script" not in html and "onclick" not in html and "onerror" not in html and "<img" not in html
    assert "javascript:" not in html and "position" not in html and "url(" not in html and "iframe" not in html
    assert '<b style="color: red">굵게</b>' in html
    assert 'href="https://ok.example"' in html and 'rel="noopener noreferrer nofollow"' in html
    assert "font-family: &#x27;Nanum Gothic&#x27;" in html or "font-family: 'Nanum Gothic'" in html
    assert text.startswith("안녕굵게") and "alert" not in text


def test_rich_post_is_sanitized_and_searchable(owner):
    res = owner.post("/api/community/posts", json={
        "title": "서식 글", "category": "INFO",
        "content_html": '<p>이번 주 <b>공개수업</b> 안내</p><script>alert("x")</script><p style="text-align:center">끝</p>'})
    assert res.status_code == 201, res.text
    post = res.json()
    assert "<b>공개수업</b>" in post["content_html"] and "script" not in post["content_html"]
    assert post["content"] == "이번 주 공개수업 안내\n끝"                       # 검색·알림·AI 모니터링용 순수 텍스트
    found = owner.get("/api/community/board", params={"q": "공개수업", "field": "content"}).json()["items"]
    assert any(i.get("post_id") == post["post_id"] for i in found)
    # 고정 토글(서식 없이 content 만 보냄)은 서식을 지우지 않음
    pinned = owner.put(f"/api/community/posts/{post['post_id']}", json={"content": post["content"], "photos": [], "is_pinned": True}).json()
    assert pinned["is_pinned"] and pinned["content_html"] == post["content_html"]
    # 학부모 글도 서식 가능 + 모니터링은 텍스트 기준
    parent = parent_in("rich-parent@example.com", owner.facility_id)
    p = parent.post("/api/parent/community/posts", json={"title": "질문", "category": "QUESTION",
                                                         "content_html": "<p><i>준비물</i>이 뭔가요?</p><img src=x onerror=alert(1)>"}).json()
    assert p["content_html"] == "<p><i>준비물</i>이 뭔가요?</p>" and p["status"] == "VISIBLE"


# ---------------------------------------------------------------------------------------------------------
# 공지 사진 · 첨부파일 · 바둑판 보기용 작은 사진
# ---------------------------------------------------------------------------------------------------------
def test_notice_photos_thumbs_and_parent_access(owner):
    cls = owner.post("/api/classes", json={"name": "사진공지반", "teacher": "강사"}).json()
    res = owner.post("/api/notices", json={"title": "운동회 사진", "content": "즐거운 하루",
                                          "photos": [{"src": PNG_1PX, "thumb": JPG_THUMB}, PNG_1PX]})
    assert res.status_code == 201, res.text
    notice = res.json()
    assert len(notice["photos"]) == 2 and notice["thumbs"][0].endswith("?size=thumb")
    assert owner.get(notice["photos"][0]).headers["content-type"] == "image/png"
    assert owner.get(notice["thumbs"][0]).headers["content-type"] == "image/jpeg"    # 작은 사진
    assert owner.get(notice["thumbs"][1]).headers["content-type"] == "image/png"     # 작은 사진이 없으면 원본
    # 고정 토글(사진 목록을 보내지 않음)은 사진 유지
    kept = owner.put(f"/api/notices/{notice['notice_id']}", json={"title": "운동회 사진", "content": "즐거운 하루", "is_pinned": True}).json()
    assert len(kept["photos"]) == 2
    edited = owner.put(f"/api/notices/{notice['notice_id']}", json={"title": "운동회 사진", "content": "즐거운 하루",
                                                                  "photos": kept["photos"][1:]}).json()
    assert edited["photos"] == kept["photos"][1:]
    parent = parent_in("notice-photo-parent@example.com", owner.facility_id)
    board = parent.get("/api/parent/community/board", params={"category": "NOTICE"}).json()
    item = next(i for i in board["items"] if i.get("notice_id") == notice["notice_id"])
    assert item["photos"][0].startswith("/api/parent/notices/photos/") and parent.get(item["thumbs"][0]).status_code == 200
    # 반 공지 사진은 그 반 학부모만
    cls_notice = owner.post("/api/notices", json={"title": "반 사진", "content": "반만", "class_id": cls["class_id"],
                                                  "photos": [PNG_1PX], "notify_parents": False}).json()
    photo_id = cls_notice["photos"][0].rsplit("/", 1)[-1]
    assert parent.get(f"/api/parent/notices/photos/{photo_id}").status_code == 404
    assert owner.delete(f"/api/notices/{cls_notice['notice_id']}").status_code == 204


def test_attachments_upload_download_and_permissions(owner):
    notice = owner.post("/api/notices", json={"title": "첨부 공지", "content": "신청서를 내려받으세요", "notify_parents": False}).json()
    up = owner.post(f"/api/notices/{notice['notice_id']}/attachments",
                    files={"file": ("신청서.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert up.status_code == 201, up.text
    meta = up.json()
    assert meta["file_name"] == "신청서.pdf" and meta["size_bytes"] == 13
    # 위험한 형식은 거부 (실행 파일·HTML·SVG)
    for name in ("run.exe", "page.html", "image.svg", "noext"):
        bad = owner.post(f"/api/notices/{notice['notice_id']}/attachments", files={"file": (name, b"x", "text/html")})
        assert bad.status_code == 400, name
    down = owner.get(meta["url"])
    assert down.status_code == 200 and down.content == b"%PDF-1.4 test"
    assert down.headers["content-disposition"].startswith("attachment;")
    assert "sandbox" in down.headers["content-security-policy"] and down.headers["x-content-type-options"] == "nosniff"
    # 텍스트 파일은 브라우저가 해석하지 않도록 octet-stream 으로 내려줌
    txt = owner.post(f"/api/notices/{notice['notice_id']}/attachments", files={"file": ("memo.txt", b"<script>x</script>", "text/html")}).json()
    assert owner.get(txt["url"]).headers["content-type"] == "application/octet-stream"
    board = owner.get("/api/community/board", params={"category": "NOTICE"}).json()
    item = next(i for i in board["items"] if i.get("notice_id") == notice["notice_id"])
    assert [a["file_name"] for a in item["attachments"]] == ["신청서.pdf", "memo.txt"]
    # 학부모: 공지 첨부 내려받기 O, 관리자 경로 X, 본인 글에만 첨부
    parent = parent_in("attach-parent@example.com", owner.facility_id)
    other = parent_in("attach-other@example.com", owner.facility_id)
    p_item = next(i for i in parent.get("/api/parent/community/board", params={"category": "NOTICE"}).json()["items"]
                  if i.get("notice_id") == notice["notice_id"])
    assert parent.get(p_item["attachments"][0]["url"]).status_code == 200
    assert parent.get(meta["url"]).status_code == 403
    post = parent.post("/api/parent/community/posts", json={"title": "자료 공유", "content": "학습지 올립니다", "category": "INFO"}).json()
    mine = parent.post(f"/api/parent/community/posts/{post['post_id']}/attachments",
                       files={"file": ("학습지.hwp", b"HWP", "application/octet-stream")})
    assert mine.status_code == 201, mine.text
    assert other.post(f"/api/parent/community/posts/{post['post_id']}/attachments",
                      files={"file": ("x.pdf", b"x", "application/pdf")}).status_code == 404
    assert other.delete(f"/api/parent/community/attachments/{mine.json()['attachment_id']}").status_code == 404
    detail = parent.get(f"/api/parent/community/posts/{post['post_id']}").json()
    assert detail["attachments"][0]["mine"] is True
    # 글마다 5개까지
    for i in range(4):
        assert parent.post(f"/api/parent/community/posts/{post['post_id']}/attachments",
                           files={"file": (f"f{i}.txt", b"x", "text/plain")}).status_code == 201
    assert parent.post(f"/api/parent/community/posts/{post['post_id']}/attachments",
                       files={"file": ("f9.txt", b"x", "text/plain")}).status_code == 400
    assert parent.delete(f"/api/parent/community/posts/{post['post_id']}").status_code == 204   # 첨부가 있어도 삭제
    assert owner.delete(f"/api/notices/{notice['notice_id']}").status_code == 204


# ---------------------------------------------------------------------------------------------------------
# 공지 자동 작성
# ---------------------------------------------------------------------------------------------------------
def test_notice_draft_parser_examples():
    today = date(2026, 10, 23)
    p = notice_draft.parse_keywords("에버랜드, 10/25, 선택 참여", today)
    assert (p.day, p.place, p.participation, p.category) == (date(2026, 10, 25), "에버랜드", "optional", "EVENT")
    d = notice_draft.build_template(p, {"name": "한빛 태권도장", "facilityType": "도장"})
    assert d["title"] == "[행사] 10월 25일(일) 에버랜드 현장 체험학습 안내"
    assert "선택 참여" in d["content"] and "■ 장소: 에버랜드" in d["content"] and "체험학습을 진행합니다" in d["content"]
    p = notice_draft.parse_keywords("승급 심사, 11/15 오후 2시, 필수, 준비물: 도복과 띠, 참가비 30,000원", today)
    assert (p.time_text, p.participation, p.fee_text, p.prep) == ("오후 2시", "required", "30,000원", "도복과 띠")
    p = notice_draft.parse_keywords("다음주 토요일 10시~15시 롯데월드 견학, 희망자, 마감 10/28", today)
    assert p.day == date(2026, 10, 31) and p.deadline == date(2026, 10, 28) and p.time_text == "오전 10시 ~ 오후 3시"
    p = notice_draft.parse_keywords("3/2 개강", date(2026, 12, 20))
    assert p.day == date(2027, 3, 2)                                       # 이미 지난 날짜 → 내년
    assert notice_draft.parse_keywords("태풍으로 휴원", today).category == "URGENT"
    assert notice_draft.parse_keywords("상담", today).warnings              # 날짜 없음 → 확인 안내
    # 학원 유형에 따라 호칭이 바뀜 (확장성)
    gym = notice_draft.build_template(notice_draft.parse_keywords("체육대회 11/1 필수", today), {"facilityType": "체육관"})
    assert "모든 회원이" in gym["content"]


def test_notice_draft_endpoint_uses_facility_info(owner):
    res = owner.post("/api/notices/draft", json={"keywords": "에버랜드, 10/25, 선택 참여"})
    assert res.status_code == 200, res.text
    draft = res.json()
    assert draft["source"] == "template" and "에버랜드" in draft["title"] and draft["category"] == "EVENT"
    assert draft["content_html"].startswith("<p>") and draft["parsed"]["participation"] == "optional"
    assert owner.post("/api/notices/draft", json={"keywords": ""}).status_code == 422
    parent = parent_in("draft-parent@example.com", owner.facility_id)
    assert parent.post("/api/notices/draft", json={"keywords": "x"}).status_code == 403


# ---------------------------------------------------------------------------------------------------------
# 쇼핑몰 검색 · 맞춤 검색
# ---------------------------------------------------------------------------------------------------------
def test_shop_search_synonyms_filters_and_sort(owner):
    res = owner.get("/api/shop/search", params={"q": "도복"})                # 동의어: 도복 → 태권도
    assert res.status_code == 200 and any(i["category"] == "체육·무도 용품" for i in res.json()["items"])
    assert owner.get("/api/shop/search", params={"q": "메달"}).json()["items"][0]["category"] == "상장·기념품"
    assert owner.get("/api/shop/search", params={"q": "없는상품xyz"}).json()["total"] == 0
    assert owner.get("/api/shop/search", params={"q": "키링 기념품"}).json()["items"][0]["name"] == "아크릴 키링 주문제작"   # 여러 단어 AND
    # 상품 카탈로그는 모든 학원 공용 → 학원 원장은 못 바꾸고 플랫폼 운영자만
    tee = {"name": "단체 티셔츠", "category": "단체복·굿즈", "url": "/tee.html", "price": 9000, "tags": "단체복,행사", "min_quantity": 20}
    assert owner.post("/api/shop/products", json=tee).status_code == 403
    main.PLATFORM_ADMIN_EMAILS.add("owner@example.com")
    try:
        priced = owner.post("/api/shop/products", json=tee).json()
        cheap = owner.get("/api/shop/search", params={"max_price": 10000, "include_quote": False}).json()["items"]
        assert all(i["price"] is not None and i["price"] <= 10000 for i in cheap) and priced["product_id"] in [i["product_id"] for i in cheap]
        assert all(i["product_id"] != priced["product_id"]
                   for i in owner.get("/api/shop/search", params={"quantity": 10}).json()["items"])   # 최소 20개
        group = owner.get("/api/shop/search", params={"q": "단체 티셔츠", "quantity": 30}).json()["items"]
        assert any(i["product_id"] == priced["product_id"] and any("30명" in r for r in i["reasons"]) for i in group)
        bad_img = owner.put(f"/api/shop/products/{priced['product_id']}", json={"name": "x", "category": "단체복·굿즈", "url": "/x",
                                                                               "image_url": "javascript:alert(1)"})
        assert bad_img.status_code == 400
        owner.delete(f"/api/shop/products/{priced['product_id']}")
    finally:
        main.PLATFORM_ADMIN_EMAILS.discard("owner@example.com")
    names = [i["name"] for i in owner.get("/api/shop/search", params={"sort": "name", "personalize": False}).json()["items"]]
    assert names == sorted(names)
    discounted = owner.get("/api/shop/search", params={"sort": "discount", "discount_only": True}).json()["items"]
    assert discounted and [i["discount_rate"] for i in discounted] == sorted((i["discount_rate"] for i in discounted), reverse=True)
    assert owner.get("/api/shop/search", params={"sort": "bad"}).status_code == 400
    assert owner.get("/api/shop/search", params={"min_price": 5, "max_price": 1}).status_code == 400
    data = owner.get("/api/shop/search").json()
    assert data["facility_type"] == "도장" and data["suggestions"] and "definition" in data


# ---------------------------------------------------------------------------------------------------------
# 재고 · 구매 확인
# ---------------------------------------------------------------------------------------------------------
def test_inventory_low_stock_purchase_flow(owner):
    owner.post("/api/admin/accounts", json={"email": "stock-staff@example.com", "role": "staff"})
    staff = login("stock-staff@example.com", "admin")
    assert staff.post(f"/api/facilities/{owner.facility_id}/enter").status_code == 200
    created = staff.post("/api/inventory", json={"name": "출석 스티커", "category": "소모품", "unit": "롤",
                                                 "quantity": 5, "min_quantity": 3, "b2b_sku": "ST-036"})
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["status"] == "OK" and item["quantity"] == 5
    assert staff.post("/api/inventory", json={"name": "x", "b2b_sku": "NOPE"}).status_code == 400
    used = staff.post(f"/api/inventory/{item['item_id']}/adjust", json={"change": -3, "reason": "OUT", "note": "수업 사용"}).json()
    assert used["status"] == "LOW" and used["suggested_quantity"] == 4        # 3×2 − 2
    assert staff.post(f"/api/inventory/{item['item_id']}/adjust", json={"change": -9, "reason": "OUT"}).status_code == 409
    assert staff.post(f"/api/inventory/{item['item_id']}/adjust", json={"change": 3, "reason": "OUT"}).status_code == 400
    alerts = owner.get("/api/notifications").json()["items"]
    assert any(n["kind"] == "INVENTORY" and "출석 스티커" in n["title"] for n in alerts)
    check = staff.get("/api/inventory/purchase-check").json()
    row = next(i for i in check["items"] if i["item_id"] == item["item_id"])
    b2b = next(o for o in row["options"] if o["type"] == "b2b")
    assert b2b["linked"] and b2b["sku"] == "ST-036" and b2b["estimated_total"] == b2b["unit_price"] * b2b["quantity"]
    summary = owner.get("/api/admin/summary").json()["badges"]
    assert summary["inventory_low"] >= 1
    req = staff.post("/api/inventory/requests", json={"item_id": item["item_id"], "quantity": 4, "note": "다음 주 부족"})
    assert req.status_code == 201, req.text
    assert staff.post("/api/inventory/requests", json={"item_id": item["item_id"], "quantity": 1}).status_code == 409
    rid = req.json()["request_id"]
    assert owner.get("/api/admin/summary").json()["badges"]["purchase_pending"] >= 1
    assert staff.post(f"/api/inventory/requests/{rid}/decide", json={"decision": "APPROVED"}).status_code == 403   # 원장만
    assert staff.post(f"/api/inventory/requests/{rid}/receive", json={}).status_code == 409                       # 승인 전
    approved = owner.post(f"/api/inventory/requests/{rid}/decide", json={"decision": "APPROVED", "note": "B2B로 주문"}).json()
    assert approved["status"] == "APPROVED"
    assert any(n["kind"] == "PURCHASE" and "승인" in n["title"] for n in staff.get("/api/notifications").json()["items"])
    received = staff.post(f"/api/inventory/requests/{rid}/receive", json={}).json()
    assert received["request"]["status"] == "RECEIVED" and received["item"]["quantity"] == 6 and received["item"]["status"] == "OK"
    logs = staff.get(f"/api/inventory/{item['item_id']}/logs").json()
    assert [l["reason"] for l in logs][:3] == ["PURCHASE", "OUT", "IN"]
    assert staff.delete(f"/api/inventory/{item['item_id']}").status_code == 403
    assert owner.delete(f"/api/inventory/{item['item_id']}").status_code == 204
    assert all(i["item_id"] != item["item_id"] for i in owner.get("/api/inventory").json()["items"])
    # 다른 학원과 분리
    other = login("stock-other@example.com", "admin", "owner-invite-code")
    from conftest import create_facility
    create_facility(other, "다른 재고 학원")
    assert other.get("/api/inventory").json()["summary"]["total"] == 0


# ---------------------------------------------------------------------------------------------------------
# 보안 점검 결과
# ---------------------------------------------------------------------------------------------------------
def test_owner_cannot_raise_own_pricing_tier(owner):
    me = next(a for a in owner.get("/api/admin/accounts").json() if a["email"] == "owner@example.com")
    res = owner.patch(f"/api/admin/accounts/{me['account_id']}", json={"role": "owner", "pricing_tier": "VIP"})
    assert res.status_code == 403
    assert owner.patch(f"/api/admin/accounts/{me['account_id']}", json={"role": "owner", "pricing_tier": me["pricing_tier"]}).status_code == 200
    main.PLATFORM_ADMIN_EMAILS.add("owner@example.com")
    try:
        assert owner.patch(f"/api/admin/accounts/{me['account_id']}", json={"role": "owner", "pricing_tier": "VIP"}).status_code == 200
        owner.patch(f"/api/admin/accounts/{me['account_id']}", json={"role": "owner", "pricing_tier": "STANDARD"})
    finally:
        main.PLATFORM_ADMIN_EMAILS.discard("owner@example.com")


def test_cross_site_writes_are_blocked_and_headers_set(owner):
    evil = owner.post("/api/notices", json={"title": "x", "content": "y"}, headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    assert owner.post("/api/notices", json={"title": "x", "content": "y"},
                      headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    same = owner.post("/api/notices", json={"title": "같은 출처", "content": "y", "notify_parents": False},
                      headers={"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"})
    assert same.status_code == 201
    assert owner.get("/api/members", headers={"Origin": "https://evil.example"}).status_code == 200   # 읽기는 CORS 가 담당
    res = owner.get("/api/health")
    assert res.headers["content-security-policy"].startswith("default-src 'none'")
    assert res.headers["x-frame-options"] == "DENY"


def test_kakao_approve_skips_already_paid_invoice(owner):
    member_id = _member(owner, "이중결제방지", "010-7777-1212")
    inv = owner.post("/api/invoices", json={"member_id": member_id, "amount": 50000}).json()
    db = main.SessionLocal()
    try:
        db.add(main.PaymentPending(partner_order_id="order_test_paid", tid="T-PAID", member_id=member_id,
                                   partner_user_id=f"admin1_member{member_id}", invoice_id=inv["invoice_id"], amount=50000,
                                   item_name="수강료", status="READY", facility_id=owner.facility_id))
        db.commit()
    finally:
        db.close()
    assert owner.post(f"/api/invoices/{inv['invoice_id']}/mark-paid", json={"method": "CASH"}).status_code == 200
    # mark-paid 가 열린 결제창을 무효화 → 콜백이 와도 카카오 승인 API 를 부르지 않음
    called = []
    original = main.requests.post
    main.requests.post = lambda *a, **k: called.append(a) or (_ for _ in ()).throw(AssertionError("호출되면 안 됨"))
    try:
        res = owner.get("/api/payments/kakao-success", params={"order_id": "order_test_paid", "pg_token": "x"},
                        follow_redirects=False)
    finally:
        main.requests.post = original
    assert res.status_code in (302, 307) and "reason=already" in res.headers["location"] and not called
    # 청구서는 이미 PAID 인데 결제 대기가 READY 로 남아 있는 경우(경합)도 승인하지 않음
    db = main.SessionLocal()
    try:
        db.add(main.PaymentPending(partner_order_id="order_test_race", tid="T-RACE", member_id=member_id,
                                   partner_user_id=f"parent1_member{member_id}", invoice_id=inv["invoice_id"], amount=50000,
                                   item_name="수강료", status="READY", facility_id=owner.facility_id))
        db.commit()
    finally:
        db.close()
    main.requests.post = lambda *a, **k: called.append(a) or (_ for _ in ()).throw(AssertionError("호출되면 안 됨"))
    try:
        res = owner.get("/api/payments/kakao-success", params={"order_id": "order_test_race", "pg_token": "x"},
                        follow_redirects=False)
    finally:
        main.requests.post = original
    assert "reason=already" in res.headers["location"] and not called


def test_input_bounds_and_submission_scope(owner):
    member_id = _member(owner, "범위학생", "010-7777-3434")
    assert owner.post("/api/invoices", json={"member_id": member_id, "amount": 10 ** 12}).status_code == 422
    assert owner.post("/api/invoices", json={"member_id": member_id, "amount": 1000, "item_name": "x" * 300}).status_code == 422
    cls = owner.post("/api/classes", json={"name": "제출범위반", "teacher": "강사"}).json()
    a = owner.post(f"/api/classes/{cls['class_id']}/assignments", data={"title": "숙제", "due_date": "2026-12-01"}).json()
    res = owner.put(f"/api/assignments/{a['assignment_id']}/submissions/{member_id}", json={"status": "SUBMITTED"})
    assert res.status_code == 400                                         # 그 반 학생이 아님
    owner.post(f"/api/classes/{cls['class_id']}/members/{member_id}")
    assert owner.put(f"/api/assignments/{a['assignment_id']}/submissions/{member_id}", json={"status": "SUBMITTED"}).status_code == 200


def test_member_list_filtered_by_class_only_computes_that_class(owner):
    cls = owner.post("/api/classes", json={"name": "필터반", "teacher": "강사"}).json()
    inside = _member(owner, "필터안", "010-7777-5656")
    _member(owner, "필터밖", "010-7777-7878")
    owner.post(f"/api/classes/{cls['class_id']}/members/{inside}")
    rows = owner.get("/api/members", params={"class_id": cls["class_id"], "status": "ACTIVE"}).json()
    assert [r["member_id"] for r in rows] == [inside] and rows[0]["classes"][0]["class_id"] == cls["class_id"]

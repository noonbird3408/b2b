"""핵심 흐름 테스트 — 실행: cd backend && pytest -q"""
import json
from datetime import date

import main
from conftest import login, parent_in, create_facility
from fastapi.testclient import TestClient


def test_health_is_public():
    res = TestClient(main.app).get("/api/health")
    assert res.status_code == 200 and res.json()["ok"] is True


def test_api_requires_login():
    client = TestClient(main.app)
    assert client.get("/api/members").status_code == 401
    assert client.get("/api/parent/children").status_code == 401


def test_role_is_verified_on_server(owner):
    stranger = login("stranger@example.com")
    assert stranger.get("/api/members").status_code == 403          # 역할 미선택
    res = stranger.post("/api/auth/role", json={"role": "admin"})
    assert res.status_code == 403                                     # 등록·초대 없음 → 관리자 불가
    res = stranger.post("/api/auth/role", json={"role": "admin", "invite_code": "wrong"})
    assert res.status_code == 403
    assert stranger.post("/api/auth/role", json={"role": "parent"}).status_code == 200
    assert stranger.get("/api/members").status_code == 403           # 학부모 세션은 관리자 API 불가
    me = owner.get("/api/auth/me").json()
    assert me["active_role"] == "admin" and me["admin"]["role"] == "owner"


def _seed_member(owner, name, phone):
    res = owner.post("/api/members", json={
        "name": name, "gender": "M", "age": 10, "enrollment_date": date.today().isoformat(),
        "mother_phone": phone,
    })
    assert res.status_code == 201, res.text
    return res.json()["member_id"]


def test_parent_sees_only_linked_child(owner):
    mine = _seed_member(owner, "김민준", "010-1111-2222")
    other = _seed_member(owner, "이서연", "010-3333-4444")
    inv = owner.post("/api/invoices", json={"member_id": mine, "amount": 150000}).json()
    owner.post("/api/invoices", json={"member_id": other, "amount": 99000})
    owner.post("/api/attendances", json={"member_id": mine, "attendance_date": date.today().isoformat()})

    parent = parent_in("parent@example.com", owner.facility_id)
    assert parent.post("/api/parent/children", json={"child_name": "김민준", "phone": "010-0000-0000"}).status_code == 404
    res = parent.post("/api/parent/children", json={"child_name": "김민준", "phone": "01011112222"})
    assert res.status_code == 201 and res.json()["member_id"] == mine

    children = parent.get("/api/parent/children").json()
    assert [c["member_id"] for c in children] == [mine]
    assert "mother_phone" not in children[0]                          # 최소 필드만 노출
    invoices = parent.get("/api/parent/invoices").json()
    assert [i["invoice_id"] for i in invoices] == [inv["invoice_id"]]
    assert parent.get(f"/api/parent/attendances?member_id={mine}").json()["summary"]["present"] == 1
    assert parent.get(f"/api/parent/attendances?member_id={other}").status_code == 403
    # 카카오 키가 없으면 결제 준비는 503 (연결·청구서 검증은 통과한 뒤)
    assert parent.post("/api/parent/payments/kakao-ready", json={"invoice_id": inv["invoice_id"]}).status_code == 503


def test_parent_link_lockout(owner):
    parent = parent_in("bruteforce@example.com", owner.facility_id)
    for _ in range(main.VERIFY_MAX_FAILURES):
        parent.post("/api/parent/children", json={"child_name": "없는학생", "phone": "010-9999-9999"})
    assert parent.post("/api/parent/children", json={"child_name": "없는학생", "phone": "010-9999-9999"}).status_code == 429


def test_parent_comment_author_is_server_side(owner):
    post = owner.post("/api/community/posts", json={"content": "오늘 수업 사진"}).json()
    parent = parent_in("commenter@example.com", owner.facility_id)
    res = parent.post(f"/api/parent/community/posts/{post['post_id']}/comments",
                      json={"content": "감사합니다", "author": "원장"})
    assert res.status_code == 201 and res.json()["author"].endswith("학부모")   # 클라이언트가 보낸 이름 무시


def test_staff_limited_to_shop(owner):
    assert owner.post("/api/admin/accounts", json={"email": "staff@example.com", "role": "staff"}).status_code == 201
    staff = login("staff@example.com", "admin")                      # 사전 등록 → 초대 코드 불필요
    assert staff.get("/api/shop/products").status_code == 428          # 시설 선택 전
    facilities = staff.get("/api/facilities").json()
    assert [f["facility_id"] for f in facilities] == [owner.facility_id]
    assert staff.post(f"/api/facilities/{owner.facility_id}/enter").status_code == 200
    assert staff.get("/api/shop/products").status_code == 200
    assert staff.get("/api/members").status_code == 200                # 직원: 학생·수업 조회 가능
    assert staff.post("/api/members", json={"name": "x", "gender": "M", "age": 1,
                                           "enrollment_date": date.today().isoformat()}).status_code == 403
    assert staff.post("/api/facilities", json={"name": "직원 시설"}).status_code == 403


def test_shop_recommendations_use_facility_signals(owner):
    settings = owner.get("/api/settings").json()
    settings["academy"]["facilityType"] = "도장"
    assert owner.put("/api/settings", json=settings).status_code == 200
    owner.post("/api/notices", json={"title": "11월 품새 대회 안내", "content": "대회 참가 신청을 받습니다."})

    data = owner.get("/api/shop/recommendations").json()
    assert data["strategy"] == "rule_based_v1"
    assert any(e["keyword"] == "대회" for e in data["context"]["events"])
    by_name = {item["name"]: item for item in data["items"]}
    assert "태권도 용품" in by_name and any("도장" in r for r in by_name["태권도 용품"]["reasons"])
    assert all("utm_source=facility_manager" in item["url"] for item in data["items"])
    assert all(item["url"].startswith(main.SHOP_BASE_URL) for item in data["items"])

    product_id = data["items"][0]["product_id"]
    assert owner.post(f"/api/shop/products/{product_id}/click", json={"context": "recommendation"}).status_code == 201
    again = owner.get("/api/shop/recommendations").json()
    clicked = next(i for i in again["items"] if i["product_id"] == product_id)
    assert any("조회" in r for r in clicked["reasons"])


def test_enrollment_map_and_classes(owner):
    member_id = _seed_member(owner, "박지호", "010-5555-6666")
    cls = owner.post("/api/classes", json={"name": "초등 A반", "teacher": "김코치",
                                           "start_date": "2026-01-01", "end_date": "2026-12-31"}).json()
    assert owner.post(f"/api/classes/{cls['class_id']}/members/{member_id}").status_code == 201
    mapping = owner.get("/api/enrollments/by-member").json()
    assert mapping[str(member_id)] == ["초등 A반"]
    classes = owner.get("/api/classes").json()
    target = next(c for c in classes if c["class_id"] == cls["class_id"])
    assert target["students"][0]["name"] == "박지호"


def test_classes_allow_open_ended_schedule(owner):
    response = owner.post("/api/classes", json={
        "name": "기간 미정 반", "teacher": "김코치",
        "schedules": [{"day": "MON", "start": "14:00", "end": "15:00"}],
        "color_index": 3,
    })
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["start_date"] is None and data["end_date"] is None
    assert data["color_index"] == 3

    updated = owner.put(f"/api/classes/{data['class_id']}", json={
        "name": "기간 지정 반", "teacher": "김코치",
        "start_date": "2026-01-01", "end_date": "2026-12-31",
        "schedules": [{"day": "MON", "start": "14:00", "end": "15:00"}],
        "color_index": 1,
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["color_index"] == 1


def test_ai_pseudonymizer_strips_pii():
    p = main._Pseudonymizer()
    scrubbed = p.scrub({"members": [{"name": "김민준", "mother_phone": "010-1", "photo_url": "data:image/png;base64,xx", "age": 10}]})
    assert scrubbed == {"members": [{"name": "S0001", "age": 10}]}
    assert p.restore("S0001 학생의 출석률이 높습니다") == "김민준 학생의 출석률이 높습니다"


def test_cron_requires_secret():
    client = TestClient(main.app)
    assert client.get("/api/cron/cleanup").status_code == 401
    res = client.get("/api/cron/cleanup", headers={"Authorization": "Bearer cron-secret"})
    assert res.status_code == 200 and "deleted" in res.json()


# ---------------------------------------------------------------------
# v8: Supabase/Vercel 대응 회귀 테스트
# ---------------------------------------------------------------------
PNG_1PX = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
           "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def test_health_reports_db_and_config():
    data = TestClient(main.app).get("/api/health").json()
    assert data["db_connected"] is True and data["tables_ready"] is True and data["ok"] is True
    assert data["config"]["admin_invite_code"] is True
    assert "owner-invite-code" not in str(data)                       # 비밀 값은 노출하지 않음


def test_today_uses_app_timezone():
    from datetime import datetime, timezone, timedelta
    seoul = datetime.now(timezone(timedelta(hours=9))).date()
    assert main._today() == seoul


def test_invite_code_bruteforce_lockout():
    guesser = login("guesser@example.com")
    for _ in range(main.VERIFY_MAX_FAILURES):
        assert guesser.post("/api/auth/role", json={"role": "admin", "invite_code": "wrong-code-123"}).status_code == 403
    # 잠긴 뒤에는 맞는 코드여도 거부
    assert guesser.post("/api/auth/role", json={"role": "admin", "invite_code": "owner-invite-code"}).status_code == 429


def test_member_photo_served_by_url_not_inline(owner):
    res = owner.post("/api/members", json={"name": "사진학생", "gender": "F", "age": 9,
                                          "enrollment_date": date.today().isoformat(), "photo_url": PNG_1PX})
    assert res.status_code == 201, res.text
    member = res.json()
    assert member["photo_url"].startswith(f"/api/members/{member['member_id']}/photo")
    listed = next(m for m in owner.get("/api/members").json() if m["member_id"] == member["member_id"])
    assert "base64" not in (listed["photo_url"] or "")                # 목록에는 base64 가 없음
    img = owner.get(listed["photo_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    # 수정 시 받은 URL 을 그대로 보내면 사진 유지, 빈 값이면 삭제
    updated = owner.put(f"/api/members/{member['member_id']}", json={**listed, "age": 10}).json()
    assert updated["photo_url"] and updated["age"] == 10
    cleared = owner.put(f"/api/members/{member['member_id']}", json={**listed, "photo_url": ""}).json()
    assert cleared["photo_url"] is None
    bad = owner.post("/api/members", json={"name": "x", "gender": "M", "age": 1,
                                          "enrollment_date": date.today().isoformat(), "photo_url": "javascript:alert(1)"})
    assert bad.status_code == 400


def test_delete_member_with_related_rows(owner):
    member_id = _seed_member(owner, "삭제학생", "010-7777-0000")
    owner.post("/api/attendances", json={"member_id": member_id, "attendance_date": date.today().isoformat()})
    owner.post("/api/invoices", json={"member_id": member_id, "amount": 1000})
    assert owner.delete(f"/api/members/{member_id}").status_code == 204   # 외래키 강제 상태에서도 삭제
    paid_id = _seed_member(owner, "결제학생", "010-7777-1111")
    owner.post("/api/payments", json={"member_id": paid_id, "amount": 50000, "paid_at": date.today().isoformat()})
    res = owner.delete(f"/api/members/{paid_id}")
    assert res.status_code == 409 and "퇴원" in res.json()["detail"]   # 결제 기록 보존


def test_delete_class_with_assignment(owner):
    cls = owner.post("/api/classes", json={"name": "삭제반", "teacher": "이코치",
                                           "start_date": "2026-01-01", "end_date": "2026-12-31"}).json()
    res = owner.post(f"/api/classes/{cls['class_id']}/assignments", data={"title": "숙제", "due_date": "2026-02-01"})
    assert res.status_code == 200, res.text
    listed = owner.get(f"/api/classes/{cls['class_id']}/assignments").json()
    assert listed[0]["title"] == "숙제"
    assert owner.delete(f"/api/classes/{cls['class_id']}").status_code == 204


def test_community_photos_and_parent_access(owner):
    post = owner.post("/api/community/posts", json={"content": "사진 게시물", "photos": [PNG_1PX, PNG_1PX]}).json()
    assert len(post["photos"]) == 2 and all(p.startswith("/api/community/photos/") for p in post["photos"])
    assert owner.get(post["photos"][0]).headers["content-type"] == "image/png"
    # 수정: 첫 사진만 유지
    edited = owner.put(f"/api/community/posts/{post['post_id']}", json={"content": "수정", "photos": post["photos"][:1]}).json()
    assert edited["photos"] == post["photos"][:1]
    parent = parent_in("photo-parent@example.com", owner.facility_id)
    feed = parent.get("/api/parent/community/posts").json()
    mine = next(p for p in feed if p["post_id"] == post["post_id"])
    assert mine["photos"][0].startswith("/api/parent/community/photos/")
    assert parent.get(mine["photos"][0]).status_code == 200
    assert parent.get(post["photos"][0]).status_code == 403          # 관리자 경로는 학부모 불가
    parent.post(f"/api/parent/community/posts/{post['post_id']}/comments", json={"content": "좋아요"})
    assert owner.delete(f"/api/community/posts/{post['post_id']}").status_code == 204   # 댓글·사진 있어도 삭제
    assert owner.post("/api/community/posts/999999/comments", json={"content": "없음"}).status_code == 404


def test_legacy_json_photos_are_migrated(owner):
    db = main.SessionLocal()
    try:
        legacy = main.CommunityPost(author="관리자", content="옛 게시물", photos=json.dumps([PNG_1PX]),
                                    facility_id=owner.facility_id)
        db.add(legacy); db.commit(); post_id = legacy.post_id
    finally:
        db.close()
    item = next(p for p in owner.get("/api/community/posts").json() if p["post_id"] == post_id)
    assert len(item["photos"]) == 1 and owner.get(item["photos"][0]).status_code == 200


def test_validation_error_is_korean_string(owner):
    res = owner.post("/api/notices", json={"title": "가" * 201, "content": "x"})
    assert res.status_code == 422 and isinstance(res.json()["detail"], str) and "200자" in res.json()["detail"]


def test_kakao_ready_supersedes_previous_window(owner, monkeypatch=None):
    member_id = _seed_member(owner, "결제창학생", "010-8888-0000")
    inv = owner.post("/api/invoices", json={"member_id": member_id, "amount": 30000}).json()

    class FakeResponse:
        status_code = 200
        def __init__(self, n): self.n = n
        def json(self): return {"tid": f"T{self.n}", "next_redirect_pc_url": "https://kakao.example/pay"}

    calls = []
    original_post, original_key = main.requests.post, main.KAKAO_SECRET_KEY
    main.requests.post = lambda url, json=None, headers=None, timeout=None: (calls.append(json), FakeResponse(len(calls)))[1]
    main.KAKAO_SECRET_KEY = "test-key"
    try:
        first = owner.post("/api/payments/kakao-ready", json={"member_id": member_id, "amount": 1, "invoice_id": inv["invoice_id"]})
        second = owner.post("/api/payments/kakao-ready", json={"member_id": member_id, "amount": 1, "invoice_id": inv["invoice_id"]})
    finally:
        main.requests.post, main.KAKAO_SECRET_KEY = original_post, original_key
    assert first.status_code == 200 and second.status_code == 200
    assert calls[0]["total_amount"] == 30000                          # 클라이언트 금액(1원) 무시, 청구서 금액 사용
    assert calls[0]["approval_url"].startswith("http://testserver/api/payments/kakao-success")
    statuses = {p["partner_order_id"]: p["status"] for p in owner.get("/api/payments/kakao/pending").json()}
    assert statuses[first.json()["partner_order_id"]] == "CANCELED"   # 이전 결제창 무효화
    assert statuses[second.json()["partner_order_id"]] == "READY"

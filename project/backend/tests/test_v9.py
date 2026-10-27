"""v9 기능 테스트 — 여러 학원(테넌트 격리) · 가입 신청 · 수업별 출결 · 게시판형 커뮤니티 · 멤버 제재 · 마이그레이션"""
from datetime import timedelta

import main
from conftest import login, parent_in, create_facility


def _class(owner, name, **extra):
    today = main._today()
    body = {"name": name, "teacher": "강사",
            "schedules": [{"day": main.WEEKDAY_CODES[today.weekday()], "start": "14:00", "end": "15:00"}], **extra}
    res = owner.post("/api/classes", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_facilities_are_isolated():
    a = login("iso-a@example.com", "admin", "owner-invite-code")
    b = login("iso-b@example.com", "admin", "owner-invite-code")
    fa, fb = create_facility(a, "격리 A 학원"), create_facility(b, "격리 B 체육관", facility_type="체육관")
    member = a.post("/api/members", json={"name": "격리학생", "gender": "M", "age": 9,
                                          "enrollment_date": main._today().isoformat()}).json()
    cls = _class(a, "격리반")
    assert all(m["name"] != "격리학생" for m in b.get("/api/members").json())
    assert b.get(f"/api/members/{member['member_id']}").status_code == 404
    assert b.delete(f"/api/classes/{cls['class_id']}").status_code == 404
    assert b.post(f"/api/facilities/{fa}/enter").status_code == 403           # 남의 학원 입장 불가
    assert b.put(f"/api/facilities/{fa}", json={"name": "탈취"}).status_code == 403
    # 학원 데이터가 바뀌면 data_version 이 올라감(화면 동기화 신호)
    before = a.get("/api/sync").json()["data_version"]
    a.post("/api/notices", json={"title": "동기화", "content": "x"})
    assert a.get("/api/sync").json()["data_version"] > before
    assert b.get("/api/sync").json()["data_version"] == 0 or fb
    # 열(column)만 고르는 조회·집계·게시판도 학원별로 분리되는지
    assert str(member["member_id"]) not in b.get("/api/enrollments/by-member").json()
    assert all(i.get("title") != "동기화" for i in b.get("/api/community/board").json()["items"])
    assert b.get("/api/dashboard/insights").json()["members"]["active"] == 0
    assert [c["name"] for c in b.get("/api/classes").json()] == []


def test_facility_delete_requires_name_and_is_soft():
    owner = login("del-owner@example.com", "admin", "owner-invite-code")
    fid = create_facility(owner, "지울 학원")
    assert owner.delete(f"/api/facilities/{fid}", params={"confirm_name": "다른 이름"}).status_code == 400
    assert owner.delete(f"/api/facilities/{fid}", params={"confirm_name": "지울 학원"}).status_code == 204
    assert owner.get("/api/members").status_code == 428                       # 학원 선택 해제됨
    assert all(f["facility_id"] != fid for f in owner.get("/api/facilities").json())


def test_parent_search_apply_and_admin_approve(owner):
    cls = _class(owner, "신청반", monthly_fee=120000)
    owner.put(f"/api/facilities/{owner.facility_id}", json={"name": "테스트 태권도장", "facility_type": "도장",
                                                            "region": "경기 용인시", "is_public": True})
    parent = login("apply-parent@example.com", "parent")
    assert parent.get("/api/parent/children").status_code == 428             # 학원 선택 전
    found = parent.get("/api/parent/facilities/search", params={"q": "태권도"}).json()
    assert any(f["facility_id"] == owner.facility_id for f in found)
    detail = parent.get(f"/api/parent/facilities/{owner.facility_id}").json()
    assert any(c["class_id"] == cls["class_id"] and c["fee"] == 120000 for c in detail["classes"])
    child = parent.post("/api/parent/child-profiles", json={
        "name": "신청아이", "gender": "F", "age": 8, "parent_phone": "010-1212-3434", "relation": "모",
        "parent_name": "신청맘"}).json()
    app = parent.post(f"/api/parent/facilities/{owner.facility_id}/applications",
                      json={"child_id": child["child_id"], "class_ids": [cls["class_id"]]})
    assert app.status_code == 201, app.text
    assert app.json()["estimated_fee"] == 120000 and app.json()["status"] == "PENDING"
    assert parent.post(f"/api/parent/facilities/{owner.facility_id}/applications",
                       json={"child_id": child["child_id"]}).status_code == 409   # 중복 신청
    pending = [a for a in owner.get("/api/applications").json() if a["application_id"] == app.json()["application_id"]]
    assert pending and pending[0]["child"]["parent_phone"] == "010-1212-3434"
    res = owner.post(f"/api/applications/{app.json()['application_id']}/approve", json={"create_invoice": True})
    assert res.status_code == 200, res.text
    member_id = res.json()["member_id"]
    member = owner.get(f"/api/members/{member_id}").json()
    assert member["name"] == "신청아이" and member["mother_phone"] == "010-1212-3434"
    assert [c["class_id"] for c in member["classes"]] == [cls["class_id"]]
    # 학부모: 학원에 입장하면 자녀·청구서가 바로 보임
    assert parent.post(f"/api/parent/facilities/{owner.facility_id}/enter").status_code == 200
    assert [c["member_id"] for c in parent.get("/api/parent/children").json()] == [member_id]
    assert parent.get("/api/parent/invoices").json()[0]["amount"] == 120000
    assert parent.get("/api/parent/applications").json()[0]["status"] == "APPROVED"


def test_per_class_attendance_same_day(owner):
    c1, c2 = _class(owner, "오전반"), _class(owner, "오후반")
    member = owner.post("/api/members", json={"name": "두수업", "gender": "M", "age": 11,
                                              "enrollment_date": main._today().isoformat()}).json()
    for c in (c1, c2):
        owner.post(f"/api/classes/{c['class_id']}/members/{member['member_id']}")
    today = main._today().isoformat()
    r1 = owner.post("/api/attendances/mark", json={"member_id": member["member_id"], "attendance_date": today,
                                                   "status": "PRESENT", "class_id": c1["class_id"]})
    r2 = owner.post("/api/attendances/mark", json={"member_id": member["member_id"], "attendance_date": today,
                                                   "status": "ABSENT", "class_id": c2["class_id"]})
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    rows = owner.get("/api/attendances", params={"target_date": today, "class_id": c2["class_id"]}).json()
    assert [(r["member_id"], r["status"], r["class_name"]) for r in rows] == [(member["member_id"], "ABSENT", "오후반")]
    summary = owner.get(f"/api/members/{member['member_id']}/attendance-summary").json()
    assert {b["class_name"] for b in summary["by_class"]} >= {"오전반", "오후반"}
    other = _class(owner, "남의반")
    bad = owner.post("/api/attendances/mark", json={"member_id": member["member_id"], "attendance_date": today,
                                                    "status": "PRESENT", "class_id": other["class_id"]})
    assert bad.status_code == 400                                               # 수강하지 않는 수업


def test_board_search_posting_and_moderation(owner):
    owner.post("/api/notices", json={"title": "게시판 공지 단어", "content": "공지 본문"})
    admin_post = owner.post("/api/community/posts", json={"title": "관리자 글", "content": "운영 안내 본문",
                                                          "category": "INFO"}).json()
    writer = parent_in("board-writer@example.com", owner.facility_id)
    reader = parent_in("board-reader@example.com", owner.facility_id)
    assert writer.put("/api/parent/membership", json={"nickname": "관리자맘"}).status_code == 400
    assert writer.put("/api/parent/membership", json={"nickname": "하늘맘"}).status_code == 200
    ok = writer.post("/api/parent/community/posts", json={"title": "준비물 질문", "content": "띠매듭색상 사이즈 어떻게 고르나요?",
                                                          "category": "QUESTION"})
    assert ok.status_code == 201 and ok.json()["author"] == "하늘맘" and ok.json()["status"] == "VISIBLE"
    bad = writer.post("/api/parent/community/posts", json={"title": "부업", "content": "고수익 부업 오픈채팅 bit.ly/abcd",
                                                           "category": "FREE"}).json()
    assert bad["status"] == "PENDING"
    board = reader.get("/api/parent/community/board", params={"q": "띠매듭색상", "field": "content"}).json()
    assert [i["key"] for i in board["items"]] == [f"p{ok.json()['post_id']}"]
    titles = reader.get("/api/parent/community/board", params={"q": "공지 단어", "field": "title"}).json()
    assert titles["items"][0]["kind"] == "notice"
    all_items = reader.get("/api/parent/community/board").json()["items"]
    assert bad["post_id"] not in [i.get("post_id") for i in all_items]       # 검토 대기 글은 다른 학부모에게 숨김
    assert reader.get(f"/api/parent/community/posts/{bad['post_id']}").status_code == 404
    assert writer.get(f"/api/parent/community/posts/{bad['post_id']}").status_code == 200
    assert reader.delete(f"/api/parent/community/posts/{ok.json()['post_id']}").status_code == 404   # 남의 글 삭제 불가
    assert reader.put(f"/api/parent/community/posts/{admin_post['post_id']}",
                      json={"title": "x", "content": "y"}).status_code == 403
    queue = owner.get("/api/community/moderation/posts").json()
    assert any(p["post_id"] == bad["post_id"] for p in queue)
    owner.post(f"/api/community/posts/{bad['post_id']}/moderate", json={"decision": "HIDDEN"})
    assert writer.get(f"/api/parent/community/posts/{bad['post_id']}").status_code == 404
    # 조회수 증가 + 관리자 화면 게시판
    reader.get(f"/api/parent/community/posts/{ok.json()['post_id']}")
    admin_board = owner.get("/api/community/board", params={"category": "QUESTION"}).json()
    item = next(i for i in admin_board["items"] if i.get("post_id") == ok.json()["post_id"])
    assert item["view_count"] >= 1 and item["author_role"] == "parent"


def test_member_sanctions(owner):
    target = parent_in("sanction-target@example.com", owner.facility_id)
    post = owner.post("/api/community/posts", json={"title": "제재 테스트", "content": "본문"}).json()
    members = owner.get("/api/community/members").json()
    me = next(m for m in members if m["email"].startswith("sa") and m["email"].endswith("@example.com")
              and m["name"] == "sanction-target")
    assert "@example.com" in me["email"] and "sanction-target@" not in me["email"]   # 이메일 마스킹
    mid = me["membership_id"]
    assert owner.post(f"/api/community/members/{mid}/sanction", json={"action": "mute", "days": 3,
                                                                      "reason": "도배"}).status_code == 200
    blocked = target.post(f"/api/parent/community/posts/{post['post_id']}/comments", json={"content": "안녕하세요"})
    assert blocked.status_code == 403 and "제한" in blocked.json()["detail"]
    assert target.get("/api/parent/community/board").status_code == 200        # 읽기는 가능
    assert target.delete(f"/api/parent/facilities/{owner.facility_id}/membership").status_code == 409   # 제재 회피 탈퇴 불가
    owner.post(f"/api/community/members/{mid}/sanction", json={"action": "unmute"})
    assert target.post(f"/api/parent/community/posts/{post['post_id']}/comments", json={"content": "안녕하세요"}).status_code == 201
    owner.post(f"/api/community/members/{mid}/sanction", json={"action": "ban", "reason": "반복 위반"})
    assert target.get("/api/parent/community/board").status_code == 403
    assert target.post(f"/api/parent/facilities/{owner.facility_id}/enter").status_code == 403
    owner.post(f"/api/community/members/{mid}/sanction", json={"action": "unban"})
    assert target.get("/api/parent/community/board").status_code == 200


def test_classes_color_fee_and_roster(owner):
    a = owner.post("/api/members", json={"name": "명단A", "gender": "M", "age": 9,
                                         "enrollment_date": main._today().isoformat()}).json()
    b = owner.post("/api/members", json={"name": "명단B", "gender": "F", "age": 9,
                                         "enrollment_date": main._today().isoformat()}).json()
    cls = _class(owner, "색상반", color="#12ab34", monthly_fee=88000, student_ids=[a["member_id"], b["member_id"]],
                 start_date="", end_date="")
    assert cls["color"] == "#12AB34" and cls["monthly_fee"] == 88000 and cls["student_count"] == 2
    updated = owner.put(f"/api/classes/{cls['class_id']}", json={
        "name": "색상반2", "teacher": "강사", "color": "#000000", "student_ids": [b["member_id"]],
        "schedules": [{"day": "MON", "start": "10:00", "end": "11:00"}]}).json()
    assert updated["name"] == "색상반2" and [s["member_id"] for s in updated["students"]] == [b["member_id"]]
    assert owner.post("/api/classes", json={"name": "x", "teacher": "y", "color": "red"}).status_code == 422


def test_legacy_single_facility_migration(tmp_path):
    """v8(학원 개념 없음) DB → v9 마이그레이션: 첫 학원 생성 + 기존 행·관리자·학부모 배정 + 출결 고유조건 변경"""
    from sqlalchemy import create_engine, text
    path = tmp_path / "legacy.db"
    eng = create_engine(f"sqlite:///{path}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE members (member_id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL, gender VARCHAR(1), "
                          "age INTEGER, enrollment_date DATE, status VARCHAR(20))"))
        conn.execute(text("CREATE TABLE attendances (attendance_id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL, "
                          "attendance_date DATE NOT NULL, status VARCHAR(10) NOT NULL, check_in_time TIME, check_out_time TIME, "
                          "created_at TIMESTAMP, CONSTRAINT uq_attendance_member_date UNIQUE (member_id, attendance_date))"))
        conn.execute(text("CREATE TABLE academy_settings (setting_key VARCHAR(64) PRIMARY KEY, setting_value TEXT NOT NULL, "
                          "updated_at TIMESTAMP)"))
        conn.execute(text("INSERT INTO members (member_id, name, gender, age, status) VALUES (1, '옛학생', 'M', 10, 'ACTIVE')"))
        conn.execute(text("INSERT INTO attendances (member_id, attendance_date, status) VALUES (1, '2026-01-02', 'PRESENT')"))
        conn.execute(text("INSERT INTO academy_settings VALUES ('academy_info', '{\"name\": \"옛 도장\", \"facilityType\": \"도장\", "
                          "\"principal\": \"김관장\"}', NULL)"))
    original = main.engine
    main.engine = eng
    try:
        main.init_db()
        main.init_db()                                   # 두 번째는 버전 확인만 하고 종료
        with eng.connect() as conn:
            fac = conn.execute(text("SELECT facility_id, name, facility_type FROM facilities")).fetchall()
            assert [(f[1], f[2]) for f in fac] == [("옛 도장", "도장")]
            assert conn.execute(text("SELECT facility_id FROM members")).scalar() == fac[0][0]
            assert conn.execute(text("SELECT facility_id FROM attendances")).scalar() == fac[0][0]
            assert conn.execute(text("SELECT meta_value FROM app_meta WHERE meta_key='schema_version'")).scalar() == main.SCHEMA_VERSION
            # 같은 날 다른 수업 출결이 가능해짐 (기존 데이터 보존)
            conn.execute(text("INSERT INTO attendances (member_id, attendance_date, status, class_id, facility_id) "
                              "VALUES (1, '2026-01-02', 'LATE', 7, :f)"), {"f": fac[0][0]})
            assert conn.execute(text("SELECT COUNT(*) FROM attendances")).scalar() == 2
    finally:
        main.engine = original
        eng.dispose()

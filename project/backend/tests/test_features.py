"""v8.1 기능 테스트 — 알림·키오스크·반 공지·과제·수납·모니터링·인사이트·데모 데이터"""
import io
from datetime import date, datetime, timedelta

import pytest

import main
from conftest import login, parent_in

PARENT_PHONE = "010-2468-1357"
FACILITY = {}


@pytest.fixture(autouse=True)
def _facility(owner):
    FACILITY["id"] = owner.facility_id


def _parent(email):
    return parent_in(email, FACILITY["id"])


def _member(owner, name, phone=PARENT_PHONE):
    res = owner.post("/api/members", json={"name": name, "gender": "F", "age": 10,
                                          "enrollment_date": date.today().isoformat(), "mother_phone": phone})
    assert res.status_code == 201, res.text
    return res.json()["member_id"]


def _linked_parent(email, child_name, phone=PARENT_PHONE):
    parent = _parent(email)
    assert parent.post("/api/parent/children", json={"child_name": child_name, "phone": phone}).status_code == 201
    return parent


def _unread(parent, kind=None):
    items = parent.get("/api/parent/notifications").json()["items"]
    return [n for n in items if not n["is_read"] and (kind is None or n["kind"] == kind)]


def test_todos_are_saved_per_account(owner):
    res = owner.post("/api/todos", json={"text": "상담 준비", "due_time": "13:30", "tag": "success"})
    assert res.status_code == 201
    todo = res.json()
    assert any(t["todo_id"] == todo["todo_id"] for t in owner.get("/api/todos").json())
    assert any(t["text"] == "상담 준비" for t in owner.get("/api/admin/summary").json()["todos"])   # 정시 알림용
    assert owner.put(f"/api/todos/{todo['todo_id']}", json={**todo, "done": True}).json()["done"] is True
    assert owner.post("/api/todos", json={"text": "x", "due_time": "25:00"}).status_code == 422
    assert owner.delete("/api/todos?done_only=true").json()["deleted"] >= 1


def test_attendance_mark_notifies_parent_and_checkout(owner):
    member_id = _member(owner, "알림학생")
    parent = _linked_parent("notify-parent@example.com", "알림학생")
    today = main._today().isoformat()
    res = owner.post("/api/attendances/mark", json={"member_id": member_id, "attendance_date": today, "status": "PRESENT"})
    assert res.status_code == 200 and res.json()["check_in_time"]
    assert [n["title"] for n in _unread(parent, "CHECK_IN")] == ["알림학생 학생 출석"]
    # 같은 상태로 다시 저장해도 알림은 중복되지 않음 (upsert)
    owner.post("/api/attendances/mark", json={"member_id": member_id, "attendance_date": today, "status": "PRESENT"})
    assert len(_unread(parent, "CHECK_IN")) == 1
    out = owner.post(f"/api/attendances/{res.json()['attendance_id']}/checkout")
    assert out.status_code == 200 and out.json()["check_out_time"]
    assert owner.post(f"/api/attendances/{res.json()['attendance_id']}/checkout").status_code == 409
    assert len(_unread(parent, "CHECK_OUT")) == 1
    assert parent.post("/api/parent/notifications/read", json={"all": True}).json()["updated"] >= 2
    assert parent.get("/api/parent/summary").json()["unread_notifications"] == 0
    child = next(c for c in parent.get("/api/parent/children").json() if c["member_id"] == member_id)
    assert child["today"]["status"] == "PRESENT" and child["today"]["check_out_time"]


def test_bulk_attendance_only_unchecked(owner):
    a, b = _member(owner, "일괄A", "010-1357-0001"), _member(owner, "일괄B", "010-1357-0002")
    day = (main._today() - timedelta(days=1)).isoformat()
    owner.post("/api/attendances/mark", json={"member_id": a, "attendance_date": day, "status": "LATE"})
    res = owner.post("/api/attendances/bulk", json={"attendance_date": day, "member_ids": [a, b], "status": "ABSENT"})
    assert res.json() == {"changed": 1, "skipped": 1}
    rows = {r["member_id"]: r["status"] for r in owner.get(f"/api/attendances?target_date={day}").json()}
    assert rows[a] == "LATE" and rows[b] == "ABSENT"


def test_kiosk_check_in_out_with_masked_names(owner):
    member_id = _member(owner, "키오스크", "010-5555-7788")
    parent = _linked_parent("kiosk-parent@example.com", "키오스크", "010-5555-7788")
    found = owner.get("/api/kiosk/lookup?digits=7788").json()
    me = next(f for f in found if f["member_id"] == member_id)
    assert me["masked_name"] == "키**스" or me["masked_name"].startswith("키") and "*" in me["masked_name"]
    assert "name" not in me and me["next_action"] == "in"
    res = owner.post("/api/kiosk/check", json={"member_id": member_id, "action": "in"})
    assert res.status_code == 200 and res.json()["today_status"] in ("PRESENT", "LATE") and res.json()["parent_notified"]
    assert owner.post("/api/kiosk/check", json={"member_id": member_id, "action": "in"}).status_code == 409
    assert owner.post("/api/kiosk/check", json={"member_id": member_id, "action": "out"}).json()["next_action"] == "done"
    kinds = {n["kind"] for n in _unread(parent)}
    assert {"CHECK_IN", "CHECK_OUT"} <= kinds
    assert owner.get("/api/kiosk/today").json()["checked_out"] >= 1
    assert owner.get("/api/kiosk/lookup?digits=12a4").status_code == 400


def test_late_detection_uses_class_schedule(owner):
    member_id = _member(owner, "지각판정", "010-4444-0001")
    today = main._today()
    code = main.WEEKDAY_CODES[today.weekday()]
    cls = owner.post("/api/classes", json={"name": "시간표반", "teacher": "강사", "start_date": (today - timedelta(days=1)).isoformat(),
                                           "end_date": (today + timedelta(days=30)).isoformat(),
                                           "schedules": [{"day": code, "start": "14:00", "end": "15:00"},
                                                         {"day": "SAT", "start": "10:00", "end": "11:00"}]}).json()
    assert [s["start"] for s in cls["schedules"]] == ["14:00", "10:00"]                # 요일별 시간 저장
    owner.post(f"/api/classes/{cls['class_id']}/members/{member_id}")
    db = main.SessionLocal()
    db.info["facility_id"] = FACILITY["id"]          # 요청 밖에서 직접 호출할 때는 시설 문맥을 지정
    try:
        at = lambda h, m: datetime.combine(today, datetime.min.time()).replace(hour=h, minute=m)  # noqa: E731
        assert main._auto_check_in_status(db, member_id, at(13, 50)) == "PRESENT"
        assert main._auto_check_in_status(db, member_id, at(14, 10)) == "PRESENT"   # 유예 10분
        assert main._auto_check_in_status(db, member_id, at(14, 25)) == "LATE"
    finally:
        db.close()
    bad = owner.put(f"/api/classes/{cls['class_id']}", json={"name": "시간표반", "teacher": "강사",
                                                             "start_date": today.isoformat(), "end_date": today.isoformat(),
                                                             "schedules": [{"day": "MON", "start": "15:00", "end": "14:00"}]})
    assert bad.status_code == 400


def test_class_notice_targets_only_enrolled_parents(owner):
    inside = _member(owner, "반공지대상", "010-9000-0001")
    outside = _member(owner, "반공지외", "010-9000-0002")
    cls = owner.post("/api/classes", json={"name": "공지반", "teacher": "강사", "start_date": "2026-01-01",
                                           "end_date": "2026-12-31"}).json()
    owner.post(f"/api/classes/{cls['class_id']}/members/{inside}")
    p_in = _linked_parent("notice-in@example.com", "반공지대상", "010-9000-0001")
    p_out = _linked_parent("notice-out@example.com", "반공지외", "010-9000-0002")
    notice = owner.post("/api/notices", json={"title": "공지반 준비물", "content": "도복 지참", "class_id": cls["class_id"]}).json()
    assert notice["class_name"] == "공지반" and notice["target_count"] == 1
    seen_in = [n for n in p_in.get("/api/parent/notices").json() if n["notice_id"] == notice["notice_id"]]
    assert seen_in and seen_in[0]["for_children"] == ["반공지대상"] and seen_in[0]["is_read"] is False
    assert not [n for n in p_out.get("/api/parent/notices").json() if n["notice_id"] == notice["notice_id"]]
    assert _unread(p_in, "NOTICE") and not [n for n in _unread(p_out, "NOTICE") if "공지반" in n["title"]]
    assert p_in.post("/api/parent/notices/read", json={"notice_ids": [notice["notice_id"]]}).json()["marked"] == 1
    listed = next(n for n in owner.get("/api/notices").json() if n["notice_id"] == notice["notice_id"])
    assert listed["read_count"] == 1
    assert outside


def test_assignment_file_edit_and_submissions(owner):
    member_id = _member(owner, "과제학생", "010-7000-0001")
    cls = owner.post("/api/classes", json={"name": "과제반", "teacher": "강사", "start_date": "2026-01-01",
                                           "end_date": "2026-12-31"}).json()
    owner.post(f"/api/classes/{cls['class_id']}/members/{member_id}")
    parent = _linked_parent("assign-parent@example.com", "과제학생", "010-7000-0001")
    stranger = _parent("assign-stranger@example.com")
    res = owner.post(f"/api/classes/{cls['class_id']}/assignments",
                     data={"title": "연습 기록", "due_date": "2026-12-01", "content": "매일"},
                     files={"file": ("기록표.txt", io.BytesIO("내용".encode()), "text/plain")})
    assert res.status_code == 200, res.text
    aid = res.json()["assignment_id"]
    file_res = owner.get(f"/api/assignments/{aid}/file")
    assert file_res.status_code == 200 and file_res.content.decode() == "내용"
    assert parent.get(f"/api/parent/assignments/{aid}/file").status_code == 200
    assert stranger.get(f"/api/parent/assignments/{aid}/file").status_code == 403
    edited = owner.put(f"/api/assignments/{aid}", data={"title": "연습 기록(수정)", "due_date": "2026-12-05", "remove_file": "true"})
    assert edited.status_code == 200 and edited.json()["has_file"] is False and edited.json()["title"] == "연습 기록(수정)"
    assert owner.put(f"/api/assignments/{aid}/submissions/{member_id}", json={"status": "SUBMITTED"}).status_code == 200
    subs = owner.get(f"/api/assignments/{aid}/submissions").json()
    assert subs == [{"member_id": member_id, "name": "과제학생", "status": "SUBMITTED", "note": None,
                     "checked_at": subs[0]["checked_at"]}]
    mine = next(a for a in parent.get("/api/parent/assignments").json() if a["assignment_id"] == aid)
    assert mine["children"][0]["status"] == "SUBMITTED"
    assert [a for a in owner.get(f"/api/classes/{cls['class_id']}/assignments").json()][0]["submitted"] == 1
    assert owner.post(f"/api/classes/{cls['class_id']}/assignments", data={"title": "x", "due_date": "2026/12/01"}).status_code == 400


def test_bulk_invoices_and_on_site_payment(owner):
    settings = owner.get("/api/settings").json()
    cls = owner.post("/api/classes", json={"name": "수강료반", "teacher": "강사", "start_date": "2026-01-01",
                                           "end_date": "2026-12-31"}).json()
    settings["payment"]["classFees"] = [{"classId": cls["class_id"], "fee": 123000}]
    settings["payment"]["baseTuitionFee"] = 99000
    assert owner.put("/api/settings", json=settings).status_code == 200
    member_id = _member(owner, "청구학생", "010-8000-0001")
    owner.post(f"/api/classes/{cls['class_id']}/members/{member_id}")
    parent = _linked_parent("bill-parent@example.com", "청구학생", "010-8000-0001")
    res = owner.post("/api/invoices/bulk", json={"class_id": cls["class_id"], "item_name": "12월 수강료", "due_date": "2026-12-10"})
    assert res.status_code == 201 and res.json()["created"] == 1 and res.json()["total_amount"] == 123000
    assert owner.post("/api/invoices/bulk", json={"class_id": cls["class_id"], "item_name": "12월 수강료"}).json()["skipped_existing"] == 1
    assert _unread(parent, "INVOICE")
    member = next(m for m in owner.get("/api/members").json() if m["member_id"] == member_id)
    assert member["unpaid_amount"] == 123000
    invoice = next(i for i in owner.get("/api/invoices?status=UNPAID").json() if i["member_id"] == member_id)
    paid = owner.post(f"/api/invoices/{invoice['invoice_id']}/mark-paid", json={"method": "TRANSFER"})
    assert paid.status_code == 200 and paid.json()["status"] == "PAID"
    assert owner.post(f"/api/invoices/{invoice['invoice_id']}/mark-paid", json={"method": "CASH"}).status_code == 409
    assert any(p["member_id"] == member_id and p["method"] == "TRANSFER" for p in owner.get("/api/payments").json())
    assert _unread(parent, "PAYMENT")


def test_member_notes_and_parent_notify(owner):
    member_id = _member(owner, "상담학생", "010-6000-0001")
    assert owner.post(f"/api/members/{member_id}/notes", json={"content": "상담 완료"}).status_code == 201
    assert owner.get(f"/api/members/{member_id}/notes").json()[0]["content"] == "상담 완료"
    assert owner.post(f"/api/members/{member_id}/notify", json={"message": "미납 안내"}).json()["sent"] == 0
    parent = _linked_parent("notes-parent@example.com", "상담학생", "010-6000-0001")
    assert owner.post(f"/api/members/{member_id}/notify", json={"message": "미납 안내"}).json()["sent"] == 1
    assert _unread(parent, "UNPAID")[0]["body"] == "미납 안내"
    found = owner.get("/api/members?q=6000-0001").json()       # 전화번호 일부로 검색
    assert [m["member_id"] for m in found] == [member_id]


def test_comment_moderation_flow(owner):
    _member(owner, "댓글학생", "010-3000-0001")
    writer = _linked_parent("bad-writer@example.com", "댓글학생", "010-3000-0001")
    other = _parent("other-reader@example.com")
    post = owner.post("/api/community/posts", json={"content": "모니터링 테스트"}).json()
    bad = writer.post(f"/api/parent/community/posts/{post['post_id']}/comments", json={"content": "시1발 진짜"}).json()
    good = writer.post(f"/api/parent/community/posts/{post['post_id']}/comments", json={"content": "감사합니다"}).json()
    assert bad["pending_review"] is True and good["pending_review"] is False
    assert [c["comment_id"] for c in other.get(f"/api/parent/community/posts/{post['post_id']}/comments").json()] == [good["comment_id"]]
    assert {c["comment_id"] for c in writer.get(f"/api/parent/community/posts/{post['post_id']}/comments").json()} == {bad["comment_id"], good["comment_id"]}
    queue = owner.get("/api/community/moderation").json()
    assert any(q["comment_id"] == bad["comment_id"] and "욕설" in q["review"]["reasons"] for q in queue)
    assert owner.get("/api/admin/summary").json()["badges"]["moderation_pending"] >= 1
    owner.post(f"/api/community/comments/{bad['comment_id']}/moderate", json={"decision": "HIDDEN"})
    owner.post(f"/api/community/comments/{good['comment_id']}/moderate", json={"decision": "HIDDEN"})   # 놓친 댓글
    assert bad["comment_id"] not in [c["comment_id"] for c in writer.get(f"/api/parent/community/posts/{post['post_id']}/comments").json()]
    stats = owner.get("/api/community/moderation/stats").json()
    assert stats["true_positive"] >= 1 and stats["false_negative"] >= 1 and stats["precision"] is not None
    writer.post(f"/api/parent/community/posts/{post['post_id']}/comments", json={"content": "연락처 010-1111-2222 입니다"})
    csv_text = owner.get("/api/community/moderation/export").text
    assert "010-1111-2222" not in csv_text and "text,label,source" in csv_text


def test_like_toggles_once_per_user(owner):
    post = owner.post("/api/community/posts", json={"content": "좋아요 테스트"}).json()
    parent = _parent("liker@example.com")
    assert parent.post(f"/api/parent/community/posts/{post['post_id']}/like").json() == {"post_id": post["post_id"], "like_count": 1, "liked": True}
    assert owner.post(f"/api/community/posts/{post['post_id']}/like").json()["like_count"] == 2
    assert parent.post(f"/api/parent/community/posts/{post['post_id']}/like").json()["like_count"] == 1   # 다시 누르면 취소
    feed = next(p for p in parent.get("/api/parent/community/posts").json() if p["post_id"] == post["post_id"])
    assert feed["liked"] is False and feed["like_count"] == 1


def test_dashboard_insights_shape(owner):
    data = owner.get("/api/dashboard/insights").json()
    assert {"members", "attendance", "classes", "billing", "revenue", "unpaid_members", "risk_students",
            "parents", "recent_activity", "definitions"} <= set(data)
    assert len(data["attendance"]["this_week"]) == 7 and len(data["revenue"]["months"]) == 6
    assert data["billing"]["unpaid_total"] >= 0 and "attendance_rate_today" in data["definitions"]


def test_b2b_settlement_can_be_completed(owner):
    product = owner.get("/api/b2b/products").json()[0]
    order = owner.post("/api/b2b/orders", json={"items": [{"sku": product["sku"], "quantity": product["minimum_quantity"]}],
                                                 "payment_method": "월말 일괄 정산"}).json()
    assert order["status"] == "SETTLEMENT_PENDING"
    assert owner.post(f"/api/b2b/orders/{order['order_id']}/settle").json()["status"] == "PAID"
    assert owner.post(f"/api/b2b/orders/{order['order_id']}/settle").status_code == 409


def test_demo_data_requires_force_when_members_exist(owner):
    assert owner.post("/api/admin/demo-data", json={}).status_code == 409
    res = owner.post("/api/admin/demo-data", json={"force": True})
    assert res.status_code == 201, res.text
    assert owner.get("/api/kiosk/lookup?digits=1000").json()
    data = owner.get("/api/dashboard/insights").json()
    assert data["revenue"]["months"][-2]["amount"] > 0 and data["risk_students"]
    assert owner.get("/api/community/moderation/stats").json()["auto_flagged"] >= 2


def test_staff_can_use_kiosk_but_not_member_admin(owner):
    owner.post("/api/admin/accounts", json={"email": "front-desk@example.com", "role": "staff"})
    staff = login("front-desk@example.com", "admin")
    assert staff.post(f"/api/facilities/{FACILITY['id']}/enter").status_code == 200
    assert staff.get("/api/kiosk/today").status_code == 200
    assert staff.get("/api/admin/summary").status_code == 200
    assert staff.get("/api/todos").status_code == 403
    assert staff.get("/api/dashboard/insights").status_code == 403


def test_parent_attendance_rate_matches_dashboard_definition(owner):
    """학부모 포털 출석률도 대시보드와 같은 정의: (출석 + 지각) ÷ 출결 기록 수"""
    member_id = _member(owner, "정의학생", "010-1357-2468")
    parent = _linked_parent("rate-parent@example.com", "정의학생", "010-1357-2468")
    today = main._today()
    for offset, status in ((1, "PRESENT"), (2, "LATE"), (3, "ABSENT"), (4, "PRESENT")):
        day = (today - timedelta(days=offset)).isoformat()
        assert owner.post("/api/attendances/mark", json={"member_id": member_id, "attendance_date": day,
                                                         "status": status}).status_code == 200
    summary = parent.get("/api/parent/attendances", params={"member_id": member_id, "days": 30}).json()["summary"]
    assert (summary["present"], summary["late"], summary["absent"]) == (2, 1, 1)
    assert summary["rate"] == 75.0


def test_demo_data_seeds_admin_notifications_and_activity(owner):
    owner.post("/api/admin/demo-data", json={"force": True})
    summary = owner.get("/api/admin/summary").json()
    assert summary["unread_notifications"] >= 2
    kinds = {n["kind"] for n in owner.get("/api/notifications").json()["items"]}
    assert {"MODERATION", "PAYMENT"} <= kinds
    with main.SessionLocal() as db:   # 다른 테스트의 최신 로그에 밀릴 수 있어 DB 에서 직접 확인
        assert db.query(main.ActivityLog).filter(main.ActivityLog.actor_type == "kiosk").count() >= 3

"""v13: 로그인 유지(슬라이딩 세션) · 메인 화면 전체 학원 알림 · 대시보드 활동 전체 이력"""
from datetime import timedelta

import main
from conftest import create_facility, login


def _session_row(client):
    raw = client.cookies.get(main.AUTH_COOKIE_NAME)
    db = main.SessionLocal()
    try:
        return db, db.query(main.UserSession).filter(main.UserSession.token_hash == main._hash_token(raw)).first()
    except Exception:
        db.close()
        raise


def test_session_is_extended_while_in_use():
    client = login("keep-login@example.com", "admin", "owner-invite-code")
    db, session = _session_row(client)
    try:
        # 만료 하루 전 상태로 만든 뒤 /api/auth/me 를 부르면 다시 AUTH_SESSION_DAYS 만큼 늘어나야 함
        session.expires_at = main._now() + timedelta(days=1)
        db.commit()
    finally:
        db.close()
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert main.AUTH_COOKIE_NAME in res.headers.get("set-cookie", "")
    db, session = _session_row(client)
    try:
        assert session.expires_at > main._now() + timedelta(days=main.AUTH_SESSION_DAYS - 1)
    finally:
        db.close()


def test_logout_still_ends_session():
    client = login("logout-check@example.com", "admin", "owner-invite-code")
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def _notify(facility_id, user_id, title):
    db = main.SessionLocal()
    try:
        db.add(main.Notification(facility_id=facility_id, user_id=user_id, audience="admin", kind="NOTICE", title=title))
        db.commit()
    finally:
        db.close()


def test_main_screen_notifications_cover_all_my_facilities():
    owner = login("multi-owner@example.com", "admin", "owner-invite-code")
    a = create_facility(owner, "알림 학원 A")
    b = create_facility(owner, "알림 학원 B")
    other = login("other-owner@example.com", "admin", "owner-invite-code")
    c = create_facility(other, "남의 학원")
    db = main.SessionLocal()
    try:
        uid = db.query(main.AppUser.user_id).filter(main.AppUser.email == "multi-owner@example.com").scalar()
    finally:
        db.close()
    _notify(a, uid, "A 알림")
    _notify(b, uid, "B 알림")
    _notify(c, uid, "권한 없는 학원 알림")   # 내 학원이 아니면 보이면 안 됨

    res = owner.get("/api/facilities/notifications").json()
    names = {n["facility_name"] for n in res["items"]}
    assert {"알림 학원 A", "알림 학원 B"} <= names
    assert "남의 학원" not in names
    assert res["unread_by_facility"].get(str(a), res["unread_by_facility"].get(a)) >= 1

    first = next(n for n in res["items"] if n["facility_id"] == a)
    assert owner.post("/api/facilities/notifications/read", json={"ids": [first["notification_id"]]}).json()["updated"] == 1
    assert owner.post("/api/facilities/notifications/read", json={"all": True}).json()["updated"] >= 1
    assert owner.get("/api/facilities/notifications").json()["unread"] == 0


def test_dashboard_activity_history_paging(owner):
    db = main.SessionLocal()
    try:
        for i in range(7):
            db.add(main.ActivityLog(facility_id=owner.facility_id, actor_type="admin", action="TEST", summary=f"활동 {i}"))
        db.commit()
    finally:
        db.close()
    page1 = owner.get("/api/dashboard/activity", params={"limit": 5}).json()
    assert page1["total"] >= 7 and len(page1["items"]) == 5
    page2 = owner.get("/api/dashboard/activity", params={"limit": 5, "offset": 5}).json()
    assert {i["log_id"] for i in page1["items"]}.isdisjoint({i["log_id"] for i in page2["items"]})
    assert all(i["actor_type"] == "admin" for i in owner.get("/api/dashboard/activity", params={"actor": "admin"}).json()["items"])

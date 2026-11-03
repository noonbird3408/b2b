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


# ---------------------------------------------------------------------
# 계정 설정 (이름·프로필 사진)
# ---------------------------------------------------------------------
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=="


def test_profile_name_and_avatar_survive_relogin():
    client = login("profile-user@example.com", "admin", "owner-invite-code")
    me = client.put("/api/auth/profile", json={"display_name": "김 원장", "avatar": PNG}).json()
    assert me["user"]["name"] == "김 원장" and me["user"]["picture"] == PNG and me["user"]["has_custom_avatar"]
    assert me["admin"]["username"] == "김 원장"          # 관리자 화면 이름도 함께 바뀜
    # 다시 로그인해도 Google 이름으로 덮어써지지 않음
    again = login("profile-user@example.com")
    assert again.get("/api/auth/me").json()["user"]["name"] == "김 원장"
    reset = again.put("/api/auth/profile", json={"display_name": "", "avatar": ""}).json()["user"]
    assert reset["name"] == "profile-user" and not reset["has_custom_avatar"]


def test_profile_rejects_bad_input_and_requires_login():
    client = login("profile-bad@example.com")
    assert client.put("/api/auth/profile", json={"avatar": "javascript:alert(1)"}).status_code == 422
    assert client.put("/api/auth/profile", json={"display_name": "<b>"}).status_code == 422
    from fastapi.testclient import TestClient
    assert TestClient(main.app).put("/api/auth/profile", json={"display_name": "익명"}).status_code == 401


# ---------------------------------------------------------------------
# 초대 코드 (6자리 / 링크)
# ---------------------------------------------------------------------
def test_parent_invite_joins_private_facility():
    owner = login("invite-owner@example.com", "admin", "owner-invite-code")
    fid = create_facility(owner, "비공개 초대 학원", is_public=False)
    inv = owner.post("/api/invites", json={"role": "parent", "expires_days": 3, "max_uses": 1})
    assert inv.status_code == 201, inv.text
    code = inv.json()["code"]
    assert len(code) == 6 and code.isdigit()

    parent = login("invite-parent@example.com")          # 역할 선택 전에도 사용 가능
    preview = parent.post("/api/auth/invite/preview", json={"code": code}).json()
    assert preview["facility"]["name"] == "비공개 초대 학원" and preview["role"] == "parent"
    res = parent.post("/api/auth/invite/redeem", json={"code": f"{code[:3]} {code[3:]}"}).json()
    assert res["target"] == "/parentportal" and res["me"]["active_role"] == "parent"
    assert res["me"]["facility"]["facility_id"] == fid
    assert parent.get("/api/parent/summary").status_code == 200

    # 사용 횟수(1회)를 다 쓰면 다른 사람은 못 씀
    other = login("invite-parent2@example.com")
    assert other.post("/api/auth/invite/redeem", json={"code": code}).status_code == 404
    # 원장에게 알림
    assert any(n["kind"] == "LINK" for n in owner.get("/api/notifications").json()["items"])


def test_staff_invite_creates_staff_with_limited_access():
    owner = login("invite-owner2@example.com", "admin", "owner-invite-code")
    create_facility(owner, "직원 초대 학원")
    code = owner.post("/api/invites", json={"role": "staff"}).json()["code"]
    staff = login("invite-staff@example.com")             # 관리자 계정이 없던 사람
    res = staff.post("/api/auth/invite/redeem", json={"code": code}).json()
    assert res["target"] == "/attendances" and res["me"]["facility"]["my_role"] == "staff"
    assert staff.get("/api/attendances").status_code in (200, 422)
    assert staff.get("/api/invites").status_code == 403    # 초대 관리는 원장만


def test_invite_revoke_and_bruteforce_lock():
    owner = login("invite-owner3@example.com", "admin", "owner-invite-code")
    create_facility(owner, "폐기 학원")
    inv = owner.post("/api/invites", json={"role": "parent"}).json()
    assert owner.delete(f"/api/invites/{inv['invite_id']}").status_code == 204
    attacker = login("invite-attacker@example.com")
    assert attacker.post("/api/auth/invite/preview", json={"code": inv["code"]}).status_code == 404
    codes = [r.status_code for r in (attacker.post("/api/auth/invite/preview", json={"code": "000000"}) for _ in range(5))]
    assert codes[-1] == 429 or attacker.post("/api/auth/invite/preview", json={"code": "000001"}).status_code == 429


def test_facility_logo_on_create_and_update():
    owner = login("logo-owner@example.com", "admin", "owner-invite-code")
    res = owner.post("/api/facilities", json={"name": "로고 학원", "logo": PNG})
    assert res.status_code == 201 and res.json()["logo"] == PNG
    fid = res.json()["facility_id"]
    assert owner.put(f"/api/facilities/{fid}", json={"name": "로고 학원", "logo": ""}).json()["logo"] == ""
    assert owner.post("/api/facilities", json={"name": "나쁜 로고", "logo": "data:text/html;base64,AAAA"}).status_code == 422

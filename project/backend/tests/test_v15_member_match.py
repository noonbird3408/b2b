"""v15: 학생 추가 시 수강 등록 · 관리자가 먼저 등록한 학생 ↔ 학부모 가입 신청 중복 방지"""
import main
from conftest import create_facility, login


def _owner_with_class(email, name):
    owner = login(email, "admin", "owner-invite-code")
    fid = create_facility(owner, name)
    cls = owner.post("/api/classes", json={"name": "초등 A반", "teacher": "김선생", "monthly_fee": 150000,
                                           "schedules": [{"day": "MON", "start": "16:00", "end": "17:00"}]})
    assert cls.status_code in (200, 201), cls.text
    return owner, fid, cls.json()["class_id"]


def _member_payload(**extra):
    return {"name": "이준호", "gender": "M", "age": 9, "enrollment_date": "2026-03-02",
            "mother_name": "박엄마", "mother_phone": "010-1234-5678", **extra}


def test_create_member_with_classes_and_duplicate_guard():
    owner, fid, cid = _owner_with_class("match-owner1@example.com", "중복 방지 학원1")
    res = owner.post("/api/members", json=_member_payload(class_ids=[cid]))
    assert res.status_code == 201, res.text
    assert [c["class_id"] for c in res.json()["classes"]] == [cid]
    # 같은 이름·연락처 → 409, 동명이인 확인 후에는 등록 가능
    again = owner.post("/api/members", json=_member_payload())
    assert again.status_code == 409 and "이미 있습니다" in again.json()["detail"]
    assert owner.post("/api/members", json=_member_payload(allow_duplicate=True)).status_code == 201


def _parent_with_child(email, fid, phone="01012345678"):
    parent = login(email, "parent")
    child = parent.post("/api/parent/child-profiles", json={"name": "이 준호", "gender": "M", "age": 9,
                                                            "parent_name": "박엄마", "parent_phone": phone, "relation": "모"})
    assert child.status_code == 201, child.text
    return parent, child.json()["child_id"]


def test_parent_confirms_existing_child_and_approval_links_without_duplicate():
    owner, fid, cid = _owner_with_class("match-owner2@example.com", "중복 방지 학원2")
    member_id = owner.post("/api/members", json=_member_payload(class_ids=[cid])).json()["member_id"]
    parent, child_id = _parent_with_child("match-parent2@example.com", fid)

    check = parent.post(f"/api/parent/facilities/{fid}/applications/check", json={"child_id": child_id}).json()
    assert not check["already_linked"] and [m["member_id"] for m in check["matches"]] == [member_id]
    assert check["matches"][0]["name"] == "이*호"                      # 학부모에게는 이름 일부만
    assert "mother_phone" not in check["matches"][0]                    # 연락처는 내려주지 않음

    app = parent.post(f"/api/parent/facilities/{fid}/applications",
                      json={"child_id": child_id, "class_ids": [], "match_member_id": member_id, "match_answer": "YES"})
    assert app.status_code == 201, app.text
    pending = [a for a in owner.get("/api/applications", params={"status": "PENDING"}).json()
               if a["application_id"] == app.json()["application_id"]][0]
    assert pending["match_answer"] == "YES" and pending["possible_matches"][0]["member_id"] == member_id

    before = len(owner.get("/api/members").json())
    done = owner.post(f"/api/applications/{pending['application_id']}/approve", json={}).json()
    assert done["linked_existing"] and done["member_id"] == member_id
    assert len(owner.get("/api/members").json()) == before                # 학생이 늘어나지 않음
    db = main.SessionLocal()
    try:
        assert db.query(main.ParentLink).filter(main.ParentLink.member_id == member_id).count() == 1
    finally:
        db.close()
    # 이미 연결됐으면 다시 신청할 수 없음
    again = parent.post(f"/api/parent/facilities/{fid}/applications/check", json={"child_id": child_id}).json()
    assert again["already_linked"]


def test_approval_requires_choice_when_strong_match_exists():
    owner, fid, cid = _owner_with_class("match-owner3@example.com", "중복 방지 학원3")
    member_id = owner.post("/api/members", json=_member_payload()).json()["member_id"]
    parent, child_id = _parent_with_child("match-parent3@example.com", fid)
    app_id = parent.post(f"/api/parent/facilities/{fid}/applications",
                         json={"child_id": child_id, "class_ids": [cid]}).json()["application_id"]   # 확인 없이 신청
    blocked = owner.post(f"/api/applications/{app_id}/approve", json={})
    assert blocked.status_code == 409                                     # 실수로 중복 생성되지 않도록 선택 요구
    ok = owner.post(f"/api/applications/{app_id}/approve", json={"link_member_id": member_id, "class_ids": [cid]}).json()
    assert ok["member_id"] == member_id and ok["linked_existing"]


def test_parent_says_different_child_creates_new_member():
    owner, fid, cid = _owner_with_class("match-owner4@example.com", "중복 방지 학원4")
    owner.post("/api/members", json=_member_payload())
    parent, child_id = _parent_with_child("match-parent4@example.com", fid)
    app_id = parent.post(f"/api/parent/facilities/{fid}/applications",
                         json={"child_id": child_id, "class_ids": [], "match_answer": "NO"}).json()["application_id"]
    res = owner.post(f"/api/applications/{app_id}/approve", json={"create_new": True}).json()
    assert not res["linked_existing"]


def test_no_match_when_phone_differs():
    owner, fid, cid = _owner_with_class("match-owner5@example.com", "중복 방지 학원5")
    owner.post("/api/members", json=_member_payload())
    parent, child_id = _parent_with_child("match-parent5@example.com", fid, phone="01099998888")
    check = parent.post(f"/api/parent/facilities/{fid}/applications/check", json={"child_id": child_id}).json()
    assert check["matches"] == []                                         # 이름만 같으면 학부모에게는 보이지 않음

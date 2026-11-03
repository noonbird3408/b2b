"""v14 휴대폰 푸시 알림 — 구독 저장 · 알림 커밋 시 자동 발송 · 만료 구독 정리 · SSRF 차단"""
import os

import pytest

import main
from conftest import create_facility, login

pytestmark = pytest.mark.skipif(not main.PUSH_ENABLED, reason="cryptography 미설치 — pip install -r requirements.txt")


def _browser_subscription(host="fcm.googleapis.com"):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    key = ec.generate_private_key(ec.SECP256R1())
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {"endpoint": f"https://{host}/fcm/send/{os.urandom(8).hex()}",
            "keys": {"p256dh": main._webpush.b64url(pub), "auth": main._webpush.b64url(os.urandom(16))}}


@pytest.fixture()
def sent(monkeypatch):
    calls = []

    def fake_send(subscription, data, private, subject, **kw):
        calls.append({"endpoint": subscription["endpoint"], "data": data})
        return 410 if "gone" in subscription["endpoint"] else 201
    monkeypatch.setattr(main._webpush, "send", fake_send)
    return calls


def test_config_returns_public_key():
    cfg = login("push-cfg@example.com").get("/api/auth/push/config").json()
    assert cfg["enabled"] and len(main._webpush.b64url_decode(cfg["public_key"])) == 65


def test_subscribe_rejects_unknown_push_host():
    client = login("push-ssrf@example.com")
    bad = _browser_subscription("169.254.169.254")
    assert client.post("/api/auth/push/subscribe", json=bad).status_code == 422
    bad = _browser_subscription("evil.example.com")
    assert client.post("/api/auth/push/subscribe", json=bad).status_code == 422


def test_notification_commit_sends_push_and_test_endpoint(sent):
    owner = login("push-owner@example.com", "admin", "owner-invite-code")
    fid = create_facility(owner, "푸시 학원")
    sub = _browser_subscription()
    assert owner.post("/api/auth/push/subscribe", json={**sub, "device": "Android · Chrome"}).json()["ok"]

    # 학부모가 초대 코드로 들어오면 원장에게 알림 → 커밋 후 원장 휴대폰으로 푸시
    code = owner.post("/api/invites", json={"role": "parent"}).json()["code"]
    login("push-parent@example.com").post("/api/auth/invite/redeem", json={"code": code})
    pushed = [c for c in sent if c["endpoint"] == sub["endpoint"]]
    assert pushed, "알림이 커밋됐는데 푸시가 나가지 않음"
    assert "푸시 학원" in pushed[-1]["data"]["body"] and pushed[-1]["data"]["url"].startswith(f"/open?a=admin&f={fid}")

    assert owner.post("/api/auth/push/test", json={"endpoint": sub["endpoint"]}).json()["sent"] == 1
    assert owner.post("/api/auth/push/unsubscribe", json={"endpoint": sub["endpoint"]}).json()["removed"] == 1
    assert owner.post("/api/auth/push/test", json={"endpoint": sub["endpoint"]}).status_code == 404


def test_expired_subscription_is_removed(sent):
    client = login("push-gone@example.com")
    sub = _browser_subscription()
    sub["endpoint"] = sub["endpoint"].replace("/send/", "/send/gone-")
    client.post("/api/auth/push/subscribe", json=sub)
    client.post("/api/auth/push/test", json={"endpoint": sub["endpoint"]})      # 410 → 구독 삭제
    db = main.SessionLocal()
    try:
        assert db.query(main.PushSubscription).filter(main.PushSubscription.endpoint == sub["endpoint"]).count() == 0
    finally:
        db.close()

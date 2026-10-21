"""테스트 공통 설정: 임시 SQLite DB + 개발용 로그인으로 Google 없이 인증 흐름을 검증합니다.

PostgreSQL(Supabase 와 같은 DB 엔진)로 검증하려면 비어 있는 테스트용 DB 주소를 지정하세요.
  TEST_DATABASE_URL=postgresql://postgres:비밀번호@localhost:5432/facility_test pytest -q
  ⚠️ 운영 Supabase DB 주소는 넣지 마세요(테스트 데이터가 들어갑니다).
"""
import os
import sys
import tempfile

import pytest

_db_dir = tempfile.mkdtemp(prefix="facility-test-")
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL") or f"sqlite:///{os.path.join(_db_dir, 'test.db')}"
os.environ["DEV_LOGIN_ENABLED"] = "true"
os.environ["ADMIN_SIGNUP_CODE"] = "owner-invite-code"
os.environ["STAFF_SIGNUP_CODE"] = "staff-invite-code"
os.environ["CRON_SECRET"] = "cron-secret"
os.environ["DISABLE_SCHEDULER"] = "true"
os.environ["UPLOAD_DIR"] = os.path.join(_db_dir, "uploads")
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("KAKAO_SECRET_KEY", None)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

# 개발용 로그인은 SQLite 에서만 켜지므로, PostgreSQL 테스트 DB 에서도 쓰도록 테스트에서만 강제
main.DEV_LOGIN_ENABLED = True


def login(email: str, role: str = None, invite_code: str = "") -> TestClient:
    """새 브라우저(쿠키 저장소)처럼 동작하는 클라이언트를 만들고 로그인 + 역할 선택"""
    client = TestClient(main.app)
    res = client.post("/api/auth/dev-login", json={"email": email, "name": email.split("@")[0]})
    assert res.status_code == 200, res.text
    if role:
        res = client.post("/api/auth/role", json={"role": role, "invite_code": invite_code})
        assert res.status_code == 200, res.text
    return client


@pytest.fixture(scope="session")
def owner():
    return login("owner@example.com", "admin", "owner-invite-code")

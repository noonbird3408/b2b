#!/usr/bin/env python3
"""
학원 통합 관리 시스템 — 배포 준비 도우미 (Supabase + Google 로그인 + Vercel)

  python setup.py          # 대화형 배포 준비 (Windows: setup.bat 더블클릭)
  python setup.py check    # Supabase 연결·테이블 확인 (없으면 테이블 생성도 가능)
  python setup.py demo     # Supabase 에 발표·시연용 데모 데이터 넣기
  python setup.py test     # 백엔드 자동 테스트(pytest)
  python setup.py local    # (선택) 내 PC 미리보기 설치 → python setup.py run 으로 실행
  python setup.py clean    # 빌드 산출물·캐시를 _to_delete/ 로 이동

기본 실행이 하는 일
  1) Supabase 연결 주소(DATABASE_URL) 입력·형식 점검 — 자주 하는 실수([ ] 괄호, 직접 연결 주소)를 잡아 줌
  2) Google OAuth 클라이언트 ID 입력·형식 점검
  3) 관리자 초대 코드·Cron 비밀값을 무작위로 생성
  4) backend/.env (내 PC 용) 와 .env.vercel (Vercel 에 붙여 넣을 값) 파일 생성
     — 기존 값은 지우지 않고, 바꾼 항목만 갱신합니다.
  5) (선택) Supabase 에 실제로 접속해 테이블 상태 확인
"""
import os
import re
import secrets
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")
IS_WINDOWS = os.name == "nt"
VENV = os.path.join(BACKEND, "venv")
VENV_PY = os.path.join(VENV, "Scripts", "python.exe") if IS_WINDOWS else os.path.join(VENV, "bin", "python")
ENV_FILE = os.path.join(BACKEND, ".env")
VERCEL_ENV_FILE = os.path.join(ROOT, ".env.vercel")
ASSUME_YES = "--yes" in sys.argv or "-y" in sys.argv
MIN_CODE_LENGTH = 12

# Vercel 에 넣을 환경변수 (순서 = .env.vercel 에 쓰는 순서)
VERCEL_KEYS = ["DATABASE_URL", "GOOGLE_CLIENT_ID", "ADMIN_SIGNUP_CODE", "STAFF_SIGNUP_CODE", "CRON_SECRET",
               "GEMINI_API_KEY", "KAKAO_SECRET_KEY", "KAKAO_CID", "SHOP_BASE_URL", "SHOP_NAME"]

# Windows 콘솔(cp949)에서도 한글·기호가 깨지거나 오류 나지 않도록
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

CLEANUP_CANDIDATES = [
    ("supabase", "supabase/schema.sql → 루트의 setup.sql 로 대체됨 (v8 부터 setup.sql 을 Supabase 에 붙여 넣음)"),
    ("start.bat", "로컬 실행 전용 — python setup.py run 으로 대체 (배포는 Vercel)"),
    ("start.sh", "로컬 실행 전용 — python setup.py run 으로 대체 (배포는 Vercel)"),
    ("schema.sql", "MySQL 전용 + DROP TABLE 포함 — MySQL 지원 종료, setup.sql 사용"),
    ("frontend/src/pages/B2BShop.jsx", "라우터에서 쓰지 않는 구버전 목업 (B2BShopLive.jsx 가 실제 화면)"),
    ("frontend/src/gemini.js", "api.js 로 통합됨 (프론트에 AI 키를 두던 구버전)"),
    ("frontend/dist", "빌드 산출물 (Vercel 이 배포할 때 다시 만듦)"),
    ("backend/__pycache__", "파이썬 캐시"),
    ("backend/tests/__pycache__", "파이썬 캐시"),
    ("backend/scripts/__pycache__", "파이썬 캐시"),
    ("backend/.pytest_cache", "테스트 캐시"),
]


# ---------------------------------------------------------------------
# 출력·입력 도우미
# ---------------------------------------------------------------------
def say(msg=""):
    print(msg, flush=True)


def step(n, title):
    say(f"\n[{n}] {title}")
    say("-" * 64)


def ask(question, default=""):
    if ASSUME_YES:
        return default
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"  {question}{suffix}: ").strip()
    except EOFError:
        return default
    return answer or default


def confirm(question, default=True):
    if ASSUME_YES:
        return default
    hint = "Y/n" if default else "y/N"
    answer = ask(f"{question} ({hint})").lower()
    if not answer:
        return default
    return answer in ("y", "yes", "예", "ㅇ", "네")


def run(cmd, cwd=None, check=True, env=None):
    say(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=cwd, check=check, env=env, shell=False)


# ---------------------------------------------------------------------
# .env 읽기/쓰기 (기존 줄·주석 유지, 지정한 키만 갱신)
# ---------------------------------------------------------------------
def read_env(path):
    values = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8-sig"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def update_env_file(path, updates, header=""):
    lines = open(path, encoding="utf-8-sig").read().splitlines() if os.path.exists(path) else ([header] if header else [])
    remaining = dict(updates)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                lines[i] = f"{key}={remaining.pop(key)}"
    if remaining:
        lines.append(f"# ---- setup.py 가 {time.strftime('%Y-%m-%d %H:%M')} 에 추가 ----")
        lines += [f"{k}={v}" for k, v in remaining.items()]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines).rstrip() + "\n")


# ---------------------------------------------------------------------
# Supabase 연결 주소 점검 (비밀번호는 화면에 출력하지 않음)
# ---------------------------------------------------------------------
def split_db_url(url):
    rest = url.split("://", 1)[1] if "://" in url else url
    cred, _, hostpart = rest.rpartition("@")
    user, _, password = cred.partition(":")
    return user, password, hostpart


def masked(url):
    if "://" not in url:
        return "(형식 오류)"
    user, _, hostpart = split_db_url(url)
    return f"{url.split('://')[0]}://{user}:****@{hostpart}"


def supabase_url_problems(url):
    problems = []
    if not url.startswith(("postgres://", "postgresql://")):
        return ["postgresql:// 로 시작하는 Supabase 연결 주소가 아닙니다."]
    user, password, hostpart = split_db_url(url)
    host = hostpart.split("/", 1)[0].split("?", 1)[0]
    hostname, _, port = host.partition(":")
    if not password:
        problems.append("비밀번호가 비어 있습니다. [YOUR-PASSWORD] 자리에 DB 비밀번호를 넣으세요.")
    if "YOUR-PASSWORD" in password.upper():
        problems.append("[YOUR-PASSWORD] 를 실제 DB 비밀번호로 바꾸지 않았습니다.")
    elif password.startswith("[") and password.endswith("]"):
        problems.append("비밀번호를 [ ] 로 감싸 두었습니다. 대괄호는 자리 표시용이라 지워야 합니다.")
    if any(ch in password.strip("[]") for ch in "@:/?#"):
        problems.append("비밀번호에 @ : / ? # 가 있으면 주소가 깨집니다. Supabase 에서 비밀번호를 영문·숫자로 재설정하세요.")
    if hostname.startswith("db.") and hostname.endswith(".supabase.co"):
        problems.append("'db.<프로젝트>.supabase.co' 직접 연결 주소입니다. IPv6 전용이라 Vercel·대부분의 가정/학교 망에서 "
                        "시간 초과가 납니다. Connect → 'Transaction pooler'(포트 6543) 주소를 쓰세요.")
    elif hostname.endswith("pooler.supabase.com"):
        if port != "6543":
            problems.append("풀러 포트가 6543 이 아닙니다. Vercel 같은 서버리스에는 'Transaction pooler'(6543)를 쓰세요.")
        if not user.startswith("postgres."):
            problems.append("풀러 주소의 사용자명은 postgres.<프로젝트ID> 형식이어야 합니다.")
    return problems


def fix_brackets(url):
    user, password, hostpart = split_db_url(url)
    if password.startswith("[") and password.endswith("]") and "YOUR-PASSWORD" not in password.upper():
        scheme = url.split("://", 1)[0]
        return f"{scheme}://{user}:{password[1:-1]}@{hostpart}"
    return url


def prompt_database_url(current):
    if current:
        problems = supabase_url_problems(current)
        if not problems:
            say(f"  ✓ 기존 DATABASE_URL 사용: {masked(current)}")
            if not confirm("이 주소를 그대로 쓸까요?", True):
                current = ""
            else:
                return current
        else:
            say(f"  ! 기존 DATABASE_URL({masked(current)})에 문제가 있습니다:")
            for p in problems:
                say(f"    - {p}")
            fixed = fix_brackets(current)
            if fixed != current and not supabase_url_problems(fixed) and confirm("비밀번호의 [ ] 괄호를 자동으로 지울까요?", True):
                say(f"  ✓ 수정됨: {masked(fixed)}")
                return fixed
    say("  Supabase 대시보드 위쪽 [Connect] → [Connection String] → Method: 'Transaction pooler' 의 주소를 복사하세요.")
    say("  (붙여 넣은 뒤 [YOUR-PASSWORD] 부분은 대괄호까지 지우고 DB 비밀번호로 바꿔서 입력)")
    for _ in range(3):
        url = ask("Supabase 연결 주소").strip().strip('"').strip("'")
        if not url:
            break
        url = fix_brackets(url)
        problems = supabase_url_problems(url)
        if not problems:
            say(f"  ✓ 형식 확인: {masked(url)}")
            return url
        for p in problems:
            say(f"    ✗ {p}")
        if confirm("그래도 이 주소를 저장할까요?", False):
            return url
    say("  ! DATABASE_URL 을 저장하지 않았습니다. 준비되면 python setup.py 를 다시 실행하세요.")
    return current or ""


def prompt_google_client_id(current):
    if current.endswith(".apps.googleusercontent.com"):
        say(f"  ✓ 기존 GOOGLE_CLIENT_ID 사용: {current[:12]}…")
        if confirm("그대로 쓸까요?", True):
            return current
    say("  Google Cloud Console → Google Auth Platform → Clients 에서 만든 '웹 애플리케이션' 클라이언트 ID")
    for _ in range(3):
        value = ask("Google 클라이언트 ID (모르면 Enter — 나중에 다시 실행)").strip()
        if not value:
            return current
        if value.endswith(".apps.googleusercontent.com"):
            return value
        say("    ✗ 클라이언트 ID 는 ...apps.googleusercontent.com 으로 끝납니다. (클라이언트 '보안 비밀번호'가 아닌 'ID' 를 넣으세요)")
    return current


# ---------------------------------------------------------------------
# 1) 배포 준비 (기본 명령)
# ---------------------------------------------------------------------
def prepare():
    say("=" * 64)
    say(" 학원 통합 관리 시스템 — 배포 준비 (Supabase + Google 로그인 + Vercel)")
    say("=" * 64)
    if sys.version_info < (3, 10):
        raise SystemExit(f"  ✗ Python 3.10 이상이 필요합니다 (현재 {sys.version.split()[0]}).")
    current = read_env(ENV_FILE)
    updates = {}

    step(1, "Supabase 연결 주소 (DATABASE_URL)")
    db_url = prompt_database_url(current.get("DATABASE_URL", "") if current.get("DATABASE_URL", "").startswith("postgres") else "")
    if db_url:
        updates["DATABASE_URL"] = db_url

    step(2, "Google 로그인 (GOOGLE_CLIENT_ID)")
    client_id = prompt_google_client_id(current.get("GOOGLE_CLIENT_ID", ""))
    if client_id:
        updates["GOOGLE_CLIENT_ID"] = client_id

    step(3, "비밀 코드 생성")
    admin_code = current.get("ADMIN_SIGNUP_CODE", "")
    if len(admin_code) < MIN_CODE_LENGTH:
        admin_code = secrets.token_urlsafe(12)
        say("  ✓ 최초 관리자 초대 코드(ADMIN_SIGNUP_CODE)를 새로 만들었습니다.")
    else:
        say("  ✓ 기존 ADMIN_SIGNUP_CODE 유지")
    updates["ADMIN_SIGNUP_CODE"] = admin_code
    cron = current.get("CRON_SECRET", "")
    if len(cron) < 16:
        cron = secrets.token_urlsafe(32)
        say("  ✓ Vercel Cron 비밀값(CRON_SECRET)을 만들었습니다.")
    updates["CRON_SECRET"] = cron
    staff = current.get("STAFF_SIGNUP_CODE", "")
    if len(staff) < MIN_CODE_LENGTH and confirm("직원용 초대 코드(STAFF_SIGNUP_CODE)도 만들까요?", False):
        staff = secrets.token_urlsafe(12)
    if len(staff) >= MIN_CODE_LENGTH:
        updates["STAFF_SIGNUP_CODE"] = staff

    step(4, "선택 기능 (Enter 로 건너뛰기 — 나중에 Vercel 에서 추가해도 됩니다)")
    for key, label in (("GEMINI_API_KEY", "Gemini API 키 (AI 비서·서류 인식)"),
                       ("KAKAO_SECRET_KEY", "카카오페이 Secret key (테스트 결제)")):
        if current.get(key):
            say(f"  ✓ {key} 설정됨")
            continue
        value = ask(label).strip()
        if value:
            updates[key] = value
    for key, default in (("KAKAO_CID", "TC0ONETIME"), ("SHOP_BASE_URL", "https://ddmmall77.com"), ("SHOP_NAME", "DDM")):
        if not current.get(key):
            updates[key] = default

    step(5, "환경변수 파일 저장")
    update_env_file(ENV_FILE, updates, header="# 학원 통합 관리 시스템 — 로컬/점검용 환경변수 (커밋 금지)")
    merged = {**current, **updates}
    say("  ✓ backend/.env 저장")
    vercel_lines = ["# Vercel → 프로젝트 → Settings → Environment Variables 에 붙여 넣을 값 (커밋 금지)",
                    "# 'Key' 칸에 이 파일 내용을 통째로 붙여 넣으면 여러 개가 한 번에 입력됩니다."]
    vercel_lines += [f"{k}={merged[k]}" for k in VERCEL_KEYS if merged.get(k)]
    with open(VERCEL_ENV_FILE, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(vercel_lines) + "\n")
    say("  ✓ .env.vercel 저장 (Vercel 에 붙여 넣을 값 — 저장소에 올라가지 않음)")
    missing = [k for k in ("DATABASE_URL", "GOOGLE_CLIENT_ID") if not merged.get(k)]

    say("\n" + "=" * 64)
    say(" ★ 최초 관리자 초대 코드 (사이트에서 '관리자' 선택 시 1번만 입력)")
    say(f"     {merged['ADMIN_SIGNUP_CODE']}")
    say("=" * 64)
    if missing:
        say(f"  ! 아직 비어 있는 필수 값: {', '.join(missing)} — README 의 해당 단계를 마친 뒤 다시 실행하세요.")
    elif confirm("지금 Supabase 에 접속해 테이블 상태를 확인할까요? (처음 한 번 패키지 설치 1~3분)", True):
        check_database()
    if any(os.path.exists(os.path.join(ROOT, rel)) for rel, _ in CLEANUP_CANDIDATES):
        cleanup(default=True)
    say("\n다음 단계 (README 4~6단계)")
    say("  1. GitHub 에 코드를 올린다 (.env, .env.vercel 은 자동으로 제외됨)")
    say("  2. Vercel 에서 저장소를 Import → Environment Variables 에 .env.vercel 내용을 붙여 넣고 Deploy")
    say("  3. 배포 주소를 Google OAuth 클라이언트의 '승인된 JavaScript 원본'에 추가")
    say("  4. https://<배포주소>/api/health 에서 ok: true 확인 → 로그인 → 관리자 선택 → 초대 코드 입력")


# ---------------------------------------------------------------------
# 2) Supabase 연결 확인 / 데모 데이터 (backend/venv 에 패키지 설치 후 실행)
# ---------------------------------------------------------------------
def ensure_venv():
    if not os.path.exists(VENV_PY):
        say("  · backend/venv 가상환경을 만듭니다.")
        run([sys.executable, "-m", "venv", VENV])
    run([VENV_PY, "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r",
         os.path.join(BACKEND, "requirements.txt")])


CHECK_SCRIPT = r"""
import os, sys
os.environ["AUTO_CREATE_TABLES"] = "false"
import main
from sqlalchemy import inspect, text
if main.DATABASE_PROBLEM:
    print("  ✗ " + main.DATABASE_PROBLEM); sys.exit(2)
try:
    with main.engine.connect() as conn:
        conn.execute(text("SELECT 1"))
        names = set(inspect(conn).get_table_names())
except Exception as exc:
    print("  ✗ 연결 실패: " + main._db_connection_hint(exc)); sys.exit(2)
expected = [t.name for t in main.Base.metadata.sorted_tables]
missing = [n for n in expected if n not in names]
print(f"  ✓ Supabase 연결 성공 ({main.DB_DIALECT}) — 테이블 {len(expected) - len(missing)}/{len(expected)}개 준비됨")
if missing:
    print("  ! 없는 테이블: " + ", ".join(missing))
    sys.exit(3)
"""


def check_database():
    step("DB", "Supabase 연결 확인")
    env = read_env(ENV_FILE)
    if not env.get("DATABASE_URL", "").startswith("postgres"):
        say("  ✗ backend/.env 에 Supabase DATABASE_URL 이 없습니다. 먼저 python setup.py 를 실행하세요.")
        return False
    ensure_venv()
    result = run([VENV_PY, "-c", CHECK_SCRIPT], cwd=BACKEND, check=False)
    if result.returncode == 3:
        if confirm("없는 테이블을 지금 만들까요? (Supabase SQL Editor 에서 setup.sql 을 실행하는 것과 같음, 기존 데이터 유지)", True):
            run([VENV_PY, "-c", "import os; os.environ['AUTO_CREATE_TABLES']='false'; import main; "
                 "print('  ✓ 생성:', ', '.join(main.init_db()) or '없음')"], cwd=BACKEND, check=False)
            return True
        say("  → Supabase → SQL Editor 에서 setup.sql 을 실행하세요.")
        return False
    return result.returncode == 0


def seed_demo():
    if check_database():
        if confirm("발표·시연용 가상 데이터(학생 12명·수업·출결·청구서)를 넣을까요? 회원이 이미 있으면 건너뜁니다", True):
            run([VENV_PY, os.path.join("scripts", "seed_demo.py")], cwd=BACKEND, check=False)


# ---------------------------------------------------------------------
# 3) (선택) 로컬 미리보기 / 테스트 / 정리
# ---------------------------------------------------------------------
def npm_cmd():
    exe = shutil.which("npm.cmd" if IS_WINDOWS else "npm") or shutil.which("npm")
    if not exe:
        raise SystemExit("  ✗ npm 을 찾을 수 없습니다. Node.js 18 이상을 설치하세요: https://nodejs.org")
    return exe


def setup_local():
    step("LOCAL", "내 PC 미리보기 설치 (선택 — 배포에는 필요 없음)")
    ensure_venv()
    run([npm_cmd(), "install", "--no-fund", "--no-audit"], cwd=FRONTEND)
    env = read_env(ENV_FILE)
    if not env.get("DATABASE_URL"):
        update_env_file(ENV_FILE, {"DATABASE_URL": "sqlite:///./facility.db", "DEV_LOGIN_ENABLED": "true"})
        say("  ✓ DATABASE_URL 이 없어 로컬 SQLite + 개발용 로그인으로 설정했습니다.")
    say("  ✓ 설치 완료 → python setup.py run 으로 실행 (http://localhost:5173)")


def run_dev():
    if not os.path.exists(VENV_PY):
        raise SystemExit("먼저 실행하세요: python setup.py local")
    say("백엔드 http://localhost:8000 (API 문서 /docs) · 프론트 http://localhost:5173  — 종료: Ctrl+C\n")
    backend = subprocess.Popen([VENV_PY, "-m", "uvicorn", "main:app", "--reload", "--port", "8000"], cwd=BACKEND)
    frontend = subprocess.Popen([npm_cmd(), "run", "dev"], cwd=FRONTEND)
    try:
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for proc in (backend, frontend):
            if proc.poll() is None:
                proc.terminate()
        say("\n서버를 종료했습니다.")


def run_tests():
    ensure_venv()
    run([VENV_PY, "-m", "pip", "install", "-q", "--disable-pip-version-check", "pytest", "httpx"], check=False)
    sys.exit(run([VENV_PY, "-m", "pytest", "-q", "tests"], cwd=BACKEND, check=False).returncode)


def cleanup(default=False):
    step("CLEAN", "불필요 파일 정리 (삭제가 아니라 _to_delete/ 로 이동)")
    found = [(rel, why) for rel, why in CLEANUP_CANDIDATES if os.path.exists(os.path.join(ROOT, rel))]
    if not found:
        say("  ✓ 정리할 파일이 없습니다.")
        return
    for rel, why in found:
        say(f"  - {rel}  ({why})")
    if not confirm("위 항목을 _to_delete/ 로 옮길까요?", default):
        return
    target_root = os.path.join(ROOT, "_to_delete", time.strftime("%Y%m%d-%H%M%S"))
    for rel, _ in found:
        dst = os.path.join(target_root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(os.path.join(ROOT, rel), dst)
    say(f"  ✓ {len(found)}개 항목을 옮겼습니다. 확인 후 _to_delete 폴더를 지우세요.")


COMMANDS = {"check": check_database, "demo": seed_demo, "test": run_tests,
            "local": setup_local, "run": run_dev, "clean": cleanup}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    command = args[0] if args else "prepare"
    if command == "prepare":
        return prepare()
    if command not in COMMANDS:
        raise SystemExit(f"알 수 없는 명령: {command}  (사용 가능: {', '.join(['prepare', *COMMANDS])})")
    return COMMANDS[command]()


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"\n✗ 명령 실패({exc.returncode}): {' '.join(exc.cmd)}\n  위 오류 메시지를 확인한 뒤 다시 실행하세요.")
    except KeyboardInterrupt:
        raise SystemExit("\n중단했습니다.")

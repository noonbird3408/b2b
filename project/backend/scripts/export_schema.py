"""SQLAlchemy 모델 → Supabase(PostgreSQL)용 setup.sql 생성 (비파괴: IF NOT EXISTS)

사용 (backend 폴더에서):  python scripts/export_schema.py > ../setup.sql
DB 에 접속하지 않고 모델 정의만으로 만듭니다. 모델(테이블)을 바꾸면 다시 실행해 setup.sql 을 갱신하세요.
"""
import os
import sys

os.environ["AUTO_CREATE_TABLES"] = "false"   # import 시 실제 DB 에 접속하지 않음
os.environ["DATABASE_URL"] = "sqlite://"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.schema import CreateIndex, CreateTable  # noqa: E402

import main  # noqa: E402

HEADER = """-- =====================================================================
-- 시설 통합 관리 시스템 — Supabase 테이블 생성 스크립트 (setup.sql)
--
-- 사용법: Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query
--         → 이 파일 내용을 전부 복사해 붙여넣기 → Run (Ctrl+Enter)
--         → 맨 아래에 "setup 완료" 결과가 보이면 성공
--
-- 안전: 이미 있는 테이블·인덱스는 건너뜁니다(IF NOT EXISTS). DROP/DELETE 가 없어
--       여러 번 실행해도 기존 데이터는 지워지지 않습니다.
-- 이 파일은 backend/scripts/export_schema.py 로 자동 생성됩니다. 직접 고치지 마세요.
-- =====================================================================
"""

FOOTER = """
-- v9(여러 시설): 기존(단일 시설) 데이터의 facility_id 채우기·첫 시설 생성은 백엔드가 처음 시작될 때
-- 자동으로 한 번 실행합니다(app_meta.schema_version 기록). 이 스크립트는 테이블·컬럼·인덱스만 준비합니다.
-- Supabase 는 public 스키마의 테이블을 Data API(anon 키)로 노출합니다.
-- RLS(행 수준 보안)를 켜 두면 브라우저에서 테이블에 직접 접근할 수 없습니다.
-- 이 앱은 백엔드(Vercel)가 DB 비밀번호로 접속하므로 RLS 정책 없이도 정상 동작합니다.
"""


def render() -> str:
    dialect = postgresql.dialect()
    tables = main.Base.metadata.sorted_tables
    lines = [HEADER]
    patches: dict = {}
    for table_name, column, ddl, _index in main._all_column_patches():
        patches.setdefault(table_name, []).append((column, ddl))
    for table in tables:
        lines.append(str(CreateTable(table, if_not_exists=True).compile(dialect=dialect)).strip() + ";")
        # 이전 버전으로 이미 만든 테이블은 CREATE TABLE 이 건너뛰어지므로, 새 컬럼을 먼저 보완한 뒤
        # 인덱스를 만듭니다. (순서가 반대면 'column ... does not exist' 오류)
        for column, ddl in patches.get(table.name, []):
            lines.append(f"ALTER TABLE {table.name} ADD COLUMN IF NOT EXISTS {column} {ddl};  -- 이전 버전 보완")
        if table.name == "attendances":
            # v9: 하루에 수업별 출결 — (학생, 날짜) 고유 조건을 (학생, 날짜, 수업) 고유 인덱스로 교체 (기존 데이터 영향 없음)
            lines.append("ALTER TABLE attendances DROP CONSTRAINT IF EXISTS uq_attendance_member_date;")
        if table.name == "classes":
            lines.append("ALTER TABLE classes ALTER COLUMN start_date DROP NOT NULL;")
            lines.append("ALTER TABLE classes ALTER COLUMN end_date DROP NOT NULL;")
        for index in sorted(table.indexes, key=lambda i: i.name or ""):
            lines.append(str(CreateIndex(index, if_not_exists=True).compile(dialect=dialect)).strip() + ";")
        lines.append("")
    for index, table_name, column in main.INDEX_PATCHES:
        lines.append(f"CREATE INDEX IF NOT EXISTS {index} ON {table_name} ({column});")
    lines.append("")
    lines.append(FOOTER.strip())
    lines += [f"ALTER TABLE {t.name} ENABLE ROW LEVEL SECURITY;" for t in tables]
    lines += ["", f"SELECT 'setup 완료 — 테이블 {len(tables)}개 준비됨' AS result;"]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    sys.stdout.write(render())

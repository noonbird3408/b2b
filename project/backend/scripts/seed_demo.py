"""발표·시연용 데모 데이터 입력 — 실제 내용은 backend/demo_data.py (관리자 화면의 '데모 데이터 넣기'와 동일)

사용: python scripts/seed_demo.py          # members 테이블이 비어 있을 때만 입력
      python scripts/seed_demo.py --force  # 비어 있지 않아도 추가 입력
기존 데이터는 삭제하지 않습니다. 연락처·주소는 모두 가상의 값입니다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402
import demo_data  # noqa: E402


def run(force: bool = False) -> None:
    main.init_db()
    db = main.SessionLocal()
    try:
        owner = db.query(main.AdminAccount).filter(main.AdminAccount.role == "owner").first()
        result = demo_data.seed(db, main, account=owner, force=force)
        print(f"데모 데이터 입력 완료: 학생 {result['members']}명, 수업 {result['classes']}개")
        print(f"  키오스크 체험: 보호자 번호 뒤 4자리 {result['kiosk_digits']}")
        print(f"  학부모 체험: 자녀 이름 {result['parent_demo']['child_name']} / 연락처 {result['parent_demo']['phone']}")
    except ValueError as exc:
        print(f"{exc} (--force 로 강제 입력)")
    finally:
        db.close()


if __name__ == "__main__":
    run(force="--force" in sys.argv)

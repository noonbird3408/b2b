"""발표·시연용 데모 데이터 입력 (Supabase(PostgreSQL) / SQLite 공통, ORM 사용)

사용: python scripts/seed_demo.py          # members 테이블이 비어 있을 때만 입력
      python scripts/seed_demo.py --force  # 비어 있지 않아도 추가 입력
기존 데이터는 삭제하지 않습니다. 연락처·주소는 모두 가상의 값입니다.
"""
import os
import random
import sys
from datetime import time, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402
from main import (SessionLocal, Member, Class, Enrollment, Attendance, Payment,  # noqa: E402
                  Notice, CommunityPost, Invoice)

STUDENTS = [
    ("김민준", "M", 12), ("이서연", "F", 11), ("박지호", "M", 9), ("최하은", "F", 10),
    ("정우진", "M", 13), ("강수아", "F", 8), ("조예준", "M", 14), ("윤지아", "F", 12),
    ("장도윤", "M", 10), ("임서윤", "F", 9), ("한시우", "M", 11), ("오하린", "F", 13),
]
CLASSES = [
    ("유초등 기초반", "김사범", "MON,WED,FRI", time(14, 0), time(15, 0), "기본 동작과 체력 훈련"),
    ("초등 품새반", "박사범", "TUE,THU", time(15, 30), time(16, 30), "승급 심사 대비 품새 집중"),
    ("중등 겨루기반", "이관장", "MON,TUE,WED,THU,FRI", time(17, 0), time(18, 30), "겨루기 대회 대비반"),
]


def run(force: bool = False) -> None:
    main.init_db()
    db = SessionLocal()
    try:
        if db.query(Member).count() and not force:
            print("이미 회원 데이터가 있어 데모 데이터를 건너뜁니다. (--force 로 강제 입력)")
            return
        random.seed(7)
        today = main._today()   # 한국 시간 기준 오늘
        members = []
        for i, (name, gender, age) in enumerate(STUDENTS):
            m = Member(name=name, gender=gender, age=age,
                       enrollment_date=today - timedelta(days=30 * (i + 2)),
                       payment_date=today - timedelta(days=random.choice([5, 20, 40, 75])),
                       mother_name=f"{name[0]}보호자", mother_phone=f"010-0000-{1000 + i:04d}",
                       address="서울시 (데모 주소)", status="ACTIVE" if i < 11 else "WITHDRAWN")
            db.add(m)
            members.append(m)
        classes = []
        for idx, (name, teacher, days, start, end, desc) in enumerate(CLASSES):
            c = Class(name=name, teacher=teacher, start_date=today - timedelta(days=60),
                      end_date=today + timedelta(days=180), days_of_week=days,
                      start_time=start, end_time=end, description=desc, color_index=idx)
            db.add(c)
            classes.append(c)
        db.flush()
        for i, m in enumerate(members):
            db.add(Enrollment(member_id=m.member_id, class_id=classes[i % 3].class_id))
            if i % 4 == 0:
                db.add(Enrollment(member_id=m.member_id, class_id=classes[(i + 1) % 3].class_id))
        for d in range(14):
            day = today - timedelta(days=d)
            if day.weekday() >= 5:
                continue
            for m in members[:11]:
                status = random.choices(["PRESENT", "LATE", "ABSENT"], [80, 10, 10])[0]
                db.add(Attendance(member_id=m.member_id, attendance_date=day, status=status,
                                  check_in_time=None if status == "ABSENT" else time(14, random.randint(0, 40))))
        for m in members[:11]:
            db.add(Payment(member_id=m.member_id, amount=180000, paid_at=m.payment_date,
                           payment_type="TUITION", method="CARD", note="월 회비"))
        for m in members[:4]:
            db.add(Invoice(member_id=m.member_id, item_name=f"{today.month}월 수강료", amount=180000,
                           status="UNPAID", due_date=today + timedelta(days=10)))
        db.add_all([
            Notice(title="다음 달 승급 심사 일정 안내", content="품새 승급 심사가 진행됩니다. 도복을 준비해 주세요.",
                   category="EVENT", is_pinned=True),
            Notice(title="시 협회장배 겨루기 대회 참가 신청", content="대회 참가를 희망하는 학생은 신청서를 제출해 주세요.",
                   category="EVENT"),
            Notice(title="정기 휴관 안내", content="공휴일은 휴관합니다.", category="GENERAL"),
        ])
        db.add_all([
            CommunityPost(content="오늘 품새 수업 열심히 참여한 친구들 멋졌어요! 👏", like_count=5),
            CommunityPost(content="이번 주 토요일 안전점검이 있습니다. 오전 수업은 정상 진행합니다.", like_count=2),
        ])
        db.commit()
        print(f"데모 데이터 입력 완료: 학생 {len(members)}명, 수업 {len(classes)}개")
    finally:
        db.close()


if __name__ == "__main__":
    run(force="--force" in sys.argv)

"""발표·전시회 시연용 데모 데이터 (가상의 학생·연락처 — 실제 개인정보 아님)

사용
  - 관리자 화면: 설정 → 데이터 관리 → '시연용 데모 데이터 넣기' (POST /api/admin/demo-data)
  - 로컬:        setup.bat demo  (backend/scripts/seed_demo.py)

시연 포인트
  - 키오스크: 보호자 연락처가 010-0000-1000 ~ 010-0000-1011 → 뒤 4자리 1000~1011 로 등원/하원
  - 학부모 포털 체험: Google 로그인 → 학부모 → 자녀 이름 '김민준' + 연락처 010-0000-1000 으로 자녀 연결
  - 오늘 출결은 비워 두어 키오스크로 바로 체험할 수 있습니다.
"""
import json
import random
from datetime import datetime, time, timedelta

STUDENTS = [
    ("김민준", "M", 12), ("이서연", "F", 11), ("박지호", "M", 9), ("최하은", "F", 10),
    ("정우진", "M", 13), ("강수아", "F", 8), ("조예준", "M", 14), ("윤지아", "F", 12),
    ("장도윤", "M", 10), ("임서윤", "F", 9), ("한시우", "M", 11), ("오하린", "F", 13),
]
CLASSES = [
    ("유초등 기초반", "김사범", [("MON", "15:00", "16:00"), ("WED", "15:00", "16:00"), ("FRI", "15:00", "16:00")],
     "기본 동작과 체력 훈련"),
    ("초등 품새반", "박사범", [("TUE", "16:00", "17:00"), ("THU", "16:00", "17:00"), ("SAT", "10:00", "11:30")],
     "승급 심사 대비 품새 집중"),
    ("중등 겨루기반", "이관장", [(d, "17:30", "19:00") for d in ("MON", "TUE", "WED", "THU", "FRI")],
     "겨루기 대회 대비반"),
]
DEMO_PARENT_EMAIL = "demo.parent@example.invalid"   # 시연용 가상 학부모(로그인 불가) — 댓글·좋아요 예시용


def seed(db, m, account=None, force: bool = False) -> dict:
    """m = main 모듈 (모델·헬퍼). 학생이 이미 있으면 force 없이는 넣지 않습니다."""
    if db.query(m.Member).count() and not force:
        raise ValueError("이미 학생 데이터가 있어 데모 데이터를 넣지 않았습니다.")
    random.seed(7)
    today = m._today()
    now = m._now()

    # 기관 정보가 기본값이면 시연용 이름으로
    academy = m._read_settings(db, "academy_info", m.DEFAULT_ACADEMY_SETTINGS)
    payment = m._read_settings(db, "payment_settings", m.DEFAULT_PAYMENT_SETTINGS)
    if academy.get("name") in (None, "", "우리 시설", "한빛학원"):
        academy = {**m.DEFAULT_ACADEMY_SETTINGS, **academy, "name": "한빛 태권도장", "branch": "용인 본관",
                   "principal": "김관장", "facilityType": "도장", "phone": "031-000-0000"}
    payment = {**m.DEFAULT_PAYMENT_SETTINGS, **payment, "baseTuitionFee": 180000}

    members = []
    for i, (name, gender, age) in enumerate(STUDENTS):
        member = m.Member(name=name, gender=gender, age=age,
                          enrollment_date=today - timedelta(days=30 * (i + 2)),
                          payment_date=today - timedelta(days=random.choice([5, 12, 20, 35])),
                          mother_name=f"{name[0]}보호자", mother_phone=f"010-0000-{1000 + i:04d}",
                          address="(데모 주소)", status="ACTIVE" if i < 11 else "WITHDRAWN",
                          withdrawal_date=None if i < 11 else today - timedelta(days=3))
        db.add(member)
        members.append(member)
    classes = []
    for idx, (name, teacher, schedule, desc) in enumerate(CLASSES):
        cls = m.Class(name=name, teacher=teacher, start_date=today - timedelta(days=90),
                      end_date=today + timedelta(days=180), description=desc, color_index=idx,
                      days_of_week=",".join(d for d, _, _ in schedule),
                      start_time=time.fromisoformat(schedule[0][1]), end_time=time.fromisoformat(schedule[0][2]),
                      schedule_detail=json.dumps([{"day": d, "start": s, "end": e} for d, s, e in schedule]))
        db.add(cls)
        classes.append(cls)
    db.flush()
    payment["classFees"] = [{"classId": classes[0].class_id, "fee": 150000},
                            {"classId": classes[1].class_id, "fee": 170000},
                            {"classId": classes[2].class_id, "fee": 190000}]
    m._write_settings(db, academy, payment)

    for i, member in enumerate(members):
        db.add(m.Enrollment(member_id=member.member_id, class_id=classes[i % 3].class_id))
        if i % 4 == 0:
            db.add(m.Enrollment(member_id=member.member_id, class_id=classes[(i + 1) % 3].class_id))

    # 최근 35일 출결 (오늘은 비움 → 키오스크 체험). 3번 학생은 출석률 낮음, 6번 학생은 최근 연속 결석
    for d in range(1, 36):
        day = today - timedelta(days=d)
        if day.weekday() == 6:
            continue
        for i, member in enumerate(members[:11]):
            weights = [55, 10, 35] if i == 3 else [84, 9, 7]
            status = random.choices(["PRESENT", "LATE", "ABSENT"], weights)[0]
            if i == 6 and d <= 4:
                status = "ABSENT"
            check_in = None if status == "ABSENT" else time(15 if i % 3 == 0 else 16, random.randint(0, 25))
            check_out = None if status == "ABSENT" else time(check_in.hour + 1, random.randint(5, 40))
            db.add(m.Attendance(member_id=member.member_id, attendance_date=day, status=status,
                                check_in_time=check_in, check_out_time=check_out))

    # 최근 6개월 수강료 결제 이력 (매출 추이 차트) + 이번 달 청구서
    for month_offset in range(5, 0, -1):
        paid_day = m._month_start(today, -month_offset) + timedelta(days=4)
        for i, member in enumerate(members[:11 if month_offset < 3 else 9]):
            db.add(m.Payment(member_id=member.member_id, amount=150000 + 20000 * (i % 3), paid_at=paid_day,
                             payment_type="TUITION", method=random.choice(["CARD", "KAKAOPAY", "TRANSFER"]),
                             note="월 수강료"))
    month_label = f"{today.month}월 수강료"
    for i, member in enumerate(members[:11]):
        amount = 150000 + 20000 * (i % 3)
        paid = i not in (2, 5, 8, 10)
        due = m._month_start(today) + timedelta(days=9)
        db.add(m.Invoice(member_id=member.member_id, item_name=month_label, amount=amount,
                         status="PAID" if paid else "UNPAID", due_date=due))
        if paid:
            db.add(m.Payment(member_id=member.member_id, amount=amount, paid_at=min(today, m._month_start(today) + timedelta(days=3)),
                             payment_type="TUITION", method="CARD", note=month_label))
    db.add(m.Invoice(member_id=members[5].member_id, item_name=f"{m._month_start(today, -1).month}월 수강료",
                     amount=170000, status="UNPAID", due_date=m._month_start(today, -1) + timedelta(days=9)))

    db.add_all([
        m.Notice(title="11월 품새 승급 심사 안내", content="이번 달 셋째 주 토요일에 승급 심사가 진행됩니다.\n도복과 띠를 준비해 주세요.",
                 category="EVENT", is_pinned=True, author=academy.get("principal") or "관장"),
        m.Notice(title="시 협회장배 겨루기 대회 참가 신청", content="대회 참가를 희망하는 학생은 이번 주까지 신청서를 제출해 주세요.",
                 category="EVENT", author="이관장", class_id=classes[2].class_id),
        m.Notice(title="정기 휴관 안내", content="공휴일은 휴관합니다. 보강 일정은 반별로 안내드립니다.", category="GENERAL"),
    ])
    due_soon = (today + timedelta(days=5)).isoformat()
    a1 = m.Assignment(class_id=classes[1].class_id, title="태극 4장 동작 영상 찍어 오기", content="집에서 태극 4장을 3번 연습하고 영상을 보여 주세요.",
                      due_date=due_soon)
    a2 = m.Assignment(class_id=classes[0].class_id, title="줄넘기 100개 기록표", content="일주일 동안 매일 기록해 오기", due_date=(today - timedelta(days=2)).isoformat())
    db.add_all([a1, a2])
    db.flush()
    for i, member in enumerate(members[:11]):
        if i % 3 == 0:   # 기초반
            db.add(m.AssignmentSubmission(assignment_id=a2.assignment_id, member_id=member.member_id,
                                          status="SUBMITTED" if i != 6 else "MISSING", checked_at=now - timedelta(days=1)))

    # 시연용 가상 학부모 + 커뮤니티 (모니터링 예시 포함)
    parent = db.query(m.AppUser).filter(m.AppUser.email == DEMO_PARENT_EMAIL).first()
    if not parent:
        parent = m.AppUser(email=DEMO_PARENT_EMAIL, google_subject="demo:parent", name="시연 학부모")
        db.add(parent)
        db.flush()
    if not db.query(m.ParentLink).filter(m.ParentLink.user_id == parent.user_id).first():
        db.add(m.ParentLink(user_id=parent.user_id, member_id=members[1].member_id))
    post1 = m.CommunityPost(content="오늘 품새 수업 열심히 참여한 친구들 멋졌어요! 👏 다음 주 승급 심사도 화이팅!", like_count=0,
                            author=academy.get("principal") or "관리자", created_at=now - timedelta(hours=5))
    post2 = m.CommunityPost(content="이번 주 토요일 안전점검이 있습니다. 오전 수업은 정상 진행합니다.", like_count=0,
                            author=academy.get("principal") or "관리자", created_at=now - timedelta(days=1))
    db.add_all([post1, post2])
    db.flush()
    db.add(m.CommunityLike(post_id=post1.post_id, user_id=parent.user_id))
    post1.like_count = 1
    samples = [
        ("아이가 집에 와서 품새 자랑을 엄청 하네요 ㅎㅎ 감사합니다!", None),
        ("승급 심사 때 준비물이 따로 있을까요?", None),
        ("광고 보고 등록했는데 홍보 영상 www.youtube.com 에서 봤어요!", "APPROVED"),   # 오탐(링크) → 관리자 승인
        ("시발 왜 연락이 없냐", "HIDDEN"),                                            # 정탐
        ("여기 원장 사기꾼 같아요", "HIDDEN_FN"),                                     # 미탐 → 관리자가 직접 숨김
        ("고수익 부업 오픈채팅 들어오세요 bit.ly/abcd", None),                         # 검토 대기
    ]
    for offset, (content, decision) in enumerate(samples):
        comment = m.CommunityComment(post_id=post1.post_id, author="시** 학부모", content=content, user_id=parent.user_id,
                                     created_at=now - timedelta(hours=4, minutes=-offset * 7))
        db.add(comment)
        db.flush()
        review = m._review_comment(db, comment)
        if decision == "HIDDEN_FN":
            review.decision = "HIDDEN"
            review.decided_at = now
        elif decision:
            review.decision = decision
            review.decided_at = now

    # 최근 활동 예시 (어제 키오스크 등·하원, 학부모 열람) — 대시보드 '최근 활동'·'학부모 앱 활성' 카드용
    yesterday = now - timedelta(days=1)
    for minutes, actor, action, idx, summary in ((0, "kiosk", "attendance.check_in", 0, "등원"),
                                                 (3, "kiosk", "attendance.check_in", 4, "등원 (지각)"),
                                                 (65, "kiosk", "attendance.checkout", 0, "하원"),
                                                 (90, "parent", "notice.read", 1, "공지 열람")):
        db.add(m.ActivityLog(actor_type=actor, actor_id=parent.user_id if actor == "parent" else None, action=action,
                             target_type="member", target_id=members[idx].member_id, summary=summary,
                             created_at=yesterday.replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(minutes=minutes)))

    # 관리자 알림함 예시 (시연 시작 시 종 아이콘에 표시)
    m._notify_admins(db, "MODERATION", "검토가 필요한 댓글", "자동 탐지: 광고·스팸(링크 포함)", "community")
    m._notify_admins(db, "PAYMENT", f"{members[1].name} 학생 학부모 결제 완료",
                     f"{month_label} {150000 + 20000:,}원 (카카오페이)", "admin-checkout", member_id=members[1].member_id)

    if account is not None:
        for due_time, text_value, tag in (("09:30", "오전 출석부 확인 및 미출석자 연락", "primary"),
                                          ("14:00", "신규 상담 자료 준비", "success"),
                                          ("18:00", "승급 심사 명단 정리", "warning")):
            db.add(m.AdminTodo(account_id=account.account_id, due_time=due_time, text=text_value, tag=tag))
    db.add_all([
        m.MemberNote(member_id=members[3].member_id, author="김사범", content="최근 결석이 잦음. 보호자와 통화 — 학교 행사 때문, 다음 주부터 정상 출석 예정."),
        m.MemberNote(member_id=members[0].member_id, author="박사범", content="품새 동작 정확도 우수. 승급 심사 추천."),
    ])
    db.commit()
    return {"members": len(members), "classes": len(classes), "kiosk_digits": "1000~1010",
            "parent_demo": {"child_name": members[0].name, "phone": members[0].mother_phone}}

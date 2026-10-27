"""발표·전시회 시연용 데모 데이터 (가상의 학생·연락처 — 실제 개인정보 아님)

사용
  - 관리자 화면: 설정 → 데이터 관리 → '시연용 데모 데이터 넣기' (POST /api/admin/demo-data)
  - 로컬:        setup.bat demo  (backend/scripts/seed_demo.py)

시연 포인트
  - 출석 알림: 학부모 포털에서 자녀(김민준 / 010-0000-1000)를 연결 → 관리자 '출석 체크'에서 출석을 누르면 10초 안에 알림
  - 학부모 포털 체험: Google 로그인 → 학부모 → 자녀 이름 '김민준' + 연락처 010-0000-1000 으로 자녀 연결
  - 오늘 출결은 비워 두어 출석 체크 화면에서 바로 체험할 수 있습니다.
  - 재고 관리: 일부 물품은 안전 재고보다 적게 넣어 '구매 확인' 흐름을 바로 볼 수 있습니다.
  - 학원 종류에 따라 내용이 달라집니다: 도장·체육관 → 태권도 프로필, 그 외 → 수학·영어 학원 프로필(수업·공지·재고·쇼핑몰 추천)
  - 쇼핑몰: 과목에 맞는 제휴몰 1곳을 연결하고, 결제 완료(입고 대기) 주문 1건을 넣어 '입고 처리 → 재고 반영'을 바로 볼 수 있습니다.
"""
import json
import random
from datetime import datetime, time, timedelta

STUDENTS = [
    ("김민준", "M", 12), ("이서연", "F", 11), ("박지호", "M", 9), ("최하은", "F", 10),
    ("정우진", "M", 13), ("강수아", "F", 8), ("조예준", "M", 14), ("윤지아", "F", 12),
    ("장도윤", "M", 10), ("임서윤", "F", 9), ("한시우", "M", 11), ("오하린", "F", 13),
]
# 학원 종류별 시연 프로필 — 교과·어학 학원(기본) / 태권도·체육(도장·체육관)
PROFILES = {
    "academy": {
        "academy": {"name": "쑥쑥 수학영어학원", "branch": "용인 본원", "principal": "김원장", "facilityType": "학원",
                    "description": "초중등 수학·영어 전문 · 소수정예 개념/심화반", "subjects": ["수학", "영어"]},
        "classes": [
            ("초등 연산·사고력반", "김선생", [("MON", "15:00", "16:20"), ("WED", "15:00", "16:20"), ("FRI", "15:00", "16:20")],
             "초등 수학 연산 루틴과 사고력 문제", "#2563EB", 180000),
            ("파닉스·리딩반", "Emily", [("TUE", "16:00", "17:20"), ("THU", "16:00", "17:20"), ("SAT", "10:00", "11:30")],
             "초등 영어 파닉스와 리딩", "#16A34A", 190000),
            ("중등 수학 심화반", "이선생", [(d, "18:00", "19:40") for d in ("MON", "TUE", "WED", "THU", "FRI")],
             "중등 수학 개념+유형 · 내신 대비", "#DC2626", 230000),
        ],
        "notices": [
            ("11월 학부모 상담 주간 안내", "11월 셋째 주는 학부모 상담 주간입니다.\n상담 희망 시간을 회신해 주세요.",
             "<p>11월 <b>셋째 주</b>는 학부모 상담 주간입니다.</p><p><span style=\"color: #DC2626\">상담 희망 시간</span>을 회신해 주세요.</p>", True, None),
            ("중등 심화반 교내 수학 경시대회 대비 특강", "경시대회 참가 학생은 이번 주 토요일 특강에 참여해 주세요.", None, False, 2),
            ("정기 휴원 안내", "공휴일은 휴원합니다. 보강 일정은 반별로 안내드립니다.", None, False, None),
        ],
        "assignments": [(1, "리딩 지문 3편 녹음해 오기", "Level 2 리딩 지문 3편을 소리 내어 읽고 녹음해 오세요."),
                        (0, "연산 학습지 5장", "하루 1장씩 풀고 채점해 오기")],
        "posts": [("오늘 연산반 수업 현장", "오늘 연산반 친구들 집중력 최고였어요! 👏 다음 주 진단평가도 화이팅!"),
                  ("토요일 건물 소방 점검 안내", "이번 주 토요일 소방 점검이 있습니다. 오전 수업은 정상 진행합니다."),
                  ("영어 원서 추천해 주세요", "초등 3학년 아이가 읽기 좋은 영어 원서가 있을까요?")],
        "good_comments": ["아이가 집에 와서 연산 자랑을 엄청 하네요 ㅎㅎ 감사합니다!", "진단평가 때 준비물이 따로 있을까요?"],
        "todos": [("09:30", "결석생 보호자 연락", "primary"), ("14:00", "신규 상담 자료 준비", "success"), ("18:00", "경시대회 명단 정리", "warning")],
        "notes": [(3, "김선생", "최근 결석이 잦음. 보호자와 통화 — 학교 행사 때문, 다음 주부터 정상 출석 예정."),
                  (0, "이선생", "개념 이해 빠름. 심화반 이동 추천.")],
        "inventory": [("출석 스티커 롤", "소모품", "롤", 1, 3, "ST-036", ""), ("A4 복사지", "소모품", "박스", 1, 2, "ST-028", "복사지"),
                      ("화이트보드 마카", "수업 물품", "세트", 0, 2, "ST-015", "보드마카"),
                      ("중등 수학 문제집", "교재", "권", 3, 6, "BK-204", "수학 문제집"),
                      ("영어 어휘 워크북", "교재", "권", 9, 5, "BK-310", "영단어"), ("칭찬 도장", "수업 물품", "개", 4, 2, None, "")],
        "order": [("A4 복사지 80g (2,500매)", 2), ("중등 영단어 1800", 5)],
    },
    "dojang": {
        "academy": {"name": "한빛 태권도장", "branch": "용인 본관", "principal": "김관장", "facilityType": "도장",
                    "description": "유초등·중등 태권도 · 품새/겨루기반 운영", "subjects": ["태권도", "체육"]},
        "classes": [
            ("유초등 기초반", "김사범", [("MON", "15:00", "16:00"), ("WED", "15:00", "16:00"), ("FRI", "15:00", "16:00")],
             "기본 동작과 체력 훈련", "#2563EB", 150000),
            ("초등 품새반", "박사범", [("TUE", "16:00", "17:00"), ("THU", "16:00", "17:00"), ("SAT", "10:00", "11:30")],
             "승급 심사 대비 품새 집중", "#16A34A", 170000),
            ("중등 겨루기반", "이관장", [(d, "17:30", "19:00") for d in ("MON", "TUE", "WED", "THU", "FRI")],
             "겨루기 대회 대비반", "#DC2626", 190000),
        ],
        "notices": [
            ("11월 품새 승급 심사 안내", "이번 달 셋째 주 토요일에 승급 심사가 진행됩니다.\n도복과 띠를 준비해 주세요.",
             "<p>이번 달 <b>셋째 주 토요일</b>에 승급 심사가 진행됩니다.</p><p><span style=\"color: #DC2626\">도복과 띠</span>를 꼭 준비해 주세요.</p>", True, None),
            ("시 협회장배 겨루기 대회 참가 신청", "대회 참가를 희망하는 학생은 이번 주까지 신청서를 제출해 주세요.", None, False, 2),
            ("정기 휴관 안내", "공휴일은 휴관합니다. 보강 일정은 반별로 안내드립니다.", None, False, None),
        ],
        "assignments": [(1, "태극 4장 동작 영상 찍어 오기", "집에서 태극 4장을 3번 연습하고 영상을 보여 주세요."),
                        (0, "줄넘기 100개 기록표", "일주일 동안 매일 기록해 오기")],
        "posts": [("오늘 품새 수업 현장", "오늘 품새 수업 열심히 참여한 친구들 멋졌어요! 👏 다음 주 승급 심사도 화이팅!"),
                  ("토요일 안전점검 안내", "이번 주 토요일 안전점검이 있습니다. 오전 수업은 정상 진행합니다."),
                  ("도복 세탁 팁 공유해요", "찬물에 뒤집어서 빨면 누렇게 변하는 게 덜하더라고요. 다른 분들은 어떻게 하세요?")],
        "good_comments": ["아이가 집에 와서 품새 자랑을 엄청 하네요 ㅎㅎ 감사합니다!", "승급 심사 때 준비물이 따로 있을까요?"],
        "todos": [("09:30", "오전 출석부 확인 및 미출석자 연락", "primary"), ("14:00", "신규 상담 자료 준비", "success"), ("18:00", "승급 심사 명단 정리", "warning")],
        "notes": [(3, "김사범", "최근 결석이 잦음. 보호자와 통화 — 학교 행사 때문, 다음 주부터 정상 출석 예정."),
                  (0, "박사범", "품새 동작 정확도 우수. 승급 심사 추천.")],
        "inventory": [("출석 스티커 롤", "소모품", "롤", 1, 3, "ST-036", ""), ("A4 복사지", "소모품", "박스", 4, 2, "ST-028", ""),
                      ("화이트보드 마카", "수업 물품", "세트", 0, 2, "ST-015", ""), ("유단자 띠(검정)", "도장 용품", "개", 6, 5, None, "태권도 띠"),
                      ("승급 매달", "행사 용품", "개", 12, 10, None, "매달"), ("품새 교재", "교재", "권", 20, 5, None, "")],
        "order": [("승급 띠 세트 (10색)", 2), ("A4 복사지 80g (2,500매)", 1)],
    },
}
CLASSES = PROFILES["dojang"]["classes"]      # (이전 버전 호환용 이름)
WEEKDAY_CODES = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
DEMO_PARENT_EMAIL = "demo.parent@example.invalid"   # 시연용 가상 학부모(로그인 불가) — 댓글·좋아요 예시용


def seed(db, m, account=None, force: bool = False) -> dict:
    """m = main 모듈 (모델·헬퍼). 학생이 이미 있으면 force 없이는 넣지 않습니다."""
    if db.query(m.Member).count() and not force:
        raise ValueError("이미 학생 데이터가 있어 데모 데이터를 넣지 않았습니다.")
    random.seed(7)
    today = m._today()
    now = m._now()

    m._ensure_shop_products(db)            # 쇼핑몰 시드 상품(아래 주문 예시용) — 먼저 넣고 시작
    # 학원 종류에 맞는 프로필 (도장·체육관 → 태권도, 그 외 → 수학·영어 학원)
    academy = m._read_settings(db, "academy_info", m.DEFAULT_ACADEMY_SETTINGS)
    payment = m._read_settings(db, "payment_settings", m.DEFAULT_PAYMENT_SETTINGS)
    kind = "dojang" if academy.get("facilityType") in ("도장", "체육관") else "academy"
    profile = PROFILES[kind]
    if academy.get("name") in (None, "", "우리 학원", "한빛학원"):
        academy = {**m.DEFAULT_ACADEMY_SETTINGS, **academy, **profile["academy"], "phone": "031-000-0000", "region": "경기 용인시"}
    elif not academy.get("subjects"):
        academy = {**academy, "subjects": profile["academy"]["subjects"]}
    payment = {**m.DEFAULT_PAYMENT_SETTINGS, **payment, "baseTuitionFee": 180000 if kind == "dojang" else 200000}
    class_specs = profile["classes"]

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
    for idx, (name, teacher, schedule, desc, color, fee) in enumerate(class_specs):
        cls = m.Class(name=name, teacher=teacher, start_date=today - timedelta(days=90),
                      end_date=today + timedelta(days=180), description=desc, color_index=idx,
                      color=color, monthly_fee=fee,
                      days_of_week=",".join(d for d, _, _ in schedule),
                      start_time=time.fromisoformat(schedule[0][1]), end_time=time.fromisoformat(schedule[0][2]),
                      schedule_detail=json.dumps([{"day": d, "start": s, "end": e} for d, s, e in schedule]))
        db.add(cls)
        classes.append(cls)
    db.flush()
    m._write_settings(db, academy, payment)

    member_classes = {}
    for i, member in enumerate(members):
        picks = [classes[i % 3]] + ([classes[(i + 1) % 3]] if i % 4 == 0 else [])
        member_classes[member.member_id] = picks
        for cls in picks:
            db.add(m.Enrollment(member_id=member.member_id, class_id=cls.class_id))

    # 최근 35일 수업별 출결 (오늘은 비움 → 출석 체크 화면에서 체험). 3번 학생은 출석률 낮음, 6번 학생은 최근 연속 결석
    for d in range(1, 36):
        day = today - timedelta(days=d)
        code = WEEKDAY_CODES[day.weekday()]
        for i, member in enumerate(members[:11]):
            for cls, schedule in ((c, class_specs[classes.index(c)][2]) for c in member_classes[member.member_id]):
                slot = next((sl for sl in schedule if sl[0] == code), None)
                if not slot:
                    continue
                weights = [55, 10, 35] if i == 3 else [84, 9, 7]
                status = random.choices(["PRESENT", "LATE", "ABSENT"], weights)[0]
                if i == 6 and d <= 4:
                    status = "ABSENT"
                start = time.fromisoformat(slot[1])
                check_in = None if status == "ABSENT" else (
                    datetime.combine(day, start) + timedelta(minutes=random.randint(-10, -1) if status == "PRESENT"
                                                             else random.randint(6, 20))).time()
                check_out = None if status == "ABSENT" else time.fromisoformat(slot[2])
                db.add(m.Attendance(member_id=member.member_id, attendance_date=day, status=status, class_id=cls.class_id,
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

    for title, content, html, pinned, class_idx in profile["notices"]:
        db.add(m.Notice(title=title, content=content, content_html=html, is_pinned=pinned,
                        category="EVENT" if pinned or class_idx is not None else "GENERAL",
                        author=academy.get("principal") or "원장", class_id=classes[class_idx].class_id if class_idx is not None else None))
    due_soon = (today + timedelta(days=5)).isoformat()
    (c1, t1, d1), (c2, t2, d2) = profile["assignments"]
    a1 = m.Assignment(class_id=classes[c1].class_id, title=t1, content=d1, due_date=due_soon)
    a2 = m.Assignment(class_id=classes[c2].class_id, title=t2, content=d2, due_date=(today - timedelta(days=2)).isoformat())
    db.add_all([a1, a2])
    db.flush()
    for i, member in enumerate(members[:11]):
        if i % 3 == 0:   # 첫 번째 반
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
    if not db.query(m.FacilityMember).filter(m.FacilityMember.user_id == parent.user_id).first():
        db.add(m.FacilityMember(user_id=parent.user_id, nickname="서연맘", status="ACTIVE", joined_at=now - timedelta(days=20)))
    principal = academy.get("principal") or "관리자"
    (t1, b1), (t2, b2), (t3, b3) = profile["posts"]
    post1 = m.CommunityPost(title=t1, content=b1, category="PHOTO", author_role="admin", like_count=0, view_count=24,
                            status="VISIBLE", author=principal, created_at=now - timedelta(hours=5))
    post2 = m.CommunityPost(title=t2, content=b2, category="INFO", author_role="admin", like_count=0, view_count=31,
                            status="VISIBLE", author=principal, created_at=now - timedelta(days=1))
    post3 = m.CommunityPost(title=t3, content=b3, category="FREE", author_role="parent", user_id=parent.user_id, like_count=0,
                            view_count=12, status="VISIBLE", author="서연맘", created_at=now - timedelta(days=2))
    db.add_all([post1, post2, post3])
    db.flush()
    db.add(m.CommunityLike(post_id=post1.post_id, user_id=parent.user_id))
    post1.like_count = 1
    samples = [
        (profile["good_comments"][0], None),
        (profile["good_comments"][1], None),
        ("광고 보고 등록했는데 홍보 영상 www.youtube.com 에서 봤어요!", "APPROVED"),   # 오탐(링크) → 관리자 승인
        ("시발 왜 연락이 없냐", "HIDDEN"),                                            # 정탐
        ("여기 원장 사기꾼 같아요", "HIDDEN_FN"),                                     # 미탐 → 관리자가 직접 숨김
        ("고수익 부업 오픈채팅 들어오세요 bit.ly/abcd", None),                         # 검토 대기
    ]
    for offset, (content, decision) in enumerate(samples):
        comment = m.CommunityComment(post_id=post1.post_id, author="서연맘", content=content, user_id=parent.user_id,
                                     author_role="parent",
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

    # 최근 활동 예시 (어제 출석 체크·하원, 학부모 열람) — 대시보드 '최근 활동'·'학부모 앱 활성' 카드용
    yesterday = now - timedelta(days=1)
    staff_id = account.account_id if account is not None else None
    for minutes, actor, action, idx, summary in ((0, "admin", "attendance.mark", 0, "출석 (학부모 알림)"),
                                                 (3, "admin", "attendance.mark", 4, "지각 (학부모 알림)"),
                                                 (65, "admin", "attendance.checkout", 0, "하원 (학부모 알림)"),
                                                 (90, "parent", "notice.read", 1, "공지 열람")):
        db.add(m.ActivityLog(actor_type=actor, actor_id=parent.user_id if actor == "parent" else staff_id, action=action,
                             target_type="member", target_id=members[idx].member_id, summary=summary,
                             created_at=yesterday.replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(minutes=minutes)))

    # 관리자 알림함 예시 (시연 시작 시 종 아이콘에 표시)
    m._notify_admins(db, "MODERATION", "검토가 필요한 댓글", "자동 탐지: 광고·스팸(링크 포함)", "community")
    m._notify_admins(db, "PAYMENT", f"{members[1].name} 학생 학부모 결제 완료",
                     f"{month_label} {150000 + 20000:,}원 (카카오페이)", "admin-checkout", member_id=members[1].member_id)

    if account is not None:
        for due_time, text_value, tag in profile["todos"]:
            db.add(m.AdminTodo(account_id=account.account_id, due_time=due_time, text=text_value, tag=tag))
    for idx, author, content in profile["notes"]:
        db.add(m.MemberNote(member_id=members[idx].member_id, author=author, content=content))
    # v10 재고 (일부는 안전 재고 이하 → '구매 확인' 시연). B2B 상품과 연결해 구매 화면으로 바로 이동
    m._ensure_b2b_products(db)
    for name, category, unit, qty, minimum, sku, keyword in profile["inventory"]:
        db.add(m.InventoryItem(name=name, category=category, unit=unit, quantity=qty, min_quantity=minimum,
                               b2b_sku=sku, keyword=keyword, location="사무실 수납장"))
    # v11 쇼핑몰: 과목에 맞는 제휴몰 1곳 연결 + 이번 달 결제 완료(입고 대기) 주문 1건 — '입고 처리' 시연용 (모의 결제)
    mall = "edubooks" if kind == "academy" else "sportsfarm"
    if not db.query(m.ShopMallLink).filter(m.ShopMallLink.mall_code == mall).first():
        db.add(m.ShopMallLink(mall_code=mall, connected_by=account.account_id if account is not None else None))
        db.flush()
    by_name = {p.name: p for p in db.query(m.ShopProduct).filter(m.ShopProduct.name.in_([n for n, _ in profile["order"]])).all()}
    lines = [m.ShopCartLine(product_id=by_name[n].product_id, quantity=q) for n, q in profile["order"] if n in by_name]
    if lines and account is not None:
        quote = m._quote_cart(db, lines)
        order = m.ShopOrder(order_number=f"SO-{today:%Y%m%d}-D{m.secrets.token_hex(3).upper()}", account_id=account.account_id,
                            status="PAID", list_total=quote["list_total"], product_discount=quote["product_discount"],
                            member_discount=quote["member_discount"], shipping_fee=quote["shipping_fee"], total=quote["total"],
                            payment_method="CARD", payment_tid="MOCK-DEMO", paid_by=account.account_id,
                            paid_at=now - timedelta(hours=20), memo="시연용 주문 (모의 결제)")
        for g in quote["groups"]:
            for it in g["items"]:
                order.items.append(m.ShopOrderItem(product_id=it["product_id"], mall_code=g["mall"]["code"], product_name=it["name"],
                                                   unit=it["unit"], quantity=it["quantity"], list_price=it["list_price"],
                                                   unit_price=it["unit_price"], line_total=it["line_total"]))
        db.add(order)
    db.commit()
    return {"members": len(members), "classes": len(classes),
            "attendance_demo": "관리자 '출석 체크'에서 출석을 누르면 연결된 학부모에게 알림",
            "parent_demo": {"child_name": members[0].name, "phone": members[0].mother_phone}}

"""공지 자동 작성 — 키워드·날짜·시간 몇 개로 공지 양식을 완성합니다.

  입력 예) "에버랜드, 10/25, 선택 참여"
  결과   ) 제목 "[행사] 10월 25일(일) 에버랜드 현장 체험학습 안내"
           본문 인사말 → 행사 소개 → ■ 일시/장소/대상/참여 방법/준비물/참가비/신청 → 마무리 인사

동작 방식 (2단계)
  1) 규칙 기반 파서(parse_keywords)가 날짜·시간·참여 방식·비용·준비물·장소를 뽑아 구조화합니다. (항상 동작, 외부 API 불필요)
  2) GEMINI_API_KEY 가 있으면 구조화된 값과 학원 이름·유형만 Gemini 에 보내 문장을 다듬습니다(학생·학부모 개인정보 없음).
     AI 응답이 없거나 형식이 틀리면 1)의 템플릿 결과를 그대로 씁니다 → 전시회에서 인터넷·API 한도 문제가 있어도 시연 가능.

학원 유형(학원·체육관·도장)과 무관하게 동작하도록 호칭(학생/회원)·인사말을 학원 정보로 정합니다.
"""
from dataclasses import dataclass, field
from datetime import date, timedelta
import re
from typing import List, Optional

WEEKDAY_KO = "월화수목금토일"

# 장소로 보이는 단어 (끝말 또는 대표 장소명) → 현장 체험학습
PLACE_SUFFIXES = ("랜드", "월드", "공원", "박물관", "미술관", "과학관", "기념관", "전시관", "동물원", "식물원", "수목원",
                  "농장", "체험관", "아쿠아리움", "파크", "해수욕장", "캠프장", "천문대", "경기장", "체육관", "도서관",
                  "센터", "궁", "성당", "사찰", "마을", "숲", "산", "섬", "역사관", "테마파크", "키자니아", "목장")
PLACE_NAMES = {"에버랜드", "롯데월드", "서울랜드", "키자니아", "캐리비안베이", "아쿠아플라넷", "코엑스", "국립중앙박물관",
               "어린이대공원", "남산타워", "한국민속촌", "레고랜드", "경주월드", "이월드", "서울숲", "올림픽공원"}

# (키워드들, 종류, 공지 분류, 상단 고정, 제목 꼬리)
EVENT_RULES = [
    (("휴원", "휴관", "휴무", "쉽니다", "임시 휴"), "closure", "URGENT", True, "휴원 안내"),
    (("긴급", "안전", "태풍", "폭설", "감염", "독감", "코로나"), "urgent", "URGENT", True, "긴급 안내"),
    (("수강료", "회비", "납부", "결제", "청구"), "payment", "GENERAL", True, "수강료 납부 안내"),
    (("대회", "시합", "토너먼트", "경기"), "competition", "EVENT", False, "대회 참가 안내"),
    (("심사", "승급", "승단", "레벨테스트", "평가"), "exam", "EVENT", False, "심사 안내"),
    (("상담", "학부모 면담", "면담"), "counsel", "GENERAL", False, "학부모 상담 안내"),
    (("공개수업", "참관", "발표회", "공연", "시범"), "open_class", "EVENT", False, "공개 행사 안내"),
    (("보강", "시간 변경", "시간표 변경", "수업 변경"), "schedule", "GENERAL", True, "수업 일정 변경 안내"),
    (("캠프", "운동회", "체육대회", "소풍", "축제", "파티", "행사", "체험"), "event", "EVENT", False, "행사 안내"),
    (("견학", "현장학습", "체험학습", "나들이"), "trip", "EVENT", False, "현장 체험학습 안내"),
    (("모집", "개강", "신규", "오픈"), "recruit", "GENERAL", False, "모집 안내"),
]

OPTIONAL_WORDS = ("선택 참여", "선택참여", "자율 참여", "자율참여", "희망자", "원하는", "선택")
REQUIRED_WORDS = ("필수 참여", "필수참여", "전원 참여", "전원참여", "필참", "필수", "전원")
FREE_WORDS = ("무료", "참가비 없음", "비용 없음")


@dataclass
class ParsedNotice:
    raw: str
    day: Optional[date] = None
    end_day: Optional[date] = None
    time_text: str = ""
    deadline: Optional[date] = None
    participation: str = ""            # optional / required / ""
    fee_text: str = ""
    prep: str = ""
    place: str = ""
    topic: str = ""                    # 장소가 아닌 핵심 키워드(행사 이름 등)
    keyword: str = ""                  # 종류를 정한 단어(예: 공개수업, 휴원)
    kind: str = "general"
    category: str = "GENERAL"
    pinned: bool = False
    title_tail: str = "안내"
    extras: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"date": self.day.isoformat() if self.day else None,
                "end_date": self.end_day.isoformat() if self.end_day else None,
                "time": self.time_text or None, "deadline": self.deadline.isoformat() if self.deadline else None,
                "participation": self.participation or None, "fee": self.fee_text or None, "prep": self.prep or None,
                "place": self.place or None, "topic": self.topic or None, "kind": self.kind, "extras": self.extras}


def _resolve_day(month: int, day_num: int, today: date, year: Optional[int] = None) -> Optional[date]:
    try:
        candidate = date(year or today.year, month, day_num)
    except ValueError:
        return None
    if year is None and candidate < today - timedelta(days=60):     # 이미 한참 지난 날짜면 내년으로 봄
        try:
            candidate = date(today.year + 1, month, day_num)
        except ValueError:
            return None
    return candidate


_DATE_PATTERNS = [
    re.compile(r"(?P<y>20\d{2})[./-]\s*(?P<m>\d{1,2})[./-]\s*(?P<d>\d{1,2})"),
    re.compile(r"(?:(?P<y>20\d{2})\s*년\s*)?(?P<m>\d{1,2})\s*월\s*(?P<d>\d{1,2})\s*일?"),
    re.compile(r"(?<![\d:])(?P<m>\d{1,2})\s*[/.]\s*(?P<d>\d{1,2})(?![\d:])"),
]
_TIME_RANGE = re.compile(
    r"(?P<ap1>오전|오후|아침|저녁|낮)?\s*(?P<h1>\d{1,2})(?:\s*[:시]\s*(?P<m1>\d{1,2})?\s*분?)?\s*(?:~|-|부터)\s*"
    r"(?P<ap2>오전|오후|저녁)?\s*(?P<h2>\d{1,2})(?:\s*[:시]\s*(?P<m2>\d{1,2})?\s*분?)?\s*(?:까지)?")
_TIME_ONE = re.compile(r"(?P<ap>오전|오후|아침|저녁|낮)?\s*(?P<h>\d{1,2})\s*(?::\s*(?P<m>\d{2})|시(?:\s*(?P<m2>\d{1,2})\s*분)?(?P<half>\s*반)?)")
_RELATIVE_DAYS = {"오늘": 0, "내일": 1, "모레": 2}
_WEEKDAY_WORD = re.compile(r"(?:(?P<next>다음\s*주|담주)|(?P<this>이번\s*주))?\s*(?P<wd>[월화수목금토일])요일")


def _hour(ap: Optional[str], h: int) -> int:
    if ap in ("오후", "저녁") and h < 12:
        return h + 12
    if ap in ("낮", None) and 1 <= h <= 7:     # 오전/오후 없이 '4시' → 방과 후 학원은 오후로 보는 것이 자연스러움
        return h + 12
    return h


def _fmt_time(h: int, m: int) -> str:
    ap = "오전" if h < 12 else "오후"
    h12 = h if 1 <= h <= 12 else (h - 12 if h > 12 else 12)
    return f"{ap} {h12}시" + (f" {m}분" if m else "")


def _find_dates(text: str, today: date) -> List[date]:
    found = []
    taken = []
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(text):
            if any(a <= match.start() < b for a, b in taken):
                continue
            y = match.groupdict().get("y")
            resolved = _resolve_day(int(match.group("m")), int(match.group("d")), today, int(y) if y else None)
            if resolved:
                found.append((match.start(), resolved))
                taken.append((match.start(), match.end()))
    for word, offset in _RELATIVE_DAYS.items():
        idx = text.find(word)
        if idx >= 0:
            found.append((idx, today + timedelta(days=offset)))
    for match in _WEEKDAY_WORD.finditer(text):
        target = WEEKDAY_KO.index(match.group("wd"))
        delta = (target - today.weekday()) % 7
        if match.group("next"):
            delta = delta + 7 if delta else 7
        found.append((match.start(), today + timedelta(days=delta)))
    return [d for _, d in sorted(found, key=lambda x: x[0])]


def parse_keywords(raw: str, today: date) -> ParsedNotice:
    raw = (raw or "").strip()
    result = ParsedNotice(raw=raw)
    # 구분자: 쉼표·줄바꿈·가운뎃점. '/' 는 날짜(10/25)에도 쓰이므로 앞뒤에 공백이 있을 때만 구분자로 사용
    #         쉼표 뒤가 세 자리 숫자면(30,000원) 천 단위 구분 쉼표로 보고 나누지 않음
    tokens = [t.strip() for t in re.split(r",(?!\d{3}(?:\D|$))|[\n·|]+|\s/\s", raw) if t.strip()]
    lowered = raw.replace(" ", "")

    # 마감일: '마감'/'까지 신청' 이 붙은 토큰의 날짜
    rest_tokens = []
    for token in tokens:
        if re.search(r"마감|신청\s*기한|까지\s*신청|신청\s*까지", token):
            dates = _find_dates(token, today)
            if dates:
                result.deadline = dates[0]
                continue
        rest_tokens.append(token)
    joined = " ".join(rest_tokens)

    dates = _find_dates(joined, today)
    if dates:
        result.day = dates[0]
        if len(dates) > 1 and dates[1] > dates[0]:
            result.end_day = dates[1]
    else:
        result.warnings.append("날짜를 찾지 못했습니다. 본문의 일시를 확인해 주세요.")

    time_source = re.sub(r"(20\d{2})[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일?|\d{1,2}\s*[/.]\s*\d{1,2}(?![\d:])", " ", joined)
    match = _TIME_RANGE.search(time_source)
    if match and (match.group("m1") is not None or ":" in match.group(0) or "시" in match.group(0)):
        h1 = _hour(match.group("ap1"), int(match.group("h1")))
        h2 = _hour(match.group("ap2") or (match.group("ap1") if int(match.group("h2")) > int(match.group("h1")) else "오후"),
                   int(match.group("h2")))
        if 0 <= h1 < 24 and 0 <= h2 < 24:
            result.time_text = f"{_fmt_time(h1, int(match.group('m1') or 0))} ~ {_fmt_time(h2, int(match.group('m2') or 0))}"
    if not result.time_text:
        match = _TIME_ONE.search(time_source)
        if match:
            h = _hour(match.group("ap"), int(match.group("h")))
            minute = int(match.group("m") or match.group("m2") or (30 if match.group("half") else 0))
            if 0 <= h < 24 and 0 <= minute < 60:
                result.time_text = _fmt_time(h, minute)

    if any(w.replace(" ", "") in lowered for w in REQUIRED_WORDS):
        result.participation = "required"
    elif any(w.replace(" ", "") in lowered for w in OPTIONAL_WORDS):
        result.participation = "optional"

    fee = re.search(r"(\d{1,3}(?:,\d{3})+|\d+)\s*(만\s*)?원", joined)
    if fee:
        amount = int(fee.group(1).replace(",", "")) * (10000 if fee.group(2) else 1)
        result.fee_text = f"{amount:,}원"
    elif any(w in joined for w in FREE_WORDS):
        result.fee_text = "무료"

    for token in rest_tokens:
        prep = re.match(r"^(준비물|지참물|챙길\s*것)\s*[:：]?\s*(.+)$", token)
        if prep:
            result.prep = prep.group(2).strip()

    # 종류 판정 (앞 규칙이 우선)
    for keywords, kind, category, pinned, tail in EVENT_RULES:
        hit = next((k for k in keywords if k in joined), None)
        if hit:
            result.kind, result.category, result.pinned, result.title_tail = kind, category, pinned, tail
            result.keyword = hit
            break

    # 남은 토큰에서 장소·주제 고르기
    noise = re.compile(r"(20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일?|\d{1,2}\s*[/.]\s*\d{1,2}|"
                       r"(오전|오후|아침|저녁|낮)?\s*\d{1,2}\s*(:\s*\d{2}|시(\s*\d{1,2}\s*분)?(\s*반)?)|~|부터|까지|"
                       r"(다음\s*주|이번\s*주)?\s*[월화수목금토일]요일|오늘|내일|모레|"
                       r"선택\s*참여|자율\s*참여|필수\s*참여|전원\s*참여|희망자|필참|필수|선택|전원|무료|"
                       r"\d[\d,]*\s*(만\s*)?원|참가비|회비)")
    rule_words = {k for keywords, *_ in EVENT_RULES for k in keywords}
    for token in rest_tokens:
        if re.match(r"^(준비물|지참물|챙길\s*것)", token):
            continue
        cleaned = re.sub(r"\s+", " ", noise.sub(" ", token)).strip(" -:")
        if not cleaned:
            continue
        words = cleaned.split()
        place = next((w for w in words if w in PLACE_NAMES or (len(w) >= 2 and w.endswith(PLACE_SUFFIXES))), None)
        if place and not result.place:
            result.place = place
            others = " ".join(w for w in words if w != place and w not in rule_words)
            if others:
                result.extras.append(others)
        elif not result.topic and cleaned not in rule_words:
            result.topic = cleaned
        elif cleaned not in rule_words:
            result.extras.append(cleaned)
    if result.place and result.kind == "general":
        result.kind, result.category, result.title_tail = "trip", "EVENT", "현장 체험학습 안내"
    if result.place and result.kind == "event" and any(k in joined for k in ("견학", "체험학습", "현장학습")):
        result.title_tail = "현장 체험학습 안내"
    return result


def _has_batchim(word: str) -> bool:
    """마지막 글자에 받침이 있는지 (한글이 아니면 받침 없음으로 봄)"""
    ch = (word or " ").strip()[-1:] or " "
    code = ord(ch) - 0xAC00
    return 0 <= code <= 11171 and code % 28 != 0


def josa(word: str, pair: str) -> str:
    """조사 자동 선택: josa('체험학습', '을를') → '체험학습을', josa('심사', '은는') → '심사는'"""
    return f"{word}{pair[0] if _has_batchim(word) else pair[1]}"


def _date_text(d: date, with_year: bool = True) -> str:
    base = f"{d.month}월 {d.day}일({WEEKDAY_KO[d.weekday()]})"
    return f"{d.year}년 {base}" if with_year else base


def _member_word(facility_type: str) -> str:
    return "회원" if facility_type in ("체육관", "기타") else "학생"


def build_template(parsed: ParsedNotice, facility: dict, target_label: str = "") -> dict:
    """구조화된 값 → 공지 제목·본문(순수 텍스트). 빈 값은 '추후 안내'로 채워 양식을 유지합니다."""
    name = (facility.get("name") or "저희 학원").strip()
    principal = (facility.get("principal") or "").strip()
    phone = (facility.get("phone") or "").strip()
    who = _member_word(facility.get("facilityType") or facility.get("facility_type") or "학원")
    subject = parsed.place or parsed.topic or ""
    if not subject and parsed.keyword and parsed.kind not in ("closure", "payment", "urgent"):
        subject = parsed.keyword           # '공개수업' 처럼 종류 단어만 입력한 경우 그 단어를 행사 이름으로
    kind = parsed.kind

    kind_word = parsed.title_tail.replace(" 안내", "")          # 예: '현장 체험학습', '심사', '휴원'
    rule_words = next((keywords for keywords, k, *_ in EVENT_RULES if k == kind), ())
    if kind == "trip":
        event_name = f"{parsed.place or subject} 현장 체험학습".strip()
    elif kind in ("closure", "payment"):
        event_name = kind_word
    elif subject and any(w in subject for w in rule_words):
        event_name = subject                    # '승급 심사' 처럼 이미 종류 단어가 들어 있으면 그대로
    elif subject:
        event_name = f"{subject} {kind_word}" if kind != "general" else subject
    else:
        event_name = kind_word if kind != "general" else "행사"
    prefix = {"URGENT": "[긴급]", "EVENT": "[행사]"}.get(parsed.category, "[안내]")
    when_short = _date_text(parsed.day, with_year=False) if parsed.day else ""
    title = " ".join(x for x in (prefix, when_short, event_name, "안내") if x)
    title = re.sub(r"안내 안내$", "안내", title)[:200]

    greet = f"안녕하세요, {name}{(' ' + principal) if principal else ''}입니다."
    when_long = _date_text(parsed.day) if parsed.day else "추후 안내"
    if parsed.end_day:
        when_long += f" ~ {_date_text(parsed.end_day, with_year=False)}"
    if parsed.time_text:
        when_long += f" {parsed.time_text}"

    short_word = event_name.split()[-1] if event_name else "행사"
    if kind == "closure":
        day_text = _date_text(parsed.day) if parsed.day else "아래 일정"
        intro = f"{day_text}에는 학원 사정으로 휴원합니다. 해당 일의 수업은 진행되지 않으니 참고 부탁드립니다."
    elif kind == "payment":
        intro = "수강료 납부를 안내드립니다. 학부모 포털 '결제' 탭에서 카카오페이로 바로 납부하실 수 있습니다."
    elif kind == "schedule":
        intro = "수업 일정이 아래와 같이 변경되어 안내드립니다. 일정 확인 부탁드립니다."
    else:
        intro = f"{when_short + '에 ' if when_short else ''}{josa(event_name, '을를')} 진행합니다."
        if parsed.participation == "optional":
            intro += f" 이번 {josa(short_word, '은는')} 선택 참여로, 참여를 원하시는 가정만 신청해 주시면 됩니다."
        elif parsed.participation == "required":
            intro += f" 모든 {josa(who, '이가')} 함께 참여하는 일정이니 꼭 참석 부탁드립니다."

    lines = [greet, "", intro, ""]
    when_label = {"payment": "납부 기한", "counsel": "기간"}.get(kind, "일시")
    if kind == "counsel" and not parsed.end_day:
        when_label = "일시"
    rows = [(when_label, when_long + ("까지" if kind == "payment" and parsed.day else ""))]
    if parsed.place:
        rows.append(("장소", parsed.place))
    if kind not in ("closure", "payment"):
        rows.append(("대상", target_label or f"전체 {who}"))
    if parsed.participation:
        rows.append(("참여", "선택 참여 (희망자에 한함)" if parsed.participation == "optional" else "필수 참여 (전원)"))
    if parsed.fee_text:
        rows.append(("참가비", parsed.fee_text))
    if parsed.prep:
        rows.append(("준비물", parsed.prep))
    if parsed.participation == "optional" or parsed.deadline:
        deadline = f"{_date_text(parsed.deadline, with_year=False)}까지 " if parsed.deadline else ""
        rows.append(("신청", f"{deadline}댓글 또는 학원 연락처로 참여 여부를 알려 주세요."))
    for extra in parsed.extras:
        rows.append(("참고", extra))
    lines += [f"■ {k}: {v}" for k, v in rows]
    lines += ["", f"궁금하신 점은 {phone}(으)로 연락 주시면 친절히 안내해 드리겠습니다." if phone else
              "궁금하신 점은 학원으로 문의해 주세요.", "감사합니다."]
    return {"title": title, "content": "\n".join(lines), "category": parsed.category, "is_pinned": parsed.pinned}


def ai_prompt(parsed: ParsedNotice, facility: dict, draft: dict, target_label: str) -> str:
    """Gemini 다듬기용 프롬프트 — 학원 이름·유형과 구조화된 값만 보냄(개인정보 없음)"""
    return (
        "당신은 학원·체육관·도장의 공지문을 쓰는 비서입니다. 아래 '초안'의 사실(날짜·시간·장소·참여 방식·비용)을 절대 바꾸지 말고, "
        "학부모에게 보내는 정중하고 따뜻한 공지로 문장만 다듬어 주세요. '■ 항목: 값' 목록 형식은 유지하세요.\n"
        "반드시 JSON 한 개로만 답하세요: {\"title\": \"...\", \"content\": \"...\"}\n\n"
        f"[학원] 이름: {facility.get('name') or ''} / 유형: {facility.get('facilityType') or facility.get('facility_type') or ''}\n"
        f"[대상] {target_label or '전체'}\n[입력 키워드] {parsed.raw[:300]}\n"
        f"[구조화 결과] {parsed.as_dict()}\n\n[초안 제목]\n{draft['title']}\n\n[초안 본문]\n{draft['content']}"
    )

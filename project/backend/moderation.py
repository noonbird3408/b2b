"""커뮤니티 댓글 자동 모니터링 (v1: 규칙 기반)

판정 흐름
  1) 규칙 기반 점수(rule_v1): 욕설·비하, 스팸·광고, 개인정보 노출, 도배를 점수화
  2) (선택) Gemini 보조 판정: MODERATION_AI=true 이고 GEMINI 키가 있을 때 애매한 구간(점수 20~59)만 재확인
  3) 점수 >= FLAG_THRESHOLD 이면 '검토 대기' → 관리자가 승인/숨김으로 최종 판정

관리자 판정(승인/숨김)은 comment_reviews 테이블에 라벨로 남아,
  - 규칙 필터의 정밀도·재현율 계산(/api/community/moderation/stats)
  - 향후 한국어 Transformer(KcELECTRA 등) 파인튜닝용 학습 데이터 내보내기
에 사용됩니다. 모델을 교체할 때는 moderate_text() 의 반환 형식(ModerationResult)만 지키면 됩니다.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Callable, List, Optional

MODEL_NAME = "rule_v1"
FLAG_THRESHOLD = 60   # 이 점수 이상이면 검토 대기 (0~100)

# 욕설·비하 표현 — 띄어쓰기·특수문자를 넣어 피해 가는 경우를 고려해 정규화한 문자열에서 찾습니다.
_PROFANITY = [
    "시발", "씨발", "씨바", "시바", "ㅅㅂ", "ㅆㅂ", "ㅅ1ㅂ", "십새", "씹", "개새끼", "개새", "개색",
    "병신", "ㅂㅅ", "븅신", "좆", "존나", "졸라", "ㅈㄴ", "지랄", "ㅈㄹ", "미친놈", "미친년", "미친새",
    "꺼져", "닥쳐", "엿먹", "등신", "또라이", "찐따", "애미", "애비", "느금", "니미", "썅", "fuck", "shit",
]
# 상대를 깎아내리는 표현(단독으로는 약하게)
_INSULT_SOFT = ["멍청", "한심", "쓰레기", "무능", "최악", "사기꾼", "돈만 밝", "고소", "신고할"]
# 스팸·광고
_SPAM = ["광고", "홍보", "부업", "재택알바", "수익", "고수익", "대출", "코인", "리딩방", "카톡방", "오픈채팅",
         "텔레그램", "무료체험", "할인코드", "쿠폰받", "클릭", "링크", "가입하", "투자"]
_URL_RE = re.compile(r"(https?://|www\.|[a-z0-9-]+\.(com|net|kr|co\.kr|io|me|ly|gg)\b)", re.I)
_PHONE_RE = re.compile(r"01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}")
_RRN_RE = re.compile(r"\d{6}[-\s]?[1-4]\d{6}")        # 주민등록번호 형태
_ACCOUNT_RE = re.compile(r"\d{3,6}[-\s]\d{2,6}[-\s]\d{2,8}")   # 계좌번호 형태
_REPEAT_RE = re.compile(r"(.)\1{7,}")                # 같은 글자 8번 이상


@dataclass
class ModerationResult:
    score: int                      # 0~100
    flagged: bool                   # True → 관리자 검토 대기
    reasons: List[str] = field(default_factory=list)
    model: str = MODEL_NAME


def _normalize(text: str) -> str:
    """띄어쓰기·특수문자·숫자 끼워 넣기(시1발, 시.발)를 제거한 비교용 문자열"""
    text = unicodedata.normalize("NFKC", text or "").lower()
    return re.sub(r"[\s\.\,\-_\*\~\!\?\^0-9@#$%&()\[\]{}'\"`|/\\]+", "", text)


def mask_personal_info(text: str) -> str:
    """학습 데이터 내보내기·AI 프롬프트용 가명화: 전화번호·주민번호·계좌번호·이메일을 가립니다."""
    text = _RRN_RE.sub("[주민번호]", text or "")
    text = _PHONE_RE.sub("[전화번호]", text)
    text = _ACCOUNT_RE.sub("[계좌번호]", text)
    return re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[이메일]", text)


def rule_score(text: str) -> ModerationResult:
    raw = text or ""
    norm = _normalize(raw)
    score, reasons = 0, []

    hits = [w for w in _PROFANITY if _normalize(w) in norm]
    if hits:
        score += 70 + 10 * min(len(hits) - 1, 2)
        reasons.append("욕설·비하 표현")
    soft = [w for w in _INSULT_SOFT if w in raw]
    if soft:
        score += 25
        reasons.append("공격적 표현")

    spam_hits = [w for w in _SPAM if w in raw]
    has_url = bool(_URL_RE.search(raw))
    if has_url and spam_hits:
        score += 70
        reasons.append("광고·스팸(링크 포함)")
    elif has_url:
        score += 35
        reasons.append("외부 링크")
    elif len(spam_hits) >= 2:
        score += 45
        reasons.append("광고성 단어")

    if _RRN_RE.search(raw):
        score += 80
        reasons.append("주민등록번호 노출")
    elif _PHONE_RE.search(raw) or _ACCOUNT_RE.search(raw):
        score += 60
        reasons.append("연락처·계좌번호 노출")

    if _REPEAT_RE.search(raw) or (len(raw) > 30 and len(set(norm)) <= 3):
        score += 40
        reasons.append("도배")

    score = max(0, min(100, score))
    return ModerationResult(score=score, flagged=score >= FLAG_THRESHOLD, reasons=reasons)


def moderate_text(text: str, ai_judge: Optional[Callable[[str], Optional[dict]]] = None) -> ModerationResult:
    """댓글 1건 판정. ai_judge 가 주어지면 애매한 구간만 AI 로 재확인합니다.

    ai_judge(text) → {"harmful": bool, "reason": str} 또는 실패 시 None (실패하면 규칙 결과만 사용)
    """
    result = rule_score(text)
    if ai_judge and 20 <= result.score < FLAG_THRESHOLD:
        verdict = ai_judge(mask_personal_info(text))
        if verdict is not None:
            result.model = f"{MODEL_NAME}+gemini"
            if verdict.get("harmful"):
                result.score = max(result.score, FLAG_THRESHOLD)
                result.flagged = True
                result.reasons.append(f"AI 판정: {str(verdict.get('reason') or '유해 가능성')[:40]}")
    return result

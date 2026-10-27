"""게시글·공지 서식(글꼴·굵기·색 등) HTML 정리 — 허용 목록(allowlist) 방식

왜 필요한가
  편집기(contentEditable)가 만든 HTML 을 그대로 저장·표시하면 <script>, onerror= 같은 코드가 섞여
  다른 학부모·관리자 화면에서 실행될 수 있습니다(저장형 XSS). 서버가 저장 전에 '허용한 태그·속성·스타일'만 남기고
  나머지는 모두 지웁니다. 프론트도 표시 직전에 한 번 더 같은 규칙으로 정리합니다(이중 방어).

설계 선택
  - 외부 라이브러리(bleach — 유지보수 종료, nh3 — 네이티브 빌드 필요) 대신 표준 라이브러리 html.parser 로 구현
    → Vercel 서버리스 배포에 추가 의존성이 없고, 규칙이 짧아 발표 때 설명하기 쉽습니다.
  - 검색·알림·AI 모니터링에는 HTML 이 아니라 여기서 뽑은 '순수 텍스트'를 씁니다.
"""
from html import escape
from html.parser import HTMLParser
import re

ALLOWED_TAGS = {
    "p", "div", "br", "span", "b", "strong", "i", "em", "u", "s", "strike", "font",
    "h2", "h3", "ul", "ol", "li", "blockquote", "hr", "a",
}
VOID_TAGS = {"br", "hr"}
DROP_CONTENT_TAGS = {"script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "head", "title"}
BLOCK_TAGS = {"p", "div", "h2", "h3", "li", "blockquote", "ul", "ol", "hr", "br"}

# 허용 스타일 — 값은 정규식으로 다시 확인 (url(), expression() 등은 통과하지 못함)
_COLOR = r"#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-zA-Z]{3,20}"
ALLOWED_STYLES = {
    "font-weight": re.compile(r"^(normal|bold|bolder|lighter|[1-9]00)$"),
    "font-style": re.compile(r"^(normal|italic)$"),
    "text-decoration": re.compile(r"^(none|underline|line-through)( (underline|line-through))?$"),
    "text-decoration-line": re.compile(r"^(none|underline|line-through)( (underline|line-through))?$"),
    "font-size": re.compile(r"^(\d{1,2}(\.\d)?(px|pt|em|rem)|x-small|small|medium|large|x-large|xx-large)$"),
    "font-family": re.compile(r"^[\w\s,'\"가-힣-]{1,80}$"),
    "color": re.compile(rf"^({_COLOR})$"),
    "background-color": re.compile(rf"^({_COLOR})$"),
    "text-align": re.compile(r"^(left|right|center|justify)$"),
}
FONT_SIZES = {"1", "2", "3", "4", "5", "6", "7"}
SAFE_URL = re.compile(r"^(https?://|mailto:)[^\s\"'<>]{1,500}$", re.I)
MAX_HTML_CHARS = 60_000


def _clean_style(value: str) -> str:
    out = []
    for part in (value or "").split(";"):
        if ":" not in part:
            continue
        name, _, val = part.partition(":")
        name, val = name.strip().lower(), val.strip()
        rule = ALLOWED_STYLES.get(name)
        if rule and rule.match(val) and "(" not in val.replace("rgb(", "").replace("rgba(", ""):
            out.append(f"{name}: {val}")
    return "; ".join(out)


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list = []
        self.text: list = []
        self.stack: list = []
        self.drop_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.drop_depth += 1
            return
        if self.drop_depth:
            return
        if tag == "br":
            self.text.append("\n")              # 줄바꿈은 그대로
        elif tag in BLOCK_TAGS:
            self._soft_break()
        if tag not in ALLOWED_TAGS:
            return
        clean = []
        for name, value in attrs:
            name = (name or "").lower()
            value = value or ""
            if name == "style":
                style = _clean_style(value)
                if style:
                    clean.append(("style", style))
            elif tag == "a" and name == "href" and SAFE_URL.match(value.strip()):
                clean.append(("href", value.strip()))
            elif tag == "font" and name == "size" and value.strip() in FONT_SIZES:
                clean.append(("size", value.strip()))
            elif tag == "font" and name == "color" and ALLOWED_STYLES["color"].match(value.strip()):
                clean.append(("color", value.strip()))
            elif tag == "font" and name == "face" and ALLOWED_STYLES["font-family"].match(value.strip()):
                clean.append(("face", value.strip()))
        if tag == "a":
            clean += [("target", "_blank"), ("rel", "noopener noreferrer nofollow")]
        attr_text = "".join(f' {k}="{escape(v, quote=True)}"' for k, v in clean)
        if tag in VOID_TAGS:
            self.out.append(f"<{tag}{attr_text}>")
            return
        self.out.append(f"<{tag}{attr_text}>")
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() in ALLOWED_TAGS and tag.lower() not in VOID_TAGS and self.stack and self.stack[-1] == tag.lower():
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.drop_depth = max(0, self.drop_depth - 1)
            return
        if self.drop_depth or tag not in ALLOWED_TAGS or tag in VOID_TAGS:
            return
        if tag in self.stack:            # 짝이 맞지 않는 닫는 태그도 안전하게 정리
            while self.stack:
                top = self.stack.pop()
                self.out.append(f"</{top}>")
                if top == tag:
                    break
        if tag in BLOCK_TAGS:
            self._soft_break()

    def _soft_break(self):
        """문단 경계: 이미 줄이 바뀌어 있으면 더 넣지 않음 (<p>a</p><p>b</p> → 'a\nb')"""
        if self.text and not self.text[-1].endswith("\n"):
            self.text.append("\n")

    def handle_data(self, data):
        if self.drop_depth:
            return
        self.out.append(escape(data, quote=False))
        self.text.append(data)

    def close(self):
        super().close()
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")


def sanitize_html(value: str) -> tuple:
    """서식 HTML → (정리된 HTML, 순수 텍스트). 허용 목록 밖의 태그·속성·스타일은 모두 제거합니다."""
    value = (value or "")[:MAX_HTML_CHARS]
    parser = _Sanitizer()
    parser.feed(value)
    parser.close()
    html = "".join(parser.out).strip()
    text = re.sub(r"[ \t ]+", " ", "".join(parser.text))
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", "\n".join(line.strip() for line in text.splitlines())).strip()
    if not text:
        html = ""          # 글자가 하나도 없으면(빈 태그만) 서식도 저장하지 않음
    return html, text


def text_to_html(value: str) -> str:
    """순수 텍스트(이전 글·자동 작성 초안) → 편집기에 넣을 안전한 HTML"""
    paragraphs = [p for p in re.split(r"\n{2,}", (value or "").strip())]
    return "".join(f"<p>{escape(p).replace(chr(10), '<br>')}</p>" for p in paragraphs if p.strip())

// =====================================================================
// 서식 본문 표시 직전 정리 (이중 방어) — 서버(backend/richtext.py)가 저장 전에 이미 정리하지만,
// 혹시 모를 우회·이전 데이터를 대비해 화면에 넣기 전에 같은 허용 목록으로 한 번 더 거릅니다.
// 외부 라이브러리(DOMPurify 등) 없이 브라우저 DOMParser 로 구현 — 번들 크기 증가 없음.
// =====================================================================

const ALLOWED_TAGS = new Set(["P", "DIV", "BR", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "FONT",
  "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "A"]);
const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "HEAD", "TITLE"]);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i;
const STYLE_RULES = {
  "font-weight": /^(normal|bold|bolder|lighter|[1-9]00)$/,
  "font-style": /^(normal|italic)$/,
  "text-decoration": /^(none|underline|line-through)( (underline|line-through))?$/,
  "text-decoration-line": /^(none|underline|line-through)( (underline|line-through))?$/,
  "font-size": /^(\d{1,2}(\.\d)?(px|pt|em|rem)|x-small|small|medium|large|x-large|xx-large)$/,
  "font-family": /^[\w\s,'"가-힣-]{1,80}$/,
  color: COLOR,
  "background-color": COLOR,
  "text-align": /^(left|right|center|justify)$/,
};
const SAFE_URL = /^(https?:\/\/|mailto:)[^\s"'<>]{1,500}$/i;

function cleanStyle(value) {
  return String(value || "").split(";").map((part) => {
    const i = part.indexOf(":");
    if (i < 0) return null;
    const name = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    const rule = STYLE_RULES[name];
    return rule && rule.test(val) && !/url\(|expression\(/i.test(val) ? `${name}: ${val}` : null;
  }).filter(Boolean).join("; ");
}

function cleanNode(node, doc) {
  [...node.childNodes].forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return;
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }
    const tag = child.tagName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) { child.remove(); return; }
    if (!ALLOWED_TAGS.has(tag)) {              // 허용하지 않는 태그는 벗기고 글자만 남김
      cleanNode(child, doc);
      child.replaceWith(...child.childNodes);
      return;
    }
    [...child.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const keep = (name === "style" && cleanStyle(attr.value))
        || (tag === "A" && name === "href" && SAFE_URL.test(attr.value.trim()))
        || (tag === "FONT" && name === "size" && /^[1-7]$/.test(attr.value.trim()))
        || (tag === "FONT" && name === "color" && COLOR.test(attr.value.trim()))
        || (tag === "FONT" && name === "face" && STYLE_RULES["font-family"].test(attr.value.trim()));
      if (!keep) child.removeAttribute(attr.name);
      else if (name === "style") child.setAttribute("style", cleanStyle(attr.value));
    });
    if (tag === "A") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer nofollow"); }
    cleanNode(child, doc);
  });
}

/** 서식 HTML → 화면에 넣어도 안전한 HTML */
export function sanitizeHtml(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(`<div>${String(html).slice(0, 60000)}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    cleanNode(root, doc);
    return root.innerHTML;
  } catch {
    return "";
  }
}

/** 순수 텍스트 → 편집기 초기값 HTML (이전 글을 서식 편집기로 수정할 때) */
export function textToHtml(text) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(text || "").trim().split(/\n{2,}/).filter((p) => p.trim())
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** 편집기 HTML → 비었는지 (글자 없이 빈 태그만 있으면 true) */
export function isBlankHtml(html) {
  if (!html) return true;
  try {
    return !new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
  } catch {
    return !String(html).replace(/<[^>]*>/g, "").trim();
  }
}

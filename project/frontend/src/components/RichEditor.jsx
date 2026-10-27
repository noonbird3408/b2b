// =====================================================================
// 서식 편집기 (글꼴·크기·굵게·기울임·밑줄·취소선·글자색·형광펜·정렬·목록)
//   - 외부 편집기 라이브러리(Quill·TipTap 등, 100KB+) 대신 브라우저 기본 contentEditable + execCommand 사용
//     → 번들 증가 없이 필요한 서식만 제공. execCommand 는 표준에서 '사용 중단 예정'이지만 모든 주요 브라우저가 지원하며,
//       이후 교체가 필요하면 이 파일만 바꾸면 됩니다(입출력은 HTML 문자열).
//   - 붙여넣기는 서식을 빼고 글자만 넣어 외부 문서의 복잡한 HTML·스크립트가 섞이지 않게 합니다.
//   - 저장된 HTML 은 서버가 허용 목록으로 정리하고, 표시할 때 utils/richtext.js 로 한 번 더 정리합니다.
// =====================================================================
import { useEffect, useRef, useState } from "react";
import { sanitizeHtml } from "../utils/richtext";

const FONTS = [
  ["", "기본 글꼴"],
  ["Pretendard, sans-serif", "프리텐다드"],
  ["'Malgun Gothic', sans-serif", "맑은 고딕"],
  ["'Nanum Myeongjo', 'Batang', serif", "명조(바탕)"],
  ["'Gungsuh', serif", "궁서"],
  ["monospace", "고정폭"],
];
const SIZES = [["2", "작게"], ["3", "보통"], ["4", "조금 크게"], ["5", "크게"], ["6", "아주 크게"]];
const COLORS = ["#111827", "#DC2626", "#EA580C", "#16A34A", "#2563EB", "#7C3AED"];
const MARKS = ["#FEF08A", "#BBF7D0", "#BFDBFE", "#FBCFE8"];

const STYLES = `
.rte{border:1px solid var(--border);border-radius:10px;background:var(--surface);overflow:hidden;}
.rte:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft);}
.rte-bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:6px;border-bottom:1px solid var(--border);background:var(--surface-2);}
.rte-bar select{height:30px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:12px;padding:0 6px;max-width:120px;}
.rte-btn{min-width:30px;height:30px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--text);font-size:13px;cursor:pointer;padding:0 6px;}
.rte-btn:hover{background:var(--surface);border-color:var(--border);}
.rte-btn.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary-text);}
.rte-sep{width:1px;height:20px;background:var(--border);margin:0 2px;}
.rte-swatch{width:18px;height:18px;border-radius:50%;border:1px solid rgba(0,0,0,.15);cursor:pointer;padding:0;}
.rte-area{min-height:180px;max-height:52vh;overflow-y:auto;padding:12px 14px;font-size:14.5px;line-height:1.75;outline:none;word-break:break-word;}
.rte-area:empty:before{content:attr(data-placeholder);color:var(--text-3);}
.rte-area ul,.rte-area ol{padding-left:22px;margin:6px 0;}
.rte-area blockquote{border-left:3px solid var(--border-strong);margin:6px 0;padding:2px 10px;color:var(--text-2);}
.rte-foot{display:flex;justify-content:flex-end;padding:4px 10px;font-size:11px;color:var(--text-3);border-top:1px solid var(--border);}
.rte-pop{display:flex;gap:4px;align-items:center;}
`;

export default function RichEditor({ value, onChange, placeholder = "내용을 입력하세요", maxLength = 10000, ariaLabel = "내용" }) {
  const ref = useRef(null);
  const lastHtml = useRef(value || "");
  const [active, setActive] = useState({});
  const [length, setLength] = useState(0);

  // 바깥에서 값이 바뀐 경우(자동 작성 초안 등)에만 편집 영역을 다시 채움 — 입력 중 커서가 튀지 않도록
  useEffect(() => {
    if (ref.current && value !== lastHtml.current) {
      ref.current.innerHTML = sanitizeHtml(value || "");     // 편집 영역에 넣기 전에도 정리 (AI 초안·이전 글에 스크립트가 섞여도 실행되지 않게)
      lastHtml.current = value || "";
      setLength(ref.current.textContent.length);
    }
  }, [value]);
  useEffect(() => {
    if (ref.current && !ref.current.innerHTML && value) ref.current.innerHTML = sanitizeHtml(value);
    if (ref.current) setLength(ref.current.textContent.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => {
    const html = ref.current?.innerHTML || "";
    lastHtml.current = html;
    setLength(ref.current?.textContent.length || 0);
    onChange(html);
  };

  const refreshActive = () => {
    try {
      setActive({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"), strike: document.queryCommandState("strikeThrough"),
        ul: document.queryCommandState("insertUnorderedList"), ol: document.queryCommandState("insertOrderedList") });
    } catch { /* 일부 브라우저는 지원하지 않음 */ }
  };
  useEffect(() => {
    const onSel = () => { if (ref.current && ref.current.contains(document.getSelection()?.anchorNode)) refreshActive(); };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const run = (command, arg = null) => {
    ref.current?.focus();
    try {
      document.execCommand("styleWithCSS", false, true);   // <font> 대신 style 속성으로 (서버 허용 목록과 일치)
      document.execCommand(command, false, arg);
    } catch { /* 지원하지 않는 명령은 무시 */ }
    emit();
    refreshActive();
  };

  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
    emit();
  };

  const onKeyDown = (e) => {
    if (length >= maxLength && e.key.length === 1 && !e.ctrlKey && !e.metaKey) e.preventDefault();
  };

  const btn = (label, command, title, isOn, arg) => (
    <button type="button" className={`rte-btn${isOn ? " on" : ""}`} title={title} aria-label={title} aria-pressed={Boolean(isOn)}
      onMouseDown={(e) => e.preventDefault()} onClick={() => run(command, arg)}>{label}</button>
  );

  return (
    <div className="rte">
      <style>{STYLES}</style>
      <div className="rte-bar" role="toolbar" aria-label="서식">
        <select aria-label="글꼴" defaultValue="" onChange={(e) => { if (e.target.value) run("fontName", e.target.value); e.target.value = ""; }}>
          {FONTS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
        </select>
        <select aria-label="글자 크기" defaultValue="" onChange={(e) => { if (e.target.value) run("fontSize", e.target.value); e.target.value = ""; }}>
          <option value="">글자 크기</option>
          {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="rte-sep" />
        {btn(<b>가</b>, "bold", "굵게 (Ctrl+B)", active.bold)}
        {btn(<i>가</i>, "italic", "기울임 (Ctrl+I)", active.italic)}
        {btn(<u>가</u>, "underline", "밑줄 (Ctrl+U)", active.underline)}
        {btn(<s>가</s>, "strikeThrough", "취소선", active.strike)}
        <span className="rte-sep" />
        <span className="rte-pop" aria-label="글자색">
          {COLORS.map((c) => (
            <button key={c} type="button" className="rte-swatch" style={{ background: c }} title={`글자색 ${c}`} aria-label={`글자색 ${c}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => run("foreColor", c)} />
          ))}
        </span>
        <span className="rte-sep" />
        <span className="rte-pop" aria-label="형광펜">
          {MARKS.map((c) => (
            <button key={c} type="button" className="rte-swatch" style={{ background: c, borderRadius: 4 }} title="형광펜" aria-label={`형광펜 ${c}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => run("hiliteColor", c)} />
          ))}
        </span>
        <span className="rte-sep" />
        {btn("⬅", "justifyLeft", "왼쪽 정렬")}
        {btn("↔", "justifyCenter", "가운데 정렬")}
        {btn("➡", "justifyRight", "오른쪽 정렬")}
        {btn("•", "insertUnorderedList", "글머리 기호 목록", active.ul)}
        {btn("1.", "insertOrderedList", "번호 목록", active.ol)}
        {btn("⌫", "removeFormat", "서식 지우기")}
      </div>
      <div ref={ref} className="rte-area" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
        aria-label={ariaLabel} data-placeholder={placeholder} onInput={emit} onBlur={emit} onPaste={onPaste} onKeyDown={onKeyDown}
        onKeyUp={refreshActive} onMouseUp={refreshActive} />
      <div className="rte-foot">{length.toLocaleString()} / {maxLength.toLocaleString()}자</div>
    </div>
  );
}

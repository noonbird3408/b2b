// =====================================================================
// 커뮤니티 게시판 (관리자·학부모 공용) — 공지 + 게시글을 한 목록으로
//   말머리 탭 · 검색(제목/내용/제목+내용/작성자) · 고정글 · 페이지 · 글 상세(사진·좋아요·댓글)
//   v10: 목록 / 바둑판(사진 미리보기) 보기 · 서식 본문(글꼴·굵기·색) · 공지 사진 · 첨부파일 · 공지 자동 작성
//   데이터 호출은 페이지가 넘겨주는 api 객체로만 (관리자/학부모 경로가 다름)
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorText } from "../api";
import { resizePhotoWithThumb } from "../utils/image";
import { relativeTime } from "../utils/constants";
import { isBlankHtml, sanitizeHtml, textToHtml } from "../utils/richtext";
import { useDataRefresh } from "../utils/sync";
import Lightbox from "./Lightbox.jsx";
import RichEditor from "./RichEditor.jsx";

export const CATEGORY_LABEL = { ALL: "전체", NOTICE: "공지", FREE: "자유", QUESTION: "질문", PHOTO: "활동·사진", INFO: "정보·후기" };
const CATEGORY_TONE = { NOTICE: "danger", FREE: "gray", QUESTION: "warning", PHOTO: "success", INFO: "primary" };
const SEARCH_FIELDS = [["title_content", "제목+내용"], ["title", "제목"], ["content", "내용"], ["author", "작성자"]];
const NOTICE_KIND = { GENERAL: "일반", EVENT: "행사", URGENT: "긴급" };
const MAX_PHOTOS = 10;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const FILE_EXTENSIONS = ["pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "zip",
  "jpg", "jpeg", "png", "gif", "webp", "mp3", "mp4", "m4a"];
const VIEW_KEY = "board_view_mode";

const STYLES = `
.bd-cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:12px;}
.bd-cats::-webkit-scrollbar{display:none;}
.bd-search{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center;}
.bd-search .select{min-width:0;}
.bd-search .input{flex:1 1 180px;min-width:0;}
.bd-view{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;}
.bd-view button{border:0;background:var(--surface);color:var(--text-2);padding:7px 10px;font-size:12.5px;min-height:34px;}
.bd-view button.on{background:var(--primary);color:#fff;}
.bd-list{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.bd-row{display:grid;grid-template-columns:84px minmax(0,1fr) 110px 70px 56px;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13.5px;}
.bd-row:last-child{border-bottom:0;}
.bd-row:hover{background:var(--surface-2);}
.bd-row.pinned{background:var(--primary-soft);}
.bd-row .ttl{display:flex;align-items:center;gap:6px;min-width:0;}
.bd-row .ttl span.t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.bd-row .ttl .cm{color:var(--primary-text);font-weight:700;font-size:12px;flex-shrink:0;}
.bd-row .meta{color:var(--text-3);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bd-row .num{color:var(--text-3);font-size:12px;text-align:right;}
.bd-row .unread{width:6px;height:6px;border-radius:50%;background:var(--danger);flex-shrink:0;}
.bd-head{display:grid;grid-template-columns:84px minmax(0,1fr) 110px 70px 56px;gap:10px;padding:9px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-3);font-weight:600;}
.bd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;}
.bd-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;text-align:left;padding:0;color:var(--text);transition:border-color .15s,box-shadow .15s;}
.bd-card:hover{border-color:var(--primary);box-shadow:var(--shadow-sm);}
.bd-card.pinned{border-color:var(--primary);}
.bd-thumb{position:relative;aspect-ratio:4/3;background:var(--surface-2);overflow:hidden;}
.bd-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.bd-thumb .count{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:2px 7px;border-radius:99px;}
.bd-thumb .noimg{position:absolute;inset:0;padding:14px;font-size:13px;line-height:1.6;color:var(--text-2);overflow:hidden;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;}
.bd-thumb .cat{position:absolute;left:8px;top:8px;}
.bd-card .body{padding:10px 12px 12px;display:grid;gap:4px;}
.bd-card .t{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bd-card .m{font-size:12px;color:var(--text-3);display:flex;gap:8px;flex-wrap:wrap;}
.bd-pages{display:flex;gap:4px;justify-content:center;margin-top:14px;flex-wrap:wrap;}
.bd-pages button{min-width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);}
.bd-pages button.on{background:var(--primary);color:#fff;border-color:var(--primary);}
.bd-detail{width:min(760px,100%);max-height:92dvh;overflow-y:auto;}
.bd-detail h2{margin:6px 0 4px;font-size:20px;line-height:1.35;}
.bd-detail .meta{font-size:12.5px;color:var(--text-3);display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.bd-detail .body{white-space:pre-wrap;font-size:14.5px;line-height:1.75;margin:16px 0;word-break:break-word;}
.bd-detail .body.rich{white-space:normal;}
.bd-detail .body.rich p{margin:0 0 6px;}
.bd-detail .body.rich ul,.bd-detail .body.rich ol{padding-left:22px;margin:6px 0;}
.bd-detail .body.rich blockquote{border-left:3px solid var(--border-strong);margin:6px 0;padding:2px 10px;color:var(--text-2);}
.bd-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-bottom:14px;}
.bd-photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:zoom-in;background:var(--surface-2);}
.bd-files{display:grid;gap:6px;margin:0 0 14px;}
.bd-file{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);font-size:13px;color:var(--text);text-decoration:none;}
.bd-file:hover{border-color:var(--primary);}
.bd-file .sz{margin-left:auto;color:var(--text-3);font-size:12px;white-space:nowrap;}
.bd-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
.bd-comment{padding:10px 0;border-bottom:1px solid var(--border);font-size:13.5px;}
.bd-comment .who{font-weight:700;font-size:13px;display:flex;gap:6px;align-items:center;}
.bd-comment .txt{white-space:pre-wrap;margin-top:3px;word-break:break-word;}
.bd-comment-form{display:flex;gap:6px;margin-top:12px;}
.bd-comment-form textarea{flex:1;min-height:44px;max-height:140px;resize:vertical;border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-size:13.5px;}
.bd-editor{max-height:94dvh;overflow-y:auto;}
.bd-editor .photos{display:flex;gap:6px;flex-wrap:wrap;}
.bd-editor .ph{position:relative;width:72px;height:72px;}
.bd-editor .ph img{width:100%;height:100%;object-fit:cover;border-radius:8px;}
.bd-editor .ph button{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:0;background:var(--danger);color:#fff;font-size:12px;}
.bd-editor .add{width:72px;height:72px;border:1.5px dashed var(--border-strong);border-radius:8px;display:grid;place-items:center;color:var(--text-3);cursor:pointer;font-size:22px;}
.bd-editor .filerow{display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);}
.bd-editor .filerow button{margin-left:auto;}
.bd-draft{border:1px dashed var(--primary);background:var(--primary-soft);border-radius:12px;padding:12px;margin-bottom:12px;}
.bd-draft .row{display:flex;gap:6px;flex-wrap:wrap;}
.bd-draft .row .input{flex:1 1 220px;min-width:0;}
.bd-draft .hint{font-size:12px;color:var(--text-2);margin-top:6px;line-height:1.6;}
.bd-draft .chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;}
@media(max-width:700px){
  .bd-head{display:none;}
  .bd-row{grid-template-columns:minmax(0,1fr);gap:4px;padding:12px;}
  .bd-row .cat{order:-1;}
  .bd-row .num.hide-sm{display:none;}
  .bd-row .meta,.bd-row .num{text-align:left;}
  .bd-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
  .bd-search .bd-view{order:-1;}
}
`;

function CategoryBadge({ item }) {
  const key = item.kind === "notice" ? "NOTICE" : item.category;
  const label = item.kind === "notice" && item.notice_category === "URGENT" ? "긴급 공지"
    : item.kind === "notice" && item.notice_category === "EVENT" ? "행사 공지" : item.category_label || CATEGORY_LABEL[key];
  return <span className={`badge ${CATEGORY_TONE[key] || "gray"} no-dot`} style={{ justifySelf: "start" }}>{label}</span>;
}

const shortDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}.${d.getDate()}` : d.toLocaleDateString("ko-KR");
};

export const fileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"; } catch { return "list"; } };

/**
 * @param {"admin"|"parent"} mode
 * @param {object} api  { board, post?, createPost, updatePost, deletePost, like, comments, createComment, deleteComment,
 *                        createNotice?, updateNotice?, deleteNotice?, moderatePost?, markNoticeRead?,
 *                        uploadPostAttachment?, uploadNoticeAttachment?, deleteAttachment?, draftNotice? }
 * @param {object} [membership] 학부모: {nickname, muted_until, status}
 * @param {Array}  [classes]    관리자: 반 공지 대상 선택
 */
export default function Board({ mode, api, membership, classes = [], authorName = "" }) {
  const isAdmin = mode === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const category = CATEGORY_LABEL[searchParams.get("category")] ? searchParams.get("category") : "ALL";
  const [field, setField] = useState("title_content");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState(searchParams.get("open"));
  const [editor, setEditor] = useState(null);         // null | {} 새 글 | item 수정
  const [view, setViewState] = useState(readView);    // v10: list(목록) / grid(바둑판)
  const setView = (next) => { setViewState(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* 저장 불가 브라우저 */ } };
  const size = view === "grid" ? 18 : 15;

  const load = useCallback(async () => {
    try {
      const next = await api.board({ category, q: q || undefined, field, page, size });
      setData(next);
      setError("");
    } catch (e) {
      setError(errorText(e, "게시판을 불러오지 못했습니다."));
    }
  }, [api, category, q, field, page, size]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load);

  useEffect(() => { setPage(1); }, [category, q, field, view]);
  useEffect(() => { const o = searchParams.get("open"); if (o) setOpenKey(o); }, [searchParams]);

  const setCategory = (c) => {
    const params = new URLSearchParams(searchParams);
    if (c === "ALL") params.delete("category"); else params.set("category", c);
    params.delete("open");
    setSearchParams(params, { replace: true });
  };
  const closeDetail = () => {
    setOpenKey(null);
    if (searchParams.get("open")) {
      const params = new URLSearchParams(searchParams);
      params.delete("open");
      setSearchParams(params, { replace: true });
    }
  };

  const allItems = useMemo(() => [...(data?.pinned || []), ...(data?.items || [])], [data]);
  const openItem = allItems.find((i) => i.key === openKey);
  const muted = membership?.muted_until ? new Date(membership.muted_until) > new Date() : false;
  const submitSearch = (e) => { e.preventDefault(); setQ(qInput.trim()); };

  const row = (item, pinned) => (
    <div key={`${pinned ? "pin-" : ""}${item.key}`} className={`bd-row${pinned ? " pinned" : ""}`} role="button" tabIndex={0}
      onClick={() => setOpenKey(item.key)} onKeyDown={(e) => e.key === "Enter" && setOpenKey(item.key)}>
      <span className="cat"><CategoryBadge item={item} /></span>
      <div className="ttl">
        {pinned && <span title="고정">📌</span>}
        {item.kind === "notice" && item.is_read === false && <span className="unread" title="안 읽음" />}
        <span className="t">{item.title}</span>
        {item.photos?.length > 0 && <span title={`사진 ${item.photos.length}장`}>📷</span>}
        {item.attachments?.length > 0 && <span title={`첨부 ${item.attachments.length}개`}>📎</span>}
        {item.comment_count > 0 && <span className="cm">[{item.comment_count}]</span>}
        {item.status === "PENDING" && <span className="badge warning no-dot">검토 중</span>}
        {item.status === "HIDDEN" && <span className="badge gray no-dot">숨김</span>}
        {item.class_name && <span className="badge gray no-dot">{item.class_name}</span>}
      </div>
      <span className="meta">{item.author}{item.author_role === "admin" && item.kind === "post" ? " · 운영자" : ""}</span>
      <span className="num">{shortDate(item.created_at)}</span>
      <span className="num hide-sm">
        {item.kind === "notice" ? (isAdmin ? `${item.read_count}/${item.target_count}` : "") : `♥${item.like_count || 0}`}
      </span>
    </div>
  );

  // v10 바둑판 보기 — 첫 사진의 '작은 사진'(480px)만 내려받아 목록이 가볍게
  const card = (item, pinned) => {
    const thumb = item.thumbs?.[0] || item.photos?.[0];
    return (
      <button type="button" key={`${pinned ? "pin-" : ""}${item.key}`} className={`bd-card${pinned ? " pinned" : ""}`}
        onClick={() => setOpenKey(item.key)} aria-label={item.title}>
        <div className="bd-thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" />
            : <div className="noimg">{(item.content || "").slice(0, 160) || "사진 없는 글"}</div>}
          <span className="cat"><CategoryBadge item={item} /></span>
          {item.photos?.length > 1 && <span className="count">📷 {item.photos.length}</span>}
        </div>
        <div className="body">
          <span className="t">{pinned && "📌 "}{item.kind === "notice" && item.is_read === false && "● "}{item.title}</span>
          <span className="m">
            <span>{item.author}</span><span>{shortDate(item.created_at)}</span>
            {item.kind === "post" && <span>♥{item.like_count || 0}</span>}
            {item.comment_count > 0 && <span>💬{item.comment_count}</span>}
            {item.attachments?.length > 0 && <span>📎{item.attachments.length}</span>}
            {item.status === "PENDING" && <span style={{ color: "var(--warning-text)" }}>검토 중</span>}
          </span>
        </div>
      </button>
    );
  };

  const canWrite = isAdmin || (!muted && membership?.status !== "BANNED");

  return (
    <div>
      <style>{STYLES}</style>
      {error && <div className="fl-banner danger">{error}</div>}
      {muted && <div className="fl-banner warning">관리자에 의해 {new Date(membership.muted_until).toLocaleString("ko-KR")}까지 글·댓글 작성이 제한되었습니다.</div>}

      <div className="bd-cats" role="tablist">
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={category === k} className={`chip${category === k ? " active" : ""}`} onClick={() => setCategory(k)}>{v}</button>
        ))}
      </div>

      <form className="bd-search" onSubmit={submitSearch} role="search">
        <select className="select" value={field} onChange={(e) => setField(e.target.value)} aria-label="검색 범위">
          {SEARCH_FIELDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="검색어" maxLength={100} />
        <button className="btn ghost" type="submit">검색</button>
        {q && <button className="btn ghost" type="button" onClick={() => { setQ(""); setQInput(""); }}>초기화</button>}
        <div className="bd-view" role="group" aria-label="보기 형식" style={{ marginLeft: "auto" }}>
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>☰ 목록</button>
          <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦ 바둑판</button>
        </div>
        {canWrite && (
          <button className="btn" type="button"
            onClick={() => setEditor({ category: category === "ALL" ? (isAdmin ? "NOTICE" : "FREE") : category })}>✏️ 글쓰기</button>
        )}
      </form>

      {data === null ? <div className="fl-skeleton" style={{ height: 280 }} /> : (
        <>
          {view === "list" ? (
            <div className="bd-list">
              <div className="bd-head"><span>말머리</span><span>제목</span><span>작성자</span><span style={{ textAlign: "right" }}>작성일</span><span style={{ textAlign: "right" }}>{isAdmin ? "읽음/♥" : "♥"}</span></div>
              {data.pinned.map((i) => row(i, true))}
              {data.items.map((i) => row(i, false))}
              {!data.items.length && !data.pinned.length && (
                <div className="empty" style={{ border: 0, borderRadius: 0 }}>{q ? `“${q}” 검색 결과가 없습니다.` : "아직 글이 없습니다."}</div>
              )}
            </div>
          ) : (
            <div className="bd-grid">
              {data.pinned.map((i) => card(i, true))}
              {data.items.map((i) => card(i, false))}
              {!data.items.length && !data.pinned.length && (
                <div className="empty" style={{ gridColumn: "1/-1" }}>{q ? `“${q}” 검색 결과가 없습니다.` : "아직 글이 없습니다."}</div>
              )}
            </div>
          )}
          {data.pages > 1 && (
            <div className="bd-pages">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} aria-label="이전">‹</button>
              {Array.from({ length: data.pages }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === data.pages)
                .map((p, i, arr) => (
                  <span key={p} style={{ display: "contents" }}>
                    {i > 0 && p - arr[i - 1] > 1 && <span style={{ alignSelf: "center", color: "var(--text-3)" }}>…</span>}
                    <button type="button" className={p === page ? "on" : ""} onClick={() => setPage(p)}>{p}</button>
                  </span>
                ))}
              <button type="button" disabled={page === data.pages} onClick={() => setPage((p) => p + 1)} aria-label="다음">›</button>
            </div>
          )}
        </>
      )}

      {openKey && (openItem || openKey) && (
        <PostDetail key={openKey} itemKey={openKey} item={openItem} mode={mode} api={api} canWrite={canWrite}
          onClose={closeDetail} onChanged={load} onEdit={(it) => { closeDetail(); setEditor(it); }} />
      )}
      {editor && (
        <Editor mode={mode} api={api} initial={editor} classes={classes} authorName={authorName}
          onClose={() => setEditor(null)} onSaved={(key) => { setEditor(null); load(); if (key) setOpenKey(key); }} />
      )}
    </div>
  );
}

/** 글 본문 — 서식 HTML 이 있으면 정리 후 표시, 없으면 순수 텍스트 */
export function PostBody({ item }) {
  const html = useMemo(() => sanitizeHtml(item.content_html), [item.content_html]);
  if (html) return <div className="body rich" dangerouslySetInnerHTML={{ __html: html }} />;
  return <div className="body">{item.content}</div>;
}

/** 첨부파일 목록 (내려받기 링크) */
export function AttachmentList({ files }) {
  if (!files?.length) return null;
  return (
    <div className="bd-files" aria-label="첨부파일">
      {files.map((f) => (
        <a key={f.attachment_id} className="bd-file" href={f.url} download={f.file_name} rel="noopener">
          <span>📎</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</span>
          <span className="sz">{fileSize(f.size_bytes)} · 내려받기</span>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 글 상세 — 공지는 목록 데이터로, 게시글은 서버에서 다시 읽음(조회수·최신 댓글)
// ---------------------------------------------------------------------
function PostDetail({ itemKey, item: listItem, mode, api, canWrite, onClose, onChanged, onEdit }) {
  const isAdmin = mode === "admin";
  const isNotice = itemKey.startsWith("n");
  const id = Number(itemKey.slice(1));
  const [item, setItem] = useState(listItem || null);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState("");

  const loadComments = useCallback(() => {
    if (isNotice) return;
    api.comments(id).then(setComments).catch(() => setComments([]));
  }, [api, id, isNotice]);

  useEffect(() => {
    if (isNotice) {
      if (listItem && api.markNoticeRead && listItem.is_read === false) api.markNoticeRead([id]).then(onChanged).catch(() => null);
      return;
    }
    if (api.post) api.post(id).then(setItem).catch((e) => setError(errorText(e, "글을 불러오지 못했습니다.")));
    loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNotice]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !lightbox && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, lightbox]);

  const run = async (task, fallback) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await task(); } catch (e) { setError(errorText(e, fallback)); } finally { setBusy(false); }
  };

  const like = () => run(async () => {
    const res = await api.like(id);
    setItem((p) => ({ ...p, like_count: res.like_count, liked: res.liked }));
    onChanged();
  }, "좋아요를 처리하지 못했습니다.");

  const addComment = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run(async () => {
      const c = await api.createComment(id, draft.trim());
      setDraft("");
      setComments((prev) => [...prev, c]);
      onChanged();
    }, "댓글을 등록하지 못했습니다.");
  };
  const removeComment = (c) => {
    if (!window.confirm("댓글을 삭제할까요?")) return;
    run(async () => { await api.deleteComment(c.comment_id); setComments((prev) => prev.filter((x) => x.comment_id !== c.comment_id)); onChanged(); }, "댓글을 삭제하지 못했습니다.");
  };
  const remove = () => {
    if (!window.confirm("이 글을 삭제할까요?")) return;
    run(async () => {
      if (isNotice) await api.deleteNotice(id); else await api.deletePost(id);
      onChanged();
      onClose();
    }, "삭제하지 못했습니다.");
  };
  // 고정 토글은 서식(content_html)·사진을 보내지 않음 → 서버가 기존 값을 유지
  const togglePin = () => run(async () => {
    if (isNotice) await api.updateNotice(id, { title: item.title, content: item.content, category: item.notice_category, is_pinned: !item.is_pinned, class_id: item.class_id });
    else await api.updatePost(id, { content: item.content, photos: item.photos, is_pinned: !item.is_pinned });
    setItem((p) => ({ ...p, is_pinned: !p.is_pinned }));
    onChanged();
  }, "고정 상태를 바꾸지 못했습니다.");
  const moderate = (decision) => run(async () => {
    const updated = await api.moderatePost(id, decision);
    setItem(updated);
    onChanged();
  }, "처리하지 못했습니다.");

  if (!item) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal bd-detail" onClick={(e) => e.stopPropagation()}>
          {error ? <div className="fl-banner danger">{error}</div> : <div className="fl-skeleton" style={{ height: 200 }} />}
          <div className="modal-actions"><button className="btn ghost" onClick={onClose}>닫기</button></div>
        </div>
      </div>
    );
  }

  const mine = item.mine;
  const canEdit = isNotice ? isAdmin : (mine || (isAdmin && item.author_role !== "parent"));
  const canDelete = isNotice ? isAdmin : (mine || isAdmin);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal bd-detail" onClick={(e) => e.stopPropagation()} aria-label={item.title}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <CategoryBadge item={item} />
          {item.is_pinned && <span className="badge primary no-dot">📌 고정</span>}
          {item.class_name && <span className="badge gray no-dot">{item.class_name} 공지</span>}
          {item.status === "PENDING" && <span className="badge warning no-dot">검토 중 · 작성자에게만 보임</span>}
          {item.status === "HIDDEN" && <span className="badge gray no-dot">숨김</span>}
          <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <h2>{item.title}</h2>
        <div className="meta">
          <b style={{ color: "var(--text-2)" }}>{item.author}</b>
          <span>{item.created_at ? new Date(item.created_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
          {!isNotice && <span>조회 {item.view_count || 0}</span>}
          {isNotice && isAdmin && <span>읽음 {item.read_count}/{item.target_count}가정</span>}
          {item.for_children?.length > 0 && <span>· {item.for_children.join(", ")} 반</span>}
        </div>
        {error && <div className="fl-banner danger" style={{ marginTop: 10 }}>{error}</div>}
        <PostBody item={item} />
        {item.photos?.length > 0 && (
          <div className="bd-photos">
            {item.photos.map((src, i) => <img key={src} src={item.thumbs?.[i] || src} alt={`사진 ${i + 1}`} loading="lazy" onClick={() => setLightbox(i)} />)}
          </div>
        )}
        <AttachmentList files={item.attachments} />

        <div className="bd-actions">
          {!isNotice && (
            <button className={`btn sm ${item.liked ? "" : "ghost"}`} onClick={like} disabled={busy}>♥ {item.like_count || 0}</button>
          )}
          {!isNotice && <span className="muted">댓글 {comments.length}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {isAdmin && <button className="btn ghost sm" onClick={togglePin} disabled={busy}>{item.is_pinned ? "고정 해제" : "📌 고정"}</button>}
            {isAdmin && !isNotice && item.author_role === "parent" && item.status !== "HIDDEN" && (
              <button className="btn ghost sm" onClick={() => moderate("HIDDEN")} disabled={busy}>숨김</button>
            )}
            {isAdmin && !isNotice && item.status !== "VISIBLE" && (
              <button className="btn ghost sm" onClick={() => moderate("APPROVED")} disabled={busy}>공개</button>
            )}
            {canEdit && <button className="btn ghost sm" onClick={() => onEdit(item)}>수정</button>}
            {canDelete && <button className="btn danger sm" onClick={remove} disabled={busy}>삭제</button>}
          </span>
        </div>

        {!isNotice && (
          <section aria-label="댓글">
            {comments.map((c) => (
              <div key={c.comment_id} className="bd-comment">
                <div className="who">
                  {c.author}
                  {c.author_role === "admin" && <span className="badge primary no-dot" style={{ fontSize: 10 }}>운영자</span>}
                  {c.pending_review && <span className="badge warning no-dot" style={{ fontSize: 10 }}>검토 중</span>}
                  {isAdmin && c.review?.decision === "HIDDEN" && <span className="badge gray no-dot" style={{ fontSize: 10 }}>숨김</span>}
                  <span className="muted" style={{ fontWeight: 400 }}>{relativeTime(c.created_at)}</span>
                  {(c.mine || isAdmin) && (
                    <button className="btn ghost sm" style={{ marginLeft: "auto", minHeight: 0, padding: "0 6px" }} onClick={() => removeComment(c)}>삭제</button>
                  )}
                </div>
                <div className="txt">{c.content}</div>
              </div>
            ))}
            {!comments.length && <div className="muted" style={{ padding: "12px 0" }}>첫 댓글을 남겨 보세요.</div>}
            {canWrite && item.status !== "HIDDEN" && (
              <form className="bd-comment-form" onSubmit={addComment}>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="댓글 입력"
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addComment(e); }} />
                <button className="btn" type="submit" disabled={busy || !draft.trim()}>등록</button>
              </form>
            )}
          </section>
        )}
        {lightbox !== null && <Lightbox photos={item.photos} startIndex={lightbox} onClose={() => setLightbox(null)} />}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------
// 공지 자동 작성 — 키워드·날짜·시간 → 서버가 공지 양식을 완성 (관리자 전용)
// ---------------------------------------------------------------------
const PARSED_LABEL = { date: "날짜", end_date: "종료", time: "시간", deadline: "신청 마감", participation: "참여", fee: "참가비", prep: "준비물", place: "장소", topic: "주제" };
const PARTICIPATION_LABEL = { optional: "선택 참여", required: "필수 참여" };

function NoticeDraftBox({ api, classId, onApply }) {
  const [keywords, setKeywords] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const generate = async () => {
    if (!keywords.trim()) return setErr("키워드를 입력하세요. 예) 에버랜드, 10/25, 선택 참여");
    setBusy(true); setErr("");
    try {
      const draft = await api.draftNotice({ keywords: keywords.trim(), class_id: classId ? Number(classId) : null, use_ai: useAi });
      setResult(draft);
      onApply(draft);
    } catch (e) {
      setErr(errorText(e, "공지를 자동으로 만들지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bd-draft">
      <b style={{ fontSize: 13.5 }}>✨ 공지 자동 작성</b>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={500}
          placeholder="키워드·날짜·시간 (예: 에버랜드, 10/25, 선택 참여)" aria-label="자동 작성 키워드"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); generate(); } }} />
        <button type="button" className="btn sm" onClick={generate} disabled={busy}>{busy ? "작성 중…" : "자동 작성"}</button>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 6 }}>
        <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> AI로 문장 다듬기 (서버에 AI 키가 있을 때 · 학생 개인정보는 보내지 않음)
      </label>
      {err && <div className="fl-banner danger" style={{ marginTop: 8 }}>{err}</div>}
      {result && (
        <>
          <div className="chips">
            <span className={`badge ${result.source === "ai" ? "primary" : "gray"} no-dot`}>{result.source === "ai" ? "AI 다듬음" : "기본 양식"}</span>
            {Object.entries(result.parsed || {}).filter(([k, v]) => PARSED_LABEL[k] && v).map(([k, v]) => (
              <span key={k} className="badge success no-dot">{PARSED_LABEL[k]}: {k === "participation" ? PARTICIPATION_LABEL[v] : v}</span>
            ))}
          </div>
          {result.warnings?.map((w) => <div key={w} className="hint" style={{ color: "var(--warning-text)" }}>⚠ {w}</div>)}
        </>
      )}
      <div className="hint">쉼표로 구분해 장소·날짜(10/25, 11월 3일, 다음주 토요일)·시간(오후 2시, 10시~15시)·참여 방식(선택/필수)·참가비·준비물(준비물: …)·마감(마감 10/20)을 적으면 제목과 본문이 채워집니다. 등록 전에 내용을 꼭 확인하세요.</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 글쓰기·수정 — 관리자는 '공지' 말머리로 전체/반 공지를 작성
// ---------------------------------------------------------------------
const photoSrc = (p) => (typeof p === "string" ? p : p.thumb || p.src);

function Editor({ mode, api, initial, classes, authorName, onClose, onSaved }) {
  const isAdmin = mode === "admin";
  const isEdit = Boolean(initial.key);
  const editingNotice = initial.kind === "notice";
  const [form, setForm] = useState(() => ({
    category: editingNotice ? "NOTICE" : initial.category || "FREE",
    title: initial.title || "",
    html: initial.content_html || textToHtml(initial.content || ""),
    photos: initial.photos || [],
    is_pinned: Boolean(initial.is_pinned), notice_category: initial.notice_category || "GENERAL",
    class_id: initial.class_id || "", notify: true,
  }));
  const [files, setFiles] = useState(initial.attachments || []);     // 이미 올린 첨부
  const [newFiles, setNewFiles] = useState([]);                      // 저장 후 올릴 파일
  const [removedFiles, setRemovedFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isNotice = form.category === "NOTICE";
  const categories = Object.keys(CATEGORY_LABEL).filter((k) => k !== "ALL" && (isAdmin || k !== "NOTICE"));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const canAttach = isNotice ? Boolean(api.uploadNoticeAttachment) : Boolean(api.uploadPostAttachment);

  const addPhotos = async (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    if (form.photos.length + picked.length > MAX_PHOTOS) return setErr(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있습니다.`);
    try {
      const resized = await Promise.all(picked.map((f) => resizePhotoWithThumb(f)));
      setForm((f) => ({ ...f, photos: [...f.photos, ...resized] }));
    } catch (error) {
      setErr(error.message);
    }
  };

  const addFiles = (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    setErr("");
    if (files.length + newFiles.length + picked.length > MAX_FILES) return setErr(`첨부파일은 글마다 ${MAX_FILES}개까지 올릴 수 있습니다.`);
    for (const f of picked) {
      const ext = f.name.includes(".") ? f.name.split(".").pop().toLowerCase() : "";
      if (!FILE_EXTENSIONS.includes(ext)) return setErr(`${f.name}: 올릴 수 없는 형식입니다. (문서·한글·엑셀·PDF·이미지·압축 파일)`);
      if (f.size > MAX_FILE_BYTES) return setErr(`${f.name}: 파일은 4MB 이하만 올릴 수 있습니다.`);
    }
    setNewFiles((prev) => [...prev, ...picked]);
  };

  const applyDraft = (draft) => {
    const hasText = form.title.trim() || !isBlankHtml(form.html);
    if (hasText && !window.confirm("지금 쓴 제목·내용을 자동 작성 결과로 바꿀까요?")) return;
    setForm((f) => ({ ...f, title: draft.title, html: draft.content_html, notice_category: draft.category || f.notice_category,
      is_pinned: f.is_pinned || Boolean(draft.is_pinned) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setErr("제목을 입력하세요.");
    if (isBlankHtml(form.html) && !form.photos.length) return setErr("내용을 입력하세요.");
    setBusy(true);
    setErr("");
    const photos = form.photos.map((p) => (typeof p === "string" ? p : { src: p.src, thumb: p.thumb }));
    try {
      let key = null;
      let ownerId = null;
      if (isNotice) {
        const payload = { title: form.title.trim(), content: "", content_html: form.html, category: form.notice_category,
          is_pinned: form.is_pinned, class_id: form.class_id ? Number(form.class_id) : null, notify_parents: form.notify, photos,
          ...(authorName ? { author: authorName } : {}) };
        const saved = isEdit ? await api.updateNotice(initial.notice_id, payload) : await api.createNotice(payload);
        key = `n${saved.notice_id}`;
        ownerId = saved.notice_id;
      } else {
        const payload = { title: form.title.trim(), content: "", content_html: form.html, category: form.category, photos,
          ...(isAdmin ? { is_pinned: form.is_pinned } : {}) };
        const saved = isEdit ? await api.updatePost(initial.post_id, payload) : await api.createPost(payload);
        key = `p${saved.post_id}`;
        ownerId = saved.post_id;
        if (saved.status === "PENDING") alert("자동 모니터링에서 확인이 필요한 표현이 있어 관리자 검토 후 공개됩니다.");
      }
      // 첨부파일: 글을 저장한 뒤 한 개씩 올림 (요청 크기 한도 안에서)
      const failed = [];
      for (const id of removedFiles) await api.deleteAttachment(id).catch(() => failed.push("삭제"));
      for (const f of newFiles) {
        try {
          if (isNotice) await api.uploadNoticeAttachment(ownerId, f); else await api.uploadPostAttachment(ownerId, f);
        } catch (error) {
          failed.push(`${f.name}: ${errorText(error)}`);
        }
      }
      if (failed.length) alert(`글은 저장했지만 일부 첨부파일을 처리하지 못했습니다.\n${failed.join("\n")}`);
      onSaved(key);
    } catch (error) {
      setErr(errorText(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal bd-editor" style={{ width: "min(760px,100%)" }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{isEdit ? "글 수정" : "글쓰기"}</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 10 }}>
          <div className="form-row"><label>말머리</label>
            <select className="select" value={form.category} onChange={set("category")} disabled={isEdit && (editingNotice || isNotice)}>
              {categories.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
            </select></div>
          <div className="form-row"><label>제목</label>
            <input className="input" value={form.title} onChange={set("title")} maxLength={200} autoFocus /></div>
        </div>
        {isNotice && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="form-row"><label>공지 종류</label>
              <select className="select" value={form.notice_category} onChange={set("notice_category")}>
                {Object.entries(NOTICE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="form-row"><label>대상</label>
              <select className="select" value={form.class_id} onChange={set("class_id")}>
                <option value="">전체 학부모</option>
                {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name} 학부모</option>)}
              </select></div>
          </div>
        )}
        {isNotice && isAdmin && api.draftNotice && !isEdit && <NoticeDraftBox api={api} classId={form.class_id} onApply={applyDraft} />}
        <div className="form-row"><label>내용</label>
          <RichEditor value={form.html} onChange={(html) => setForm((f) => ({ ...f, html }))} maxLength={isNotice ? 20000 : 10000} /></div>
        <div className="form-row">
          <label>사진 ({form.photos.length}/{MAX_PHOTOS})</label>
          <div className="photos">
            {form.photos.map((p, i) => (
              <div className="ph" key={`${i}-${photoSrc(p).slice(-24)}`}>
                <img src={photoSrc(p)} alt="" />
                <button type="button" onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))} aria-label="사진 빼기">×</button>
              </div>
            ))}
            {form.photos.length < MAX_PHOTOS && (
              <label className="add">＋<input type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: "none" }} /></label>
            )}
          </div>
        </div>
        {canAttach && (
          <div className="form-row">
            <label>첨부파일 ({files.length + newFiles.length}/{MAX_FILES}) · 파일당 4MB</label>
            <div style={{ display: "grid", gap: 6 }}>
              {files.map((f) => (
                <div className="filerow" key={f.attachment_id}>📎 {f.file_name} <span className="muted">{fileSize(f.size_bytes)}</span>
                  <button type="button" className="btn ghost sm" onClick={() => { setFiles((p) => p.filter((x) => x.attachment_id !== f.attachment_id)); setRemovedFiles((p) => [...p, f.attachment_id]); }}>빼기</button>
                </div>
              ))}
              {newFiles.map((f, i) => (
                <div className="filerow" key={`${f.name}-${i}`}>🆕 {f.name} <span className="muted">{fileSize(f.size)}</span>
                  <button type="button" className="btn ghost sm" onClick={() => setNewFiles((p) => p.filter((_, j) => j !== i))}>빼기</button>
                </div>
              ))}
              {files.length + newFiles.length < MAX_FILES && (
                <label className="btn ghost sm" style={{ justifySelf: "start" }}>＋ 파일 추가
                  <input type="file" multiple onChange={addFiles} style={{ display: "none" }} accept={FILE_EXTENSIONS.map((x) => `.${x}`).join(",")} />
                </label>
              )}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
          {isAdmin && <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={form.is_pinned} onChange={set("is_pinned")} /> 상단 고정</label>}
          {isNotice && !isEdit && <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={form.notify} onChange={set("notify")} /> 학부모 알림 보내기</label>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? "저장 중…" : isEdit ? "수정" : "등록"}</button>
        </div>
      </form>
    </div>
  );
}

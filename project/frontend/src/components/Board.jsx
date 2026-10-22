// =====================================================================
// 커뮤니티 게시판 (관리자·학부모 공용) — 공지 + 게시글을 한 목록으로
//   말머리 탭 · 검색(제목/내용/제목+내용/작성자) · 고정글 · 페이지 · 글 상세(사진·좋아요·댓글)
//   데이터 호출은 페이지가 넘겨주는 api 객체로만 (관리자/학부모 경로가 다름)
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorText } from "../api";
import { resizeImageFile } from "../utils/image";
import { relativeTime } from "../utils/constants";
import { useDataRefresh } from "../utils/sync";
import Lightbox from "./Lightbox.jsx";

export const CATEGORY_LABEL = { ALL: "전체", NOTICE: "공지", FREE: "자유", QUESTION: "질문", PHOTO: "활동·사진", INFO: "정보·후기" };
const CATEGORY_TONE = { NOTICE: "danger", FREE: "gray", QUESTION: "warning", PHOTO: "success", INFO: "primary" };
const SEARCH_FIELDS = [["title_content", "제목+내용"], ["title", "제목"], ["content", "내용"], ["author", "작성자"]];
const NOTICE_KIND = { GENERAL: "일반", EVENT: "행사", URGENT: "긴급" };
const MAX_PHOTOS = 10;

const STYLES = `
.bd-cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:12px;}
.bd-cats::-webkit-scrollbar{display:none;}
.bd-search{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
.bd-search .select{min-width:0;}
.bd-search .input{flex:1 1 180px;min-width:0;}
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
.bd-pages{display:flex;gap:4px;justify-content:center;margin-top:14px;flex-wrap:wrap;}
.bd-pages button{min-width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);}
.bd-pages button.on{background:var(--primary);color:#fff;border-color:var(--primary);}
.bd-detail{width:min(760px,100%);max-height:92dvh;overflow-y:auto;}
.bd-detail h2{margin:6px 0 4px;font-size:20px;line-height:1.35;}
.bd-detail .meta{font-size:12.5px;color:var(--text-3);display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.bd-detail .body{white-space:pre-wrap;font-size:14.5px;line-height:1.75;margin:16px 0;word-break:break-word;}
.bd-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-bottom:14px;}
.bd-photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:zoom-in;background:var(--surface-2);}
.bd-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
.bd-comment{padding:10px 0;border-bottom:1px solid var(--border);font-size:13.5px;}
.bd-comment .who{font-weight:700;font-size:13px;display:flex;gap:6px;align-items:center;}
.bd-comment .txt{white-space:pre-wrap;margin-top:3px;word-break:break-word;}
.bd-comment-form{display:flex;gap:6px;margin-top:12px;}
.bd-comment-form textarea{flex:1;min-height:44px;max-height:140px;resize:vertical;border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-size:13.5px;}
.bd-editor .photos{display:flex;gap:6px;flex-wrap:wrap;}
.bd-editor .ph{position:relative;width:72px;height:72px;}
.bd-editor .ph img{width:100%;height:100%;object-fit:cover;border-radius:8px;}
.bd-editor .ph button{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:0;background:var(--danger);color:#fff;font-size:12px;}
.bd-editor .add{width:72px;height:72px;border:1.5px dashed var(--border-strong);border-radius:8px;display:grid;place-items:center;color:var(--text-3);cursor:pointer;font-size:22px;}
@media(max-width:700px){
  .bd-head{display:none;}
  .bd-row{grid-template-columns:minmax(0,1fr);gap:4px;padding:12px;}
  .bd-row .cat{order:-1;}
  .bd-row .num.hide-sm{display:none;}
  .bd-row .meta,.bd-row .num{text-align:left;}
  .bd-row .sub-sm{display:flex;gap:8px;}
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

/**
 * @param {"admin"|"parent"} mode
 * @param {object} api  { board, post?, createPost, updatePost, deletePost, like, comments, createComment, deleteComment,
 *                        createNotice?, updateNotice?, deleteNotice?, moderatePost?, markNoticeRead? }
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

  const load = useCallback(async () => {
    try {
      const next = await api.board({ category, q: q || undefined, field, page, size: 15 });
      setData(next);
      setError("");
    } catch (e) {
      setError(errorText(e, "게시판을 불러오지 못했습니다."));
    }
  }, [api, category, q, field, page]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load);

  useEffect(() => { setPage(1); }, [category, q, field]);
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
        {item.photos?.length > 0 && <span title="사진">📷</span>}
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
        {canWrite && (
          <button className="btn" type="button" style={{ marginLeft: "auto" }}
            onClick={() => setEditor({ category: category === "ALL" ? (isAdmin ? "NOTICE" : "FREE") : category })}>✏️ 글쓰기</button>
        )}
      </form>

      {data === null ? <div className="fl-skeleton" style={{ height: 280 }} /> : (
        <>
          <div className="bd-list">
            <div className="bd-head"><span>말머리</span><span>제목</span><span>작성자</span><span style={{ textAlign: "right" }}>작성일</span><span style={{ textAlign: "right" }}>{isAdmin ? "읽음/♥" : "♥"}</span></div>
            {data.pinned.map((i) => row(i, true))}
            {data.items.map((i) => row(i, false))}
            {!data.items.length && !data.pinned.length && (
              <div className="empty" style={{ border: 0, borderRadius: 0 }}>{q ? `“${q}” 검색 결과가 없습니다.` : "아직 글이 없습니다."}</div>
            )}
          </div>
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
        <div className="body">{item.content}</div>
        {item.photos?.length > 0 && (
          <div className="bd-photos">
            {item.photos.map((src, i) => <img key={src} src={src} alt={`사진 ${i + 1}`} loading="lazy" onClick={() => setLightbox(i)} />)}
          </div>
        )}

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
// 글쓰기·수정 — 관리자는 '공지' 말머리로 전체/반 공지를 작성
// ---------------------------------------------------------------------
function Editor({ mode, api, initial, classes, authorName, onClose, onSaved }) {
  const isAdmin = mode === "admin";
  const isEdit = Boolean(initial.key);
  const editingNotice = initial.kind === "notice";
  const [form, setForm] = useState(() => ({
    category: editingNotice ? "NOTICE" : initial.category || "FREE",
    title: initial.title || "", content: initial.content || "", photos: initial.photos || [],
    is_pinned: Boolean(initial.is_pinned), notice_category: initial.notice_category || "GENERAL",
    class_id: initial.class_id || "", notify: true,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isNotice = form.category === "NOTICE";
  const categories = Object.keys(CATEGORY_LABEL).filter((k) => k !== "ALL" && (isAdmin || k !== "NOTICE"));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (form.photos.length + files.length > MAX_PHOTOS) return setErr(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있습니다.`);
    try {
      const resized = await Promise.all(files.map((f) => resizeImageFile(f, "post")));
      setForm((f) => ({ ...f, photos: [...f.photos, ...resized] }));
    } catch (error) {
      setErr(error.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setErr("제목을 입력하세요.");
    if (!form.content.trim() && !form.photos.length) return setErr("내용을 입력하세요.");
    setBusy(true);
    setErr("");
    try {
      let key = null;
      if (isNotice) {
        const payload = { title: form.title.trim(), content: form.content, category: form.notice_category, is_pinned: form.is_pinned,
          class_id: form.class_id ? Number(form.class_id) : null, notify_parents: form.notify,
          ...(authorName ? { author: authorName } : {}) };
        const saved = isEdit ? await api.updateNotice(initial.notice_id, payload) : await api.createNotice(payload);
        key = `n${saved.notice_id}`;
      } else {
        const payload = { title: form.title.trim(), content: form.content, category: form.category, photos: form.photos,
          ...(isAdmin ? { is_pinned: form.is_pinned } : {}) };
        const saved = isEdit ? await api.updatePost(initial.post_id, payload) : await api.createPost(payload);
        key = `p${saved.post_id}`;
        if (saved.status === "PENDING") alert("자동 모니터링에서 확인이 필요한 표현이 있어 관리자 검토 후 공개됩니다.");
      }
      onSaved(key);
    } catch (error) {
      setErr(errorText(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal bd-editor" style={{ width: "min(680px,100%)" }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
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
        <div className="form-row"><label>내용</label>
          <textarea value={form.content} onChange={set("content")} maxLength={isNotice ? 20000 : 10000} style={{ minHeight: 180 }} /></div>
        {!isNotice && (
          <div className="form-row">
            <label>사진 ({form.photos.length}/{MAX_PHOTOS})</label>
            <div className="photos">
              {form.photos.map((src, i) => (
                <div className="ph" key={`${i}-${src.slice(-20)}`}>
                  <img src={src} alt="" />
                  <button type="button" onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))} aria-label="사진 빼기">×</button>
                </div>
              ))}
              {form.photos.length < MAX_PHOTOS && (
                <label className="add">＋<input type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: "none" }} /></label>
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

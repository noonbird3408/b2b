import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createParentComment, fetchMe, fetchParentAttendances, fetchParentChildren, fetchParentComments,
  fetchParentNotices, fetchParentPosts, likeParentPost, linkParentChild, signOut, unlinkParentChild,
  fetchParentSummary, fetchParentNotifications, markParentNotificationsRead, markParentNoticesRead,
  fetchParentAssignments, assignmentFileUrl, errorText,
} from "../api";
import Lightbox, { PhotoGrid } from "../components/Lightbox";
import { NOTIFICATION_META, relativeTime, showBrowserNotification, startVisiblePolling } from "../utils/constants";
import Checkout from "./Checkout";

/* =====================================================================
   학부모 포털 — Google 로그인 후 '학부모'를 선택한 사용자 전용
   탭: 내 자녀(연결·출결) / 결제 / 공지사항 / 커뮤니티
   - 모든 데이터는 /api/parent/* 에서 "이 계정에 연결된 자녀" 기준으로만 내려옵니다.
   - 카카오페이 결과는 /checkout?kakao=... 로 돌아오며 결제 탭에 결과가 표시됩니다.
===================================================================== */

const PARENT_CSS = `
.public-wrap{min-height:100vh;background:linear-gradient(160deg, rgba(59,130,246,0.12) 0%, var(--bg) 40%);display:flex;flex-direction:column;}
.public-header{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 28px;display:flex;align-items:center;gap:12px;}
.public-header .logo{width:34px;height:34px;background:var(--primary);border-radius:8px;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;}
.public-body{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px 48px;}
.public-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;width:min(560px,94vw);box-shadow:0 10px 15px -3px rgba(0,0,0,.08);}
.public-card h2{font-size:20px;font-weight:700;margin:0 0 4px;}
.public-card .sub{font-size:13px;color:var(--text-2);margin:0 0 18px;}
.linkbtn{background:none;border:none;color:var(--text-2);font-size:13px;cursor:pointer;padding:6px 8px;border-radius:6px;}
.linkbtn:hover{background:var(--surface-hover);color:var(--text);}
.inv-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);}
.inv-row:last-child{border-bottom:none;}
.inv-row .body{flex:1;min-width:0;}
.inv-row .title{font-size:14px;font-weight:600;}
.inv-row .meta{font-size:12px;color:var(--text-3);margin-top:2px;}
.inv-row .amt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;}
.kakao-btn{background:#FEE500;color:#3C1E1E;font-weight:700;border:none;border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer;white-space:nowrap;}
.kakao-btn:disabled{opacity:.5;cursor:not-allowed;}
.parent-tabs{display:flex;gap:4px;background:var(--surface);border-bottom:1px solid var(--border);padding:0 16px;position:sticky;top:0;z-index:5;}
.parent-tab{background:none;border:none;padding:14px 16px;font-size:14px;font-weight:600;color:var(--text-3);cursor:pointer;border-bottom:2.5px solid transparent;}
.parent-tab.active{color:var(--primary);border-bottom-color:var(--primary);}
.feed{max-width:600px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:14px;}
.back-btn{margin-left:auto;display:flex;align-items:center;gap:6px;background:none;border:1px solid var(--border);color:var(--text-2);font-size:13px;font-weight:600;cursor:pointer;padding:7px 14px;border-radius:8px;transition:all 0.15s;}
.back-btn:hover{background:var(--surface-hover);color:var(--text);border-color:var(--text-3);}
.feed-post{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
.feed-post-head{display:flex;align-items:center;gap:10px;padding:14px 16px 0;}
.feed-ava{width:40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;}
.feed-author{font-size:14px;font-weight:700;}
.feed-time{font-size:12px;color:var(--text-3);margin-top:1px;}
.feed-content{padding:12px 16px 14px;font-size:14px;line-height:1.65;white-space:pre-wrap;}
.feed-photos{display:grid;gap:2px;}
.feed-photos.n1{grid-template-columns:1fr;}
.feed-photos.n2,.feed-photos.n3,.feed-photos.n4{grid-template-columns:1fr 1fr;}
.feed-photos img{width:100%;height:100%;max-height:340px;object-fit:cover;display:block;background:var(--surface-hover);}
.feed-actions{display:flex;align-items:center;gap:6px;border-top:1px solid var(--border);padding:8px 12px;}
.feed-like{display:flex;align-items:center;gap:6px;background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-2);padding:6px 10px;border-radius:8px;}
.feed-like:hover{background:var(--surface-hover);}
.feed-like.liked{color:var(--danger);}
.child-card{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);}
.child-card .ava{width:42px;height:42px;border-radius:50%;background:var(--primary-soft);color:var(--primary-text);display:flex;align-items:center;justify-content:center;font-weight:700;}
.child-card .meta{font-size:12px;color:var(--text-3);margin-top:2px;}
.att-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0;}
.att-stats div{background:var(--surface-2);border-radius:10px;padding:10px;text-align:center;}
.att-stats strong{display:block;font-size:18px;}
.att-stats span{font-size:11px;color:var(--text-3);}
.att-days{display:flex;flex-wrap:wrap;gap:4px;}
.att-day{width:26px;height:26px;border-radius:6px;font-size:10px;display:flex;align-items:center;justify-content:center;color:#fff;}
.att-day.PRESENT{background:var(--success);}.att-day.LATE{background:var(--warning);}.att-day.ABSENT{background:var(--danger);}
.comment-box{border-top:1px solid var(--border);padding:10px 14px;display:grid;gap:8px;}
.comment-row{font-size:13px;}.comment-row b{margin-right:6px;}
.comment-form{display:flex;gap:6px;}.comment-form .input{flex:1;}
.form-2col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.form-2col .input{min-width:0;}
.today-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:3px 9px;border-radius:9999px;background:var(--surface-2);color:var(--text-2);}
.today-chip.in{background:var(--success-soft,#dcfce7);color:var(--success-text,#166534);}
.today-chip.late{background:var(--warning-soft,#fef3c7);color:#92400e;}
.today-chip.absent{background:var(--danger-soft);color:var(--danger-text);}
.bell{position:relative;background:none;border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:16px;margin-left:auto;}
.bell .dot{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:9999px;background:var(--danger);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;}
.notif-panel{position:absolute;top:58px;right:16px;width:min(360px,92vw);max-height:70vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.15);z-index:20;}
.notif-item{display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;text-align:left;background:none;border-left:none;border-right:none;border-top:none;width:100%;color:inherit;}
.notif-item.unread{background:var(--primary-soft);}
.tag{font-size:11px;font-weight:700;padding:1px 7px;border-radius:9999px;background:var(--primary-soft);color:var(--primary-text,var(--primary));}
.tag.new{background:var(--danger);color:#fff;}
.toast-p{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:30;max-width:90vw;box-shadow:0 8px 20px rgba(0,0,0,.25);}
@media (max-width:520px){.public-header{padding:10px 12px;gap:8px;}.public-header .back-btn{padding:6px 9px;font-size:12px;white-space:nowrap;}.public-header .bell{padding:5px 8px;}.ph-title{font-size:14px;}.ph-sub{display:none;}.form-2col{grid-template-columns:minmax(0,1fr);gap:0;}.public-card{padding:20px;}.att-stats{grid-template-columns:repeat(2,1fr);}.parent-tab{padding:12px 10px;font-size:13px;}}
`;

const ATT_LABEL = { PRESENT: "출석", LATE: "지각", ABSENT: "결석" };

function relTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  return d.toLocaleDateString("ko-KR");
}

function ChildAttendance({ child }) {
  const [att, setAtt] = useState(null);
  useEffect(() => {
    fetchParentAttendances(child.member_id, 30).then(setAtt).catch(() => setAtt({ summary: null, items: [] }));
  }, [child.member_id]);
  if (!att) return <div className="sub">출결 불러오는 중…</div>;
  const s = att.summary || {};
  return (
    <div>
      <div className="att-stats">
        <div><strong>{s.rate == null ? "-" : `${s.rate}%`}</strong><span>출석률(30일)</span></div>
        <div><strong>{s.present ?? 0}</strong><span>출석</span></div>
        <div><strong>{s.late ?? 0}</strong><span>지각</span></div>
        <div><strong>{s.absent ?? 0}</strong><span>결석</span></div>
      </div>
      <div className="att-days" aria-label="최근 출결">
        {att.items.slice(0, 30).reverse().map((a) => (
          <div key={a.date} className={`att-day ${a.status}`} title={`${a.date} ${ATT_LABEL[a.status] || a.status}`}>
            {a.date.slice(8)}
          </div>
        ))}
        {!att.items.length && <span className="sub">최근 30일 출결 기록이 없습니다.</span>}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>출석률 = 최근 30일 출결 기록 중 (출석 + 지각) 비율</div>
    </div>
  );
}

function TodayChip({ today }) {
  if (!today) return <span className="today-chip">오늘 아직 등원 전</span>;
  if (today.status === "ABSENT") return <span className="today-chip absent">오늘 결석</span>;
  if (today.check_out_time) return <span className="today-chip in">🏠 {today.check_out_time} 하원</span>;
  return <span className={`today-chip ${today.status === "LATE" ? "late" : "in"}`}>🟢 {today.check_in_time || ""} 등원{today.status === "LATE" ? "(지각)" : ""}</span>;
}

const SUB_LABEL = { NONE: "확인 전", SUBMITTED: "제출 완료", LATE: "지각 제출", MISSING: "미제출" };

function AssignmentsSection() {
  const [rows, setRows] = useState(null);
  useEffect(() => { fetchParentAssignments().then(setRows).catch(() => setRows([])); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="public-card" style={{ width: "100%" }}>
      <h2>📝 과제</h2>
      <div className="sub">자녀가 수강하는 반의 최근 과제입니다. 제출 확인은 선생님이 표시합니다.</div>
      {rows.map((a) => (
        <div className="inv-row" key={a.assignment_id} style={{ alignItems: "flex-start" }}>
          <div className="body">
            <div className="title">{a.title} <span className="tag">{a.class_name}</span></div>
            <div className="meta">기한 {a.due_date}{a.overdue ? " · 마감됨" : ""}</div>
            {a.content && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{a.content}</div>}
            <div className="meta" style={{ marginTop: 4 }}>
              {a.children.map((c) => `${c.name}: ${SUB_LABEL[c.status] || c.status}`).join(" · ")}
            </div>
          </div>
          {a.has_file && (
            <a className="btn sm ghost" href={assignmentFileUrl(a.assignment_id, true)} target="_blank" rel="noreferrer" title={a.file_name || "첨부 파일"}>📎 자료</a>
          )}
        </div>
      ))}
    </div>
  );
}

function ChildrenTab({ kids, onChanged, onGoPay }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const link = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await linkParentChild(name.trim(), phone.trim());
      setName(""); setPhone("");
      onChanged();
    } catch (err) {
      setError(errorText(err, "자녀를 연결하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (child) => {
    if (!window.confirm(`${child.name} 학생 연결을 해제할까요?`)) return;
    await unlinkParentChild(child.member_id).catch(() => null);
    onChanged();
  };

  return (
    <div className="public-body" style={{ alignItems: "flex-start" }}>
      <div className="feed">
        {kids.map((child) => (
          <div className="public-card" key={child.member_id} style={{ width: "100%" }}>
            <div className="child-card" style={{ border: 0, padding: 0 }}>
              <div className="ava">{child.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {child.name} <TodayChip today={child.today} />
                </div>
                <div className="meta">{child.classes.length ? child.classes.join(" · ") : "수강 중인 수업 없음"}</div>
              </div>
              <button className="linkbtn" onClick={() => unlink(child)}>연결 해제</button>
            </div>
            {child.unpaid_amount > 0 && (
              <button type="button" className="linkbtn" onClick={() => onGoPay && onGoPay()}
                style={{ display: "block", width: "100%", textAlign: "left", marginTop: 10, background: "var(--danger-soft)", color: "var(--danger-text)", fontWeight: 600 }}>
                💳 납부할 금액 {child.unpaid_amount.toLocaleString()}원 — 결제하러 가기 →
              </button>
            )}
            <ChildAttendance child={child} />
          </div>
        ))}
        {kids.length > 0 && <AssignmentsSection />}
        <form className="public-card" style={{ width: "100%" }} onSubmit={link}>
          <h2>{kids.length ? "자녀 추가 연결" : "자녀 연결하기"}</h2>
          <div className="sub">시설에 등록된 자녀 이름과 보호자 연락처를 입력하면 이 Google 계정에 연결됩니다. 연결하면 등원·하원·청구서 알림을 받을 수 있습니다.</div>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-2col">
            <div className="form-row"><label>자녀 이름</label>
              <input className="input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김민준" required /></div>
            <div className="form-row"><label>보호자 연락처</label>
              <input className="input" style={{ width: "100%" }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" inputMode="tel" required /></div>
          </div>
          <button className="btn" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>{busy ? "확인 중…" : "자녀 연결"}</button>
        </form>
      </div>
    </div>
  );
}

function FeedPostCard({ post }) {
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [likeCount, setLikeCount] = useState(post.like_count || 0);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const photos = post.photos || [];

  // 좋아요는 계정당 1회, 다시 누르면 취소 (서버 결과로 확정)
  const like = async () => {
    const prev = { liked, likeCount };
    setLiked(!liked); setLikeCount(likeCount + (liked ? -1 : 1));
    try {
      const result = await likeParentPost(post.post_id);
      setLiked(result.liked); setLikeCount(result.like_count);
    } catch {
      setLiked(prev.liked); setLikeCount(prev.likeCount);
    }
  };
  const toggleComments = async () => {
    setOpen((v) => !v);
    if (comments === null) setComments(await fetchParentComments(post.post_id).catch(() => []));
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const added = await createParentComment(post.post_id, text.trim());
      setComments((c) => [...(c || []), added]);
      setText("");
      setNotice(added.pending_review ? "댓글이 자동 검토 중입니다. 관리자가 확인한 뒤 다른 분들께 보입니다." : "");
    } catch (err) {
      setNotice(errorText(err, "댓글을 등록하지 못했습니다."));
    }
  };

  return (
    <div className="feed-post">
      {lightbox !== null && <Lightbox photos={photos} startIndex={lightbox} onClose={() => setLightbox(null)} />}
      <div className="feed-post-head">
        <div className="feed-ava">{(post.author || "관")[0]}</div>
        <div style={{ flex: 1 }}>
          <div className="feed-author">{post.author}</div>
          <div className="feed-time">{relTime(post.created_at)}</div>
        </div>
      </div>
      {post.content && <div className="feed-content">{post.content}</div>}
      {photos.length > 0 && <div style={{ padding: "0 12px" }}><PhotoGrid photos={photos} onOpen={setLightbox} /></div>}
      <div className="feed-actions">
        <button className={`feed-like ${liked ? "liked" : ""}`} onClick={like} aria-pressed={liked}>
          {liked ? "❤️" : "🤍"} 좋아요 {likeCount}
        </button>
        <button className="feed-like" onClick={toggleComments}>💬 댓글 {comments ? comments.length : (post.comment_count ?? "")}</button>
      </div>
      {open && (
        <div className="comment-box">
          {comments === null ? <span className="sub">불러오는 중…</span> : comments.map((c) => (
            <div className="comment-row" key={c.comment_id} style={c.pending_review ? { opacity: 0.6 } : undefined}>
              <b>{c.author}</b>{c.content}
              {c.pending_review && <span className="tag" style={{ marginLeft: 6 }}>검토 중 · 나에게만 보임</span>}
            </div>
          ))}
          {notice && <div className="sub" style={{ margin: 0, color: "var(--text-2)" }}>{notice}</div>}
          <form className="comment-form" onSubmit={submit}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="댓글을 입력하세요" maxLength={1000} />
            <button className="btn sm" type="submit">등록</button>
          </form>
        </div>
      )}
    </div>
  );
}

function NoticesTab({ onRead }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetchParentNotices().then((list) => {
      setRows(list);
      // 화면에 표시된 안 읽은 공지를 읽음으로 기록 (관리자 화면의 '읽음 N/M')
      const unread = list.filter((n) => !n.is_read).map((n) => n.notice_id);
      if (unread.length) markParentNoticesRead(unread).then(() => onRead && onRead()).catch(() => null);
    }).catch(() => setRows([]));
  }, [onRead]);
  if (rows === null) return <div className="public-body"><div className="empty">불러오는 중…</div></div>;
  return (
    <div className="public-body" style={{ alignItems: "flex-start" }}>
      <div className="notice-list" style={{ maxWidth: 600, margin: "0 auto", width: "100%" }}>
        {rows.length === 0 ? <div className="empty">공지사항이 없습니다.</div> : rows.map((n) => (
          <div className={`notice-item ${n.is_pinned ? "pinned" : ""}`} key={n.notice_id}>
            <div className="notice-meta" style={{ flexWrap: "wrap" }}>
              {!n.is_read && <span className="tag new">NEW</span>}
              {n.is_pinned && <span className="badge primary no-dot">고정</span>}
              {n.category === "URGENT" && <span className="badge danger no-dot">긴급</span>}
              {n.class_name && <span className="tag" title={n.reason || ""}>🎯 {n.for_children?.join(", ")} · {n.class_name}</span>}
              <span>{n.author}</span><span>·</span><span>{n.created_at ? new Date(n.created_at).toLocaleDateString("ko-KR") : ""}</span>
            </div>
            <h3 className="notice-title">{n.title}</h3>
            <div className="notice-content">{n.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedTab() {
  const [posts, setPosts] = useState(null);
  useEffect(() => { fetchParentPosts().then(setPosts).catch(() => setPosts([])); }, []);
  if (posts === null) return <div className="public-body"><div className="empty">불러오는 중…</div></div>;
  return (
    <div className="public-body" style={{ alignItems: "flex-start" }}>
      <div className="feed">
        {posts.length === 0 ? <div className="empty">아직 게시물이 없습니다.</div> :
          posts.map((p) => <FeedPostCard key={p.post_id} post={p} />)}
      </div>
    </div>
  );
}

export default function ParentPortal() {
  const navigate = useNavigate();
  const hasPaymentResult = new URLSearchParams(window.location.search).has("kakao");
  const [tab, setTab] = useState(hasPaymentResult ? "pay" : "children");
  const [me, setMe] = useState(null);
  const [children, setChildren] = useState(null);
  const [facility, setFacility] = useState(null);
  const [unread, setUnread] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);
  const lastUnread = useRef(null);

  const loadChildren = useCallback(() => {
    fetchParentChildren().then(setChildren).catch(() => setChildren([]));
  }, []);

  // 실시간 알림 (탭이 보일 때 10초마다 확인 — 등원/하원·청구서·공지·댓글 검토 결과)
  const refreshSummary = useCallback(async () => {
    try {
      const summary = await fetchParentSummary();
      setFacility(summary.facility);
      const count = summary.unread_notifications;
      if (lastUnread.current != null && count > lastUnread.current) {
        const latest = await fetchParentNotifications({ unread_only: true, limit: 3 });
        const first = latest.items[0];
        if (first) {
          setToast(`${NOTIFICATION_META[first.kind]?.icon || "🔔"} ${first.title}`);
          window.setTimeout(() => setToast(null), 5000);
          showBrowserNotification(first.title, first.body || "");
          if (["CHECK_IN", "CHECK_OUT", "ABSENT", "INVOICE", "PAYMENT"].includes(first.kind)) loadChildren();
        }
      }
      lastUnread.current = count;
      setUnread(count);
    } catch { /* 네트워크 오류는 다음 주기에 재시도 */ }
  }, [loadChildren]);

  const openPanel = async () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (next) {
      try {
        setNotifications((await fetchParentNotifications({ limit: 30 })).items);
        if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => null);
      } catch { setNotifications([]); }
    }
  };

  const clickNotification = async (n) => {
    setPanelOpen(false);
    if (!n.is_read) {
      await markParentNotificationsRead({ ids: [n.notification_id] }).catch(() => null);
      refreshSummary();
    }
    const target = n.link || NOTIFICATION_META[n.kind]?.parent;
    if (target) setTab(target);
  };

  const readAll = async () => {
    await markParentNotificationsRead({ all: true }).catch(() => null);
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    refreshSummary();
  };

  useEffect(() => {
    fetchMe()
      .then((current) => {
        if (current.active_role !== "parent") return navigate("/");  // 역할 미선택/관리자 모드 → 역할 선택 화면
        setMe(current);
        loadChildren();
        refreshSummary();
      })
      .catch(() => navigate("/"));
  }, [navigate, loadChildren, refreshSummary]);

  useEffect(() => {
    if (!me) return undefined;
    return startVisiblePolling(refreshSummary, 10000);
  }, [me, refreshSummary]);

  const logout = async () => {
    try { await signOut(); } finally { navigate("/"); }
  };

  if (!me || children === null) return <div className="auth-loading">학부모 정보를 확인하고 있습니다.</div>;

  const tabs = [["children", "👧 내 자녀"], ["pay", "💳 결제"], ["notices", "📢 공지사항"], ["feed", "🤝 커뮤니티"]];
  return (
    <div className="public-wrap">
      <style>{PARENT_CSS}</style>
      <div className="public-header" style={{ position: "relative" }}>
        <div className="logo" style={facility?.logo ? { background: "transparent", overflow: "hidden" } : undefined}>
          {facility?.logo ? <img src={facility.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (facility?.name || "학부모")[0]}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ph-title" style={{ fontWeight: 700 }}>{facility?.name ? `${facility.name} 학부모 포털` : "학부모 포털"}</div>
          <div className="ph-sub" style={{ fontSize: 11, color: "var(--text-3)" }}>
            {me.user.name || me.user.email}{facility?.phone ? ` · 문의 ${facility.phone}` : ""}
          </div>
        </div>
        <button className="bell" onClick={openPanel} aria-label={`알림 ${unread}건`}>
          🔔{unread > 0 && <span className="dot">{unread > 99 ? "99+" : unread}</span>}
        </button>
        {panelOpen && (
          <div className="notif-panel" role="dialog" aria-label="알림">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <b>알림</b>
              {unread > 0 && <button className="linkbtn" onClick={readAll}>모두 읽음</button>}
            </div>
            {notifications.length === 0 ? <div className="sub" style={{ padding: 16 }}>알림이 없습니다. 자녀의 등원·하원, 청구서, 공지가 여기에 표시됩니다.</div> :
              notifications.map((n) => (
                <button type="button" key={n.notification_id} className={`notif-item ${n.is_read ? "" : "unread"}`} onClick={() => clickNotification(n)}>
                  <span style={{ fontSize: 18 }}>{NOTIFICATION_META[n.kind]?.icon || "🔔"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13 }}>{n.title}</span>
                    {n.body && <span style={{ display: "block", fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{n.body}</span>}
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{relativeTime(n.created_at)}</span>
                  </span>
                </button>
              ))}
          </div>
        )}
        <button className="back-btn" style={{ marginLeft: 6 }} onClick={() => navigate("/")}>역할 변경</button>
        <button className="back-btn" style={{ marginLeft: 6 }} onClick={logout}>로그아웃</button>
      </div>
      <div className="parent-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={`parent-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "children" && <ChildrenTab kids={children} onChanged={loadChildren} onGoPay={() => setTab("pay")} />}
      {tab === "pay" && <Checkout hasChildren={children.length > 0} onLinkChild={() => setTab("children")} />}
      {tab === "notices" && <NoticesTab onRead={refreshSummary} />}
      {tab === "feed" && <FeedTab />}
      {toast && <div className="toast-p" role="status" onClick={() => { setToast(null); openPanel(); }}>{toast}</div>}
    </div>
  );
}

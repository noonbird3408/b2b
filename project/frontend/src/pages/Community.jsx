// 커뮤니티 (관리자) — 게시판 · 검토(자동 모니터링) · 멤버 관리(경고·글쓰기 제한·강퇴)
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  createComment, createCommunityPost, createNotice, deleteAttachment, deleteComment, deleteCommunityPost, deleteNotice,
  downloadModerationDataset, draftNotice, errorText, fetchClasses, fetchCommunityBoard, fetchCommunityMembers, fetchCommunityPost,
  fetchComments, fetchModerationPosts, fetchModerationQueue, fetchModerationStats, likeCommunityPost, moderateComment, moderatePost,
  sanctionCommunityMember, updateCommunityPost, updateNotice, uploadNoticeAttachment, uploadPostAttachment,
} from "../api";
import Board from "../components/Board.jsx";
import { relativeTime } from "../utils/constants";
import { useDataRefresh } from "../utils/sync";

const ADMIN_API = {
  board: fetchCommunityBoard,
  post: fetchCommunityPost,
  createPost: createCommunityPost,
  updatePost: updateCommunityPost,
  deletePost: deleteCommunityPost,
  like: likeCommunityPost,
  comments: fetchComments,
  createComment: (postId, content) => createComment(postId, { content }),
  deleteComment,
  createNotice,
  updateNotice,
  deleteNotice,
  moderatePost,
  // v10: 첨부파일 · 공지 자동 작성
  uploadPostAttachment,
  uploadNoticeAttachment,
  deleteAttachment,
  draftNotice,
};

const DECISION_LABEL = { APPROVED: "공개됨", HIDDEN: "숨김" };
const TABS = [["board", "게시판"], ["moderation", "검토"], ["members", "멤버"]];

export default function Community() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === searchParams.get("tab")) ? searchParams.get("tab") : "board";
  const [classes, setClasses] = useState([]);
  useEffect(() => { fetchClasses().then(setClasses).catch(() => setClasses([])); }, []);

  const setTab = (next) => {
    const params = new URLSearchParams();
    if (next !== "board") params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <>
      <h2 className="page-title">커뮤니티</h2>
      <p className="page-subtitle">공지와 학부모 게시판을 함께 운영합니다.</p>
      <div className="tabs">
        {TABS.map(([k, v]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {tab === "board" && <Board mode="admin" api={ADMIN_API} classes={classes} />}
      {tab === "moderation" && <ModerationTab />}
      {tab === "members" && <MembersTab />}
    </>
  );
}

// ---------------------------------------------------------------------
// 검토 — 자동 모니터링이 잡은 학부모 글·댓글 + 성능 지표(정밀도·재현율·F1) + 학습 데이터
// ---------------------------------------------------------------------
function ModerationTab() {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState(null);
  const [posts, setPosts] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [queue, st, pendingPosts] = await Promise.all([
        fetchModerationQueue(status), fetchModerationStats(), fetchModerationPosts("PENDING").catch(() => []),
      ]);
      setRows(queue); setStats(st); setPosts(pendingPosts); setError(null);
    } catch (e) {
      setError(errorText(e, "검토 목록을 불러오지 못했습니다."));
      setRows([]);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load);

  const decide = async (id, decision) => {
    try { await moderateComment(id, decision); load(); } catch (e) { alert(errorText(e, "처리하지 못했습니다.")); }
  };
  const decidePost = async (id, decision) => {
    try { await moderatePost(id, decision); load(); } catch (e) { alert(errorText(e, "처리하지 못했습니다.")); }
  };
  const exportCsv = async () => {
    try {
      const url = URL.createObjectURL(await downloadModerationDataset());
      const a = document.createElement("a");
      a.href = url; a.download = `moderation_dataset_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(errorText(e, "내보내지 못했습니다."));
    }
  };

  const metric = (label, value, def, suffix = "%") => (
    <div className="stat-card" title={def || undefined}>
      <div className="stat-card-head"><span className="stat-label">{label}</span></div>
      <div className="stat-value num">{value ?? "–"}{value != null && <span className="unit">{suffix}</span>}</div>
    </div>
  );

  return (
    <div>
      {error && <div className="fl-banner danger">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 className="card-title">검토 대기 글 {posts.length}건</h3>
            <div className="card-sub">자동 모니터링이 의심한 학부모 글 — 공개 전까지 작성자에게만 보입니다.</div>
          </div>
        </div>
        {posts.length === 0 ? <div className="muted">대기 중인 글이 없습니다.</div> : posts.map((p) => (
          <div key={p.post_id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
            <div className="muted">{p.author} · {relativeTime(p.created_at)} · {p.category_label}</div>
            <div style={{ fontWeight: 700, margin: "4px 0" }}>{p.title}</div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{p.content}</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
              <button className="btn ghost sm" onClick={() => decidePost(p.post_id, "APPROVED")}>정상 — 공개</button>
              <button className="btn danger sm" onClick={() => decidePost(p.post_id, "HIDDEN")}>숨김</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 className="card-title">댓글 자동 모니터링 성능</h3>
            <div className="card-sub">모델 {stats?.model || "-"} · 관리자 판정을 정답으로 계산</div>
          </div>
          <button className="btn ghost sm" onClick={exportCsv}>⬇ 학습 데이터 CSV</button>
        </div>
        <div className="stat-grid" style={{ marginBottom: 0, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          {metric("학부모 댓글", stats?.parent_comments, null, "건")}
          {metric("자동 탐지", stats?.auto_flagged, null, "건")}
          {metric("정밀도", stats?.precision, stats?.definitions?.precision)}
          {metric("재현율", stats?.recall, stats?.definitions?.recall)}
          {metric("F1", stats?.f1, "정밀도와 재현율의 조화평균", "")}
        </div>
        {stats && (
          <div className="muted" style={{ marginTop: 10 }}>
            TP {stats.true_positive} · FP {stats.false_positive} · FN {stats.false_negative} · 대기 {stats.pending}
            {Object.keys(stats.by_reason || {}).length > 0 && <> · 사유: {Object.entries(stats.by_reason).map(([k, v]) => `${k} ${v}`).join(", ")}</>}
          </div>
        )}
      </div>

      <div className="segmented" style={{ marginBottom: 12 }}>
        {[["pending", "검토 대기"], ["flagged", "자동 탐지 전체"], ["all", "학부모 댓글 전체"]].map(([v, l]) => (
          <button key={v} className={status === v ? "active" : ""} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      {rows === null ? <div className="fl-skeleton" style={{ height: 160 }} /> : rows.length === 0 ? (
        <div className="empty">{status === "pending" ? "검토할 댓글이 없습니다." : "해당하는 댓글이 없습니다."}</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((c) => (
            <div key={c.comment_id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span className="muted">{c.author} · {relativeTime(c.created_at)} · “{c.post_excerpt || "사진"}”</span>
                <span style={{ display: "flex", gap: 4 }}>
                  {c.review?.flagged && <span className="badge danger no-dot">점수 {c.review.score}</span>}
                  {c.review?.decision && <span className="badge gray no-dot">{DECISION_LABEL[c.review.decision]}</span>}
                </span>
              </div>
              <div style={{ fontSize: 14, margin: "8px 0", whiteSpace: "pre-wrap" }}>{c.content}</div>
              {c.review?.reasons && <div style={{ fontSize: 12, color: "var(--danger-text)" }}>탐지 사유: {c.review.reasons}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                <button className="btn sm ghost" onClick={() => decide(c.comment_id, "APPROVED")} disabled={c.review?.decision === "APPROVED"}>정상 — 공개</button>
                <button className="btn sm danger" onClick={() => decide(c.comment_id, "HIDDEN")} disabled={c.review?.decision === "HIDDEN"}>유해 — 숨김</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 멤버 — 학원에 입장한 학부모 계정. 경고 · 글쓰기 제한(기간) · 강퇴/해제
// ---------------------------------------------------------------------
function MembersTab() {
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [target, setTarget] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchCommunityMembers().then((r) => { setRows(r); setError(""); }).catch((e) => { setRows([]); setError(errorText(e, "멤버를 불러오지 못했습니다.")); });
  }, []);
  useEffect(load, [load]);
  useDataRefresh(load);

  const shown = useMemo(() => (rows || []).filter((m) => {
    if (filter === "SANCTIONED" && !(m.status === "BANNED" || m.muted_until || m.warnings)) return false;
    const q = query.trim();
    return !q || m.nickname.includes(q) || m.name?.includes(q) || m.children.some((c) => c.includes(q));
  }), [rows, query, filter]);

  return (
    <div>
      {error && <div className="fl-banner danger">{error}</div>}
      <div className="toolbar">
        <div className="search-box" style={{ flex: "1 1 200px" }}>
          <input className="input" style={{ width: "100%" }} placeholder="닉네임·이름·자녀 이름" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="segmented">
          <button className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}>전체 {rows?.length ?? ""}</button>
          <button className={filter === "SANCTIONED" ? "active" : ""} onClick={() => setFilter("SANCTIONED")}>제재 이력</button>
        </div>
      </div>
      {rows === null ? <div className="fl-skeleton" style={{ height: 200 }} /> : shown.length === 0 ? <div className="empty">멤버가 없습니다.</div> : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>닉네임</th><th>자녀</th><th>활동</th><th>상태</th><th>최근 접속</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.membership_id}>
                  <td><div style={{ fontWeight: 700 }}>{m.nickname}</div><div className="muted">{m.name} · {m.email}</div></td>
                  <td>{m.children.length ? m.children.join(", ") : <span className="muted">연결 전</span>}</td>
                  <td className="num">글 {m.post_count} · 댓글 {m.comment_count}{m.hidden_count ? <span style={{ color: "var(--danger)" }}> · 숨김 {m.hidden_count}</span> : null}</td>
                  <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {m.status === "BANNED" ? <span className="badge danger no-dot">강퇴</span>
                      : m.muted_until ? <span className="badge warning no-dot">제한 ~{m.muted_until.slice(5, 16).replace("T", " ")}</span>
                        : <span className="badge success no-dot">정상</span>}
                    {m.warnings > 0 && <span className="badge gray no-dot">경고 {m.warnings}</span>}
                  </td>
                  <td className="muted">{m.last_seen_at ? relativeTime(m.last_seen_at) : "-"}</td>
                  <td><button className="btn ghost sm" onClick={() => setTarget(m)}>관리</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target && <SanctionModal member={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />}
    </div>
  );
}

function SanctionModal({ member, onClose, onDone }) {
  const [reason, setReason] = useState(member.sanction_note || "");
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const act = async (action) => {
    if (action === "ban" && !window.confirm(`${member.nickname} 님을 강퇴할까요? 이 학원의 학부모 화면을 더 이상 이용할 수 없습니다.`)) return;
    setBusy(true); setErr("");
    try {
      await sanctionCommunityMember(member.membership_id, { action, days: Number(days), reason });
      onDone();
    } catch (e) {
      setErr(errorText(e, "처리하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{member.nickname} 님 관리</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          자녀 {member.children.join(", ") || "-"} · 글 {member.post_count} · 댓글 {member.comment_count} · 경고 {member.warnings}회
          {member.sanction_note ? ` · 최근 사유: ${member.sanction_note}` : ""}
        </p>
        <div className="form-row"><label>사유 (학부모에게 알림으로 전달)</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="예: 광고성 댓글 반복" /></div>
        <div style={{ display: "grid", gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={() => act("warn")}>⚠️ 경고 보내기</button>
          <div style={{ display: "flex", gap: 6 }}>
            <select className="select" value={days} onChange={(e) => setDays(e.target.value)} aria-label="제한 기간">
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}일</option>)}
            </select>
            <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => act("mute")}>✋ 글·댓글 작성 제한</button>
          </div>
          {member.muted_until && <button className="btn ghost" disabled={busy} onClick={() => act("unmute")}>작성 제한 해제</button>}
          {member.status === "BANNED"
            ? <button className="btn" disabled={busy} onClick={() => act("unban")}>강퇴 해제</button>
            : <button className="btn danger" disabled={busy} onClick={() => act("ban")}>⛔ 강퇴</button>}
        </div>
        <div className="modal-actions" style={{ marginTop: 14 }}><button className="btn ghost" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

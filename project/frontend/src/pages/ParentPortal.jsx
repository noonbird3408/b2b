import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FACILITY_REQUIRED_EVENT, applyToFacility, assignmentFileUrl, cancelParentApplication, createChildProfile, createParentComment,
  createParentPost, deleteChildProfile, deleteParentComment, deleteParentPost, enterParentFacility, errorText, exitParentFacility,
  fetchChildProfiles, fetchFacilityDetail, fetchMe, fetchMyFacilities, fetchParentApplications, fetchParentAssignments,
  fetchParentAttendances, fetchParentBoard, fetchParentChildren, fetchParentComments, fetchParentNotifications, fetchParentPost,
  fetchParentSummary, leaveParentFacility, likeParentPost, linkParentChild, markParentNoticesRead, markParentNotificationsRead,
  searchFacilities, signOut, unlinkParentChild, updateChildProfile, updateParentMembership, updateParentPost,
} from "../api";
import Brand from "../components/Brand.jsx";
import Board from "../components/Board.jsx";
import { NOTIFICATION_META, relativeTime, showBrowserNotification, startVisiblePolling } from "../utils/constants";
import { DAY_LABELS, STATUS_LABEL, STATUS_TONE, announceDataChanged, won } from "../utils/sync";
import Checkout from "./Checkout";

/* =====================================================================
   학부모 포털
   - 시설 밖(허브): 내 시설 · 시설 찾기(가입 신청) · 내 자녀 정보 · 신청 현황
   - 시설 안: 우리 아이(출결·과제) · 결제 · 커뮤니티(공지+게시판) · 시설 정보
   모든 데이터는 /api/parent/* 에서 "이 계정 + 입장한 시설" 기준으로만 내려옵니다.
===================================================================== */
const CSS = `
.pp{min-height:100vh;background:var(--bg);display:flex;flex-direction:column;color:var(--text);}
.pp-head{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:20;}
.pp-head .right{margin-left:auto;display:flex;gap:6px;align-items:center;}
.pp-tabs{display:flex;gap:2px;background:var(--surface);border-bottom:1px solid var(--border);padding:0 12px;position:sticky;top:57px;z-index:15;overflow-x:auto;scrollbar-width:none;}
.pp-tabs::-webkit-scrollbar{display:none;}
.pp-tab{background:none;border:none;padding:13px 14px;font-size:14px;font-weight:600;color:var(--text-3);border-bottom:2.5px solid transparent;white-space:nowrap;}
.pp-tab.on{color:var(--primary-text);border-bottom-color:var(--primary);}
.pp-body{width:min(920px,100%);margin:0 auto;padding:20px 16px 56px;display:grid;gap:16px;}
.pp-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;}
.pp-card h3{margin:0 0 4px;font-size:16px;}
.pp-card .sub{font-size:12.5px;color:var(--text-3);margin:0 0 12px;}
.pp-hero{background:linear-gradient(135deg,var(--primary-soft),var(--surface));border:1px solid var(--border);border-radius:16px;padding:20px;}
.pp-hero h2{margin:0 0 4px;font-size:21px;}
.fac-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;}
.fac-c{border:1px solid var(--border);border-radius:12px;padding:14px;background:var(--surface);display:flex;flex-direction:column;gap:8px;text-align:left;color:var(--text);}
.fac-c:hover{border-color:var(--primary);}
.fac-c .top{display:flex;gap:10px;align-items:center;}
.fac-c .lg{width:40px;height:40px;border-radius:10px;background:var(--primary-soft);color:var(--primary-text);display:grid;place-items:center;font-weight:800;overflow:hidden;flex-shrink:0;}
.fac-c .lg img{width:100%;height:100%;object-fit:cover;}
.fac-c b{font-size:15px;}
.fac-c .m{font-size:12px;color:var(--text-3);}
.search-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
.search-row .input{flex:1 1 180px;min-width:0;}
.kid{border:1px solid var(--border);border-radius:14px;padding:16px;background:var(--surface);}
.kid-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
.kid-ava{width:44px;height:44px;border-radius:50%;background:var(--primary-soft);color:var(--primary-text);display:grid;place-items:center;font-weight:800;font-size:18px;}
.today-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.att-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0;}
.att-stats div{background:var(--surface-2);border-radius:10px;padding:10px;text-align:center;}
.att-stats strong{display:block;font-size:18px;}
.att-stats span{font-size:11px;color:var(--text-3);}
.att-days{display:flex;flex-wrap:wrap;gap:4px;}
.att-day{width:26px;height:26px;border-radius:6px;font-size:10px;display:grid;place-items:center;color:#fff;}
.att-day.PRESENT{background:var(--success);}.att-day.LATE{background:var(--warning);}.att-day.ABSENT{background:var(--danger);}
.cls-pick{display:grid;gap:8px;}
.cls-pick label{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;}
.cls-pick label.on{border-color:var(--primary);background:var(--primary-soft);}
.cls-pick .nm{font-weight:700;display:flex;gap:6px;align-items:center;}
.cls-pick .sc{font-size:12px;color:var(--text-3);}
.total-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:10px;background:var(--surface-2);margin:12px 0;font-weight:700;}
.inv-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);}
.inv-row:last-child{border-bottom:none;}
.inv-row .body{flex:1;min-width:0;}
.inv-row .title{font-size:14px;font-weight:600;}
.inv-row .meta{font-size:12px;color:var(--text-3);margin-top:2px;}
.inv-row .amt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;}
.kakao-btn{background:#FEE500;color:#3C1E1E;font-weight:700;border:none;border-radius:8px;padding:9px 14px;font-size:13px;white-space:nowrap;}
.kakao-btn:disabled{opacity:.5;}
.bell{position:relative;background:none;border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:16px;}
.bell .dot{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:9999px;background:var(--danger);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 4px;}
.notif-panel{position:absolute;top:54px;right:12px;width:min(360px,94vw);max-height:70vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);z-index:30;}
.notif-item{display:flex;gap:10px;padding:12px 14px;border:0;border-bottom:1px solid var(--border);text-align:left;background:none;width:100%;color:inherit;}
.notif-item.unread{background:var(--primary-soft);}
.toast-p{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:40;max-width:90vw;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px;}
.status-line{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
@media(max-width:600px){.pp-head{padding:8px 12px;}.pp-head .hide-sm{display:none;}.pp-tabs{top:53px;}.grid2{grid-template-columns:1fr;}.att-stats{grid-template-columns:repeat(2,1fr);}.pp-body{padding:14px 12px 48px;}}
`;

const APP_STATUS = { PENDING: ["warning", "심사 중"], APPROVED: ["success", "승인"], REJECTED: ["danger", "반려"], CANCELED: ["gray", "취소"] };
const EMPTY_CHILD = { name: "", gender: "M", age: "", school: "", parent_name: "", parent_phone: "", relation: "모", address: "", note: "" };

const PARENT_API = {
  board: fetchParentBoard,
  post: fetchParentPost,
  createPost: createParentPost,
  updatePost: updateParentPost,
  deletePost: deleteParentPost,
  like: likeParentPost,
  comments: fetchParentComments,
  createComment: createParentComment,
  deleteComment: deleteParentComment,
  markNoticeRead: markParentNoticesRead,
};

const scheduleText = (schedules = []) => schedules.map((s) => `${DAY_LABELS[s.day] || s.day} ${s.start || ""}${s.end ? `~${s.end}` : ""}`).join(" · ");

// =====================================================================
export default function ParentPortal() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  const reloadMe = useCallback(() => fetchMe()
    .then((current) => {
      if (current.active_role !== "parent") { navigate("/", { replace: true }); return null; }
      setMe(current);
      return current;
    })
    .catch(() => { navigate("/", { replace: true }); return null; }), [navigate]);

  useEffect(() => { reloadMe(); }, [reloadMe]);
  useEffect(() => {
    const onRequired = () => reloadMe();       // 강퇴·시설 삭제 등으로 시설 접근이 끊기면 허브로
    window.addEventListener(FACILITY_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(FACILITY_REQUIRED_EVENT, onRequired);
  }, [reloadMe]);

  const logout = async () => {
    try { await signOut(); } finally { navigate("/", { replace: true }); }
  };

  if (!me) return <div className="auth-loading">학부모 정보를 확인하고 있습니다.</div>;
  return (
    <div className="pp">
      <style>{CSS}</style>
      {me.facility
        ? <FacilityHome me={me} onExit={async () => { await exitParentFacility().catch(() => null); reloadMe(); }} onLogout={logout} onReload={reloadMe} />
        : <Hub me={me} onEntered={(current) => setMe(current)} onLogout={logout} />}
    </div>
  );
}

function HeaderMenu({ onLogout }) {
  const navigate = useNavigate();
  return (
    <>
      <button className="btn ghost sm hide-sm" onClick={() => navigate("/?role=1")}>역할 변경</button>
      <button className="btn ghost sm" onClick={onLogout}>로그아웃</button>
    </>
  );
}

// =====================================================================
// 허브 — 시설 선택 전
// =====================================================================
function Hub({ me, onEntered, onLogout }) {
  const [tab, setTab] = useState("mine");
  const [mine, setMine] = useState(null);
  const [applications, setApplications] = useState([]);
  const [children, setChildren] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchMyFacilities().then(setMine).catch((e) => { setMine([]); setError(errorText(e, "시설 목록을 불러오지 못했습니다.")); });
    fetchParentApplications().then(setApplications).catch(() => setApplications([]));
    fetchChildProfiles().then(setChildren).catch(() => setChildren([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { if (mine && mine.length === 0) setTab((t) => (t === "mine" ? "search" : t)); }, [mine]);

  const enter = async (facilityId) => {
    setError("");
    try {
      onEntered(await enterParentFacility(facilityId));
    } catch (e) {
      setError(errorText(e, "시설에 들어가지 못했습니다."));
    }
  };

  const pendingCount = applications.filter((a) => a.status === "PENDING").length;
  const tabs = [["mine", "내 시설"], ["search", "시설 찾기"], ["children", "자녀 정보"], ["apps", `신청 현황${pendingCount ? ` ${pendingCount}` : ""}`]];

  return (
    <>
      <header className="pp-head">
        <Brand to="/parentportal" sub="학부모" />
        <div className="right"><HeaderMenu onLogout={onLogout} /></div>
      </header>
      <nav className="pp-tabs" style={{ top: 57 }}>
        {tabs.map(([k, v]) => <button key={k} className={`pp-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{v}</button>)}
      </nav>
      <main className="pp-body">
        {error && <div className="fl-banner danger">{error}</div>}
        {tab === "mine" && (
          <>
            <div className="pp-hero">
              <h2>{me.user.name ? `${me.user.name} 님, 반가워요` : "반가워요"}</h2>
              <div className="muted">이용할 시설을 선택하세요.</div>
            </div>
            {mine === null ? <div className="fl-skeleton" style={{ height: 140 }} /> : mine.length === 0 ? (
              <div className="empty">아직 입장한 시설이 없습니다. <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setTab("search")}>시설 찾기</button></div>
            ) : (
              <div className="fac-cards">
                {mine.map((f) => (
                  <button key={f.facility_id} type="button" className="fac-c" onClick={() => enter(f.facility_id)} disabled={f.membership_status === "BANNED"}>
                    <div className="top">
                      <div className="lg">{f.logo ? <img src={f.logo} alt="" /> : f.name[0]}</div>
                      <div style={{ minWidth: 0 }}>
                        <b>{f.name}</b>
                        <div className="m">{[f.facility_type, f.branch, f.region].filter(Boolean).join(" · ")}</div>
                      </div>
                      {f.unread > 0 && <span className="badge danger no-dot" style={{ marginLeft: "auto" }}>알림 {f.unread}</span>}
                    </div>
                    <div className="m">{f.children.length ? `자녀: ${f.children.join(", ")}` : "연결된 자녀 없음"}</div>
                    {f.membership_status === "BANNED" ? <span className="badge danger no-dot">이용 제한</span> : <span className="go" style={{ color: "var(--primary-text)", fontWeight: 700, fontSize: 13 }}>입장 →</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "search" && <FacilitySearch onOpen={setDetailId} />}
        {tab === "children" && <ChildProfiles childrenList={children} onChanged={load} />}
        {tab === "apps" && <ApplicationList applications={applications} onChanged={load} onEnter={enter} />}
      </main>
      {detailId && (
        <FacilityDetail facilityId={detailId} childrenList={children} onClose={() => setDetailId(null)}
          onApplied={() => { setDetailId(null); load(); setTab("apps"); }} onEnter={enter} onChildrenChanged={load} />
      )}
    </>
  );
}

function FacilitySearch({ onOpen }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [region, setRegion] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const search = useCallback(async (e) => {
    e?.preventDefault();
    try {
      setRows(await searchFacilities({ q: q.trim() || undefined, facility_type: type || undefined, region: region.trim() || undefined }));
      setError("");
    } catch (err) {
      setError(errorText(err, "검색하지 못했습니다."));
    }
  }, [q, type, region]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(); }, [type]);

  return (
    <div className="pp-card">
      <h3>시설 찾기</h3>
      <p className="sub">이름·지역으로 찾고, 수업을 골라 가입을 신청하세요.</p>
      <form className="search-row" onSubmit={search}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="시설 이름 (예: 태권도)" />
        <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="지역 (예: 용인)" style={{ flex: "0 1 140px" }} />
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="시설 유형">
          <option value="">전체 유형</option>{["학원", "체육관", "도장", "기타"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="btn" type="submit">검색</button>
      </form>
      {error && <div className="fl-banner danger">{error}</div>}
      {rows === null ? <div className="fl-skeleton" style={{ height: 120 }} /> : rows.length === 0 ? <div className="empty">검색 결과가 없습니다.</div> : (
        <div className="fac-cards">
          {rows.map((f) => (
            <button key={f.facility_id} type="button" className="fac-c" onClick={() => onOpen(f.facility_id)}>
              <div className="top">
                <div className="lg">{f.logo ? <img src={f.logo} alt="" /> : f.name[0]}</div>
                <div style={{ minWidth: 0 }}>
                  <b>{f.name}</b>
                  <div className="m">{[f.facility_type, f.branch, f.region].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              {f.description && <div className="m" style={{ color: "var(--text-2)" }}>{f.description.slice(0, 70)}{f.description.length > 70 ? "…" : ""}</div>}
              <div className="status-line">
                <span className="badge gray no-dot">수업 {f.class_count}</span>
                {f.joined && <span className="badge primary no-dot">입장한 시설</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FacilityDetail({ facilityId, childrenList, onClose, onApplied, onEnter, onChildrenChanged, inFacility = false }) {
  const [f, setF] = useState(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [childId, setChildId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingChild, setAddingChild] = useState(false);

  useEffect(() => {
    fetchFacilityDetail(facilityId).then(setF).catch((e) => setError(errorText(e, "시설 정보를 불러오지 못했습니다.")));
  }, [facilityId]);
  useEffect(() => { if (!childId && childrenList.length) setChildId(String(childrenList[0].child_id)); }, [childrenList, childId]);

  const toggle = (id) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const estimate = (f?.classes || []).filter((c) => picked.has(c.class_id)).reduce((s, c) => s + (c.fee || 0), 0);
  const total = picked.size ? estimate : f?.base_tuition_fee || 0;

  const apply = async () => {
    if (!childId) return setError("신청할 자녀를 먼저 등록하세요.");
    setBusy(true);
    setError("");
    try {
      const res = await applyToFacility(facilityId, { child_id: Number(childId), class_ids: [...picked], message });
      alert(`가입 신청을 보냈습니다.\n예상 월 비용 ${won(res.estimated_fee)} · 시설에서 승인하면 알림으로 알려 드립니다.`);
      onApplied?.();
    } catch (e) {
      setError(errorText(e, "신청하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "min(640px,100%)" }} onClick={(e) => e.stopPropagation()}>
        {!f ? (error ? <div className="fl-banner danger">{error}</div> : <div className="fl-skeleton" style={{ height: 240 }} />) : (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{f.name}</h3>
              <span className="badge gray no-dot">{f.facility_type}</span>
              <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="닫기">✕</button>
            </div>
            <div className="muted" style={{ margin: "6px 0 10px" }}>
              {[f.branch, f.region, f.address].filter(Boolean).join(" · ")}{f.phone ? ` · ☎ ${f.phone}` : ""}{f.principal ? ` · 원장 ${f.principal}` : ""}
            </div>
            {f.description && <p style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 0 }}>{f.description}</p>}
            {error && <div className="fl-banner danger">{error}</div>}

            <div className="form-row">
              <label>수강할 수업 선택</label>
              {f.classes.length === 0 ? <div className="muted">공개된 수업이 없습니다. 시설에 문의하세요.</div> : (
                <div className="cls-pick">
                  {f.classes.map((c) => (
                    <label key={c.class_id} className={picked.has(c.class_id) ? "on" : ""}>
                      <input type="checkbox" checked={picked.has(c.class_id)} onChange={() => toggle(c.class_id)} />
                      <span>
                        <span className="nm"><span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, display: "inline-block" }} />{c.name}</span>
                        <span className="sc">{scheduleText(c.schedules) || "시간 미정"} · {c.teacher}{c.description ? ` · ${c.description.slice(0, 40)}` : ""}</span>
                      </span>
                      <b>{won(c.fee)}</b>
                    </label>
                  ))}
                </div>
              )}
              <div className="total-bar"><span>예상 월 수강료</span><span>{won(total)}</span></div>
              {!picked.size && f.base_tuition_fee ? <div className="muted">수업을 고르지 않으면 기본 수강료 기준입니다.</div> : null}
            </div>

            <div className="form-row">
              <label>자녀</label>
              {childrenList.length ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <select className="select" style={{ flex: 1 }} value={childId} onChange={(e) => setChildId(e.target.value)}>
                    {childrenList.map((c) => <option key={c.child_id} value={c.child_id}>{c.name} ({c.age}세)</option>)}
                  </select>
                  <button type="button" className="btn ghost sm" onClick={() => setAddingChild(true)}>+ 자녀</button>
                </div>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setAddingChild(true)}>+ 자녀 정보 등록</button>
              )}
            </div>
            <div className="form-row"><label>남길 말 (선택)</label>
              <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="예: 체험 수업 먼저 가능할까요?" /></div>

            <div className="modal-actions" style={{ flexWrap: "wrap" }}>
              {!inFacility && <button className="btn ghost" onClick={() => onEnter(facilityId)}>{f.joined ? "입장" : "둘러보기(커뮤니티)"}</button>}
              <button className="btn" onClick={apply} disabled={busy || !childList(childrenList)}>{busy ? "보내는 중…" : "가입 신청"}</button>
            </div>
          </>
        )}
        {addingChild && (
          <ChildForm onClose={() => setAddingChild(false)}
            onSaved={(c) => { setAddingChild(false); setChildId(String(c.child_id)); onChildrenChanged?.(); }} />
        )}
      </div>
    </div>
  );
}
const childList = (list) => list && list.length > 0;

function ChildForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_CHILD, ...(initial || {}) }));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const payload = { ...form, age: Number(form.age) };
      const saved = initial?.child_id ? await updateChildProfile(initial.child_id, payload) : await createChildProfile(payload);
      onSaved(saved);
    } catch (error) {
      setErr(errorText(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 120 }}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{initial?.child_id ? "자녀 정보 수정" : "자녀 정보 등록"}</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <div className="grid2">
          <div className="form-row"><label>이름 *</label><input className="input" required maxLength={50} value={form.name} onChange={set("name")} /></div>
          <div className="form-row"><label>성별</label>
            <div className="segmented" style={{ display: "flex" }}>
              {[["M", "남"], ["F", "여"]].map(([k, v]) => <button key={k} type="button" style={{ flex: 1 }} className={form.gender === k ? "active" : ""} onClick={() => setForm((f) => ({ ...f, gender: k }))}>{v}</button>)}
            </div></div>
          <div className="form-row"><label>나이 *</label><input className="input" type="number" min="1" max="100" required value={form.age} onChange={set("age")} /></div>
          <div className="form-row"><label>학교 (선택)</label><input className="input" maxLength={100} value={form.school} onChange={set("school")} /></div>
          <div className="form-row"><label>보호자 이름</label><input className="input" maxLength={50} value={form.parent_name} onChange={set("parent_name")} /></div>
          <div className="form-row"><label>관계</label>
            <select className="select" value={form.relation} onChange={set("relation")}><option value="모">모</option><option value="부">부</option><option value="기타">기타</option></select></div>
          <div className="form-row"><label>보호자 연락처 *</label><input className="input" required inputMode="tel" maxLength={20} value={form.parent_phone} onChange={set("parent_phone")} placeholder="010-0000-0000" /></div>
          <div className="form-row"><label>주소 (선택)</label><input className="input" maxLength={200} value={form.address} onChange={set("address")} /></div>
        </div>
        <div className="form-row"><label>특이사항 (선택)</label><textarea maxLength={500} value={form.note} onChange={set("note")} placeholder="알레르기, 픽업 안내 등" /></div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </div>
  );
}

function ChildProfiles({ childrenList, onChanged }) {
  const [editing, setEditing] = useState(null);
  const remove = async (c) => {
    if (!window.confirm(`${c.name} 정보를 삭제할까요? (이미 시설에 등록된 학생 기록은 그대로입니다)`)) return;
    try { await deleteChildProfile(c.child_id); onChanged(); } catch (e) { alert(errorText(e, "삭제하지 못했습니다.")); }
  };
  return (
    <div className="pp-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>자녀 정보</h3>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setEditing({})}>+ 자녀 등록</button>
      </div>
      <p className="sub" style={{ marginTop: 4 }}>가입 신청서에 쓰이는 정보입니다.</p>
      {childrenList.length === 0 ? <div className="empty">등록된 자녀가 없습니다.</div> : childrenList.map((c) => (
        <div key={c.child_id} className="inv-row">
          <div className="kid-ava">{c.name[0]}</div>
          <div className="body">
            <div className="title">{c.name} <span className="muted">{c.gender === "M" ? "남" : "여"} · {c.age}세{c.school ? ` · ${c.school}` : ""}</span></div>
            <div className="meta">{c.parent_name || "보호자"}({c.relation}) {c.parent_phone}</div>
          </div>
          <button className="btn ghost sm" onClick={() => setEditing(c)}>수정</button>
          <button className="btn danger sm" onClick={() => remove(c)}>삭제</button>
        </div>
      ))}
      {editing && <ChildForm initial={editing.child_id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </div>
  );
}

function ApplicationList({ applications, onChanged, onEnter }) {
  const cancel = async (a) => {
    if (!window.confirm("가입 신청을 취소할까요?")) return;
    try { await cancelParentApplication(a.application_id); onChanged(); } catch (e) { alert(errorText(e, "취소하지 못했습니다.")); }
  };
  return (
    <div className="pp-card">
      <h3>가입 신청 현황</h3>
      <p className="sub">시설에서 승인하면 학생으로 등록되고 알림이 옵니다.</p>
      {applications.length === 0 ? <div className="empty">신청 내역이 없습니다.</div> : applications.map((a) => {
        const [tone, label] = APP_STATUS[a.status] || ["gray", a.status];
        return (
          <div key={a.application_id} className="inv-row" style={{ alignItems: "flex-start" }}>
            <div className="body">
              <div className="title">{a.facility_name} · {a.child.name}</div>
              <div className="meta">{a.classes.map((c) => c.name).join(", ") || "수업 미선택"} · 예상 {won(a.estimated_fee)}/월</div>
              <div className="meta">{(a.created_at || "").slice(0, 10)} 신청{a.reject_reason ? ` · 사유: ${a.reject_reason}` : ""}</div>
            </div>
            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
              <span className={`badge ${tone} no-dot`}>{label}</span>
              {a.status === "PENDING" && <button className="btn ghost sm" onClick={() => cancel(a)}>취소</button>}
              {a.status === "APPROVED" && <button className="btn sm" onClick={() => onEnter(a.facility_id)}>입장</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// 시설 안
// =====================================================================
function FacilityHome({ me, onExit, onLogout, onReload }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hasPaymentResult = searchParams.has("kakao");
  const initialTab = hasPaymentResult ? "pay" : (searchParams.get("tab") || "kids");
  const [tab, setTabState] = useState(initialTab);
  const [summary, setSummary] = useState(null);
  const [kids, setKids] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [childProfiles, setChildProfiles] = useState([]);
  const lastUnread = useRef(null);
  const lastVersion = useRef(null);

  const setTab = (next) => {
    setTabState(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    params.delete("open");
    params.delete("category");
    setSearchParams(params, { replace: true });
  };

  const loadKids = useCallback(() => { fetchParentChildren().then(setKids).catch(() => setKids([])); }, []);

  // 요약 폴링: 새 알림은 토스트로, data_version 이 바뀌면 열린 화면을 다시 불러옴(실시간 동기화)
  const refreshSummary = useCallback(async () => {
    try {
      const s = await fetchParentSummary();
      setSummary(s);
      if (lastVersion.current != null && s.data_version !== lastVersion.current) {
        announceDataChanged(s.data_version);
        loadKids();
      }
      lastVersion.current = s.data_version;
      if (lastUnread.current != null && s.unread_notifications > lastUnread.current) {
        const latest = await fetchParentNotifications({ unread_only: true, limit: 3 });
        const first = latest.items[0];
        if (first) {
          setToast(`${NOTIFICATION_META[first.kind]?.icon || "🔔"} ${first.title}`);
          window.setTimeout(() => setToast(null), 5000);
          showBrowserNotification(first.title, first.body || "");
        }
      }
      lastUnread.current = s.unread_notifications;
    } catch { /* 다음 주기에 재시도 */ }
  }, [loadKids]);

  useEffect(() => {
    loadKids();
    refreshSummary();
    fetchChildProfiles().then(setChildProfiles).catch(() => setChildProfiles([]));
    return startVisiblePolling(refreshSummary, 7000);
  }, [loadKids, refreshSummary]);

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
    if (!n.is_read) { await markParentNotificationsRead({ ids: [n.notification_id] }).catch(() => null); refreshSummary(); }
    const target = n.link || NOTIFICATION_META[n.kind]?.parent;
    const map = { children: "kids", notices: "feed", feed: "feed", pay: "pay" };
    if (map[target]) setTab(map[target]);
  };
  const readAll = async () => {
    await markParentNotificationsRead({ all: true }).catch(() => null);
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    refreshSummary();
  };

  const facility = summary?.facility || me.facility;
  const unread = summary?.unread_notifications || 0;
  const tabs = [["kids", "우리 아이"], ["pay", "결제"], ["feed", "커뮤니티"], ["info", "시설 정보"]];

  return (
    <>
      <header className="pp-head" style={{ position: "sticky" }}>
        <Brand to="/parentportal" sub={facility?.name} />
        <div className="right">
          <button className="btn ghost sm" onClick={onExit} title="다른 시설로">시설 전환</button>
          <button className="bell" onClick={openPanel} aria-label={`알림 ${unread}건`}>
            🔔{unread > 0 && <span className="dot">{unread > 99 ? "99+" : unread}</span>}
          </button>
          <HeaderMenu onLogout={onLogout} />
        </div>
        {panelOpen && (
          <div className="notif-panel" role="dialog" aria-label="알림">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <b>알림</b>
              {unread > 0 && <button className="btn ghost sm" onClick={readAll}>모두 읽음</button>}
            </div>
            {notifications.length === 0 ? <div className="muted" style={{ padding: 16 }}>알림이 없습니다.</div> : notifications.map((n) => (
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
      </header>
      <nav className="pp-tabs">
        {tabs.map(([k, v]) => <button key={k} className={`pp-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{v}</button>)}
      </nav>
      <main className="pp-body">
        {tab === "kids" && (kids === null ? <div className="fl-skeleton" style={{ height: 200 }} /> :
          <KidsTab kids={kids} onChanged={loadKids} onGoPay={() => setTab("pay")} onApply={() => setApplyOpen(true)} />)}
        {tab === "pay" && <Checkout hasChildren={(kids || []).length > 0} onLinkChild={() => setTab("kids")} />}
        {tab === "feed" && <Board mode="parent" api={PARENT_API} membership={summary?.membership} />}
        {tab === "info" && <FacilityInfo facility={facility} membership={summary?.membership} onChanged={() => { refreshSummary(); onReload(); }}
          onLeft={onExit} onApply={() => setApplyOpen(true)} />}
      </main>
      {applyOpen && facility && (
        <FacilityDetail facilityId={facility.facility_id} childrenList={childProfiles} inFacility onClose={() => setApplyOpen(false)}
          onApplied={() => setApplyOpen(false)} onEnter={() => null}
          onChildrenChanged={() => fetchChildProfiles().then(setChildProfiles).catch(() => null)} />
      )}
      {toast && <div className="toast-p" role="status" onClick={() => { setToast(null); openPanel(); }}>{toast}</div>}
    </>
  );
}

function TodayChips({ child }) {
  const today = child.today_classes || [];
  const scheduled = (child.class_items || []);
  if (!today.length) return <span className="badge gray no-dot">오늘 출결 기록 없음</span>;
  return (
    <div className="today-list">
      {today.map((t, i) => (
        <span key={i} className={`badge ${STATUS_TONE[t.status]} no-dot`}>
          {t.class_name ? `${t.class_name} ` : ""}{STATUS_LABEL[t.status]}{t.check_in_time ? ` ${t.check_in_time}` : ""}{t.check_out_time ? ` → ${t.check_out_time} 하원` : ""}
        </span>
      ))}
      {scheduled.length > today.length && <span className="muted">수업 {scheduled.length}개 중 {today.length}개 기록</span>}
    </div>
  );
}

function ChildAttendance({ child }) {
  const [att, setAtt] = useState(null);
  useEffect(() => {
    fetchParentAttendances(child.member_id, 30).then(setAtt).catch(() => setAtt({ summary: null, items: [] }));
  }, [child.member_id]);
  const byClass = useMemo(() => {
    const map = {};
    (att?.items || []).forEach((a) => {
      const k = a.class_name || "수업 무관";
      map[k] = map[k] || { total: 0, ok: 0 };
      map[k].total += 1;
      if (a.status !== "ABSENT") map[k].ok += 1;
    });
    return Object.entries(map);
  }, [att]);
  if (!att) return <div className="fl-skeleton" style={{ height: 80, marginTop: 10 }} />;
  const s = att.summary || {};
  const colorOf = (name) => child.class_items?.find((c) => c.name === name)?.color || "var(--primary)";
  return (
    <div>
      <div className="att-stats">
        <div><strong>{s.rate == null ? "-" : `${Math.round(s.rate)}%`}</strong><span>30일 출석률</span></div>
        <div><strong>{s.present ?? 0}</strong><span>출석</span></div>
        <div><strong>{s.late ?? 0}</strong><span>지각</span></div>
        <div><strong>{s.absent ?? 0}</strong><span>결석</span></div>
      </div>
      {byClass.map(([name, v]) => (
        <div key={name} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px 44px", gap: 8, alignItems: "center", fontSize: 12.5, marginBottom: 6 }}>
          <span>{name}</span>
          <div style={{ height: 7, background: "var(--surface-hover)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: `${(v.ok / v.total) * 100}%`, height: "100%", background: colorOf(name) }} />
          </div>
          <b style={{ textAlign: "right" }}>{Math.round((v.ok / v.total) * 100)}%</b>
        </div>
      ))}
      <div className="att-days" aria-label="최근 출결" style={{ marginTop: 8 }}>
        {att.items.slice(0, 40).reverse().map((a, i) => (
          <div key={`${a.date}-${i}`} className={`att-day ${a.status}`} title={`${a.date} ${a.class_name || ""} ${STATUS_LABEL[a.status] || a.status}`}>{a.date.slice(8)}</div>
        ))}
        {!att.items.length && <span className="muted">최근 30일 출결 기록이 없습니다.</span>}
      </div>
    </div>
  );
}

const SUB_LABEL = { NONE: "확인 전", SUBMITTED: "제출 완료", LATE: "지각 제출", MISSING: "미제출" };
function Assignments() {
  const [rows, setRows] = useState(null);
  useEffect(() => { fetchParentAssignments().then(setRows).catch(() => setRows([])); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="pp-card">
      <h3>과제</h3>
      {rows.map((a) => (
        <div className="inv-row" key={a.assignment_id} style={{ alignItems: "flex-start" }}>
          <div className="body">
            <div className="title">{a.title} <span className="badge gray no-dot">{a.class_name}</span></div>
            <div className="meta">기한 {a.due_date}{a.overdue ? " · 마감" : ""} · {a.children.map((c) => `${c.name}: ${SUB_LABEL[c.status] || c.status}`).join(" · ")}</div>
            {a.content && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{a.content}</div>}
          </div>
          {a.has_file && <a className="btn sm ghost" href={assignmentFileUrl(a.assignment_id, true)} target="_blank" rel="noreferrer">📎 자료</a>}
        </div>
      ))}
    </div>
  );
}

function KidsTab({ kids, onChanged, onGoPay, onApply }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const link = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await linkParentChild(name.trim(), phone.trim());
      setName(""); setPhone(""); setLinkOpen(false);
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
    <>
      {kids.length === 0 && (
        <div className="pp-hero">
          <h2>아직 연결된 자녀가 없어요</h2>
          <div className="muted" style={{ marginBottom: 12 }}>가입 신청이 승인되면 자동으로 연결됩니다. 이미 다니고 있다면 이름과 보호자 연락처로 연결하세요.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={onApply}>가입 신청</button>
            <button className="btn ghost" onClick={() => setLinkOpen(true)}>기존 학생 연결</button>
          </div>
        </div>
      )}
      {kids.map((child) => (
        <div className="kid" key={child.member_id}>
          <div className="kid-head">
            <div className="kid-ava">{child.name[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{child.name}</div>
              <div className="status-line" style={{ marginTop: 4 }}>
                {(child.class_items || []).map((c) => (
                  <span key={c.class_id} className="chip" style={{ cursor: "default" }}><span className="dot" style={{ background: c.color }} />{c.name}</span>
                ))}
                {!child.class_items?.length && <span className="muted">수강 중인 수업 없음</span>}
              </div>
            </div>
            <button className="btn ghost sm" onClick={() => unlink(child)}>연결 해제</button>
          </div>
          <TodayChips child={child} />
          {child.unpaid_amount > 0 && (
            <button type="button" className="btn" onClick={onGoPay} style={{ width: "100%", justifyContent: "center", marginTop: 12, background: "var(--danger)" }}>
              납부할 금액 {won(child.unpaid_amount)} — 결제하기
            </button>
          )}
          <ChildAttendance child={child} />
        </div>
      ))}
      {kids.length > 0 && <Assignments />}
      {kids.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={onApply}>+ 다른 자녀 가입 신청</button>
          <button className="btn ghost" onClick={() => setLinkOpen((v) => !v)}>기존 학생 연결</button>
        </div>
      )}
      {linkOpen && (
        <form className="pp-card" onSubmit={link}>
          <h3>기존 학생 연결</h3>
          <p className="sub">시설에 등록된 자녀 이름과 보호자 연락처가 일치해야 연결됩니다.</p>
          {error && <div className="fl-banner danger">{error}</div>}
          <div className="grid2">
            <div className="form-row"><label>자녀 이름</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="form-row"><label>보호자 연락처</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="010-0000-0000" required /></div>
          </div>
          <button className="btn" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>{busy ? "확인 중…" : "연결"}</button>
        </form>
      )}
    </>
  );
}

function FacilityInfo({ facility, membership, onChanged, onLeft, onApply }) {
  const [nickname, setNickname] = useState(membership?.nickname || "");
  const [msg, setMsg] = useState("");
  useEffect(() => { setNickname(membership?.nickname || ""); }, [membership?.nickname]);

  const saveNickname = async (e) => {
    e.preventDefault();
    try {
      await updateParentMembership(nickname.trim());
      setMsg("닉네임을 바꿨습니다.");
      onChanged();
    } catch (err) {
      setMsg(errorText(err, "바꾸지 못했습니다."));
    }
  };
  const leave = async () => {
    if (!window.confirm(`${facility.name} 에서 나갈까요? 자녀 연결과 커뮤니티 멤버십이 해제됩니다.`)) return;
    try { await leaveParentFacility(facility.facility_id); onLeft(); } catch (err) { setMsg(errorText(err, "나가지 못했습니다.")); }
  };

  return (
    <>
      <div className="pp-card">
        <h3>{facility?.name}</h3>
        <p className="sub">{[facility?.facility_type, facility?.branch, facility?.region].filter(Boolean).join(" · ")}</p>
        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          {facility?.phone && <div>☎ <a href={`tel:${facility.phone}`}>{facility.phone}</a></div>}
          {facility?.address && <div>📍 {facility.address}</div>}
        </div>
        <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={onApply}>수업·수강료 보기 / 가입 신청</button>
      </div>
      <form className="pp-card" onSubmit={saveNickname}>
        <h3>커뮤니티 닉네임</h3>
        <p className="sub">게시판 글·댓글에 표시되는 이름입니다.</p>
        {membership?.warnings > 0 && <div className="fl-banner warning">관리자 경고 {membership.warnings}회</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" style={{ flex: 1 }} value={nickname} onChange={(e) => setNickname(e.target.value)} minLength={2} maxLength={20} />
          <button className="btn" type="submit">저장</button>
        </div>
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
      </form>
      <div className="pp-card">
        <h3>시설 나가기</h3>
        <p className="sub">이 시설의 자녀 연결과 커뮤니티 멤버십을 해제합니다.</p>
        <button className="btn danger" onClick={leave}>나가기</button>
      </div>
    </>
  );
}

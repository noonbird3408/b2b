import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
  fetchMembers, createMember, updateMember, deleteMember, fetchClasses, extractStudentInfoFromImage,
  bulkCreateInvoices, notifyMemberParents, errorText, localToday, fetchApplications, approveApplication, rejectApplication,
} from "../api";
import { resizeImageFile } from "../utils/image";
import { STATUS_LABEL, STATUS_TONE, useDataRefresh, won } from "../utils/sync";
import MemberDetailDashboard from "./MemberDetailDashboard";

const errorMessage = (error, fallback) => errorText(error, fallback);
const today = () => localToday();

const STYLES = `
.mem-table{min-width:620px;}
.mem-table td{vertical-align:middle;}
.mem-table .member-cell .name,.mem-table .member-cell .sub{white-space:nowrap;}
.mem-classes{display:flex;flex-direction:column;gap:4px;min-width:180px;}
.mem-class{display:flex;align-items:center;gap:6px;font-size:12px;border:0;background:none;padding:0;text-align:left;color:var(--text);}
.mem-class .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.mem-class .nm{font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mem-class .rate{color:var(--text-3);font-size:11px;}
.mem-class .badge{font-size:10px;padding:1px 6px;}
.col-wide{display:none;}
@media(min-width:1500px){.col-wide{display:table-cell;}}
.app-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;display:grid;gap:10px;}
.app-card .head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.app-card .head h4{margin:0;font-size:16px;}
.app-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;}
.app-kv{display:grid;grid-template-columns:72px 1fr;gap:4px 10px;font-size:13px;}
.app-kv span:nth-child(odd){color:var(--text-3);}
.member-row-menu{position:absolute;right:0;z-index:10;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow);padding:4px;min-width:90px;display:flex;flex-direction:column;}
.member-row-menu button{background:none;border:0;padding:7px 12px;text-align:left;font-size:13px;border-radius:6px;color:var(--text);}
.member-row-menu button:hover{background:var(--surface-hover);}
@media(max-width:700px){.mem-hide-sm{display:none;}.app-grid{grid-template-columns:1fr;}}
`;

const ageToGrade = (age) => {
  if (age == null) return "";
  if (age >= 7 && age <= 12) return `초${age - 6}`;
  if (age >= 13 && age <= 15) return `중${age - 12}`;
  if (age >= 16 && age <= 18) return `고${age - 15}`;
  return "";
};

const formatPaymentDay = (dateStr) => (dateStr ? `매월 ${new Date(dateStr).getDate()}일` : "-");

const paymentBadge = (m) => {
  if (m.status === "WITHDRAWN") return { cls: "gray", label: "퇴원" };
  if (m.unpaid_count > 0) return { cls: "danger", label: `미납 ${won(m.unpaid_amount)}` };
  return { cls: "success", label: "완납" };
};

export default function Members() {
  const navigate = useNavigate();
  const { isOwner } = useOutletContext() || { isOwner: true };
  const [members, setMembers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [classFilter, setClassFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get("q") || "";
  const urlMemberId = searchParams.get("member_id") || searchParams.get("member");
  const tab = searchParams.get("tab") === "applications" ? "applications" : "list";
  const [q, setQ] = useState(urlQ);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkModal, setBulkModal] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showOcrModal, setShowOcrModal] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [applications, setApplications] = useState([]);

  const load = useCallback(async () => {
    try {
      const [memberRows, classRows] = await Promise.all([
        fetchMembers({ status: statusFilter || undefined, class_id: classFilter || undefined, q: urlQ || undefined }),
        fetchClasses().catch(() => []),
      ]);
      let rows = Array.isArray(memberRows) ? memberRows : [];
      if (gradeFilter) rows = rows.filter((m) => ageToGrade(m.age).startsWith(gradeFilter));
      setMembers(rows);
      setClasses(Array.isArray(classRows) ? classRows : []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "학생 목록을 불러오지 못했습니다."));
    } finally {
      setLoaded(true);
    }
  }, [statusFilter, classFilter, gradeFilter, urlQ]);

  const loadApplications = useCallback(() => {
    if (!isOwner) return;
    fetchApplications("").then(setApplications).catch(() => setApplications([]));
  }, [isOwner]);

  useEffect(() => { setQ(urlQ); }, [urlQ]);
  useEffect(() => { load(); setSelectedIds(new Set()); }, [load]);
  useEffect(loadApplications, [loadApplications]);
  useDataRefresh(() => { load(); loadApplications(); });

  // 알림·출석 화면에서 학생을 지정해 들어오면 상세 패널을 바로 엶 (퇴원생도 찾을 수 있도록 상태 필터 해제)
  useEffect(() => {
    if (!urlMemberId) return;
    if (loaded && !members.some((m) => String(m.member_id) === urlMemberId) && statusFilter) setStatusFilter("");
    else if (members.some((m) => String(m.member_id) === urlMemberId)) setSelectedId(Number(urlMemberId));
  }, [members, urlMemberId, loaded, statusFilter]);

  const selectedMember = members.find((m) => m.member_id === selectedId) || null;
  const pendingApps = applications.filter((a) => a.status === "PENDING");

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === "applications") params.set("tab", "applications"); else params.delete("tab");
    setSearchParams(params);
  };
  const closeDetail = () => {
    setSelectedId(null);
    if (urlMemberId) {
      const params = new URLSearchParams(searchParams);
      params.delete("member_id"); params.delete("member");
      setSearchParams(params, { replace: true });
    }
  };
  const applySearch = () => {
    const next = q.trim();
    const params = new URLSearchParams(searchParams);
    if (next) params.set("q", next); else params.delete("q");
    setSearchParams(params);
  };

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = members.length > 0 && members.every((m) => selectedIds.has(m.member_id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(members.map((m) => m.member_id)));
  const selectedMembers = members.filter((m) => selectedIds.has(m.member_id));

  const onDelete = async (id) => {
    if (!window.confirm("이 학생을 삭제할까요? 출결·수강 기록과 미납 청구서가 함께 삭제됩니다.\n(결제 기록이 있으면 삭제 대신 '퇴원'으로 바꿔 주세요.)")) return false;
    try {
      await deleteMember(id);
      load();
      return true;
    } catch (e) {
      alert(errorMessage(e, "학생을 삭제하지 못했습니다."));
      return false;
    }
  };

  const handleDownloadCSV = () => {
    if (!members.length) return alert("다운로드할 학생이 없습니다.");
    const headers = ["이름", "성별", "나이", "학년", "수강 수업", "등록일", "퇴원일", "보호자 연락처", "보호자 이름", "주소", "결제일", "상태"];
    const rows = members.map((m) => [
      m.name, m.gender === "M" ? "남" : "여", m.age, ageToGrade(m.age) || "-",
      (m.classes || []).map((c) => c.name).join(", ") || "미수강", m.enrollment_date, m.withdrawal_date || "-",
      m.mother_phone || m.father_phone || "-", m.mother_name || m.father_name || "-", m.address || "-",
      formatPaymentDay(m.payment_date), m.status === "ACTIVE" ? "재원" : "퇴원",
    ]);
    const csv = "﻿" + [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `학생명단_${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "ACTIVE");
    const todayRows = active.flatMap((m) => (m.classes || []).filter((c) => c.scheduled_today));
    return {
      total: members.length,
      unpaid: active.filter((m) => m.unpaid_count > 0).length,
      todayExpected: todayRows.length,
      todayDone: todayRows.filter((c) => c.status === "PRESENT" || c.status === "LATE").length,
      linked: members.filter((m) => m.parent_linked).length,
    };
  }, [members]);

  return (
    <>
      <style>{STYLES}</style>
      <h2 className="page-title">학생 관리</h2>
      <p className="page-subtitle">조회 {stats.total}명{urlQ ? ` · “${urlQ}” 검색 결과` : ""}</p>

      <div className="tabs">
        <button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")}>학생 목록</button>
        {isOwner && (
          <button className={tab === "applications" ? "active" : ""} onClick={() => setTab("applications")}>
            가입 신청{pendingApps.length ? <span className="count">{pendingApps.length}</span> : null}
          </button>
        )}
      </div>

      {error && <div className="fl-banner danger">{error}</div>}

      {tab === "applications" ? (
        <ApplicationsPanel applications={applications} classes={classes}
          onChanged={() => { loadApplications(); load(); }} />
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-card-head"><span className="stat-label">조회 학생</span></div>
              <div className="stat-value num">{stats.total}<span className="unit">명</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-card-head"><span className="stat-label">오늘 수업 출석</span></div>
              <div className="stat-value num primary">{stats.todayDone}<span className="unit">/ {stats.todayExpected}</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-card-head"><span className="stat-label">미납 학생</span></div>
              <div className="stat-value num danger">{stats.unpaid}<span className="unit">명</span></div>
            </div>
            <div className="stat-card">
              <div className="stat-card-head"><span className="stat-label">학부모 연결</span></div>
              <div className="stat-value num">{stats.linked}<span className="unit">명</span></div>
            </div>
          </div>

          <div className="toolbar">
            <div className="search-box" style={{ flex: "1 1 220px" }}>
              <input className="input" style={{ width: "100%" }} placeholder="이름·보호자·전화번호 검색" value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applySearch()} />
            </div>
            <select className="select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="수업">
              <option value="">전체 수업</option>
              {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
            </select>
            <select className="select" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} aria-label="학년">
              <option value="">전체 학년</option><option value="초">초등</option><option value="중">중등</option><option value="고">고등</option>
            </select>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="상태">
              <option value="ACTIVE">재원</option><option value="WITHDRAWN">퇴원</option><option value="">전체</option>
            </select>
            {isOwner && (
              <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                <button className="btn ghost" onClick={handleDownloadCSV}>⬇ 엑셀</button>
                <button className="btn ghost" onClick={() => setShowOcrModal(true)}>📸 사진으로 추가</button>
                <button className="btn" onClick={() => { setEditingMember(null); setShowModal(true); }}>+ 학생 추가</button>
              </div>
            )}
          </div>

          {selectedIds.size > 0 && isOwner && (
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 12, flexWrap: "wrap", background: "var(--primary-soft)" }}>
              <strong style={{ fontSize: 13 }}>{selectedIds.size}명 선택</strong>
              <button className="btn sm" onClick={() => setBulkModal("invoice")}>🧾 청구서 발행</button>
              <button className="btn sm ghost" onClick={() => setBulkModal("notify")}>🔔 학부모 알림</button>
              <button className="btn sm ghost ml-auto" onClick={() => setSelectedIds(new Set())}>선택 해제</button>
            </div>
          )}

          {!loaded ? <div className="fl-skeleton" style={{ height: 240 }} /> : members.length === 0 ? (
            <div className="empty">조회된 학생이 없습니다.</div>
          ) : (
            <div className="table-scroll" style={{ paddingBottom: 120 }}>
              <table className="mem-table">
                <thead>
                  <tr>
                    {isOwner && <th style={{ width: 36 }}><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="전체 선택" /></th>}
                    <th>이름</th>
                    <th>수강 수업 · 오늘 출결 · 30일 출석률</th>
                    <th>납부</th>
                    <th className="mem-hide-sm">등록일</th>
                    <th className="col-wide">퇴원일</th>
                    <th className="col-wide">보호자</th>
                    <th className="col-wide">연락처</th>
                    <th className="col-wide">주소</th>
                    {isOwner && <th style={{ width: 44 }} />}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, index) => {
                    const pb = paymentBadge(m);
                    const nearBottom = index >= members.length - 2 && members.length > 3;
                    return (
                      <tr key={m.member_id} className="row-click" onClick={() => setSelectedId(m.member_id)}
                        style={m.status === "WITHDRAWN" ? { color: "var(--text-3)" } : undefined}>
                        {isOwner && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.has(m.member_id)} onChange={() => toggleSelect(m.member_id)} aria-label={`${m.name} 선택`} />
                          </td>
                        )}
                        <td>
                          <div className="member-cell">
                            <div className="avatar" style={{ overflow: "hidden" }}>
                              {m.photo_url ? <img src={m.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : m.name?.[0]}
                            </div>
                            <div>
                              <div className="name">{m.name}{m.parent_linked && <span title="학부모 연결" style={{ marginLeft: 4 }}>🔗</span>}</div>
                              <div className="sub">{m.gender === "M" ? "남" : "여"} · {m.age}세{ageToGrade(m.age) ? ` (${ageToGrade(m.age)})` : ""}</div>
                            </div>
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(m.classes || []).length ? (
                            <div className="mem-classes">
                              {m.classes.map((c) => (
                                <button key={c.class_id} type="button" className="mem-class" title={`${c.name} 수업으로 이동`}
                                  onClick={() => navigate(`/classes?class_id=${c.class_id}`)}>
                                  <span className="dot" style={{ background: c.color }} />
                                  <span className="nm">{c.name}</span>
                                  {c.scheduled_today ? (
                                    <span className={`badge ${c.status ? STATUS_TONE[c.status] : "gray"} no-dot`}>{c.status ? STATUS_LABEL[c.status] : "미체크"}</span>
                                  ) : null}
                                  <span className="rate">{c.rate_30d == null ? "기록 없음" : `${Math.round(c.rate_30d)}%`}</span>
                                </button>
                              ))}
                            </div>
                          ) : <span className="muted">미수강</span>}
                        </td>
                        <td><span className={`badge ${pb.cls}`}>{pb.label}</span></td>
                        <td className="num mem-hide-sm">{m.enrollment_date}</td>
                        <td className="col-wide num">{m.withdrawal_date || "-"}</td>
                        <td className="col-wide">{m.mother_name || m.father_name || "-"}</td>
                        <td className="col-wide num">{m.mother_phone || m.father_phone || "-"}</td>
                        <td className="col-wide" style={{ maxWidth: 220, whiteSpace: "normal" }}>{m.address || "-"}</td>
                        {isOwner && (
                          <td style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                            <button className="btn ghost sm" aria-label="더보기" onClick={() => setActiveMenuId(activeMenuId === m.member_id ? null : m.member_id)}>⋯</button>
                            {activeMenuId === m.member_id && (
                              <>
                                <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setActiveMenuId(null)} />
                                <div className="member-row-menu" style={{ top: nearBottom ? "auto" : "100%", bottom: nearBottom ? "100%" : "auto" }}>
                                  <button onClick={() => { setEditingMember(m); setShowModal(true); setActiveMenuId(null); }}>수정</button>
                                  <button style={{ color: "var(--danger)" }} onClick={() => { setActiveMenuId(null); onDelete(m.member_id); }}>삭제</button>
                                </div>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showModal && (
        <MemberModal member={editingMember} onClose={() => { setShowModal(false); setEditingMember(null); }}
          onSaved={() => { setShowModal(false); setEditingMember(null); load(); }} />
      )}
      {showOcrModal && <OcrMemberModal onClose={() => setShowOcrModal(false)} onSaved={() => { setShowOcrModal(false); load(); }} />}
      {bulkModal === "invoice" && (
        <BulkInvoiceModal members={selectedMembers} onClose={() => setBulkModal(null)}
          onDone={() => { setBulkModal(null); setSelectedIds(new Set()); load(); }} />
      )}
      {bulkModal === "notify" && (
        <BulkNotifyModal members={selectedMembers} onClose={() => setBulkModal(null)}
          onDone={() => { setBulkModal(null); setSelectedIds(new Set()); }} />
      )}
      {selectedMember && (
        <MemberDetailDashboard member={selectedMember} readOnly={!isOwner} onClose={closeDetail} onUpdate={load}
          onEdit={() => { setEditingMember(selectedMember); setShowModal(true); }}
          onDelete={async () => { if (await onDelete(selectedMember.member_id)) closeDetail(); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// 가입 신청 심사 — 승인하면 서버가 학생(members)·수강·학부모 연결을 만듭니다
// ---------------------------------------------------------------------
const APP_STATUS = { PENDING: ["warning", "심사 대기"], APPROVED: ["success", "승인"], REJECTED: ["danger", "반려"], CANCELED: ["gray", "취소"] };

function ApplicationsPanel({ applications, classes, onChanged }) {
  const [filter, setFilter] = useState("PENDING");
  const [approving, setApproving] = useState(null);
  const rows = applications.filter((a) => (filter ? a.status === filter : true));

  const reject = async (a) => {
    const reason = window.prompt(`${a.child.name} 학생의 가입 신청을 반려합니다. 사유(학부모에게 전달):`, "");
    if (reason === null) return;
    try {
      await rejectApplication(a.application_id, reason);
      onChanged();
    } catch (e) {
      alert(errorText(e, "반려하지 못했습니다."));
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="segmented">
          {[["PENDING", "심사 대기"], ["APPROVED", "승인"], ["REJECTED", "반려"], ["", "전체"]].map(([v, l]) => (
            <button key={v || "all"} className={filter === v ? "active" : ""} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <div className="empty">{filter === "PENDING" ? "심사할 가입 신청이 없습니다." : "신청 내역이 없습니다."}</div> : (
        <div className="app-grid">
          {rows.map((a) => {
            const [tone, label] = APP_STATUS[a.status] || ["gray", a.status];
            return (
              <div className="app-card" key={a.application_id}>
                <div className="head">
                  <h4>{a.child.name}</h4>
                  <span className="muted">{a.child.gender === "M" ? "남" : "여"} · {a.child.age}세{a.child.school ? ` · ${a.child.school}` : ""}</span>
                  <span className={`badge ${tone} no-dot`} style={{ marginLeft: "auto" }}>{label}</span>
                </div>
                <div className="app-kv">
                  <span>보호자</span><span>{a.child.parent_name || "-"} ({a.child.relation}) {a.child.parent_phone}</span>
                  <span>신청 수업</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {a.classes.length ? a.classes.map((c) => <span key={c.class_id} className="badge gray no-dot">{c.name}</span>) : "선택 안 함"}
                  </span>
                  <span>예상 비용</span><span><b>{won(a.estimated_fee)}</b> / 월</span>
                  {a.child.address && <><span>주소</span><span>{a.child.address}</span></>}
                  {a.child.note && <><span>특이사항</span><span>{a.child.note}</span></>}
                  {a.message && <><span>메시지</span><span>{a.message}</span></>}
                  {a.reject_reason && <><span>반려 사유</span><span>{a.reject_reason}</span></>}
                  <span>신청일</span><span>{(a.created_at || "").slice(0, 16).replace("T", " ")}</span>
                </div>
                {a.status === "PENDING" && (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn danger sm" onClick={() => reject(a)}>반려</button>
                    <button className="btn sm" onClick={() => setApproving(a)}>승인하고 등록</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {approving && (
        <ApproveModal application={approving} classes={classes} onClose={() => setApproving(null)}
          onDone={() => { setApproving(null); onChanged(); }} />
      )}
    </>
  );
}

function ApproveModal({ application, classes, onClose, onDone }) {
  const [classIds, setClassIds] = useState(() => new Set(application.class_ids));
  const [enrollmentDate, setEnrollmentDate] = useState(today());
  const [createInvoice, setCreateInvoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toggle = (id) => setClassIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const estimate = classes.filter((c) => classIds.has(c.class_id)).reduce((sum, c) => sum + (c.fee || 0), 0);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await approveApplication(application.application_id, { class_ids: [...classIds], enrollment_date: enrollmentDate, create_invoice: createInvoice });
      onDone();
    } catch (e) {
      setErr(errorText(e, "승인하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{application.child.name} 학생 등록</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <div className="form-row">
          <label>수강 수업</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {classes.map((c) => (
              <button key={c.class_id} type="button" className={`chip${classIds.has(c.class_id) ? " active" : ""}`} onClick={() => toggle(c.class_id)}>
                <span className="dot" style={{ background: classIds.has(c.class_id) ? "#fff" : c.color }} />{c.name} · {won(c.fee)}
              </button>
            ))}
            {!classes.length && <span className="muted">등록된 수업이 없습니다.</span>}
          </div>
        </div>
        <div className="form-row"><label>등록일</label>
          <input type="date" className="input" value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} /></div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={createInvoice} onChange={(e) => setCreateInvoice(e.target.checked)} />
          첫 달 수강료 청구서 발행 ({won(estimate)}) — 학부모 포털에서 바로 결제
        </label>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? "등록 중…" : "승인"}</button>
        </div>
      </div>
    </div>
  );
}

function OcrMemberModal({ onClose, onSaved }) {
  const [step, setStep] = useState("upload");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "", gender: "", age: "",
    enrollment_date: today(), withdrawal_date: "", status: "ACTIVE", payment_date: today(),
    father_name: "", mother_name: "", father_phone: "", mother_phone: "", address: "",
    photo_url: "",
  });

  const updateOcrData = (k, v) => setFormData((f) => ({ ...f, [k]: v }));

  // 서류 사진은 인식(OCR)에만 쓰고 저장하지 않습니다 — 연락처·주소가 찍힌 서류가 프로필 사진으로 남지 않도록
  const [documentPreview, setDocumentPreview] = useState("");

  const processFile = async (file) => {
    setLoading(true);
    setError(null);
    setStep("processing");

    try {
      // 1. 서류 사진을 글자가 읽히는 크기(1600px)로 줄여 data URL 로 변환 (업로드 한도 4.5MB 대응)
      const base64Image = await resizeImageFile(file, "document");
      setDocumentPreview(base64Image);

      // 2. 서버(Gemini 프록시)를 호출하여 학생 정보 추출
      const parsedData = await extractStudentInfoFromImage(base64Image, "image/jpeg");

      setFormData(prev => ({ 
        ...prev, 
        name: parsedData.name !== undefined && parsedData.name !== "" ? parsedData.name : prev.name,
        age: parsedData.age !== undefined && parsedData.age !== "" ? parsedData.age : prev.age,
        gender: parsedData.gender !== undefined && parsedData.gender !== "" ? parsedData.gender : prev.gender,
        mother_phone: parsedData.mother_phone !== undefined && parsedData.mother_phone !== "" ? parsedData.mother_phone : prev.mother_phone,
        father_phone: parsedData.father_phone !== undefined && parsedData.father_phone !== "" ? parsedData.father_phone : prev.father_phone,
        address: parsedData.address !== undefined && parsedData.address !== "" ? parsedData.address : prev.address,
        enrollment_date: parsedData.enrollment_date || prev.enrollment_date,
        payment_date: parsedData.payment_date || prev.payment_date
      }));
      setStep("verify");

    } catch (err) {
      console.error("Gemini 인식 오류:", err);
      setError("사진에서 데이터를 추출하지 못했습니다. 다시 시도하거나 이미지를 확인해주세요.");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const submit = async () => {
    if (!formData.name || !formData.gender || !formData.age) {
       setError("이름, 성별, 나이는 필수 입력 항목입니다.");
       return;
    }
    try {
      await createMember({ ...formData, age: Number(formData.age) });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "학생 데이터 등록에 실패했습니다."));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>사진으로 학생 추가 (Gemini AI)</h3>
        {error && <div className="error-banner">{error}</div>}

        {step === "upload" && (
          <div 
            style={{
              border: `2px dashed ${isDragging ? "var(--primary)" : "var(--border-strong)"}`, 
              borderRadius: "8px",
              padding: "40px", 
              textAlign: "center", 
              backgroundColor: isDragging ? "var(--primary-soft)" : "var(--surface-hover)", 
              cursor: "pointer",
              transition: "all 0.2s ease"
            }} 
            onClick={() => document.getElementById("ocr-file-input").click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>✨</div>
            <p style={{ margin: "0 0 10px 0", color: "var(--text-2)", fontWeight: "500" }}>
              Gemini AI로 서류 사진을 분석합니다. 업로드하거나 드래그하세요.
            </p>
            <p style={{ margin: "0 0 16px 0", color: "var(--text-3)", fontSize: "13px" }}>
              (이름, 나이, 연락처, 주소가 포함된 가입 신청서 등)
            </p>
            <button className="btn ghost">이미지 선택</button>
            <input 
              id="ocr-file-input" 
              type="file" 
              accept="image/*" 
              style={{ display: "none" }} 
              onChange={handleImageUpload} 
            />
          </div>
        )}

        {step === "processing" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px", animation: "pulse 1.5s infinite" }}>🤖</div>
            <p style={{ marginBottom: "16px", fontWeight: "500", color: "var(--primary)" }}>
              Gemini AI가 문서를 분석하고 있습니다...
            </p>
            <p style={{ marginTop: "16px", color: "var(--text-3)", fontSize: "13px" }}>
              잠시만 기다려주세요. (일반적으로 3~5초 소요)
            </p>
          </div>
        )}

        {step === "verify" && (
          <div>
            <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--primary-soft)", borderRadius: "8px", fontSize: "13px", color: "var(--primary-text)" }}>
              ✅ 분석이 완료되었습니다. 추출된 정보를 확인하고 <strong>잘못된 부분이 있다면 직접 수정해주세요.</strong>
            </div>
            {documentPreview && (
              <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "16px", overflow: "hidden", background: "var(--surface-hover)" }}>
                  <img src={documentPreview} alt="인식한 서류" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ color: "var(--text-2)", fontSize: "13px" }}>
                  서류 사진은 인식에만 사용하고 저장하지 않습니다. 프로필 사진은 등록 후 학생 정보 수정에서 올릴 수 있습니다.
                </div>
              </div>
            )}

            <div className="form-row">
              <label>이름</label>
              <input className="input" value={formData.name} onChange={(e) => updateOcrData("name", e.target.value)} />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row">
                <label>성별</label>
                <select className="select" value={formData.gender} onChange={(e) => updateOcrData("gender", e.target.value)}>
                  <option value="">선택</option>
                  <option value="M">남</option>
                  <option value="F">여</option>
                </select>
              </div>
              <div className="form-row">
                <label>나이</label>
                <input type="number" className="input" value={formData.age} onChange={(e) => updateOcrData("age", e.target.value)} placeholder="예: 13" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row">
                <label>등록일</label>
                <input type="date" className="input" value={formData.enrollment_date} onChange={(e) => updateOcrData("enrollment_date", e.target.value)} />
              </div>
              <div className="form-row">
                <label>결제일</label>
                <input type="date" className="input" value={formData.payment_date} onChange={(e) => updateOcrData("payment_date", e.target.value)} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row">
                <label>부 연락처</label>
                <input className="input" value={formData.father_phone} onChange={(e) => updateOcrData("father_phone", e.target.value)} />
              </div>
              <div className="form-row">
                <label>모 연락처</label>
                <input className="input" value={formData.mother_phone} onChange={(e) => updateOcrData("mother_phone", e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <label>주소</label>
              <input className="input" value={formData.address} onChange={(e) => updateOcrData("address", e.target.value)} />
            </div>

            <div className="modal-actions" style={{ marginTop: "24px" }}>
              <button className="btn ghost" onClick={() => setStep("upload")}>다시 업로드</button>
              <button className="btn" onClick={submit} disabled={!formData.name || !formData.gender || !formData.age}>
                수정 완료 및 등록
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function MemberModal({ onClose, onSaved, member }) {
  const isEdit = !!member; 

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const [form, setForm] = useState({
    name: "", gender: "M", age: 10, photo_url: "",
    enrollment_date: today(), withdrawal_date: "",
    status: "ACTIVE", payment_date: today(),
    father_name: "", mother_name: "",
    father_phone: "", mother_phone: "", address: "", 
  });

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (member) {
      setForm({
        name: member.name || "", gender: member.gender || "M", age: member.age || 10,
        photo_url: member.photo_url || "",
        enrollment_date: member.enrollment_date || today(), withdrawal_date: member.withdrawal_date || "",
        status: member.status || "ACTIVE", payment_date: member.payment_date || today(),
        father_name: member.father_name || "", mother_name: member.mother_name || "",
        father_phone: member.father_phone || "", mother_phone: member.mother_phone || "", address: member.address || "", 
      });
    }
  }, [member]);

  const submit = async () => {
    setSubmitting(true); setErr(null);
    try {
      if (isEdit) await updateMember(member.member_id, { ...form, age: Number(form.age) });
      else await createMember({ ...form, age: Number(form.age) });
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, "저장에 실패했습니다."));
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? "학생 정보 수정" : "신규 학생 등록"}</h3>
        {err && <div className="error-banner">{err}</div>}

        
        <div className="form-row" style={{ marginBottom: "20px" }}>
          <label>학생 프로필 사진</label>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "4px" }}>
            <div className="avatar" style={{ width: "60px", height: "60px", borderRadius: "50%", overflow: "hidden", background: "var(--surface-hover)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", fontSize: "20px" }}>
              {form.photo_url ? (
                <img src={form.photo_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="미리보기" />
              ) : (
                form.name?.[0] || "?"
              )}
            </div>
            <input 
              type="file" 
              accept="image/*"
              style={{ fontSize: "13px" }}
              onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                  update("photo_url", await resizeImageFile(file, "profile"));   // 512px 로 줄여 저장
                } catch (error) {
                  setErr(error.message);
                }
              }}
            />
          </div>
        </div>

        <div className="form-row">
          <label>이름</label>
          <input className="input" value={form.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>성별</label>
            <select className="select" value={form.gender} onChange={(e) => update("gender", e.target.value)}>
              <option value="M">남</option><option value="F">여</option>
            </select>
          </div>
          <div className="form-row">
            <label>나이</label>
            <input type="number" className="input" value={form.age} onChange={(e) => update("age", e.target.value)} />
          </div>
        </div>

        {isEdit && (
          <div style={{ margin: "12px 0", padding: "12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "600", fontSize: "13px", textAlign: "center" }}>
              재원 상태
            </label>
            <div className="segmented" style={{ display: "flex" }}>
              <button type="button" style={{ flex: 1 }} className={form.status !== "WITHDRAWN" ? "active" : ""}
                onClick={() => { update("status", "ACTIVE"); update("withdrawal_date", ""); }}>재원</button>
              <button type="button" style={{ flex: 1 }} className={form.status === "WITHDRAWN" ? "active" : ""}
                onClick={() => { update("status", "WITHDRAWN"); update("withdrawal_date", form.withdrawal_date || today()); }}>퇴원</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8, textAlign: "center" }}>
              {member?.unpaid_count > 0
                ? `미납 청구서 ${member.unpaid_count}건 (${Number(member.unpaid_amount).toLocaleString()}원) — 납부 처리는 ‘수납·청구’ 화면에서 합니다.`
                : "납부 상태는 청구서 기준으로 자동 계산됩니다 (‘수납·청구’ 화면)."}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>상태</label>
            <select className="select" value={form.status} onChange={(e) => update("status", e.target.value)}>
              <option value="ACTIVE">활동중</option><option value="WITHDRAWN">퇴원</option>
            </select>
          </div>
          <div className="form-row">
            <label>퇴원일</label>
            <input type="date" className="input" value={form.withdrawal_date} onChange={(e) => update("withdrawal_date", e.target.value)} disabled={form.status !== "WITHDRAWN"} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>등록일</label>
            <input type="date" className="input" value={form.enrollment_date} onChange={(e) => update("enrollment_date", e.target.value)} />
          </div>
          <div className="form-row">
            <label>결제일</label>
            <input type="date" className="input" value={form.payment_date} onChange={(e) => update("payment_date", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>부 이름</label>
            <input className="input" value={form.father_name} onChange={(e) => update("father_name", e.target.value)} />
          </div>
          <div className="form-row">
            <label>부 연락처</label>
            <input className="input" value={form.father_phone} onChange={(e) => update("father_phone", e.target.value)} />
          </div>
          <div className="form-row">
            <label>모 이름</label>
            <input className="input" value={form.mother_name} onChange={(e) => update("mother_name", e.target.value)} />
          </div>
          <div className="form-row">
            <label>모 연락처</label>
            <input className="input" value={form.mother_phone} onChange={(e) => update("mother_phone", e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label>주소</label>
          <input className="input" value={form.address} onChange={(e) => update("address", e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={submitting}>취소</button>
          <button className="btn" onClick={submit} disabled={submitting || !form.name}>
            {submitting ? "저장 중..." : isEdit ? "수정 완료" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// v8.1 선택 학생 일괄 작업
// ---------------------------------------------------------------------
function BulkInvoiceModal({ members, onClose, onDone }) {
  const month = new Date().getMonth() + 1;
  const [form, setForm] = useState({ item_name: `${month}월 수강료`, amount: "", due_date: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const active = members.filter((m) => m.status === "ACTIVE");

  const submit = async () => {
    if (!form.item_name.trim()) return setErr("청구 항목을 입력하세요.");
    setBusy(true); setErr(null);
    try {
      const result = await bulkCreateInvoices({
        member_ids: active.map((m) => m.member_id), item_name: form.item_name.trim(),
        amount: form.amount ? Number(form.amount) : null, due_date: form.due_date || null,
      });
      alert(`청구서 ${result.created}건 · ${result.total_amount.toLocaleString()}원 발행` +
        (result.skipped_existing ? `\n같은 항목의 미납 청구서가 있어 건너뜀 ${result.skipped_existing}명` : "") +
        (result.skipped_no_fee ? `\n수강료가 설정되지 않아 건너뜀 ${result.skipped_no_fee}명 (설정 → 결제 정보)` : "") +
        "\n학부모 포털에 청구서 알림이 갔습니다.");
      onDone();
    } catch (e) {
      setErr(errorText(e, "청구서를 발행하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3>청구서 일괄 발행</h3>
        <p className="meta" style={{ marginBottom: 12 }}>
          재원생 {active.length}명에게 발행합니다{members.length !== active.length ? ` (퇴원생 ${members.length - active.length}명 제외)` : ""}.
          금액을 비우면 설정의 반별 수강료(없으면 기본 수강료)로 계산합니다.
        </p>
        <div className="form-row"><label>청구 항목 *</label>
          <input className="input" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></div>
        <div className="form-row"><label>금액 (원, 비우면 자동)</label>
          <input className="input" type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="자동 계산" /></div>
        <div className="form-row"><label>납부 기한</label>
          <input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
        {err && <div className="error-banner">{err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={submit} disabled={busy || active.length === 0}>{busy ? "발행 중…" : `${active.length}명 발행`}</button>
        </div>
      </div>
    </div>
  );
}

function BulkNotifyModal({ members, onClose, onDone }) {
  const [form, setForm] = useState({ title: "안내", message: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!form.message.trim()) return setErr("보낼 내용을 입력하세요.");
    setBusy(true); setErr(null);
    let sent = 0, noParent = 0;
    try {
      for (const m of members) {
        const result = await notifyMemberParents(m.member_id, { title: form.title, message: form.message, kind: "NOTICE" });
        if (result.sent) sent += result.sent; else noParent += 1;
      }
      alert(`학부모 ${sent}명에게 앱 알림을 보냈습니다.${noParent ? `\n학부모 계정이 연결되지 않은 학생 ${noParent}명은 보내지 못했습니다.` : ""}`);
      onDone();
    } catch (e) {
      setErr(errorText(e, "알림을 보내지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3>학부모 알림 보내기</h3>
        <p className="meta" style={{ marginBottom: 12 }}>선택한 {members.length}명의 학부모 포털에 알림을 보냅니다. (문자·카카오톡이 아닌 앱 내 알림)</p>
        <div className="form-row"><label>제목</label>
          <input className="input" maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="form-row"><label>내용 *</label>
          <textarea maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="예: 내일은 승급 심사로 수업 시간이 30분 앞당겨집니다." /></div>
        {err && <div className="error-banner">{err}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? "보내는 중…" : "보내기"}</button>
        </div>
      </div>
    </div>
  );
}

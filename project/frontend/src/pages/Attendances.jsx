import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  bulkAttendance, checkoutAttendance, deleteAttendance, errorText, fetchAdminSummary, fetchAttendances, fetchClasses, fetchMembers,
  localToday, markAttendance,
} from "../api";
import { STATUS_LABEL, useDataRefresh } from "../utils/sync";

const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

const STYLES = `
.period-bar{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin;}
.period{flex:0 0 auto;min-width:150px;text-align:left;border:1px solid var(--border);background:var(--surface);border-radius:12px;padding:10px 12px;color:var(--text);position:relative;overflow:hidden;}
.period .p{font-size:11px;color:var(--text-3);font-weight:700;}
.period .n{font-weight:700;font-size:14px;margin:2px 0;}
.period .t{font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums;}
.period .bar{position:absolute;left:0;top:0;bottom:0;width:4px;}
.period.on{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft);}
.period .now{position:absolute;top:8px;right:8px;font-size:10px;font-weight:700;color:var(--success-text);background:var(--success-soft);padding:1px 6px;border-radius:99px;}
.att-card.clickable{cursor:pointer;}
.att-card.clickable:hover{border-color:var(--border-strong);box-shadow:var(--shadow-sm);}
.att-date{display:flex;gap:6px;align-items:center;}
.att-bell{font-size:12px;line-height:1;flex-shrink:0;}
.att-bell.off{opacity:.45;filter:grayscale(1);}
.att-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;max-width:min(520px,calc(100vw - 32px));
  background:var(--text);color:var(--surface);padding:11px 16px;border-radius:12px;font-size:13.5px;box-shadow:var(--shadow);}
.att-toast.warn{background:var(--warning-soft);color:var(--warning-text);border:1px solid var(--warning);}
`;

const ACTION_LABEL = { PRESENT: "출석", LATE: "지각", ABSENT: "결석" };

/** "14:00" + 분 → "14:10" */
const addMinutes = (hhmm, minutes) => {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const ageToGrade = (age) => {
  if (age == null) return "";
  if (age >= 7 && age <= 12) return `초${age - 6}`;
  if (age >= 13 && age <= 15) return `중${age - 12}`;
  if (age >= 16 && age <= 18) return `고${age - 15}`;
  return "";
};

/** 해당 날짜에 열리는 수업 시간 (운영 기간 + 요일 기준) */
const sessionsOn = (cls, dateStr) => {
  if (!cls || (cls.start_date && dateStr < cls.start_date) || (cls.end_date && dateStr > cls.end_date)) return [];
  const code = WEEKDAY_CODES[new Date(`${dateStr}T00:00:00`).getDay()];
  return (cls.schedules || []).filter((s) => s.day === code || s.day === "DAILY");
};

const shiftDate = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Attendances() {
  const navigate = useNavigate();
  const [targetDate, setTargetDate] = useState(localToday());
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [members, setMembers] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [query, setQuery] = useState("");
  const [makeup, setMakeup] = useState(false);     // 보강: 이날 시간표에 없는 수업을 직접 고른 경우
  const [grace, setGrace] = useState(10);          // 지각 기준(분) — 설정 → 기관 정보
  const [toast, setToast] = useState(null);         // v10: 학부모 알림 결과 안내
  const toastTimer = useRef(null);

  // v10: 키오스크 대신 이 화면에서 출석을 누르면 학부모에게 즉시 알림 → 결과를 바로 보여 줌
  const showToast = useCallback((text, tone = "") => {
    setToast({ text, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => {
    fetchAdminSummary().then((s) => setGrace(Number(s?.brand?.lateGraceMinutes ?? 10))).catch(() => null);
  }, []);

  const loadClasses = useCallback(() => fetchClasses()
    .then((data) => setClasses(Array.isArray(data) ? data : []))
    .catch((e) => setError(errorText(e, "수업 목록을 불러오지 못했습니다."))), []);
  useEffect(() => { loadClasses(); }, [loadClasses]);

  const isToday = targetDate === localToday();
  // 이날 열리는 수업을 시작 시간 순으로 '교시'로 표시
  const periods = useMemo(() => classes
    .flatMap((c) => sessionsOn(c, targetDate).map((s) => ({ cls: c, start: s.start || "", end: s.end || "" })))
    .sort((a, b) => a.start.localeCompare(b.start) || a.cls.name.localeCompare(b.cls.name)), [classes, targetDate]);

  const nowHHMM = (() => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();

  // 날짜·수업이 바뀌면: 지금 진행 중(또는 다음) 교시 → 첫 교시 순으로 자동 선택
  useEffect(() => { setMakeup(false); }, [targetDate]);
  useEffect(() => {
    if (makeup) return;
    if (selectedClassId && periods.some((p) => p.cls.class_id === selectedClassId)) return;
    if (!periods.length) { setSelectedClassId(null); return; }
    const current = isToday ? periods.find((p) => p.end >= nowHHMM) : null;
    setSelectedClassId((current || periods[0]).cls.class_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, isToday, makeup]);

  const load = useCallback(() => {
    if (!selectedClassId) { setMembers([]); setRows([]); return Promise.resolve(); }
    return Promise.all([
      fetchMembers({ status: "ACTIVE", class_id: selectedClassId }),
      fetchAttendances({ target_date: targetDate, class_id: selectedClassId }),
    ])
      .then(([m, a]) => { setMembers(m); setRows(a); setError(null); })
      .catch((e) => setError(errorText(e, "출결 정보를 불러오지 못했습니다.")));
  }, [selectedClassId, targetDate]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(() => { loadClasses(); load(); });

  const attMap = useMemo(() => Object.fromEntries(rows.map((a) => [a.member_id, a])), [rows]);
  const visibleMembers = useMemo(() => {
    const q = query.trim();
    return q ? members.filter((m) => m.name.includes(q)) : members;
  }, [members, query]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, NONE: 0, OUT: 0 };
    members.forEach((m) => {
      const a = attMap[m.member_id];
      if (a) c[a.status] = (c[a.status] || 0) + 1; else c.NONE += 1;
      if (a?.check_out_time) c.OUT += 1;
    });
    return c;
  }, [members, attMap]);
  const checked = members.length - counts.NONE;
  const selectedClass = classes.find((c) => c.class_id === selectedClassId);
  const selectedPeriod = periods.find((p) => p.cls.class_id === selectedClassId);
  const weekday = DAY_KO[new Date(`${targetDate}T00:00:00`).getDay()];
  const lateFrom = selectedPeriod?.start ? addMinutes(selectedPeriod.start, grace) : null;
  const pastLate = isToday && lateFrom && nowHHMM > lateFrom && nowHHMM <= (selectedPeriod?.end || "23:59");
  const linkedCount = members.filter((m) => m.parent_linked).length;

  const setStatus = async (member, status) => {
    if (pendingId) return;
    setPendingId(member.member_id);
    try {
      const existing = attMap[member.member_id];
      if (existing && existing.status === status) {
        await deleteAttendance(existing.attendance_id);   // 같은 버튼 = 취소
        showToast(`${member.name} 학생 ${ACTION_LABEL[status]} 기록을 취소했습니다.`);
      } else {
        const saved = await markAttendance({ member_id: member.member_id, attendance_date: targetDate, status, class_id: selectedClassId });
        if (!isToday) showToast(`${targetDate} ${member.name} 학생 ${ACTION_LABEL[status]}(으)로 수정했습니다. 지난 날짜는 학부모 알림을 보내지 않습니다.`);
        else if (saved.parent_notified > 0) showToast(`🔔 ${member.name} 학생 ${ACTION_LABEL[status]} — 학부모 ${saved.parent_notified}명에게 알림을 보냈습니다.`);
        else if (!saved.parent_linked) showToast(`${member.name} 학생은 학부모 계정이 연결되지 않아 알림을 보내지 못했습니다. (학부모 포털에서 자녀 연결 필요)`, "warn");
        else showToast(`${member.name} 학생 ${ACTION_LABEL[status]} 저장`);
      }
      await load();
    } catch (e) {
      alert(errorText(e));
    } finally {
      setPendingId(null);
    }
  };

  const handleCheckout = async (member) => {
    const existing = attMap[member.member_id];
    if (!existing || pendingId) return;
    setPendingId(member.member_id);
    try {
      const saved = await checkoutAttendance(existing.attendance_id);
      showToast(saved.parent_notified > 0 ? `🏠 ${member.name} 학생 하원 — 학부모 ${saved.parent_notified}명에게 알림을 보냈습니다.`
        : `${member.name} 학생 하원 처리 (연결된 학부모 없음)`, saved.parent_notified > 0 ? "" : "warn");
      await load();
    } catch (e) {
      alert(errorText(e));
    } finally {
      setPendingId(null);
    }
  };

  const handleBulk = async (status) => {
    const unchecked = members.filter((m) => !attMap[m.member_id]);
    if (!unchecked.length) return alert("미체크 학생이 없습니다.");
    const label = status === "PRESENT" ? "출석" : "결석";
    if (!window.confirm(`${selectedClass?.name} 미체크 ${unchecked.length}명을 ${label} 처리할까요?`)) return;
    setPendingId("ALL");
    try {
      const res = await bulkAttendance({ attendance_date: targetDate, member_ids: unchecked.map((m) => m.member_id), status,
        only_unchecked: true, class_id: selectedClassId });
      showToast(`${res.changed}명 ${label} 처리${res.parent_notified ? ` · 학부모 ${res.parent_notified}명에게 알림` : ""}`);
      await load();
    } catch (e) {
      alert(errorText(e, "일괄 처리하지 못했습니다."));
    } finally {
      setPendingId(null);
    }
  };

  // 학생 카드 클릭 → 학생 관리(상세). 출석·지각·결석·하원 버튼은 제외
  const openMember = (m) => navigate(`/members?member_id=${m.member_id}`);

  return (
    <>
      <style>{STYLES}</style>
      <h2 className="page-title">출석 체크</h2>
      <p className="page-subtitle">{targetDate} ({weekday}){isToday ? " · 오늘" : ""}</p>
      {error && <div className="fl-banner danger">{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="att-date">
            <button className="btn ghost sm" onClick={() => setTargetDate((d) => shiftDate(d, -1))} aria-label="전날">‹</button>
            <input type="date" className="input" style={{ minWidth: 0 }} value={targetDate} max={localToday()}
              onChange={(e) => setTargetDate(e.target.value || localToday())} />
            <button className="btn ghost sm" onClick={() => setTargetDate((d) => shiftDate(d, 1))} disabled={isToday} aria-label="다음날">›</button>
            {!isToday && <button className="btn ghost sm" onClick={() => setTargetDate(localToday())}>오늘</button>}
          </div>
          {classes.length > 0 && (
            <select className="select ml-auto" value={periods.some((p) => p.cls.class_id === selectedClassId) ? "" : selectedClassId || ""}
              onChange={(e) => { if (e.target.value) { setMakeup(true); setSelectedClassId(Number(e.target.value)); } }} aria-label="다른 수업(보강)">
              <option value="">다른 수업(보강) 선택</option>
              {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {periods.length === 0 ? (
          <div className="muted" style={{ padding: "6px 0" }}>{weekday}요일에 예정된 수업이 없습니다. 보강은 오른쪽에서 수업을 고르세요.</div>
        ) : (
          <div className="period-bar" role="tablist" aria-label="교시">
            {periods.map((p, i) => {
              const live = isToday && p.start <= nowHHMM && nowHHMM <= p.end;
              return (
                <button key={`${p.cls.class_id}-${p.start}`} role="tab" aria-selected={selectedClassId === p.cls.class_id}
                  className={`period${selectedClassId === p.cls.class_id ? " on" : ""}`} onClick={() => { setMakeup(false); setSelectedClassId(p.cls.class_id); }}>
                  <span className="bar" style={{ background: p.cls.color }} />
                  {live && <span className="now">진행 중</span>}
                  <div className="p">{i + 1}교시</div>
                  <div className="n">{p.cls.name}</div>
                  <div className="t">{p.start}~{p.end}</div>
                </button>
              );
            })}
          </div>
        )}

        {selectedClass && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ marginRight: 6 }}>{selectedClass.name}</strong>
              {selectedPeriod ? <span className="muted">{selectedPeriod.start}~{selectedPeriod.end}</span> : <span className="badge warning no-dot">보강</span>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className="badge success no-dot">출석 {counts.PRESENT}</span>
                <span className="badge warning no-dot">지각 {counts.LATE}</span>
                <span className="badge danger no-dot">결석 {counts.ABSENT}</span>
                <span className="badge gray no-dot">미체크 {counts.NONE}</span>
                {isToday && <span className="badge primary no-dot">하원 {counts.OUT}</span>}
              </span>
            </div>
            <div className="progress"><div className="progress-fill" style={{ width: `${members.length ? (checked / members.length) * 100 : 0}%` }} /></div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>🔔 출석·지각·결석·하원을 누르면 학부모에게 바로 알림 (학부모 연결 {linkedCount}/{members.length}명)</span>
              {pastLate && <span style={{ color: "var(--warning-text)", fontWeight: 600 }}>⏰ 지각 기준({lateFrom}) 지남 — 지금 오는 학생은 '지각'으로 체크하세요</span>}
            </div>
          </div>
        )}
      </div>

      {selectedClass && (
        <>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <div className="search-box" style={{ flex: "1 1 200px" }}>
              <input className="input" style={{ width: "100%" }} placeholder="이름으로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {visibleMembers.length === 0 ? (
            <div className="empty">{members.length === 0 ? "이 수업의 재원 학생이 없습니다." : "검색 결과가 없습니다."}</div>
          ) : (
            <div className="att-grid">
              {visibleMembers.map((m) => {
                const cur = attMap[m.member_id];
                const status = cur?.status;
                const tone = status === "PRESENT" ? "present" : status === "ABSENT" ? "absent" : status === "LATE" ? "late" : "";
                const busy = pendingId === m.member_id || pendingId === "ALL";
                return (
                  <div key={m.member_id} className={`att-card clickable ${tone}`} role="button" tabIndex={0}
                    onClick={() => openMember(m)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openMember(m)}
                    aria-label={`${m.name} 학생 정보 보기`}>
                    <div className="att-card-head">
                      <div className="avatar" style={{ overflow: "hidden" }}>
                        {m.photo_url ? <img src={m.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : m.name?.[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="name" style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                          {m.name}
                          <span className={`att-bell${m.parent_linked ? "" : " off"}`}
                            title={m.parent_linked ? "학부모 알림 받음" : "학부모 계정 미연결 — 알림을 받을 수 없음"}>{m.parent_linked ? "🔔" : "🔕"}</span>
                        </div>
                        <div className="sub">
                          {m.gender === "M" ? "남" : "여"}{ageToGrade(m.age) && ` · ${ageToGrade(m.age)}`}
                          {cur?.check_in_time && ` · ${cur.check_in_time.slice(0, 5)}`}
                          {cur?.check_out_time && ` → ${cur.check_out_time.slice(0, 5)}`}
                        </div>
                      </div>
                      {m.unpaid_amount > 0 && <span className="badge danger no-dot" style={{ fontSize: 10 }}>미납</span>}
                    </div>
                    <div className="att-card-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      {["PRESENT", "LATE", "ABSENT"].map((s) => {
                        const active = status === s;
                        const cn = s === "PRESENT" ? "present" : s === "ABSENT" ? "absent" : "late";
                        return (
                          <button key={s} className={`att-btn ${active ? `active ${cn}` : ""}`} onClick={() => setStatus(m, s)} disabled={busy}
                            title={active ? "한 번 더 누르면 취소" : undefined}>{STATUS_LABEL[s]}</button>
                        );
                      })}
                      {isToday && (status === "PRESENT" || status === "LATE") && (
                        <button className="att-btn" onClick={() => handleCheckout(m)} disabled={busy || Boolean(cur?.check_out_time)}>
                          {cur?.check_out_time ? "하원✓" : "하원"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="card" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: 14 }}>
            <span className="muted">자동 저장 · 미체크 {counts.NONE}명</span>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => handleBulk("PRESENT")} disabled={pendingId === "ALL" || !counts.NONE}>미체크 전원 출석</button>
            <button className="btn" onClick={() => handleBulk("ABSENT")} disabled={pendingId === "ALL" || !counts.NONE}>마감 (미체크 → 결석)</button>
          </div>
        </>
      )}
      {toast && <div className={`att-toast ${toast.tone}`} role="status" aria-live="polite">{toast.text}</div>}
    </>
  );
}

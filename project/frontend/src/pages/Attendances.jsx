import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  bulkAttendance, checkoutAttendance, deleteAttendance, errorText, fetchAttendances, fetchClasses, fetchMembers,
  localToday, markAttendance,
} from "../api";

const STATUS_LABEL = { PRESENT: "출석", ABSENT: "결석", LATE: "지각" };
const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_KO = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일", DAILY: "매일" };

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

export default function Attendances() {
  // [FIX] 기존 new Date().toISOString() 은 UTC 라 한국 시간 오전 9시 전에는 '어제'로 표시됨
  const [targetDate, setTargetDate] = useState(localToday());
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("ALL");
  const [members, setMembers] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchClasses()
      .then((data) => setClasses(Array.isArray(data) ? data : []))
      .catch((e) => setError(errorText(e, "수업 목록을 불러오지 못했습니다.")));
  }, []);

  const load = useCallback(() => {
    const memParams = { status: "ACTIVE" };
    if (selectedClassId !== "ALL") memParams.class_id = selectedClassId;
    return Promise.all([fetchMembers(memParams), fetchAttendances({ target_date: targetDate })])
      .then(([m, a]) => { setMembers(m); setRows(a); setError(null); })
      .catch((e) => setError(errorText(e, "출결 정보를 불러오지 못했습니다.")));
  }, [selectedClassId, targetDate]);

  useEffect(() => { load(); }, [load]);

  const attMap = useMemo(() => {
    const map = {};
    rows.forEach((a) => { map[a.member_id] = a; });
    return map;
  }, [rows]);

  const visibleMembers = useMemo(() => {
    const q = query.trim();
    return q ? members.filter((m) => m.name.includes(q)) : members;
  }, [members, query]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, NONE: 0, OUT: 0 };
    members.forEach((m) => {
      const a = attMap[m.member_id];
      if (a) c[a.status] = (c[a.status] || 0) + 1; else c.NONE++;
      if (a?.check_out_time) c.OUT++;
    });
    return c;
  }, [members, attMap]);

  const totalChecked = members.length - counts.NONE;
  const progress = members.length === 0 ? 0 : (totalChecked / members.length) * 100;
  const isToday = targetDate === localToday();

  const selectedClass = classes.find((c) => c.class_id === selectedClassId);
  const selectedClassName = selectedClassId === "ALL" ? "전체 회원" : selectedClass?.name || "소속 반";

  // 그날 열리는 수업 (선택한 반 또는 전체)
  const todaysSessions = useMemo(() => {
    const list = selectedClassId === "ALL" ? classes : classes.filter((c) => c.class_id === selectedClassId);
    return list.flatMap((c) => sessionsOn(c, targetDate).map((s) => ({ name: c.name, ...s })))
      .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  }, [classes, selectedClassId, targetDate]);

  const setStatus = async (member, status) => {
    if (pendingId) return;
    setPendingId(member.member_id);
    try {
      const existing = attMap[member.member_id];
      if (existing && existing.status === status) {
        await deleteAttendance(existing.attendance_id);   // 같은 버튼을 다시 누르면 취소
      } else {
        await markAttendance({ member_id: member.member_id, attendance_date: targetDate, status });
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
      await checkoutAttendance(existing.attendance_id);
      await load();
    } catch (e) {
      alert(errorText(e));
    } finally {
      setPendingId(null);
    }
  };

  // 미체크 전원 출석 / 출석 마감(결석) — 서버에 한 번에 요청
  const handleBulk = async (status) => {
    const unchecked = members.filter((m) => !attMap[m.member_id]);
    if (unchecked.length === 0) return alert("미체크 학생이 없습니다.");
    const label = status === "PRESENT" ? "출석" : "결석(마감)";
    if (!window.confirm(`${selectedClassName} 미체크 ${unchecked.length}명을 ${label} 처리할까요?${status === "ABSENT" && isToday ? "\n학부모 포털에 결석 알림이 갑니다." : ""}`)) return;
    setPendingId("ALL");
    try {
      const result = await bulkAttendance({
        attendance_date: targetDate, member_ids: unchecked.map((m) => m.member_id), status, only_unchecked: true,
      });
      await load();
      if (result.skipped) alert(`${result.changed}명 처리, ${result.skipped}명은 이미 체크되어 건너뛰었습니다.`);
    } catch (e) {
      alert(errorText(e, "일괄 처리 중 오류가 발생했습니다."));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      <h2 className="page-title">출석 체크</h2>
      <p className="page-subtitle">
        {selectedClassName} · {targetDate}{isToday ? " (오늘)" : ""} · 출석·지각·결석·하원 처리 시 학부모 포털로 알림이 갑니다
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 4 }}>날짜</label>
            <input type="date" className="input" value={targetDate} max={localToday()}
                   onChange={(e) => setTargetDate(e.target.value || localToday())} />
          </div>

          <div style={{ minWidth: 0 }}>
            <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 4 }}>반 필터</label>
            <div className="segmented" style={{ flexWrap: "wrap" }}>
              <button className={selectedClassId === "ALL" ? "active" : ""} onClick={() => setSelectedClassId("ALL")}>전체</button>
              {classes.map((c) => (
                <button key={c.class_id} className={selectedClassId === c.class_id ? "active" : ""} onClick={() => setSelectedClassId(c.class_id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 4 }}>이날 수업</label>
            <div style={{ fontSize: 13, fontWeight: 600, maxWidth: 360 }}>
              {todaysSessions.length === 0 ? <span style={{ color: "var(--text-3)" }}>예정된 수업 없음</span>
                : todaysSessions.map((s, i) => (
                  <span key={i} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                    {selectedClassId === "ALL" ? `${s.name} ` : ""}{s.start}~{s.end}{s.day === "DAILY" ? ` (${DAY_KO.DAILY})` : ""}
                  </span>
                ))}
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge success no-dot">출석 {counts.PRESENT}</span>
            <span className="badge warning no-dot">지각 {counts.LATE}</span>
            <span className="badge danger no-dot">결석 {counts.ABSENT}</span>
            <span className="badge gray no-dot">미체크 {counts.NONE}</span>
            <span className="badge primary no-dot">하원 {counts.OUT}</span>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: "var(--text-2)" }}>
            <span>진행률</span>
            <span className="num">{totalChecked} / {members.length}</span>
          </div>
          <div className="progress"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div className="search-box">
          <input className="input" placeholder="학생 이름으로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Link to="/kiosk" className="btn ghost ml-auto" title="태블릿을 입구에 두고 학생이 직접 등원/하원">📲 키오스크 모드 열기</Link>
      </div>

      {visibleMembers.length === 0 ? (
        <div className="empty">{members.length === 0 ? "해당 조건에 일치하는 재원 학생이 없습니다." : "검색 결과가 없습니다."}</div>
      ) : (
        <div className="att-grid">
          {visibleMembers.map((m) => {
            const cur = attMap[m.member_id];
            const status = cur?.status;
            const cls = status === "PRESENT" ? "present" : status === "ABSENT" ? "absent" : status === "LATE" ? "late" : "";
            const busy = pendingId === m.member_id || pendingId === "ALL";
            return (
              <div key={m.member_id} className={`att-card ${cls}`}>
                <div className="att-card-head">
                  <div className="avatar">{m.name?.[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="name">{m.name}</div>
                    <div className="sub">
                      {m.gender === "M" ? "남" : "여"}
                      {ageToGrade(m.age) && ` · ${ageToGrade(m.age)}`}
                      {cur?.check_in_time && ` · 등원 ${cur.check_in_time.slice(0, 5)}`}
                      {cur?.check_out_time && ` · 하원 ${cur.check_out_time.slice(0, 5)}`}
                    </div>
                  </div>
                  {m.unpaid_amount > 0 && (
                    <span className="badge danger no-dot" title={`미납 ${m.unpaid_amount.toLocaleString()}원`} style={{ fontSize: 10, padding: "2px 7px" }}>미납</span>
                  )}
                </div>
                <div className="att-card-actions">
                  {["PRESENT", "LATE", "ABSENT"].map((s) => {
                    const active = status === s;
                    const cn = s === "PRESENT" ? "present" : s === "ABSENT" ? "absent" : "late";
                    return (
                      <button key={s} className={`att-btn ${active ? `active ${cn}` : ""}`} onClick={() => setStatus(m, s)} disabled={busy}
                        title={active ? "한 번 더 누르면 취소" : undefined}>
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                  {isToday && (status === "PRESENT" || status === "LATE") && (
                    <button className="att-btn" onClick={() => handleCheckout(m)} disabled={busy || Boolean(cur?.check_out_time)}
                      title="하원 처리 (학부모에게 알림)">
                      {cur?.check_out_time ? "하원✓" : "하원"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        marginTop: 20, padding: 14, background: "var(--surface)",
        border: "1px solid var(--border)", borderRadius: 12,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          자동 저장됨 · {selectedClassId === "ALL" ? "전체 재원생" : "선택한 반"}의 미체크 학생만 일괄 처리됩니다.
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => handleBulk("PRESENT")} disabled={pendingId === "ALL"}>미체크 전원 출석</button>
        <button className="btn" onClick={() => handleBulk("ABSENT")} disabled={pendingId === "ALL"}>출석 마감 (미체크 → 결석)</button>
      </div>
    </>
  );
}

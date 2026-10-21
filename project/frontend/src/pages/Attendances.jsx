import { useEffect, useState, useMemo } from "react";
import { fetchAttendances, createAttendance, deleteAttendance, fetchMembers, fetchClasses } from "../api";

const today = () => new Date().toISOString().slice(0, 10);
const STATUS_LABEL = { PRESENT: "출석", ABSENT: "결석", LATE: "지각" };

const ageToGrade = (age) => {
  if (age == null) return "";
  if (age >= 7  && age <= 12) return `초${age - 6}`;
  if (age >= 13 && age <= 15) return `중${age - 12}`;
  if (age >= 16 && age <= 18) return `고${age - 15}`;
  return "";
};

const isUnpaid = (date) => {
  if (!date) return true;
  const days = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  return days > 30;
};

export default function Attendances() {
  const [targetDate, setTargetDate] = useState(today());
  const [classes, setClasses] = useState([]); 
  const [selectedClassId, setSelectedClassId] = useState("ALL"); 

  const [members, setMembers] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  useEffect(() => {
    fetchClasses()
      .then((data) => setClasses(Array.isArray(data) ? data : []))
      .catch((e) => console.error("수업 목록 로드 실패:", e));
  }, []);

  const load = () => {
    const memParams = { status: "ACTIVE" };
    const attParams = { target_date: targetDate };

    if (selectedClassId !== "ALL") {
      memParams.class_id = selectedClassId;
      attParams.class_id = selectedClassId;
    }

    Promise.all([
      fetchMembers(memParams),
      fetchAttendances(attParams),
    ])
      .then(([m, a]) => { setMembers(m); setRows(a); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, [targetDate, selectedClassId]);

  const attMap = useMemo(() => {
    const map = {};
    rows.forEach((a) => { map[a.member_id] = a; });
    return map;
  }, [rows]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, NONE: 0 };
    members.forEach((m) => {
      const s = attMap[m.member_id]?.status;
      if (s) c[s] = (c[s] || 0) + 1;
      else c.NONE++;
    });
    return c;
  }, [members, attMap]);

  const totalChecked = members.length - counts.NONE;
  const progress = members.length === 0 ? 0 : (totalChecked / members.length) * 100;

  const setStatus = async (member, status) => {
    if (pendingId === member.member_id || pendingId === "ALL") return;
    setPendingId(member.member_id);
    try {
      const existing = attMap[member.member_id];
      const payloadClassId = selectedClassId === "ALL" ? (existing?.class_id || null) : selectedClassId;

      if (existing && existing.status === status) {
        await deleteAttendance(existing.attendance_id || existing.id);
      } else if (existing) {
        await deleteAttendance(existing.attendance_id || existing.id);
        await createAttendance({
          member_id: member.member_id,
          class_id: payloadClassId,
          attendance_date: targetDate,
          target_date: targetDate, 
          status,
          check_in_time: status === "ABSENT" ? null : new Date().toTimeString().slice(0, 5),
          check_out_time: null,
          note: null,
        });
      } else {
        await createAttendance({
          member_id: member.member_id,
          class_id: payloadClassId,
          attendance_date: targetDate,
          target_date: targetDate,
          status,
          check_in_time: status === "ABSENT" ? null : new Date().toTimeString().slice(0, 5),
          check_out_time: null,
          note: null,
        });
      }
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setPendingId(null);
    }
  };

  // 🌟 전체 상태에서도 작동하도록 로직 수정 (경고 제거 및 분기 처리)
  const handleMarkAllPresent = async () => {
    const unchecked = members.filter(m => !attMap[m.member_id]);
    if (unchecked.length === 0) return alert("해당 조건에 미체크 학생이 없습니다.");
    
    const confirmMessage = selectedClassId === "ALL" 
      ? "전체 학생 중 미체크 인원 전원을 출석 처리하시겠습니까?" 
      : "선택한 반의 미체크 학생 전원을 출석 처리하시겠습니까?";
      
    if (!window.confirm(confirmMessage)) return;

    setPendingId("ALL");
    try {
      await Promise.all(unchecked.map(m => createAttendance({
        member_id: m.member_id,
        class_id: selectedClassId === "ALL" ? null : selectedClassId,
        attendance_date: targetDate,
        target_date: targetDate,
        status: "PRESENT",
        check_in_time: new Date().toTimeString().slice(0, 5),
        check_out_time: null,
        note: null,
      })));
      load();
    } catch (e) {
      alert("일괄 처리 중 오류가 발생했습니다.");
    } finally {
      setPendingId(null);
    }
  };

  // 🌟 전체 상태에서도 작동하도록 로직 수정
  const handleCloseAttendance = async () => {
    const unchecked = members.filter(m => !attMap[m.member_id]);
    if (unchecked.length === 0) return alert("해당 조건에 미체크 학생이 없습니다.");
    
    const confirmMessage = selectedClassId === "ALL" 
      ? "전체 학생 중 미체크 인원 전원을 결석(마감) 처리하시겠습니까?" 
      : "선택한 반의 미체크 학생 전원을 결석(마감) 처리하시겠습니까?";

    if (!window.confirm(confirmMessage)) return;

    setPendingId("ALL");
    try {
      await Promise.all(unchecked.map(m => createAttendance({
        member_id: m.member_id,
        class_id: selectedClassId === "ALL" ? null : selectedClassId,
        attendance_date: targetDate,
        target_date: targetDate,
        status: "ABSENT",
        check_in_time: null,
        check_out_time: null,
        note: null,
      })));
      load();
    } catch (e) {
      alert("일괄 처리 중 오류가 발생했습니다.");
    } finally {
      setPendingId(null);
    }
  };

  const selectedClassName = selectedClassId === "ALL" 
    ? "전체 회원" 
    : classes.find(c => (c.class_id || c.id) == selectedClassId)?.name || "소속 반";

  return (
    <>
      <h2 className="page-title">출석 체크</h2>
      <p className="page-subtitle">{selectedClassName} · {targetDate}</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 4 }}>날짜</label>
            <input type="date" className="input" value={targetDate}
                   onChange={(e) => setTargetDate(e.target.value)} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 4 }}>반 필터</label>
            <div className="segmented">
              <button 
                className={selectedClassId === "ALL" ? "active" : ""} 
                onClick={() => setSelectedClassId("ALL")}
              >
                전체
              </button>
              {classes.map(c => {
                const classId = c.class_id || c.id;
                return (
                  <button 
                    key={classId} 
                    className={selectedClassId == classId ? "active" : ""} 
                    onClick={() => setSelectedClassId(classId)}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 4 }}>교시</label>
            <div style={{ fontSize: 14, fontWeight: 600 }}>09:00 - 11:00</div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <span className="badge success no-dot">출석 {counts.PRESENT}</span>
            <span className="badge danger no-dot">결석 {counts.ABSENT}</span>
            <span className="badge warning no-dot">지각 {counts.LATE}</span>
            <span className="badge gray no-dot">미체크 {counts.NONE}</span>
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

      {members.length === 0 ? (
        <div className="empty">해당 조건에 일치하는 활동중인 학생이 없습니다.</div>
      ) : (
        <div className="att-grid">
          {members.map((m) => {
            const cur = attMap[m.member_id];
            const status = cur?.status;
            const cls = status === "PRESENT" ? "present" :
                        status === "ABSENT"  ? "absent"  :
                        status === "LATE"    ? "late"    : "";
            return (
              <div key={m.member_id} className={`att-card ${cls}`}>
                <div className="att-card-head">
                  <div className="avatar">{m.name?.[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="name">{m.name}</div>
                    <div className="sub">
                      {m.gender === "M" ? "남" : "여"}
                      {ageToGrade(m.age) && ` · ${ageToGrade(m.age)}`} · {selectedClassName}
                    </div>
                  </div>
                  {isUnpaid(m.payment_date) && (
                    <span className="badge danger no-dot" style={{ fontSize: 10, padding: "2px 7px" }}>미납</span>
                  )}
                </div>
                <div className="att-card-actions">
                  {["PRESENT", "ABSENT", "LATE"].map((s) => {
                    const active = status === s;
                    const cn = s === "PRESENT" ? "present" : s === "ABSENT" ? "absent" : "late";
                    return (
                      <button
                        key={s}
                        className={`att-btn ${active ? `active ${cn}` : ""}`}
                        onClick={() => setStatus(m, s)}
                        disabled={pendingId === m.member_id || pendingId === "ALL"}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        marginTop: 20, padding: 14, background: "var(--surface)",
        border: "1px solid var(--border)", borderRadius: 12,
        display: "flex", alignItems: "center", gap: 12
      }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {selectedClassId === "ALL" ? "자동 저장됨 · 전체 회원이 일괄 처리됩니다." : "자동 저장됨 · 선택한 반만 일괄 처리됩니다."}
        </span>
        <div style={{ flex: 1 }} />
        {/* 🌟 disabled 조건에서 selectedClassId === "ALL" 차단 해제 */}
        <button 
          className="btn ghost" 
          onClick={handleMarkAllPresent}
          disabled={pendingId === "ALL"}
        >
          미체크 전원 출석
        </button>
        <button 
          className="btn" 
          onClick={handleCloseAttendance}
          disabled={pendingId === "ALL"}
        >
          출석 마감 →
        </button>
      </div>
    </>
  );
}
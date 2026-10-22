// 수업 관리 — 수업 목록 · 월간 캘린더 · 수업 상세(정보/수강생/반 공지/과제)
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
  fetchClasses, createClass, deleteClass, updateClass, fetchMembers, enrollStudent, unenrollStudent,
  fetchNotices, createNotice, deleteNotice, fetchAssignments, createAssignment, updateAssignment, deleteAssignment,
  fetchSubmissions, updateSubmission, assignmentFileUrl, errorText,
} from "../api";
import { DAY_LABELS, DAY_ORDER, useDataRefresh, won } from "../utils/sync";

const NOTICE_CATEGORY = { GENERAL: "일반", EVENT: "행사", URGENT: "긴급" };
const SUBMISSION_LABEL = { NONE: "미확인", SUBMITTED: "제출", LATE: "지각 제출", MISSING: "미제출" };
const SUBMISSION_COLOR = { NONE: "var(--text-3)", SUBMITTED: "var(--success)", LATE: "var(--warning)", MISSING: "var(--danger)" };
const EMPTY_ASSIGNMENT = { title: "", content: "", dueDate: "", fileName: "", file: null, hadFile: false, removeFile: false };
// 서버 팔레트와 같은 순서(색을 고르지 않은 수업의 기본색)
const PALETTE = ["#2563EB", "#16A34A", "#DC2626", "#9333EA", "#EA580C", "#0891B2", "#DB2777", "#65A30D", "#CA8A04", "#475569"];
const WEEK_HEAD = ["일", "월", "화", "수", "목", "금", "토"];
const JS_DAY_CODE = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const STYLES = `
.cls-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-bottom:18px;}
.cls-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;cursor:pointer;position:relative;overflow:hidden;transition:box-shadow .12s,border-color .12s;}
.cls-card:hover{box-shadow:var(--shadow);border-color:var(--border-strong);}
.cls-card .bar{position:absolute;left:0;top:0;bottom:0;width:5px;}
.cls-card h3{margin:0;font-size:16px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.cls-card .sub{font-size:12px;color:var(--text-3);margin-top:3px;}
.cls-card .sched{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;}
.cls-card .sched span{font-size:11.5px;padding:2px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);}
.cls-card .foot{display:flex;gap:6px;align-items:center;margin-top:12px;font-size:12px;color:var(--text-2);}
.cal-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;}
.cal-head{display:flex;align-items:flex-end;gap:14px;margin-bottom:14px;flex-wrap:wrap;}
.cal-title{display:flex;flex-direction:column;line-height:1;position:relative;}
.cal-year{border:0;background:none;padding:0 0 4px;font-size:14px;font-weight:600;color:var(--text-3);text-align:left;display:inline-flex;gap:4px;align-items:center;}
.cal-year:hover{color:var(--primary-text);}
.cal-month{font-size:46px;font-weight:800;letter-spacing:-.04em;}
.cal-month small{font-size:18px;font-weight:700;margin-left:2px;color:var(--text-2);}
.cal-nav{display:flex;gap:6px;align-items:center;margin-bottom:6px;}
.cal-nav .arrow{width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--surface);font-size:18px;color:var(--text);display:grid;place-items:center;}
.cal-nav .arrow:hover{background:var(--surface-hover);}
.year-pop{position:absolute;top:24px;left:0;z-index:30;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);padding:10px;width:250px;}
.year-pop .yh{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;font-size:13px;}
.year-pop .yg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;}
.year-pop .yg button{border:0;background:var(--surface-2);border-radius:8px;padding:8px 0;font-size:13px;color:var(--text);}
.year-pop .yg button.on{background:var(--primary);color:#fff;font-weight:700;}
.year-pop .yg button.now{outline:1.5px solid var(--primary);}
.cal-legend{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;}
.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--border);border-left:1px solid var(--border);}
.cal-dow{padding:8px 6px;font-size:12px;font-weight:700;text-align:center;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface-2);}
.cal-cell{min-height:112px;padding:6px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:3px;min-width:0;}
.cal-cell.off{background:var(--surface-2);}
.cal-cell .dn{font-size:13px;font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;}
.cal-cell.today .dn b{background:var(--primary);color:#fff;border-radius:999px;padding:1px 7px;}
.cal-ev{display:flex;gap:4px;align-items:center;border:0;text-align:left;font-size:11px;line-height:1.25;padding:3px 5px;border-radius:5px;border-left:3px solid;color:var(--text);min-width:0;width:100%;}
.cal-ev .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.cal-ev .tm{color:var(--text-3);font-variant-numeric:tabular-nums;flex-shrink:0;}
.cal-more{font-size:11px;color:var(--text-3);border:0;background:none;padding:0;text-align:left;}
.swatches{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.swatch{width:28px;height:28px;border-radius:8px;border:2px solid transparent;cursor:pointer;}
.swatch.on{border-color:var(--text);box-shadow:0 0 0 2px var(--surface) inset;}
.day-chips{display:flex;gap:6px;flex-wrap:wrap;}
.day-chip{width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:var(--surface);font-weight:700;color:var(--text-2);}
.day-chip.on{background:var(--primary);border-color:var(--primary);color:#fff;}
.day-chip.sun{color:var(--danger);} .day-chip.sat{color:var(--primary-text);}
.day-chip.on.sun,.day-chip.on.sat{color:#fff;}
.quick-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
.time-row{display:grid;grid-template-columns:44px 1fr 16px 1fr;gap:8px;align-items:center;margin-top:6px;}
.time-row .input{min-width:0;}
.roster{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface-2);}
.roster-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
.roster-chips .chip{cursor:default;}
.roster-chips .chip button{border:0;background:none;color:var(--text-3);padding:0 0 0 2px;font-size:13px;}
.roster-results{max-height:180px;overflow-y:auto;display:grid;gap:4px;margin-top:6px;}
.roster-results button{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:6px 10px;font-size:13px;color:var(--text);}
.roster-results button.on{border-color:var(--primary);background:var(--primary-soft);}
.cls-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px;}
.cd-student{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;}
.cd-student .nm{border:0;background:none;padding:0;font-weight:600;color:var(--text);font-size:14px;}
.cd-student .nm:hover{color:var(--primary-text);text-decoration:underline;}
.form-row textarea,.dashboard-textarea{background:var(--surface);color:var(--text);}
@media(max-width:700px){
  .cal-month{font-size:38px;}
  .cal-cell{min-height:64px;padding:3px;}
  .cal-ev{padding:0;height:6px;border-left:0;border-radius:3px;}
  .cal-ev .t,.cal-ev .tm{display:none;}
  .cal-dow{padding:6px 2px;}
  .cls-form-grid{grid-template-columns:1fr;}
}
`;

const hexToRgba = (hex, alpha) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(37,99,235,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function normalizeClass(c, index) {
  const schedules = (c.schedules?.length ? c.schedules : (c.days_of_week || "").split(",").filter(Boolean)
    .map((d) => ({ day: d, start: c.start_time, end: c.end_time })))
    .flatMap((s) => {
      const day = String(s.day).toUpperCase();
      const days = day === "DAILY" || day === "매일" ? DAY_ORDER : [day];
      return days.map((d) => ({ day: d, start: (s.start || "").slice(0, 5), end: (s.end || "").slice(0, 5) }));
    })
    .filter((s) => DAY_ORDER.includes(s.day))
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  return {
    ...c,
    id: c.class_id,
    color: c.color || PALETTE[(c.color_index ?? index) % PALETTE.length],
    schedules,
    students: c.students || [],
  };
}

function classStatus(cls, now = new Date()) {
  const today = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (cls.start_date && today < cls.start_date) return "준비 중";
  if (cls.end_date && today > cls.end_date) return "종료";
  const code = JS_DAY_CODE[now.getDay()];
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (cls.schedules.some((s) => s.day === code && s.start && s.end && s.start <= hhmm && hhmm <= s.end)) return "수업 중";
  return "";
}

const scheduleText = (s) => `${DAY_LABELS[s.day]} ${s.start || ""}${s.end ? `~${s.end}` : ""}`;

export default function ClassManagement() {
  const navigate = useNavigate();
  const { isOwner } = useOutletContext() || { isOwner: true };
  const [searchParams, setSearchParams] = useSearchParams();
  const [classes, setClasses] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [formTarget, setFormTarget] = useState(null);     // null | {} (새 수업) | class
  const [activeClassId, setActiveClassId] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());  // 캘린더에서 숨긴 수업

  const load = useCallback(async () => {
    try {
      const [classRows, memberRows] = await Promise.all([fetchClasses(), fetchMembers({ status: "ACTIVE" }).catch(() => [])]);
      setClasses((Array.isArray(classRows) ? classRows : []).map(normalizeClass));
      setMembers(Array.isArray(memberRows) ? memberRows : []);
      setError("");
    } catch (e) {
      setError(errorText(e, "수업 목록을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load);

  // 학생 관리 등에서 ?class_id= 로 들어오면 그 수업 상세를 엶
  useEffect(() => {
    const requested = Number(searchParams.get("class_id"));
    if (requested && classes.some((c) => c.id === requested)) setActiveClassId(requested);
  }, [classes, searchParams]);

  const closeDetail = () => {
    setActiveClassId(null);
    if (searchParams.get("class_id")) {
      const params = new URLSearchParams(searchParams);
      params.delete("class_id");
      setSearchParams(params, { replace: true });
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? classes.filter((c) => c.name.includes(q) || (c.teacher || "").includes(q) || (c.description || "").includes(q)) : classes;
  }, [classes, query]);
  const activeClass = classes.find((c) => c.id === activeClassId) || null;
  const running = classes.filter((c) => !["종료", "준비 중"].includes(classStatus(c))).length;

  const handleDelete = async (cls) => {
    if (!window.confirm(`'${cls.name}' 수업을 삭제할까요?\n수강 명단·과제가 함께 삭제됩니다. (출결 기록은 보관)`)) return;
    try {
      await deleteClass(cls.id);
      if (activeClassId === cls.id) closeDetail();
      load();
    } catch (e) {
      alert(errorText(e, "삭제하지 못했습니다."));
    }
  };

  return (
    <>
      <style>{STYLES}</style>
      <h1 className="page-title">수업 관리</h1>
      <p className="page-subtitle">전체 {classes.length}개 · 운영 중 {running}개</p>
      {error && <div className="fl-banner danger">{error}</div>}

      <div className="toolbar">
        <div className="search-box" style={{ flex: "1 1 220px" }}>
          <input className="input" style={{ width: "100%" }} placeholder="수업명·강사 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {isOwner && <button className="btn ml-auto" onClick={() => setFormTarget({})}>+ 수업 추가</button>}
      </div>

      {loading ? <div className="fl-skeleton" style={{ height: 160, marginBottom: 18 }} /> : (
        <div className="cls-grid">
          {filtered.length === 0 && (
            <div className="empty" style={{ gridColumn: "1/-1" }}>{classes.length ? "검색 결과가 없습니다." : "등록된 수업이 없습니다."}</div>
          )}
          {filtered.map((cls) => {
            const status = classStatus(cls);
            return (
              <div key={cls.id} className="cls-card" role="button" tabIndex={0}
                onClick={() => setActiveClassId(cls.id)} onKeyDown={(e) => e.key === "Enter" && setActiveClassId(cls.id)}>
                <span className="bar" style={{ background: cls.color }} />
                <h3>
                  {cls.name}
                  {status && <span className={`badge ${status === "수업 중" ? "primary" : status === "종료" ? "gray" : "warning"} no-dot`}>{status}</span>}
                </h3>
                <div className="sub">{cls.teacher} · {cls.start_date || cls.end_date ? `${cls.start_date || "…"} ~ ${cls.end_date || "…"}` : "상시 운영"}</div>
                <div className="sched">
                  {cls.schedules.length ? cls.schedules.map((s) => <span key={s.day}>{scheduleText(s)}</span>) : <span>시간 미정</span>}
                </div>
                <div className="foot">
                  👥 {cls.student_count ?? cls.students.length}명
                  <span style={{ marginLeft: "auto" }}>{won(cls.fee)} / 월</span>
                  {isOwner && (
                    <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setFormTarget(cls)}>수정</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <MonthCalendar classes={classes} hidden={hidden}
        onToggle={(id) => setHidden((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
        onOpen={(id) => setActiveClassId(id)} />

      {activeClass && (
        <ClassDetail cls={activeClass} isOwner={isOwner} onClose={closeDetail} onChanged={load}
          onEdit={() => setFormTarget(activeClass)} onDelete={() => handleDelete(activeClass)}
          onOpenMember={(id) => navigate(`/members?member_id=${id}`)} members={members} />
      )}

      {formTarget && (
        <ClassFormModal initial={formTarget.id ? formTarget : null} members={members}
          onClose={() => setFormTarget(null)}
          onSaved={(saved) => { setFormTarget(null); load(); if (saved?.class_id && !formTarget.id) setActiveClassId(saved.class_id); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// 월간 캘린더 — 큰 월 숫자 + 작은 연도(누르면 연도 선택), ‹ › 로 이동
// ---------------------------------------------------------------------
function MonthCalendar({ classes, hidden, onToggle, onOpen }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [yearOpen, setYearOpen] = useState(false);
  const [decade, setDecade] = useState(Math.floor(now.getFullYear() / 12) * 12);
  const [expanded, setExpanded] = useState(null);

  const move = (offset) => {
    const d = new Date(year, month - 1 + offset, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input,textarea,select,.modal,.modal-large")) return;
      if (e.key === "ArrowLeft") move(-1);
      if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const firstDow = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const todayStr = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const visible = classes.filter((c) => !hidden.has(c.id));

  return (
    <div className="cal-card">
      <div className="cal-head">
        <div className="cal-title">
          <button type="button" className="cal-year" onClick={() => { setDecade(Math.floor(year / 12) * 12); setYearOpen((v) => !v); }}
            aria-haspopup="true" aria-expanded={yearOpen}>{year}년 ▾</button>
          <div className="cal-month">{month}<small>월</small></div>
          {yearOpen && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setYearOpen(false)} />
              <div className="year-pop">
                <div className="yh">
                  <button className="btn ghost sm" onClick={() => setDecade((d) => d - 12)} aria-label="이전">‹</button>
                  <span>{decade} – {decade + 11}</span>
                  <button className="btn ghost sm" onClick={() => setDecade((d) => d + 12)} aria-label="다음">›</button>
                </div>
                <div className="yg">
                  {Array.from({ length: 12 }, (_, i) => decade + i).map((y) => (
                    <button key={y} type="button" className={`${y === year ? "on" : ""} ${y === now.getFullYear() ? "now" : ""}`}
                      onClick={() => { setYear(y); setYearOpen(false); }}>{y}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="cal-nav">
          <button type="button" className="arrow" onClick={() => move(-1)} aria-label="이전 달">‹</button>
          <button type="button" className="arrow" onClick={() => move(1)} aria-label="다음 달">›</button>
          <button type="button" className="btn ghost sm" onClick={goToday}>오늘</button>
        </div>
      </div>

      {classes.length > 0 && (
        <div className="cal-legend">
          {classes.map((c) => (
            <button key={c.id} type="button" className="chip" onClick={() => onToggle(c.id)}
              style={{ opacity: hidden.has(c.id) ? 0.4 : 1 }} title={hidden.has(c.id) ? "캘린더에 표시" : "캘린더에서 숨기기"}>
              <span className="dot" style={{ background: c.color }} />{c.name}
            </button>
          ))}
        </div>
      )}

      <div className="cal-grid">
        {WEEK_HEAD.map((d, i) => (
          <div key={d} className="cal-dow" style={{ color: i === 0 ? "var(--danger)" : i === 6 ? "var(--primary-text)" : "var(--text-2)" }}>{d}</div>
        ))}
        {cells.map((day, index) => {
          if (!day) return <div key={`e${index}`} className="cal-cell off" />;
          const dateStr = ymd(year, month, day);
          const code = JS_DAY_CODE[index % 7];
          const events = [];
          visible.forEach((c) => {
            if ((c.start_date && dateStr < c.start_date) || (c.end_date && dateStr > c.end_date)) return;
            c.schedules.filter((s) => s.day === code).forEach((s) => events.push({ cls: c, s }));
          });
          events.sort((a, b) => (a.s.start || "").localeCompare(b.s.start || ""));
          const isExpanded = expanded === dateStr;
          const shown = isExpanded ? events : events.slice(0, 3);
          return (
            <div key={dateStr} className={`cal-cell${dateStr === todayStr ? " today" : ""}`}>
              <div className="dn" style={{ color: index % 7 === 0 ? "var(--danger)" : index % 7 === 6 ? "var(--primary-text)" : "var(--text)" }}>
                <b>{day}</b>
              </div>
              {shown.map(({ cls, s }) => (
                <button key={`${cls.id}-${s.day}`} type="button" className="cal-ev" onClick={() => onOpen(cls.id)}
                  style={{ borderLeftColor: cls.color, background: hexToRgba(cls.color, 0.14) }} title={`${cls.name} ${s.start}~${s.end}`}>
                  <span className="tm">{s.start}</span><span className="t">{cls.name}</span>
                </button>
              ))}
              {events.length > 3 && (
                <button type="button" className="cal-more" onClick={() => setExpanded(isExpanded ? null : dateStr)}>
                  {isExpanded ? "접기" : `+${events.length - 3}개`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 수업 추가·수정 — 색 · 수강료 · 기간(선택) · 요일/시간 · 수강생
// ---------------------------------------------------------------------
function ClassFormModal({ initial, members, onClose, onSaved }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(() => ({
    name: initial?.name || "", teacher: initial?.teacher || "", description: initial?.description || "",
    start_date: initial?.start_date || "", end_date: initial?.end_date || "",
    color: initial?.color || PALETTE[0], monthly_fee: initial?.monthly_fee ?? "",
  }));
  const initialSchedules = initial?.schedules || [];
  const sameTimeInitially = initialSchedules.every((s) => s.start === initialSchedules[0]?.start && s.end === initialSchedules[0]?.end);
  const [days, setDays] = useState(() => new Set(initialSchedules.map((s) => s.day)));
  const [perDay, setPerDay] = useState(!sameTimeInitially);
  const [common, setCommon] = useState({ start: initialSchedules[0]?.start || "16:00", end: initialSchedules[0]?.end || "17:00" });
  const [times, setTimes] = useState(() => Object.fromEntries(initialSchedules.map((s) => [s.day, { start: s.start, end: s.end }])));
  const [studentIds, setStudentIds] = useState(() => new Set((initial?.students || []).map((s) => s.member_id)));
  const [studentQuery, setStudentQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleDay = (d) => setDays((prev) => { const next = new Set(prev); if (next.has(d)) next.delete(d); else next.add(d); return next; });
  const quick = (list) => setDays(new Set(list));
  const timeOf = (d) => (perDay ? times[d] || common : common);
  const setTime = (d, key, value) => setTimes((t) => ({ ...t, [d]: { ...(t[d] || common), [key]: value } }));

  const nameOf = useMemo(() => {
    const map = Object.fromEntries(members.map((m) => [m.member_id, m.name]));
    (initial?.students || []).forEach((s) => { map[s.member_id] = map[s.member_id] || s.name; });
    return map;
  }, [members, initial]);
  const results = useMemo(() => {
    const q = studentQuery.trim();
    return (q ? members.filter((m) => m.name.includes(q)) : members).slice(0, 30);
  }, [members, studentQuery]);
  const toggleStudent = (id) => setStudentIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!form.name.trim() || !form.teacher.trim()) return setErr("수업명과 담당 강사를 입력하세요.");
    if (form.start_date && form.end_date && form.start_date > form.end_date) return setErr("종료일이 시작일보다 빠릅니다.");
    const ordered = DAY_ORDER.filter((d) => days.has(d));
    const schedules = ordered.map((d) => ({ day: d, start: timeOf(d).start, end: timeOf(d).end }));
    const bad = schedules.find((s) => !s.start || !s.end || s.start >= s.end);
    if (bad) return setErr(`${DAY_LABELS[bad.day]}요일 종료 시간이 시작 시간보다 늦어야 합니다.`);
    const payload = {
      name: form.name.trim(), teacher: form.teacher.trim(), description: form.description,
      start_date: form.start_date || null, end_date: form.end_date || null,
      color: form.color, monthly_fee: form.monthly_fee === "" ? null : Number(form.monthly_fee),
      days_of_week: ordered.join(","), start_time: schedules[0]?.start || null, end_time: schedules[0]?.end || null,
      schedules, student_ids: [...studentIds],
    };
    setSaving(true);
    try {
      const saved = isEdit ? await updateClass(initial.id, payload) : await createClass(payload);
      onSaved(saved);
    } catch (e2) {
      setErr(errorText(e2, "저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" style={{ width: "min(620px, 100%)" }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{isEdit ? "수업 수정" : "새 수업"}</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <div className="cls-form-grid">
          <div className="form-row"><label>수업명 *</label><input className="input" value={form.name} onChange={set("name")} maxLength={100} placeholder="예: 초등 품새반" /></div>
          <div className="form-row"><label>담당 강사 *</label><input className="input" value={form.teacher} onChange={set("teacher")} maxLength={50} /></div>
        </div>

        <div className="form-row">
          <label>색</label>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button key={c} type="button" className={`swatch${form.color.toUpperCase() === c ? " on" : ""}`} style={{ background: c }}
                onClick={() => setForm((f) => ({ ...f, color: c }))} aria-label={`색 ${c}`} />
            ))}
            <label className="swatch" style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)", position: "relative" }} title="직접 고르기">
              <input type="color" value={form.color} onChange={set("color")} style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }} />
            </label>
            <span className="chip" style={{ cursor: "default" }}><span className="dot" style={{ background: form.color }} />{form.name || "미리보기"}</span>
          </div>
        </div>

        <div className="form-row">
          <label>요일</label>
          <div className="day-chips">
            {DAY_ORDER.map((d) => (
              <button key={d} type="button" className={`day-chip${days.has(d) ? " on" : ""}${d === "SUN" ? " sun" : d === "SAT" ? " sat" : ""}`}
                onClick={() => toggleDay(d)} aria-pressed={days.has(d)}>{DAY_LABELS[d]}</button>
            ))}
          </div>
          <div className="quick-row">
            <button type="button" className="btn ghost sm" onClick={() => quick(["MON", "TUE", "WED", "THU", "FRI"])}>평일</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(["MON", "WED", "FRI"])}>월·수·금</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(["TUE", "THU"])}>화·목</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(["SAT", "SUN"])}>주말</button>
            <button type="button" className="btn ghost sm" onClick={() => quick(DAY_ORDER)}>매일</button>
            <button type="button" className="btn ghost sm" onClick={() => quick([])}>지우기</button>
          </div>
        </div>

        {days.size > 0 && (
          <div className="form-row">
            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>시간</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
                <input type="checkbox" checked={perDay} onChange={(e) => {
                  setPerDay(e.target.checked);
                  if (e.target.checked) setTimes((t) => Object.fromEntries(DAY_ORDER.map((d) => [d, t[d] || common])));
                }} /> 요일마다 다르게
              </span>
            </label>
            {perDay ? DAY_ORDER.filter((d) => days.has(d)).map((d) => (
              <div className="time-row" key={d}>
                <span className="badge primary no-dot" style={{ justifyContent: "center" }}>{DAY_LABELS[d]}</span>
                <input type="time" step="300" className="input" value={timeOf(d).start} onChange={(e) => setTime(d, "start", e.target.value)} />
                <span>~</span>
                <input type="time" step="300" className="input" value={timeOf(d).end} onChange={(e) => setTime(d, "end", e.target.value)} />
              </div>
            )) : (
              <div className="time-row">
                <span className="badge primary no-dot" style={{ justifyContent: "center" }}>공통</span>
                <input type="time" step="300" className="input" value={common.start} onChange={(e) => setCommon((c) => ({ ...c, start: e.target.value }))} />
                <span>~</span>
                <input type="time" step="300" className="input" value={common.end} onChange={(e) => setCommon((c) => ({ ...c, end: e.target.value }))} />
              </div>
            )}
          </div>
        )}

        <div className="cls-form-grid">
          <div className="form-row"><label>시작일 (선택)</label><input type="date" className="input" value={form.start_date} onChange={set("start_date")} /></div>
          <div className="form-row"><label>종료일 (선택)</label><input type="date" className="input" value={form.end_date} onChange={set("end_date")} /></div>
        </div>
        <div className="form-row">
          <label>월 수강료 (원, 비우면 기본 수강료)</label>
          <input type="number" min="0" step="1000" className="input" value={form.monthly_fee} onChange={set("monthly_fee")} placeholder="기본 수강료 적용" />
        </div>
        <div className="form-row"><label>설명</label><textarea value={form.description} onChange={set("description")} maxLength={5000} placeholder="학부모 가입 화면에도 표시됩니다" /></div>

        <div className="form-row">
          <label>수강생 {studentIds.size}명</label>
          <div className="roster">
            <div className="roster-chips">
              {[...studentIds].map((id) => (
                <span key={id} className="chip">{nameOf[id] || `#${id}`}<button type="button" onClick={() => toggleStudent(id)} aria-label="빼기">×</button></span>
              ))}
              {!studentIds.size && <span className="muted">아래에서 학생을 눌러 추가하세요.</span>}
            </div>
            <input className="input" style={{ width: "100%" }} placeholder="학생 이름 검색" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} />
            <div className="roster-results">
              {results.map((m) => (
                <button key={m.member_id} type="button" className={studentIds.has(m.member_id) ? "on" : ""} onClick={() => toggleStudent(m.member_id)}>
                  <span>{m.name} <span className="muted">{m.age}세</span></span>
                  <span>{studentIds.has(m.member_id) ? "✓ 포함" : "+ 추가"}</span>
                </button>
              ))}
              {!results.length && <span className="muted">재원생이 없습니다.</span>}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? "저장 중…" : isEdit ? "저장" : "추가"}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// 수업 상세 — 정보 / 수강생 / 반 공지 / 과제
// ---------------------------------------------------------------------
function ClassDetail({ cls, isOwner, members, onClose, onChanged, onEdit, onDelete, onOpenMember }) {
  const [tab, setTab] = useState("info");
  const [notices, setNotices] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [newNotice, setNewNotice] = useState({ title: "", category: "GENERAL", content: "", notifyParents: true });
  const [noticeFilter, setNoticeFilter] = useState("ALL");
  const [newAssignment, setNewAssignment] = useState(EMPTY_ASSIGNMENT);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [openAssignmentId, setOpenAssignmentId] = useState(null);
  const [submissions, setSubmissions] = useState({});

  const loadDetails = useCallback(async () => {
    try {
      const [noticeRows, assignmentRows] = await Promise.all([fetchNotices({ class_id: cls.id }), fetchAssignments(cls.id).catch(() => [])]);
      setNotices((noticeRows || []).filter((n) => n.class_id === cls.id));
      setAssignments(assignmentRows || []);
    } catch { /* 상세 정보는 다음 동기화 때 다시 시도 */ }
  }, [cls.id]);
  useEffect(() => { loadDetails(); }, [loadDetails]);
  useDataRefresh(loadDetails);

  const studentIds = cls.students.map((s) => s.member_id);
  const searched = useMemo(() => {
    const q = studentQuery.trim();
    return q ? members.filter((m) => m.name.includes(q)).slice(0, 20) : [];
  }, [members, studentQuery]);

  const toggleStudent = async (memberId) => {
    try {
      if (studentIds.includes(memberId)) await unenrollStudent(cls.id, memberId);
      else await enrollStudent(cls.id, memberId);
      onChanged();
    } catch (e) {
      alert(errorText(e, "수강 정보를 바꾸지 못했습니다."));
    }
  };

  const addNotice = async () => {
    if (!newNotice.title.trim() || !newNotice.content.trim()) return alert("제목과 내용을 입력하세요.");
    try {
      await createNotice({ title: newNotice.title.trim(), content: newNotice.content, category: newNotice.category,
        author: cls.teacher || "담당 강사", class_id: cls.id, notify_parents: newNotice.notifyParents });
      setNewNotice({ title: "", category: "GENERAL", content: "", notifyParents: true });
      loadDetails();
    } catch (e) {
      alert(errorText(e, "공지를 등록하지 못했습니다."));
    }
  };
  const removeNotice = async (id) => {
    if (!window.confirm("공지를 삭제할까요?")) return;
    try { await deleteNotice(id); loadDetails(); } catch (e) { alert(errorText(e, "삭제하지 못했습니다.")); }
  };

  const loadSubmissions = async (id) => {
    try { setSubmissions((prev) => ({ ...prev, [id]: null })); const rows = await fetchSubmissions(id); setSubmissions((prev) => ({ ...prev, [id]: rows })); }
    catch (e) { alert(errorText(e, "제출 현황을 불러오지 못했습니다.")); }
  };
  const toggleSubmissions = (id) => {
    if (openAssignmentId === id) return setOpenAssignmentId(null);
    setOpenAssignmentId(id);
    loadSubmissions(id);
  };
  const changeSubmission = async (aid, mid, status) => {
    try { await updateSubmission(aid, mid, { status }); await Promise.all([loadSubmissions(aid), loadDetails()]); }
    catch (e) { alert(errorText(e, "제출 상태를 바꾸지 못했습니다.")); }
  };
  const markAll = async (aid) => {
    const rows = (submissions[aid] || []).filter((r) => r.status === "NONE");
    if (!rows.length || !window.confirm(`미확인 ${rows.length}명을 '제출'로 표시할까요?`)) return;
    try { await Promise.all(rows.map((r) => updateSubmission(aid, r.member_id, { status: "SUBMITTED" }))); await Promise.all([loadSubmissions(aid), loadDetails()]); }
    catch (e) { alert(errorText(e, "일부 학생의 상태를 바꾸지 못했습니다.")); }
  };
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (file && file.size > 3 * 1024 * 1024) { e.target.value = ""; return alert("첨부 파일은 3MB 이하만 올릴 수 있습니다."); }
    setNewAssignment((prev) => ({ ...prev, file, fileName: file ? file.name : "", removeFile: false }));
  };
  const saveAssignment = async () => {
    if (!newAssignment.title.trim() || !newAssignment.dueDate) return alert("과제명과 마감일을 입력하세요.");
    try {
      const body = new FormData();
      body.append("title", newAssignment.title);
      body.append("content", newAssignment.content);
      body.append("due_date", newAssignment.dueDate);
      if (newAssignment.file) body.append("file", newAssignment.file);
      if (editingAssignmentId) {
        if (newAssignment.removeFile && !newAssignment.file) body.append("remove_file", "true");
        await updateAssignment(editingAssignmentId, body);
      } else {
        await createAssignment(cls.id, body);
      }
      setNewAssignment(EMPTY_ASSIGNMENT);
      setEditingAssignmentId(null);
      const input = document.getElementById("cd-file");
      if (input) input.value = "";
      loadDetails();
    } catch (e) {
      alert(errorText(e, "과제를 저장하지 못했습니다."));
    }
  };
  const removeAssignment = async (id) => {
    if (!window.confirm("과제를 삭제할까요?")) return;
    try { await deleteAssignment(id); if (openAssignmentId === id) setOpenAssignmentId(null); loadDetails(); }
    catch (e) { alert(errorText(e, "과제를 삭제하지 못했습니다.")); }
  };

  const tabs = [["info", "정보"], ["students", `수강생 (${cls.students.length})`], ["notices", `반 공지 (${notices.length})`], ["tasks", `과제 (${assignments.length})`]];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-large-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: cls.color, display: "inline-block" }} />{cls.name}
          </h2>
          <button className="btn ghost sm" onClick={onClose}>닫기</button>
        </div>
        <div className="modal-large-body">
          <div className="modal-sidebar">
            {tabs.map(([key, label]) => (
              <button key={key} className={`modal-tab-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          <div className="modal-large-content">
            {tab === "info" && (
              <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                <div><b>담당 강사</b> · {cls.teacher}</div>
                <div><b>운영 기간</b> · {cls.start_date || cls.end_date ? `${cls.start_date || "…"} ~ ${cls.end_date || "…"}` : "상시"}</div>
                <div><b>시간표</b> · {cls.schedules.length ? cls.schedules.map(scheduleText).join(", ") : "미정"}</div>
                <div><b>월 수강료</b> · {won(cls.fee)}{cls.monthly_fee == null ? " (기본 수강료)" : ""}</div>
                {cls.description && <div style={{ whiteSpace: "pre-wrap", color: "var(--text-2)" }}>{cls.description}</div>}
                {isOwner && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn" onClick={onEdit}>수정</button>
                    <button className="btn danger" onClick={onDelete}>삭제</button>
                  </div>
                )}
              </div>
            )}

            {tab === "students" && (
              <div>
                {isOwner && (
                  <div className="form-row">
                    <input className="input" style={{ width: "100%" }} placeholder="학생 이름으로 검색해 추가" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} />
                    {studentQuery.trim() && (
                      <div className="roster-results" style={{ marginTop: 8 }}>
                        {searched.map((m) => (
                          <button key={m.member_id} type="button" className={studentIds.includes(m.member_id) ? "on" : ""} onClick={() => toggleStudent(m.member_id)}>
                            <span>{m.name} <span className="muted">{m.age}세</span></span>
                            <span>{studentIds.includes(m.member_id) ? "빼기" : "+ 추가"}</span>
                          </button>
                        ))}
                        {!searched.length && <span className="muted">일치하는 재원생이 없습니다.</span>}
                      </div>
                    )}
                  </div>
                )}
                {cls.students.length === 0 ? <div className="empty" style={{ padding: 24 }}>수강생이 없습니다.</div> : cls.students.map((s) => (
                  <div key={s.member_id} className="cd-student">
                    <button type="button" className="nm" onClick={() => onOpenMember(s.member_id)}>{s.name}</button>
                    {s.status === "WITHDRAWN" && <span className="badge gray no-dot">퇴원</span>}
                    {isOwner && <button className="btn danger sm" onClick={() => toggleStudent(s.member_id)}>빼기</button>}
                  </div>
                ))}
              </div>
            )}

            {tab === "notices" && (
              <div>
                {isOwner && (
                  <div className="dashboard-form-container">
                    <div className="cls-form-grid" style={{ gridTemplateColumns: "120px 1fr" }}>
                      <div className="form-row"><label>분류</label>
                        <select className="select" value={newNotice.category} onChange={(e) => setNewNotice((p) => ({ ...p, category: e.target.value }))}>
                          {Object.entries(NOTICE_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                      <div className="form-row"><label>제목</label>
                        <input className="input" value={newNotice.title} onChange={(e) => setNewNotice((p) => ({ ...p, title: e.target.value }))} /></div>
                    </div>
                    <div className="form-row"><label>내용</label>
                      <textarea value={newNotice.content} onChange={(e) => setNewNotice((p) => ({ ...p, content: e.target.value }))} /></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginRight: "auto" }}>
                        <input type="checkbox" checked={newNotice.notifyParents} onChange={(e) => setNewNotice((p) => ({ ...p, notifyParents: e.target.checked }))} /> 이 반 학부모에게 알림
                      </label>
                      <button className="btn sm" onClick={addNotice}>등록</button>
                    </div>
                  </div>
                )}
                <div className="segmented" style={{ margin: "12px 0" }}>
                  {[["ALL", "전체"], ...Object.entries(NOTICE_CATEGORY)].map(([k, v]) => (
                    <button key={k} className={noticeFilter === k ? "active" : ""} onClick={() => setNoticeFilter(k)}>{v}</button>
                  ))}
                </div>
                {notices.filter((n) => noticeFilter === "ALL" || n.category === noticeFilter).map((n) => (
                  <div key={n.notice_id} className="card" style={{ padding: 14, marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span className={`badge ${n.category === "URGENT" ? "danger" : "primary"} no-dot`}>{NOTICE_CATEGORY[n.category] || n.category}</span>
                      <strong>{n.title}</strong>
                      <span className="muted" style={{ marginLeft: "auto" }}>{(n.created_at || "").slice(0, 10)} · 읽음 {n.read_count}/{n.target_count}</span>
                      {isOwner && <button className="btn danger sm" onClick={() => removeNotice(n.notice_id)}>삭제</button>}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>{n.content}</div>
                  </div>
                ))}
                {!notices.length && <div className="empty" style={{ padding: 24 }}>반 공지가 없습니다.</div>}
              </div>
            )}

            {tab === "tasks" && (
              <div>
                {isOwner && (
                  <div className="dashboard-form-container">
                    <div className="cls-form-grid">
                      <div className="form-row"><label>과제명 *</label>
                        <input className="input" value={newAssignment.title} onChange={(e) => setNewAssignment((p) => ({ ...p, title: e.target.value }))} /></div>
                      <div className="form-row"><label>마감일 *</label>
                        <input type="date" className="input" value={newAssignment.dueDate} onChange={(e) => setNewAssignment((p) => ({ ...p, dueDate: e.target.value }))} /></div>
                    </div>
                    <div className="form-row"><label>첨부 (3MB 이하)</label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input id="cd-file" type="file" onChange={handleFile} style={{ fontSize: 12, maxWidth: "100%" }} />
                        {editingAssignmentId && newAssignment.hadFile && !newAssignment.file && (
                          <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
                            <input type="checkbox" checked={newAssignment.removeFile} onChange={(e) => setNewAssignment((p) => ({ ...p, removeFile: e.target.checked }))} /> 기존 첨부 삭제 ({newAssignment.fileName})
                          </label>
                        )}
                      </div>
                    </div>
                    <div className="form-row"><label>내용</label>
                      <textarea value={newAssignment.content} onChange={(e) => setNewAssignment((p) => ({ ...p, content: e.target.value }))} /></div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      {editingAssignmentId && <button className="btn ghost sm" onClick={() => { setEditingAssignmentId(null); setNewAssignment(EMPTY_ASSIGNMENT); }}>취소</button>}
                      <button className="btn sm" onClick={saveAssignment}>{editingAssignmentId ? "수정" : "출제"}</button>
                    </div>
                  </div>
                )}
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  {assignments.map((a) => (
                    <div key={a.assignment_id} className="card" style={{ padding: 14 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <strong>{a.title}</strong>
                        <span className="badge danger no-dot">~ {a.due_date}</span>
                        <span className="badge gray no-dot">제출 {a.submitted}/{a.enrolled}</span>
                        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          <button className="btn ghost sm" onClick={() => toggleSubmissions(a.assignment_id)}>{openAssignmentId === a.assignment_id ? "접기" : "제출 현황"}</button>
                          {isOwner && <button className="btn ghost sm" onClick={() => { setEditingAssignmentId(a.assignment_id); setNewAssignment({ ...EMPTY_ASSIGNMENT, title: a.title, content: a.content || "", dueDate: a.due_date, fileName: a.file_name || "", hadFile: a.has_file }); }}>수정</button>}
                          {isOwner && <button className="btn danger sm" onClick={() => removeAssignment(a.assignment_id)}>삭제</button>}
                        </span>
                      </div>
                      {a.content && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, whiteSpace: "pre-wrap" }}>{a.content}</div>}
                      {a.file_name && <div style={{ fontSize: 12, marginTop: 6 }}>📁 {a.has_file ? <a href={assignmentFileUrl(a.assignment_id)} target="_blank" rel="noreferrer">{a.file_name}</a> : a.file_name}</div>}
                      {openAssignmentId === a.assignment_id && (
                        <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                          {isOwner && <div style={{ textAlign: "right", marginBottom: 6 }}><button className="btn ghost sm" onClick={() => markAll(a.assignment_id)}>미확인 → 모두 제출</button></div>}
                          {!submissions[a.assignment_id] ? <span className="muted">불러오는 중…</span> : submissions[a.assignment_id].map((row) => (
                            <div key={row.member_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                              <span style={{ flex: 1, fontWeight: 600 }}>{row.name}</span>
                              <select className="select" value={row.status} disabled={!isOwner}
                                style={{ minHeight: 28, padding: "2px 6px", fontSize: 12, color: SUBMISSION_COLOR[row.status], fontWeight: 600 }}
                                onChange={(e) => changeSubmission(a.assignment_id, row.member_id, e.target.value)}>
                                {Object.entries(SUBMISSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {!assignments.length && <div className="empty" style={{ padding: 24 }}>과제가 없습니다.</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

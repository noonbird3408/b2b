import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataRefresh } from "../utils/sync";
import { useNavigate } from "react-router-dom";
import {
  clearTodos, createTodo, deleteTodo, errorText, fetchAdminSummary, fetchDashboardInsights, fetchNotices,
  fetchTodos, notifyMemberParents, updateTodo,
} from "../api";
import { WEATHER_CITIES } from "../utils/constants";

// =====================================================================
// 대시보드 — 모든 수치는 /api/dashboard/insights 에서 서버가 집계 (지표 정의도 함께 내려옴)
//   v8.1 이전: 증감률·수납률·미납 금액이 고정값/가짜 계산, 할 일은 브라우저에만 저장, 알림 전송은 alert 뿐
// =====================================================================

const WEATHER_CODES = [
  [[0], "맑음", "☀️"], [[1, 2, 3], "구름 조금", "⛅"], [[45, 48], "안개", "🌫️"],
  [[51, 53, 55, 61, 63, 65, 80, 81, 82], "비", "🌧️"], [[71, 73, 75, 77, 85, 86], "눈", "❄️"], [[95, 96, 99], "뇌우", "⚡"],
];
const TAGS = { primary: "업무", success: "상담", warning: "확인", danger: "긴급" };
const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
const manwon = (n) => `${Math.round(Number(n || 0) / 10000).toLocaleString("ko-KR")}만원`;
const pctText = (v) => (v == null ? "-" : `${v}%`);

const PRINT_CSS = `
@media print {
  .sidebar, .topbar, .no-print, .toast-container { display: none !important; }
  .app-shell, .main, .page { display: block !important; margin: 0 !important; padding: 0 !important; }
  .card, .stat-card { break-inside: avoid; box-shadow: none !important; }
  body { background: #fff !important; }
}
.info-dot{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;
  border:1px solid var(--border-strong,#cbd5e1);font-size:10px;color:var(--text-3);cursor:help;margin-left:4px;}
.dash-two{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;margin-bottom:16px;}
.dash-eq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px;}
@media (max-width:900px){.dash-two,.dash-eq{grid-template-columns:minmax(0,1fr);}}
.risk-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);}
.risk-row:last-child{border-bottom:0;}
.risk-score{min-width:42px;text-align:center;font-weight:800;border-radius:8px;padding:4px 6px;font-size:13px;}
.activity-row{display:flex;gap:10px;font-size:12.5px;padding:7px 0;border-bottom:1px dashed var(--border);}
.activity-row:last-child{border-bottom:0;}
.activity-row time{color:var(--text-3);min-width:44px;font-variant-numeric:tabular-nums;}
`;

function Info({ text }) {
  return text ? <span className="info-dot" title={text} aria-label={text}>i</span> : null;
}

function Trend({ value, unit = "%", positiveIsGood = true }) {
  if (value == null || Number.isNaN(value)) return null;
  const up = value > 0;
  const good = value === 0 ? null : (up === positiveIsGood);
  return (
    <span className={`stat-trend ${good == null ? "" : good ? "up" : "down"}`}>
      {value === 0 ? "변화 없음" : `${up ? "↑" : "↓"} ${Math.abs(value)}${unit}`}
    </span>
  );
}

function useWeather(city) {
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    const coords = WEATHER_CITIES[city];
    if (!coords) return undefined;
    let alive = true;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords[0]}&longitude=${coords[1]}&current_weather=true&timezone=Asia%2FSeoul`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        const cw = res?.current_weather;
        if (!alive || !cw) return;
        const [, desc, emoji] = WEATHER_CODES.find(([codes]) => codes.includes(cw.weathercode)) || [null, "흐림", "☁️"];
        setWeather({ temp: Math.round(cw.temperature), desc, emoji, city });
      })
      .catch(() => alive && setWeather(null));   // 실패하면 가짜 날씨 대신 숨김
    return () => { alive = false; };
  }, [city]);
  return weather;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [brand, setBrand] = useState(null);
  const [notices, setNotices] = useState([]);
  const [todos, setTodos] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [showUnpaid, setShowUnpaid] = useState(false);
  const [todoModal, setTodoModal] = useState(null);   // null | {todo_id?, text, due_time, tag}
  const [showAllTodos, setShowAllTodos] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [insights, summary, noticeRows, todoRows] = await Promise.all([
        fetchDashboardInsights(), fetchAdminSummary(), fetchNotices().catch(() => []), fetchTodos().catch(() => []),
      ]);
      setData(insights); setBrand(summary.brand); setNotices(noticeRows); setTodos(todoRows); setError("");
    } catch (e) {
      setError(errorText(e, "대시보드 데이터를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load);                 // 다른 기기·화면에서 데이터가 바뀌면 자동 갱신

  const weather = useWeather(brand?.weatherCity || "용인");
  const dateLabel = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`;
  }, []);

  const reloadTodos = () => fetchTodos().then(setTodos).catch(() => null);
  const saveTodo = async (form) => {
    try {
      if (form.todo_id) await updateTodo(form.todo_id, { text: form.text, due_time: form.due_time, tag: form.tag, done: !!form.done });
      else await createTodo({ text: form.text, due_time: form.due_time, tag: form.tag });
      setTodoModal(null);
      reloadTodos();
    } catch (e) { alert(errorText(e)); }
  };
  const toggleTodo = async (t) => {
    setTodos((rows) => rows.map((r) => (r.todo_id === t.todo_id ? { ...r, done: !r.done } : r)));
    await updateTodo(t.todo_id, { text: t.text, due_time: t.due_time, tag: t.tag, done: !t.done }).catch(reloadTodos);
  };
  const removeTodo = async (t) => { await deleteTodo(t.todo_id).catch(() => null); reloadTodos(); };
  const clearDone = async () => {
    const n = todos.filter((t) => t.done).length;
    if (!n) return alert("완료한 업무가 없습니다.");
    if (!window.confirm(`완료한 업무 ${n}개를 정리할까요?`)) return;
    await clearTodos(true).catch(() => null); reloadTodos();
  };

  if (!data) {
    return (
      <>
        <h2 className="page-title">대시보드</h2>
        {error ? <div className="error-banner">{error} <button className="btn ghost sm" onClick={load}>다시 시도</button></div>
          : <div className="empty">운영 데이터를 집계하고 있습니다…</div>}
      </>
    );
  }

  const { members, attendance, billing, revenue, definitions: def } = data;
  const today = attendance.today;
  const unpaidList = data.unpaid_members || [];

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>대시보드</h2>
          <p className="page-subtitle" style={{ margin: "4px 0 0" }}>
            {dateLabel} · {brand?.principal ? `${brand.principal} 환영합니다` : "운영 현황"}
            <span style={{ color: "var(--text-3)", marginLeft: 8, fontSize: 12 }}>
              {new Date(data.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {weather && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)",
              padding: "7px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500 }}>
              <span>{weather.emoji}</span><span>{weather.city} {weather.temp}°C</span>
              <span style={{ color: "var(--text-3)" }}>|</span><span style={{ color: "var(--text-2)" }}>{weather.desc}</span>
            </div>
          )}
          <button className="btn ghost sm no-print" onClick={load} disabled={loading}>{loading ? "갱신 중…" : "새로고침"}</button>
          <button className="btn ghost sm no-print" onClick={() => window.print()} title="이 화면을 운영 리포트로 인쇄/PDF 저장">🖨 리포트</button>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {/* ---------------- 핵심 지표 ---------------- */}
      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">재원생<Info text={def.member_change} /></span>
            <Trend value={members.change} unit="명" />
          </div>
          <div className="stat-value num">{members.active}<span className="unit">명</span></div>
          <div className="stat-sub">이번 달 신규 {members.new_this_month}명 · 퇴원 {members.left_this_month}명</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">오늘 출석률<Info text={def.attendance_rate_today} /></span>
            <Trend value={attendance.rate_change} unit="%p" />
          </div>
          <div className="stat-value num primary">{today.present + today.late + today.absent === 0 ? "체크 전" : pctText(today.rate)}</div>
          <div className="stat-sub">
            출석 {today.present} · 지각 {today.late} · 결석 {today.absent}
            {today.unchecked ? ` · 미체크 ${today.unchecked}` : ""} {today.expected ? `/ 오늘 수업 ${today.expected}명` : ""}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">미납<Info text={def.unpaid} /></span>
            {billing.overdue_members > 0 && <span className="stat-trend down">연체 {billing.overdue_members}명</span>}
          </div>
          <div className="stat-value num danger">{manwon(billing.unpaid_total)}</div>
          <div className="stat-sub">{billing.unpaid_members}명 · 청구서 {billing.unpaid_count}건</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">이달 수납률<Info text={def.collection_rate} /></span>
            <Trend value={revenue.change_rate} />
          </div>
          <div className={`stat-value num ${billing.collection_rate == null ? "" : billing.collection_rate >= 80 ? "success" : "warning"}`}>
            {pctText(billing.collection_rate)}
          </div>
          <div className="stat-sub">
            {billing.month_invoices
              ? `청구서 ${billing.month_paid_invoices}/${billing.month_invoices}건 · ${manwon(billing.month_collected)} / ${manwon(billing.month_billed)}`
              : "이번 달 청구서가 없습니다"}
          </div>
        </div>
      </div>

      {/* ---------------- 출석 추이 / 미납 ---------------- */}
      <div className="dash-two">
        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="card-title">주간 출석 추이</h3>
              <div className="card-sub">파란 선 이번 주 · 점선 지난주 (출석 + 지각)</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-3)" }}>
              30일 출석률 <b style={{ color: "var(--text)" }}>{pctText(attendance.rate_30d)}</b><Info text={def.attendance_rate_30d} />
              <div>직전 30일 {pctText(attendance.rate_prev_30d)}</div>
            </div>
          </div>
          <WeeklyChart thisWeek={attendance.this_week} lastWeek={attendance.last_week} />
        </div>

        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="card-title">미납 집중 관리</h3>
              <div className="card-sub">연체가 긴 순 · 학부모 포털로 바로 안내</div>
            </div>
            <span className="badge danger no-dot">{unpaidList.length}명</span>
          </div>
          {unpaidList.length === 0 ? <div className="empty" style={{ padding: 24 }}>미납 청구서가 없습니다.</div> : (
            <div style={{ display: "grid", gap: 4 }}>
              {unpaidList.slice(0, 5).map((m) => <UnpaidRow key={m.member_id} m={m} onNotify={() => setNotifyTarget(m)} />)}
              {unpaidList.length > 5 && <button className="btn ghost sm no-print" onClick={() => setShowUnpaid(true)}>전체 {unpaidList.length}명 보기 →</button>}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- 반별 / 매출 ---------------- */}
      <div className="dash-eq">
        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 className="card-title">반별 출석률</h3>
              <div className="card-sub">오늘 수업이 있는 반 먼저 · 막대는 오늘(없으면 30일)</div>
            </div>
            <span className="badge primary no-dot">{data.classes.length}개 반</span>
          </div>
          {data.classes.length === 0 ? <div className="empty" style={{ padding: 24 }}>운영 중인 반이 없습니다.</div> : data.classes.map((c) => {
            // 오늘 수업이 있어도 아직 아무도 체크하지 않았으면 0% 대신 '체크 전'으로 표시
            const notStarted = c.scheduled_today && !c.present_today && !(data.attendance?.today?.recorded);
            const rate = c.scheduled_today && !notStarted ? c.rate_today : c.rate_30d;
            return (
              <div className="bar-row" key={c.class_id}>
                <div className="bar-row-head">
                  <div className="label">
                    {c.name}<span className="count">{c.enrolled}명</span>
                    {c.scheduled_today
                      ? <span className="badge primary no-dot" style={{ marginLeft: 6, fontSize: 10 }}>오늘 {c.time_today || "수업"}</span>
                      : <span className="badge gray no-dot" style={{ marginLeft: 6, fontSize: 10 }}>오늘 수업 없음</span>}
                  </div>
                  <div className="value">{notStarted ? <span style={{ fontSize: 12, color: "var(--text-3)" }}>체크 전</span> : pctText(rate)}<span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 6 }}>30일 {pctText(c.rate_30d)}</span></div>
                </div>
                <div className="progress"><div className="progress-fill" style={{ width: `${rate || 0}%` }} /></div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="card-title">월별 매출</h3>
              <div className="card-sub">실제 결제 이력 합계 (카카오페이·현장 수납 포함)</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-3)" }}>
              이번 달 <b style={{ color: "var(--text)" }}>{won(revenue.this_month)}</b>
              <div>지난달 {won(revenue.last_month)}</div>
            </div>
          </div>
          <RevenueBars months={revenue.months} />
        </div>
      </div>

      {/* ---------------- 이탈 위험 / 활동 ---------------- */}
      <div className="dash-eq">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">관심이 필요한 학생<Info text={def.risk} /></h3>
              <div className="card-sub">출석·연체 신호로 계산한 이탈 위험 (규칙 기반)</div>
            </div>
          </div>
          {data.risk_students.length === 0 ? <div className="empty" style={{ padding: 24 }}>위험 신호가 있는 학생이 없습니다.</div> :
            data.risk_students.map((r) => (
              <div className="risk-row" key={r.member_id}>
                <span className="risk-score" style={{ background: r.score >= 60 ? "var(--danger-soft)" : "var(--warning-soft)",
                  color: r.score >= 60 ? "var(--danger-text)" : "var(--warning-text)" }}>{r.score}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{r.reasons.join(" · ")}</div>
                </div>
              </div>
            ))}
        </div>

        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="card-title">최근 활동</h3>
              <div className="card-sub">키오스크·학부모 포털·관리자 동작 로그</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-3)" }}>
              학부모 앱 활성(7일)<Info text={def.parent_active_7d} />
              <div><b style={{ color: "var(--text)" }}>{data.parents.active_7d}</b> / 연결 {data.parents.linked_accounts}가정</div>
            </div>
          </div>
          {data.recent_activity.length === 0 ? <div className="empty" style={{ padding: 24 }}>아직 기록된 활동이 없습니다.</div> :
            data.recent_activity.map((a, i) => (
              <div className="activity-row" key={i}>
                <time>{a.time ? a.time.slice(11, 16) : ""}</time>
                <span className="badge gray no-dot" style={{ fontSize: 10 }}>{a.actor}</span>
                <span style={{ flex: 1 }}>{a.member_name ? <b>{a.member_name} </b> : null}{a.summary || a.action}</span>
              </div>
            ))}
        </div>
      </div>

      {/* ---------------- 공지 / 할 일 ---------------- */}
      <div className="dash-eq">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">최근 공지사항</h3>
              <div className="card-sub">학부모 읽음 현황 포함</div>
            </div>
            <button className="btn ghost sm" onClick={() => navigate("/community?category=NOTICE")}>공지사항으로 →</button>
          </div>
          {notices.length === 0 ? <div className="empty" style={{ padding: 24 }}>등록된 공지사항이 없습니다.</div> : (
            <div style={{ display: "grid", gap: 12 }}>
              {notices.slice(0, 3).map((n) => (
                <div key={n.notice_id} className="notice-item row-click" role="button" tabIndex={0}
                  onClick={() => navigate(`/community?category=NOTICE&open=n${n.notice_id}`)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/community?category=NOTICE&open=n${n.notice_id}`)}
                  style={{ padding: 14, borderRadius: 14, border: "1px solid var(--border)" }}>
                  <div className="notice-meta">
                    {n.is_pinned && <span className="badge primary no-dot">고정</span>}
                    {n.class_name && <span className="badge gray no-dot">{n.class_name}</span>}
                    <span>{n.author}</span><span>·</span><span>{new Date(n.created_at).toLocaleDateString("ko-KR")}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-3)" }}>읽음 {n.read_count}/{n.target_count}가정</span>
                  </div>
                  <h4 style={{ margin: "6px 0 4px", fontSize: 15 }}>{n.title}</h4>
                  <div style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 64, overflow: "hidden" }}>{n.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 className="card-title">오늘의 업무</h3>
              <div className="card-sub">계정별로 저장 · 시간을 넣으면 정시에 알림</div>
            </div>
            <div className="no-print" style={{ display: "flex", gap: 6 }}>
              <button className="btn ghost sm" onClick={() => setShowAllTodos(true)}>전체 {todos.length}</button>
              <button className="btn ghost sm" onClick={clearDone}>완료 정리</button>
              <button className="btn sm" onClick={() => setTodoModal({ text: "", due_time: "", tag: "primary" })}>+ 추가</button>
            </div>
          </div>
          {todos.length === 0 ? <div className="empty" style={{ padding: 24 }}>업무가 없습니다. + 추가로 등록해 보세요.</div>
            : todos.slice(0, 6).map((t) => <TodoRow key={t.todo_id} t={t} onToggle={toggleTodo} />)}
        </div>
      </div>

      {notifyTarget && <NotifyModal member={notifyTarget} brandName={brand?.name} onClose={() => setNotifyTarget(null)} />}
      {showUnpaid && (
        <div className="modal-backdrop" onClick={() => setShowUnpaid(false)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>미납 학생 전체 ({unpaidList.length}명 · {won(billing.unpaid_total)})</h3>
            <div style={{ maxHeight: 440, overflowY: "auto" }}>
              {unpaidList.map((m) => <UnpaidRow key={m.member_id} m={m} onNotify={() => { setShowUnpaid(false); setNotifyTarget(m); }} />)}
            </div>
            <div className="modal-actions"><button className="btn ghost" onClick={() => setShowUnpaid(false)}>닫기</button></div>
          </div>
        </div>
      )}
      {todoModal && <TodoModal initial={todoModal} onClose={() => setTodoModal(null)} onSave={saveTodo} />}
      {showAllTodos && (
        <div className="modal-backdrop" onClick={() => setShowAllTodos(false)}>
          <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>업무 전체 ({todos.length})</h3>
              <button className="btn sm" onClick={() => { setShowAllTodos(false); setTodoModal({ text: "", due_time: "", tag: "primary" }); }}>+ 추가</button>
            </div>
            <div style={{ maxHeight: 440, overflowY: "auto" }}>
              {todos.map((t) => (
                <TodoRow key={t.todo_id} t={t} onToggle={toggleTodo}
                  actions={<>
                    <button className="btn ghost sm" onClick={() => { setShowAllTodos(false); setTodoModal(t); }}>수정</button>
                    <button className="btn danger sm" onClick={() => removeTodo(t)}>삭제</button>
                  </>} />
              ))}
              {todos.length === 0 && <div className="empty">등록된 업무가 없습니다.</div>}
            </div>
            <div className="modal-actions"><button className="btn ghost" onClick={() => setShowAllTodos(false)}>닫기</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function UnpaidRow({ m, onNotify }) {
  return (
    <div className="list-row" style={{ alignItems: "center", padding: "8px 0" }}>
      <div className="avatar sm">{m.name?.[0]}</div>
      <div className="body">
        <div className="title">{m.name} <span style={{ fontWeight: 700, color: "var(--danger)" }}>{won(m.amount)}</span></div>
        <div className="meta">
          {m.count}건 · {m.overdue_days > 0 ? `${m.overdue_days}일 연체` : m.oldest_due ? `기한 ${m.oldest_due}` : "기한 없음"}
          {!m.parent_linked && " · 학부모 미연결"}
        </div>
      </div>
      <button className="btn ghost sm no-print" onClick={onNotify} title={m.parent_linked ? "학부모 포털로 미납 안내" : "학부모가 포털에 자녀를 연결해야 받을 수 있습니다"}>
        🔔 안내
      </button>
    </div>
  );
}

function TodoRow({ t, onToggle, actions }) {
  return (
    <div className="timeline-row" style={{ display: "flex", alignItems: "center", gap: 10, opacity: t.done ? 0.55 : 1 }}>
      <input type="checkbox" checked={t.done} onChange={() => onToggle(t)} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />
      <span className="time" style={{ minWidth: 44, textDecoration: t.done ? "line-through" : "none" }}>{t.due_time || "—"}</span>
      <span className="body" style={{ flex: 1, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
      <span className={`badge ${t.done ? "gray" : t.tag} no-dot`}>{TAGS[t.tag] || "업무"}</span>
      {actions}
    </div>
  );
}

function TodoModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (form.text.trim()) onSave(form); }}>
        <h3 style={{ marginTop: 0 }}>{form.todo_id ? "업무 수정" : "새 업무"}</h3>
        <div className="form-row"><label>시간 (선택 — 정시에 알림)</label>
          <input type="time" className="input" value={form.due_time} onChange={(e) => setForm({ ...form, due_time: e.target.value })} /></div>
        <div className="form-row"><label>업무 내용</label>
          <input className="input" autoFocus maxLength={200} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></div>
        <div className="form-row"><label>분류</label>
          <select className="select" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
            {Object.entries(TAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={!form.text.trim()}>저장</button>
        </div>
      </form>
    </div>
  );
}

function NotifyModal({ member, brandName, onClose }) {
  const [message, setMessage] = useState(
    `안녕하세요, ${member.name} 학생 보호자님. ${brandName || "시설"}입니다.\n미납 수강료 ${member.amount.toLocaleString("ko-KR")}원이 확인되어 안내드립니다. 학부모 포털 '결제' 탭에서 바로 결제하실 수 있습니다.`);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { setResult(await notifyMemberParents(member.member_id, { title: "미납 수강료 안내", message, kind: "UNPAID" })); }
    catch (e) { setResult({ sent: 0, message: errorText(e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>미납 안내 보내기</h3>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 0 }}>
          {member.name} 학생에게 연결된 학부모 계정의 <b>알림함</b>으로 보냅니다. (문자 발송 아님)
        </p>
        <textarea className="input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000}
          style={{ width: "100%", resize: "vertical", padding: 10, lineHeight: 1.5 }} />
        {result && <div className={result.sent ? "notice-ok" : "error-banner"} style={{ marginTop: 10, padding: 10, borderRadius: 8,
          background: result.sent ? "var(--success-soft)" : undefined, color: result.sent ? "var(--success-text)" : undefined }}>{result.message}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{result ? "닫기" : "취소"}</button>
          {!result?.sent && <button className="btn" onClick={send} disabled={busy || !message.trim()}>{busy ? "보내는 중…" : "알림 보내기"}</button>}
        </div>
      </div>
    </div>
  );
}

/* 이번 주 vs 지난주 출석 라인 차트 (SVG) */
function WeeklyChart({ thisWeek, lastWeek }) {
  const [hover, setHover] = useState(null);
  const W = 600, H = 220, L = 40, R = 20, T = 30, B = 30;
  const max = Math.max(5, ...thisWeek.map((d) => d.total), ...lastWeek.map((d) => d.total));
  const x = (i) => L + ((W - L - R) * i) / 6;
  const y = (v) => T + (H - T - B) - (v / max) * (H - T - B);
  const path = (rows) => rows.map((d, i) => `${i ? "L" : "M"} ${x(i)} ${y(d.total)}`).join(" ");
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const item = hover && (hover.week === "this" ? thisWeek : lastWeek)[hover.i];
  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="주간 출석 추이">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={L - 8} y={y(v) + 4} fontSize="11" fill="var(--text-3)" textAnchor="end">{v}</text>
          </g>
        ))}
        <path d={path(lastWeek)} fill="none" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={`${path(thisWeek)} L ${x(6)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill="rgba(59,130,246,0.06)" />
        <path d={path(thisWeek)} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinejoin="round" />
        {[["last", lastWeek], ["this", thisWeek]].map(([week, rows]) => rows.map((d, i) => (
          <g key={`${week}${i}`} onMouseEnter={() => setHover({ week, i })} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
            <circle cx={x(i)} cy={y(d.total)} r={week === "this" ? 4 : 3} fill="var(--surface)" stroke={week === "this" ? "#3B82F6" : "var(--text-3)"} strokeWidth="2" />
            <circle cx={x(i)} cy={y(d.total)} r="14" fill="transparent" />
          </g>
        )))}
        {thisWeek.map((d, i) => (
          <text key={d.date} x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill={i === 6 ? "var(--primary)" : "var(--text-2)"} fontWeight={i === 6 ? 700 : 400}>
            {d.weekday}{i === 6 ? "(오늘)" : ""}
          </text>
        ))}
        {item && (
          <g transform={`translate(${Math.min(Math.max(x(hover.i), 110), W - 110)}, ${Math.max(y(item.total) - 14, 32)})`}>
            <rect x="-100" y="-26" width="200" height="22" rx="5" fill="var(--text)" opacity="0.9" />
            <text x="0" y="-11" fontSize="11" fill="var(--surface)" textAnchor="middle">
              {hover.week === "this" ? "이번 주" : "지난주"} {item.date.slice(5)} · 출석 {item.present} 지각 {item.late} 결석 {item.absent}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* 최근 6개월 매출 막대 (SVG) */
function RevenueBars({ months }) {
  const W = 560, H = 210, L = 10, B = 34, T = 24;
  const max = Math.max(1, ...months.map((m) => m.amount));
  const bw = (W - L * 2) / months.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="월별 매출">
      <line x1={L} x2={W - L} y1={H - B} y2={H - B} stroke="var(--border)" />
      {months.map((m, i) => {
        const h = ((H - B - T) * m.amount) / max;
        const last = i === months.length - 1;
        return (
          <g key={m.month}>
            <rect x={L + i * bw + bw * 0.2} y={H - B - h} width={bw * 0.6} height={Math.max(h, 1)} rx="5"
              fill={last ? "#3B82F6" : "rgba(59,130,246,0.35)"} />
            <text x={L + i * bw + bw / 2} y={H - B - h - 6} fontSize="11" textAnchor="middle" fill="var(--text-2)">
              {m.amount ? `${Math.round(m.amount / 10000)}만` : ""}
            </text>
            <text x={L + i * bw + bw / 2} y={H - 12} fontSize="12" textAnchor="middle" fill={last ? "var(--primary)" : "var(--text-2)"} fontWeight={last ? 700 : 400}>
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

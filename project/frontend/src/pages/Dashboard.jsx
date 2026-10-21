import { useEffect, useState, useMemo } from "react";
import { fetchDashboardStats, fetchUnpaidMembers, fetchAttendances, fetchNotices, fetchMembers, fetchClasses } from "../api";

// 실행 시점 기준으로 이번주(offset=0)와 지난주(offset=7) 날짜 정보를 빌드하는 헬퍼 함수
const getPast7DaysInfo = (offset = 0) => {
  const result = [];
  const daysOfWeek = ["일", "월", "화", "수", "목", "금", "토"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i - offset);
    const dateStr = d.toISOString().slice(0, 10);
    const label = daysOfWeek[d.getDay()];
    result.push({ date: dateStr, label });
  }
  return result;
};

export default function Dashboard({ onNavigate = () => {} }) {
  const [stats, setStats] = useState(null);
  const [unpaid, setUnpaid] = useState([]);
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState(null);
  const [classRates, setClassRates] = useState([]);
  
  // 학생 관리(Members) 화면과 정확히 일치하는 활성 학생 수 상태 관리(State Management)
  const [totalActiveCount, setTotalActiveCount] = useState(0);
  
  // 실시간 기상 상태 관리
  const [weather, setWeather] = useState(null);
  
  // 이번주 및 지난주 출결 상세 객체 배열 상태 관리
  const [thisWeekData, setThisWeekData] = useState([]);
  const [lastWeekData, setLastWeekData] = useState([]);

  // 모달 제어 상태
  const [isUnpaidModalOpen, setIsUnpaidModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  
  // 알림 전송 모달 관련 상태 추가
  const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [notifyMessage, setNotifyMessage] = useState("");

  // ⭐ [수정] 할 일 목록 상태 초기화 시 로컬 스토리지(Local Storage) 데이터를 먼저 검사합니다.
  const [todos, setTodos] = useState(() => {
    const savedTodos = localStorage.getItem("dashboard_todos");
    return savedTodos ? JSON.parse(savedTodos) : [
      { id: 1, time: "09:00", text: "오전 출석부 확인 및 미출석자 연락", tag: "primary", tagLabel: "업무" },
      { id: 2, time: "13:00", text: "신규 등록 학생 상담 자료 준비", tag: "success", tagLabel: "상담" },
    ];
  });
  
  const [editingTodoId, setEditingTodoId] = useState(null);
  const [todoInput, setTodoInput] = useState({ time: "", text: "", tag: "primary", tagLabel: "업무" });
  const [isAddTodoModalOpen, setIsAddTodoModalOpen] = useState(false);

  // 이번주/지난주 타임라인 메모이제이션(Memoization)
  const thisWeekDays = useMemo(() => getPast7DaysInfo(0), []);
  const lastWeekDays = useMemo(() => getPast7DaysInfo(7), []);

  const dateLabel = useMemo(() => {
    const d = new Date();
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
  }, []);


  // ⭐ [추가] 할 일 목록(todos) 상태가 변경될 때마다 로컬 스토리지에 자동으로 저장합니다.
  useEffect(() => {
    localStorage.setItem("dashboard_todos", JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    // 1. 기상청 외부 오픈 API 통신 (용인 지역 기준 위경도 설정)
    fetch("https://api.open-meteo.com/v1/forecast?latitude=37.2410&longitude=127.1774&current_weather=true&timezone=Asia/Seoul")
      .then(res => res.json())
      .then(data => {
        if (data?.current_weather) {
          const temp = Math.round(data.current_weather.temperature);
          const code = data.current_weather.weathercode;
          let desc = "맑음", emoji = "☀️";
          
          if ([1, 2, 3].includes(code)) { desc = "구름 조금"; emoji = "⛅"; }
          else if ([45, 48].includes(code)) { desc = "안개"; emoji = "🌫️"; }
          else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) { desc = "비"; emoji = "🌧️"; }
          else if ([71, 73, 75].includes(code)) { desc = "눈"; emoji = "❄️"; }
          else if ([95, 96, 99].includes(code)) { desc = "뇌우"; emoji = "⚡"; }
          
          setWeather({ temp, desc, emoji });
        }
      })
      .catch(() => setWeather({ temp: 22, desc: "맑음", emoji: "☀️" }));

    // 출결 상세 분기 매핑 함수
    const mapAttendanceList = (day) => 
      fetchAttendances({ target_date: day.date })
        .then(list => {
          if (!Array.isArray(list)) return { present: 0, absent: 0, late: 0, total: 0 };
          const present = list.filter(a => a.status === "PRESENT").length;
          const absent = list.filter(a => a.status === "ABSENT").length;
          const late = list.filter(a => a.status === "LATE").length;
          return { present, absent, late, total: present + late };
        })
        .catch(() => ({ present: 0, absent: 0, late: 0, total: 0 }));

    const thisWeekPromises = thisWeekDays.map(day => mapAttendanceList(day));
    const lastWeekPromises = lastWeekDays.map(day => mapAttendanceList(day));

    // 2. 통합 데이터 병렬 비동기 요청
    Promise.all([
      fetchDashboardStats(),
      fetchUnpaidMembers(),
      fetchNotices(),
      fetchMembers({ status: "ACTIVE" }),
      Promise.all(thisWeekPromises),
      Promise.all(lastWeekPromises)
    ])
      .then(([statsData, unpaidData, noticesData, membersData, twCounts, lwCounts]) => {
        setStats(statsData); 
        setUnpaid(unpaidData); 
        setNotices(noticesData);
        
        if (Array.isArray(membersData)) {
          setTotalActiveCount(membersData.length);
        } else {
          setTotalActiveCount(statsData?.total_active || 29);
        }
        
        setThisWeekData(twCounts);
        setLastWeekData(lwCounts);
      })
      .catch((e) => setError(e.message));
  }, [thisWeekDays, lastWeekDays]);

  const won = (n) => (n / 10000).toLocaleString("ko-KR") + "만원";

const loadClassAttendance = async () => {
    const today = new Date().toISOString().slice(0, 10);

    try {
      // 1. 수업 목록(학생 정보 포함)과 오늘의 출석 데이터를 호출
      // main.py의 list_classes는 이미 Enrollments 정보를 포함한 학생 목록을 반환합니다.
      const [allClasses, todayAttendances] = await Promise.all([
        fetchClasses(),
        fetchAttendances({ target_date: today })
      ]);

      // 2. 수업 데이터와 출석 데이터 매핑
      const calculatedRates = allClasses.map((cls) => {
        // cls.students는 백엔드에서 Enrollments를 통해 연결된 학생 목록입니다.
        const total = cls.student_count || 0;
        
        // 오늘 출석(PRESENT)한 학생 중, 해당 수업에 등록된 학생(cls.students) 찾기
        const presentCount = todayAttendances.filter(a => 
          a.status === "PRESENT" && 
          cls.students.some(s => s.member_id === a.member_id)
        ).length;

        // 출석률 계산
        const rate = total > 0 ? Math.round((presentCount / total) * 100) : 0;

        return {
          name: cls.name,
          count: total,
          rate: rate
        };
      });

      setClassRates(calculatedRates);
    } catch (err) {
      console.error("반별 출석률 데이터 로드 실패:", err);
    }
  };

  // 대시보드 진입 시마다 데이터 갱신
  useEffect(() => {
    loadClassAttendance();
  }, []);

  const handleAddOrUpdateTodo = (e) => {
    e.preventDefault();
    if (!todoInput.text) return alert("업무 내용을 입력해주세요!");
    const tagLabels = { primary: "업무", success: "출석", warning: "지각", danger: "긴급" };
    const targetLabel = tagLabels[todoInput.tag] || "업무";

    if (editingTodoId) {
      setTodos(todos.map(t => t.id === editingTodoId ? { ...t, ...todoInput, tagLabel: targetLabel } : t));
      setEditingTodoId(null);
    } else {
      setTodos([...todos, { id: Date.now(), ...todoInput, tagLabel: targetLabel, done: false }]);
    }
    setTodoInput({ time: "", text: "", tag: "primary", tagLabel: "업무" });
    setIsAddTodoModalOpen(false);
  };

  const handleToggleDone = (id) => {
    setTodos(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleDeleteChecked = () => {
    const checkedCount = todos.filter(t => t.done).length;
    if (checkedCount === 0) return alert("선택된 항목이 없습니다.");
    if (!window.confirm(`선택된 ${checkedCount}개의 업무를 삭제하시겠습니까?`)) return;
    setTodos(todos.filter(t => !t.done));
  };

  const handleDeleteAll = () => {
    if (todos.length === 0) return alert("업무 목록이 비어 있습니다.");
    if (!window.confirm("모든 업무를 삭제하시겠습니까?")) return;
    setTodos([]);
  };

  // 알림 창을 열기 위한 헬퍼 핸들러 함수
  const openNotification = (member, amount) => {
    setSelectedMember(member);
    setNotifyMessage(`[안내] 안녕하세요, ${member.name} 보호자님. 학원 관리 시스템입니다. 이번 달 미납 금액(${amount})이 확인되어 안내 문자 드립니다. 확인 후 납부 부탁드립니다.`);
    setIsNotifyModalOpen(true);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>대시보드</h2>
          <p className="page-subtitle" style={{ margin: "4px 0 0 0" }}>
            {dateLabel} · 김선생님 환영합니다
          </p>
        </div>
        
        {weather && (
          <div style={{
            display: "flex", alignItems: "center", gap: "8px", 
            background: "var(--surface)", border: "1px solid var(--border)", 
            padding: "8px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: "500"
          }}>
            <span>{weather.emoji}</span>
            <span style={{ color: "var(--text)" }}>오늘 용인 {weather.temp}°C</span>
            <span style={{ color: "var(--text-3)", fontSize: "11px" }}>|</span>
            <span style={{ color: "var(--text-2)" }}>{weather.desc}</span>
          </div>
        )}
      </div>

      {error && <div className="error-banner">서버 연결 실패: {error}</div>}

      {/* 통계 레이아웃 그리드 */}
      <div className="stat-grid" style={{ marginTop: "16px" }}>
        {/* 전체 학생 */}
        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">전체 학생</span>
            <span className="stat-trend up">↑ 4.2%</span>
          </div>
          <div className="stat-value num">
            {totalActiveCount || "-"}<span className="unit">명</span>
          </div>
          <div className="stat-sub">지난달 대비 ＋６명</div>
        </div>

        {/* 오늘 출석 */}
        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">오늘 출석</span>
            <span className="stat-trend up">↑ 1.8%</span>
          </div>
          <div className="stat-value num primary">
            {stats?.today_present ?? "-"}<span className="unit">명</span>
          </div>
          <div className="stat-sub">결석 {stats?.today_absent ?? 0}명 · 당일 출석 집계 현황</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">회비 미납</span>
            <span className="stat-trend down">↓ 12%</span>
          </div>
          <div className="stat-value num danger">
            {stats?.unpaid_count ?? "-"}<span className="unit">건</span>
          </div>
          <div className="stat-sub">총 {stats ? won(stats.month_revenue || 3240000) : "-"}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-head">
            <span className="stat-label">이달 수납률</span>
            <span className="stat-trend up">↑ 3.1%</span>
          </div>
          <div className="stat-value num success">87<span className="unit">%</span></div>
          <div className="stat-sub">목표 수납률 95%</div>
        </div>
      </div>

      {/* 주간 출석 현황 + 미납 집중 카드 */}
      <div className="row cols-2">
        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="card-title">주간 출석 현황</h3>
              <div className="card-sub">이번 주 실제 출석 데이터를 한눈에 확인합니다.</div>
            </div>
            <div style={{ display: "grid", gap: "4px", textAlign: "right", fontSize: "12px", color: "var(--text-3)" }}>
              <span>오늘 출석 {stats?.today_present ?? 0}명</span>
              <span>결석 {stats?.today_absent ?? 0}명</span>
              <span>활동 학생 {stats?.total_active ?? totalActiveCount}명</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: "14px", marginBottom: "18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ background: "var(--surface-2)", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-3)", marginBottom: "8px" }}>출석률</div>
                <div style={{ fontSize: "28px", fontWeight: 700 }}>{stats?.today_present != null && stats?.today_absent != null ? `${stats.today_present + stats.today_absent === 0 ? 0 : Math.round((stats.today_present / Math.max(1, stats.today_present + stats.today_absent)) * 100)}%` : "-"}</div>
                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-3)" }}>
                  오늘 출석 대비 결석 비율을 보여줍니다.
                </div>
              </div>
              <div style={{ background: "var(--surface-2)", borderRadius: "12px", padding: "14px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-3)", marginBottom: "8px" }}>이번 달 매출</div>
                <div style={{ fontSize: "28px", fontWeight: 700 }}>{stats?.month_revenue ? `${(stats.month_revenue).toLocaleString()}원` : "-"}</div>
                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-3)" }}>
                  실결제 이력을 기반으로 계산됩니다.
                </div>
              </div>
            </div>
          </div>

          <WeeklyChart 
            last7DaysInfo={thisWeekDays} 
            thisWeekData={thisWeekData} 
            lastWeekData={lastWeekData}
            maxStudents={Math.max(stats?.total_active ?? totalActiveCount, 10)} 
          />
        </div>

        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="card-title">회비 미납 집중</h3>
              <div className="card-sub">미납 학생과 빠른 알림 전송</div>
            </div>
            <span className="badge danger no-dot">{unpaid.length}건</span>
          </div>

          {unpaid.length === 0 ? (
            <div className="empty" style={{ padding: "24px" }}>미납 학생이 없습니다. 안정적인 현황입니다.</div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {unpaid.slice(0, 4).map((m, i) => (
                <div key={m.member_id} className="list-row" style={{ alignItems: "center" }}>
                  <div className="avatar sm">{m.name?.[0]}</div>
                  <div className="body">
                    <div className="title">{m.name}</div>
                    <div className="meta">최종 납부일: {m.payment_date || "정보 없음"}</div>
                  </div>
                  <div className="right danger" style={{ fontWeight: "600" }}>미납</div>
                  <button className="btn ghost sm" onClick={() => openNotification(m, "회비 미납")}>📞</button>
                </div>
              ))}
              <button className="btn ghost sm" onClick={() => setIsUnpaidModalOpen(true)}>
                전체 {unpaid.length}건 보기 →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="row cols-2-eq">
        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 className="card-title">반별 출석률</h3>
              <div className="card-sub">오늘 기준으로 반별 출석 현황을 비교합니다.</div>
            </div>
            <span className="badge primary no-dot">{classRates.length}개 반</span>
          </div>
          {classRates.length === 0 ? (
            <div className="empty" style={{ padding: "24px" }}>등록된 반 정보가 없습니다.</div>
          ) : classRates.map((c) => (
            <div className="bar-row" key={c.name}>
              <div className="bar-row-head">
                <div className="label">
                  {c.name}
                  <span className="count">{c.count}명</span>
                </div>
                <div className="value">{c.rate}%</div>
              </div>
              <div className="progress"><div className="progress-fill" style={{ width: `${c.rate}%` }} /></div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">최근 공지사항</h3>
              <div className="card-sub">학부모와 공유된 최신 공지</div>
            </div>
          </div>
          {notices.length === 0 ? (
            <div className="empty" style={{ padding: "24px" }}>등록된 공지사항이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: "14px" }}>
              {notices.slice(0, 3).map((n) => (
                <div key={n.notice_id} className="notice-item" style={{ padding: "14px", borderRadius: "14px", border: "1px solid var(--border)" }}>
                  <div className="notice-meta">
                    {n.is_pinned && <span className="badge primary no-dot">고정</span>}
                    <span>{n.author}</span><span>·</span><span>{new Date(n.created_at).toLocaleDateString("ko-KR")}</span>
                  </div>
                  <h4 style={{ margin: "6px 0 8px", fontSize: "15px" }}>{n.title}</h4>
                  <div style={{ color: "var(--text-2)", fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="card-title">오늘의 업무</h3>
            <div className="card-sub">체크리스트로 핵심 업무를 관리하세요.</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <a className="card-sub" href="#" style={{ color: "var(--primary)", textDecoration: "none", fontSize: 13, padding: "4px 8px" }}
              onClick={(e) => { e.preventDefault(); setIsActivityModalOpen(true); }}>
              전체 보기
            </a>
            <button className="btn ghost sm" onClick={handleDeleteChecked}
              style={{ opacity: todos.filter(t => t.done).length === 0 ? 0.4 : 1 }}>
              선택 삭제 ({todos.filter(t => t.done).length})
            </button>
            <button className="btn danger sm" onClick={handleDeleteAll}>
              전체 삭제
            </button>
            <button className="btn sm" onClick={() => { setEditingTodoId(null); setTodoInput({ time: "", text: "", tag: "primary", tagLabel: "업무" }); setIsAddTodoModalOpen(true); }}>
              + 업무 추가
            </button>
          </div>
        </div>
        {todos.length === 0 ? (
          <div className="empty" style={{ padding: "24px" }}>업무가 없습니다. + 업무 추가 버튼으로 등록해보세요.</div>
        ) : todos.slice(0, 5).map((t) => (
          <div key={t.id} className="timeline-row" style={{ display: "flex", alignItems: "center", gap: 10, opacity: t.done ? 0.6 : 1, transition: "opacity 0.2s" }}>
            <input
              type="checkbox"
              checked={!!t.done}
              onChange={() => handleToggleDone(t.id)}
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--primary)", flexShrink: 0 }}
            />
            <span className="time" style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--text-3)" : undefined }}>{t.time}</span>
            <span className="body" style={{ flex: 1, textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--text-3)" : undefined }}>{t.text}</span>
            <span className={`badge ${t.done ? "gray" : t.tag} no-dot`}>{t.tagLabel}</span>
          </div>
        ))}
        {todos.length > 5 && (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <a href="#" style={{ fontSize: 12, color: "var(--text-3)" }} onClick={(e) => { e.preventDefault(); setIsActivityModalOpen(true); }}>
              +{todos.length - 5}개 더 보기
            </a>
          </div>
        )}
      </div>


      {/* 미납 내역 모달 */}
      {isUnpaidModalOpen && (
        <div className="modal-overlay" style={modalOverlayStyle} onClick={() => setIsUnpaidModalOpen(false)}>
          <div className="modal-content" style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div className="card-head" style={{ marginBottom: "20px" }}>
              <h3 className="card-title">회비 미납자 전체 명단</h3>
              <button className="btn ghost sm" onClick={() => setIsUnpaidModalOpen(false)}>닫기</button>
            </div>
            <div style={{ maxHeight: "400px", overflowY: "auto" }}>
              {unpaid.map((m, i) => (
                <div key={m.member_id} className="list-row" style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                  <div className="avatar sm">{m.name?.[0]}</div>
                  <div className="body" style={{ marginLeft: "12px", flex: 1 }}>
                    <div className="title" style={{ fontWeight: "bold" }}>{m.name} ({m.age}세)</div>
                    <div className="meta" style={{ fontSize: "12px", color: "var(--text-2)" }}>
                      최종 납부일: {m.payment_date} · 금액: {(28 + i * 4)}만원
                    </div>
                  </div>
                  <span style={{ fontSize: 18, cursor: "pointer" }} onClick={() => openNotification(m, `${28 + i * 4}만원`)}>📞</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 알림 보내는 모달 창 */}
      {isNotifyModalOpen && selectedMember && (
        <div className="modal-overlay" style={modalOverlayStyle} onClick={() => { setIsNotifyModalOpen(false); setSelectedMember(null); }}>
          <div className="modal-content" style={{ ...modalContentStyle, width: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div className="card-head" style={{ marginBottom: "18px" }}>
              <h3 className="card-title" style={{ fontSize: "16px" }}>미납 안내 알림 전송</h3>
              <button className="btn ghost sm" onClick={() => { setIsNotifyModalOpen(false); setSelectedMember(null); }}>취소</button>
            </div>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px", color: "var(--text-2)" }}>수신 대상</label>
              <input className="input" type="text" value={`${selectedMember.name} 원생 보호자님`} disabled style={{ width: "100%", background: "var(--surface-2)", cursor: "not-allowed" }} />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px", color: "var(--text-2)" }}>알림 메시지 내용</label>
              <textarea 
                className="input" 
                rows="5" 
                value={notifyMessage} 
                onChange={(e) => setNotifyMessage(e.target.value)} 
                style={{ width: "100%", padding: "10px", fontSize: "13px", lineHeight: "1.5", resize: "none" }} 
              />
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => { setIsNotifyModalOpen(false); setSelectedMember(null); }}>취소</button>
              <button className="btn primary" onClick={() => {
                alert(`${selectedMember.name} 학부모님께 미납 알림 문자 메시지가 전송되었습니다.`);
                setIsNotifyModalOpen(false);
                setSelectedMember(null);
              }}>알림 전송하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 업무 추가/수정 모달 */}
      {isAddTodoModalOpen && (
        <div className="modal-backdrop" onClick={() => { setIsAddTodoModalOpen(false); setEditingTodoId(null); }}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 18px" }}>{editingTodoId ? "업무 수정" : "새 업무 추가"}</h3>
            <form onSubmit={handleAddOrUpdateTodo}>
              <div className="form-row">
                <label>시간 <span style={{ fontWeight: 400, color: "var(--text-3)", fontSize: 11 }}>(선택)</span></label>
                <input type="time" className="input" value={todoInput.time}
                  onChange={(e) => setTodoInput({ ...todoInput, time: e.target.value })} />
              </div>
              <div className="form-row">
                <label>업무 내용</label>
                <input type="text" placeholder="해야 할 일을 입력하세요" className="input" value={todoInput.text}
                  onChange={(e) => setTodoInput({ ...todoInput, text: e.target.value })} />
              </div>
              <div className="form-row">
                <label>분류</label>
                <select className="select" value={todoInput.tag} onChange={(e) => setTodoInput({ ...todoInput, tag: e.target.value })}>
                  <option value="primary">업무</option>
                  <option value="success">출석</option>
                  <option value="warning">지각</option>
                  <option value="danger">긴급</option>
                </select>
              </div>
              <div className="modal-actions" style={{ marginTop: 20 }}>
                <button type="button" className="btn ghost" onClick={() => { setIsAddTodoModalOpen(false); setEditingTodoId(null); }}>취소</button>
                <button type="submit" className="btn">{editingTodoId ? "저장" : "추가"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 업무 전체 보기 모달 */}
      {isActivityModalOpen && (
        <div className="modal-backdrop" onClick={() => { setIsActivityModalOpen(false); setEditingTodoId(null); }}>
          <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0 }}>업무 전체 목록 ({todos.length}개)</h3>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn ghost sm" onClick={handleDeleteChecked}>선택 삭제 ({todos.filter(t => t.done).length})</button>
                <button className="btn danger sm" onClick={handleDeleteAll}>전체 삭제</button>
                <button className="btn sm" onClick={() => { setIsActivityModalOpen(false); setEditingTodoId(null); setTodoInput({ time: "", text: "", tag: "primary", tagLabel: "업무" }); setIsAddTodoModalOpen(true); }}>+ 업무 추가</button>
              </div>
            </div>

            <div style={{ maxHeight: 440, overflowY: "auto" }}>
              {todos.length === 0 ? (
                <div className="empty">등록된 업무가 없습니다.</div>
              ) : todos.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid var(--border)", opacity: t.done ? 0.55 : 1, transition: "opacity 0.2s" }}>
                  <input
                    type="checkbox"
                    checked={!!t.done}
                    onChange={() => handleToggleDone(t.id)}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--primary)", flexShrink: 0 }}
                  />
                  <span style={{ minWidth: 48, fontWeight: 600, fontSize: 13, color: t.done ? "var(--text-3)" : "var(--text-2)", textDecoration: t.done ? "line-through" : "none" }}>{t.time}</span>
                  <span style={{ flex: 1, fontSize: 14, color: t.done ? "var(--text-3)" : "var(--text)", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                  <span className={`badge ${t.done ? "gray" : t.tag} no-dot`} style={{ flexShrink: 0 }}>{t.tagLabel}</span>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button className="btn ghost sm" style={{ padding: "2px 8px" }} onClick={() => {
                      setIsActivityModalOpen(false);
                      setEditingTodoId(t.id);
                      setTodoInput({ time: t.time, text: t.text, tag: t.tag, tagLabel: t.tagLabel });
                      setIsAddTodoModalOpen(true);
                    }}>수정</button>
                    <button className="btn danger sm" style={{ padding: "2px 8px" }} onClick={() => setTodos(todos.filter(todo => todo.id !== t.id))}>삭제</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={() => { setIsActivityModalOpen(false); setEditingTodoId(null); }}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── 이중 데이터 정합 SVG 비교 라인 차트 컴포넌트 ─── */
function WeeklyChart({ last7DaysInfo, thisWeekData, lastWeekData, maxStudents }) {
  const [hovered, setHovered] = useState({ week: null, index: null });
  
  const W = 600, H = 220, PAD_L = 45, PAD_R = 25, PAD_T = 35, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  
  const min = 0;
  
  const max = useMemo(() => {
    const thisMax = thisWeekData.length > 0 ? Math.max(...thisWeekData.map(d => d.total)) : 0;
    const lastMax = lastWeekData.length > 0 ? Math.max(...lastWeekData.map(d => d.total)) : 0;
    return Math.max(maxStudents, thisMax, lastMax, 10);
  }, [maxStudents, thisWeekData, lastWeekData]);
  
  const x = (i) => PAD_L + (innerW * i) / 6;
  const y = (v) => PAD_T + innerH - ((v - min) / (max - min)) * innerH;
  
  const linePath = (data) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.total)}`).join(" ");

  const yTicks = [];
  const step = Math.ceil(max / 4) || 1;
  for (let i = 0; i <= max; i += step) { yTicks.push(i); }
  if (!yTicks.includes(max)) yTicks.push(max);

  const hoveredItem = hovered.week && hovered.index !== null 
    ? (hovered.week === "this" ? thisWeekData[hovered.index] : lastWeekData[hovered.index]) 
    : null;

  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
        {/* Y축 그리드 격자선 */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={PAD_L - 8} y={y(v) + 4} fontSize="11" fill="var(--text-3)" textAnchor="end">{v}명</text>
          </g>
        ))}
        
        {/* 지난주 출석 라인 차트 */}
        {lastWeekData.length > 0 && (
          <path d={linePath(lastWeekData)} fill="none" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* 이번주 영역 음영 */}
        {thisWeekData.length > 0 && (
          <path
            d={`${linePath(thisWeekData)} L ${x(thisWeekData.length - 1)} ${PAD_T + innerH} L ${x(0)} ${PAD_T + innerH} Z`}
            fill="rgba(59,130,246,0.05)"
          />
        )}
        
        {/* 이번주 출석 본선 트랙 */}
        {thisWeekData.length > 0 && (
          <path d={linePath(thisWeekData)} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        
        {/* 지난주 인터랙션 포인트 */}
        {lastWeekData.map((d, i) => (
          <g key={`last-${i}`}>
            <circle
              cx={x(i)}
              cy={y(d.total)}
              r={hovered.week === "last" && hovered.index === i ? "5" : "3"}
              fill="white"
              stroke="var(--text-3)"
              strokeWidth="2"
              style={{ transition: "all 0.15s ease-in-out" }}
            />
            <circle
              cx={x(i)}
              cy={y(d.total)}
              r="14"
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered({ week: "last", index: i })}
              onMouseLeave={() => setHovered({ week: null, index: null })}
            />
          </g>
        ))}

        {/* 이번주 인터랙션 포인트 */}
        {thisWeekData.map((d, i) => (
          <g key={`this-${i}`}>
            <circle
              cx={x(i)}
              cy={y(d.total)}
              r={hovered.week === "this" && hovered.index === i ? "6" : "4"}
              fill="white"
              stroke="#3B82F6"
              strokeWidth={hovered.week === "this" && hovered.index === i ? "3" : "2"}
              style={{ transition: "all 0.15s ease-in-out" }}
            />
            <circle
              cx={x(i)}
              cy={y(d.total)}
              r="14"
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered({ week: "this", index: i })}
              onMouseLeave={() => setHovered({ week: null, index: null })}
            />
          </g>
        ))}
        
        {/* X축 요일 라벨 */}
        {last7DaysInfo.map((d, i) => (
          <text 
            key={i} 
            x={x(i)} 
            y={H - 6} 
            fontSize="11" 
            fill={i === 6 ? "var(--primary)" : "var(--text-2)"} 
            fontWeight={i === 6 ? "bold" : "normal"} 
            textAnchor="middle"
          >
            {d.label}
          </text>
        ))}

        {/* 상세 수치 툴팁 */}
        {hovered.week && hovered.index !== null && hoveredItem && (
          <g transform={`translate(${x(hovered.index)}, ${y(hoveredItem.total) - 14})`}>
            <rect x="-72" y="-28" width="144" height="24" rx="4" fill="var(--surface-2)" />
            <polygon points="-4,-4 4,-4 0,0" fill="var(--surface-2)" />
            <text x="0" y="-12" fill="white" fontSize="10" fontWeight="500" textAnchor="middle">
              {hovered.week === "this" ? "이번주" : "지난주"} · 출석 {hoveredItem.present}명 지각{hoveredItem.late}명 결석{hoveredItem.absent}명
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

const modalOverlayStyle = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.4)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
};
const modalContentStyle = {
  backgroundColor: "var(--surface)", padding: "24px", borderRadius: "12px", width: "500px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)"
};
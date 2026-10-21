// Classes.jsx
import { useEffect, useState, useMemo } from "react";
import { fetchClasses, createClass, deleteClass, updateClass, fetchMembers, enrollStudent, unenrollStudent,fetchNotices,createNotice,deleteNotice,fetchAssignments,createAssignment,deleteAssignment} from "../api";

// 요일 상호 변환을 위한 매핑 사전 (Day of the week Mapping)
const DAY_MAP = {
  MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일",
  월: "MON", 화: "TUE", 수: "WED", 목: "THU", 금: "FRI", 토: "SAT", 일: "SUN", 
  매일: "매일"
};

const ClassManagement = () => {
  const currentYear = new Date().getFullYear();
  const yearRange = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  const [viewYear, setViewYear] = useState(currentYear);
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [allMembers, setAllMembers] = useState([]);

  const colorPalette = [
    { bg: '#e3f2fd', border: '#90caf9', text: '#0d47a1' }, 
    { bg: '#e8f5e9', border: '#a5d6a7', text: '#1b5e20' }, 
    { bg: '#f3e5f5', border: '#ce93d8', text: '#4a148c' }, 
    { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' }, 
    { bg: '#e0f2f1', border: '#80cbc4', text: '#004d40' }, 
  ];

  const [classes, setClasses] = useState([]);

  // 수업 목록 및 회원 목록 통합 패치 (Fetch)
  const loadClasses = async () => {
    try {
      setLoading(true);
      const [classesData, membersData] = await Promise.all([
        fetchClasses(),
        fetchMembers()
      ]);
      
      setAllMembers(Array.isArray(membersData) ? membersData : []);

      const formatted = (Array.isArray(classesData) ? classesData : []).map((c, idx) => ({
        id: c.class_id,
        name: c.name,
        prof: c.teacher,
        startDate: c.start_date,
        endDate: c.end_date,
        desc: c.description || '',
        colorIndex: c.color_index ?? (idx % 5),
        schedules: c.days_of_week ? c.days_of_week.split(',').map(d => {
          const korDay = DAY_MAP[d.toUpperCase()] || d; 
          return { id: korDay, day: korDay, startTime: c.start_time || '09:00', endTime: c.end_time || '11:00' };
        }) : [],
        students: c.students ? c.students.map(s => s.name) : [], 
        announcements: [],
        assignments: []
      }));
      setClasses(formatted);
    } catch (e) {
      console.error("데이터 로드 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadClasses(); }, []);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', prof: '', startDate: '', endDate: '', schedules: [], desc: '' });

  const [activeClassId, setActiveClassId] = useState(null);
  const [activeTab, setActiveTab] = useState('info'); 

  const [studentSearchQuery, setStudentSearchQuery] = useState(''); 
  const [newNotice, setNewNotice] = useState({ title: '', category: '수업', content: '' }); 
  const [editingNoticeId, setEditingNoticeId] = useState(null); 
  const [noticeFilter, setNoticeFilter] = useState('전체'); 

  // 과제 전용 상태 스키마 (실제 파일 객체 및 정보 바인딩)
  const [newAssignment, setNewAssignment] = useState({ title: '', content: '', dueDate: '', fileName: '', file: null }); 
  const [editingAssignmentId, setEditingAssignmentId] = useState(null); 
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null); 

  const currentClass = classes.find(c => c.id === activeClassId);

  // 대시보드 공지사항 및 과제 영구 동기화 리로드 장치
  const loadClassDetails = async (classId) => {
    if (!classId) return;
    try {
      const [noticesData, assignmentsData] = await Promise.all([
        fetchNotices(),
        fetchAssignments(classId).catch(() => [])
      ]);

      setClasses(prev => prev.map(c => {
        if (c.id === classId) {
          return {
            ...c,
            announcements: noticesData
              .filter(n => n.class_id === classId)
              .map(n => ({
                id: n.notice_id || n.id,
                title: n.title,
                category: n.category || '수업',
                content: n.content,
                date: n.created_at ? n.created_at.split('T')[0] : new Date().toISOString().split('T')[0]
              })),
            assignments: assignmentsData.map(a => ({
              id: a.assignment_id || a.id,
              title: a.title,
              content: a.content || '',
              dueDate: a.due_date || '',
              fileName: a.file_name || ''
            }))
          };
        }
        return c;
      }));
    } catch (e) {
      console.error("상세 정보 로드 실패:", e);
    }
  };

  useEffect(() => {
    if (activeClassId) {
      loadClassDetails(activeClassId);
    }
  }, [activeClassId]);

  // 활동 중(ACTIVE)인 학생 이름만 매칭하여 검색 필터링
  const searchedStudents = useMemo(() => {
    if (!studentSearchQuery.trim()) return [];
    const activeMembers = allMembers.filter(m => m.status === "ACTIVE");
    const memberNames = activeMembers.map(m => m.name);
    return memberNames.filter(name => name.includes(studentSearchQuery.trim()));
  }, [studentSearchQuery, allMembers]);

  const getClassStatus = (cls) => {
    const now = new Date();
    const start = new Date(cls.startDate + 'T00:00:00');
    const end = new Date(cls.endDate + 'T23:59:59');

    if (now < start) return '준비 중';
    if (now > end) return '종료';

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const currentDayName = dayNames[now.getDay()];

    const isNowInSession = cls.schedules.some((sched) => {
      if (sched.day !== '매일' && sched.day !== currentDayName) return false;

      const [startH, startM] = sched.startTime.split(':').map(Number);
      const [endH, endM] = sched.endTime.split(':').map(Number);

      const sessionStart = new Date(now);
      sessionStart.setHours(startH, startM, 0, 0);
      const sessionEnd = new Date(now);
      sessionEnd.setHours(endH, endM, 0, 0);

      return now >= sessionStart && now <= sessionEnd;
    });

    if (isNowInSession) return '수업 중';
    return ''; 
  };

  const firstDayIndex = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDays = new Date(viewYear, viewMonth, 0).getDate();
  const calendarCells = [...Array(firstDayIndex).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleToggleDay = (day) => {
    const dayOrder = ['매일', '일', '월', '화', '수', '목', '금', '토'];
    const isAlreadySelected = formData.schedules.some((s) => s.day === day);
    let updatedSchedules = [...formData.schedules];

    if (day === '매일') {
      if (isAlreadySelected) {
        updatedSchedules = [];
      } else {
        updatedSchedules = [{ id: '매일', day: '매일', startTime: '09:00', endTime: '11:00' }];
      }
    } else {
      updatedSchedules = updatedSchedules.filter((s) => s.day !== '매일');
      if (isAlreadySelected) {
        updatedSchedules = updatedSchedules.filter((s) => s.day !== day);
      } else {
        updatedSchedules.push({ id: day, day, startTime: '09:00', endTime: '11:00' });
      }
      updatedSchedules.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
    }
    setFormData((prev) => ({ ...prev, schedules: updatedSchedules }));
  };

  const handleScheduleTimeChange = (id, field, value) => {
    setFormData((prev) => ({
      ...prev, schedules: prev.schedules.map((item) => item.id === id ? { ...item, [field]: value } : item)
    }));
  };

  const handleEditClick = (cls) => {
    setEditingId(cls.id);
    const dayOrder = ['매일', '일', '월', '화', '수', '목', '금', '토'];
    const sortedSchedules = [...cls.schedules].sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
    setFormData({ 
      name: cls.name, prof: cls.prof, startDate: cls.startDate, endDate: cls.endDate, 
      schedules: sortedSchedules, desc: cls.desc 
    });
    setIsModalOpen(true);
  };

  const handleDeleteClick = async (id) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      try {
        await deleteClass(id); 
        loadClasses(); 
        if (activeClassId === id) setActiveClassId(null);
      } catch (e) {
        alert('삭제 실패');
      }
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.prof || !formData.startDate || !formData.endDate || !formData.desc) {
      return alert('모든 필수 항목(*) 및 기간을 입력해주세요.');
    }

    // API로 보낼 데이터 구조화
    const payload = {
      name: formData.name,
      teacher: formData.prof,
      start_date: formData.startDate,
      end_date: formData.endDate,
      description: formData.desc,
      days_of_week: formData.schedules.map(s => DAY_MAP[s.day] || s.day).join(','),
      start_time: formData.schedules[0]?.startTime || '09:00',
      end_time: formData.schedules[0]?.endTime || '11:00'
    };

    try {
      if (editingId) {
        // 1. 수정 모드일 때: updateClass 호출
        await updateClass(editingId, payload);
      } else {
        // 2. 등록 모드일 때: createClass 호출
        await createClass(payload);
      }
      
      loadClasses(); // 목록 새로고침
      handleCloseModal(); // 모달 닫기
    } catch (e) {
      alert(editingId ? '수정 실패' : '등록 실패');
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({ name: '', prof: '', startDate: '', endDate: '', schedules: [], desc: '' });
  };

  const handleToggleStudent = async (name) => {
    const matchedMember = allMembers.find(m => m.name === name);
    if (!matchedMember) return alert('시스템에 존재하지 않는 회원입니다.');

    const exists = currentClass.students.includes(name);
    
    try {
      if (exists) {
        await unenrollStudent(currentClass.id, matchedMember.member_id);
      } else {
        await enrollStudent(currentClass.id, matchedMember.member_id);
      }
      await loadClasses();
    } catch (err) {
      console.error("수강생 변경 실패:", err);
      alert(err.response?.data?.detail || '수강 정보 변경에 실패했습니다.');
    }
  };

  const handleAddNotice = () => {
  if (!newNotice.title.trim() || !newNotice.content.trim()) return alert('제목과 내용을 모두 입력해 주세요.');
  
  setClasses(prev => prev.map(c => {
    if (c.id === activeClassId) {
      const newEntry = {
        id: Date.now(), // 고유 ID 생성
        title: newNotice.title,
        category: newNotice.category,
        content: newNotice.content,
        date: new Date().toISOString().split('T')[0]
      };
      return { ...c, announcements: [newEntry, ...c.announcements] };
    }
    return c;
  }));
  setNewNotice({ title: '', category: '수업', content: '' });
};

const handleRemoveNotice = (noticeId) => {
    if (window.confirm('공지사항을 삭제하시겠습니까?')) {
      setClasses(prev => prev.map(c => {
        if (c.id === activeClassId) {
          return {
            ...c,
            announcements: c.announcements.filter(n => n.id !== noticeId)
          };
        }
        return c;
      }));
    }
  };

  // 실제 리얼 파일 선택 이벤트 처리 함수
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setNewAssignment(prev => ({
      ...prev,
      file: selectedFile,
      fileName: selectedFile ? selectedFile.name : ''
    }));
  };

  // 과제 Multipart FormData 빌드 및 업로드 전송
  const handleAddAssignment = async () => {
    if (!newAssignment.title.trim() || !newAssignment.dueDate) return alert('과제명과 제출 기한을 필히 설정해 주세요.');

    try {
      const formPayload = new FormData();
      formPayload.append("title", newAssignment.title);
      formPayload.append("content", newAssignment.content);
      formPayload.append("due_date", newAssignment.dueDate);
      if (newAssignment.file) {
        formPayload.append("file", newAssignment.file);
      }

      if (editingAssignmentId) {
        alert('과제 수정 기능은 현재 준비 중입니다.');
      } else {
        await createAssignment(activeClassId, formPayload);
      }

      setNewAssignment({ title: '', content: '', dueDate: '', fileName: '', file: null });
      setEditingAssignmentId(null);
      await loadClassDetails(activeClassId);
    } catch (e) {
      alert('과제 출제 실패');
    }
  };

  const handleRemoveAssignment = async (assignmentId) => {
    if (window.confirm('해당 과제를 삭제하시겠습니까?')) {
      try {
        await deleteAssignment(assignmentId);
        if (selectedAssignmentId === assignmentId) setSelectedAssignmentId(null);
        await loadClassDetails(activeClassId);
      } catch (e) {
        alert('과제 제거에 실패했습니다.');
      }
    }
  };

  const getBadgeClass = (status) => {
    if (status === '수업 중') return 'badge primary no-dot';
    if (status === '종료') return 'badge danger no-dot';
    return 'badge no-dot';
  };

  return (
    <div className="page">
      <h1 className="page-title">수업 관리</h1>
      <p className="page-subtitle">전체 {classes.length}개 · 학기 일정 운영 중</p>

      <div className="toolbar">
        <div className="search-box">
          <input type="text" className="input" placeholder="수업·교수 이름으로 검색" />
        </div>
        <button className="btn ml-auto" onClick={() => setIsModalOpen(true)}>수업 추가</button>
      </div>

      {/* 수업 목록 카드 섹션 */}
      <div className="row cols-2-eq">
        {classes.map((cls) => {
          const status = getClassStatus(cls);
          const classColor = colorPalette[cls.colorIndex || 0];
          return (
            <div 
              key={cls.id} 
              className="card" 
              style={{ borderLeft: `5px solid ${classColor.border}`, cursor: 'pointer' }}
              onClick={() => { setActiveClassId(cls.id); setActiveTab('info'); }}
            >
              <div className="card-head">
                <div>
                  <h3 className="card-title card-title-flex">
                    {cls.name}
                    <span className="student-count">({cls.students?.length || 0}명)</span>
                    {status && (
                      <span 
                        className={getBadgeClass(status)} 
                        style={{
                          background: status === '준비 중' ? 'var(--surface-3)' : undefined,
                          borderColor: status === '준비 중' ? 'var(--border)' : undefined,
                          color: status === '준비 중' ? 'var(--text-2)' : undefined,
                        }}
                      >
                        {status}
                      </span>
                    )}
                  </h3>
                  <div className="card-sub">{cls.prof} · <span className="card-sub-date">{cls.startDate} ~ {cls.endDate}</span></div>
                </div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost sm" onClick={() => handleEditClick(cls)}>수정</button>
                  <button className="btn danger sm" onClick={() => handleDeleteClick(cls.id)}>삭제</button>
                </div>
              </div>
              
              <div className="list-row list-row-no-border">
                <div className="body">
                  <div className="title list-row-title">
                    {cls.schedules.map(s => `${s.day} ${s.startTime}~${s.endTime}`).join(' / ')}
                  </div>
                  <div className="meta">{cls.desc}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 캘린더 구성 패널 */}
      <div className="card">
        <div className="card-head calendar-header">
          <h2 className="card-title">{viewYear}년 {viewMonth}월 캘린더</h2>
          <div className="calendar-controls">
            <select className="select calendar-select year" value={viewYear} onChange={(e) => setViewYear(Number(e.target.value))}>
              {yearRange.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select className="select calendar-select month" value={viewMonth} onChange={(e) => setViewMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
        </div>

        <div className="calendar-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => (
            <div key={day} className="calendar-day-header" style={{
              color: idx === 0 ? 'var(--danger)' : idx === 6 ? 'var(--primary)' : 'var(--text-2)'
            }}>{day}</div>
          ))}

          {calendarCells.map((dayNum, index) => {
            const dayOfWeekIndex = index % 7;
            const isSunday = dayOfWeekIndex === 0;
            const isSaturday = dayOfWeekIndex === 6;
            const currentDayName = ['일', '월', '화', '수', '목', '금', '토'][dayOfWeekIndex];
            
            let cellBgColor = dayNum ? (isSunday || isSaturday ? 'var(--surface-2)' : 'var(--surface)') : 'var(--surface-3)';
            const todaysClasses = [];

            if (dayNum) {
              const currentCellDateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              classes.forEach((cls) => {
                if (currentCellDateStr >= cls.startDate && currentCellDateStr <= cls.endDate) {
                  cls.schedules.forEach((sched) => {
                    if (sched.day === '매일' || sched.day === currentDayName) {
                      todaysClasses.push({ name: cls.name, time: `${sched.startTime}~${sched.endTime}`, colorIndex: cls.colorIndex || 0 });
                    }
                  });
                }
              });
            }

            return (
              <div key={index} className="calendar-cell" style={{ backgroundColor: cellBgColor, opacity: dayNum ? 1 : 0.4 }}>
                {dayNum && (
                  <div className="calendar-day-num" style={{ color: isSunday ? 'var(--danger)' : isSaturday ? 'var(--primary)' : 'var(--text)' }}>
                    {dayNum}
                  </div>
                )}

                <div className="hide-scrollbar calendar-events">
                  {todaysClasses.map((c, cIdx) => {
                    const theme = colorPalette[c.colorIndex];
                    return (
                      <div key={cIdx} className="calendar-event-item" style={{
                        backgroundColor: theme.bg,
                        borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`,
                        borderLeft: isSunday ? `1px solid ${theme.border}` : 'none',
                        borderRight: isSaturday ? `1px solid ${theme.border}` : 'none',
                        color: theme.text,
                        borderRadius: isSunday ? '4px 0 0 4px' : isSaturday ? '0 4px 4px 0' : '0'
                      }}>
                        {c.name} ({c.time})
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 수업 클릭 시 출력되는 상세 모달 내비게이션 피드 */}
      {activeClassId && currentClass && (
        <div className="modal-backdrop" onClick={() => setActiveClassId(null)}>
          <div className="modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-large-header">
              <h2>
                {currentClass.name} 
                <span style={{ fontSize: '15px', color: 'var(--text-3)', fontWeight: 'normal' }}>상세 대시보드</span>
              </h2>
              <button className="btn ghost sm" onClick={() => setActiveClassId(null)}>창 닫기</button>
            </div>

            <div className="modal-large-body">
              <div className="modal-sidebar">
                <button className={`modal-tab-btn ${activeTab === 'info' ? 'active' : ''}`} onClick={() => { setActiveTab('info'); setStudentSearchQuery(''); }}>수업 정보 및 관리</button>
                <button className={`modal-tab-btn ${activeTab === 'students' ? 'active' : ''}`} onClick={() => { setActiveTab('students'); setStudentSearchQuery(''); }}>학생 관리 ({currentClass.students.length})</button>
                <button className={`modal-tab-btn ${activeTab === 'notices' ? 'active' : ''}`} onClick={() => { setActiveTab('notices'); setEditingNoticeId(null); setNewNotice({ title: '', category: '수업', content: '' }); }}>공지사항 작성</button>
                <button className={`modal-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`} onClick={() => { setActiveTab('tasks'); setEditingAssignmentId(null); setNewAssignment({ title: '', content: '', dueDate: '', fileName: '', file: null }); setSelectedAssignmentId(null); }}>과제 관리 ({currentClass.assignments.length})</button>
              </div>

              <div className="modal-large-content">
                {activeTab === 'info' && (
                  <div>
                    <h3 style={{ marginBottom: '16px' }}>수업 기본 정보</h3>
                    <p style={{ marginBottom: '10px' }}><strong>담당 교수:</strong> {currentClass.prof}</p>
                    <p style={{ marginBottom: '10px' }}><strong>운영 기간:</strong> {currentClass.startDate} ~ {currentClass.endDate}</p>
                    <p style={{ marginBottom: '10px' }}>
                      <strong>수업 요일:</strong> {currentClass.schedules.map(s => `${s.day} (${s.startTime}~${s.endTime})`).join(', ')}
                    </p>
                    <p style={{ marginBottom: '28px', lineHeight: '1.6', color: 'var(--text-2)' }}><strong>설명:</strong> {currentClass.desc}</p>
                    
                    <hr style={{ borderColor: 'var(--border)', marginBottom: '24px' }} />
                    <h4>수업 데이터 관리</h4>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <button className="btn" onClick={() => { handleEditClick(currentClass); setActiveClassId(null); }}>수업 정보 수정</button>
                      <button className="btn danger" onClick={() => handleDeleteClick(currentClass.id)}>이 수업 전체 삭제</button>
                    </div>
                  </div>
                )}

                {activeTab === 'students' && (
                  <div>
                    <h3>학생 명단 관리</h3>
                    <p className="meta" style={{ marginBottom: '16px' }}>본 강좌에 소속된 수강생 명단입니다. 검색 시스템을 활용하여 명단을 가공합니다.</p>
                    
                    <div className="form-row" style={{ marginBottom: '16px' }}>
                      <label style={{ fontSize: '13px', fontWeight: '600' }}>이름으로 학생 검색 (전체 회원 연동)</label>
                      <input 
                        type="text" className="input" placeholder="검색할 학생 이름을 입력하세요..."
                        value={studentSearchQuery} onChange={(e) => setStudentSearchQuery(e.target.value)}
                      />
                    </div>

                    {studentSearchQuery.trim() && (
                      <div style={{ background: 'var(--surface-2)', padding: '12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: '20px' }}>
                        <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-3)', margin: '0 0 8px 0' }}>검색 결과 목록</p>
                        {searchedStudents.length === 0 ? (
                          <p style={{ fontSize: '13px', color: 'var(--text-3)', padding: '4px 0' }}>일치하는 수강생이 없거나 종료 상태의 학생입니다.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {searchedStudents.map((name, idx) => {
                              const isAdded = currentClass.students.includes(name);
                              return (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                  <span style={{ fontSize: '14px' }}>{name}</span>
                                  <button 
                                    className={`btn sm ${isAdded ? 'danger' : ''}`}
                                    style={{ padding: '2px 12px', minWidth: '70px' }}
                                    onClick={() => handleToggleStudent(name)}
                                  >
                                    {isAdded ? '제거 -' : '추가 +'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <p style={{ fontWeight: '600', fontSize: '14px', marginBottom: '8px' }}>현재 확정 수강 명단 ({currentClass.students.length}명)</p>
                    <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                      {currentClass.students.length === 0 ? (
                        <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '30px' }}>등록된 수강생이 없습니다. 위 검색 바를 이용해 학생을 수합해 주세요.</p>
                      ) : (
                        currentClass.students.map((student, idx) => (
                          <div key={idx} className="flex-item-row">
                            <span>{student} <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>(학생)</span></span>
                            <button className="btn danger sm" onClick={() => handleToggleStudent(student)}>제거 -</button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 2. 공지사항 탭: index.css 클래스 완전 치환 적용 */}
                {activeTab === 'notices' && (
                  <div>
                    <h3>공지사항 작성</h3>
                    
                    <div className="dashboard-form-container">
                      <p className="dashboard-form-title">
                        {editingNoticeId ? '✏️ 선택한 공지 피드 내용 수정하기' : '📝 새 공지사항 배포하기'}
                      </p>

                      <div className="dashboard-grid-category-title">
                        <div className="dashboard-input-group">
                          <label className="dashboard-input-label">큰 분류</label>
                          <select 
                            className="select" 
                            value={newNotice.category} 
                            onChange={(e) => setNewNotice(prev => ({ ...prev, category: e.target.value }))}
                          >
                            <option value="수업">수업</option>
                            <option value="과제">과제</option>
                            <option value="자료">자료</option>
                            <option value="기타">기타</option>
                          </select>
                        </div>
                        <div className="dashboard-input-group">
                          <label className="dashboard-input-label">공지사항 제목</label>
                          <input 
                            type="text" 
                            className="input" 
                            placeholder="공지 제목을 입력하세요." 
                            value={newNotice.title} 
                            onChange={(e) => setNewNotice(prev => ({ ...prev, title: e.target.value }))}
                          />
                        </div>
                      </div>
                      
                      <div className="dashboard-input-group">
                        <label className="dashboard-input-label">공지 내용</label>
                        <textarea 
                          className="dashboard-textarea"
                          placeholder="공지 내용을 상세히 입력하세요." 
                          value={newNotice.content} 
                          onChange={(e) => setNewNotice(prev => ({ ...prev, content: e.target.value }))}
                        />
                      </div>
                      
                      <div className="dashboard-action-row">
                        {editingNoticeId && (
                          <button className="btn ghost sm" onClick={() => { setEditingNoticeId(null); setNewNotice({ title: '', category: '수업', content: '' }); }}>수정 취소</button>
                        )}
                        <button className="btn sm" onClick={handleAddNotice}>{editingNoticeId ? '수정 완료' : '공지사항 등록'}</button>
                      </div>
                    </div>

                    <div className="filter-row">
                      <span className="filter-label">📁 카테고리 필터:</span>
                      {['전체', '수업', '과제', '자료', '기타'].map((cat) => (
                        <button 
                          key={cat} 
                          className={`btn sm ${noticeFilter === cat ? '' : 'ghost'}`} 
                          style={{ padding: '2px 10px', fontSize: '12px' }}
                          onClick={() => setNoticeFilter(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    <div className="feed-scroll-container">
                      {currentClass.announcements
                        .filter(n => noticeFilter === '전체' || (n.category || '수업') === noticeFilter)
                        .length === 0 ? (
                          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '20px' }}>조건에 맞는 공지 피드가 없습니다.</p>
                        ) : (
                          currentClass.announcements
                            .filter(n => noticeFilter === '전체' || (n.category || '수업') === noticeFilter)
                            .map((n) => (
                              <div key={n.id} className="flex-item-row feed-item-notice">
                                <div className="feed-item-header">
                                  <div className="feed-item-title-area">
                                    <span className="badge primary no-dot" style={{ fontSize: '11px', padding: '2px 6px' }}>{n.category || '수업'}</span>
                                    <strong>{n.title}</strong>
                                  </div>
                                  <div className="feed-item-meta">
                                    <span className="feed-item-date">{n.date}</span>
                                    <button className="btn danger sm" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => handleRemoveNotice(n.id)}>삭제</button>
                                  </div>
                                </div>
                                <div className="feed-item-text-content">{n.content}</div>
                              </div>
                            ))
                        )}
                    </div>
                  </div>
                )}

                {/* 3. 과제 관리 탭: 리얼 업로더 매핑 및 index.css 치환 적용 */}
                {activeTab === 'tasks' && (
                  <div>
                    <h3>과제 관리</h3>
                    
                    <div className="dashboard-form-container">
                      <p className="dashboard-form-title">
                        {editingAssignmentId ? '✏️ 선택한 시스템 과제 명세 수정' : '🚀 신규 강좌 실습 과제 출제'}
                      </p>

                      <div className="dashboard-grid-2">
                        <div className="dashboard-input-group">
                          <label className="dashboard-input-label">과제명 *</label>
                          <input 
                            type="text" className="input" placeholder="예: 파이썬 판다스 실습 과제"
                            value={newAssignment.title} onChange={(e) => setNewAssignment(prev => ({ ...prev, title: e.target.value }))}
                          />
                        </div>
                        <div className="dashboard-input-group">
                          <label className="dashboard-input-label">제출 마감일 *</label>
                          <input 
                            type="date" className="input" 
                            value={newAssignment.dueDate} onChange={(e) => setNewAssignment(prev => ({ ...prev, dueDate: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="dashboard-input-group">
                        <label className="dashboard-input-label">📄 실제 참고 파일 첨부</label>
                        <div className="file-upload-wrapper">
                          <input 
                            type="file" 
                            id="real-file-uploader"
                            className="file-upload-hidden"
                            onChange={handleFileChange}
                          />
                          <button 
                            type="button" 
                            className="btn ghost sm"
                            onClick={() => document.getElementById('real-file-uploader').click()}
                          >
                            파일 선택
                          </button>
                          <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>
                            {newAssignment.fileName ? newAssignment.fileName : '선택된 파일 없음'}
                          </span>
                        </div>
                      </div>

                      <div className="dashboard-input-group">
                        <label className="dashboard-input-label">과제 상세 가이드 내용</label>
                        <textarea 
                          className="dashboard-textarea"
                          placeholder="과제 조건 및 소스 코드 제출 포맷 규격을 기술하세요."
                          value={newAssignment.content} onChange={(e) => setNewAssignment(prev => ({ ...prev, content: e.target.value }))}
                        />
                      </div>

                      <div className="dashboard-action-row">
                        {editingAssignmentId && (
                          <button className="btn ghost sm" onClick={() => { setEditingAssignmentId(null); setNewAssignment({ title: '', content: '', dueDate: '', fileName: '', file: null }); }}>취소</button>
                        )}
                        <button className="btn sm" onClick={handleAddAssignment}>{editingAssignmentId ? '수정 완료' : '출제하기'}</button>
                      </div>
                    </div>

                    <p style={{ fontWeight: '600', fontSize: '14px', marginBottom: '8px' }}>출제 완료 과제 피드 목록</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {currentClass.assignments.length === 0 ? (
                        <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '20px' }}>출제된 이력이 존재하지 않습니다.</p>
                      ) : (
                        currentClass.assignments.map((a) => (
                          <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px', background: 'var(--surface)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontWeight: '600', fontSize: '15px', marginRight: '8px' }}>{a.title}</span>
                                <span className="badge danger no-dot" style={{ fontSize: '11px' }}>기한: ~ {a.dueDate}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button className="btn sm ghost" style={{ padding: '3px 8px', fontSize: '12px' }} onClick={() => setSelectedAssignmentId(selectedAssignmentId === a.id ? null : a.id)}>
                                  {selectedAssignmentId === a.id ? '명단 접기 ▲' : '제출 명단 확인 🔍'}
                                </button>
                                <button className="btn sm danger" style={{ padding: '3px 8px', fontSize: '12px' }} onClick={() => handleRemoveAssignment(a.id)}>삭제</button>
                              </div>
                            </div>

                            {a.content && <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: '6px 0 0 0' }}>{a.content}</p>}
                            {a.fileName && (
                              <div className="file-attached-badge">
                                📁 첨부 자료: {a.fileName}
                              </div>
                            )}

                            {selectedAssignmentId === a.id && (
                              <div style={{ marginTop: '12px', borderTop: '1px dashed var(--border)', paddingTop: '10px' }}>
                                <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--primary)', margin: '0 0 6px 0' }}>📊 수강생 제출 현황 모니터링</p>
                                <div style={{ background: 'var(--surface-2)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                  {currentClass.students.length === 0 ? (
                                    <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>수강생 명단이 없어 조회할 수 없습니다.</p>
                                  ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
                                          <th style={{ padding: '4px' }}>학생 이름</th>
                                          <th style={{ padding: '4px' }}>현황</th>
                                          <th style={{ padding: '4px' }}>최종 변경 기록</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {currentClass.students.map((stu, sIdx) => (
                                          <tr key={sIdx} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                                            <td style={{ padding: '4px', fontWeight: '600' }}>{stu}</td>
                                            <td style={{ padding: '4px' }}>
                                              {sIdx % 3 === 0 ? (
                                                <span style={{ color: 'var(--danger)', fontWeight: '600' }}>미제출</span>
                                              ) : (
                                                <span style={{ color: 'var(--success)', fontWeight: '600' }}>제출 완료</span>
                                              )}
                                            </td>
                                            <td style={{ padding: '4px', color: 'var(--text-3)' }}>
                                              {sIdx % 3 === 0 ? '-' : '2026-06-04 14:10'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 수업 추가 및 수정용 메인 모달창 구성 */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={handleCloseModal}>
          <div className="modal modal-responsive" onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? '수업 정보 수정' : '새 수업 추가'}</h3>
            
            <div className="form-row">
              <label>수업명 *</label>
              <input type="text" className="input" name="name" value={formData.name} onChange={handleInputChange} placeholder="예: 빅데이터 전처리" />
            </div>
            
            <div className="form-row">
              <label>교수 이름 *</label>
              <input type="text" className="input" name="prof" value={formData.prof} onChange={handleInputChange} placeholder="예: 김교수" />
            </div>

            <div className="form-row form-group-row">
              <div className="form-group-col">
                <label>운영 시작일 *</label>
                <input type="date" className="input" name="startDate" value={formData.startDate} onChange={handleInputChange} />
              </div>
              <div className="form-group-col">
                <label>운영 종료일 *</label>
                <input type="date" className="input" name="endDate" value={formData.endDate} onChange={handleInputChange} />
              </div>
            </div>

            <div className="form-row">
              <label>요일 및 시간 지정 * (클릭하여 선택/취소)</label>
              <div className="segmented segmented-controls">
                {['매일', '일', '월', '화', '수', '목', '금', '토'].map((day) => {
                  const isSelected = formData.schedules.some((s) => s.day === day);
                  return (
                    <button key={day} type="button" className={`segmented-btn ${isSelected ? 'active' : ''}`} onClick={() => handleToggleDay(day)}>{day}</button>
                  );
                })}
              </div>

              <div className="schedule-list">
                {formData.schedules.map((item) => (
                  <div key={item.id} className="schedule-item">
                    <span className="badge primary no-dot schedule-badge">{item.day === '매일' ? '매일' : `${item.day}요일`}</span>
                    <input type="time" className="input schedule-input" value={item.startTime} onChange={(e) => handleScheduleTimeChange(item.id, 'startTime', e.target.value)} />
                    <span className="schedule-separator">~</span>
                    <input type="time" className="input schedule-input" value={item.endTime} onChange={(e) => handleScheduleTimeChange(item.id, 'endTime', e.target.value)} />
                    <button type="button" className="btn danger sm schedule-del-btn" onClick={() => handleToggleDay(item.day)}>삭제</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-row">
              <label>수업 설명 *</label>
              <textarea name="desc" value={formData.desc} onChange={handleInputChange} placeholder="수업에 대한 상세 설명을 입력해주세요." />
            </div>

            <div className="modal-actions">
              <button className="btn ghost" onClick={handleCloseModal}>취소</button>
              <button className="btn" onClick={handleSubmit}>{editingId ? '수정 완료' : '추가하기'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassManagement;
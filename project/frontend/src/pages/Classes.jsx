// Classes.jsx
import { useEffect, useState, useMemo } from "react";
import {
  fetchClasses, createClass, deleteClass, updateClass, fetchMembers, enrollStudent, unenrollStudent,
  fetchNotices, createNotice, deleteNotice, fetchAssignments, createAssignment, updateAssignment, deleteAssignment,
  fetchSubmissions, updateSubmission, assignmentFileUrl, errorText,
} from "../api";

// 공지 분류 — 학부모 포털·공지 화면과 같은 코드 사용
const NOTICE_CATEGORY = { GENERAL: "일반", EVENT: "행사", URGENT: "긴급" };
const SUBMISSION_LABEL = { NONE: "미확인", SUBMITTED: "제출", LATE: "지각 제출", MISSING: "미제출" };
const SUBMISSION_COLOR = { NONE: "var(--text-3)", SUBMITTED: "var(--success)", LATE: "var(--warning, #d97706)", MISSING: "var(--danger)" };
const EMPTY_ASSIGNMENT = { title: '', content: '', dueDate: '', fileName: '', file: null, hadFile: false, removeFile: false };

// 요일 상호 변환을 위한 매핑 사전 (Day of the week Mapping)
const DAY_MAP = {
  MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일",
  월: "MON", 화: "TUE", 수: "WED", 목: "THU", 금: "FRI", 토: "SAT", 일: "SUN", 
  매일: "DAILY", DAILY: "매일"
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
        // v8.1: 요일별 시간이 다를 수 있음 (schedules: [{day:"MON", start, end}])
        schedules: (c.schedules?.length ? c.schedules : (c.days_of_week || '').split(',').filter(Boolean)
          .map(d => ({ day: d, start: c.start_time, end: c.end_time })))
          .map(s => {
            const korDay = DAY_MAP[String(s.day).toUpperCase()] || s.day;
            return { id: korDay, day: korDay, startTime: s.start || '09:00', endTime: s.end || '10:00' };
          }),
        students: c.students ? c.students.map(s => s.name) : [],
        studentIds: c.students ? c.students.map(s => s.member_id) : [],
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
  const [classQuery, setClassQuery] = useState('');
  const [newNotice, setNewNotice] = useState({ title: '', category: 'GENERAL', content: '', notifyParents: true });
  const [editingNoticeId, setEditingNoticeId] = useState(null);
  const [noticeFilter, setNoticeFilter] = useState('전체');

  // 과제: 파일은 서버(DB)에 저장되고, 제출 현황은 수강생별로 관리자가 체크
  const [newAssignment, setNewAssignment] = useState(EMPTY_ASSIGNMENT);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(null);
  const [submissions, setSubmissions] = useState({});   // { [assignmentId]: [{member_id, name, status, checked_at}] }

  const currentClass = classes.find(c => c.id === activeClassId);

  // 대시보드 공지사항 및 과제 영구 동기화 리로드 장치
  const loadClassDetails = async (classId) => {
    if (!classId) return;
    try {
      const [noticesData, assignmentsData] = await Promise.all([
        fetchNotices({ class_id: classId }),
        fetchAssignments(classId).catch(() => [])
      ]);

      setClasses(prev => prev.map(c => {
        if (c.id === classId) {
          return {
            ...c,
            announcements: noticesData
              .filter(n => n.class_id === classId)
              .map(n => ({
                id: n.notice_id,
                title: n.title,
                category: n.category || 'GENERAL',
                content: n.content,
                date: n.created_at ? n.created_at.split('T')[0] : '',
                readCount: n.read_count || 0,
                targetCount: n.target_count || 0,
              })),
            assignments: assignmentsData.map(a => ({
              id: a.assignment_id,
              title: a.title,
              content: a.content || '',
              dueDate: a.due_date || '',
              fileName: a.file_name || '',
              hasFile: Boolean(a.has_file),
              submitted: a.submitted || 0,
              enrolled: a.enrolled || 0,
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

  // 재원(ACTIVE) 학생만 검색 — 동명이인을 구분하도록 member_id 로 다룸
  const searchedStudents = useMemo(() => {
    const q = studentSearchQuery.trim();
    if (!q) return [];
    return allMembers.filter(m => m.status === "ACTIVE" && m.name.includes(q)).slice(0, 20);
  }, [studentSearchQuery, allMembers]);

  const filteredClasses = useMemo(() => {
    const q = classQuery.trim();
    if (!q) return classes;
    return classes.filter(c => c.name.includes(q) || (c.prof || '').includes(q) || (c.desc || '').includes(q));
  }, [classes, classQuery]);

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
    if (formData.startDate > formData.endDate) return alert('운영 종료일이 시작일보다 빠릅니다.');
    if (formData.schedules.length === 0) return alert('수업 요일을 하나 이상 선택해 주세요.');
    const badTime = formData.schedules.find(s => !s.startTime || !s.endTime || s.startTime >= s.endTime);
    if (badTime) return alert(`${badTime.day} 수업의 종료 시간이 시작 시간보다 늦어야 합니다.`);

    // API로 보낼 데이터 구조화
    const payload = {
      name: formData.name,
      teacher: formData.prof,
      start_date: formData.startDate,
      end_date: formData.endDate,
      description: formData.desc,
      days_of_week: formData.schedules.map(s => DAY_MAP[s.day] || s.day).join(','),
      start_time: formData.schedules[0]?.startTime || '09:00',
      end_time: formData.schedules[0]?.endTime || '11:00',
      // v8.1: 요일마다 다른 시간을 그대로 저장 (기존에는 첫 요일 시간만 저장되어 나머지가 사라짐)
      schedules: formData.schedules.map(s => ({ day: DAY_MAP[s.day] || s.day, start: s.startTime, end: s.endTime })),
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
      alert(errorText(e, editingId ? '수정하지 못했습니다.' : '등록하지 못했습니다.'));
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({ name: '', prof: '', startDate: '', endDate: '', schedules: [], desc: '' });
  };

  const handleToggleStudent = async (memberId) => {
    const exists = currentClass.studentIds.includes(memberId);
    try {
      if (exists) {
        await unenrollStudent(currentClass.id, memberId);
      } else {
        await enrollStudent(currentClass.id, memberId);
      }
      await loadClasses();
    } catch (err) {
      console.error("수강생 변경 실패:", err);
      alert(err.response?.data?.detail || '수강 정보 변경에 실패했습니다.');
    }
  };

  // v8.1: 반 공지는 서버에 저장되어 그 반 학부모의 포털에만 표시됩니다 (기존: 화면에만 잠시 추가되고 사라짐)
  const handleAddNotice = async () => {
    if (!newNotice.title.trim() || !newNotice.content.trim()) return alert('제목과 내용을 모두 입력해 주세요.');
    try {
      await createNotice({
        title: newNotice.title.trim(), content: newNotice.content, category: newNotice.category,
        author: currentClass.prof || '담당 강사', class_id: activeClassId, notify_parents: newNotice.notifyParents,
      });
      setNewNotice({ title: '', category: 'GENERAL', content: '', notifyParents: true });
      await loadClassDetails(activeClassId);
    } catch (e) {
      alert(errorText(e, '공지를 등록하지 못했습니다.'));
    }
  };

  const handleRemoveNotice = async (noticeId) => {
    if (!window.confirm('공지사항을 삭제하시겠습니까?')) return;
    try {
      await deleteNotice(noticeId);
      await loadClassDetails(activeClassId);
    } catch (e) {
      alert(errorText(e, '공지를 삭제하지 못했습니다.'));
    }
  };

  // 실제 리얼 파일 선택 이벤트 처리 함수
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.size > 3 * 1024 * 1024) {
      e.target.value = '';
      return alert('첨부 파일은 3MB 이하만 올릴 수 있습니다. (서버리스 업로드 한도)');
    }
    setNewAssignment(prev => ({
      ...prev,
      file: selectedFile,
      fileName: selectedFile ? selectedFile.name : '',
      removeFile: false,
    }));
  };

  const startEditAssignment = (a) => {
    setEditingAssignmentId(a.id);
    setNewAssignment({ ...EMPTY_ASSIGNMENT, title: a.title, content: a.content, dueDate: a.dueDate, fileName: a.fileName, hadFile: a.hasFile });
  };

  const loadSubmissions = async (assignmentId) => {
    try {
      const rows = await fetchSubmissions(assignmentId);
      setSubmissions(prev => ({ ...prev, [assignmentId]: rows }));
    } catch (e) {
      alert(errorText(e, '제출 현황을 불러오지 못했습니다.'));
    }
  };

  const toggleSubmissions = (assignmentId) => {
    if (selectedAssignmentId === assignmentId) return setSelectedAssignmentId(null);
    setSelectedAssignmentId(assignmentId);
    loadSubmissions(assignmentId);
  };

  const handleSubmissionChange = async (assignmentId, memberId, status) => {
    try {
      await updateSubmission(assignmentId, memberId, { status });
      await Promise.all([loadSubmissions(assignmentId), loadClassDetails(activeClassId)]);
    } catch (e) {
      alert(errorText(e, '제출 상태를 바꾸지 못했습니다.'));
    }
  };

  const markAllSubmitted = async (assignmentId) => {
    const rows = (submissions[assignmentId] || []).filter(r => r.status === 'NONE');
    if (rows.length === 0) return;
    if (!window.confirm(`미확인 ${rows.length}명을 모두 '제출'로 표시할까요?`)) return;
    try {
      await Promise.all(rows.map(r => updateSubmission(assignmentId, r.member_id, { status: 'SUBMITTED' })));
      await Promise.all([loadSubmissions(assignmentId), loadClassDetails(activeClassId)]);
    } catch (e) {
      alert(errorText(e, '일부 학생의 상태를 바꾸지 못했습니다.'));
    }
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
        if (newAssignment.removeFile && !newAssignment.file) formPayload.append("remove_file", "true");
        await updateAssignment(editingAssignmentId, formPayload);
      } else {
        await createAssignment(activeClassId, formPayload);
      }

      setNewAssignment(EMPTY_ASSIGNMENT);
      setEditingAssignmentId(null);
      const fileInput = document.getElementById('real-file-uploader');
      if (fileInput) fileInput.value = '';
      await loadClassDetails(activeClassId);
    } catch (e) {
      alert(errorText(e, editingAssignmentId ? '과제를 수정하지 못했습니다.' : '과제를 출제하지 못했습니다.'));
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
      <p className="page-subtitle">전체 {classes.length}개 · 진행 중 {classes.filter(c => getClassStatus(c) !== '종료' && getClassStatus(c) !== '준비 중').length}개{loading ? ' · 불러오는 중…' : ''}</p>

      <div className="toolbar">
        <div className="search-box">
          <input type="text" className="input" placeholder="수업명·담당 강사로 검색" value={classQuery} onChange={(e) => setClassQuery(e.target.value)} />
        </div>
        <button className="btn ml-auto" onClick={() => setIsModalOpen(true)}>수업 추가</button>
      </div>

      {/* 수업 목록 카드 섹션 */}
      <div className="row cols-2-eq">
        {!loading && filteredClasses.length === 0 && (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-3)', padding: 32 }}>
            {classes.length === 0 ? '등록된 수업이 없습니다. “수업 추가”로 첫 수업을 만들어 보세요.' : '검색 결과가 없습니다.'}
          </div>
        )}
        {filteredClasses.map((cls) => {
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
                <button className={`modal-tab-btn ${activeTab === 'notices' ? 'active' : ''}`} onClick={() => { setActiveTab('notices'); setEditingNoticeId(null); setNewNotice({ title: '', category: 'GENERAL', content: '', notifyParents: true }); }}>반 공지 ({currentClass.announcements.length})</button>
                <button className={`modal-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`} onClick={() => { setActiveTab('tasks'); setEditingAssignmentId(null); setNewAssignment(EMPTY_ASSIGNMENT); setSelectedAssignmentId(null); }}>과제 관리 ({currentClass.assignments.length})</button>
              </div>

              <div className="modal-large-content">
                {activeTab === 'info' && (
                  <div>
                    <h3 style={{ marginBottom: '16px' }}>수업 기본 정보</h3>
                    <p style={{ marginBottom: '10px' }}><strong>담당 강사:</strong> {currentClass.prof}</p>
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
                            {searchedStudents.map((m) => {
                              const isAdded = currentClass.studentIds.includes(m.member_id);
                              return (
                                <div key={m.member_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                  <span style={{ fontSize: '14px' }}>{m.name} <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{m.age ? `${m.age}세` : ''} · #{m.member_id}</span></span>
                                  <button
                                    className={`btn sm ${isAdded ? 'danger' : ''}`}
                                    style={{ padding: '2px 12px', minWidth: '70px' }}
                                    onClick={() => handleToggleStudent(m.member_id)}
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
                          <div key={currentClass.studentIds[idx]} className="flex-item-row">
                            <span>{student} <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>#{currentClass.studentIds[idx]}</span></span>
                            <button className="btn danger sm" onClick={() => handleToggleStudent(currentClass.studentIds[idx])}>제거 -</button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 2. 공지사항 탭: index.css 클래스 완전 치환 적용 */}
                {activeTab === 'notices' && (
                  <div>
                    <h3>반 공지</h3>
                    <p className="meta" style={{ marginBottom: 12 }}>이 반 수강생의 학부모 포털에만 표시됩니다. 읽음 수는 학부모가 공지를 열어 본 수입니다.</p>

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
                            {Object.entries(NOTICE_CATEGORY).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
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
                      
                      <div className="dashboard-action-row" style={{ alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginRight: 'auto' }}>
                          <input type="checkbox" checked={newNotice.notifyParents} onChange={(e) => setNewNotice(prev => ({ ...prev, notifyParents: e.target.checked }))} />
                          이 반 학부모에게 알림 보내기
                        </label>
                        <button className="btn sm" onClick={handleAddNotice}>공지 등록</button>
                      </div>
                    </div>

                    <div className="filter-row">
                      <span className="filter-label">📁 카테고리 필터:</span>
                      {['전체', ...Object.keys(NOTICE_CATEGORY)].map((cat) => (
                        <button
                          key={cat}
                          className={`btn sm ${noticeFilter === cat ? '' : 'ghost'}`}
                          style={{ padding: '2px 10px', fontSize: '12px' }}
                          onClick={() => setNoticeFilter(cat)}
                        >
                          {NOTICE_CATEGORY[cat] || cat}
                        </button>
                      ))}
                    </div>

                    <div className="feed-scroll-container">
                      {currentClass.announcements
                        .filter(n => noticeFilter === '전체' || n.category === noticeFilter)
                        .length === 0 ? (
                          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '20px' }}>조건에 맞는 공지 피드가 없습니다.</p>
                        ) : (
                          currentClass.announcements
                            .filter(n => noticeFilter === '전체' || n.category === noticeFilter)
                            .map((n) => (
                              <div key={n.id} className="flex-item-row feed-item-notice">
                                <div className="feed-item-header">
                                  <div className="feed-item-title-area">
                                    <span className={`badge ${n.category === 'URGENT' ? 'danger' : 'primary'} no-dot`} style={{ fontSize: '11px', padding: '2px 6px' }}>{NOTICE_CATEGORY[n.category] || n.category}</span>
                                    <strong>{n.title}</strong>
                                  </div>
                                  <div className="feed-item-meta">
                                    <span className="feed-item-date">{n.date} · 읽음 {n.readCount}/{n.targetCount}</span>
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
                        {editingAssignmentId ? '✏️ 과제 수정' : '📝 새 과제 출제'}
                      </p>

                      <div className="dashboard-grid-2">
                        <div className="dashboard-input-group">
                          <label className="dashboard-input-label">과제명 *</label>
                          <input 
                            type="text" className="input" placeholder="예: 줄넘기 100개 기록표"
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
                        <label className="dashboard-input-label">📄 참고 파일 첨부 (3MB 이하 · 학부모 포털에서 내려받기)</label>
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
                          <span style={{ fontSize: '13px', color: 'var(--text-2)', textDecoration: newAssignment.removeFile ? 'line-through' : 'none' }}>
                            {newAssignment.fileName ? newAssignment.fileName : '선택된 파일 없음'}
                          </span>
                          {editingAssignmentId && newAssignment.hadFile && !newAssignment.file && (
                            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input type="checkbox" checked={newAssignment.removeFile} onChange={(e) => setNewAssignment(prev => ({ ...prev, removeFile: e.target.checked }))} />
                              기존 첨부 삭제
                            </label>
                          )}
                        </div>
                      </div>

                      <div className="dashboard-input-group">
                        <label className="dashboard-input-label">과제 상세 가이드 내용</label>
                        <textarea 
                          className="dashboard-textarea"
                          placeholder="과제 내용과 제출 방법을 적어 주세요."
                          value={newAssignment.content} onChange={(e) => setNewAssignment(prev => ({ ...prev, content: e.target.value }))}
                        />
                      </div>

                      <div className="dashboard-action-row">
                        {editingAssignmentId && (
                          <button className="btn ghost sm" onClick={() => { setEditingAssignmentId(null); setNewAssignment(EMPTY_ASSIGNMENT); }}>취소</button>
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
                                <span className="badge no-dot" style={{ fontSize: '11px', marginLeft: 4 }}>제출 {a.submitted}/{a.enrolled}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button className="btn sm ghost" style={{ padding: '3px 8px', fontSize: '12px' }} onClick={() => toggleSubmissions(a.id)}>
                                  {selectedAssignmentId === a.id ? '명단 접기 ▲' : '제출 현황 🔍'}
                                </button>
                                <button className="btn sm ghost" style={{ padding: '3px 8px', fontSize: '12px' }} onClick={() => startEditAssignment(a)}>수정</button>
                                <button className="btn sm danger" style={{ padding: '3px 8px', fontSize: '12px' }} onClick={() => handleRemoveAssignment(a.id)}>삭제</button>
                              </div>
                            </div>

                            {a.content && <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: '6px 0 0 0' }}>{a.content}</p>}
                            {a.fileName && (
                              <div className="file-attached-badge">
                                📁 첨부 자료:{' '}
                                {a.hasFile ? <a href={assignmentFileUrl(a.id)} target="_blank" rel="noreferrer">{a.fileName} (내려받기)</a> : `${a.fileName} (파일 없음)`}
                              </div>
                            )}

                            {selectedAssignmentId === a.id && (
                              <div style={{ marginTop: '12px', borderTop: '1px dashed var(--border)', paddingTop: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 6px 0' }}>
                                  <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--primary)', margin: 0 }}>📊 수강생 제출 현황 (상태를 바꾸면 바로 저장)</p>
                                  <button className="btn sm ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => markAllSubmitted(a.id)}>미확인 → 모두 제출</button>
                                </div>
                                <div style={{ background: 'var(--surface-2)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                                  {!submissions[a.id] ? (
                                    <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>불러오는 중…</p>
                                  ) : submissions[a.id].length === 0 ? (
                                    <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>수강생 명단이 없어 조회할 수 없습니다.</p>
                                  ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
                                          <th style={{ padding: '4px' }}>학생 이름</th>
                                          <th style={{ padding: '4px' }}>현황</th>
                                          <th style={{ padding: '4px' }}>확인 시각</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {submissions[a.id].map((row) => (
                                          <tr key={row.member_id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                                            <td style={{ padding: '4px', fontWeight: '600' }}>{row.name}</td>
                                            <td style={{ padding: '4px' }}>
                                              <select className="select" value={row.status} style={{ padding: '2px 6px', fontSize: 12, color: SUBMISSION_COLOR[row.status], fontWeight: 600 }}
                                                onChange={(e) => handleSubmissionChange(a.id, row.member_id, e.target.value)}>
                                                {Object.entries(SUBMISSION_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                              </select>
                                            </td>
                                            <td style={{ padding: '4px', color: 'var(--text-3)' }}>
                                              {row.checked_at ? row.checked_at.slice(0, 16).replace('T', ' ') : '-'}
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
              <input type="text" className="input" name="name" value={formData.name} onChange={handleInputChange} placeholder="예: 초등 품새반" />
            </div>
            
            <div className="form-row">
              <label>담당 강사 *</label>
              <input type="text" className="input" name="prof" value={formData.prof} onChange={handleInputChange} placeholder="예: 김사범" />
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
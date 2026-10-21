import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  fetchAttendances, updateMember, analyzeDataWithAI, fetchMemberNotes, createMemberNote, deleteMemberNote,
  notifyMemberParents, errorText,
} from "../api";
import { resizeImageFile } from "../utils/image";

const STATUS_KO = { PRESENT: "출석", ABSENT: "결석", LATE: "지각" };

export default function MemberDetailDashboard({ member, enrolledClasses, onClose, onUpdate }) {
  const [attendances, setAttendances] = useState([]);
  // v8.1: 상담·특이사항은 시간순 기록으로 서버에 저장 (기존: 저장되지 않는 special_notes 필드)
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyForm, setNotifyForm] = useState({ title: "안내", message: "" });
  const [aiSummary, setAiSummary] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  // 사진 업로드 상태 및 실시간 렌더링을 위한 로컬 상태
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false); 
  const [localPhotoUrl, setLocalPhotoUrl] = useState(member.photo_url || "");

  // 외부에서 member 데이터가 변경되면 로컬 사진 상태도 동기화
  useEffect(() => {
    setLocalPhotoUrl(member.photo_url || "");
  }, [member.photo_url]);

  useEffect(() => {
    fetchAttendances({ member_id: member.member_id })
      .then(data => setAttendances(Array.isArray(data) ? data : []))
      .catch(() => setAttendances([]));
    fetchMemberNotes(member.member_id).then(setNotes).catch(() => setNotes([]));
  }, [member.member_id]);

  // 최근 30일 출결 통계 (출석률 정의: (출석+지각) ÷ 출결 기록 수)
  const stats30 = useMemo(() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recent = attendances.filter(a => a.attendance_date >= since);
    const c = { PRESENT: 0, LATE: 0, ABSENT: 0 };
    recent.forEach(a => { c[a.status] = (c[a.status] || 0) + 1; });
    const rate = recent.length ? Math.round(((c.PRESENT + c.LATE) / recent.length) * 100) : null;
    let streak = 0;
    for (const a of attendances) { if (a.status === "ABSENT") streak += 1; else break; }
    return { ...c, total: recent.length, rate, absentStreak: streak };
  }, [attendances]);

  const handleAddNote = async () => {
    if (!noteDraft.trim()) return;
    setIsSavingNotes(true);
    try {
      const note = await createMemberNote(member.member_id, noteDraft.trim());
      setNotes(prev => [note, ...prev]);
      setNoteDraft("");
    } catch (e) {
      alert(errorText(e, "기록을 저장하지 못했습니다."));
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    try {
      await deleteMemberNote(noteId);
      setNotes(prev => prev.filter(n => n.note_id !== noteId));
    } catch (e) {
      alert(errorText(e, "기록을 삭제하지 못했습니다."));
    }
  };

  const handleNotify = async () => {
    if (!notifyForm.message.trim()) return alert("보낼 내용을 입력하세요.");
    try {
      const result = await notifyMemberParents(member.member_id, { ...notifyForm, kind: "NOTICE" });
      alert(result.message);
      if (result.sent) { setNotifyOpen(false); setNotifyForm({ title: "안내", message: "" }); }
    } catch (e) {
      alert(errorText(e, "알림을 보내지 못했습니다."));
    }
  };

  // 기본 요약 (AI 없이 계산) — AI 가 꺼져 있거나 실패해도 시연이 끊기지 않도록
  const basicSummary = () => {
    const parts = [];
    parts.push(stats30.total ? `최근 30일 출결 ${stats30.total}건 중 출석 ${stats30.PRESENT}·지각 ${stats30.LATE}·결석 ${stats30.ABSENT} (출석률 ${stats30.rate}%).`
      : "최근 30일 출결 기록이 없습니다.");
    if (stats30.absentStreak >= 2) parts.push(`최근 ${stats30.absentStreak}회 연속 결석 — 보호자 연락을 권장합니다.`);
    if (member.unpaid_count > 0) parts.push(`미납 청구서 ${member.unpaid_count}건(${Number(member.unpaid_amount).toLocaleString()}원).`);
    if (notes[0]) parts.push(`최근 상담: “${notes[0].content.slice(0, 60)}${notes[0].content.length > 60 ? "…" : ""}”`);
    return parts.join(" ");
  };

  const handleSummarize = async () => {
    setIsSummarizing(true);
    try {
      // 서버가 이름을 가명(S0001)으로 바꾸고 연락처·주소는 아예 보내지 않음 — 여기서도 필요한 필드만 전달
      const context = {
        student: { name: member.name, gender: member.gender, age: member.age, status: member.status, classes: enrolledClasses || "" },
        attendance_30d: stats30,
        recent_attendances: attendances.slice(0, 30).map(a => ({ date: a.attendance_date, status: a.status })),
        unpaid: { count: member.unpaid_count || 0, amount: member.unpaid_amount || 0 },
        counseling_notes: notes.slice(0, 10).map(n => ({ date: (n.created_at || "").slice(0, 10), content: n.content })),
      };
      const summary = await analyzeDataWithAI(
        "이 학생의 출결 흐름, 미납, 상담 기록을 3~5문장으로 요약하고 관리자가 할 일을 1~2개 제안해 줘.", context);
      setAiSummary(summary);
    } catch (e) {
      setAiSummary(`${basicSummary()}\n\n(AI 요약을 사용할 수 없어 기본 통계로 요약했습니다: ${e.message})`);
    } finally {
      setIsSummarizing(false);
    }
  };

  // 사진 업로드 핸들러
  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setIsUploadingPhoto(true);
    try {
      const dataUrl = await resizeImageFile(file, "profile");   // 512px 로 줄여 업로드(Vercel 4.5MB 한도)
      setLocalPhotoUrl(dataUrl);

      // DB에 변경된 사진 URL 업데이트
      const { unpaid_amount: _ua, unpaid_count: _uc, ...memberFields } = member;   // 서버 계산 필드는 보내지 않음
      const updated = await updateMember(member.member_id, { ...memberFields, photo_url: dataUrl });
      const newPhotoUrl = updated.photo_url || dataUrl;
      setLocalPhotoUrl(newPhotoUrl);
      if (onUpdate) onUpdate();
    } catch (err) {
      console.error("사진 업로드 에러:", err);
      alert(err?.response?.data?.detail || err?.message || "사진 업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  return (
    <div className="dashboard-modal-backdrop" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div className="dashboard-panel" style={{ width: "600px", background: "var(--surface)", height: "100%", padding: "24px", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" }} onClick={(e) => e.stopPropagation()}>
        
        {/* 상단 프로필 영역 */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "24px", borderBottom: "1px solid var(--border)", paddingBottom: "20px" }}>
          
          {/* 프로필 사진 (원형 영역) */}
          <div style={{ position: "relative", width: "72px", height: "72px", flexShrink: 0 }}>
            <div 
              className="avatar" 
              style={{ 
                width: "100%", 
                height: "100%", 
                borderRadius: "50%", 
                overflow: "hidden", 
                backgroundColor: "var(--surface-hover)", 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                fontSize: "28px", 
                fontWeight: "bold", 
                color: "var(--text)", 
                border: "1px solid var(--border)" 
              }}
            >
              {isUploadingPhoto ? (
                <span style={{ fontSize: "14px", color: "var(--text-2)" }}>⏳</span>
              ) : localPhotoUrl ? (
                <img 
                  src={localPhotoUrl.startsWith("http") || localPhotoUrl.startsWith("data:") ? localPhotoUrl : `${import.meta.env.VITE_API_BASE_URL || ""}${localPhotoUrl}`} 
                  alt={member.name} 
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                />
              ) : (
                member.name?.[0]
              )}
            </div>
            
            {/* 📷 업로드 버튼 */}
            <label 
              htmlFor="dashboard-photo-upload" 
              style={{ 
                position: "absolute", 
                bottom: "-4px", 
                right: "-4px", 
                cursor: "pointer", 
                backgroundColor: "var(--primary)", 
                color: "var(--surface)", 
                borderRadius: "50%", 
                width: "28px", 
                height: "28px", 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                fontSize: "14px", 
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                border: "2px solid var(--surface)",
                transition: "background-color 0.15s"
              }}
            >
              📷
            </label>
            <input 
              id="dashboard-photo-upload" 
              type="file" 
              accept="image/*" 
              style={{ display: "none" }} 
              onChange={handlePhotoUpload} 
              disabled={isUploadingPhoto} 
            />
          </div>

          {/* 학생 이름 및 정보 */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "700", color: "var(--text)" }}>{member.name}</h2>
              <span className={`badge ${member.status === "ACTIVE" ? "success" : "gray"}`} style={{ fontSize: "12px" }}>
                {member.status === "ACTIVE" ? "재원" : "퇴원"}
              </span>
            </div>
            <p style={{ margin: "4px 0 0 0", color: "var(--text-2)", fontSize: "14px" }}>
              {enrolledClasses || "수강 중인 과목이 없습니다."}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "flex-start" }}>
            <button className="btn ghost" onClick={onClose} style={{ color: "var(--text-3)" }} aria-label="닫기">✕</button>
          </div>
        </div>

        {/* 기본 정보 카드 섹션 */}
        <div style={{ marginBottom: "24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "var(--surface-2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-3)", marginBottom: "4px" }}>기본 정보</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>성별: {member.gender === 'M' ? '남' : '여'} / 나이: {member.age}</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>등록일: {member.enrollment_date}</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>결제일: {member.payment_date ? `매월 ${new Date(member.payment_date).getDate()}일` : "-"}</div>
            </div>
            <div style={{ background: "var(--surface-2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-3)", marginBottom: "4px" }}>연락처 정보</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>부: {member.father_phone || '-'} ({member.father_name || '-'})</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>모: {member.mother_phone || '-'} ({member.mother_name || '-'})</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>주소: {member.address || '-'}</div>
            </div>
        </div>

        {/* v8.1 요약 카드: 30일 출석률 · 미납 · 학부모 알림 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
          <div style={{ padding: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)" }} title="(출석+지각) ÷ 최근 30일 출결 기록 수">
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>30일 출석률</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: stats30.rate != null && stats30.rate < 70 ? "var(--danger)" : "var(--text)" }}>{stats30.rate ?? "–"}{stats30.rate != null && "%"}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>{stats30.absentStreak >= 2 ? `⚠ ${stats30.absentStreak}회 연속 결석` : `기록 ${stats30.total}건`}</div>
          </div>
          <div style={{ padding: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>미납</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: member.unpaid_count ? "var(--danger)" : "var(--success)" }}>
              {member.unpaid_count ? `${Number(member.unpaid_amount).toLocaleString()}원` : "없음"}
            </div>
            {member.unpaid_count > 0 && <Link to="/admin-checkout" style={{ fontSize: 11 }}>청구서 {member.unpaid_count}건 보기 →</Link>}
          </div>
          <div style={{ padding: 12, borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
            <button className="btn sm" onClick={() => setNotifyOpen(v => !v)}>🔔 학부모 알림</button>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>학부모 포털 앱 알림</span>
          </div>
        </div>
        {notifyOpen && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12, marginBottom: 20, background: "var(--surface-2)" }}>
            <input className="input" maxLength={100} value={notifyForm.title} onChange={(e) => setNotifyForm({ ...notifyForm, title: e.target.value })} style={{ marginBottom: 8 }} />
            <textarea className="input" maxLength={1000} style={{ height: 80, padding: 10 }} value={notifyForm.message}
              onChange={(e) => setNotifyForm({ ...notifyForm, message: e.target.value })}
              placeholder={member.unpaid_count ? `예: ${member.name} 학생의 이번 달 수강료가 아직 납부되지 않았습니다. 학부모 포털에서 결제해 주세요.` : "보낼 내용을 입력하세요."} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
              <button className="btn sm ghost" onClick={() => setNotifyOpen(false)}>취소</button>
              <button className="btn sm" onClick={handleNotify}>보내기</button>
            </div>
          </div>
        )}

        {/* 출석 현황 테이블 */}
        <h3 style={{ fontSize: "16px", marginBottom: "12px", color: "var(--text)" }}>출석 현황 <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}>(최근 30건)</span></h3>
        <div style={{ overflowX: "auto", marginBottom: "24px", maxHeight: 280, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", color: "var(--text)" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>날짜</th>
                  <th style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>상태</th>
                  <th style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>등원 시간</th>
                  <th style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>하원 시간</th>
                  <th style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>비고</th>
                </tr>
              </thead>
              <tbody>
                {attendances.length > 0 ? (
                  attendances.slice(0, 30).map(att => (
                    <tr key={att.attendance_id}>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.attendance_date}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>
                        {STATUS_KO[att.status] || att.status}
                      </td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.check_in_time?.slice(0, 5) || '-'}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.check_out_time?.slice(0, 5) || '-'}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.note || '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "16px", color: "var(--text-3)" }}>출석 기록이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
        </div>

        {/* AI 요약 */}
        <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ fontSize: "16px", margin: 0, color: "var(--text)" }}>AI 요약</h3>
                <button className="btn sm ghost" onClick={handleSummarize} disabled={isSummarizing}>
                    {isSummarizing ? "요약 중..." : "✨ 요약 생성"}
                </button>
            </div>
            <div style={{ background: "var(--primary-soft)", padding: "16px", borderRadius: "var(--radius)", fontSize: "14px", lineHeight: "1.6", color: "var(--text)", whiteSpace: "pre-wrap" }}>
                {aiSummary || basicSummary()}
            </div>
        </div>

        {/* 상담·특이사항 기록 (시간순) */}
        <div>
            <h3 style={{ fontSize: "16px", margin: "0 0 12px", color: "var(--text)" }}>상담·특이사항 기록</h3>
            <textarea
                className="input"
                style={{ height: "90px", resize: "vertical", padding: "12px" }}
                value={noteDraft}
                maxLength={2000}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="예: 보호자 통화 — 다음 주부터 화·목 반으로 변경 희망"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 16px" }}>
              <button className="btn sm" onClick={handleAddNote} disabled={isSavingNotes || !noteDraft.trim()}>
                {isSavingNotes ? "저장 중..." : "기록 추가"}
              </button>
            </div>
            {notes.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: 12 }}>아직 기록이 없습니다.</div>
            ) : notes.map(n => (
              <div key={n.note_id} style={{ borderLeft: "3px solid var(--primary)", padding: "6px 12px", marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "var(--text-3)", display: "flex", justifyContent: "space-between" }}>
                  <span>{(n.created_at || "").slice(0, 16).replace("T", " ")} · {n.author}</span>
                  <button className="btn ghost sm" style={{ padding: "0 6px", fontSize: 11 }} onClick={() => handleDeleteNote(n.note_id)}>삭제</button>
                </div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 2 }}>{n.content}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

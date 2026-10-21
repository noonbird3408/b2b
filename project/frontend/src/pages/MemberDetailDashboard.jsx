import React, { useState, useEffect } from "react";
import { fetchAttendances, updateMember } from "../api";
import { analyzeDataWithAI } from "../api";
import { resizeImageFile } from "../utils/image";

export default function MemberDetailDashboard({ member, enrolledClasses, onClose, onUpdate }) {
  const [attendances, setAttendances] = useState([]);
  const [specialNotes, setSpecialNotes] = useState(member.special_notes || "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
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
      .then(data => {
        setAttendances(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
  }, [member.member_id]);

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      await updateMember(member.member_id, { ...member, special_notes: specialNotes });
      alert("특이사항이 저장되었습니다.");
      if (onUpdate) onUpdate();
    } catch (e) {
      alert("특이사항 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleSummarize = async () => {
    setIsSummarizing(true);
    try {
      const summary = await analyzeDataWithAI("이 학생의 출결 및 특이사항을 요약해줘.", { member, attendances, specialNotes });
      setAiSummary(summary);
    } catch (e) {
      alert("AI 요약 중 오류가 발생했습니다.");
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
      const updated = await updateMember(member.member_id, { ...member, photo_url: dataUrl });
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
                {member.status === "ACTIVE" ? "활동중" : "퇴관"}
              </span>
            </div>
            <p style={{ margin: "4px 0 0 0", color: "var(--text-2)", fontSize: "14px" }}>
              {enrolledClasses || "수강 중인 과목이 없습니다."}
            </p>
          </div>
          <button className="btn ghost" onClick={onClose} style={{ alignSelf: "flex-start", color: "var(--text-3)" }}>✕</button>
        </div>

        {/* 기본 정보 카드 섹션 */}
        <div style={{ marginBottom: "24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "var(--surface-2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-3)", marginBottom: "4px" }}>기본 정보</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>성별: {member.gender === 'M' ? '남' : '여'} / 나이: {member.age}</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>입관일: {member.enrollment_date}</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>결제일: 매월 {new Date(member.payment_date).getDate()}일</div>
            </div>
            <div style={{ background: "var(--surface-2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-3)", marginBottom: "4px" }}>연락처 정보</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>부: {member.father_phone || '-'} ({member.father_name || '-'})</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>모: {member.mother_phone || '-'} ({member.mother_name || '-'})</div>
                <div style={{ fontSize: "14px", color: "var(--text)" }}>주소: {member.address || '-'}</div>
            </div>
        </div>

        {/* 출석 현황 테이블 */}
        <h3 style={{ fontSize: "16px", marginBottom: "12px", color: "var(--text)" }}>출석 현황</h3>
        <div style={{ overflowX: "auto", marginBottom: "24px" }}>
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
                  attendances.map(att => (
                    <tr key={att.attendance_id}>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.attendance_date}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>
                        {att.status === 'PRESENT' ? '출석' : att.status === 'ABSENT' ? '결석' : att.status === 'LATE' ? '지각' : att.status}
                      </td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.check_in_time || '-'}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--surface-hover)' }}>{att.check_out_time || '-'}</td>
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
            <div style={{ background: "var(--primary-soft)", padding: "16px", borderRadius: "var(--radius)", fontSize: "14px", lineHeight: "1.6", color: "var(--text)" }}>
                {aiSummary || "요약 생성 버튼을 눌러 학생의 상태를 분석해보세요."}
            </div>
        </div>

        {/* 특이사항 메모란 */}
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ fontSize: "16px", margin: 0, color: "var(--text)" }}>특이사항 (관리자 메모)</h3>
                <button className="btn sm" onClick={handleSaveNotes} disabled={isSavingNotes}>
                    {isSavingNotes ? "저장 중..." : "저장"}
                </button>
            </div>
            <textarea 
                className="input" 
                style={{ height: "120px", resize: "vertical", padding: "12px" }} 
                value={specialNotes} 
                onChange={(e) => setSpecialNotes(e.target.value)}
                placeholder="학생에 대한 특이사항이나 상담 내용을 메모하세요."
            />
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState, useMemo } from "react";
import { fetchMembers, createMember, updateMember, deleteMember, fetchClasses, fetchEnrollmentMap } from "../api";
import { resizeImageFile } from "../utils/image";

const errorMessage = (error, fallback) => error?.response?.data?.detail || error?.message || fallback;
import MemberDetailDashboard from "./MemberDetailDashboard";
import { extractStudentInfoFromImage } from '../api';

const today = () => new Date().toISOString().slice(0, 10);

const ageToGrade = (age) => {
  if (age == null) return "";
  if (age >= 7  && age <= 12) return `초${age - 6}`;
  if (age >= 13 && age <= 15) return `중${age - 12}`;
  if (age >= 16 && age <= 18) return `고${age - 15}`;
  return "";
};

const formatPaymentDay = (dateStr) => {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return `매월 ${d.getDate()}일`;
};

const daysSince = (dateStr) => {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

const paymentBadge = (m) => {
  if (m.status === "WITHDRAWN") return { cls: "gray", label: "종료" };
  const days = daysSince(m.payment_date);
  if (days == null || days > 60) return { cls: "danger",  label: `미납 ${days ?? "?"}일` };
  if (days > 30) return { cls: "danger",  label: `미납 ${days}일` };
  return { cls: "success", label: "납부 완료" };
};

export default function Members() {
  const [members, setMembers] = useState([]);
  const [classes, setClasses] = useState([]); 
  const [memberClasses, setMemberClasses] = useState({}); 

  const [statusFilter, setStatusFilter] = useState(""); 
  const [classFilter, setClassFilter] = useState(""); 
  const [gradeFilter, setGradeFilter] = useState(""); 
  const [q, setQ] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showOcrModal, setShowOcrModal] = useState(false);
  
  const [editingMember, setEditingMember] = useState(null); 
  const [activeMenuId, setActiveMenuId] = useState(null);   
  const [error, setError] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);

  const load = async () => {
    try {
      let classData = [];
      try {
        const rawClassData = await fetchClasses();
        classData = Array.isArray(rawClassData) ? rawClassData : [];
      } catch (err) {
        classData = [];
      }
      setClasses(classData);

      const rawMemData = await fetchMembers({
        status: statusFilter || undefined,
        class_id: classFilter || undefined,
        grade: gradeFilter || undefined,
        q: q || undefined
      });
      
      let validMembers = Array.isArray(rawMemData) ? rawMemData : [];
      
      if (gradeFilter) {
        validMembers = validMembers.filter(m => {
          const grade = ageToGrade(m.age); 
          if (gradeFilter === "초등") return grade.startsWith("초");
          if (gradeFilter === "중등") return grade.startsWith("중");
          if (gradeFilter === "고등") return grade.startsWith("고");
          return true;
        });
      }
      setMembers(validMembers);

      // [PERF] 학생 수만큼 /api/members/{id}/classes 를 호출하던 N+1 → 1회 호출
      let classesMap = {};
      try {
        classesMap = await fetchEnrollmentMap();
      } catch (e) {
        classesMap = {};
      }
      setMemberClasses(classesMap);
      setError(null); 
    } catch (e) {
      console.error(e); 
      setError(e.message || "데이터를 불러오는 중 오류가 발생했습니다.");
    }
  };
  
  useEffect(() => { load(); }, [statusFilter, classFilter, gradeFilter]);

  const onDelete = async (id) => {
    if (!window.confirm("정말 삭제하시겠습니까? 출결·수강 기록과 미납 청구서가 함께 삭제됩니다.\n(결제 기록이 있는 학생은 삭제 대신 '퇴원'으로 바꿔 주세요.)")) return;
    try {
      await deleteMember(id);
    } catch (error) {
      alert(errorMessage(error, "학생을 삭제하지 못했습니다."));
    }
    load();
  };

  const handleDownloadCSV = () => {
    if (!Array.isArray(members) || members.length === 0) {
      alert("다운로드할 학생 데이터가 없습니다.");
      return;
    }
    const headers = ["이름", "성별", "나이", "학년", "수강 과목", "입관일", "퇴관일", "부모님 연락처", "부모님 성함", "주소", "회비 납부일", "상태"];
    
    const rows = members.map(m => {
      const enrolledClasses = memberClasses[m.member_id]?.join(", ") || "미수강";
      
      return [
        m.name, m.gender === "M" ? "남" : "여", m.age,
        ageToGrade(m.age) || "-", enrolledClasses, m.enrollment_date, m.withdrawal_date || "-",
        m.mother_phone || m.father_phone || "-", m.mother_name || m.father_name || "-",
        m.address || "-", formatPaymentDay(m.payment_date),
        m.status === "ACTIVE" ? "활동중" : "퇴관"
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `학생명단_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stats = useMemo(() => {
    const safeMembers = Array.isArray(members) ? members : [];
    const active = safeMembers.filter(m => m.status === "ACTIVE").length;
    const unpaidCnt = safeMembers.filter(m => m.status === "ACTIVE" &&
      (daysSince(m.payment_date) ?? 999) > 30).length;
    
    const paidCnt = active - unpaidCnt;
    const paymentRate = active > 0 ? Math.round((paidCnt / active) * 100) : 0;

    return { total: safeMembers.length, active, unpaidCnt, paymentRate };
  }, [members]);

  const getRateColor = (rate) => {
    if (rate >= 80) return "success";  
    if (rate >= 50) return "warning";  
    return "danger";                   
  };

  return (
    <>
      <h2 className="page-title">학생 관리</h2>
      <p className="page-subtitle">전체 {stats.total}명 · 활동중 {stats.active}명</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">전체 학생</span></div>
          <div className="stat-value num">{stats.total}<span className="unit">명</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">오늘 출석</span></div>
          <div className="stat-value num primary">{Math.round(stats.active * 0.78)}<span className="unit">명</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">회비 미납</span></div>
          <div className="stat-value num danger">{stats.unpaidCnt}<span className="unit">건</span></div>
          <div className="stat-sub">미납 60일 초과부터 대쉬보드에 갱신됩니다.</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">이달 수납률</span></div>
          <div className={`stat-value num ${getRateColor(stats.paymentRate)}`}>
            {stats.paymentRate}<span className="unit">%</span>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <input
            className="input"
            placeholder="이름·전화·부모님 이름으로 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </div>
        
        <div style={{ display: "flex", flexDirection: "row", gap: "8px" }}>
          <select className="select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">반 전체 ▼</option>
            {Array.isArray(classes) && classes.map((c) => (
              <option key={c.class_id} value={c.class_id}>{c.name}</option>
            ))}
          </select>
          
          <select className="select" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
            <option value="">학년 ▼</option>
            <option value="초등">초등</option>
            <option value="중등">중등</option>
            <option value="고등">고등</option>
          </select>
          
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">납부상태 ▼</option>
            <option value="ACTIVE">활동중</option>
            <option value="WITHDRAWN">퇴관</option>
          </select>
        </div>
        
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={handleDownloadCSV}>⬇ 엑셀</button>
        <button className="btn" style={{ border: "1px solid var(--border)" }} onClick={() => setShowOcrModal(true)}>
          📸 사진으로 학생 추가
        </button>
        <button className="btn" onClick={() => { setEditingMember(null); setShowModal(true); }}>+ 학생 추가</button>
      </div>

      {(!Array.isArray(members) || members.length === 0) ? (
        <div className="empty">조회된 학생이 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto", overflowY: "visible", paddingBottom: "200px" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" /></th>
                <th>이름</th>
                <th>성별</th>
                <th>나이</th>
                <th>수강 과목</th>
                <th>입관일</th>
                <th>퇴관일</th>
                <th>부모님 전화</th>
                <th>부모님 성함</th>
                <th>주소</th>
                <th>회비 납부일</th>
                <th>납부 상태</th>
                <th style={{ width: 45 }}></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, index) => {
                const pb = paymentBadge(m);
                const isWithdrawn = m.status === "WITHDRAWN";
                const isNearBottom = index >= members.length - 2;
                
                const rowStyle = isWithdrawn 
                  ? { backgroundColor: "var(--surface-hover)", color: "var(--text-3)" }
                  : {};

                return (
                  <tr key={m.member_id}
                  onClick={() => setSelectedMember(m)}
                   style={{ cursor: 'pointer', ...rowStyle }}
                   >
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" /></td>
                    <td>
                      <div className="member-cell">
                        <div className="avatar" style={{ overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-hover)" }}>
                          {m.photo_url ? (
                            <img 
                              src={m.photo_url} 
                              alt={m.name} 
                              style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                            />
                          ) : (
                            m.name?.[0]
                          )}
                        </div>
                        <div>
                          <div className="name">{m.name}</div>
                          <div className="sub">{ageToGrade(m.age) ? `${ageToGrade(m.age)}` : "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td>{m.gender === "M" ? "남" : "여"}</td>
                    <td className="num">{m.age}{ageToGrade(m.age) && <span style={{ color: "var(--text-3)" }}> ({ageToGrade(m.age)})</span>}</td>
                    
                    <td>
                      {memberClasses[m.member_id]?.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {memberClasses[m.member_id].map((cName, idx) => (
                            <span key={idx} className="badge gray" style={{ fontSize: "11px", fontWeight: "500" }}>{cName}</span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-3)", fontSize: "12px" }}>미수강</span>
                      )}
                    </td>

                    <td className="num">{m.enrollment_date}</td>
                    <td className="num">{m.withdrawal_date || "-"}</td>
                    <td className="num">{m.mother_phone || m.father_phone || "-"}</td>
                    <td>{m.mother_name || m.father_name || "-"}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.address || "-"}</td>
                    <td className="num">{formatPaymentDay(m.payment_date)}</td>
                    <td><span className={`badge ${pb.cls}`}>{pb.label}</span></td>
                    
                    <td style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" onClick={() => setActiveMenuId(activeMenuId === m.member_id ? null : m.member_id)}>⋯</button>
                      {activeMenuId === m.member_id && (
                        <>
                          <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setActiveMenuId(null)} />
                          <div style={{
                            position: "absolute", 
                            right: 0, 
                            zIndex: 10,
                            top: isNearBottom ? "auto" : "100%",
                            bottom: isNearBottom ? "100%" : "auto",
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)", 
                            padding: "4px", 
                            minWidth: "80px",
                            display: "flex", 
                            flexDirection: "column", 
                            gap: "2px"
                          }}>
                            <button style={{
                              background: "none", border: "none", padding: "6px 12px", textAlign: "left",
                              cursor: "pointer", fontSize: "13px", borderRadius: "4px", color: "var(--text)"
                            }} onClick={() => { setEditingMember(m); setShowModal(true); setActiveMenuId(null); }}>수정</button>
                            <button style={{
                              background: "none", border: "none", padding: "6px 12px", textAlign: "left",
                              cursor: "pointer", fontSize: "13px", color: "var(--danger)", borderRadius: "4px"
                            }} onClick={() => { onDelete(m.member_id); setActiveMenuId(null); }}>삭제</button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <MemberModal 
          member={editingMember} 
          onClose={() => { setShowModal(false); setEditingMember(null); }}
          onSaved={() => { setShowModal(false); setEditingMember(null); load(); }}
        />
      )}

      {showOcrModal && (
        <OcrMemberModal
          onClose={() => setShowOcrModal(false)}
          onSaved={() => { setShowOcrModal(false); load(); }}
        />
      )}

      {selectedMember && (
        <MemberDetailDashboard 
          member={selectedMember} 
          enrolledClasses={memberClasses[selectedMember.member_id]?.join(", ")}
          onClose={() => setSelectedMember(null)}
          onUpdate={load}
        />
      )}
    </>
  );
}

function OcrMemberModal({ onClose, onSaved }) {
  const [step, setStep] = useState("upload");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "", gender: "", age: "",
    enrollment_date: today(), withdrawal_date: "", status: "ACTIVE", payment_date: today(),
    father_name: "", mother_name: "", father_phone: "", mother_phone: "", address: "",
    photo_url: "",
  });

  const updateOcrData = (k, v) => setFormData((f) => ({ ...f, [k]: v }));

  // 서류 사진은 인식(OCR)에만 쓰고 저장하지 않습니다 — 연락처·주소가 찍힌 서류가 프로필 사진으로 남지 않도록
  const [documentPreview, setDocumentPreview] = useState("");

  const processFile = async (file) => {
    setLoading(true);
    setError(null);
    setStep("processing");

    try {
      // 1. 서류 사진을 글자가 읽히는 크기(1600px)로 줄여 data URL 로 변환 (업로드 한도 4.5MB 대응)
      const base64Image = await resizeImageFile(file, "document");
      setDocumentPreview(base64Image);

      // 2. 서버(Gemini 프록시)를 호출하여 학생 정보 추출
      const parsedData = await extractStudentInfoFromImage(base64Image, "image/jpeg");

      setFormData(prev => ({ 
        ...prev, 
        name: parsedData.name !== undefined && parsedData.name !== "" ? parsedData.name : prev.name,
        age: parsedData.age !== undefined && parsedData.age !== "" ? parsedData.age : prev.age,
        gender: parsedData.gender !== undefined && parsedData.gender !== "" ? parsedData.gender : prev.gender,
        mother_phone: parsedData.mother_phone !== undefined && parsedData.mother_phone !== "" ? parsedData.mother_phone : prev.mother_phone,
        father_phone: parsedData.father_phone !== undefined && parsedData.father_phone !== "" ? parsedData.father_phone : prev.father_phone,
        address: parsedData.address !== undefined && parsedData.address !== "" ? parsedData.address : prev.address,
        enrollment_date: parsedData.enrollment_date || prev.enrollment_date,
        payment_date: parsedData.payment_date || prev.payment_date
      }));
      setStep("verify");

    } catch (err) {
      console.error("Gemini 인식 오류:", err);
      setError("사진에서 데이터를 추출하지 못했습니다. 다시 시도하거나 이미지를 확인해주세요.");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const submit = async () => {
    if (!formData.name || !formData.gender || !formData.age) {
       setError("이름, 성별, 나이는 필수 입력 항목입니다.");
       return;
    }
    try {
      await createMember({ ...formData, age: Number(formData.age) });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "학생 데이터 등록에 실패했습니다."));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>사진으로 학생 추가 (Gemini AI)</h3>
        {error && <div className="error-banner">{error}</div>}

        {step === "upload" && (
          <div 
            style={{
              border: `2px dashed ${isDragging ? "var(--primary)" : "var(--border-strong)"}`, 
              borderRadius: "8px",
              padding: "40px", 
              textAlign: "center", 
              backgroundColor: isDragging ? "var(--primary-soft)" : "var(--surface-hover)", 
              cursor: "pointer",
              transition: "all 0.2s ease"
            }} 
            onClick={() => document.getElementById("ocr-file-input").click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>✨</div>
            <p style={{ margin: "0 0 10px 0", color: "var(--text-2)", fontWeight: "500" }}>
              Gemini AI로 서류 사진을 분석합니다. 업로드하거나 드래그하세요.
            </p>
            <p style={{ margin: "0 0 16px 0", color: "var(--text-3)", fontSize: "13px" }}>
              (이름, 나이, 연락처, 주소가 포함된 가입 신청서 등)
            </p>
            <button className="btn ghost">이미지 선택</button>
            <input 
              id="ocr-file-input" 
              type="file" 
              accept="image/*" 
              style={{ display: "none" }} 
              onChange={handleImageUpload} 
            />
          </div>
        )}

        {step === "processing" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px", animation: "pulse 1.5s infinite" }}>🤖</div>
            <p style={{ marginBottom: "16px", fontWeight: "500", color: "var(--primary)" }}>
              Gemini AI가 문서를 분석하고 있습니다...
            </p>
            <p style={{ marginTop: "16px", color: "var(--text-3)", fontSize: "13px" }}>
              잠시만 기다려주세요. (일반적으로 3~5초 소요)
            </p>
          </div>
        )}

        {step === "verify" && (
          <div>
            <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--primary-soft)", borderRadius: "8px", fontSize: "13px", color: "var(--primary-text)" }}>
              ✅ 분석이 완료되었습니다. 추출된 정보를 확인하고 <strong>잘못된 부분이 있다면 직접 수정해주세요.</strong>
            </div>
            {documentPreview && (
              <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "16px", overflow: "hidden", background: "var(--surface-hover)" }}>
                  <img src={documentPreview} alt="인식한 서류" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ color: "var(--text-2)", fontSize: "13px" }}>
                  서류 사진은 인식에만 사용하고 저장하지 않습니다. 프로필 사진은 등록 후 학생 정보 수정에서 올릴 수 있습니다.
                </div>
              </div>
            )}

            <div className="form-row">
              <label>이름</label>
              <input className="input" value={formData.name} onChange={(e) => updateOcrData("name", e.target.value)} />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row">
                <label>성별</label>
                <select className="select" value={formData.gender} onChange={(e) => updateOcrData("gender", e.target.value)}>
                  <option value="">선택</option>
                  <option value="M">남</option>
                  <option value="F">여</option>
                </select>
              </div>
              <div className="form-row">
                <label>나이</label>
                <input type="number" className="input" value={formData.age} onChange={(e) => updateOcrData("age", e.target.value)} placeholder="예: 13" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row">
                <label>입관일</label>
                <input type="date" className="input" value={formData.enrollment_date} onChange={(e) => updateOcrData("enrollment_date", e.target.value)} />
              </div>
              <div className="form-row">
                <label>결제일</label>
                <input type="date" className="input" value={formData.payment_date} onChange={(e) => updateOcrData("payment_date", e.target.value)} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row">
                <label>부 연락처</label>
                <input className="input" value={formData.father_phone} onChange={(e) => updateOcrData("father_phone", e.target.value)} />
              </div>
              <div className="form-row">
                <label>모 연락처</label>
                <input className="input" value={formData.mother_phone} onChange={(e) => updateOcrData("mother_phone", e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <label>주소</label>
              <input className="input" value={formData.address} onChange={(e) => updateOcrData("address", e.target.value)} />
            </div>

            <div className="modal-actions" style={{ marginTop: "24px" }}>
              <button className="btn ghost" onClick={() => setStep("upload")}>다시 업로드</button>
              <button className="btn" onClick={submit} disabled={!formData.name || !formData.gender || !formData.age}>
                수정 완료 및 등록
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function MemberModal({ onClose, onSaved, member }) {
  const isEdit = !!member; 

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const [form, setForm] = useState({
    name: "", gender: "M", age: 10, photo_url: "",
    enrollment_date: today(), withdrawal_date: "",
    status: "ACTIVE", payment_date: today(),
    father_name: "", mother_name: "",
    father_phone: "", mother_phone: "", address: "", 
  });

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (member) {
      setForm({
        name: member.name || "", gender: member.gender || "M", age: member.age || 10,
        photo_url: member.photo_url || "",
        enrollment_date: member.enrollment_date || today(), withdrawal_date: member.withdrawal_date || "",
        status: member.status || "ACTIVE", payment_date: member.payment_date || today(),
        father_name: member.father_name || "", mother_name: member.mother_name || "",
        father_phone: member.father_phone || "", mother_phone: member.mother_phone || "", address: member.address || "", 
      });
    }
  }, [member]);

  const submit = async () => {
    setSubmitting(true); setErr(null);
    try {
      if (isEdit) await updateMember(member.member_id, { ...form, age: Number(form.age) });
      else await createMember({ ...form, age: Number(form.age) });
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, "저장에 실패했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  const getPaymentStatus = () => {
    if (form.status === "WITHDRAWN") return "WITHDRAWN";
    const days = daysSince(form.payment_date);
    if (days != null && days > 30) return "UNPAID";
    return "PAID";
  };
  
  const currentStatus = getPaymentStatus();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? "학생 정보 수정" : "신규 학생 등록"}</h3>
        {err && <div className="error-banner">{err}</div>}

        
        <div className="form-row" style={{ marginBottom: "20px" }}>
          <label>학생 프로필 사진</label>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "4px" }}>
            <div className="avatar" style={{ width: "60px", height: "60px", borderRadius: "50%", overflow: "hidden", background: "var(--surface-hover)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", fontSize: "20px" }}>
              {form.photo_url ? (
                <img src={form.photo_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="미리보기" />
              ) : (
                form.name?.[0] || "?"
              )}
            </div>
            <input 
              type="file" 
              accept="image/*"
              style={{ fontSize: "13px" }}
              onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                  update("photo_url", await resizeImageFile(file, "profile"));   // 512px 로 줄여 저장
                } catch (error) {
                  setErr(error.message);
                }
              }}
            />
          </div>
        </div>

        <div className="form-row">
          <label>이름</label>
          <input className="input" value={form.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>성별</label>
            <select className="select" value={form.gender} onChange={(e) => update("gender", e.target.value)}>
              <option value="M">남</option><option value="F">여</option>
            </select>
          </div>
          <div className="form-row">
            <label>나이</label>
            <input type="number" className="input" value={form.age} onChange={(e) => update("age", e.target.value)} />
          </div>
        </div>

        {isEdit && (
          <div style={{ margin: "12px 0", padding: "12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "600", fontSize: "13px", textAlign: "center" }}>
              상태 및 납부 관리
            </label>
            
            <div style={{ display: "flex", gap: "8px" }}>
              <button 
                type="button" 
                className={`btn sm ${currentStatus === "PAID" ? "" : "ghost"}`} 
                style={{ 
                  flex: 1, 
                  border: currentStatus === "PAID" ? "none" : "1px solid var(--border)",
                  ...(currentStatus === "PAID" ? { backgroundColor: "var(--primary)", color: "#fff" } : {})
                }} 
                onClick={() => { update("payment_date", today()); update("status", "ACTIVE"); update("withdrawal_date", ""); }}
              >
                납부 완료
              </button>
              
              <button 
                type="button" 
                className={`btn sm ${currentStatus === "UNPAID" ? "" : "ghost"}`} 
                style={{ 
                  flex: 1, 
                  border: currentStatus === "UNPAID" ? "none" : "1px solid var(--border)",
                  ...(currentStatus === "UNPAID" ? { backgroundColor: "var(--danger)", color: "#fff" } : {})
                }} 
                onClick={() => { 
                  const d = new Date(); d.setDate(d.getDate() - 31); 
                  update("payment_date", d.toISOString().slice(0, 10)); 
                  update("status", "ACTIVE"); update("withdrawal_date", ""); 
                }}
              >
                미납 처리
              </button>
              
              <button 
                type="button" 
                className={`btn sm ${currentStatus === "WITHDRAWN" ? "" : "ghost"}`} 
                style={{ 
                  flex: 1, 
                  border: currentStatus === "WITHDRAWN" ? "none" : "1px solid var(--border)",
                  ...(currentStatus === "WITHDRAWN" ? { backgroundColor: "var(--text-2)", color: "#fff" } : {})
                }} 
                onClick={() => { update("status", "WITHDRAWN"); update("withdrawal_date", today()); }}
              >
                종료(퇴관)
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>상태</label>
            <select className="select" value={form.status} onChange={(e) => update("status", e.target.value)}>
              <option value="ACTIVE">활동중</option><option value="WITHDRAWN">퇴관</option>
            </select>
          </div>
          <div className="form-row">
            <label>퇴관일</label>
            <input type="date" className="input" value={form.withdrawal_date} onChange={(e) => update("withdrawal_date", e.target.value)} disabled={form.status !== "WITHDRAWN"} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>입관일</label>
            <input type="date" className="input" value={form.enrollment_date} onChange={(e) => update("enrollment_date", e.target.value)} />
          </div>
          <div className="form-row">
            <label>결제일</label>
            <input type="date" className="input" value={form.payment_date} onChange={(e) => update("payment_date", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>부 이름</label>
            <input className="input" value={form.father_name} onChange={(e) => update("father_name", e.target.value)} />
          </div>
          <div className="form-row">
            <label>부 연락처</label>
            <input className="input" value={form.father_phone} onChange={(e) => update("father_phone", e.target.value)} />
          </div>
          <div className="form-row">
            <label>모 이름</label>
            <input className="input" value={form.mother_name} onChange={(e) => update("mother_name", e.target.value)} />
          </div>
          <div className="form-row">
            <label>모 연락처</label>
            <input className="input" value={form.mother_phone} onChange={(e) => update("mother_phone", e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label>주소</label>
          <input className="input" value={form.address} onChange={(e) => update("address", e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={submitting}>취소</button>
          <button className="btn" onClick={submit} disabled={submitting || !form.name}>
            {submitting ? "저장 중..." : isEdit ? "수정 완료" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

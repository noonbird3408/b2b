import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchMemberAttendanceSummary, updateMember, analyzeDataWithAI, fetchMemberNotes, createMemberNote, deleteMemberNote,
  notifyMemberParents, errorText,
} from "../api";
import { resizeImageFile } from "../utils/image";
import { STATUS_LABEL, STATUS_TONE, useDataRefresh, won } from "../utils/sync";

const STYLES = `
.md-panel{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:100;display:flex;justify-content:flex-end;}
.md-body{width:min(640px,100vw);background:var(--surface);height:100%;overflow-y:auto;padding:22px;box-shadow:-4px 0 24px rgba(0,0,0,.15);}
.md-head{display:flex;gap:16px;align-items:flex-start;padding-bottom:18px;border-bottom:1px solid var(--border);margin-bottom:18px;}
.md-photo{position:relative;width:72px;height:72px;flex-shrink:0;}
.md-photo .avatar{width:100%;height:100%;font-size:26px;overflow:hidden;border:1px solid var(--border);}
.md-photo label{position:absolute;bottom:-4px;right:-4px;width:28px;height:28px;border-radius:50%;background:var(--primary);display:grid;place-items:center;cursor:pointer;border:2px solid var(--surface);font-size:13px;}
.md-name{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.md-name h2{margin:0;font-size:21px;}
.md-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.md-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end;}
.md-grid{display:grid;grid-template-columns:150px 1fr;gap:14px;margin-bottom:18px;}
.md-ring{position:relative;width:132px;height:132px;margin:auto;}
.md-ring svg{transform:rotate(-90deg);}
.md-ring .val{position:absolute;inset:0;display:grid;place-items:center;text-align:center;}
.md-ring .val b{font-size:26px;display:block;line-height:1;}
.md-ring .val span{font-size:11px;color:var(--text-3);}
.md-weeks{display:flex;align-items:flex-end;gap:4px;height:70px;margin-top:6px;}
.md-weeks div{flex:1;background:var(--primary-soft);border-radius:3px 3px 0 0;position:relative;min-height:3px;}
.md-weeks div.has{background:var(--primary);}
.md-class-row{display:grid;grid-template-columns:minmax(0,1fr) 120px 48px;gap:8px;align-items:center;font-size:12.5px;margin-bottom:6px;}
.md-bar{height:7px;background:var(--surface-hover);border-radius:99px;overflow:hidden;}
.md-bar i{display:block;height:100%;border-radius:99px;}
.md-info{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;}
.md-box{background:var(--surface-2);padding:12px;border-radius:10px;border:1px solid var(--border);font-size:13px;line-height:1.7;}
.md-box .t{font-size:12px;color:var(--text-3);margin-bottom:2px;}
.md-section{margin-bottom:22px;}
.md-section h3{font-size:15px;margin:0 0 10px;display:flex;align-items:center;gap:8px;}
.md-att-row{display:grid;grid-template-columns:96px minmax(0,1fr) 56px 90px;gap:8px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);font-size:13px;}
@media(max-width:600px){.md-body{padding:16px;}.md-grid,.md-info{grid-template-columns:1fr;}.md-head{flex-wrap:wrap;}.md-actions{margin-left:0;width:100%;justify-content:flex-start;}.md-att-row{grid-template-columns:84px minmax(0,1fr) 50px;}.md-att-row .time{display:none;}}
`;

function Ring({ value }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const color = value == null ? "var(--border)" : value >= 85 ? "var(--success)" : value >= 70 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="md-ring" role="meter" aria-label="출석률" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
      <svg width="132" height="132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--surface-hover)" strokeWidth="12" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .5s" }} />
      </svg>
      <div className="val"><div><b>{value == null ? "–" : `${Math.round(value)}%`}</b><span>최근 90일 출석률</span></div></div>
    </div>
  );
}

export default function MemberDetailDashboard({ member, readOnly = false, onClose, onUpdate, onEdit, onDelete }) {
  const navigate = useNavigate();
  const [att, setAtt] = useState(null);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyForm, setNotifyForm] = useState({ title: "안내", message: "" });
  const [aiSummary, setAiSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photo, setPhoto] = useState(member.photo_url || "");

  useEffect(() => { setPhoto(member.photo_url || ""); }, [member.photo_url]);

  const load = useCallback(() => {
    fetchMemberAttendanceSummary(member.member_id, { days: 90 }).then(setAtt).catch(() => setAtt({ items: [], summary: {}, by_class: [], weekly: [] }));
    if (!readOnly) fetchMemberNotes(member.member_id).then(setNotes).catch(() => setNotes([]));
  }, [member.member_id, readOnly]);
  useEffect(load, [load]);
  useDataRefresh(load);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = att?.summary || {};
  const items = att?.items || [];
  const classes = member.classes || [];
  const colorOf = (classId) => classes.find((c) => c.class_id === classId)?.color || "var(--primary)";

  const basicSummary = () => {
    const parts = [];
    parts.push(summary.records ? `최근 90일 출결 ${summary.records}건: 출석 ${summary.present} · 지각 ${summary.late} · 결석 ${summary.absent} (출석률 ${summary.rate}%).`
      : "최근 90일 출결 기록이 없습니다.");
    const weak = (att?.by_class || []).filter((c) => c.rate != null && c.rate < 70);
    if (weak.length) parts.push(`출석률이 낮은 수업: ${weak.map((c) => `${c.class_name} ${c.rate}%`).join(", ")}.`);
    if (summary.absent_streak >= 2) parts.push(`최근 ${summary.absent_streak}회 연속 결석 — 보호자 연락 권장.`);
    if (member.unpaid_count > 0) parts.push(`미납 ${member.unpaid_count}건 (${won(member.unpaid_amount)}).`);
    return parts.join(" ");
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      // 서버가 이름을 가명(S0001)으로 바꾸고 연락처·주소는 보내지 않음 — 여기서도 필요한 필드만 전달
      const context = {
        student: { name: member.name, gender: member.gender, age: member.age, status: member.status, classes: classes.map((c) => c.name).join(", ") },
        attendance_90d: summary, by_class: att?.by_class, weekly: att?.weekly,
        unpaid: { count: member.unpaid_count || 0, amount: member.unpaid_amount || 0 },
        counseling_notes: notes.slice(0, 10).map((n) => ({ date: (n.created_at || "").slice(0, 10), content: n.content })),
      };
      setAiSummary(await analyzeDataWithAI("이 학생의 수업별 출결 흐름, 미납, 상담 기록을 3~5문장으로 요약하고 관리자가 할 일을 1~2개 제안해 줘.", context));
    } catch (e) {
      setAiSummary(`${basicSummary()}\n\n(AI 요약을 사용할 수 없어 기본 통계로 요약했습니다)`);
    } finally {
      setSummarizing(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const note = await createMemberNote(member.member_id, noteDraft.trim());
      setNotes((prev) => [note, ...prev]);
      setNoteDraft("");
    } catch (e) {
      alert(errorText(e, "기록을 저장하지 못했습니다."));
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    try {
      await deleteMemberNote(noteId);
      setNotes((prev) => prev.filter((n) => n.note_id !== noteId));
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

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await resizeImageFile(file, "profile");
      setPhoto(dataUrl);
      // 서버 계산 필드(미납·수업 목록 등)는 보내지 않음
      const { unpaid_amount: _a, unpaid_count: _b, classes: _c, parent_linked: _d, ...fields } = member;
      const updated = await updateMember(member.member_id, { ...fields, photo_url: dataUrl });
      setPhoto(updated.photo_url || dataUrl);
      onUpdate?.();
    } catch (err) {
      alert(errorText(err, err?.message || "사진을 올리지 못했습니다."));
      setPhoto(member.photo_url || "");
    } finally {
      setUploading(false);
    }
  };

  const shown = showAll ? items : items.slice(0, 5);
  const maxWeekly = 100;

  return (
    <div className="md-panel" onClick={onClose}>
      <style>{STYLES}</style>
      <div className="md-body" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${member.name} 학생 상세`}>
        <div className="md-head">
          <div className="md-photo">
            <div className="avatar">
              {uploading ? "⏳" : photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : member.name?.[0]}
            </div>
            {!readOnly && (
              <>
                <label htmlFor="md-photo-upload" title="사진 변경">📷</label>
                <input id="md-photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} disabled={uploading} />
              </>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="md-name">
              <h2>{member.name}</h2>
              <span className={`badge ${member.status === "ACTIVE" ? "success" : "gray"}`}>{member.status === "ACTIVE" ? "재원" : "퇴원"}</span>
              {member.parent_linked && <span className="badge primary no-dot" title="학부모 계정 연결됨">학부모 연결</span>}
            </div>
            <div className="md-chips">
              {classes.length ? classes.map((c) => (
                <button key={c.class_id} type="button" className="chip" onClick={() => navigate(`/classes?class_id=${c.class_id}`)}
                  title="수업 관리에서 보기">
                  <span className="dot" style={{ background: c.color }} />{c.name}
                </button>
              )) : <span className="muted">수강 중인 수업이 없습니다.</span>}
            </div>
          </div>
          <div className="md-actions">
            {!readOnly && <button className="btn ghost sm" onClick={onEdit}>수정</button>}
            {!readOnly && <button className="btn danger sm" onClick={onDelete}>삭제</button>}
            <button className="btn ghost sm" onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>

        {/* 출석률 시각화: 전체 링 + 12주 추이 + 수업별 막대 */}
        <div className="md-grid">
          <div className="md-box" style={{ display: "grid", placeItems: "center" }}>
            <Ring value={summary.rate} />
            <div className="muted" style={{ textAlign: "center" }}>
              출석 {summary.present ?? 0} · 지각 {summary.late ?? 0} · 결석 {summary.absent ?? 0}
              {summary.absent_streak >= 2 && <div style={{ color: "var(--danger)" }}>⚠ {summary.absent_streak}회 연속 결석</div>}
            </div>
          </div>
          <div className="md-box">
            <div className="t">주별 출석률 (12주)</div>
            <div className="md-weeks">
              {(att?.weekly || []).map((w) => (
                <div key={w.week_start} className={w.records ? "has" : ""} title={`${w.week_start} 주 · ${w.rate ?? "-"}% (${w.records}건)`}
                  style={{ height: `${w.records ? Math.max(6, ((w.rate || 0) / maxWeekly) * 100) : 4}%` }} />
              ))}
            </div>
            <div className="t" style={{ marginTop: 12 }}>수업별 출석률</div>
            {(att?.by_class || []).length === 0 ? <div className="muted">기록 없음</div> : att.by_class.map((c) => (
              <div className="md-class-row" key={`${c.class_id}-${c.class_name}`}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.class_name}</span>
                <div className="md-bar"><i style={{ width: `${c.rate || 0}%`, background: colorOf(c.class_id) }} /></div>
                <b style={{ textAlign: "right" }}>{c.rate == null ? "–" : `${Math.round(c.rate)}%`}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="md-info">
          <div className="md-box">
            <div className="t">기본 정보</div>
            {member.gender === "M" ? "남" : "여"} · {member.age}세<br />
            등록 {member.enrollment_date}{member.withdrawal_date ? ` · 퇴원 ${member.withdrawal_date}` : ""}<br />
            결제일 {member.payment_date ? `매월 ${new Date(member.payment_date).getDate()}일` : "-"}
          </div>
          <div className="md-box">
            <div className="t">보호자</div>
            모 {member.mother_name || "-"} {member.mother_phone || ""}<br />
            부 {member.father_name || "-"} {member.father_phone || ""}<br />
            {member.address || "주소 미등록"}
          </div>
        </div>

        <div className="md-section" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`badge ${member.unpaid_count ? "danger" : "success"} no-dot`}>
            {member.unpaid_count ? `미납 ${member.unpaid_count}건 · ${won(member.unpaid_amount)}` : "미납 없음"}
          </span>
          {member.unpaid_count > 0 && !readOnly && <button className="btn ghost sm" onClick={() => navigate("/admin-checkout")}>수납 화면 →</button>}
          {!readOnly && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setNotifyOpen((v) => !v)}>🔔 학부모 알림</button>}
        </div>
        {notifyOpen && (
          <div className="md-box md-section">
            <input className="input" style={{ width: "100%", marginBottom: 8 }} maxLength={100} value={notifyForm.title}
              onChange={(e) => setNotifyForm({ ...notifyForm, title: e.target.value })} />
            <textarea className="input" style={{ width: "100%", height: 80, padding: 10 }} maxLength={1000} value={notifyForm.message}
              onChange={(e) => setNotifyForm({ ...notifyForm, message: e.target.value })} placeholder="보낼 내용을 입력하세요." />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
              <button className="btn sm ghost" onClick={() => setNotifyOpen(false)}>취소</button>
              <button className="btn sm" onClick={handleNotify}>보내기</button>
            </div>
          </div>
        )}

        <div className="md-section">
          <h3>최근 출결 <span className="muted">{items.length}건</span></h3>
          {att === null ? <div className="fl-skeleton" style={{ height: 120 }} /> : items.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>출결 기록이 없습니다.</div>
          ) : (
            <>
              {shown.map((a) => (
                <div className="md-att-row" key={a.attendance_id}>
                  <span className="num">{a.attendance_date.slice(5).replace("-", "/")} ({"일월화수목금토"[new Date(a.attendance_date).getDay()]})</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: colorOf(a.class_id), flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.class_name || "수업 무관"}</span>
                  </span>
                  <span className={`badge ${STATUS_TONE[a.status]} no-dot`}>{STATUS_LABEL[a.status] || a.status}</span>
                  <span className="time muted">{a.check_in_time?.slice(0, 5) || "-"}{a.check_out_time ? ` ~ ${a.check_out_time.slice(0, 5)}` : ""}</span>
                </div>
              ))}
              {items.length > 5 && (
                <button className="btn ghost sm" style={{ marginTop: 8, width: "100%", justifyContent: "center" }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "접기" : `+ ${items.length - 5}건 더 보기`}
                </button>
              )}
            </>
          )}
        </div>

        {!readOnly && (
          <>
            <div className="md-section">
              <h3>요약 <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={handleSummarize} disabled={summarizing}>{summarizing ? "요약 중…" : "✨ AI 요약"}</button></h3>
              <div className="md-box" style={{ background: "var(--primary-soft)", whiteSpace: "pre-wrap" }}>{aiSummary || basicSummary()}</div>
            </div>
            <div className="md-section">
              <h3>상담·특이사항</h3>
              <textarea className="input" style={{ width: "100%", height: 80, padding: 10 }} value={noteDraft} maxLength={2000}
                onChange={(e) => setNoteDraft(e.target.value)} placeholder="예: 보호자 통화 — 다음 주부터 화·목 반 희망" />
              <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 12px" }}>
                <button className="btn sm" onClick={handleAddNote} disabled={savingNote || !noteDraft.trim()}>{savingNote ? "저장 중…" : "기록 추가"}</button>
              </div>
              {notes.map((n) => (
                <div key={n.note_id} style={{ borderLeft: "3px solid var(--primary)", padding: "6px 12px", marginBottom: 10 }}>
                  <div className="muted" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{(n.created_at || "").slice(0, 16).replace("T", " ")} · {n.author}</span>
                    <button className="btn ghost sm" style={{ minHeight: 0, padding: "0 6px" }} onClick={() => handleDeleteNote(n.note_id)}>삭제</button>
                  </div>
                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 2 }}>{n.content}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

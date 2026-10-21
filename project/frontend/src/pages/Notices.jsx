import { useEffect, useState } from "react";
import { fetchNotices, createNotice, updateNotice, deleteNotice, fetchAcademyInfo, fetchClasses, analyzeDataWithAI, errorText } from "../api";

const CATEGORY_LABEL = { GENERAL: "일반", EVENT: "행사", URGENT: "긴급" };
const CATEGORY_BADGE = { GENERAL: "gray", EVENT: "primary", URGENT: "danger" };

export default function Notices({ role = "owner" }) {
  const [notices, setNotices] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [editNotice, setEditNotice] = useState(null);
  const [error, setError] = useState(null);
  const [classes, setClasses] = useState([]);
  const [classFilter, setClassFilter] = useState("");   // "" 전체 / "general" 전체 공지만 / class_id

  const load = () => {
    fetchNotices().then(setNotices).catch((e) => setError(errorText(e, "공지를 불러오지 못했습니다.")));
  };

  useEffect(() => {
    load();
    fetchClasses().then((c) => setClasses(Array.isArray(c) ? c : [])).catch(() => setClasses([]));
  }, []);

  const visibleNotices = notices.filter((n) => !classFilter
    || (classFilter === "general" ? !n.class_id : String(n.class_id) === String(classFilter)));

  // 단일 삭제
  const onDelete = async (id) => {
    if (!confirm("이 공지사항을 삭제하시겠습니까?")) return;
    try {
      await deleteNotice(id);
      load();
    } catch (e) {
      setError(errorText(e, "공지를 삭제하지 못했습니다."));
    }
  };

  // 다중 삭제 (Promise.all을 사용해 여러 개의 삭제 요청을 동시에 처리)
  const onDeleteMultiple = async (ids) => {
    if (!confirm(`선택한 ${ids.length}개의 공지사항을 삭제하시겠습니까?`)) return;
    try {
      await Promise.all(ids.map((id) => deleteNotice(id)));
      load();
    } catch (e) {
      setError("일부 공지사항 삭제 중 오류가 발생했습니다.");
    }
  };

  const handleEdit = (notice) => {
    setEditNotice(notice);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditNotice(null);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "16px" }}>
        <div>
          <h2 className="page-title" style={{ marginBottom: "8px" }}>공지사항</h2>
          <p className="page-subtitle" style={{ margin: 0 }}>전체 공지는 모든 학부모에게, 반 공지는 그 반 학부모에게만 보입니다. 읽음 수는 학부모 포털에서 열어 본 수입니다.</p>
        </div>

        {role === "owner" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select className="select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="공지 대상 필터">
              <option value="">모든 공지</option>
              <option value="general">전체 공지만</option>
              {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name} 공지</option>)}
            </select>
            <button className="btn outline" onClick={() => setShowManageModal(true)}>⚙️ 공지 관리</button>
            <button className="btn" onClick={() => { setEditNotice(null); setShowModal(true); }}>+ 새 공지 작성</button>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {visibleNotices.length === 0 ? (
        <div className="empty">등록된 공지사항이 없습니다.</div>
      ) : (
        <div className="notice-list">
          {visibleNotices.map((n) => (
            <div key={n.notice_id} className={`notice-item ${n.is_pinned ? "pinned" : ""}`}>
              <div className="notice-meta">
                <span className={`badge ${CATEGORY_BADGE[n.category] || "gray"} no-dot`}>
                  {CATEGORY_LABEL[n.category] || n.category}
                </span>
                {n.is_pinned && (
                  <span style={{ color: "var(--primary)", fontWeight: 600 }}>📌 고정</span>
                )}
                <span className="badge gray no-dot">{n.class_name ? `🎯 ${n.class_name}` : "전체"}</span>
                <span>{n.author}</span>
                <span>·</span>
                <span className="num">{(n.created_at || "").slice(0, 10)}</span>
                {role === "owner" && (
                  <span className="num" title="읽은 학부모 수 / 공지를 받는 학부모 수" style={{ color: "var(--text-3)" }}>
                    · 읽음 {n.read_count}/{n.target_count}
                  </span>
                )}
                <div style={{ flex: 1 }} />

                {role === "owner" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => handleEdit(n)}>수정</button>
                    <button className="btn danger sm" onClick={() => onDelete(n.notice_id)}>삭제</button>
                  </div>
                )}
              </div>
              <h3 className="notice-title">{n.title}</h3>
              <div className="notice-content">{n.content}</div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <NoticeModal
          initialData={editNotice}
          classes={classes}
          onClose={handleCloseModal}
          onCreated={() => { handleCloseModal(); load(); }}
        />
      )}

      {showManageModal && (
        <ManageNoticesModal
          notices={notices}
          onClose={() => setShowManageModal(false)}
          onEdit={(n) => {
            setShowManageModal(false);
            handleEdit(n);
          }}
          onDelete={onDelete}
          onDeleteMultiple={onDeleteMultiple}
          onAddNew={() => {
            setShowManageModal(false);
            setEditNotice(null);
            setShowModal(true);
          }}
        />
      )}
    </>
  );
}

// =====================================================================
// 관리 모달 (기존 체크박스 및 레이아웃 유지)
// =====================================================================
function ManageNoticesModal({ notices, onClose, onEdit, onDelete, onDeleteMultiple, onAddNew }) {
  const [selectedIds, setSelectedIds] = useState([]);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(notices.map((n) => n.notice_id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (e, id) => {
    if (e.target.checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
    }
  };

  const handleDeleteSelected = async () => {
    await onDeleteMultiple(selectedIds);
    setSelectedIds([]);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "650px", maxWidth: "95%" }} onClick={(e) => e.stopPropagation()}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ margin: 0 }}>공지 관리</h3>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn danger sm"
              disabled={selectedIds.length === 0}
              onClick={handleDeleteSelected}
            >
              선택 삭제 ({selectedIds.length})
            </button>
            <button className="btn sm" onClick={onAddNew}>+ 새 공지 작성</button>
          </div>
        </div>

        <div style={{ maxHeight: "400px", overflowY: "auto", marginBottom: "20px" }}>
          {notices.length === 0 ? (
            <div className="empty">등록된 공지사항이 없습니다.</div>
          ) : (
            <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "10px 4px", width: "40px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={notices.length > 0 && selectedIds.length === notices.length}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th style={{ padding: "10px 4px" }}>분류</th>
                  <th style={{ padding: "10px 4px" }}>제목</th>
                  <th style={{ padding: "10px 4px" }}>작성일</th>
                  <th style={{ padding: "10px 4px", textAlign: "center" }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n) => (
                  <tr key={n.notice_id} style={{ borderBottom: "1px solid #eee", backgroundColor: selectedIds.includes(n.notice_id) ? "var(--surface-hover)" : "transparent" }}>
                    <td style={{ padding: "10px 4px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(n.notice_id)}
                        onChange={(e) => handleSelectOne(e, n.notice_id)}
                      />
                    </td>
                    <td style={{ padding: "10px 4px" }}>
                      <span className={`badge ${CATEGORY_BADGE[n.category] || "gray"} no-dot`}>
                        {CATEGORY_LABEL[n.category] || n.category}
                      </span>
                    </td>
                    <td style={{ padding: "10px 4px", fontWeight: n.is_pinned ? "bold" : "normal" }}>
                      {n.is_pinned && "📌 "} {n.title}
                    </td>
                    <td style={{ padding: "10px 4px" }} className="num">
                      {(n.created_at || "").slice(0, 10)}
                    </td>
                    <td style={{ padding: "10px 4px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                        <button className="btn ghost sm" onClick={() => onEdit(n)}>수정</button>
                        <button className="btn danger sm" onClick={() => onDelete(n.notice_id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 공지 작성/수정 모달 (✨ DB 기반 학원 정보 연동 및 AI 초안 도우미)
// =====================================================================
function NoticeModal({ initialData, classes = [], onClose, onCreated }) {
  const [form, setForm] = useState(() => initialData ? {
    title: initialData.title, content: initialData.content, author: initialData.author, category: initialData.category,
    is_pinned: initialData.is_pinned, class_id: initialData.class_id || "", notify_parents: false,
  } : {
    title: "", content: "",
    author: "관리자", category: "GENERAL", is_pinned: false, class_id: "", notify_parents: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  // ✨ AI 기능 및 로컬스토리지 데이터 관리
  const [rawText, setRawText] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // 기관 정보는 서버 설정에서 읽음 (기존: 브라우저 저장값 또는 가짜 기본값 '한빛학원')
  const [academyInfo, setAcademyInfo] = useState(null);
  useEffect(() => {
    fetchAcademyInfo().then((info) => {
      setAcademyInfo(info);
      if (!initialData && info?.principal) setForm((f) => (f.author === "관리자" ? { ...f, author: info.principal } : f));
    }).catch(() => setAcademyInfo(null));
  }, [initialData]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // AI를 통한 공지 초안 가공 및 상단 고정 분석 핸들러
  const handleAiDraftGeneration = async () => {
    if (!rawText.trim()) return;

    setAiGenerating(true);
    setErr(null);

    // 프롬프트 지시사항 (academyInfo 구조에 맞춰 name, branch 등을 자연스럽게 녹이도록 유도)
    const prompt = `
      사용자가 입력한 대략적인 메모를 바탕으로 정중하고 격식 있는 학원 공지사항 양식의 초안을 작성해주세요.
      결과는 앱에서 즉시 파싱할 수 있도록 반드시 순수한 JSON 객체로만 출력해야 합니다. 마크다운 기호(\`\`\`)나 추가 설명은 절대 포함하지 마십시오.

      [핵심 지시사항]
      - 함께 제공된 '기관 정보 데이터(Context)'를 참고하여, 본문이나 제목에 학원 이름이나 지점명, 연락처 정보를 자연스럽게 녹여내어 공지사항을 완성해 주세요.

      [규칙]
      1. title: 공지사항의 핵심을 요약한 제목
      2. content: 줄바꿈(\\n)을 적절히 사용하여 가독성을 높인 본문 내용
      3. category: "GENERAL"(일반), "EVENT"(행사), "URGENT"(긴급) 중 문맥상 가장 적합한 하나를 선택
      4. is_pinned: 휴원 안내, 수강료 결제 안내, 안전 점검 등 중요도가 높은 내용이면 true, 그렇지 않으면 false로 결정하십시오.

      [JSON 구조]
      {
        "title": "제목 스트링",
        "content": "본문 내용 스트링",
        "category": "GENERAL" | "EVENT" | "URGENT",
        "is_pinned": true | false
      }

      [사용자 입력 내용]
      ${rawText}
    `;

    try {
      // 기관 이름·지점·대표 연락처만 넘김 (학생·학부모 개인정보 없음)
      const facility = academyInfo ? { name: academyInfo.name, branch: academyInfo.branch, phone: academyInfo.phone, facilityType: academyInfo.facilityType } : null;
      const response = await analyzeDataWithAI(prompt, facility);

      let cleanJsonString = response.trim();
      if (cleanJsonString.startsWith("```")) {
        cleanJsonString = cleanJsonString.replace(/^```json?\s*/i, "").replace(/```$/, "").trim();
      }

      const parsedData = JSON.parse(cleanJsonString);

      setForm((prev) => ({
        ...prev,
        title: parsedData.title || prev.title,
        content: parsedData.content || prev.content,
        category: parsedData.category || prev.category,
        is_pinned: parsedData.is_pinned !== undefined ? parsedData.is_pinned : prev.is_pinned,
      }));

    } catch (e) {
      console.error("AI 초안 가공 실패:", e);
      setErr(`AI 초안을 만들지 못했습니다 (${e.message}). 직접 입력해 주세요.`);
    } finally {
      setAiGenerating(false);
    }
  };

  const submit = async () => {
    setSubmitting(true); setErr(null);
    const payload = { ...form, class_id: form.class_id ? Number(form.class_id) : null };
    try {
      if (initialData) {
        await updateNotice(initialData.notice_id, payload);
      } else {
        await createNotice(payload);
      }
      onCreated();
    } catch (e) {
      setErr(errorText(e, "공지를 저장하지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initialData ? "공지 수정" : "새 공지 작성"}</h3>
        {err && <div className="error-banner">{err}</div>}

        {/* AI 초안 작성 섹션 */}
        {!initialData && (
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", padding: "14px", borderRadius: "8px", marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--primary)" }}>
                🤖 AI 공지사항 초안 도우미
              </label>
              {/* 💡 academyInfo.academy_name 대신 academyInfo.name 구조 반영 */}
              {academyInfo?.name && (
                <span style={{ fontSize: "11px", color: "var(--text-3)" }}>
                  {academyInfo.name} ({academyInfo.branch || "본점"})
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                className="input"
                placeholder="대략적인 공지 아이디어나 문장을 적어보세요..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                disabled={aiGenerating}
                style={{ flex: 1, minHeight: "36px" }}
              />
              <button
                type="button"
                className="btn"
                onClick={handleAiDraftGeneration}
                disabled={aiGenerating || !rawText.trim()}
                style={{ background: "var(--primary)", whiteSpace: "nowrap" }}
              >
                {aiGenerating ? "작성 중..." : "초안 생성"}
              </button>
            </div>
          </div>
        )}

        {/* 하단 기존 입력 폼 생략 (기존 코드와 동일) */}
        <div className="form-row">
          <label>제목</label>
          <input className="input" value={form.title} onChange={(e) => update("title", e.target.value)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-row">
            <label>분류</label>
            <select className="select" value={form.category} onChange={(e) => update("category", e.target.value)}>
              <option value="GENERAL">일반</option>
              <option value="EVENT">행사</option>
              <option value="URGENT">긴급</option>
            </select>
          </div>
          <div className="form-row">
            <label>작성자</label>
            <input className="input" value={form.author} onChange={(e) => update("author", e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label>내용</label>
          <textarea
            value={form.content}
            onChange={(e) => update("content", e.target.value)}
            style={{ background: "var(--surface)", color: "var(--text)", minHeight: 200 }}
          />
        </div>
        <div className="form-row">
          <label>공지 대상</label>
          <select className="select" value={form.class_id} onChange={(e) => update("class_id", e.target.value)}>
            <option value="">전체 학부모</option>
            {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name} 학부모만</option>)}
          </select>
        </div>
        <div className="form-row" style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_pinned} onChange={(e) => update("is_pinned", e.target.checked)} />
            상단 고정
          </label>
          {!initialData && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.notify_parents} onChange={(e) => update("notify_parents", e.target.checked)} />
              학부모에게 알림 보내기
            </label>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={submitting}>취소</button>
          <button className="btn" onClick={submit} disabled={submitting || !form.title || !form.content}>
            {submitting ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
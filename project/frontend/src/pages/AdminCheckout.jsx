import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchInvoices, fetchPayments, kakaoReady, fetchMembers, createInvoice, updateInvoice, deleteInvoice,
  markInvoicePaid, bulkCreateInvoices, fetchClasses, errorText, localToday,
} from "../api";
import { useDataRefresh } from "../utils/sync";

const METHOD_LABEL = { CASH: "현금", TRANSFER: "계좌이체", CARD: "카드(현장)", KAKAOPAY: "카카오페이" };

const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
const formatDate = (value) => value ? new Date(value).toLocaleDateString("ko-KR") : "-";

export default function AdminCheckout() {
  const [allInvoices, setAllInvoices] = useState(null);
  const [payments, setPayments] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("UNPAID");
  const [invoiceForm, setInvoiceForm] = useState({ member_id: "", item_name: "수강료", amount: "", due_date: "" });
  const [isCreating, setIsCreating] = useState(false);
  // v8.1 현장 수납 / 월 청구 일괄 발행
  const [payingInvoice, setPayingInvoice] = useState(null);   // { invoice, method }
  const [classes, setClasses] = useState([]);
  const [bulkForm, setBulkForm] = useState(() => ({ item_name: `${new Date().getMonth() + 1}월 수강료`, class_id: "", amount: "", due_date: "" }));
  const [bulkBusy, setBulkBusy] = useState(false);

  // ✨ 청구서 수정(Edit)을 위한 상태 관리
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // 관리자가 시작한 카카오페이 결제 결과(/admin-checkout?kakao=...) 표시
  const [kakaoResult] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const kakao = params.get("kakao");
    if (kakao) window.history.replaceState({}, "", window.location.pathname);
    return kakao ? { type: kakao, amount: params.get("amount"), reason: params.get("reason") } : null;
  });

  const loadData = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [invoices, listPayments, membersData] = await Promise.all([
        fetchInvoices(),
        fetchPayments(),
        fetchMembers({ status: "ACTIVE" }),
      ]);
      fetchClasses().then((c) => setClasses(Array.isArray(c) ? c : [])).catch(() => setClasses([]));
      setAllInvoices(Array.isArray(invoices) ? invoices : []);
      setPayments(Array.isArray(listPayments) ? listPayments : []);
      setMembers(Array.isArray(membersData) ? membersData : []);
    } catch (err) {
      setError(errorText(err, "결제 데이터를 불러오지 못했습니다."));
      setAllInvoices((prev) => prev || []);
      setPayments((prev) => prev || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useDataRefresh(loadData);   // 학부모가 결제하면 자동으로 최신화

  const filteredInvoices = useMemo(() => {
    if (!Array.isArray(allInvoices)) return [];
    const filtered = statusFilter === "ALL"
      ? allInvoices
      : allInvoices.filter((inv) => inv.status === statusFilter);

    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((inv) =>
      `${inv.member_name || ""}`.toLowerCase().includes(q) ||
      `${inv.item_name || ""}`.toLowerCase().includes(q) ||
      `${inv.invoice_id}`.includes(q)
    );
  }, [search, allInvoices, statusFilter]);

  const unpaidInvoices = useMemo(() => {
    if (!Array.isArray(allInvoices)) return [];
    return allInvoices.filter((inv) => inv.status === "UNPAID");
  }, [allInvoices]);

  const unpaidAmount = useMemo(() => {
    return (Array.isArray(unpaidInvoices) ? unpaidInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0) : 0);
  }, [unpaidInvoices]);

  const overdueCount = useMemo(() => {
    if (!Array.isArray(unpaidInvoices)) return 0;
    const today = localToday();
    return unpaidInvoices.filter((inv) => inv.due_date && inv.due_date < today).length;
  }, [unpaidInvoices]);

  const handlePay = async (invoice) => {
    setError("");
    try {
      const data = await kakaoReady({
        member_id: invoice.member_id,
        amount: invoice.amount,
        item_name: invoice.item_name,
        invoice_id: invoice.invoice_id,
      });
      const url = data.next_redirect_pc_url || data.next_redirect_mobile_url || data.next_redirect_app_url;
      if (!url) throw new Error("결제 페이지를 열 수 없습니다.");
      window.location.href = url
    } catch (err) {
      console.error("카카오페이 결제 준비 실패:", err);
      const message = err?.response?.data?.detail || err.message || "카카오페이 결제 준비 중 오류가 발생했습니다.";
      setError(message);
    }
  };

  const handleCreateInvoice = async () => {
    setError("");
    if (!invoiceForm.member_id || !invoiceForm.amount) {
      return setError("학생과 금액을 모두 선택하세요.");
    }
    if (Number(invoiceForm.amount) <= 0) {
      return setError("금액은 0보다 커야 합니다.");
    }

    setIsCreating(true);
    try {
      await createInvoice({
        member_id: Number(invoiceForm.member_id),
        item_name: invoiceForm.item_name || "수강료",
        amount: Number(invoiceForm.amount),
        due_date: invoiceForm.due_date || undefined,
      });
      setInvoiceForm({ member_id: "", item_name: "수강료", amount: "", due_date: "" });
      await loadData();
    } catch (err) {
      console.error("청구서 생성 실패:", err);
      const message = err?.response?.data?.detail || err.message || "청구서 생성 중 오류가 발생했습니다.";
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  // ✨ 청구서 수정 (Update)
  const handleUpdateInvoice = async () => {
    if (!editingInvoice.item_name || !editingInvoice.amount) {
      return alert("청구 항목과 금액을 올바르게 입력하세요.");
    }
    setIsUpdating(true);
    try {
      await updateInvoice(editingInvoice.invoice_id, {
        item_name: editingInvoice.item_name,
        amount: Number(editingInvoice.amount),
        due_date: editingInvoice.due_date || undefined,
      });
      setEditingInvoice(null);
      await loadData();
    } catch (err) {
      console.error("청구서 수정 실패:", err);
      alert(err?.response?.data?.detail || "청구서 수정 중 오류가 발생했습니다.");
    } finally {
      setIsUpdating(false);
    }
  };

  // ✨ 청구서 삭제 (Delete)
  const handleDeleteInvoice = async (invoiceId) => {
    if (!confirm("이 청구서를 정말 삭제하시겠습니까? (결제된 내역은 삭제할 수 없습니다.)")) return;
    try {
      await deleteInvoice(invoiceId);
      await loadData();
    } catch (err) {
      console.error("청구서 삭제 실패:", err);
      alert(err?.response?.data?.detail || "청구서 삭제 중 오류가 발생했습니다.");
    }
  };

  // 현장 수납(현금·이체·카드 단말기) — 금액은 서버가 청구서 값으로 확정
  const handleMarkPaid = async () => {
    if (!payingInvoice) return;
    try {
      await markInvoicePaid(payingInvoice.invoice.invoice_id, { method: payingInvoice.method });
      setPayingInvoice(null);
      await loadData();
    } catch (err) {
      alert(errorText(err, "수납 처리하지 못했습니다."));
    }
  };

  const handleBulkCreate = async () => {
    if (!bulkForm.item_name.trim()) return setError("청구 항목을 입력하세요.");
    const target = bulkForm.class_id ? classes.find((c) => String(c.class_id) === String(bulkForm.class_id))?.name : "재원생 전체";
    if (!window.confirm(`${target}에게 '${bulkForm.item_name}' 청구서를 발행할까요?\n같은 항목의 미납 청구서가 이미 있는 학생은 건너뜁니다.`)) return;
    setBulkBusy(true); setError("");
    try {
      const result = await bulkCreateInvoices({
        item_name: bulkForm.item_name.trim(), class_id: bulkForm.class_id ? Number(bulkForm.class_id) : null,
        amount: bulkForm.amount ? Number(bulkForm.amount) : null, due_date: bulkForm.due_date || null,
      });
      alert(`청구서 ${result.created}건 · ${won(result.total_amount)} 발행` +
        (result.skipped_existing ? `\n이미 같은 미납 청구서가 있어 건너뜀 ${result.skipped_existing}명` : "") +
        (result.skipped_no_fee ? `\n수강료 미설정으로 건너뜀 ${result.skipped_no_fee}명 (설정 → 결제 정보에서 반별 수강료 입력)` : ""));
      await loadData();
    } catch (err) {
      setError(errorText(err, "청구서를 발행하지 못했습니다."));
    } finally {
      setBulkBusy(false);
    }
  };

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.member_id, m])), [members]);
  const feeByClass = useMemo(() => Object.fromEntries(classes.map((c) => [c.class_id, c.fee || 0])), [classes]);
  const suggestedFee = (memberId) => (memberById[memberId]?.classes || []).reduce((sum, c) => sum + (feeByClass[c.class_id] || 0), 0);

  const thisMonth = localToday().slice(0, 7);
  const monthCollected = useMemo(() => (payments || [])
    .filter((p) => String(p.paid_at || "").slice(0, 7) === thisMonth).reduce((sum, p) => sum + (p.amount || 0), 0), [payments, thisMonth]);
  const unlinkedUnpaid = unpaidInvoices.filter((inv) => memberById[inv.member_id] && !memberById[inv.member_id].parent_linked).length;

  const dueText = (invoice) => {
    if (invoice.status === "PAID") return { text: "납부 완료", color: "var(--success-text)" };
    if (!invoice.due_date) return { text: "결제 대기", color: "var(--text-2)" };
    const diff = Math.round((new Date(`${invoice.due_date}T00:00:00`) - new Date(`${localToday()}T00:00:00`)) / 86400000);
    if (diff < 0) return { text: `${-diff}일 지남`, color: "var(--danger-text)" };
    if (diff === 0) return { text: "오늘 마감", color: "var(--warning-text)" };
    return { text: `D-${diff}`, color: "var(--text-2)" };
  };

  return (
    <div>
      <style>{`
.ck-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);}
.ck-row:last-child{border-bottom:0;}
.ck-row .who{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;min-width:0;}
.ck-row .right{text-align:right;}
.ck-list{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.ck-actions{grid-column:1/-1;display:flex;gap:4px;flex-wrap:wrap;}
.ck-pay{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);}
.ck-pay:last-child{border-bottom:0;}

`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 className="page-title" style={{ marginBottom: 2 }}>수납·청구</h2>
          <p className="page-subtitle" style={{ margin: 0 }}>발행한 청구서는 학부모 포털에 바로 표시됩니다.</p>
        </div>
        <button className="btn sm ghost" onClick={loadData} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
      </div>

      {kakaoResult && (
        <div className={`fl-banner ${kakaoResult.type === "success" ? "success" : "warning"}`}>
          {kakaoResult.type === "success" ? `카카오페이 결제가 완료되었습니다${kakaoResult.amount ? ` (${won(kakaoResult.amount)})` : ""}.`
            : kakaoResult.type === "cancel" ? "결제가 취소되었습니다." : `결제에 실패했습니다${kakaoResult.reason ? ` (${kakaoResult.reason})` : ""}.`}
        </div>
      )}
      {error && <div className="fl-banner danger">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">결제 대기</span></div>
          <div className="stat-value num">{won(unpaidAmount)}</div>
          <div className="stat-sub">{unpaidInvoices.length}건{overdueCount ? ` · 기한 지남 ${overdueCount}건` : ""}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">이번 달 수납</span></div>
          <div className="stat-value num success">{won(monthCollected)}</div>
          <div className="stat-sub">카카오페이·현장 수납 합계</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-head"><span className="stat-label">학부모 미연결 청구</span></div>
          <div className="stat-value num">{unlinkedUnpaid}<span className="unit">건</span></div>
          <div className="stat-sub">{unlinkedUnpaid ? "학부모 계정이 연결되면 포털에 표시됩니다" : "모든 청구서가 학부모에게 보입니다"}</div>
        </div>
      </div>

      <div className="row cols-2" style={{ gap: 16 }}>
        <div>
          <div className="toolbar">
            <div className="segmented">
              {[["UNPAID", "결제 대기"], ["PAID", "납부 완료"], ["ALL", "전체"]].map(([k, v]) => (
                <button key={k} className={statusFilter === k ? "active" : ""} onClick={() => setStatusFilter(k)}>{v}</button>
              ))}
            </div>
            <input className="input" type="search" placeholder="학생·항목 검색" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 160px" }} />
          </div>
          {allInvoices === null ? <div className="fl-skeleton" style={{ height: 200 }} /> : filteredInvoices.length === 0 ? (
            <div className="empty">{statusFilter === "UNPAID" ? "결제 대기 중인 청구서가 없습니다." : "청구서가 없습니다."}</div>
          ) : (
            <div className="ck-list">
              {filteredInvoices.map((invoice) => {
                const due = dueText(invoice);
                const linked = memberById[invoice.member_id]?.parent_linked;
                return (
                  <div key={invoice.invoice_id} className="ck-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="who">
                        <b>{invoice.member_name || "알 수 없음"}</b>
                        <span style={{ fontSize: 13 }}>{invoice.item_name}</span>
                      </div>
                      <div className="muted">
                        {invoice.due_date ? `기한 ${formatDate(invoice.due_date)}` : "기한 없음"}
                        {invoice.status !== "PAID" && memberById[invoice.member_id] ? (linked ? " · 🔗 학부모 포털에 표시 중" : " · 학부모 계정 미연결") : ""}
                      </div>
                    </div>
                    <div className="right">
                      <div className="num" style={{ fontWeight: 700 }}>{won(invoice.amount)}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: due.color }}>{due.text}</div>
                    </div>
                    <div className="ck-actions">
                      {invoice.status !== "PAID" && (
                        <>
                          <button className="btn sm" onClick={() => setPayingInvoice({ invoice, method: "CASH" })}>현장 수납</button>
                          <button className="btn ghost sm" onClick={() => handlePay(invoice)}>카카오페이</button>
                          <button className="btn ghost sm" onClick={() => setEditingInvoice(invoice)}>수정</button>
                          <button className="btn danger sm" onClick={() => handleDeleteInvoice(invoice.invoice_id)}>삭제</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>청구서 발행</h3>
            <div className="form-row">
              <label>학생</label>
              <select className="select" value={invoiceForm.member_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const fee = id ? suggestedFee(Number(id)) : 0;
                  setInvoiceForm((prev) => ({ ...prev, member_id: id, amount: prev.amount || (fee ? String(fee) : "") }));
                }}>
                <option value="">학생 선택</option>
                {members.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}{m.parent_linked ? "" : " (학부모 미연결)"}</option>)}
              </select>
            </div>
            <div className="form-row"><label>항목</label>
              <input className="input" value={invoiceForm.item_name} onChange={(e) => setInvoiceForm((p) => ({ ...p, item_name: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="form-row"><label>금액 (원)</label>
                <input className="input" type="number" min="1" value={invoiceForm.amount} onChange={(e) => setInvoiceForm((p) => ({ ...p, amount: e.target.value }))} /></div>
              <div className="form-row"><label>납부 기한</label>
                <input className="input" type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((p) => ({ ...p, due_date: e.target.value }))} /></div>
            </div>
            <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={handleCreateInvoice} disabled={isCreating || loading}>
              {isCreating ? "발행 중…" : "발행"}
            </button>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>월 수강료 일괄 발행</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input className="input" value={bulkForm.item_name} onChange={(e) => setBulkForm({ ...bulkForm, item_name: e.target.value })} placeholder="항목" />
              <select className="select" value={bulkForm.class_id} onChange={(e) => setBulkForm({ ...bulkForm, class_id: e.target.value })}>
                <option value="">재원생 전체</option>
                {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
              </select>
              <input className="input" type="number" min="1" value={bulkForm.amount} onChange={(e) => setBulkForm({ ...bulkForm, amount: e.target.value })} placeholder="금액(비우면 수업별 수강료)" />
              <input className="input" type="date" value={bulkForm.due_date} onChange={(e) => setBulkForm({ ...bulkForm, due_date: e.target.value })} aria-label="납부 기한" />
            </div>
            <button className="btn ghost" style={{ marginTop: 10, width: "100%", justifyContent: "center" }} onClick={handleBulkCreate} disabled={bulkBusy || loading}>
              {bulkBusy ? "발행 중…" : "일괄 발행"}
            </button>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 6 }}>최근 결제</h3>
            {payments === null ? <div className="fl-skeleton" style={{ height: 120 }} /> : payments.length === 0 ? <div className="muted">결제 기록이 없습니다.</div> : (
              payments.slice(0, 8).map((p) => (
                <div key={p.payment_id} className="ck-pay">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.member_name || "알 수 없음"}</div>
                    <div className="muted">{METHOD_LABEL[p.method] || p.method || "-"} · {p.note || p.payment_type}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{won(p.amount)}</div>
                    <div className="muted">{formatDate(p.paid_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {payingInvoice && (
        <div className="modal-backdrop" onClick={() => setPayingInvoice(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3>현장 수납</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {payingInvoice.invoice.member_name} · {payingInvoice.invoice.item_name} · <b>{won(payingInvoice.invoice.amount)}</b><br />
              실제로 받은 뒤 처리하세요. 학부모에게 납부 확인 알림이 갑니다.
            </p>
            <div className="segmented" style={{ marginBottom: 12 }}>
              {["CASH", "TRANSFER", "CARD"].map((m) => (
                <button key={m} type="button" className={payingInvoice.method === m ? "active" : ""} onClick={() => setPayingInvoice({ ...payingInvoice, method: m })}>{METHOD_LABEL[m]}</button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPayingInvoice(null)}>취소</button>
              <button className="btn" onClick={handleMarkPaid}>수납 완료</button>
            </div>
          </div>
        </div>
      )}

      {editingInvoice && (
        <div className="modal-backdrop" onClick={() => setEditingInvoice(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>청구서 수정 · {editingInvoice.member_name}</h3>
            <div className="form-row"><label>항목</label>
              <input className="input" value={editingInvoice.item_name} onChange={(e) => setEditingInvoice({ ...editingInvoice, item_name: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-row"><label>금액</label>
                <input className="input" type="number" min="1" value={editingInvoice.amount} onChange={(e) => setEditingInvoice({ ...editingInvoice, amount: e.target.value })} /></div>
              <div className="form-row"><label>납부 기한</label>
                <input className="input" type="date" value={editingInvoice.due_date || ""} onChange={(e) => setEditingInvoice({ ...editingInvoice, due_date: e.target.value })} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setEditingInvoice(null)} disabled={isUpdating}>취소</button>
              <button className="btn" onClick={handleUpdateInvoice} disabled={isUpdating}>{isUpdating ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

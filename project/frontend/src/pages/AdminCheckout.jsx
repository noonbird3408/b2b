import { useEffect, useMemo, useState } from "react";
import {
  fetchInvoices, fetchPayments, kakaoReady, fetchMembers, createInvoice, updateInvoice, deleteInvoice,
  markInvoicePaid, bulkCreateInvoices, fetchClasses, errorText, localToday,
} from "../api";

const METHOD_LABEL = { CASH: "현금", TRANSFER: "계좌이체", CARD: "카드(현장)", KAKAOPAY: "카카오페이" };

const won = (n) => (n != null ? `₩${Number(n).toLocaleString()}` : "₩0");
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

  const loadData = async () => {
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
      console.error("관리자 결제 데이터 로드 실패:", err);
      setError("결제 데이터 로드에 실패했습니다. 다시 시도해 주세요.");
      setAllInvoices([]);
      setPayments([]);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  const recentPayments = useMemo(() => {
    if (!Array.isArray(payments)) return [];
    return payments.slice(0, 8);
  }, [payments]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
        <div>
          <h2 className="page-title" style={{ marginBottom: 2 }}>수납·청구 관리</h2>
          <p className="page-subtitle" style={{ margin: 0 }}>청구서 발행(개별·일괄), 카카오페이 원격결제, 현장 수납을 한 곳에서 처리합니다. 발행·납부 시 학부모 포털로 알림이 갑니다.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn sm ghost" onClick={loadData} disabled={loading}>
            {loading ? "새로고침 중..." : "새로고침"}
          </button>
        </div>
      </div>

      {kakaoResult && (
        <div className="error-banner" style={kakaoResult.type === "success" ? { background: "var(--success-soft)", color: "var(--success-text)" } : undefined}>
          {kakaoResult.type === "success" ? `✅ 카카오페이 결제가 완료되었습니다${kakaoResult.amount ? ` (${won(kakaoResult.amount)})` : ""}.`
            : kakaoResult.type === "cancel" ? "결제가 취소되었습니다." : `결제에 실패했습니다${kakaoResult.reason ? ` (${kakaoResult.reason})` : ""}.`}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      <div className="row cols-2" style={{ gap: 20, marginBottom: 20 }}>
        {/* 청구서 생성 영역 (기존 유지) */}
        <div className="card">
          <div className="card-head" style={{ justifyContent: "space-between" }}>
            <div>
              <h3 className="card-title">청구서 생성</h3>
              <div className="card-sub">학생별로 미납 청구서를 발행하고 결제 링크를 보낼 수 있습니다.</div>
            </div>
            <button className="btn sm ghost" onClick={loadData} disabled={loading || isCreating}>
              {loading ? "새로고침 중..." : "데이터 새로고침"}
            </button>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div className="form-row">
              <label>학생 선택</label>
              <select
                className="input"
                value={invoiceForm.member_id}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, member_id: e.target.value }))}
              >
                <option value="">등록 학생 선택</option>
                {members.map((member) => (
                  <option key={member.member_id} value={member.member_id}>
                    {member.name} ({member.father_name || member.mother_name || "보호자"})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>청구 항목</label>
              <input
                className="input"
                value={invoiceForm.item_name}
                onChange={(e) => setInvoiceForm(prev => ({ ...prev, item_name: e.target.value }))}
                placeholder="예: 6월 수강료"
              />
            </div>
            <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>금액</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={invoiceForm.amount}
                  onChange={(e) => setInvoiceForm(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="금액(원)"
                />
              </div>
              <div>
                <label>납부 기한</label>
                <input
                  className="input"
                  type="date"
                  value={invoiceForm.due_date}
                  onChange={(e) => setInvoiceForm(prev => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>
            <button className="btn" onClick={handleCreateInvoice} disabled={isCreating || loading}>
              {isCreating ? "청구서 생성 중..." : "청구서 생성"}
            </button>
          </div>
        </div>

        {/* 결제 현황 요약 + 월 청구 일괄 발행 */}
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">결제 현황 요약</h3>
            <div className="card-sub">DB 기반 실결제 이력과 미납 현황을 함께 확인하세요.</div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div className="list-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="title">미납 청구서</div>
                <div className="meta">{Array.isArray(unpaidInvoices) ? unpaidInvoices.length : "-"}건</div>
              </div>
              <div className="right" style={{ fontWeight: 700 }}>{won(unpaidAmount)}</div>
            </div>
            <div className="list-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="title">연체 건수</div>
                <div className="meta">{overdueCount}건</div>
              </div>
              <div className="badge danger no-dot">연체</div>
            </div>
            <div className="list-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="title">총 결제 내역</div>
                <div className="meta">{Array.isArray(payments) ? payments.length : "-"}건</div>
              </div>
              <div className="right">{Array.isArray(payments) ? won(payments.reduce((sum, p) => sum + (p.amount || 0), 0)) : "-"}</div>
            </div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed var(--border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>🧾 월 청구 일괄 발행</div>
            <div className="card-sub" style={{ marginBottom: 10 }}>금액을 비우면 설정의 반별 수강료(없으면 기본 수강료)로 학생마다 계산합니다.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input className="input" value={bulkForm.item_name} onChange={(e) => setBulkForm({ ...bulkForm, item_name: e.target.value })} placeholder="청구 항목" />
              <select className="input" value={bulkForm.class_id} onChange={(e) => setBulkForm({ ...bulkForm, class_id: e.target.value })}>
                <option value="">재원생 전체</option>
                {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
              </select>
              <input className="input" type="number" min="1" value={bulkForm.amount} onChange={(e) => setBulkForm({ ...bulkForm, amount: e.target.value })} placeholder="금액(비우면 자동)" />
              <input className="input" type="date" value={bulkForm.due_date} onChange={(e) => setBulkForm({ ...bulkForm, due_date: e.target.value })} title="납부 기한" />
            </div>
            <button className="btn" style={{ marginTop: 10, width: "100%" }} onClick={handleBulkCreate} disabled={bulkBusy || loading}>
              {bulkBusy ? "발행 중…" : "일괄 발행"}
            </button>
          </div>
        </div>
      </div>

      <div className="row cols-2" style={{ gap: 20, marginBottom: 20 }}>
        {/* 청구서 목록 영역 (수정/삭제 버튼 추가) */}
        <div className="card">
          <div className="card-head" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
            <div>
              <h3 className="card-title">청구서 목록</h3>
              <div className="card-sub">학생 이름, 청구 항목, 금액을 확인하고 결제 링크를 생성하세요.</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {['ALL', 'UNPAID', 'PAID'].map((status) => (
                  <button
                    key={status}
                    className={`btn sm ${statusFilter === status ? '' : 'ghost'}`}
                    style={{ minWidth: 78 }}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status === 'ALL' ? '전체' : status === 'UNPAID' ? '미납' : '납부'}
                  </button>
                ))}
              </div>
              <input
                className="input"
                type="search"
                placeholder="학생 이름 또는 청구번호 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 220, maxWidth: "100%" }}
              />
            </div>
          </div>
          {allInvoices === null ? (
            <div className="empty">불러오는 중…</div>
          ) : filteredInvoices.length === 0 ? (
            <div className="empty">검색 결과가 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {filteredInvoices.map((invoice) => {
                const due = invoice.due_date ? formatDate(invoice.due_date) : "기한 없음";
                const isOverdue = invoice.status === "UNPAID" && invoice.due_date ? invoice.due_date < localToday() : false;
                return (
                  <div key={invoice.invoice_id} className="list-row" style={{ alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="title">{invoice.member_name || "알 수 없음"}</div>
                      <div className="meta">{invoice.item_name} · 청구번호 {invoice.invoice_id}</div>
                      <div className="meta">납부기한: {due}</div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 120 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{won(invoice.amount)}</div>

                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginBottom: 8 }}>
                        <div className={`badge ${invoice.status === "PAID" ? "success" : isOverdue ? "danger" : "warning"} no-dot`} style={{ marginRight: "auto" }}>
                          {isOverdue ? "연체" : invoice.status === "PAID" ? "납부완료" : "미납"}
                        </div>
                        {/* ✨ 상태가 미납일 때만 수정/삭제 버튼 표시 */}
                        {invoice.status !== "PAID" && (
                          <>
                            <button className="btn ghost sm" style={{ padding: "0 6px" }} onClick={() => setEditingInvoice(invoice)}>수정</button>
                            <button className="btn danger sm" style={{ padding: "0 6px" }} onClick={() => handleDeleteInvoice(invoice.invoice_id)}>삭제</button>
                          </>
                        )}
                      </div>

                      {invoice.status === "PAID" ? (
                        <button className="btn outline sm" style={{ width: "100%" }} disabled>결제 완료</button>
                      ) : (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn sm" style={{ flex: 1 }} onClick={() => setPayingInvoice({ invoice, method: "CASH" })} title="현금·계좌이체·카드 단말기로 받은 경우">현장 수납</button>
                          <button className="btn outline sm" style={{ flex: 1 }} onClick={() => handlePay(invoice)} title="카카오페이 결제창 열기">카카오페이</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 최근 결제 이력 영역 (기존 유지) */}
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">최근 결제 이력</h3>
              <div className="card-sub">최근 결제 내역을 DB에서 불러옵니다.</div>
            </div>
          </div>
          {payments === null ? (
            <div className="empty">불러오는 중…</div>
          ) : payments.length === 0 ? (
            <div className="empty">결제 기록이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {recentPayments.map((payment) => (
                <div key={payment.payment_id} className="list-row" style={{ flexWrap: "wrap", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="title">{payment.member_name || "알 수 없음"}</div>
                    <div className="meta">{METHOD_LABEL[payment.method] || payment.method || "-"} · {payment.note || payment.payment_type}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{won(payment.amount)}</div>
                    <div className="meta">{formatDate(payment.paid_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ✨ 청구서 수정용 모달(Modal) */}
      {payingInvoice && (
        <div className="modal-backdrop" onClick={() => setPayingInvoice(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3>현장 수납 처리</h3>
            <p className="meta" style={{ marginBottom: 12 }}>
              {payingInvoice.invoice.member_name} · {payingInvoice.invoice.item_name} · <b>{won(payingInvoice.invoice.amount)}</b><br />
              실제로 돈을 받은 뒤에 눌러 주세요. 결제 이력에 기록되고 학부모에게 납부 확인 알림이 갑니다.
            </p>
            <div className="segmented" style={{ marginBottom: 12 }}>
              {["CASH", "TRANSFER", "CARD"].map((m) => (
                <button key={m} type="button" className={payingInvoice.method === m ? "active" : ""} onClick={() => setPayingInvoice({ ...payingInvoice, method: m })}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPayingInvoice(null)}>취소</button>
              <button className="btn" onClick={handleMarkPaid}>{METHOD_LABEL[payingInvoice.method]} 수납 완료</button>
            </div>
          </div>
        </div>
      )}

      {editingInvoice && (
        <div className="modal-backdrop" onClick={() => setEditingInvoice(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>청구서 수정</h3>
            <div className="card-sub" style={{ marginBottom: 16 }}>{editingInvoice.member_name} 학생의 청구 내역을 수정합니다.</div>

            <div className="form-row">
              <label>청구 항목</label>
              <input
                className="input"
                value={editingInvoice.item_name}
                onChange={(e) => setEditingInvoice({ ...editingInvoice, item_name: e.target.value })}
              />
            </div>

            <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>금액</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={editingInvoice.amount}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, amount: e.target.value })}
                />
              </div>
              <div>
                <label>납부 기한</label>
                <input
                  className="input"
                  type="date"
                  value={editingInvoice.due_date || ""}
                  onChange={(e) => setEditingInvoice({ ...editingInvoice, due_date: e.target.value })}
                />
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn ghost" onClick={() => setEditingInvoice(null)} disabled={isUpdating}>취소</button>
              <button className="btn" onClick={handleUpdateInvoice} disabled={isUpdating}>
                {isUpdating ? "저장 중..." : "변경사항 저장"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
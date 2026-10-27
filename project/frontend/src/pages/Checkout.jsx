import { useCallback, useEffect, useState } from "react";
import { errorText, fetchParentInvoices, parentKakaoReady } from "../api";
import { useDataRefresh, won } from "../utils/sync";

/* =====================================================================
   학부모 결제 탭 (카카오페이)
     1) 이 계정에 연결된 자녀의 청구서 조회 (/api/parent/invoices)
     2) "카카오페이 결제" → /api/parent/payments/kakao-ready (금액은 서버가 청구서에서 확정)
     3) 결제 승인 → 결제 이력 + 청구서 PAID → /checkout?kakao=success 로 돌아와 결과 표시
===================================================================== */
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export default function Checkout({ hasChildren = true, onLinkChild }) {
  const [unpaid, setUnpaid] = useState(null);
  const [paid, setPaid] = useState([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [kakaoEnabled, setKakaoEnabled] = useState(true);
  const [payingId, setPayingId] = useState(null);

  const load = useCallback(() => {
    fetchParentInvoices("UNPAID").then(setUnpaid).catch(() => { setUnpaid([]); setError("청구서를 불러오지 못했습니다."); });
    fetchParentInvoices("PAID").then(setPaid).catch(() => setPaid([]));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const kakao = p.get("kakao");
    if (kakao) {
      setResult({ type: kakao, amount: p.get("amount"), reason: p.get("reason") });
      window.history.replaceState({}, "", "/parentportal?tab=pay");
    }
    load();
  }, [load]);
  useDataRefresh(load);

  const pay = async (inv) => {
    setError("");
    setPayingId(inv.invoice_id);
    try {
      const data = await parentKakaoReady(inv.invoice_id);
      const url = isMobile() ? data.next_redirect_mobile_url || data.next_redirect_pc_url : data.next_redirect_pc_url || data.next_redirect_mobile_url;
      if (!url) throw new Error("결제 페이지 주소를 받지 못했습니다.");
      window.location.href = url;
    } catch (e) {
      if (e?.response?.status === 503) setKakaoEnabled(false);
      setError(errorText(e, e.message || "결제를 준비하지 못했습니다."));
      setPayingId(null);
    }
  };

  const total = (unpaid || []).reduce((s, i) => s + (i.amount || 0), 0);

  return (
    <>
      {result?.type === "success" && <div className="fl-banner success">결제가 완료되었습니다{result.amount ? ` (${won(result.amount)})` : ""}.</div>}
      {result?.type === "cancel" && <div className="fl-banner warning">결제가 취소되었습니다.</div>}
      {result?.type === "fail" && <div className="fl-banner danger">결제에 실패했습니다{result.reason ? ` (${result.reason})` : ""}.</div>}
      {error && <div className="fl-banner danger">{error}</div>}
      {!kakaoEnabled && <div className="fl-banner warning">카카오페이 결제가 아직 준비되지 않았습니다. 학원으로 문의해 주세요.</div>}

      <div className="pp-card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3>납부할 청구서</h3>
          {unpaid?.length > 0 && <b style={{ marginLeft: "auto" }}>{won(total)}</b>}
        </div>
        {!hasChildren ? (
          <div className="empty">연결된 자녀가 없습니다.<div style={{ marginTop: 10 }}><button className="btn sm" onClick={onLinkChild}>자녀 연결하기</button></div></div>
        ) : unpaid === null ? <div className="fl-skeleton" style={{ height: 100 }} /> : unpaid.length === 0 ? (
          <div className="empty">납부할 청구서가 없습니다.</div>
        ) : unpaid.map((inv) => (
          <div className="inv-row" key={inv.invoice_id}>
            <div className="body">
              <div className="title">{inv.member_name} · {inv.item_name}</div>
              <div className="meta">{inv.due_date ? `납부기한 ${inv.due_date}` : "기한 없음"}</div>
            </div>
            <div className="amt">{won(inv.amount)}</div>
            <button className="kakao-btn" disabled={!kakaoEnabled || payingId === inv.invoice_id} onClick={() => pay(inv)}>
              {payingId === inv.invoice_id ? "이동 중…" : "카카오페이"}
            </button>
          </div>
        ))}
      </div>

      {paid.length > 0 && (
        <div className="pp-card">
          <h3>납부 내역</h3>
          {paid.slice(0, 20).map((inv) => (
            <div className="inv-row" key={inv.invoice_id}>
              <div className="body">
                <div className="title">{inv.member_name} · {inv.item_name}</div>
                <div className="meta">{(inv.created_at || "").slice(0, 10)} 청구</div>
              </div>
              <div className="amt" style={{ color: "var(--success-text)" }}>{won(inv.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

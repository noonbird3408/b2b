import { useEffect, useState } from "react";
import { fetchKakaoStatus, fetchParentInvoices, parentKakaoReady } from "../api";

/* =====================================================================
   학부모 결제 탭 (카카오페이)
   흐름:
     1) 로그인한 학부모 계정에 연결된 자녀의 미납 청구서 조회 (/api/parent/invoices)
     2) "카카오페이 결제" → /api/parent/payments/kakao-ready (금액은 서버가 청구서에서 확정)
     3) 카카오페이 결제 → 서버 승인 + 결제이력 + 청구서 PAID → /checkout?kakao=success
     4) 이 컴포넌트가 결과 배너 표시
===================================================================== */

const won = (n) => `₩${Number(n || 0).toLocaleString()}`;
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export default function Checkout({ hasChildren = true, onLinkChild }) {
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);   // {type, amount, reason}
  const [kakaoEnabled, setKakaoEnabled] = useState(true);
  const [payingId, setPayingId] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const kakao = p.get("kakao");
    if (kakao) {
      setResult({ type: kakao, amount: p.get("amount"), reason: p.get("reason") });
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetchKakaoStatus().then((s) => setKakaoEnabled(!!s.enabled)).catch(() => {});
    fetchParentInvoices().then(setInvoices).catch(() => { setInvoices([]); setError("청구서를 불러오지 못했습니다."); });
  }, []);

  const pay = async (inv) => {
    setError("");
    setPayingId(inv.invoice_id);
    try {
      const data = await parentKakaoReady(inv.invoice_id);
      const url = isMobile()
        ? data.next_redirect_mobile_url || data.next_redirect_pc_url
        : data.next_redirect_pc_url || data.next_redirect_mobile_url;
      if (!url) throw new Error("결제 페이지 주소를 받지 못했습니다.");
      window.location.href = url; // 카카오페이 결제창으로 이동
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 503) { setKakaoEnabled(false); setError(detail || "서버에 카카오페이 키가 설정되지 않았습니다."); }
      else setError(detail || e.message || "결제 준비 중 오류가 발생했습니다.");
      setPayingId(null);
    }
  };

  return (
    <div className="public-body" style={{ alignItems: "flex-start" }}>
      <div className="public-card">
        <h2>수강료 결제</h2>
        <div className="sub">연결된 자녀의 미납 청구서를 카카오페이로 결제합니다.</div>

        {result?.type === "success" && (
          <div className="error-banner" style={{ background: "var(--success-soft)", color: "var(--success-text)" }}>
            ✅ 결제가 완료되었습니다{result.amount ? ` (${won(result.amount)})` : ""}.
          </div>
        )}
        {result?.type === "cancel" && (
          <div className="error-banner" style={{ background: "var(--warning-soft)", color: "var(--warning-text)" }}>결제가 취소되었습니다.</div>
        )}
        {result?.type === "fail" && (
          <div className="error-banner">결제에 실패했습니다{result.reason ? ` (${result.reason})` : ""}. 다시 시도해 주세요.</div>
        )}
        {error && <div className="error-banner">{error}</div>}
        {!kakaoEnabled && (
          <div className="error-banner" style={{ background: "var(--warning-soft)", color: "var(--warning-text)" }}>
            ⚠️ 카카오페이가 아직 설정되지 않았습니다. (서버 KAKAO_SECRET_KEY 필요)
          </div>
        )}

        {!hasChildren ? (
          <div className="empty">
            먼저 자녀를 연결해 주세요.
            <div style={{ marginTop: 10 }}><button className="btn sm" onClick={onLinkChild}>자녀 연결하기</button></div>
          </div>
        ) : invoices === null ? (
          <div className="empty">불러오는 중…</div>
        ) : invoices.length === 0 ? (
          <div className="empty">미납 내역이 없습니다. 감사합니다! 🎉</div>
        ) : invoices.map((inv) => (
          <div className="inv-row" key={inv.invoice_id}>
            <div className="body">
              <div className="title">{inv.member_name} · {inv.item_name}</div>
              <div className="meta">{inv.due_date ? `납부기한 ${inv.due_date}` : "기한 없음"}</div>
            </div>
            <div className="amt">{won(inv.amount)}</div>
            <button className="kakao-btn" disabled={!kakaoEnabled || payingId === inv.invoice_id} onClick={() => pay(inv)}>
              {payingId === inv.invoice_id ? "이동 중…" : "카카오페이 결제"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

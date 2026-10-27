// =====================================================================
// 재고 관리 (v10) — 학원 물품(교재·도복·소모품 등) 수량 기록 → 부족하면 '구매 확인' → 승인 → 입고
//   직원: 조회·입출고·구매 요청 / 원장: + 구매 승인·반려·물품 삭제 (서버가 같은 규칙으로 검사)
//   지표: 부족 = 현재 수량 ≤ 안전 재고, 품절 = 0, 권장 구매 수량 = 안전 재고 × 2 − 현재 수량
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  adjustInventory, cancelPurchaseRequest, createInventoryItem, createPurchaseRequest, decidePurchaseRequest, deleteInventoryItem,
  errorText, fetchB2BProducts, fetchInventory, fetchInventoryLogs, fetchMe, fetchPurchaseCheck, fetchPurchaseRequests,
  fetchShopProducts, logShopClick, receivePurchaseRequest, updateInventoryItem,
} from "../api";
import { useDataRefresh, won } from "../utils/sync";
import { addToCart } from "../utils/cart";

const STYLES = `
.inv-items{display:grid;gap:8px;}
.inv-item{display:grid;grid-template-columns:minmax(0,1.6fr) 120px 150px auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);}
.inv-item.low{border-left:4px solid var(--warning);}
.inv-item.out{border-left:4px solid var(--danger);}
.inv-item .nm{font-weight:700;font-size:14px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.inv-item .sub{font-size:12px;color:var(--text-3);margin-top:2px;}
.inv-qty{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;}
.inv-qty small{font-size:12px;font-weight:500;color:var(--text-3);margin-left:3px;}
.inv-step{display:flex;gap:4px;align-items:center;}
.inv-step button{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-size:16px;color:var(--text);}
.inv-actions{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;}
.inv-bar{height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden;margin-top:6px;}
.inv-bar span{display:block;height:100%;border-radius:99px;}
.inv-opt{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);font-size:13px;}
.inv-check{display:grid;gap:12px;}
.inv-check .card{display:grid;gap:10px;}
.inv-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px;}
.inv-form .wide{grid-column:1/-1;}
.inv-req{display:grid;grid-template-columns:minmax(0,1.4fr) 90px 120px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;}
.inv-req:last-child{border-bottom:0;}
@media(max-width:760px){
  .inv-item{grid-template-columns:1fr auto;}
  .inv-item .hide-sm{display:none;}
  .inv-actions{grid-column:1/-1;justify-content:flex-start;}
  .inv-form{grid-template-columns:1fr;}
  .inv-req{grid-template-columns:1fr auto;}
  .inv-req .hide-sm{display:none;}
}
`;

const STATUS_TONE = { OK: "success", LOW: "warning", OUT: "danger" };
const REQ_TONE = { REQUESTED: "warning", APPROVED: "primary", REJECTED: "gray", RECEIVED: "success", CANCELED: "gray" };
const TABS = [["stock", "재고 현황"], ["check", "구매 확인"], ["requests", "구매 요청"]];
const EMPTY_ITEM = { name: "", category: "소모품", unit: "개", quantity: 0, min_quantity: 0, location: "", note: "", keyword: "",
  b2b_sku: "", shop_product_id: "" };

export default function Inventory() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === searchParams.get("tab")) ? searchParams.get("tab") : "stock";
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [check, setCheck] = useState(null);
  const [requests, setRequests] = useState(null);
  const [reqStatus, setReqStatus] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("전체");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);      // null | {} 새 물품 | item
  const [adjusting, setAdjusting] = useState(null);  // {item, reason}
  const [logsOf, setLogsOf] = useState(null);
  const [busy, setBusy] = useState(false);
  const isOwner = me?.facility?.my_role === "owner";

  useEffect(() => { fetchMe().then(setMe).catch(() => navigate("/")); }, [navigate]);
  const setTab = (next) => setSearchParams(next === "stock" ? {} : { tab: next }, { replace: true });

  const loadStock = useCallback(() => fetchInventory({ q: q || undefined, category: category === "전체" ? undefined : category, status: status || undefined })
    .then((d) => { setData(d); setError(""); })
    .catch((e) => setError(errorText(e, "재고를 불러오지 못했습니다."))), [q, category, status]);
  const loadCheck = useCallback(() => fetchPurchaseCheck().then(setCheck).catch((e) => setError(errorText(e, "구매 확인 목록을 불러오지 못했습니다."))), []);
  const loadRequests = useCallback(() => fetchPurchaseRequests({ status: reqStatus || undefined }).then(setRequests)
    .catch((e) => setError(errorText(e, "구매 요청을 불러오지 못했습니다."))), [reqStatus]);
  const reloadAll = useCallback(() => { loadStock(); if (tab === "check") loadCheck(); if (tab === "requests") loadRequests(); }, [loadStock, loadCheck, loadRequests, tab]);

  useEffect(() => { const t = window.setTimeout(loadStock, 200); return () => window.clearTimeout(t); }, [loadStock]);
  useEffect(() => { if (tab === "check") loadCheck(); }, [tab, loadCheck]);
  useEffect(() => { if (tab === "requests") loadRequests(); }, [tab, loadRequests]);
  useDataRefresh(reloadAll);

  const flash = (text) => { setNotice(text); window.setTimeout(() => setNotice(""), 3500); };
  const act = async (task, done, fallback) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await task();
      if (done) flash(typeof done === "function" ? done(res) : done);
      reloadAll();
    } catch (e) {
      setError(errorText(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const step = (item, change) => act(() => adjustInventory(item.item_id, { change, reason: change > 0 ? "IN" : "OUT", note: change > 0 ? "빠른 입고" : "빠른 사용" }),
    (res) => `${item.name} ${change > 0 ? "+" : ""}${change}${item.unit} → 현재 ${res.quantity}${item.unit}${res.status !== "OK" ? ` (${res.status_label})` : ""}`,
    "수량을 바꾸지 못했습니다.");

  const requestPurchase = (item, quantity, approve = false) => act(async () => {
    const created = await createPurchaseRequest({ item_id: item.item_id, quantity, note: approve ? "원장 바로 구매 결정" : "" });
    if (approve) await decidePurchaseRequest(created.request_id, "APPROVED", "구매 확인 화면에서 바로 결정");
    return created;
  }, approve ? `${item.name} ${quantity}${item.unit} 구매를 결정했습니다. 물품이 오면 '구매 요청' 탭에서 입고 처리하세요.`
    : `${item.name} ${quantity}${item.unit} 구매 요청을 보냈습니다. 원장이 승인하면 알림이 갑니다.`, "구매 요청을 보내지 못했습니다.");

  const decide = (r, decision) => {
    const note = decision === "REJECTED" ? window.prompt("반려 사유(선택)", "") : "";
    if (note === null) return;
    act(() => decidePurchaseRequest(r.request_id, decision, note || ""), decision === "APPROVED" ? "구매를 승인했습니다." : "요청을 반려했습니다.", "처리하지 못했습니다.");
  };
  const receive = (r) => {
    const value = window.prompt(`${r.item_name} 입고 수량 (요청 ${r.quantity})`, String(r.quantity));
    if (value === null) return;
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty < 1) return setError("입고 수량은 1 이상의 정수로 입력하세요.");
    act(() => receivePurchaseRequest(r.request_id, { quantity: qty }), (res) => `${r.item_name} ${qty}개 입고 → 현재 ${res.item.quantity}${res.item.unit}`, "입고 처리하지 못했습니다.");
  };

  const summary = data?.summary;
  const categories = useMemo(() => ["전체", ...(data?.categories || [])], [data]);

  return (
    <>
      <style>{STYLES}</style>
      <h2 className="page-title">재고 관리</h2>
      <p className="page-subtitle">물품 수량을 기록하고, 부족하면 구매 여부를 확인해 쇼핑몰·B2B 발주로 바로 연결합니다.</p>
      {error && <div className="fl-banner danger" onClick={() => setError("")}>{error}</div>}
      {notice && <div className="fl-banner success" role="status">{notice}</div>}

      {summary && (
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card"><div className="stat-card-head"><span className="stat-label">등록 물품</span></div>
            <div className="stat-value num">{summary.total}<span className="unit">종</span></div></div>
          <div className="stat-card"><div className="stat-card-head"><span className="stat-label" title={data.definitions.low}>부족</span></div>
            <div className="stat-value num" style={{ color: summary.low ? "var(--warning-text)" : undefined }}>{summary.low}<span className="unit">종</span></div>
            <div className="stat-sub">{data.definitions.low}</div></div>
          <div className="stat-card"><div className="stat-card-head"><span className="stat-label">품절</span></div>
            <div className="stat-value num" style={{ color: summary.out ? "var(--danger-text, var(--danger))" : undefined }}>{summary.out}<span className="unit">종</span></div></div>
          <div className="stat-card"><div className="stat-card-head"><span className="stat-label">구매 승인 대기</span></div>
            <div className="stat-value num">{summary.pending_requests}<span className="unit">건</span></div>
            <div className="stat-sub">{isOwner ? "구매 요청 탭에서 승인·반려" : "원장이 확인합니다"}</div></div>
        </div>
      )}

      <div className="tabs">
        {TABS.map(([k, v]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {v}{k === "check" && summary && summary.low + summary.out > 0 && <span className="count">{summary.low + summary.out}</span>}
            {k === "requests" && summary?.pending_requests > 0 && <span className="count">{summary.pending_requests}</span>}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <>
          <div className="toolbar" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
            <input className="input" style={{ flex: "1 1 200px", minWidth: 0 }} placeholder="물품 이름·보관 위치 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="분류">
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
              <option value="">전체 상태</option><option value="LOW">부족</option><option value="OUT">품절</option><option value="OK">충분</option>
            </select>
            <button className="btn ml-auto" onClick={() => setEditing({ ...EMPTY_ITEM })}>＋ 물품 추가</button>
          </div>
          {data === null ? <div className="fl-skeleton" style={{ height: 220 }} /> : (
            <div className="inv-items">
              {data.items.map((item) => {
                const ratio = item.min_quantity ? Math.min(100, (item.quantity / (item.min_quantity * 2)) * 100) : 100;
                return (
                  <div key={item.item_id} className={`inv-item ${item.status.toLowerCase()}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="nm">{item.name}
                        <span className={`badge ${STATUS_TONE[item.status]} no-dot`}>{item.status_label}</span>
                        {item.open_request && <span className="badge primary no-dot">구매 {item.open_request.status_label}</span>}
                      </div>
                      <div className="sub">{item.category}{item.location ? ` · ${item.location}` : ""}{item.b2b_sku ? ` · B2B ${item.b2b_sku}` : ""}{item.shop_product_name ? ` · 쇼핑몰 ${item.shop_product_name}` : ""}</div>
                      <div className="inv-bar" title={`안전 재고 ${item.min_quantity}${item.unit}`}>
                        <span style={{ width: `${ratio}%`, background: `var(--${STATUS_TONE[item.status]})` }} />
                      </div>
                    </div>
                    <div className="inv-qty">{item.quantity}<small>{item.unit}</small>
                      <div className="sub" style={{ fontSize: 11, fontWeight: 400 }}>안전 재고 {item.min_quantity}</div></div>
                    <div className="inv-step hide-sm">
                      <button type="button" onClick={() => step(item, -1)} disabled={busy || item.quantity <= 0} aria-label={`${item.name} 1개 사용`}>−</button>
                      <button type="button" onClick={() => step(item, 1)} disabled={busy} aria-label={`${item.name} 1개 입고`}>＋</button>
                    </div>
                    <div className="inv-actions">
                      <button className="btn ghost sm" onClick={() => setAdjusting({ item, reason: "IN" })}>입고</button>
                      <button className="btn ghost sm" onClick={() => setAdjusting({ item, reason: "OUT" })}>사용</button>
                      <button className="btn ghost sm" onClick={() => setLogsOf(item)}>기록</button>
                      <button className="btn ghost sm" onClick={() => setEditing({ ...item, b2b_sku: item.b2b_sku || "", shop_product_id: item.shop_product_id || "" })}>수정</button>
                      {isOwner && <button className="btn danger sm" onClick={() => window.confirm(`${item.name}을(를) 목록에서 뺄까요? (기록은 보존)`) &&
                        act(() => deleteInventoryItem(item.item_id), "물품을 목록에서 뺐습니다.", "삭제하지 못했습니다.")}>삭제</button>}
                    </div>
                  </div>
                );
              })}
              {!data.items.length && <div className="empty">{q || status || category !== "전체" ? "조건에 맞는 물품이 없습니다." : "아직 등록한 물품이 없습니다. ‘물품 추가’로 교재·도복·소모품 등을 등록하세요."}</div>}
            </div>
          )}
        </>
      )}

      {tab === "check" && (
        check === null ? <div className="fl-skeleton" style={{ height: 220 }} /> : (
          <div className="inv-check">
            <p className="muted" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>{check.definition}. 연결한 상품이 없으면 물품 이름(또는 검색어)으로 쇼핑몰·B2B 상품을 찾아 드립니다.</span>
              <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => navigate("/shop?tab=cart")}>🛒 쇼핑몰 장바구니 보기</button>
            </p>
            {check.items.map((item) => <CheckCard key={item.item_id} item={item} isOwner={isOwner} busy={busy}
              onRequest={requestPurchase} navigate={navigate} facilityId={me?.facility?.facility_id} onCart={flash} />)}
            {!check.items.length && <div className="empty">부족하거나 품절된 물품이 없습니다. 👍</div>}
          </div>
        )
      )}

      {tab === "requests" && (
        <>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <select className="select" value={reqStatus} onChange={(e) => setReqStatus(e.target.value)} aria-label="요청 상태">
              <option value="">전체</option><option value="REQUESTED">승인 대기</option><option value="APPROVED">승인(구매 진행)</option>
              <option value="RECEIVED">입고 완료</option><option value="REJECTED">반려</option><option value="CANCELED">취소</option>
            </select>
          </div>
          {requests === null ? <div className="fl-skeleton" style={{ height: 200 }} /> : (
            <div className="card" style={{ padding: 0 }}>
              {requests.map((r) => (
                <div key={r.request_id} className="inv-req">
                  <div style={{ minWidth: 0 }}>
                    <b>{r.item_name || "(삭제된 물품)"}</b> <span className="muted">#{r.request_id}</span>
                    <div className="muted">{r.requested_by || "관리자"} · {r.created_at?.replace("T", " ")}{r.note ? ` · ${r.note}` : ""}</div>
                    {r.decision_note && <div className="muted">원장: {r.decision_note}</div>}
                  </div>
                  <div className="num hide-sm"><b>{r.quantity}</b>개</div>
                  <div><span className={`badge ${REQ_TONE[r.status]} no-dot`}>{r.status_label}</span></div>
                  <div className="muted hide-sm">{r.received_at ? `입고 ${r.received_at.replace("T", " ")}` : r.decided_at ? `처리 ${r.decided_at.replace("T", " ")}` : ""}</div>
                  <div className="inv-actions">
                    {isOwner && r.status === "REQUESTED" && <>
                      <button className="btn sm" disabled={busy} onClick={() => decide(r, "APPROVED")}>구매 승인</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => decide(r, "REJECTED")}>반려</button>
                    </>}
                    {r.status === "APPROVED" && <button className="btn sm" disabled={busy} onClick={() => receive(r)}>입고 처리</button>}
                    {["REQUESTED", "APPROVED"].includes(r.status) && (
                      <button className="btn ghost sm" disabled={busy} onClick={() => window.confirm("이 구매 요청을 취소할까요?") &&
                        act(() => cancelPurchaseRequest(r.request_id), "요청을 취소했습니다.", "취소하지 못했습니다.")}>취소</button>
                    )}
                  </div>
                </div>
              ))}
              {!requests.length && <div className="empty" style={{ border: 0 }}>구매 요청이 없습니다.</div>}
            </div>
          )}
        </>
      )}

      {editing && <ItemForm initial={editing} categories={data?.categories || []} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); flash(msg); reloadAll(); }} />}
      {adjusting && <AdjustForm {...adjusting} onClose={() => setAdjusting(null)}
        onSaved={(msg) => { setAdjusting(null); flash(msg); reloadAll(); }} />}
      {logsOf && <LogsModal item={logsOf} onClose={() => setLogsOf(null)} />}
    </>
  );
}

function CheckCard({ item, isOwner, busy, onRequest, navigate, facilityId, onCart }) {
  const [qty, setQty] = useState(item.suggested_quantity || 1);
  const open = item.open_request;
  return (
    <div className="card">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>{item.name}</b>
        <span className={`badge ${STATUS_TONE[item.status]} no-dot`}>{item.status_label}</span>
        <span className="muted">현재 {item.quantity}{item.unit} · 안전 재고 {item.min_quantity}{item.unit} · 권장 구매 {item.suggested_quantity}{item.unit}</span>
      </div>
      {item.options.length ? item.options.map((o, i) => (
        <div key={i} className="inv-opt">
          <span className={`badge ${o.type === "b2b" ? "primary" : "success"} no-dot`}>{o.label}</span>
          <b>{o.name}</b>
          {o.type === "b2b" ? <span className="muted">{o.quantity}개 × {won(o.unit_price)} = <b>{won(o.estimated_total)}</b> (예상)</span>
            : <span className="muted">{o.mall ? `${o.mall.logo} ${o.mall.name} · ` : ""}{o.list_price ? <s>{won(o.list_price)}</s> : null} {o.price_label}
              {o.discount_rate ? ` (-${o.discount_rate}%)` : ""}{o.min_quantity > 1 ? ` · 최소 ${o.min_quantity}개` : ""}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {o.type === "b2b"
              ? <button className="btn ghost sm" onClick={() => navigate(`/b2b-shop?sku=${encodeURIComponent(o.sku)}&qty=${Math.max(qty, o.quantity || 1)}`)}>B2B 발주 화면 ↗</button>
              : o.purchasable
                ? <button className="btn ghost sm" onClick={() => {
                    addToCart(facilityId, { product_id: o.product_id, name: o.name, quantity: Math.max(qty, o.min_quantity || 1),
                      inventory_item_id: item.item_id, min_quantity: o.min_quantity });
                    logShopClick(o.product_id, "inventory");
                    onCart(`장바구니에 담았습니다: ${o.name} ${Math.max(qty, o.min_quantity || 1)}개 — 입고 처리하면 '${item.name}' 재고가 늘어납니다.`);
                  }}>🛒 장바구니에 담기</button>
                : <a className="btn ghost sm" href={o.url} target="_blank" rel="noopener noreferrer" onClick={() => logShopClick(o.product_id, "inventory")}>쇼핑몰에서 보기 ↗</a>}
          </span>
        </div>
      )) : (
        <div className="inv-opt"><span className="muted">연결된 상품이 없습니다.</span>
          <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => navigate(`/shop?q=${encodeURIComponent(item.keyword || item.name)}`)}>쇼핑몰에서 찾기</button>
        </div>
      )}
      {open ? (
        <div className="muted">구매 요청 #{open.request_id} — <b>{open.status_label}</b> ({open.quantity}{item.unit}). ‘구매 요청’ 탭에서 확인하세요.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="muted" htmlFor={`qty-${item.item_id}`}>구매 수량</label>
          <input id={`qty-${item.item_id}`} className="input" type="number" min="1" max="100000" style={{ width: 100 }} value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
          <span className="muted">{item.unit}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {isOwner
              ? <button className="btn sm" disabled={busy} onClick={() => onRequest(item, qty, true)}>구매하기로 결정</button>
              : <button className="btn sm" disabled={busy} onClick={() => onRequest(item, qty)}>원장에게 구매 요청</button>}
          </span>
        </div>
      )}
    </div>
  );
}

function ItemForm({ initial, categories, onClose, onSaved }) {
  const isEdit = Boolean(initial.item_id);
  const [form, setForm] = useState(initial);
  const [shop, setShop] = useState([]);
  const [b2b, setB2b] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchShopProducts().then(setShop).catch(() => setShop([]));
    fetchB2BProducts().then(setB2b).catch(() => setB2b([]));
  }, []);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setErr("물품 이름을 입력하세요.");
    setBusy(true); setErr("");
    const payload = { name: form.name.trim(), category: (form.category || "소모품").trim(), unit: (form.unit || "개").trim(),
      min_quantity: Number(form.min_quantity) || 0, location: form.location || "", note: form.note || "", keyword: form.keyword || "",
      b2b_sku: form.b2b_sku || null, shop_product_id: form.shop_product_id ? Number(form.shop_product_id) : null,
      quantity: Number(form.quantity) || 0 };
    try {
      if (isEdit) await updateInventoryItem(initial.item_id, payload); else await createInventoryItem(payload);
      onSaved(isEdit ? "물품 정보를 저장했습니다." : "물품을 추가했습니다.");
    } catch (error) {
      setErr(errorText(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" style={{ width: "min(620px,100%)" }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{isEdit ? "물품 수정" : "물품 추가"}</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <div className="inv-form">
          <div className="form-row wide"><label>물품 이름</label><input className="input" value={form.name} onChange={set("name")} maxLength={100} autoFocus /></div>
          <div className="form-row"><label>분류</label>
            <input className="input" list="inv-categories" value={form.category} onChange={set("category")} maxLength={40} />
            <datalist id="inv-categories">{[...new Set(["교재", "소모품", "수업 물품", "도장 용품", "행사 용품", ...categories])].map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="form-row"><label>단위</label><input className="input" value={form.unit} onChange={set("unit")} maxLength={20} placeholder="개·권·박스·롤" /></div>
          <div className="form-row"><label>{isEdit ? "현재 수량 (바꾸면 '재고 조정' 기록)" : "현재 수량"}</label>
            <input className="input" type="number" min="0" value={form.quantity} onChange={set("quantity")} /></div>
          <div className="form-row"><label>안전 재고 (이하가 되면 '부족')</label>
            <input className="input" type="number" min="0" value={form.min_quantity} onChange={set("min_quantity")} /></div>
          <div className="form-row wide"><label>보관 위치</label><input className="input" value={form.location} onChange={set("location")} maxLength={100} placeholder="예: 사무실 수납장 2칸" /></div>
          <div className="form-row"><label>B2B 상품 연결 (선택)</label>
            <select className="select" value={form.b2b_sku || ""} onChange={set("b2b_sku")}>
              <option value="">연결 안 함</option>
              {b2b.map((p) => <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>)}
            </select></div>
          <div className="form-row"><label>쇼핑몰 상품 연결 (선택)</label>
            <select className="select" value={form.shop_product_id || ""} onChange={set("shop_product_id")}>
              <option value="">연결 안 함</option>
              {shop.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
            </select></div>
          <div className="form-row wide"><label>쇼핑몰 검색어 (연결 상품이 없을 때 이 말로 찾음)</label>
            <input className="input" value={form.keyword} onChange={set("keyword")} maxLength={100} placeholder="비우면 물품 이름으로 찾음 (예: 태권도 띠)" /></div>
          <div className="form-row wide"><label>메모</label><input className="input" value={form.note} onChange={set("note")} maxLength={300} /></div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </div>
  );
}

function AdjustForm({ item, reason: initialReason, onClose, onSaved }) {
  const [reason, setReason] = useState(initialReason);
  const [amount, setAmount] = useState(1);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const n = Math.abs(Number(amount) || 0);
    if (!n && reason !== "ADJUST") return setErr("수량을 입력하세요.");
    const change = reason === "IN" ? n : reason === "OUT" ? -n : Number(amount) - item.quantity;
    if (!change) return setErr("바뀐 수량이 없습니다.");
    setBusy(true); setErr("");
    try {
      const res = await adjustInventory(item.item_id, { change, reason, note });
      onSaved(`${item.name} ${change > 0 ? "+" : ""}${change}${item.unit} → 현재 ${res.quantity}${item.unit}${res.status !== "OK" ? ` (${res.status_label})` : ""}`);
    } catch (error) {
      setErr(errorText(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" style={{ width: "min(420px,100%)" }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{item.name} · 현재 {item.quantity}{item.unit}</h3>
        {err && <div className="fl-banner danger">{err}</div>}
        <div className="segmented" style={{ marginBottom: 10 }}>
          {[["IN", "입고(+)"], ["OUT", "사용·출고(−)"], ["ADJUST", "실사 조정(=)"]].map(([k, v]) => (
            <button type="button" key={k} className={`segmented-btn${reason === k ? " active" : ""}`} onClick={() => { setReason(k); setAmount(k === "ADJUST" ? item.quantity : 1); }}>{v}</button>
          ))}
        </div>
        <div className="form-row"><label>{reason === "ADJUST" ? "실제로 센 수량" : "수량"}</label>
          <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
        <div className="form-row"><label>메모 (선택)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="예: 승급 심사용으로 사용" /></div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={busy}>저장</button>
        </div>
      </form>
    </div>
  );
}

function LogsModal({ item, onClose }) {
  const [logs, setLogs] = useState(null);
  useEffect(() => { fetchInventoryLogs(item.item_id).then(setLogs).catch(() => setLogs([])); }, [item.item_id]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "min(560px,100%)", maxHeight: "86dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3>{item.name} 입출고 기록</h3>
        {logs === null ? <div className="fl-skeleton" style={{ height: 160 }} /> : logs.length ? logs.map((l) => (
          <div key={l.log_id} className="list-row" style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
            <span className="muted" style={{ width: 120, flexShrink: 0 }}>{l.created_at?.replace("T", " ")}</span>
            <span className={`badge ${l.change > 0 ? "success" : "warning"} no-dot`}>{l.reason_label}</span>
            <b className="num">{l.change > 0 ? "+" : ""}{l.change}</b>
            <span className="muted">→ {l.quantity_after}{item.unit}</span>
            <span style={{ marginLeft: "auto", textAlign: "right" }} className="muted">{l.by || ""}{l.note ? ` · ${l.note}` : ""}</span>
          </div>
        )) : <div className="empty">기록이 없습니다.</div>}
        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

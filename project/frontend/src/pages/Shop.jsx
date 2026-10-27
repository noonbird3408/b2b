import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  cancelShopOrder, connectShopMall, createShopOrder, createShopProduct, deactivateShopProduct, disconnectShopMall, errorText,
  fetchMe, fetchShopInfo, fetchShopMalls, fetchShopOrders, fetchShopProducts, fetchShopRecommendations, logShopClick,
  payShopOrder, quoteShopCart, receiveShopOrder, searchShopProducts, syncShopProducts, updateShopProduct,
} from "../api";
import { addToCart, CART_EVENT, clearCart, readCart, writeCart } from "../utils/cart";
import { useDataRefresh, won } from "../utils/sync";

/* =====================================================================
   학원 쇼핑몰 (v11) — 여러 제휴몰(가상) + 외부 쇼핑몰(DDM)을 한 화면에서
   - 추천: 개설 수업·학원 소개의 '과목', 재고 부족 물품, 공지 행사, 연결한 제휴몰, 할인, 조회 이력 (서버 rule_based_v2)
   - 장바구니 → 주문서 → 모의 결제 → 입고 처리(재고 반영). 금액은 모두 서버가 계산하고, 화면은 표시만 합니다.
   - 직원: 장바구니 → '원장에게 결제 요청' / 원장: 결제 · 제휴몰 연결 · 주문 취소
===================================================================== */

const SHOP_CSS = `
.shop-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;}
.shop-head .actions{display:flex;gap:8px;flex-wrap:wrap;}
.shop-why{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:0 0 14px;}
.shop-why div{padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface);font-size:12px;color:var(--text-2);line-height:1.5;}
.shop-why b{display:block;font-size:13px;color:var(--text);margin-bottom:2px;}
.shop-context{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;}
.shop-chip{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);}
.shop-chip.subject{background:var(--primary-soft);border-color:transparent;color:var(--primary-text);font-weight:600;}
.shop-chip.event{background:var(--warning-soft);border-color:transparent;color:var(--warning-text);}
.shop-chip.low{background:var(--danger-soft,#FEE2E2);border-color:transparent;color:var(--danger-text,#B91C1C);}
.shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}
.shop-card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;transition:border-color .15s,box-shadow .15s;}
.shop-card:hover{border-color:var(--primary);box-shadow:var(--shadow);}
.shop-thumb{position:relative;height:104px;display:flex;align-items:center;justify-content:center;font-size:38px;}
.shop-thumb img{width:100%;height:100%;object-fit:cover;}
.shop-off{position:absolute;top:8px;left:8px;background:#DC2626;color:#fff;font-size:12px;font-weight:800;padding:2px 8px;border-radius:99px;}
.shop-mall{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.92);color:#111;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;}
.shop-body{padding:12px 14px;display:flex;flex-direction:column;gap:5px;flex:1;}
.shop-cat{font-size:11px;font-weight:700;color:var(--primary-text);}
.shop-name{font-size:14.5px;font-weight:700;margin:0;line-height:1.35;}
.shop-desc{font-size:12px;color:var(--text-2);margin:0;line-height:1.5;}
.shop-reasons{margin:4px 0 0;padding:0;list-style:none;display:grid;gap:3px;}
.shop-reasons li{font-size:11px;color:var(--text-2);padding-left:14px;position:relative;line-height:1.5;}
.shop-reasons li:before{content:"✓";position:absolute;left:0;color:var(--success);font-weight:700;}
.shop-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;padding:10px 14px 12px;border-top:1px solid var(--border);}
.shop-price{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;}
.shop-list{font-size:12px;color:var(--text-3);text-decoration:line-through;margin-right:4px;}
.shop-member{font-size:11.5px;color:var(--success-text,#15803D);font-weight:700;}
.shop-qty{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden;}
.shop-qty button{width:26px;height:28px;border:0;background:var(--surface-2);color:var(--text);font-size:14px;cursor:pointer;}
.shop-qty input{width:42px;height:28px;border:0;text-align:center;background:var(--surface);color:var(--text);font-size:13px;}
.shop-cats{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 12px;}
.shop-cats button{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--text-2);}
.shop-cats button.active{background:var(--primary);border-color:var(--primary);color:#fff;}
.shop-section-title{font-size:16px;font-weight:700;margin:22px 0 4px;}
.shop-section-sub{font-size:12px;color:var(--text-3);margin:0 0 12px;}
.shop-searchbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 10px;}
.shop-searchbar .input{flex:1 1 260px;min-width:0;height:42px;font-size:14px;}
.shop-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:6px 10px;border:1px solid var(--border);border-radius:99px;background:var(--surface);cursor:pointer;user-select:none;color:var(--text);}
.shop-toggle.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-text);font-weight:600;}
.shop-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);margin-bottom:12px;}
.shop-filters label{display:grid;gap:4px;font-size:12px;color:var(--text-2);}
.shop-filters .check{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text);}
.shop-suggest{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;align-items:center;font-size:12px;color:var(--text-3);}
.shop-suggest button{border:1px dashed var(--border-strong);background:var(--surface);border-radius:99px;padding:3px 10px;font-size:12px;color:var(--text-2);cursor:pointer;}
.mall-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}
.mall-card{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);}
.mall-card.connected{border-color:var(--success);box-shadow:0 0 0 1px var(--success) inset;}
.mall-top{display:flex;gap:12px;align-items:center;}
.mall-logo{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:24px;flex-shrink:0;}
.mall-meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:12px;color:var(--text-2);}
.mall-meta b{color:var(--text);}
.cart-group{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);margin-bottom:12px;overflow:hidden;}
.cart-group-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);font-size:13px;flex-wrap:wrap;}
.cart-line{display:grid;grid-template-columns:minmax(0,1fr) auto 110px 28px;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;}
.cart-line:last-child{border-bottom:0;}
.cart-foot{display:flex;justify-content:space-between;gap:8px;padding:8px 14px;font-size:12px;color:var(--text-2);border-top:1px dashed var(--border);flex-wrap:wrap;}
.cart-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start;}
.cart-sum{position:sticky;top:12px;display:grid;gap:8px;}
.cart-sum .cs{display:flex;justify-content:space-between;font-size:13px;color:var(--text-2);}
.cart-sum .cs b{color:var(--text);font-variant-numeric:tabular-nums;}
.cart-sum .cs.total{font-size:18px;font-weight:800;color:var(--text);border-top:1px solid var(--border);padding-top:8px;}
.cart-sum .saved{color:#DC2626;font-weight:700;}
.order-card{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:14px 16px;margin-bottom:10px;display:grid;gap:8px;}
.order-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.order-items{font-size:12.5px;color:var(--text-2);display:grid;gap:3px;}
.pay-methods{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0;}
.pay-methods button{padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:13.5px;cursor:pointer;}
.pay-methods button.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-text);font-weight:700;}
.pay-amount{font-size:26px;font-weight:800;text-align:center;margin:6px 0;font-variant-numeric:tabular-nums;}
.pay-mock{font-size:12px;text-align:center;color:var(--warning-text);background:var(--warning-soft);border-radius:8px;padding:6px 8px;}
.pay-spin{width:42px;height:42px;border-radius:50%;border:4px solid var(--primary-soft);border-top-color:var(--primary);margin:18px auto;animation:payspin 0.9s linear infinite;}
@keyframes payspin{to{transform:rotate(360deg)}}
.shop-admin{margin-top:26px;}
.shop-admin table{width:100%;border-collapse:collapse;font-size:12px;}
.shop-admin th,.shop-admin td{text-align:left;padding:8px;border-bottom:1px solid var(--border);vertical-align:top;}
.shop-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.shop-form .wide{grid-column:1/-1;}
.shop-form label{display:grid;gap:4px;font-size:12px;color:var(--text-2);}
@media(max-width:980px){.shop-why{grid-template-columns:1fr 1fr;}.cart-layout{grid-template-columns:1fr;}.cart-sum{position:static;}}
@media(max-width:640px){.shop-why{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px;}
  .shop-why div{flex:0 0 72%;scroll-snap-align:start;}
  .shop-form{grid-template-columns:1fr;}.shop-admin table{display:block;overflow-x:auto;}.shop-filters{grid-template-columns:1fr 1fr;}
  .cart-line{grid-template-columns:minmax(0,1fr) auto;}.cart-line .hide-sm{display:none;}}
`;

const TABS = [["home", "추천·검색"], ["malls", "제휴몰"], ["cart", "장바구니"], ["orders", "주문 내역"]];
const ICONS = { "교재": "📘", "문구·사무": "✏️", "수업 교구": "🧩", "미술·음악": "🎨", "체육·무도 용품": "🥋", "상장·기념품": "🏅", "단체복·굿즈": "🧥" };
const ORDER_TONE = { PENDING_APPROVAL: "warning", PENDING_PAYMENT: "primary", PAID: "primary", RECEIVED: "success", CANCELED: "gray" };
const MATCH_LABEL = { name: "상품명", tags: "태그", category: "분류", description: "설명" };
const MALL_CODES = ["edubooks", "munguland", "makerlab", "artnmusic", "sportsfarm", "prizeshop", "ddm"];
const EMPTY_FILTER = { min_price: "", max_price: "", quantity: "", fit: false, include_quote: true, sort: "relevance",
  discount_only: false, purchasable_only: false };
const EMPTY_FORM = { name: "", category: "교재", url: "", description: "", price: "", list_price: "", unit: "개", mall_code: "",
  image_url: "", tags: "", facility_types: "", min_quantity: 1, active: true };
const WHY = [
  ["수업에 맞춰 추천", "개설한 수업·학원 소개에서 과목을 찾아 그 과목 교재·교구를 먼저 보여 줘요."],
  ["재고와 연결", "안전 재고 아래로 떨어진 물품을 사는 곳을 바로 찾고, 받으면 재고에 자동 반영."],
  ["거래처 여러 곳, 결제 한 번", "서점·문구점·체육사를 따로 주문하지 않고 한 장바구니에서."],
  ["학원 회원가", "연결한 제휴몰은 추가 할인 · 일정 금액 이상 무료배송."],
  ["원장 승인", "직원은 결제 요청만, 돈이 나가는 결정은 원장이."],
];

function PriceBlock({ product }) {
  return (
    <div>
      {product.list_price ? <span className="shop-list">{won(product.list_price)}</span> : null}
      <span className="shop-price">{product.price_label}</span>
      {product.member_price ? <div className="shop-member">학원 회원가 {won(product.member_price)}</div> : null}
    </div>
  );
}

function QtyInput({ value, onChange, min = 1 }) {
  return (
    <span className="shop-qty">
      <button type="button" aria-label="수량 빼기" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input type="number" min={min} max={10000} value={value} aria-label="수량"
        onChange={(e) => onChange(Math.max(min, Math.min(10000, Number(e.target.value) || min)))} />
      <button type="button" aria-label="수량 더하기" onClick={() => onChange(Math.min(10000, value + 1))}>＋</button>
    </span>
  );
}

function ProductCard({ product, context, onAdd, onOpen }) {
  const [qty, setQty] = useState(product.min_quantity || 1);
  const color = product.mall?.color || "#64748B";
  return (
    <article className="shop-card">
      <div className="shop-thumb" style={{ background: `linear-gradient(135deg, ${color}22, var(--surface-2))` }}>
        {product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">{ICONS[product.category] || "🛍️"}</span>}
        {product.discount_rate > 0 && <span className="shop-off">-{product.discount_rate}%</span>}
        {product.mall && <span className="shop-mall">{product.mall.logo} {product.mall.name}</span>}
      </div>
      <div className="shop-body">
        <span className="shop-cat">{product.category}{product.min_quantity > 1 ? ` · 최소 ${product.min_quantity}${product.unit}` : ""}</span>
        <h3 className="shop-name">{product.name}</h3>
        <p className="shop-desc">{product.description}</p>
        {product.reasons?.length > 0 && (
          <ul className="shop-reasons" aria-label="추천 이유">
            {product.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {product.matched_in?.length > 0 && <span className="muted" style={{ fontSize: 11 }}>일치: {product.matched_in.map((m) => MATCH_LABEL[m] || m).join("·")}</span>}
      </div>
      <div className="shop-foot">
        <PriceBlock product={product} />
        {product.purchasable ? (
          <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
            <QtyInput value={qty} onChange={setQty} min={product.min_quantity || 1} />
            <button className="btn sm" type="button" onClick={() => onAdd(product, qty, context)}>담기</button>
          </div>
        ) : (
          <a className="btn ghost sm" href={product.url} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(product, context)}>
            {product.price ? "쇼핑몰에서 보기 ↗" : "견적 문의 ↗"}
          </a>
        )}
      </div>
    </article>
  );
}

export default function Shop() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === searchParams.get("tab")) ? searchParams.get("tab") : "home";
  const setTab = (next) => setSearchParams(next === "home" ? {} : { tab: next }, { replace: true });
  const [me, setMe] = useState(null);
  const [info, setInfo] = useState({ name: "DDM", base_url: "https://ddmmall77.com", categories: [] });
  const [recs, setRecs] = useState(null);
  const [malls, setMalls] = useState(null);
  const [category, setCategory] = useState("전체");
  const [mall, setMall] = useState(() => searchParams.get("mall") || "");
  const [query, setQuery] = useState(() => searchParams.get("q") || "");     // 재고 관리 → '쇼핑몰에서 찾기'
  const [debounced, setDebounced] = useState(query);
  const [personalize, setPersonalize] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cartCount, setCartCount] = useState(0);
  const [showWhy, setShowWhy] = useState(() => { try { return localStorage.getItem("shop_why_hidden") !== "1"; } catch { return true; } });
  const isOwner = me?.facility?.my_role === "owner";
  const facilityId = me?.facility?.facility_id;

  const flash = useCallback((text) => { setNotice(text); window.setTimeout(() => setNotice(""), 4500); }, []);
  const loadRecommendations = useCallback(() =>
    fetchShopRecommendations({ limit: 8 }).then(setRecs).catch((e) => setError(errorText(e, "추천을 불러오지 못했습니다."))), []);
  const loadMalls = useCallback(() => fetchShopMalls().then(setMalls).catch((e) => setError(errorText(e, "제휴몰을 불러오지 못했습니다."))), []);
  const runSearch = useCallback(() => {
    setSearching(true);
    const params = {
      q: debounced || undefined, category: category === "전체" ? undefined : category, mall: mall || undefined, personalize, sort: filter.sort,
      min_price: filter.min_price === "" ? undefined : Number(filter.min_price),
      max_price: filter.max_price === "" ? undefined : Number(filter.max_price),
      quantity: filter.quantity === "" ? undefined : Number(filter.quantity),
      fit: filter.fit ? "facility" : "all", include_quote: filter.include_quote,
      discount_only: filter.discount_only || undefined, purchasable_only: filter.purchasable_only || undefined,
    };
    return searchShopProducts(params)
      .then((d) => { setResults(d); setError(""); })
      .catch((e) => setError(errorText(e, "검색하지 못했습니다.")))
      .finally(() => setSearching(false));
  }, [debounced, category, mall, personalize, filter]);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => navigate("/"));
    fetchShopInfo().then(setInfo).catch(() => {});
    loadRecommendations();
    loadMalls();
  }, [navigate, loadRecommendations, loadMalls]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => { if (tab === "home") runSearch(); }, [tab, runSearch]);
  useEffect(() => {
    if (!facilityId) return undefined;
    const update = () => setCartCount(readCart(facilityId).length);
    update();
    window.addEventListener(CART_EVENT, update);
    return () => window.removeEventListener(CART_EVENT, update);
  }, [facilityId]);
  useDataRefresh(useCallback(() => { loadMalls(); loadRecommendations(); }, [loadMalls, loadRecommendations]));

  const handleAdd = (product, qty, context) => {
    if (!facilityId) return;
    addToCart(facilityId, { product_id: product.product_id, name: product.name, quantity: qty, min_quantity: product.min_quantity });
    logShopClick(product.product_id, context);
    flash(`장바구니에 담았습니다: ${product.name} ${qty}${product.unit}`);
  };
  const handleOpen = (product, context) => { logShopClick(product.product_id, context); };
  const toggleMall = async (m) => {
    try {
      if (m.connected) {
        if (!window.confirm(`${m.name} 연결을 해제할까요? 학원 회원가가 더 이상 적용되지 않습니다.`)) return;
        await disconnectShopMall(m.code);
        flash(`${m.name} 연결을 해제했습니다.`);
      } else {
        const res = await connectShopMall(m.code);
        flash(res.message);
      }
      loadMalls(); loadRecommendations();
    } catch (e) {
      setError(errorText(e, "제휴몰 연결을 바꾸지 못했습니다."));
    }
  };
  const hideWhy = () => { setShowWhy(false); try { localStorage.setItem("shop_why_hidden", "1"); } catch { /* 무시 */ } };

  const ctx = recs?.context;
  const categories = ["전체", ...(info.categories || [])];
  const mallChips = useMemo(() => [...(malls?.malls || []), ...(malls?.external ? [malls.external] : [])], [malls]);

  return (
    <div>
      <style>{SHOP_CSS}</style>
      <div className="shop-head">
        <div>
          <h1 className="page-title">학원 쇼핑몰</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>수업·재고에 맞춘 교재·소모품을 제휴몰 여러 곳에서 한 번에. <span className="badge warning no-dot">결제는 모의 결제</span></p>
        </div>
        <div className="actions">
          <button className="btn ghost sm" onClick={() => setTab("cart")}>🛒 장바구니 {cartCount ? <b>{cartCount}</b> : ""}</button>
          <button className="btn ghost sm" onClick={() => navigate("/b2b-shop")}>B2B 교재·물품 발주</button>
          {!showWhy && <button className="btn ghost sm" onClick={() => setShowWhy(true)}>왜 여기서 사나요?</button>}
        </div>
      </div>

      {showWhy && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <b style={{ fontSize: 13 }}>왜 학원 관리 프로그램 안에서 사나요?</b>
            <button className="btn ghost sm" onClick={hideWhy} aria-label="설명 접기">접기</button>
          </div>
          <div className="shop-why" aria-label="학원 쇼핑몰을 쓰는 이유">
            {WHY.map(([t, d]) => <div key={t}><b>{t}</b>{d}</div>)}
          </div>
        </div>
      )}

      {notice && <div className="fl-banner success" role="status" onClick={() => setNotice("")}>{notice}</div>}
      {error && <div className="fl-banner danger" onClick={() => setError("")}>{error}</div>}

      <div className="tabs">
        {TABS.map(([k, v]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {v}{k === "cart" && cartCount > 0 && <span className="count">{cartCount}</span>}
          </button>
        ))}
      </div>

      {tab === "home" && (
        <>
          <h2 className="shop-section-title">우리 학원 맞춤 추천</h2>
          {ctx && (
            <div className="shop-context" aria-label="추천에 사용한 학원 정보">
              {ctx.subjects.map((s) => <span className="shop-chip subject" key={s.subject} title={`과목 점수 ${s.score}`}>📘 {s.subject} · {s.evidence}</span>)}
              {!ctx.subjects.length && <span className="shop-chip">과목을 찾지 못했어요 — 수업을 등록하거나 설정에서 주요 과목을 고르세요</span>}
              {ctx.low_stock.slice(0, 4).map((i) => <span className="shop-chip low" key={i.item_id}>📦 재고 {i.status === "OUT" ? "품절" : "부족"} · {i.name}</span>)}
              {ctx.events.map((e) => <span className="shop-chip event" key={e.label}>{e.label} · {e.source}</span>)}
              <span className="shop-chip">활성 회원 {ctx.active_members}명</span>
            </div>
          )}
          <div className="shop-grid">
            {recs === null && <div className="fl-skeleton" style={{ height: 260, gridColumn: "1/-1" }} />}
            {recs?.items.map((p) => <ProductCard key={p.product_id} product={p} context="recommendation" onAdd={handleAdd} onOpen={handleOpen} />)}
            {recs && !recs.items.length && <div className="empty">추천할 상품이 없습니다.</div>}
          </div>
          {recs?.definition && <p className="shop-section-sub" style={{ marginTop: 8 }}>ⓘ 추천 점수: {recs.definition}</p>}

          <h2 className="shop-section-title">상품 검색</h2>
          <p className="shop-section-sub">여러 단어는 모두 포함된 상품만 찾고(예: “수학 초등”), 비슷한 말도 함께 찾습니다(도복→태권도, 메달→매달).</p>
          <form className="shop-searchbar" role="search" onSubmit={(e) => { e.preventDefault(); setDebounced(query.trim()); }}>
            <input className="input" placeholder="상품명·과목·용도 검색 (예: 파닉스, 복사지, 대회 메달)" value={query} maxLength={100}
              onChange={(e) => setQuery(e.target.value)} aria-label="상품 검색" />
            <button type="button" className={`shop-toggle${personalize ? " on" : ""}`} aria-pressed={personalize} onClick={() => setPersonalize((v) => !v)}
              title="우리 학원 과목·재고·공지 행사·연결한 제휴몰·최근 조회로 순서를 맞춥니다">🎯 맞춤 검색</button>
            <button type="button" className={`shop-toggle${filter.discount_only ? " on" : ""}`} aria-pressed={filter.discount_only}
              onClick={() => setFilter((f) => ({ ...f, discount_only: !f.discount_only }))}>🏷 할인 상품만</button>
            <button type="button" className={`shop-toggle${filtersOpen ? " on" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>⚙ 상세 조건</button>
          </form>
          {filtersOpen && (
            <div className="shop-filters">
              <label>최저 가격(원)<input className="input" type="number" min="0" value={filter.min_price} onChange={(e) => setFilter({ ...filter, min_price: e.target.value })} placeholder="0" /></label>
              <label>최고 가격(원)<input className="input" type="number" min="0" value={filter.max_price} onChange={(e) => setFilter({ ...filter, max_price: e.target.value })} placeholder="제한 없음" /></label>
              <label>단체 인원(명)<input className="input" type="number" min="1" value={filter.quantity} onChange={(e) => setFilter({ ...filter, quantity: e.target.value })} placeholder="예: 30" /></label>
              <label>정렬<select className="select" value={filter.sort} onChange={(e) => setFilter({ ...filter, sort: e.target.value })}>
                <option value="relevance">{personalize ? "맞춤·일치순" : "일치순"}</option><option value="discount">할인율 높은 순</option>
                <option value="popular">많이 본 순</option><option value="price_asc">낮은 가격순</option><option value="price_desc">높은 가격순</option><option value="name">이름순</option>
              </select></label>
              <span className="check"><input type="checkbox" id="f-buy" checked={filter.purchasable_only} onChange={(e) => setFilter({ ...filter, purchasable_only: e.target.checked })} /><label htmlFor="f-buy" style={{ display: "inline" }}>바로 주문 가능한 상품만</label></span>
              <span className="check"><input type="checkbox" id="f-quote" checked={filter.include_quote} onChange={(e) => setFilter({ ...filter, include_quote: e.target.checked })} /><label htmlFor="f-quote" style={{ display: "inline" }}>견적 문의 상품 포함</label></span>
              <span className="check"><input type="checkbox" id="f-fit" checked={filter.fit} onChange={(e) => setFilter({ ...filter, fit: e.target.checked })} /><label htmlFor="f-fit" style={{ display: "inline" }}>우리 학원 종류 전용 상품만</label></span>
              <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setFilter(EMPTY_FILTER)}>조건 초기화</button>
            </div>
          )}
          <div className="shop-cats" role="group" aria-label="제휴몰">
            <button type="button" className={!mall ? "active" : ""} onClick={() => setMall("")}>모든 제휴몰</button>
            {mallChips.map((m) => (
              <button key={m.code} type="button" className={mall === m.code ? "active" : ""} onClick={() => setMall(m.code)}>
                {m.logo} {m.name}{m.connected ? " ✓" : ""}
              </button>
            ))}
          </div>
          <div className="shop-cats" role="group" aria-label="상품 분류" style={{ marginTop: 0 }}>
            {categories.map((c) => <button key={c} type="button" className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}
          </div>
          {results?.suggestions?.length > 0 && (
            <div className="shop-suggest" aria-label="추천 검색어">
              추천 검색어 {results.suggestions.slice(0, 8).map((w) => <button key={w} type="button" onClick={() => { setQuery(w); setDebounced(w); }}>{w}</button>)}
            </div>
          )}
          <p className="shop-section-sub">{searching ? "검색 중…" : results ? `${results.total}개 상품${debounced ? ` · “${debounced}”` : ""}` : ""}</p>
          <div className="shop-grid">
            {(results?.items || []).map((p) => <ProductCard key={p.product_id} product={p} context="search" onAdd={handleAdd} onOpen={handleOpen} />)}
            {results && !results.items.length && <div className="empty">조건에 맞는 상품이 없습니다. 검색어나 조건을 바꿔 보세요.</div>}
          </div>
          {me?.is_platform_admin && <AdminProducts info={info} onChanged={() => { loadRecommendations(); runSearch(); }} setError={setError} flash={flash} />}
        </>
      )}

      {tab === "malls" && (
        <MallsTab data={malls} isOwner={isOwner} onToggle={toggleMall}
          onBrowse={(code) => { setMall(code); setTab("home"); }} />
      )}
      {tab === "cart" && facilityId && (
        <CartTab facilityId={facilityId} isOwner={isOwner} setError={setError} flash={flash}
          onOrdered={() => setTab("orders")} onBrowse={() => setTab("home")} />
      )}
      {tab === "orders" && <OrdersTab isOwner={isOwner} setError={setError} flash={flash} />}
    </div>
  );
}

function MallsTab({ data, isOwner, onToggle, onBrowse }) {
  if (!data) return <div className="fl-skeleton" style={{ height: 260, marginTop: 14 }} />;
  const ext = data.external;
  return (
    <>
      <p className="shop-section-sub" style={{ marginTop: 14 }}>
        우리 학원 과목: {data.subjects.length ? data.subjects.map((s) => <b key={s.subject} title={s.evidence}>{s.subject} </b>) : "아직 없음"} · {data.definition}.
        {isOwner ? " ‘연결’하면 학원 회원가가 추가로 적용됩니다." : " 제휴몰 연결은 원장이 합니다."}
      </p>
      <div className="mall-grid">
        {data.malls.map((m) => (
          <div key={m.code} className={`mall-card${m.connected ? " connected" : ""}`}>
            <div className="mall-top">
              <div className="mall-logo" style={{ background: `${m.color}22` }}>{m.logo}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 15 }}>{m.name}</b>
                  {m.connected && <span className="badge success no-dot">연결됨</span>}
                  {m.recommended && !m.connected && <span className="badge primary no-dot">추천</span>}
                  <span className="badge gray no-dot">가상 제휴몰</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{m.tagline}</div>
              </div>
            </div>
            {m.reasons.length > 0 && <ul className="shop-reasons">{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            <div className="mall-meta">
              <span>학원 회원가 <b>{m.member_rate_label ? `-${m.member_rate_label}` : "없음"}</b></span>
              <span>배송 <b>{m.delivery_days}일</b></span>
              <span>배송비 <b>{won(m.shipping_fee)}</b></span>
              <span><b>{won(m.free_shipping_over)}</b> 이상 무료</span>
              <span>상품 <b>{m.product_count}개</b></span>
              <span>우리 학원 구매 <b>{m.orders.count}회</b>{m.orders.saved ? ` · ${won(m.orders.saved)} 절약` : ""}</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button className="btn ghost sm" onClick={() => onBrowse(m.code)}>상품 보기</button>
              {isOwner && <button className={`btn sm${m.connected ? " ghost" : ""}`} style={{ marginLeft: "auto" }} onClick={() => onToggle(m)}>
                {m.connected ? "연결 해제" : "연결하기"}</button>}
            </div>
          </div>
        ))}
        {ext && (
          <div className="mall-card">
            <div className="mall-top">
              <div className="mall-logo" style={{ background: `${ext.color}22` }}>{ext.logo}</div>
              <div><b style={{ fontSize: 15 }}>{ext.name}</b> <span className="badge gray no-dot">외부 쇼핑몰</span>
                <div className="muted" style={{ fontSize: 12 }}>{ext.tagline}</div></div>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>주문 제작 상품이라 견적·주문은 해당 사이트에서 진행합니다.</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn ghost sm" onClick={() => onBrowse(ext.code)}>상품 보기</button>
              <a className="btn ghost sm" href={ext.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto" }}>사이트 열기 ↗</a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function CartTab({ facilityId, isOwner, setError, flash, onOrdered, onBrowse }) {
  const [items, setItems] = useState(() => readCart(facilityId));
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(null);

  useEffect(() => {
    const update = () => setItems(readCart(facilityId));
    window.addEventListener(CART_EVENT, update);
    return () => window.removeEventListener(CART_EVENT, update);
  }, [facilityId]);
  useEffect(() => {
    if (!items.length) { setQuote(null); setQuoteError(""); return undefined; }
    const timer = window.setTimeout(() => {
      quoteShopCart(items.map(({ product_id, quantity, inventory_item_id }) => ({ product_id, quantity, inventory_item_id })))
        .then((q) => { setQuote(q); setQuoteError(""); })
        .catch((e) => { setQuote(null); setQuoteError(errorText(e, "금액을 계산하지 못했습니다.")); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [items]);

  const setQty = (productId, quantity) => writeCart(facilityId, items.map((i) => (i.product_id === productId ? { ...i, quantity } : i)));
  const remove = (productId) => writeCart(facilityId, items.filter((i) => i.product_id !== productId));
  const inventoryOf = (productId) => items.find((i) => i.product_id === productId)?.inventory_item_id;

  const order = async () => {
    if (!quote || busy) return;
    setBusy(true); setError("");
    try {
      const created = await createShopOrder(items.map(({ product_id, quantity, inventory_item_id }) => ({ product_id, quantity, inventory_item_id })), memo);
      clearCart(facilityId);
      setMemo("");
      if (isOwner) setPaying(created);
      else { flash(`원장에게 결제를 요청했습니다 (${created.order_number}, ${won(created.total)}).`); onOrdered(); }
    } catch (e) {
      setError(errorText(e, "주문하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  if (!items.length && !paying) {
    return <div className="empty" style={{ marginTop: 16 }}>장바구니가 비어 있습니다. <button className="btn ghost sm" onClick={onBrowse}>상품 보러 가기</button></div>;
  }
  return (
    <div className="cart-layout" style={{ marginTop: 14 }}>
      <div>
        {quoteError && <div className="fl-banner danger">{quoteError} <button className="btn ghost sm" onClick={() => clearCart(facilityId)}>장바구니 비우기</button></div>}
        {quote?.groups.map((g) => (
          <div key={g.mall.code} className="cart-group">
            <div className="cart-group-head">
              <b>{g.mall.logo} {g.mall.name}</b>
              {g.connected ? <span className="badge success no-dot">학원 회원가 -{Math.round(g.member_rate * 100)}%</span> : <span className="muted">연결하면 회원가 할인</span>}
              <span className="muted" style={{ marginLeft: "auto" }}>
                {g.shipping_fee ? `배송비 ${won(g.shipping_fee)} · ${won(g.free_shipping_left)} 더 담으면 무료배송` : "무료배송"}
              </span>
            </div>
            {g.items.map((it) => (
              <div key={it.product_id} className="cart-line">
                <div style={{ minWidth: 0 }}>
                  <b>{it.name}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {it.list_price > it.unit_price && <span className="shop-list">{won(it.list_price)}</span>}
                    {won(it.unit_price)} / {it.unit}{it.discount_rate ? ` · ${it.discount_rate}% 할인` : ""}
                    {inventoryOf(it.product_id) ? " · 📦 입고 시 재고 반영" : ""}
                  </div>
                </div>
                <QtyInput value={it.quantity} onChange={(q) => setQty(it.product_id, q)} />
                <b className="hide-sm" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{won(it.line_total)}</b>
                <button className="btn ghost sm" aria-label={`${it.name} 빼기`} onClick={() => remove(it.product_id)}>✕</button>
              </div>
            ))}
            <div className="cart-foot"><span>상품 {won(g.subtotal)} + 배송 {won(g.shipping_fee)}</span><b>{won(g.total)}</b></div>
          </div>
        ))}
        {!quote && !quoteError && items.length > 0 && <div className="fl-skeleton" style={{ height: 160 }} />}
      </div>
      <div className="card cart-sum">
        <h3 style={{ margin: 0 }}>결제 금액</h3>
        {quote ? (
          <>
            <div className="cs"><span>정가 합계</span><b>{won(quote.list_total)}</b></div>
            <div className="cs"><span>상품 할인</span><b className="saved">−{won(quote.product_discount)}</b></div>
            <div className="cs"><span>학원 회원가 할인</span><b className="saved">−{won(quote.member_discount)}</b></div>
            <div className="cs"><span>배송비</span><b>{won(quote.shipping_fee)}</b></div>
            <div className="cs total"><span>결제 금액</span><span>{won(quote.total)}</span></div>
            {quote.saved > 0 && <div className="cs"><span>아낀 금액</span><b className="saved">{won(quote.saved)}</b></div>}
          </>
        ) : <span className="muted">{items.length ? "금액 계산 중…" : "주문서를 만들었습니다."}</span>}
        <label className="muted" style={{ fontSize: 12 }}>메모 (선택)
          <input className="input" value={memo} maxLength={300} onChange={(e) => setMemo(e.target.value)} placeholder="예: 3월 신학기 교재" /></label>
        <button className="btn" disabled={!quote || busy} onClick={order}>
          {busy ? "처리 중…" : isOwner ? "주문하고 결제하기" : "원장에게 결제 요청"}
        </button>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {isOwner ? "모의 결제입니다 — 실제로 돈이 나가지 않습니다." : "원장이 승인·결제하면 알림이 갑니다."} 금액은 서버가 상품 가격으로 다시 계산합니다.
        </span>
      </div>
      {paying && <PayModal order={paying} onClose={() => { setPaying(null); onOrdered(); }}
        onPaid={(o) => { flash(`결제 완료 (모의) · ${o.order_number} · 승인번호 ${o.payment_tid}`); }} />}
    </div>
  );
}

const PAY_METHODS = [["CARD", "💳 법인카드"], ["KAKAOPAY", "🟡 카카오페이"], ["NAVERPAY", "🟢 네이버페이"], ["TRANSFER", "🏦 계좌이체"]];

function PayModal({ order, onClose, onPaid }) {
  const [method, setMethod] = useState("CARD");
  const [stage, setStage] = useState("select");      // select → processing → done
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const pay = async () => {
    setStage("processing"); setErr("");
    try {
      await new Promise((r) => window.setTimeout(r, 900));          // 결제창 느낌만 (실제 PG 호출 없음)
      const paid = await payShopOrder(order.order_id, method, order.total);
      setResult(paid); setStage("done"); onPaid(paid);
    } catch (e) {
      setErr(errorText(e, "결제하지 못했습니다.")); setStage("select");
    }
  };
  return (
    <div className="modal-backdrop" onClick={stage === "processing" ? undefined : onClose}>
      <div className="modal" style={{ width: "min(420px,100%)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="모의 결제">
        <h3 style={{ marginBottom: 6 }}>결제하기 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{order.order_number}</span></h3>
        <div className="pay-mock">모의 결제 화면입니다 — 실제 결제 대행사로 연결되지 않으며 돈이 나가지 않습니다.</div>
        {err && <div className="fl-banner danger" style={{ marginTop: 8 }}>{err}</div>}
        {stage !== "done" && <div className="pay-amount">{won(order.total)}</div>}
        {stage === "select" && (
          <>
            <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>상품 {order.item_count}종 · 아낀 금액 {won(order.saved)} · 배송비 {won(order.shipping_fee)}</div>
            <div className="pay-methods" role="radiogroup" aria-label="결제 수단">
              {PAY_METHODS.map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={method === k} className={method === k ? "on" : ""} onClick={() => setMethod(k)}>{v}</button>)}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>나중에 결제</button>
              <button className="btn" onClick={pay}>{won(order.total)} 결제</button>
            </div>
          </>
        )}
        {stage === "processing" && <><div className="pay-spin" aria-hidden="true" /><p className="muted" style={{ textAlign: "center" }}>결제 승인 중…</p></>}
        {stage === "done" && result && (
          <div style={{ textAlign: "center", display: "grid", gap: 6, marginTop: 12 }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <b style={{ fontSize: 17 }}>결제가 완료되었습니다 (모의)</b>
            <span className="muted">{result.payment_method_label} · 승인번호 {result.payment_tid}</span>
            <span className="muted">물건이 도착하면 주문 내역에서 ‘입고 처리’를 누르면 재고에 반영됩니다.</span>
            <div className="modal-actions"><button className="btn" onClick={onClose}>주문 내역 보기</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrdersTab({ isOwner, setError, flash }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("");
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetchShopOrders({ status: status || undefined }).then(setData)
    .catch((e) => setError(errorText(e, "주문 내역을 불러오지 못했습니다."))), [status, setError]);
  useEffect(() => { load(); }, [load]);
  useDataRefresh(load);

  const act = async (task, done) => {
    if (busy) return;
    setBusy(true);
    try { const res = await task(); flash(typeof done === "function" ? done(res) : done); load(); }
    catch (e) { setError(errorText(e, "처리하지 못했습니다.")); }
    finally { setBusy(false); }
  };
  const receive = (o) => act(() => receiveShopOrder(o.order_id), (res) => (res.inventory_applied.length
    ? `입고 완료 · 재고 반영: ${res.inventory_applied.map((i) => `${i.name} +${i.added}${i.unit}(현재 ${i.quantity})`).join(", ")}`
    : "입고 완료 · 연결된 재고 물품이 없어 수량은 바뀌지 않았습니다 (재고 관리에서 쇼핑몰 상품을 연결하면 자동 반영)"));
  const cancel = (o) => {
    const reason = window.prompt(o.status === "PAID" ? "취소 사유 (결제 완료 주문 → 모의 환불)" : "취소 사유 (선택)", "");
    if (reason === null) return;
    act(() => cancelShopOrder(o.order_id, reason), (res) => (res.refunded ? `주문을 취소하고 ${won(res.total)}을 모의 환불했습니다.` : "주문을 취소했습니다."));
  };

  if (!data) return <div className="fl-skeleton" style={{ height: 240, marginTop: 14 }} />;
  const s = data.summary;
  return (
    <>
      <div className="stat-grid" style={{ margin: "14px 0" }}>
        <div className="stat-card"><div className="stat-card-head"><span className="stat-label" title={data.definitions.month_spent}>이번 달 구매</span></div>
          <div className="stat-value num">{won(s.month_spent)}</div><div className="stat-sub">{s.month_orders}건 결제</div></div>
        <div className="stat-card"><div className="stat-card-head"><span className="stat-label" title={data.definitions.month_saved}>이번 달 아낀 금액</span></div>
          <div className="stat-value num" style={{ color: "#DC2626" }}>{won(s.month_saved)}</div><div className="stat-sub">상품 할인 + 학원 회원가</div></div>
        <div className="stat-card"><div className="stat-card-head"><span className="stat-label">결제 대기</span></div>
          <div className="stat-value num">{s.pending_approval + s.pending_payment}<span className="unit">건</span></div>
          <div className="stat-sub">직원 요청 {s.pending_approval}건</div></div>
        <div className="stat-card"><div className="stat-card-head"><span className="stat-label">입고 대기</span></div>
          <div className="stat-value num">{s.to_receive}<span className="unit">건</span></div><div className="stat-sub">도착하면 입고 처리</div></div>
      </div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="주문 상태">
          <option value="">전체</option><option value="PENDING_APPROVAL">원장 승인 대기</option><option value="PENDING_PAYMENT">결제 대기</option>
          <option value="PAID">결제 완료(배송 준비)</option><option value="RECEIVED">입고 완료</option><option value="CANCELED">취소</option>
        </select>
      </div>
      {data.orders.map((o) => (
        <div key={o.order_id} className="order-card">
          <div className="order-head">
            <b>{o.order_number}</b>
            <span className={`badge ${ORDER_TONE[o.status]} no-dot`}>{o.status_label}</span>
            <span className="muted" style={{ fontSize: 12 }}>{o.created_at?.replace("T", " ").slice(0, 16)} · {o.ordered_by || "관리자"}</span>
            <b style={{ marginLeft: "auto", fontSize: 16 }}>{won(o.total)}</b>
          </div>
          <div className="order-items">
            {o.groups.map((g) => (
              <div key={g.mall.code}>{g.mall.logo} <b>{g.mall.name}</b> — {g.items.map((it) => `${it.name} ×${it.quantity}`).join(", ")}</div>
            ))}
            <div>정가 {won(o.list_total)} · 할인 −{won(o.saved)} · 배송비 {won(o.shipping_fee)}
              {o.payment_tid ? ` · ${o.payment_method_label} 승인번호 ${o.payment_tid} (모의)` : ""}{o.memo ? ` · 메모: ${o.memo}` : ""}
              {o.cancel_reason ? ` · 취소: ${o.cancel_reason}` : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {isOwner && ["PENDING_APPROVAL", "PENDING_PAYMENT"].includes(o.status) && <button className="btn sm" disabled={busy} onClick={() => setPaying(o)}>
              {o.status === "PENDING_APPROVAL" ? "승인하고 결제" : "결제하기"}</button>}
            {o.status === "PAID" && <button className="btn sm" disabled={busy} onClick={() => receive(o)}>📦 입고 처리</button>}
            {["PENDING_APPROVAL", "PENDING_PAYMENT", "PAID"].includes(o.status) && (isOwner || o.status === "PENDING_APPROVAL") &&
              <button className="btn ghost sm" disabled={busy} onClick={() => cancel(o)}>{o.status === "PAID" ? "취소·환불" : "취소"}</button>}
          </div>
        </div>
      ))}
      {!data.orders.length && <div className="empty">주문 내역이 없습니다.</div>}
      {paying && <PayModal order={paying} onClose={() => { setPaying(null); load(); }} onPaid={(o) => flash(`결제 완료 (모의) · ${o.order_number}`)} />}
    </>
  );
}

function AdminProducts({ info, onChanged, setError, flash }) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const load = useCallback(() => fetchShopProducts({ include_inactive: true }).then(setProducts)
    .catch((e) => setError(errorText(e, "상품을 불러오지 못했습니다."))), [setError]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form, price: form.price ? Number(form.price) : null, list_price: form.list_price ? Number(form.list_price) : null,
      min_quantity: Number(form.min_quantity) || 1, mall_code: form.mall_code || null };
    try {
      if (editingId) await updateShopProduct(editingId, payload); else await createShopProduct(payload);
      flash(editingId ? "상품을 수정했습니다." : "상품을 추가했습니다.");
      setForm(EMPTY_FORM); setEditingId(null); load(); onChanged();
    } catch (err) {
      setError(errorText(err, "상품을 저장하지 못했습니다."));
    }
  };
  const startEdit = (p) => {
    setEditingId(p.product_id);
    setForm({ name: p.name, category: p.category, url: p.external_link ? p.url.split("?")[0] : "", description: p.description,
      price: p.price || "", list_price: p.list_price || "", unit: p.unit || "개", mall_code: p.mall?.code === "etc" ? "" : p.mall?.code || "",
      image_url: p.image_url || "", tags: p.tags.join(","), facility_types: p.facility_types.join(","), min_quantity: p.min_quantity, active: p.active });
  };
  const deactivate = async (p) => {
    if (!window.confirm(`${p.name} 상품을 판매 중지할까요? (클릭·주문 기록은 보존)`)) return;
    try { await deactivateShopProduct(p.product_id); load(); onChanged(); } catch (e) { setError(errorText(e, "판매 중지하지 못했습니다.")); }
  };
  const sync = async () => {
    try { const r = await syncShopProducts(); flash(`쇼핑몰 상품 피드 동기화: 신규 ${r.created}건, 갱신 ${r.updated}건`); load(); onChanged(); }
    catch (err) { setError(errorText(err, "동기화하지 못했습니다.")); }
  };
  if (!open) return <div style={{ marginTop: 22 }}><button className="btn ghost sm" onClick={() => setOpen(true)}>🛠 상품 카탈로그 관리 (플랫폼 운영자)</button></div>;
  return (
    <section className="card shop-admin">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>상품 카탈로그 관리</h3>
          <span className="muted" style={{ fontSize: 12 }}>모든 학원이 함께 보는 목록이라 플랫폼 운영자만 바꿀 수 있습니다. 태그의 과목 이름(수학·영어…)이 추천에 쓰입니다.</span>
        </div>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost sm" onClick={sync}>외부 쇼핑몰 피드 동기화</button>
          <button className="btn ghost sm" onClick={() => setOpen(false)}>닫기</button>
        </span>
      </div>
      <form className="shop-form" onSubmit={submit}>
        <label className="wide">상품명<input className="input" required value={form.name} onChange={set("name")} /></label>
        <label>분류<select className="select" value={form.category} onChange={set("category")}>{(info.categories || []).map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>제휴몰<select className="select" value={form.mall_code} onChange={set("mall_code")}>
          <option value="">직접 등록(외부 링크)</option>
          {MALL_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select></label>
        <label>단위<input className="input" value={form.unit} onChange={set("unit")} maxLength={20} /></label>
        <label>판매가(원, 비우면 견적 문의)<input className="input" type="number" min="0" value={form.price} onChange={set("price")} /></label>
        <label>정가(원, 할인 표시용)<input className="input" type="number" min="0" value={form.list_price} onChange={set("list_price")} /></label>
        <label>최소 수량<input className="input" type="number" min="1" value={form.min_quantity} onChange={set("min_quantity")} /></label>
        <label className="wide">상품 URL (외부 상품만 — 제휴몰 상품은 비워 두면 앱 안 주소)<input className="input" value={form.url} onChange={set("url")} /></label>
        <label className="wide">설명<input className="input" value={form.description} onChange={set("description")} /></label>
        <label>태그(콤마)<input className="input" placeholder="수학,교재,중등" value={form.tags} onChange={set("tags")} /></label>
        <label>학원 종류 전용(콤마, 비우면 전체)<input className="input" placeholder="도장,체육관" value={form.facility_types} onChange={set("facility_types")} /></label>
        <label>이미지 URL(선택)<input className="input" value={form.image_url} onChange={set("image_url")} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.active} onChange={set("active")} /> 판매 중</label>
        <div className="wide" style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="submit">{editingId ? "수정 저장" : "상품 추가"}</button>
          {editingId && <button className="btn ghost" type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>취소</button>}
        </div>
      </form>
      <table style={{ marginTop: 16 }}>
        <thead><tr><th>상품</th><th>제휴몰</th><th>분류</th><th>가격</th><th>상태</th><th /></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.product_id}>
              <td>{p.name}</td><td>{p.mall?.name}</td><td>{p.category}</td>
              <td>{p.price_label}{p.discount_rate ? ` (-${p.discount_rate}%)` : ""}</td>
              <td>{p.active ? <span className="badge success">판매</span> : <span className="badge">중지</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn ghost sm" onClick={() => startEdit(p)}>수정</button>{" "}
                {p.active && <button className="btn danger sm" onClick={() => deactivate(p)}>중지</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

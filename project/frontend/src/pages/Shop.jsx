import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createShopProduct, deactivateShopProduct, fetchMe, fetchShopInfo, fetchShopProducts,
  fetchShopRecommendations, logShopClick, syncShopProducts, updateShopProduct,
} from "../api";

/* =====================================================================
   쇼핑몰 (외부: DDM ddmmall77.com) — 관리자/직원
   - 추천: 서버가 시설 유형·회원 규모·공지/수업의 행사 키워드·클릭 이력으로 점수화(rule_based_v1)
   - 상품 링크는 새 탭으로 쇼핑몰에 연결(주문·결제는 쇼핑몰에서), 클릭은 동작 로그로 저장
===================================================================== */

const SHOP_CSS = `
.shop-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px;}
.shop-head .actions{display:flex;gap:8px;flex-wrap:wrap;}
.shop-context{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;}
.shop-chip{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);}
.shop-chip.event{background:var(--warning-soft);border-color:transparent;color:var(--warning-text);}
.shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;}
.shop-card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;transition:border-color .15s,box-shadow .15s;}
.shop-card:hover{border-color:var(--primary);box-shadow:var(--shadow);}
.shop-thumb{height:120px;background:linear-gradient(135deg,var(--primary-soft),var(--surface-2));display:flex;align-items:center;justify-content:center;font-size:40px;}
.shop-thumb img{width:100%;height:100%;object-fit:cover;}
.shop-body{padding:14px 16px;display:flex;flex-direction:column;gap:6px;flex:1;}
.shop-cat{font-size:11px;font-weight:700;color:var(--primary-text);}
.shop-name{font-size:15px;font-weight:700;margin:0;}
.shop-desc{font-size:12px;color:var(--text-2);margin:0;line-height:1.55;}
.shop-reasons{margin:4px 0 0;padding:0;list-style:none;display:grid;gap:3px;}
.shop-reasons li{font-size:11px;color:var(--text-2);padding-left:14px;position:relative;line-height:1.5;}
.shop-reasons li:before{content:"✓";position:absolute;left:0;color:var(--success);font-weight:700;}
.shop-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;border-top:1px solid var(--border);}
.shop-price{font-weight:700;font-size:14px;}
.shop-score{font-size:11px;color:var(--text-3);}
.shop-cats{display:flex;gap:6px;flex-wrap:wrap;margin:22px 0 12px;}
.shop-cats button{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--text-2);}
.shop-cats button.active{background:var(--primary);border-color:var(--primary);color:#fff;}
.shop-section-title{font-size:16px;font-weight:700;margin:26px 0 4px;}
.shop-section-sub{font-size:12px;color:var(--text-3);margin:0 0 12px;}
.shop-admin{margin-top:26px;}
.shop-admin table{width:100%;border-collapse:collapse;font-size:12px;}
.shop-admin th,.shop-admin td{text-align:left;padding:8px;border-bottom:1px solid var(--border);vertical-align:top;}
.shop-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.shop-form .wide{grid-column:1/-1;}
.shop-form label{display:grid;gap:4px;font-size:12px;color:var(--text-2);}
@media(max-width:640px){.shop-form{grid-template-columns:1fr;}.shop-admin table{display:block;overflow-x:auto;}}
`;

const ICONS = { "야구점퍼": "🧥", "키링": "🔑", "태권도 용품": "🥋", "매달": "🏅", "기타굿즈": "🎁", "단체주문": "📋" };
const EMPTY_FORM = { name: "", category: "기타굿즈", url: "", description: "", price: "", image_url: "", tags: "", facility_types: "", min_quantity: 1, active: true };

function ProductCard({ product, context, onOpen }) {
  return (
    <article className="shop-card">
      <div className="shop-thumb">
        {product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">{ICONS[product.category] || "🛍️"}</span>}
      </div>
      <div className="shop-body">
        <span className="shop-cat">{product.category}</span>
        <h3 className="shop-name">{product.name}</h3>
        <p className="shop-desc">{product.description}</p>
        {product.reasons && (
          <ul className="shop-reasons" aria-label="추천 이유">
            {product.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </div>
      <div className="shop-foot">
        <div>
          <div className="shop-price">{product.price_label}</div>
          {product.score != null && <div className="shop-score">추천 점수 {product.score}</div>}
        </div>
        <a className="btn sm" href={product.url} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(product, context)}>
          쇼핑몰에서 보기 ↗
        </a>
      </div>
    </article>
  );
}

export default function Shop() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [info, setInfo] = useState({ name: "DDM", base_url: "https://ddmmall77.com", categories: [] });
  const [recs, setRecs] = useState(null);
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const isOwner = me?.admin?.role === "owner";

  const loadRecommendations = () =>
    fetchShopRecommendations({ limit: 6 }).then(setRecs).catch((e) => setError(e.response?.data?.detail || "추천을 불러오지 못했습니다."));
  const loadProducts = () =>
    fetchShopProducts({ include_inactive: showAdmin }).then(setProducts).catch((e) => setError(e.response?.data?.detail || "상품을 불러오지 못했습니다."));

  useEffect(() => {
    fetchMe().then(setMe).catch(() => navigate("/"));
    fetchShopInfo().then(setInfo).catch(() => {});
    loadRecommendations();
  }, [navigate]);

  useEffect(() => { loadProducts(); }, [showAdmin]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => p.active
      && (category === "전체" || p.category === category)
      && (!q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))));
  }, [products, category, query]);

  const ctx = recs?.context;
  const categories = ["전체", ...(info.categories || [])];

  const handleOpen = (product, context) => { logShopClick(product.product_id, context); };

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { ...form, price: form.price ? Number(form.price) : null, min_quantity: Number(form.min_quantity) || 1 };
    try {
      if (editingId) await updateShopProduct(editingId, payload);
      else await createShopProduct(payload);
      setNotice(editingId ? "상품을 수정했습니다." : "상품을 추가했습니다.");
      setForm(EMPTY_FORM);
      setEditingId(null);
      loadProducts();
      loadRecommendations();
    } catch (err) {
      setError(err.response?.data?.detail || "상품을 저장하지 못했습니다.");
    }
  };

  const startEdit = (p) => {
    setEditingId(p.product_id);
    setForm({
      name: p.name, category: p.category, url: p.url.split("?")[0] + (p.url.includes("#") ? `#${p.url.split("#")[1]}` : ""),
      description: p.description, price: p.price || "", image_url: p.image_url || "", tags: p.tags.join(","),
      facility_types: p.facility_types.join(","), min_quantity: p.min_quantity, active: p.active,
    });
  };

  const deactivate = async (p) => {
    if (!window.confirm(`${p.name} 상품을 비활성화할까요? (클릭 기록은 보존됩니다)`)) return;
    await deactivateShopProduct(p.product_id).catch(() => setError("비활성화하지 못했습니다."));
    loadProducts();
    loadRecommendations();
  };

  const sync = async () => {
    setError("");
    try {
      const result = await syncShopProducts();
      setNotice(`쇼핑몰 상품 피드 동기화: 신규 ${result.created}건, 갱신 ${result.updated}건`);
      loadProducts();
      loadRecommendations();
    } catch (err) {
      setError(err.response?.data?.detail || "동기화하지 못했습니다.");
    }
  };

  return (
    <div>
      <style>{SHOP_CSS}</style>
      <div className="shop-head">
        <div>
          <h1 className="page-title">쇼핑몰 · {info.name}</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            주문·결제는 <a href={info.base_url} target="_blank" rel="noopener noreferrer">{info.base_url.replace(/^https?:\/\//, "")}</a>
          </p>
        </div>
        <div className="actions">
          <a className="btn ghost sm" href={`${info.base_url}/inquiry.html`} target="_blank" rel="noopener noreferrer">단체 견적 문의 ↗</a>
          <button className="btn ghost sm" onClick={() => navigate("/b2b-shop")}>B2B 교재·물품 발주</button>
          {isOwner && <button className="btn ghost sm" onClick={() => setShowAdmin((v) => !v)}>{showAdmin ? "상품 관리 닫기" : "상품 관리"}</button>}
        </div>
      </div>

      {notice && <div className="error-banner" style={{ background: "var(--success-soft)", color: "var(--success-text)" }} onClick={() => setNotice("")}>{notice}</div>}
      {error && <div className="error-banner" onClick={() => setError("")}>{error}</div>}

      <h2 className="shop-section-title">우리 시설 맞춤 추천</h2>
      {ctx && (
        <div className="shop-context" aria-label="추천에 사용한 시설 정보">
          <span className="shop-chip">시설 유형: {ctx.facility_type}</span>
          <span className="shop-chip">활성 회원 {ctx.active_members}명</span>
          <span className="shop-chip">최대 반 인원 {ctx.largest_class}명</span>
          {ctx.events.map((e) => <span className="shop-chip event" key={e.label}>{e.label} · {e.source}</span>)}
        </div>
      )}
      <div className="shop-grid">
        {recs === null && <div className="empty">추천을 계산하는 중…</div>}
        {recs?.items.map((p) => <ProductCard key={p.product_id} product={p} context="recommendation" onOpen={handleOpen} />)}
        {recs && !recs.items.length && <div className="empty">추천할 상품이 없습니다.</div>}
      </div>

      <h2 className="shop-section-title">전체 상품</h2>
      <div className="shop-cats" role="group" aria-label="상품 분류">
        {categories.map((c) => <button key={c} type="button" className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}
        <input className="input" style={{ marginLeft: "auto", width: "min(240px,100%)" }} placeholder="상품명·태그 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="상품 검색" />
      </div>
      <div className="shop-grid">
        {visibleProducts.map((p) => <ProductCard key={p.product_id} product={p} context="catalog" onOpen={handleOpen} />)}
        {!visibleProducts.length && <div className="empty">조건에 맞는 상품이 없습니다.</div>}
      </div>

      {isOwner && showAdmin && (
        <section className="card shop-admin">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>상품 관리</h3>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>태그·시설 유형은 추천 점수 계산에 쓰입니다. 쇼핑몰이 products.json 을 제공하면 동기화할 수 있습니다.</span>
            </div>
            <button className="btn ghost sm" onClick={sync}>쇼핑몰 피드 동기화</button>
          </div>
          <form className="shop-form" onSubmit={submitForm}>
            <label>상품명<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>분류<select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{(info.categories || []).map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="wide">쇼핑몰 URL (전체 주소 또는 /keyring.html 같은 경로)<input className="input" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
            <label className="wide">설명<input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>가격(원, 비우면 견적 문의)<input className="input" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
            <label>최소 수량<input className="input" type="number" min="1" value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} /></label>
            <label>추천 태그(콤마)<input className="input" placeholder="단체복,대회,수료" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
            <label>시설 유형(콤마, 비우면 전체)<input className="input" placeholder="도장,체육관" value={form.facility_types} onChange={(e) => setForm({ ...form, facility_types: e.target.value })} /></label>
            <label className="wide">이미지 URL(선택)<input className="input" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> 판매 중(추천·목록에 노출)</label>
            <div className="wide" style={{ display: "flex", gap: 8 }}>
              <button className="btn" type="submit">{editingId ? "수정 저장" : "상품 추가"}</button>
              {editingId && <button className="btn ghost" type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>취소</button>}
            </div>
          </form>
          <table style={{ marginTop: 16 }}>
            <thead><tr><th>상품</th><th>분류</th><th>태그</th><th>출처</th><th>상태</th><th /></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_id}>
                  <td>{p.name}</td><td>{p.category}</td><td>{p.tags.join(", ")}</td><td>{p.source}</td>
                  <td>{p.active ? <span className="badge success">판매</span> : <span className="badge">비활성</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ghost sm" onClick={() => startEdit(p)}>수정</button>{" "}
                    {p.active && <button className="btn danger sm" onClick={() => deactivate(p)}>비활성화</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

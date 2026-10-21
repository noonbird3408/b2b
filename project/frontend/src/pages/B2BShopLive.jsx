import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  approveB2BOrder,
  createB2BOrder,
  fetchB2BOrders,
  fetchB2BPortal,
  fetchB2BProducts,
  fetchB2BRecommendations,
  fetchB2BSamples,
  fetchB2BClasses,
  fetchMe,
  prepareB2BPayment,
  rejectB2BOrder,
  requestB2BSample,
  signOut,
} from "../api";
import "./b2b-shop.css";

const CATEGORIES = ["전체", "교재", "수업 물품", "소모품", "홍보물"];

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function getUnitPrice(product, quantity, tier) {
  const tierRate = tier === "VIP" ? 0.12 : 0.05;
  const volumeRate = quantity >= 50 ? 0.1 : quantity >= 20 ? 0.05 : 0;
  return Math.round(product.price * (1 - Math.min(tierRate + volumeRate, 0.2)));
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-";
}

function parseCsvLine(line) {
  return line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.map((cell) => {
    const value = cell.replace(/,$/, "");
    return value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replace(/""/g, '"')
      : value.trim();
  }) || [];
}

function B2BShopLive() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [academy, setAcademy] = useState({ name: "기관 쇼핑몰", branch: "", logo: "" });
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("catalog");
  const [category, setCategory] = useState("전체");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationSource, setRecommendationSource] = useState("catalog_fallback");
  const [orders, setOrders] = useState([]);
  const [samples, setSamples] = useState([]);
  const [classes, setClasses] = useState([]);
  const [classError, setClassError] = useState("");
  const [classRetry, setClassRetry] = useState(0);
  const [selectedClass, setSelectedClass] = useState("");
  const [manualClassMode, setManualClassMode] = useState(false);
  const [manualClassName, setManualClassName] = useState("");
  const [manualStudentCount, setManualStudentCount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("카카오페이");
  const [cart, setCart] = useState({});
  const [logoRequest, setLogoRequest] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const payment = query.get("payment");
    if (payment) {
      setNotice(payment === "success" ? `카카오페이 결제가 완료되었습니다. ${query.get("order_no") || ""}` : `결제가 ${payment === "cancel" ? "취소" : "완료되지 않았습니다"}.`);
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetchMe()
      .then((me) => {
        // 관리자 모드로 선택된 세션만 발주 포털 이용 (서버도 동일하게 검증)
        if (me.active_role !== "admin" || !me.admin) {
          navigate("/");
          return Promise.reject(new Error("redirect"));
        }
        return fetchB2BPortal().then((portal) => [me.admin, portal]);
      })
      .then(([currentAccount, portal]) => {
        setAccount(currentAccount);
        setAcademy(portal.academy || { name: "기관 쇼핑몰", branch: "", logo: "" });
        setPaymentMethod(portal.payment_method || "카카오페이");
      })
      .catch((authError) => {
        if (authError.message === "redirect") return;
        if ([401, 403].includes(authError.response?.status)) navigate("/");
        else setError("계정 정보를 확인할 수 없습니다. 서버 연결을 확인하세요.");
      })
      .finally(() => setAuthLoading(false));
    const savedTheme = localStorage.getItem("app_theme") || "light";
    document.body.className = savedTheme === "dark" ? "theme-dark" : "theme-light";
  }, [navigate]);

  useEffect(() => {
    if (!account) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      Promise.all([
        fetchB2BProducts({ q: debouncedSearch, category }),
        fetchB2BProducts(),
        fetchB2BRecommendations(),
      ]).then(([filteredProducts, catalog, suggested]) => {
        if (!active) return;
        setProducts(filteredProducts);
        setAllProducts(catalog);
        setRecommendations(suggested.items || []);
        setRecommendationSource(suggested.source || "catalog_fallback");
        setError("");
      }).catch((requestError) => {
        if (active) setError(requestError.response?.data?.detail || "상품 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [account, category, debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const reloadPurchases = async () => {
    const [orderRows, sampleRows] = await Promise.all([fetchB2BOrders(), fetchB2BSamples()]);
    setOrders(orderRows);
    setSamples(sampleRows);
  };

  useEffect(() => {
    if (!account) return undefined;
    let active = true;
    Promise.all([fetchB2BClasses(), fetchB2BOrders(), fetchB2BSamples()])
      .then(([classRows, orderRows, sampleRows]) => {
        if (!active) return;
        setClasses(Array.isArray(classRows) ? classRows : []);
        setOrders(orderRows);
        setSamples(sampleRows);
        setClassError(classRows.length ? "" : "등록된 수업이 없습니다. 직접 입력으로 반 인원을 지정할 수 있습니다.");
      })
      .catch((requestError) => {
        if (!active) return;
        setClassError(requestError.response?.status === 401 ? "로그인이 필요합니다." : "수업 정보를 불러오지 못했습니다.");
        setError(requestError.response?.data?.detail || "구매 내역을 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, [account, classRetry]);

  useEffect(() => {
    if (!quote) return undefined;
    const finishPrint = () => {
      document.body.classList.remove("b2b-printing");
      setQuote(null);
    };
    window.addEventListener("afterprint", finishPrint);
    return () => window.removeEventListener("afterprint", finishPrint);
  }, [quote]);

  const selectedClassData = classes.find((item) => String(item.class_id) === selectedClass);
  const activeClassData = selectedClassData || (manualClassMode && manualClassName.trim()
    ? { name: manualClassName.trim(), student_count: Number(manualStudentCount) || 0 }
    : null);
  const classQuantity = activeClassData ? (Number(activeClassData.student_count) || 0) + 1 : 0;
  const productBySku = new Map(allProducts.map((product) => [product.sku, product]));
  const tier = account?.pricing_tier || "STANDARD";
  const cartRows = Object.entries(cart).map(([sku, quantity]) => {
    const product = productBySku.get(sku);
    return product && quantity > 0 ? { ...product, quantity, unitPrice: getUnitPrice(product, quantity, tier) } : null;
  }).filter(Boolean);
  const subtotal = cartRows.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = cartRows.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const savings = subtotal - total;
  const pendingCount = orders.filter((order) => order.status === "PENDING_APPROVAL").length;
  const pendingOrders = orders.filter((order) => order.status === "PENDING_APPROVAL");
  const recentOrders = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const refillProducts = allProducts.filter((product) => product.category === "소모품");
  const isOwner = account?.role === "owner";

  const setQuantity = (sku, quantity) => {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[sku];
      else next[sku] = Math.floor(quantity);
      return next;
    });
  };

  const addToCart = (product, amount = 1) => {
    const minimum = product.minimum_quantity || 1;
    amount = Math.max(minimum, amount);
    setCart((current) => ({ ...current, [product.sku]: (current[product.sku] || 0) + amount }));
    setNotice(`${product.name} ${amount}${product.unit}을(를) 장바구니에 담았습니다.`);
  };

  const addClassPack = (product) => {
    if (!activeClassData) return setNotice("먼저 반을 선택해 주세요.");
    addToCart(product, classQuantity);
    setNotice(`${activeClassData.name}: 학생 ${activeClassData.student_count || 0}명 + 강사 1명분을 담았습니다.`);
  };

  const submitOrder = async () => {
    if (!cartRows.length) return;
    setError("");
    try {
      const order = await createB2BOrder({
        items: cartRows.map((item) => ({ sku: item.sku, quantity: item.quantity })),
        payment_method: paymentMethod,
        class_name: activeClassData?.name || "전체 기관",
        custom_note: logoRequest.trim(),
      });
      setCart({});
      await reloadPurchases();
      setActiveTab(order.status === "PENDING_APPROVAL" ? "approvals" : "orders");
      setNotice(`${order.order_number} 주문을 DB에 등록했습니다.`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "주문을 등록하지 못했습니다.");
    }
  };

  const changeOrderStatus = async (orderId, nextStatus) => {
    try {
      const order = nextStatus === "APPROVED" ? await approveB2BOrder(orderId) : await rejectB2BOrder(orderId);
      await reloadPurchases();
      setNotice(`${order.order_number} 주문 상태를 ${order.status}로 변경했습니다.`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "주문 상태를 변경하지 못했습니다.");
    }
  };

  const payOrder = async (order) => {
    try {
      const result = await prepareB2BPayment(order.order_id);
      const redirectUrl = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        ? result.next_redirect_mobile_url || result.next_redirect_pc_url
        : result.next_redirect_pc_url || result.next_redirect_mobile_url;
      if (!redirectUrl) throw new Error("결제 페이지 주소를 받지 못했습니다.");
      window.location.assign(redirectUrl);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || requestError.message || "결제를 시작하지 못했습니다.");
    }
  };

  const reorder = (order) => {
    setCart((current) => {
      const next = { ...current };
      order.items.forEach((item) => { next[item.sku] = (next[item.sku] || 0) + item.quantity; });
      return next;
    });
    setActiveTab("catalog");
    setNotice(`${order.order_number} 주문 품목을 다시 담았습니다.`);
  };

  const requestSample = async (product) => {
    try {
      await requestB2BSample(product.sku);
      await reloadPurchases();
      setNotice(`${product.name} 샘플 신청을 접수했습니다.`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "샘플 신청을 등록하지 못했습니다.");
    }
  };

  const printQuote = () => {
    if (!cartRows.length) return setNotice("견적을 만들 상품을 먼저 담아 주세요.");
    setQuote({ items: cartRows, total, subtotal, savings, createdAt: new Date().toISOString(), paymentMethod });
    window.setTimeout(() => {
      document.body.classList.add("b2b-printing");
      window.print();
    }, 100);
  };

  const importCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
      const header = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
      const skuIndex = header.findIndex((value) => ["sku", "상품코드", "상품명"].includes(value));
      const quantityIndex = header.findIndex((value) => ["quantity", "수량"].includes(value));
      if (skuIndex < 0 || quantityIndex < 0) throw new Error("헤더에 상품코드와 수량이 필요합니다.");
      const imported = {};
      lines.slice(1).forEach((line) => {
        const columns = parseCsvLine(line);
        const product = allProducts.find((item) => item.sku.toLowerCase() === (columns[skuIndex] || "").toLowerCase() || item.name === columns[skuIndex]);
        const quantity = Number(columns[quantityIndex]);
        if (product && Number.isInteger(quantity) && quantity > 0) imported[product.sku] = (imported[product.sku] || 0) + quantity;
      });
      if (!Object.keys(imported).length) throw new Error("등록된 상품 코드와 양의 정수 수량을 확인해 주세요.");
      setCart((current) => {
        const next = { ...current };
        Object.entries(imported).forEach(([sku, quantity]) => { next[sku] = (next[sku] || 0) + quantity; });
        return next;
      });
      setNotice(`${Object.keys(imported).length}개 상품을 CSV에서 불러왔습니다.`);
    } catch (parseError) {
      setError(parseError.message || "CSV 파일을 읽지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const downloadTemplate = () => {
    const csv = "sku,quantity\nBK-101,12\nST-028,2\n";
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "b2b-order-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const logout = async () => {
    try { await signOut(); } finally { navigate("/"); }
  };

  if (authLoading) return <div className="b2b-auth-state">세션을 확인하고 있습니다.</div>;

  return (
    <div className="b2b-shop-shell">
      <header className="b2b-topbar">
        <div className="b2b-brand"><span className="b2b-brand-mark">{academy.logo ? <img src={academy.logo} alt="기관 로고" /> : academy.name?.[0] || "B"}</span><div><strong>{academy.name || "기관 쇼핑몰"}</strong><small>{academy.branch || "B2B 구매 포털"}</small></div></div>
        <div className="b2b-user-controls"><span>{account?.username} · {account?.role === "owner" ? "관리자" : "직원"}</span><button type="button" className="btn ghost sm" onClick={() => navigate("/shop")}>DDM 쇼핑몰 추천</button>{isOwner && <button type="button" className="btn ghost sm" onClick={() => navigate("/dashboard")}>관리자 화면</button>}<button type="button" className="btn ghost sm" onClick={logout}>로그아웃</button></div>
      </header>
      <main className="b2b-shop">
      <header className="b2b-heading">
        <div>
          <div className="b2b-eyebrow">기관 구매 · 통합 발주</div>
          <h1 className="page-title">B2B 쇼핑몰</h1>
          <p className="page-subtitle">검색, 수업 인원 계산, 기관 견적, 구매 승인과 결제를 한곳에서 처리합니다.</p>
        </div>
        <span className="b2b-role-chip">{tier === "VIP" ? "VIP 기관가" : "일반 기관가"}</span>
      </header>

      <div className="b2b-demo-note">상품·주문·샘플·구매 이력 추천은 서버 데이터베이스와 연동됩니다. 카카오페이 및 세금계산서는 해당 서비스의 가맹점 설정 후 사용 가능합니다.</div>

      <section className="b2b-summary" aria-label="구매 현황">
        <div><span>계약 등급</span><strong>{tier === "VIP" ? "VIP" : "일반"} 기관가</strong><small>기관 등급과 수량 할인</small></div>
        <div><span>승인 대기</span><strong>{pendingCount}건</strong><small>DB 주문 검토 필요</small></div>
        <div><span>주문 내역</span><strong>{orders.length}건</strong><small>기관 계정의 주문</small></div>
        <div><span>샘플 신청</span><strong>{samples.length}건</strong><small>DB에 저장된 신청</small></div>
      </section>

      {notice && <div className="b2b-notice" role="status"><span>{notice}</span><button type="button" aria-label="알림 닫기" onClick={() => setNotice("")}>닫기</button></div>}
      {error && <div className="b2b-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(""); setClassRetry((retry) => retry + 1); }}>다시 불러오기</button></div>}

      <nav className="b2b-tabs" aria-label="쇼핑몰 메뉴">
        {[["catalog", "상품 카탈로그"], ["approvals", `승인함${pendingCount ? ` ${pendingCount}` : ""}`], ["orders", "주문 내역"]].map(([id, label]) => (
          <button key={id} type="button" className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
        <div className="b2b-tab-tools">
          <button type="button" className="btn ghost sm" onClick={downloadTemplate}>CSV 양식</button>
          <label className="btn ghost sm b2b-upload">CSV 주문<input type="file" accept=".csv,text/csv" onChange={importCsv} /></label>
        </div>
      </nav>

      {activeTab === "catalog" && (
        <div className="b2b-layout">
          <main className="b2b-main">
            <section className="b2b-recommend">
              <div className="b2b-recommend-copy"><span>기관 맞춤 추천 · {recommendations[0]?.reason?.includes("DB 주문 이력") ? "구매 이력 기반" : "시작 카탈로그"}</span><strong>{activeClassData ? `${activeClassData.name} · ${classQuantity}권/세트` : "수업 인원과 기관 구매 패턴에 맞춘 준비"}</strong><small>주문 이력 집계와 수강 인원으로 상품을 골라보세요.</small></div>
              <div className="b2b-class-picker">
                {classError && <div className="b2b-class-error" role="status"><span>{classError}</span><button type="button" onClick={() => setClassRetry((retry) => retry + 1)}>다시 시도</button></div>}
                {manualClassMode ? (
                  <div className="b2b-manual-class">
                    <label>반 이름<input className="input" value={manualClassName} onChange={(event) => setManualClassName(event.target.value)} placeholder="예: 초등 파이썬반" /></label>
                    <label>학생 수<input className="input" type="number" min="0" value={manualStudentCount} onChange={(event) => setManualStudentCount(Math.max(0, Number(event.target.value)))} /></label>
                  </div>
                ) : (
                  <label>반 선택<select className="select" value={selectedClass} disabled={!classes.length} onChange={(event) => setSelectedClass(event.target.value)}><option value="">{classes.length ? "반을 선택하세요" : "수업 데이터 없음"}</option>{classes.map((item) => <option key={item.class_id} value={item.class_id}>{item.name} ({item.student_count || 0}명)</option>)}</select></label>
                )}
                <button type="button" className="b2b-class-mode" onClick={() => setManualClassMode((manual) => !manual)}>{manualClassMode ? "등록된 반 선택" : "직접 입력"}</button>
              </div>
            </section>
            <section className="b2b-seasonal">
              <div><strong>구매 이력 추천</strong><span>주문 완료 데이터에서 자주 함께 구매하는 품목을 계산합니다.</span></div>
              <span className="b2b-refill-badge">{recommendations.length}개 추천 상품</span>
            </section>
            <div className="b2b-recommend-list">
              {recommendations.map((product) => <button type="button" key={product.sku} onClick={() => addToCart(product)}><strong>{product.name}</strong><span>{recommendationSource === "purchase_history" ? product.reason : "주문 이력이 쌓이면 구매 패턴에 맞춘 추천으로 바뀝니다."}</span></button>)}
            </div>
            <div className="b2b-catalog-head" id="b2b-catalog">
              <div><h2>기관 전용 상품</h2><span>가격은 서버의 계약 등급 및 주문 수량에 따라 다시 계산됩니다.</span></div>
              <label className="b2b-search"><span className="sr-only">상품 검색</span><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 코드 검색" /></label>
            </div>
            <div className="b2b-categories" role="group" aria-label="상품 분류">
              {CATEGORIES.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <div className="b2b-product-list">
              {loading && <div className="b2b-empty">상품을 불러오는 중...</div>}
              {!loading && products.map((product) => {
                const unitPrice = getUnitPrice(product, cart[product.sku] || 1, tier);
                const isPromo = product.category === "홍보물";
                return (
                  <article className="b2b-product" key={product.sku}>
                    <div className={`b2b-product-mark ${product.category === "교재" ? "book" : product.category === "소모품" ? "supply" : product.category === "홍보물" ? "promo" : "classroom"}`} aria-hidden="true">{product.category === "교재" ? "교재" : product.category === "소모품" ? "소모" : product.category === "홍보물" ? "제작" : "수업"}</div>
                    <div className="b2b-product-info"><div className="b2b-product-meta"><span>{product.category}</span><span>{product.sku}</span></div><h3>{product.name}</h3><p>{product.description}</p><small>최소 {product.minimum_quantity}{product.unit}</small>{isPromo && <label className="b2b-logo-note">인쇄 메모<input className="input" value={logoRequest} onChange={(event) => setLogoRequest(event.target.value)} placeholder="로고 파일 전달 예정 등" /></label>}</div>
                    <div className="b2b-product-buy"><strong>{money(unitPrice)}<small> / {product.unit}</small></strong><span>기관가 · 정가 {money(product.price)}</span><div><button type="button" className="btn ghost sm" onClick={() => addToCart(product)}>담기</button>{activeClassData && <button type="button" className="btn sm" onClick={() => addClassPack(product)}>반 수량</button>}{product.sample_available && <button type="button" className="b2b-text-button" onClick={() => requestSample(product)}>샘플 신청</button>}</div></div>
                  </article>
                );
              })}
              {!loading && !products.length && <div className="b2b-empty">검색 조건에 맞는 상품이 없습니다.</div>}
            </div>
            <div className="b2b-peer-note"><span className="b2b-peer-dot" /><div><strong>유사 기관 인기 품목</strong><span>추천은 데이터베이스의 결제 완료/정산 주문 상품 집계로 산출합니다.</span></div></div>
          </main>

          <aside className="b2b-cart">
            <div className="b2b-cart-head"><div><h2>발주 바구니</h2><span>{cartRows.length}개 품목 · {activeClassData ? activeClassData.name : "기관 전체"}</span></div><button type="button" className="b2b-text-button" onClick={() => setCart({})} disabled={!cartRows.length}>비우기</button></div>
            <div className="b2b-cart-lines">
              {!cartRows.length && <div className="b2b-cart-empty"><p>아직 담긴 상품이 없습니다.</p><span>카탈로그에서 필요한 교재와 물품을 골라 발주를 시작하세요.</span><button type="button" onClick={() => document.getElementById("b2b-catalog")?.scrollIntoView({ behavior: "smooth", block: "start" })}>상품 고르기</button></div>}
              {cartRows.map((item) => <div className="b2b-cart-line" key={item.sku}><div className="b2b-cart-line-title"><strong>{item.name}</strong><button type="button" aria-label={`${item.name} 삭제`} onClick={() => setQuantity(item.sku, 0)}>삭제</button></div><div className="b2b-quantity"><button type="button" aria-label={`${item.name} 수량 감소`} onClick={() => setQuantity(item.sku, item.quantity - 1)}>−</button><input aria-label={`${item.name} 수량`} type="number" min={item.minimum_quantity} value={item.quantity} onChange={(event) => setQuantity(item.sku, Number(event.target.value))} /><button type="button" aria-label={`${item.name} 수량 증가`} onClick={() => setQuantity(item.sku, item.quantity + 1)}>+</button><span>{item.unit}</span><strong>{money(item.unitPrice * item.quantity)}</strong></div></div>)}
            </div>
            <div className="b2b-tier-control"><span>기관 계약 등급</span><strong>{tier === "VIP" ? "VIP 기관 · 12%" : "일반 기관 · 5%"}</strong></div>
            <div className="b2b-pay-control"><label htmlFor="b2b-payment">정산 방식</label><select id="b2b-payment" className="select" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>카카오페이</option><option>월말 일괄 정산</option><option>세금계산서 요청</option></select></div>
            <div className="b2b-totals"><div><span>상품 금액</span><span>{money(subtotal)}</span></div><div className="discount"><span>기관·수량 할인</span><span>− {money(savings)}</span></div><div className="grand-total"><strong>예상 결제 금액</strong><strong>{money(total)}</strong></div><small>실제 주문 금액은 서버가 결제 전에 다시 계산합니다.</small></div>
            <div className="b2b-cart-actions"><button type="button" className="btn ghost" onClick={printQuote} disabled={!cartRows.length}>견적서 인쇄 / PDF</button><button type="button" className="btn" onClick={submitOrder} disabled={!cartRows.length || loading}>주문 및 승인 요청</button></div>
          </aside>
        </div>
      )}

      {activeTab === "approvals" && (
        <section className="b2b-orders-view"><div className="b2b-view-heading"><div><h2>구매 승인함</h2><p>직원이 요청한 주문을 관리자 계정에서 검토합니다.</p></div><span className={`b2b-role-chip ${isOwner ? "approver" : "requester"}`}>{isOwner ? "승인 담당자" : "요청자 보기"}</span></div>
          {!pendingOrders.length && <div className="b2b-empty">승인 대기 중인 주문이 없습니다.</div>}
          {pendingOrders.map((order) => <OrderRow key={order.order_id} order={order} canApprove={isOwner} onStatus={changeOrderStatus} onPay={payOrder} onQuote={() => setQuote({ items: order.items.map((item) => ({ ...item, unitPrice: item.unit_price })), total: order.total, createdAt: order.created_at, paymentMethod: order.payment_method })} />)}
        </section>
      )}

      {activeTab === "orders" && (
        <section className="b2b-orders-view"><div className="b2b-view-heading"><div><h2>기관 주문 내역</h2><p>주문 품목을 다시 담아 반복 발주할 수 있습니다.</p></div><div className="b2b-refill-badge">소모품 재구매 주기 관리 {refillProducts.length}종</div></div>
          <div className="b2b-refill-strip"><div><strong>소모품 재구매 확인</strong><span>{refillProducts.map((product) => product.name).join(" · ") || "등록된 소모품이 없습니다."}</span></div><button type="button" className="btn ghost sm" disabled={!refillProducts.length} onClick={() => refillProducts.forEach((product) => addToCart(product))}>소모품 담기</button></div>
          {!recentOrders.length && <div className="b2b-empty">아직 저장된 주문이 없습니다. 상품 발주 후 이곳에서 주문 상태를 확인하세요.</div>}
          {recentOrders.map((order) => <OrderRow key={order.order_id} order={order} canApprove={false} onStatus={changeOrderStatus} onPay={payOrder} onReorder={reorder} onQuote={() => setQuote({ items: order.items.map((item) => ({ ...item, unitPrice: item.unit_price })), total: order.total, createdAt: order.created_at, paymentMethod: order.payment_method })} />)}
        </section>
      )}

      {quote && <QuoteDocument quote={quote} academy={academy} />}
      </main>
    </div>
  );
}

function OrderRow({ order, canApprove, onStatus, onReorder, onQuote, onPay }) {
  const statusLabels = { PENDING_APPROVAL: "승인 대기", AWAITING_PAYMENT: "결제 대기", SETTLEMENT_PENDING: "정산 대기", PAID: "결제 완료", REJECTED: "반려" };
  const statusLabel = statusLabels[order.status] || order.status;
  const statusClass = order.status === "PENDING_APPROVAL" ? "pending" : ["PAID", "SETTLEMENT_PENDING"].includes(order.status) ? "approved" : "rejected";
  return <article className="b2b-order-row"><div className="b2b-order-main"><div className="b2b-order-meta"><strong>{order.order_number}</strong><span>{formatDate(order.created_at)}</span><span className={`b2b-status ${statusClass}`}>{statusLabel}</span></div><strong className="b2b-order-title">{order.items.map((item) => `${item.name} ${item.quantity}${item.unit}`).join(" · ")}</strong><span className="b2b-order-detail">{order.class_name} · {order.payment_method}</span></div><div className="b2b-order-end"><strong>{money(order.total)}</strong><div><button type="button" className="btn ghost sm" onClick={onQuote}>견적 보기</button>{onReorder && <button type="button" className="btn ghost sm" onClick={() => onReorder(order)}>다시 주문</button>}{order.status === "AWAITING_PAYMENT" && onPay && <button type="button" className="btn sm" onClick={() => onPay(order)}>카카오페이 결제</button>}{order.status === "PENDING_APPROVAL" && canApprove && <><button type="button" className="btn sm" onClick={() => onStatus(order.order_id, "APPROVED")}>승인</button><button type="button" className="btn danger sm" onClick={() => onStatus(order.order_id, "REJECTED")}>반려</button></>}</div></div></article>;
}

function QuoteDocument({ quote, academy }) {
  const items = quote.items || [];
  return <article className="b2b-print-document"><header><div><span>기관 구매 견적서</span><h1>{academy.name || "기관명"}</h1><p>{academy.branch || ""}</p></div><div className="b2b-quote-number"><span>견적 발행일</span><strong>{formatDate(quote.createdAt)}</strong><span>결제 조건</span><strong>{quote.paymentMethod}</strong></div></header><hr /><div className="b2b-quote-recipient">수신: {academy.name || "기관 담당자"} 귀하</div><table><thead><tr><th>상품명</th><th>상품 코드</th><th>수량</th><th>단가</th><th>금액</th></tr></thead><tbody>{items.map((item) => <tr key={item.sku}><td>{item.name}</td><td>{item.sku}</td><td>{item.quantity} {item.unit}</td><td>{money(item.unitPrice)}</td><td>{money(item.unitPrice * item.quantity)}</td></tr>)}</tbody></table><div className="b2b-quote-total"><span>예상 합계</span><strong>{money(quote.total)}</strong></div><p className="b2b-quote-foot">본 견적은 구매 검토용이며 서버에서 가격을 재확인합니다.</p><button className="b2b-quote-close" type="button" onClick={() => { document.body.classList.remove("b2b-printing"); window.dispatchEvent(new Event("afterprint")); }}>닫기</button></article>;
}

export default B2BShopLive;
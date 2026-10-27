// =====================================================================
// 쇼핑몰 장바구니 — 이 브라우저에만 저장하는 '담아 둔 목록'(초안)
//   가격은 저장하지 않고 상품 번호·수량만 둡니다. 금액은 항상 서버(/api/shop/cart/quote)가 계산합니다.
//   학원마다 따로 저장(키에 학원 번호). 저장소가 막힌 브라우저(사생활 보호 모드 등)에서는 메모리에만 둡니다.
// =====================================================================
const EVENT = "shop:cart-changed";
const memory = {};
const keyOf = (facilityId) => `shop_cart_v1:${facilityId || "none"}`;

export function readCart(facilityId) {
  try {
    const raw = window.localStorage.getItem(keyOf(facilityId));
    const items = raw ? JSON.parse(raw) : memory[keyOf(facilityId)] || [];
    return Array.isArray(items) ? items.filter((i) => Number.isInteger(i.product_id) && i.quantity > 0) : [];
  } catch {
    return memory[keyOf(facilityId)] || [];
  }
}

export function writeCart(facilityId, items) {
  const clean = items.filter((i) => i.quantity > 0).slice(0, 50);
  memory[keyOf(facilityId)] = clean;
  try { window.localStorage.setItem(keyOf(facilityId), JSON.stringify(clean)); } catch { /* 메모리에만 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { facilityId, count: clean.length } }));
  return clean;
}

/** 담기 — 같은 상품이면 수량을 더함. inventory_item_id: 재고 관리에서 담은 경우 입고 때 그 물품 수량을 늘림 */
export function addToCart(facilityId, { product_id, name, quantity = 1, inventory_item_id = null, min_quantity = 1 }) {
  const items = readCart(facilityId);
  const found = items.find((i) => i.product_id === product_id);
  if (found) {
    found.quantity = Math.min(10000, found.quantity + quantity);
    found.inventory_item_id = found.inventory_item_id || inventory_item_id;
  } else {
    items.push({ product_id, name, quantity: Math.max(quantity, min_quantity || 1), inventory_item_id });
  }
  return writeCart(facilityId, items);
}

export const clearCart = (facilityId) => writeCart(facilityId, []);
export const CART_EVENT = EVENT;

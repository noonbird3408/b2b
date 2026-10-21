// 여러 화면에서 함께 쓰는 상수 (번들 분리를 위해 페이지 파일 대신 이곳에 둠)

/** 대시보드 날씨 지역 — 설정 → 기관 정보에서 선택 (위도, 경도) */
export const WEATHER_CITIES = {
  서울: [37.5665, 126.978], 용인: [37.241, 127.1775], 수원: [37.2636, 127.0286], 성남: [37.42, 127.1265],
  고양: [37.6584, 126.832], 인천: [37.4563, 126.7052], 대전: [36.3504, 127.3845], 대구: [35.8714, 128.6014],
  광주: [35.1595, 126.8526], 부산: [35.1796, 129.0756], 울산: [35.5384, 129.3114], 세종: [36.48, 127.289],
  춘천: [37.8813, 127.7298], 청주: [36.6424, 127.489], 전주: [35.8242, 127.148], 창원: [35.2279, 128.6811], 제주: [33.4996, 126.5312],
};

/** 알림 종류 → 아이콘·이동할 화면 */
export const NOTIFICATION_META = {
  CHECK_IN: { icon: "🟢", admin: "/attendances", parent: "children" },
  CHECK_OUT: { icon: "🏠", admin: "/attendances", parent: "children" },
  ABSENT: { icon: "⚪", admin: "/attendances", parent: "children" },
  NOTICE: { icon: "📢", admin: "/community", parent: "notices" },
  INVOICE: { icon: "🧾", admin: "/admin-checkout", parent: "pay" },
  PAYMENT: { icon: "💳", admin: "/admin-checkout", parent: "pay" },
  UNPAID: { icon: "⚠️", admin: "/admin-checkout", parent: "pay" },
  ASSIGNMENT: { icon: "📝", admin: "/classes", parent: "children" },
  COMMENT: { icon: "💬", admin: "/community", parent: "feed" },
  MODERATION: { icon: "🛡️", admin: "/community?tab=moderation", parent: "feed" },
  LINK: { icon: "🔗", admin: "/members", parent: "children" },
};

/** "2026-11-04T14:05:00" → "3분 전" */
export function relativeTime(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

/** 탭이 보일 때만 주기적으로 실행 (서버리스 호출 수 절약) */
export function startVisiblePolling(task, intervalMs) {
  let timer = null;
  const tick = () => { if (document.visibilityState === "visible") task(); };
  const onVisible = () => { if (document.visibilityState === "visible") task(); };
  timer = window.setInterval(tick, intervalMs);
  document.addEventListener("visibilitychange", onVisible);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
}

/** 브라우저 알림 (권한이 허용된 경우에만, 화면이 백그라운드일 때) */
export function showBrowserNotification(title, body) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    new Notification(title, { body, icon: "/favicon.svg" });
  } catch { /* 일부 브라우저(iOS 등)는 지원하지 않음 */ }
}

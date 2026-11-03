import { fetchPushConfig, subscribePush, testPush, unsubscribePush } from "../api";

// =====================================================================
// v14 휴대폰 푸시 알림 + 앱 설치(PWA)
//   - 안드로이드·PC 크롬/엣지/삼성 인터넷: 사이트에서 바로 '알림 켜기'
//   - 아이폰·아이패드(iOS 16.4+): Safari '공유 → 홈 화면에 추가' 로 설치한 앱에서만 웹 푸시 가능
//   알림 허용 창은 반드시 버튼을 누른 순간에만 띄워야 함(브라우저 정책) → enablePush 는 클릭 핸들러에서 호출
// =====================================================================
export const PUSH_EVENT = "push:received";          // 앱을 보고 있을 때 도착한 알림 → 화면이 바로 새로고침
export const INSTALL_EVENT = "pwa:installable";
const OPT_OUT_KEY = "push_opt_out";                 // 사용자가 직접 '끄기' 했으면 자동으로 다시 켜지 않음
const readOptOut = () => { try { return localStorage.getItem(OPT_OUT_KEY) === "1"; } catch { return false; } };
const writeOptOut = (on) => { try { on ? localStorage.setItem(OPT_OUT_KEY, "1") : localStorage.removeItem(OPT_OUT_KEY); } catch { /* 무시 */ } };

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent || "");
export const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (/Macintosh/i.test(ua()) && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) || navigator.standalone === true;

export function deviceLabel() {
  const u = ua();
  const os = /Android/i.test(u) ? "Android" : isIOS() ? (/iPad/i.test(u) ? "iPad" : "iPhone") : /Windows/i.test(u) ? "Windows"
    : /Macintosh/i.test(u) ? "Mac" : /Linux/i.test(u) ? "Linux" : "기기";
  const browser = /SamsungBrowser/i.test(u) ? "삼성 인터넷" : /Edg\//i.test(u) ? "Edge" : /Firefox/i.test(u) ? "Firefox"
    : /CriOS|Chrome/i.test(u) ? "Chrome" : /Safari/i.test(u) ? "Safari" : "브라우저";
  return `${os} · ${browser}${isStandalone() ? " (앱)" : ""}`;
}

function base64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 앱 시작 시 한 번: 서비스 워커 등록 + 설치 버튼 이벤트 + 서비스 워커 메시지 연결 */
export function setupPwa(navigate) {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();                            // 브라우저 기본 배너 대신 화면의 '앱 설치' 버튼으로
    window.__installPrompt = e;
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT));
  });
  window.addEventListener("appinstalled", () => { window.__installPrompt = null; window.dispatchEvent(new CustomEvent(INSTALL_EVENT)); });
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  navigator.serviceWorker.addEventListener("message", (e) => {
    const msg = e.data || {};
    if (msg.type === "push") window.dispatchEvent(new CustomEvent(PUSH_EVENT, { detail: msg.data }));
    if (msg.type === "open" && msg.url) navigate ? navigate(msg.url) : window.location.assign(msg.url);
  });
}

export const canInstall = () => typeof window !== "undefined" && !!window.__installPrompt;
export async function promptInstall() {
  const prompt = window.__installPrompt;
  if (!prompt) return false;
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  window.__installPrompt = null;
  window.dispatchEvent(new CustomEvent(INSTALL_EVENT));
  return choice?.outcome === "accepted";
}

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) || navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** 현재 상태 → { supported, needsInstall(아이폰 홈 화면 앱 필요), permission, subscribed, serverEnabled } */
export async function getPushStatus() {
  const base = { supported: false, needsInstall: false, permission: "default", subscribed: false, serverEnabled: true };
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return base;
  if (isIOS() && !isStandalone()) return { ...base, needsInstall: true };
  if (!("PushManager" in window) || typeof Notification === "undefined") return base;
  const reg = await registration().catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return { ...base, supported: true, permission: Notification.permission, subscribed: !!sub && Notification.permission === "granted" };
}

/** '알림 켜기' 버튼에서 호출 — 권한 요청 → 구독 → 서버 저장 */
export async function enablePush() {
  const config = await fetchPushConfig();
  if (!config.enabled || !config.public_key) throw new Error("서버에서 휴대폰 알림이 꺼져 있습니다.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "알림이 차단되어 있습니다. 브라우저(또는 휴대폰) 설정 → 사이트 설정 → 알림에서 이 사이트를 '허용'으로 바꿔 주세요."
      : "알림 허용을 선택하지 않았습니다.");
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const key = base64ToUint8Array(config.public_key);
  let sub = await reg.pushManager.getSubscription();
  // 서버 키가 바뀌었으면(서버 재설정) 예전 구독을 지우고 새로
  const current = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && current && (current.length !== key.length || current.some((b, i) => b !== key[i]))) {
    await sub.unsubscribe().catch(() => null);
    sub = null;
  }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await subscribePush(sub.toJSON(), deviceLabel());
  writeOptOut(false);
  return sub;
}

/** 로그인 후 화면이 열릴 때: 이미 알림을 허용한 기기면 조용히 지금 계정으로 다시 연결 (허용 창 없음) */
export async function syncPushSubscription() {
  try {
    if (readOptOut() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const status = await getPushStatus();
    if (status.supported) await enablePush();
  } catch { /* 조용히 실패 — 설정 화면에서 다시 켤 수 있음 */ }
}

/** 설정 화면의 '알림 끄기' */
export async function turnOffPush() {
  writeOptOut(true);
  await disablePush();
}

export async function disablePush() {
  const reg = await registration().catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return;
  await unsubscribePush(sub.endpoint).catch(() => null);
  await sub.unsubscribe().catch(() => null);
}

/** 로그아웃 직전: 공용 기기에서 다음 사람에게 이전 계정 알림이 오지 않도록 이 기기 구독 해제 */
export async function forgetPushOnThisDevice() {
  try { await disablePush(); } catch { /* 무시 */ }
}

export async function sendTestPush() {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) throw new Error("이 기기는 아직 알림이 켜져 있지 않습니다.");
  return testPush(sub.endpoint);
}

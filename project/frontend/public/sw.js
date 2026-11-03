/* =====================================================================
   쑥쑥 서비스 워커 — 앱 설치(홈 화면에 추가)와 휴대폰 푸시 알림
   - push: 서버가 보낸 암호화된 알림을 받아 OS 알림으로 표시
           (앱을 지금 보고 있으면 OS 알림 대신 화면 안 알림만 — 중복 방지)
   - notificationclick: 이미 열린 앱 창이 있으면 그 창에서, 없으면 새 창으로 해당 화면 열기
   - fetch: 화면 이동만 네트워크 우선 + 오프라인일 때 마지막 화면. API·이미지는 건드리지 않음(항상 최신)
   ===================================================================== */
const SHELL_CACHE = "ssukssuk-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/icon-192.png", "/badge-96.png"])).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;      // 화면 이동만
  if (new URL(req.url).pathname.startsWith("/api/")) return;         // 결제 콜백 등 API 주소는 그대로 통과
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put("/", res.clone())).catch(() => null);
      return res;
    } catch {
      return (await caches.match("/")) || Response.error();
    }
  })());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "쑥쑥", body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = windows.some((c) => c.focused && c.visibilityState === "visible");
    if (focused && data.tag !== "push-test") {
      windows.forEach((c) => c.postMessage({ type: "push", data }));   // 화면이 새 알림을 바로 불러오도록
      return;
    }
    await self.registration.showNotification(data.title || "쑥쑥", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
      lang: "ko",
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = windows.find((c) => new URL(c.url).origin === self.location.origin);
    if (same) {
      await same.focus();
      if ("navigate" in same) return same.navigate(url);
      return same.postMessage({ type: "open", url });
    }
    return self.clients.openWindow(url);
  })());
});

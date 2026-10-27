import { useState, useEffect, useRef, useCallback } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FACILITY_REQUIRED_EVENT, createAdminAccount, deleteAdminAccount, errorText, exportAdminData, fetchAdminAccounts,
  fetchAdminNotifications, fetchAdminSummary, fetchAppSettings, fetchMe, fetchSyncVersion, importAdminSettings, loadDemoData,
  markAdminNotificationsRead, saveAppSettings, signOut, updateAdminAccount,
} from "../api";
import { FACILITY_TYPES, NOTIFICATION_META, WEATHER_CITIES, relativeTime, showBrowserNotification, startVisiblePolling } from "../utils/constants";
import { announceDataChanged } from "../utils/sync";
import { resizeImageFile } from "../utils/image";
import Brand from "./Brand.jsx";
import SubjectPicker from "./SubjectPicker.jsx";
import { BRAND } from "../utils/brand";

const SETTINGS_STYLES = `
.settings-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:18px;overflow-x:auto;scrollbar-width:none;}
.settings-tabs button{flex:1 0 auto;padding:10px 12px;background:none;border:0;border-bottom:2px solid transparent;color:var(--text-2);font-size:13px;}
.settings-tabs button.active{border-bottom-color:var(--primary);color:var(--primary-text);font-weight:700;}
.settings-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px;}
.settings-section{padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);}
.settings-section h4{margin:0 0 5px;font-size:14px;}
.settings-section p{margin:0 0 12px;color:var(--text-2);font-size:12px;line-height:1.6;}
.account-row{display:grid;grid-template-columns:minmax(0,1fr) 96px 96px auto;align-items:center;gap:8px;padding:9px;border:1px solid var(--border);border-radius:8px;background:var(--surface);}
.account-row>div{display:grid;gap:2px;min-width:0;}
.account-row>div strong{font-size:13px;}
.account-row>div span{overflow-wrap:anywhere;color:var(--text-3);font-size:11px;}
.account-row .select{min-width:0;padding:5px;font-size:12px;min-height:30px;}
.account-add{display:grid;grid-template-columns:minmax(0,1fr) 110px 90px auto;gap:8px;align-items:end;}
.menu-order-row{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid var(--border);background:var(--surface);cursor:grab;}
.menu-order-row:last-child{border-bottom:0;}
@media(max-width:600px){.settings-form-grid,.account-add{grid-template-columns:minmax(0,1fr);}.account-row{grid-template-columns:1fr 1fr;}.account-row>div{grid-column:1/-1;}}
`;

const initialNavItems = [
  { id: "dashboard",   to: "/dashboard",      label: "대시보드",   icon: "🏠" },
  { id: "members",     to: "/members",        label: "학생 관리",  icon: "👥" },
  { id: "classes",     to: "/classes",        label: "수업 관리",  icon: "📒" },
  { id: "attendances", to: "/attendances",    label: "출석 체크",  icon: "✓" },
  { id: "community",   to: "/community",      label: "커뮤니티",   icon: "🤝" },
  { id: "checkout",    to: "/admin-checkout", label: "수납·청구",  icon: "💳" },
  { id: "AIservice",   to: "/aiservice",      label: "AI 비서",    icon: "🤖" },
  { id: "inventory",   to: "/inventory",      label: "재고 관리",  icon: "📦" },
  { id: "shop",        to: "/shop",           label: "쇼핑몰",     icon: "🛍️" },
];
// 직원 계정이 볼 수 있는 화면 (학생·수업은 조회만 — 서버가 GET 만 허용). v10: 키오스크 삭제, 재고 관리 추가
const STAFF_PATHS = ["/attendances", "/members", "/classes", "/inventory", "/shop"];
// 메뉴 배지 (상단 요약 API 의 badges 값)
const NAV_BADGES = {
  community: (b) => b.moderation_pending,
  members: (b) => b.applications_pending,
  inventory: (b) => (b.inventory_low || 0) + (b.purchase_pending || 0),
};
const SYNC_INTERVAL = 6000;       // 데이터 버전 확인 (가벼운 요청)
const SUMMARY_INTERVAL = 30000;   // 알림·배지 요약

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
const readLocal = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); } catch { /* 무시 */ } };

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [summary, setSummary] = useState(null);
  const [dataVersion, setDataVersion] = useState(null);
  const [online, setOnline] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [globalQuery, setGlobalQuery] = useState("");
  const searchRef = useRef(null);
  const lastUnreadRef = useRef(null);
  const versionRef = useRef(null);

  // 설정 모달
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("화면");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [newAccount, setNewAccount] = useState({ email: "", username: "", role: "staff" });
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [academyInfo, setAcademyInfo] = useState(null);
  const [paymentSettings, setPaymentSettings] = useState(null);

  const [theme, setTheme] = useState(() => readLocal("app_theme", "light"));
  const [fontSize, setFontSize] = useState(() => readLocal("app_font_size", "normal"));
  const [dragItemIndex, setDragItemIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [menuOrder, setMenuOrder] = useState(() => {
    const saved = readLocalJson("dashboard_menu_order", null);
    if (!Array.isArray(saved)) return initialNavItems;
    const byId = Object.fromEntries(initialNavItems.map((item) => [item.id, item]));
    const ordered = saved.map((item) => byId[item.id]).filter(Boolean);    // 라벨·경로는 항상 최신 정의 사용
    const ids = new Set(ordered.map((item) => item.id));
    return [...ordered, ...initialNavItems.filter((item) => !ids.has(item.id))];
  });

  const facility = me?.facility;
  const isOwner = facility?.my_role === "owner";
  const account = me?.admin || {};

  // ---- 세션·학원 확인: 관리자 모드 + 학원 선택이 끝난 세션만 셸에 진입 ----
  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((current) => {
        if (!alive) return;
        if (current.active_role !== "admin" || !current.admin || !current.facility) {
          navigate("/", { replace: true });
          return;
        }
        setMe(current);
      })
      .catch(() => alive && navigate("/", { replace: true }))
      .finally(() => alive && setAuthChecking(false));
    return () => { alive = false; };
  }, [navigate]);

  // 서버가 428(학원 선택 필요)을 돌려주면 학원 선택 화면으로
  useEffect(() => {
    const onRequired = () => navigate("/", { replace: true });
    window.addEventListener(FACILITY_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(FACILITY_REQUIRED_EVENT, onRequired);
  }, [navigate]);

  useEffect(() => {
    document.body.className = theme === "dark" ? "theme-dark" : "theme-light";
    writeLocal("app_theme", theme);
    document.body.style.fontSize = fontSize === "large" ? "16px" : fontSize === "small" ? "12px" : "14px";
    writeLocal("app_font_size", fontSize);
  }, [theme, fontSize]);

  useEffect(() => { writeLocal("dashboard_menu_order", menuOrder.map((item) => ({ id: item.id }))); }, [menuOrder]);

  useEffect(() => {
    if (me && !isOwner && !STAFF_PATHS.includes(location.pathname)) navigate("/attendances", { replace: true });
  }, [me, isOwner, location.pathname, navigate]);

  const pushToast = useCallback((toast) => {
    const id = `${toast.key || Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 12000);
  }, []);

  // ---- 상단 요약(알림 수·할 일) ----
  const refreshSummary = useCallback(async () => {
    try {
      const next = await fetchAdminSummary();
      setSummary(next);
      if (lastUnreadRef.current != null && next.unread_notifications > lastUnreadRef.current) {
        const latest = await fetchAdminNotifications({ unread_only: true, limit: next.unread_notifications - lastUnreadRef.current });
        latest.items.slice(0, 3).forEach((n) => {
          pushToast({ title: `${NOTIFICATION_META[n.kind]?.icon || "🔔"} ${n.title}`, text: n.body, key: `n${n.notification_id}` });
          showBrowserNotification(n.title, n.body);
        });
      }
      lastUnreadRef.current = next.unread_notifications;
    } catch { /* 일시적 오류는 다음 주기에 재시도 */ }
  }, [pushToast]);

  // ---- 실시간 동기화: data_version 이 바뀌면 열린 화면에 '다시 불러오기' 신호 ----
  const checkVersion = useCallback(async () => {
    try {
      const { data_version: version } = await fetchSyncVersion();
      setOnline(true);
      if (versionRef.current != null && version !== versionRef.current) {
        announceDataChanged(version);
        refreshSummary();
      }
      versionRef.current = version;
      setDataVersion(version);
    } catch {
      setOnline(false);
    }
  }, [refreshSummary]);

  useEffect(() => {
    if (!me) return undefined;
    refreshSummary();
    checkVersion();
    const stopSync = startVisiblePolling(checkVersion, SYNC_INTERVAL);
    const stopSummary = startVisiblePolling(refreshSummary, SUMMARY_INTERVAL);
    return () => { stopSync(); stopSummary(); };
  }, [me, refreshSummary, checkVersion]);

  // 오늘의 업무 정시 알림
  useEffect(() => {
    const todos = summary?.todos || [];
    if (!todos.length) return undefined;
    const check = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const notified = readLocalJson("dashboard_notified_keys", []);
      const due = todos.filter((t) => t.due_time === hhmm && !notified.includes(`${day}_${t.todo_id}`));
      if (!due.length) return;
      due.forEach((t) => {
        pushToast({ title: "📅 오늘의 업무", text: `[${t.due_time}] ${t.text}`, key: `t${t.todo_id}` });
        showBrowserNotification("오늘의 업무", `[${t.due_time}] ${t.text}`);
      });
      writeLocal("dashboard_notified_keys", [...notified, ...due.map((t) => `${day}_${t.todo_id}`)].slice(-200));
    };
    check();
    const timer = window.setInterval(check, 15000);
    return () => window.clearInterval(timer);
  }, [summary?.todos, pushToast]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- 설정 모달 데이터 ----
  useEffect(() => {
    if (!isSettingsOpen || !isOwner) return;
    fetchAppSettings()
      .then((settings) => { setAcademyInfo(settings.academy); setPaymentSettings(settings.payment); })
      .catch((error) => setSettingsMessage(errorText(error, "기관 설정을 불러오지 못했습니다.")));
  }, [isSettingsOpen, isOwner]);

  useEffect(() => {
    if (!isSettingsOpen || activeTab !== "계정" || !isOwner) return;
    fetchAdminAccounts().then(setAdminAccounts).catch((error) => setSettingsMessage(errorText(error, "계정 목록을 불러오지 못했습니다.")));
  }, [activeTab, isSettingsOpen, isOwner]);

  const openNotifications = async () => {
    const next = !isDropdownOpen;
    setIsDropdownOpen(next);
    if (next) {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => null);
        setNotifications((await fetchAdminNotifications({ limit: 30 })).items);
      } catch { /* 무시 */ }
    }
  };

  const handleNotificationClick = async (n) => {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x)));
      await markAdminNotificationsRead({ ids: [n.notification_id] }).catch(() => null);
      refreshSummary();
    }
    setIsDropdownOpen(false);
    let target = n.link ? `/${String(n.link).replace(/^\//, "")}` : NOTIFICATION_META[n.kind]?.admin;
    if (target === "/members" && n.member_id) target = `/members?member=${n.member_id}`;
    if (target && (isOwner || STAFF_PATHS.some((p) => target.startsWith(p)))) navigate(target);
  };

  const handleReadAll = async () => {
    await markAdminNotificationsRead({ all: true }).catch(() => null);
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    refreshSummary();
  };

  const handleGlobalSearch = (e) => {
    e.preventDefault();
    const q = globalQuery.trim();
    if (q) navigate(`/members?q=${encodeURIComponent(q)}`);
  };

  const handleDemoData = async () => {
    if (!window.confirm("시연용 가상 데이터(학생 12명·수업·출결·청구서·공지·커뮤니티)를 이 학원에 넣을까요?\n기존 데이터는 지우지 않습니다.")) return;
    try {
      const result = await loadDemoData(false).catch(async (error) => {
        if (error?.response?.status === 409 && window.confirm(`${errorText(error)}\n그래도 추가로 넣을까요?`)) return loadDemoData(true);
        throw error;
      });
      if (!result) return;
      window.alert(`데모 데이터를 넣었습니다.\n\n· 출석 알림: ${result.attendance_demo}\n· 학부모 체험: 자녀 ${result.parent_demo.child_name} / ${result.parent_demo.phone}\n· 재고 관리: 부족한 물품으로 '구매 확인'을 체험할 수 있습니다.`);
      setIsSettingsOpen(false);
      announceDataChanged();
      navigate("/dashboard");
    } catch (error) {
      setSettingsMessage(errorText(error, "데모 데이터를 넣지 못했습니다."));
    }
  };

  const handleLogout = async () => {
    try { await signOut(); } catch { /* 이미 만료된 세션 */ }
    ["app_academy_info", "app_payment_settings", "dashboard_todos", "dashboard_notifications", "dashboard_notified_keys"]
      .forEach((key) => { try { localStorage.removeItem(key); } catch { /* 무시 */ } });
    navigate("/", { replace: true });
  };

  // ---- 메뉴 순서 (드래그 또는 ▲▼) ----
  const moveMenuItem = (index, direction) => {
    const next = [...menuOrder];
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setMenuOrder(next);
  };
  const handleDragStart = (index) => (event) => {
    setDragItemIndex(index);
    event.dataTransfer.effectAllowed = "move";
    try { event.dataTransfer.setData("text/plain", String(index)); } catch { /* 일부 브라우저 제한 */ }
  };
  const handleDragOver = (index) => (event) => { event.preventDefault(); setDragOverIndex(index); };
  const handleDrop = (index) => (event) => {
    event.preventDefault();
    const source = dragItemIndex !== null ? dragItemIndex : Number(event.dataTransfer.getData("text/plain"));
    if (source !== index && source >= 0 && source < menuOrder.length) {
      const next = [...menuOrder];
      const [moved] = next.splice(source, 1);
      next.splice(index, 0, moved);
      setMenuOrder(next);
    }
    setDragItemIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => { setDragItemIndex(null); setDragOverIndex(null); };

  const handleResetData = () => {
    if (!window.confirm("이 브라우저의 테마, 글자 크기, 메뉴 순서만 초기화합니다. 계속할까요?")) return;
    ["app_theme", "app_font_size", "dashboard_menu_order", "dashboard_notified_keys"].forEach((key) => { try { localStorage.removeItem(key); } catch { /* 무시 */ } });
    setTheme("light");
    setFontSize("normal");
    setMenuOrder(initialNavItems);
    setSettingsMessage("화면 설정을 초기화했습니다.");
  };

  const handleSaveSettings = async () => {
    if (!academyInfo || !paymentSettings) return true;
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      const saved = await saveAppSettings({ academy: academyInfo, payment: paymentSettings });
      setAcademyInfo(saved.academy);
      setPaymentSettings(saved.payment);
      refreshSummary();
      fetchMe().then(setMe).catch(() => null);
      return true;
    } catch (error) {
      setSettingsMessage(errorText(error, "설정을 저장하지 못했습니다."));
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleCreateAccount = async (event) => {
    event.preventDefault();
    setSettingsMessage("");
    try {
      const created = await createAdminAccount(newAccount);
      setAdminAccounts((current) => [...current.filter((a) => a.account_id !== created.account_id), created]);
      setNewAccount({ email: "", username: "", role: "staff" });
      setSettingsMessage(`${created.email} 을(를) 이 학원의 ${created.role === "owner" ? "관리자" : "직원"}로 등록했습니다.`);
    } catch (error) {
      setSettingsMessage(errorText(error, "계정을 등록하지 못했습니다."));
    }
  };

  const handleAccountChange = async (target, field, value) => {
    try {
      const updated = await updateAdminAccount(target.account_id, {
        role: field === "role" ? value : target.role,
        pricing_tier: field === "pricing_tier" ? value : target.pricing_tier,
      });
      setAdminAccounts((current) => current.map((row) => (row.account_id === updated.account_id ? updated : row)));
    } catch (error) {
      setSettingsMessage(errorText(error, "계정 권한을 저장하지 못했습니다."));
      fetchAdminAccounts().then(setAdminAccounts).catch(() => {});
    }
  };

  const handleAccountRemove = async (target) => {
    if (!window.confirm(`${target.email} 의 이 학원 관리 권한을 해제할까요?`)) return;
    try {
      await deleteAdminAccount(target.account_id);
      setAdminAccounts((current) => current.filter((row) => row.account_id !== target.account_id));
    } catch (error) {
      setSettingsMessage(errorText(error, "권한을 해제하지 못했습니다."));
    }
  };

  const handleExportData = async () => {
    try {
      const payload = await exportAdminData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${BRAND.slug}-${facility?.facility_id}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSettingsMessage(errorText(error, "데이터를 내보내지 못했습니다."));
    }
  };

  const handleImportSettings = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const settings = payload.settings || payload;
      if (!settings.academy || !settings.payment) throw new Error("기관 및 수납 설정이 포함된 JSON 파일이 아닙니다.");
      const saved = await importAdminSettings(settings);
      setAcademyInfo(saved.settings?.academy || settings.academy);
      setPaymentSettings(saved.settings?.payment || settings.payment);
      setSettingsMessage("기관 및 수납 설정을 복원했습니다.");
    } catch (error) {
      setSettingsMessage(errorText(error, error.message || "설정 파일을 복원하지 못했습니다."));
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const logo = await resizeImageFile(file, "logo");
      setAcademyInfo((prev) => ({ ...prev, logo }));
    } catch (error) {
      setSettingsMessage(error.message);
    }
  };

  if (authChecking || !me) return <div className="auth-loading">관리자 화면을 준비하고 있습니다.</div>;

  const brand = summary?.brand || {};
  const unreadCount = summary?.unread_notifications || 0;
  const visibleMenu = isOwner ? menuOrder : menuOrder.filter((item) => STAFF_PATHS.includes(item.to));
  const setA = (key) => (e) => setAcademyInfo((prev) => ({ ...prev, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const tabs = isOwner ? ["화면", "기관 정보", "수납", "계정", "데이터"] : ["화면"];

  return (
    <div className="app-shell app-shell-responsive">
      <aside className="sidebar">
        <div className="sidebar-brand"><Brand sub={facility.name} /></div>
        <div className="sidebar-section-label">메뉴</div>
        <nav>
          {visibleMenu.map((item, index) => (
            <NavLink key={item.id} to={item.to} draggable={isOwner}
              onDragStart={handleDragStart(index)} onDragOver={handleDragOver(index)} onDrop={handleDrop(index)} onDragEnd={handleDragEnd}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}${dragOverIndex === index ? " drag-over" : ""}`}>
              <span style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
              {NAV_BADGES[item.id] && NAV_BADGES[item.id](summary?.badges || {}) > 0 && (
                <span className="nav-badge" aria-label={`처리할 일 ${NAV_BADGES[item.id](summary.badges)}건`}>{NAV_BADGES[item.id](summary.badges)}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{(brand.principal || account.username || "관").charAt(0)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-foot-name">{isOwner ? (brand.principal || account.username) : account.username}</div>
            <div className="sidebar-foot-role">{isOwner ? (brand.role || "원장") : "직원"}</div>
          </div>
          <button type="button" className="sidebar-foot-gear" onClick={() => setIsSettingsOpen(true)} title="설정"
            style={{ border: 0, background: "transparent" }}>⚙</button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-facility">
            <span className={`sync-dot${online ? "" : " off"}`} title={online ? `실시간 동기화 중 (v${dataVersion ?? "-"})` : "서버 연결 확인 중"} />
            <span className="name">{facility.name}</span>
            <button type="button" className="btn ghost sm" onClick={() => navigate("/")}>학원 변경</button>
          </div>
          <div className="topbar-actions">
            {isOwner && (
              <form className="topbar-search" onSubmit={handleGlobalSearch} role="search" style={{ marginLeft: 0 }}>
                <input ref={searchRef} value={globalQuery} onChange={(e) => setGlobalQuery(e.target.value)}
                  placeholder="학생·보호자·전화번호 검색" aria-label="학생 검색" />
                <span className="kbd">⌘K</span>
              </form>
            )}
            <div className="topbar-bell-wrapper">
              <button className="topbar-bell" onClick={openNotifications} aria-label={`알림 ${unreadCount}건`}>
                🔔{unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
              </button>
              {isDropdownOpen && (
                <div className="notification-dropdown">
                  <div className="notification-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>알림 {unreadCount > 0 ? `(${unreadCount})` : ""}</span>
                    {unreadCount > 0 && <button className="notification-del-btn" onClick={handleReadAll}>모두 읽음</button>}
                  </div>
                  {notifications.length === 0 ? (
                    <div className="notification-empty">새 알림이 없습니다.</div>
                  ) : notifications.map((n) => (
                    <div key={n.notification_id} className={`notification-item ${n.is_read ? "" : "unread"}`}
                      onClick={() => handleNotificationClick(n)} style={{ cursor: "pointer" }}>
                      <div className="notification-item-body">
                        <div className="notification-item-text">
                          <span style={{ marginRight: 4 }}>{NOTIFICATION_META[n.kind]?.icon || "🔔"}</span><b>{n.title}</b>
                          {n.body && <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{n.body}</div>}
                        </div>
                        <div className="notification-item-meta">{relativeTime(n.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="page">
          <Outlet context={{ isOwner, facility, dataVersion, me }} />
        </div>
      </main>

      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast-item">
            <div className="toast-content">
              <div className="toast-title">{t.title}</div>
              <div className="toast-text">{t.text}</div>
            </div>
            <button className="toast-close-btn" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      {isSettingsOpen && (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(600px, 100%)" }}>
            <style>{SETTINGS_STYLES}</style>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>설정 · {facility.name}</h3>
              <button className="btn ghost sm" onClick={() => setIsSettingsOpen(false)} aria-label="닫기">✕</button>
            </div>
            <div className="settings-tabs">
              {tabs.map((tab) => (
                <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>
              ))}
            </div>

            <div style={{ minHeight: 280 }}>
              {activeTab === "화면" && (
                <div style={{ display: "grid", gap: 16 }}>
                  <div className="settings-form-grid">
                    <div className="form-row">
                      <label>테마</label>
                      <div className="segmented">
                        <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>라이트</button>
                        <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>다크</button>
                      </div>
                    </div>
                    <div className="form-row">
                      <label>글자 크기</label>
                      <select className="select" value={fontSize} onChange={(e) => setFontSize(e.target.value)}>
                        <option value="small">작게</option><option value="normal">보통</option><option value="large">크게</option>
                      </select>
                    </div>
                  </div>
                  {isOwner && (
                    <div>
                      <label style={{ display: "block", marginBottom: 8, fontWeight: 600, fontSize: 13, color: "var(--text-2)" }}>메뉴 순서</label>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                        {menuOrder.map((item, index) => (
                          <div key={item.id} className="menu-order-row" draggable onDragStart={handleDragStart(index)}
                            onDragOver={handleDragOver(index)} onDrop={handleDrop(index)} onDragEnd={handleDragEnd}
                            style={{ background: dragOverIndex === index ? "var(--surface-hover)" : undefined }}>
                            <span>{item.icon} {item.label}</span>
                            <span style={{ display: "flex", gap: 4 }}>
                              <button type="button" className="btn ghost sm" onClick={() => moveMenuItem(index, "up")} disabled={index === 0}>▲</button>
                              <button type="button" className="btn ghost sm" onClick={() => moveMenuItem(index, "down")} disabled={index === menuOrder.length - 1}>▼</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="settings-section">
                    <h4>계정</h4>
                    <p>{account.username} · {account.email} · {isOwner ? "원장" : "직원"}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn ghost sm" type="button" onClick={() => navigate("/")}>학원 변경</button>
                      <button className="btn ghost sm" type="button" onClick={() => navigate("/?role=1")}>역할 변경</button>
                      <button className="btn danger sm" type="button" onClick={handleLogout}>로그아웃</button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "기관 정보" && (academyInfo ? (
                <div>
                  <div className="form-row">
                    <label>로고</label>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--surface-hover)", display: "grid", placeItems: "center", overflow: "hidden", border: "1px solid var(--border)" }}>
                        {academyInfo.logo ? <img src={academyInfo.logo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="로고" /> : <span className="muted">로고</span>}
                      </div>
                      <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
                      {academyInfo.logo && <button className="btn sm ghost" type="button" onClick={() => setAcademyInfo({ ...academyInfo, logo: "" })}>삭제</button>}
                    </div>
                  </div>
                  <div className="settings-form-grid">
                    <div className="form-row"><label>학원 이름</label><input className="input" value={academyInfo.name || ""} onChange={setA("name")} /></div>
                    <div className="form-row"><label>학원 종류</label>
                      <select className="select" value={academyInfo.facilityType || "학원"} onChange={setA("facilityType")}>
                        {FACILITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select></div>
                    <div className="form-row"><label>지점</label><input className="input" value={academyInfo.branch || ""} onChange={setA("branch")} /></div>
                    <div className="form-row"><label>지역 (학부모 검색)</label><input className="input" value={academyInfo.region || ""} onChange={setA("region")} placeholder="예: 경기 용인시" /></div>
                    <div className="form-row"><label>원장 이름</label><input className="input" value={academyInfo.principal || ""} onChange={setA("principal")} /></div>
                    <div className="form-row"><label>직책 표시</label><input className="input" value={academyInfo.role || ""} onChange={setA("role")} placeholder="원장" /></div>
                    <div className="form-row"><label>대표 연락처</label><input className="input" value={academyInfo.phone || ""} onChange={setA("phone")} /></div>
                    <div className="form-row"><label>날씨 지역</label>
                      <select className="select" value={academyInfo.weatherCity || "용인"} onChange={setA("weatherCity")}>
                        {Object.keys(WEATHER_CITIES).map((city) => <option key={city}>{city}</option>)}
                      </select></div>
                    <div className="form-row"><label>지각 기준 (수업 시작 후 분)</label>
                      <input type="number" min="0" max="60" className="input" value={academyInfo.lateGraceMinutes ?? 10}
                        onChange={(e) => setAcademyInfo({ ...academyInfo, lateGraceMinutes: Number(e.target.value) })} /></div>
                    <div className="form-row" style={{ display: "flex", alignItems: "flex-end" }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                        <input type="checkbox" checked={academyInfo.isPublic !== false} onChange={setA("isPublic")} /> 학부모 검색에 노출
                      </label>
                    </div>
                  </div>
                  <div className="form-row"><label>주소</label><input className="input" value={academyInfo.address || ""} onChange={setA("address")} /></div>
                  <div className="form-row"><label>주요 과목 <small className="muted" style={{ fontWeight: 400 }}>— 쇼핑몰 교재·교구 추천에 사용</small></label>
                    <SubjectPicker value={academyInfo.subjects || []} onChange={(subjects) => setAcademyInfo({ ...academyInfo, subjects })} /></div>
                  <div className="form-row"><label>소개</label><textarea value={academyInfo.description || ""} onChange={setA("description")} maxLength={1000} /></div>
                </div>
              ) : <div className="fl-skeleton" style={{ height: 240 }} />)}

              {activeTab === "수납" && (paymentSettings ? (
                <div>
                  <div className="settings-form-grid">
                    <div className="form-row"><label>기본 결제일</label>
                      <select className="select" value={paymentSettings.defaultPaymentDay} onChange={(e) => setPaymentSettings({ ...paymentSettings, defaultPaymentDay: e.target.value })}>
                        {[...Array(31)].map((_, i) => <option key={i + 1} value={i + 1}>매월 {i + 1}일</option>)}
                        <option value="last">매월 말일</option>
                      </select></div>
                    <div className="form-row"><label>기본 월 수강료 (원)</label>
                      <input type="number" min="0" className="input" value={paymentSettings.baseTuitionFee}
                        onChange={(e) => setPaymentSettings({ ...paymentSettings, baseTuitionFee: Number(e.target.value) })} /></div>
                    <div className="form-row"><label>B2B 정산 방식</label>
                      <select className="select" value={paymentSettings.b2bPaymentMethod || "카카오페이"} onChange={(e) => setPaymentSettings({ ...paymentSettings, b2bPaymentMethod: e.target.value })}>
                        <option>카카오페이</option><option>월말 일괄 정산</option><option>세금계산서 요청</option>
                      </select></div>
                    <div className="form-row"><label>세금계산서 이메일</label>
                      <input type="email" className="input" value={paymentSettings.taxInvoiceEmail || ""} onChange={(e) => setPaymentSettings({ ...paymentSettings, taxInvoiceEmail: e.target.value })} /></div>
                  </div>
                  <p className="muted">수업별 수강료는 수업 관리 → 수업 편집에서 정합니다. 비워 두면 기본 월 수강료가 적용됩니다.</p>
                </div>
              ) : <div className="fl-skeleton" style={{ height: 200 }} />)}

              {activeTab === "계정" && (
                <div style={{ display: "grid", gap: 10 }}>
                  {adminAccounts.map((row) => (
                    <div className="account-row" key={row.account_id}>
                      <div><strong>{row.username || row.email}</strong><span>{row.email}</span></div>
                      <select className="select" value={row.role} onChange={(e) => handleAccountChange(row, "role", e.target.value)} aria-label="역할">
                        <option value="owner">원장</option><option value="staff">직원</option>
                      </select>
                      <select className="select" value={row.pricing_tier} onChange={(e) => handleAccountChange(row, "pricing_tier", e.target.value)} aria-label="B2B 등급"
                        disabled={!me.can_edit_pricing} title={me.can_edit_pricing ? undefined : "B2B 계약 등급(할인율)은 플랫폼 운영자만 바꿀 수 있습니다"}>
                        <option value="STANDARD">일반</option><option value="VIP">VIP</option>
                      </select>
                      <button type="button" className="btn danger sm" disabled={row.account_id === account.account_id} onClick={() => handleAccountRemove(row)}>해제</button>
                    </div>
                  ))}
                  <form onSubmit={handleCreateAccount} className="account-add">
                    <input className="input" type="email" required placeholder="추가할 Google 이메일" value={newAccount.email} onChange={(e) => setNewAccount((c) => ({ ...c, email: e.target.value }))} />
                    <input className="input" placeholder="이름(선택)" value={newAccount.username} onChange={(e) => setNewAccount((c) => ({ ...c, username: e.target.value }))} />
                    <select className="select" value={newAccount.role} onChange={(e) => setNewAccount((c) => ({ ...c, role: e.target.value }))}>
                      <option value="staff">직원</option><option value="owner">원장</option>
                    </select>
                    <button className="btn sm" type="submit">추가</button>
                  </form>
                  <p className="muted" style={{ margin: 0 }}>추가한 Google 계정은 로그인 → 관리자 선택 후 이 학원에 들어올 수 있습니다.</p>
                </div>
              )}

              {activeTab === "데이터" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <section className="settings-section">
                    <h4>백업 및 복원</h4>
                    <p>이 학원의 데이터를 JSON 으로 내보냅니다. 복원은 기관·수납 설정만 덮어씁니다.</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button className="btn ghost sm" type="button" onClick={handleExportData}>내보내기</button>
                      <label className="btn ghost sm" style={{ cursor: "pointer" }}>설정 복원<input type="file" accept="application/json,.json" onChange={handleImportSettings} style={{ display: "none" }} /></label>
                    </div>
                  </section>
                  <section className="settings-section" style={{ background: "var(--primary-soft)" }}>
                    <h4>시연용 데모 데이터</h4>
                    <p>가상 학생 12명, 수업 3개, 수업별 출결, 결제·청구서, 공지, 커뮤니티 예시를 넣습니다.</p>
                    <button className="btn sm" type="button" onClick={handleDemoData}>데모 데이터 넣기</button>
                  </section>
                  <section className="settings-section">
                    <h4>화면 설정 초기화</h4>
                    <p>테마·글자 크기·메뉴 순서만 되돌립니다.</p>
                    <button className="btn danger sm" type="button" onClick={handleResetData}>초기화</button>
                  </section>
                </div>
              )}
            </div>

            {settingsMessage && <div className="fl-banner info" role="status" style={{ marginTop: 14 }}>{settingsMessage}</div>}
            <div className="modal-actions" style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <button className="btn ghost" type="button" onClick={() => setIsSettingsOpen(false)}>닫기</button>
              {isOwner && (activeTab === "기관 정보" || activeTab === "수납") && (
                <button className="btn" type="button" disabled={settingsSaving}
                  onClick={async () => { if (await handleSaveSettings()) setIsSettingsOpen(false); }}>
                  {settingsSaving ? "저장 중…" : "저장"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

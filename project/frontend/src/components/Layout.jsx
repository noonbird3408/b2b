import { useState, useEffect, useMemo } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createAdminAccount, exportAdminData, fetchAdminAccounts, fetchAppSettings, fetchClasses, fetchMe, importAdminSettings, saveAppSettings, signOut, updateAdminAccount } from "../api";
import { resizeImageFile } from "../utils/image";

const SETTINGS_STYLES = `
.settings-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.account-access-list{display:grid;gap:10px;padding-top:14px;border-top:1px solid var(--border);}
.account-access-list>div:first-child{display:grid;gap:2px;}
.account-access-list>div:first-child strong{font-size:13px;}
.account-access-list>div:first-child span,.account-access-list>small{font-size:11px;color:var(--text-3);line-height:1.5;}
.account-access-row{display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;align-items:center;gap:8px;padding:9px;border:1px solid var(--border);background:var(--surface);}
.account-access-row>div{display:grid;gap:2px;min-width:0;}
.account-access-row>div strong{font-size:12px;}
.account-access-row>div span{overflow-wrap:anywhere;color:var(--text-3);font-size:10px;}
.account-access-row label{display:grid;gap:3px;color:var(--text-3);font-size:10px;}
.account-access-row .select{min-width:0;padding:5px;font-size:11px;}
@media(max-width:600px){.settings-form-grid{grid-template-columns:minmax(0,1fr);gap:0;}.account-access-row{grid-template-columns:minmax(0,1fr) 1fr;}.account-access-row>div{grid-column:1/-1;}}
`;

const initialNavItems = [
  { id: "dashboard",   to: "/dashboard",   label: "대시보드", icon: "🏠" },
  { id: "members",     to: "/members",     label: "학생 관리", icon: "👥" },
  { id: "classes",     to: "/classes",     label: "수업 관리", icon: "📒"},
  { id: "attendances", to: "/attendances", label: "출석 체크", icon: "✓" },
  { id: "community",   to: "/community",   label: "커뮤니티",  icon: "🤝" },
  { id: "checkout",    to: "/admin-checkout",    label: "원격결제",  icon: "💳" },
  { id: "AIservice",   to: "/aiservice",   label: "AI비서",  icon: "🤖"},
  { id: "shop",        to: "/shop",        label: "쇼핑몰",   icon: "🛍️" },
];
const STAFF_PATHS = ["/shop"]; // 직원 계정이 Layout 안에서 볼 수 있는 화면

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Layout() {
  const [notifications, setNotifications] = useState(() => readLocalJson("dashboard_notifications", []));
  const [toasts, setToasts] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  // --------------------------------------------------------
  // ⭐ 설정(Settings) 관련 상태 관리
  // --------------------------------------------------------
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("화면/레이아웃");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [newAccount, setNewAccount] = useState({ email: "", username: "", role: "staff" });
  const [adminAccounts, setAdminAccounts] = useState([]);

  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(() => localStorage.getItem("app_theme") || "light");
  const [fontSize, setFontSize] = useState(() => localStorage.getItem("app_font_size") || "normal");
  const [authStatus, setAuthStatus] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [account, setAccount] = useState(() => {
    return { username: "", email: "", provider: "local", role: "owner" };
  });
  const [dragItemIndex, setDragItemIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const [menuOrder, setMenuOrder] = useState(() => {
    const savedOrder = localStorage.getItem("dashboard_menu_order");
    if (!savedOrder) return initialNavItems;
    try {
      const parsed = JSON.parse(savedOrder);
      const normalized = parsed
        .filter((item) => item.id !== "notices" && item.id !== "b2b-shop")
        .map((item) => {
          if (item.id === "checkout") {
            return { ...item, to: "/admin-checkout" };
          }
          return item;
        });
      const existingIds = new Set(normalized.map((item) => item.id));
      return [
        ...normalized,
        ...initialNavItems.filter((item) => !existingIds.has(item.id)),
      ];
    } catch {
      return initialNavItems;
    }
  });

  // [신규] 기관 정보 상태 (학원/도장명, 원장/관장명, 로고 등)
  const [academyInfo, setAcademyInfo] = useState(() => {
    return readLocalJson("app_academy_info", {
      name: "한빛학원",
      branch: "강남캠퍼스",
      principal: "김선생님",
      role: "관리자",
      phone: "010-1234-5678",
      address: "서울시 강남구 테헤란로 123",
      logo: "",
      facilityType: "학원"
    });
  });

  // [신규] 결제 및 수강료 세팅 상태
  const [paymentSettings, setPaymentSettings] = useState(() => {
    return readLocalJson("app_payment_settings", {
      defaultPaymentDay: "1", // 매월 1일
      baseTuitionFee: 200000, // 기본 수강료
      classFees: []           // 수업별 개별 책정 수강료 [{ classId, fee }]
    });
  });

  // 수강료 개별 책정을 위한 클래스 목록 로드
  const [classesList, setClassesList] = useState([]);

  useEffect(() => {
    let current = true;
    // 관리자 모드(active_role=admin)로 선택된 세션만 관리자 셸에 진입
    fetchMe()
      .then((me) => {
        if (!current) return;
        if (me.active_role === "admin" && me.admin) {
          setAccount(me.admin);
          setAuthStatus(true);
        } else {
          setAuthStatus(false);
        }
      })
      .catch(() => {
        if (current) setAuthStatus(false);
      })
      .finally(() => {
        if (current) setAuthChecking(false);
      });
    return () => { current = false; };
  }, []);

  const isOwner = account.role === "owner";

  useEffect(() => {
    if (authChecking || !authStatus || !isOwner) return;
    fetchClasses()
      .then(data => {
        if(Array.isArray(data)) setClassesList(data);
      })
      .catch(err => console.error("클래스 목록을 불러오지 못했습니다.", err));
  }, [authChecking, authStatus, isOwner]);

  useEffect(() => {
    if (authChecking || !authStatus || !isOwner) return;
    fetchAppSettings()
      .then((settings) => {
        if (settings.academy) setAcademyInfo((current) => ({ ...current, ...settings.academy }));
        if (settings.payment) setPaymentSettings((current) => ({ ...current, ...settings.payment }));
      })
      .catch((error) => console.error("기관 설정을 불러오지 못했습니다.", error));
  }, [authChecking, authStatus, isOwner]);

  useEffect(() => {
    if (!isSettingsOpen || activeTab !== "계정 관리" || account.role !== "owner") return;
    fetchAdminAccounts()
      .then(setAdminAccounts)
      .catch((error) => setSettingsMessage(error.response?.data?.detail || "계정 목록을 불러오지 못했습니다."));
  }, [account.role, activeTab, isSettingsOpen]);

  // --------------------------------------------------------
  // ⭐ 로컬 스토리지 자동 동기화 (설정값 저장)
  // --------------------------------------------------------
  useEffect(() => {
    document.body.className = theme === "dark" ? "theme-dark" : "theme-light";
    localStorage.setItem("app_theme", theme);
    document.body.style.fontSize = fontSize === "large" ? "16px" : fontSize === "small" ? "12px" : "14px";
    localStorage.setItem("app_font_size", fontSize);
  }, [theme, fontSize]);

  useEffect(() => {
    localStorage.setItem("dashboard_menu_order", JSON.stringify(menuOrder));
  }, [menuOrder]);

  useEffect(() => {
    localStorage.setItem("app_academy_info", JSON.stringify(academyInfo));
  }, [academyInfo]);

  useEffect(() => {
    localStorage.setItem("app_payment_settings", JSON.stringify(paymentSettings));
  }, [paymentSettings]);

  useEffect(() => {
    localStorage.setItem("dashboard_notifications", JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    if (!authChecking && !authStatus) {
      navigate("/");
    }
  }, [authChecking, authStatus, navigate]);

  useEffect(() => {
    // 직원은 시설 관리 화면에 접근할 수 없음(서버도 403) → 쇼핑몰로 이동
    if (!authChecking && authStatus && account.role === "staff" && !STAFF_PATHS.includes(location.pathname)) {
      navigate("/shop");
    }
  }, [account.role, authChecking, authStatus, location.pathname, navigate]);

  const visibleMenu = isOwner ? menuOrder : menuOrder.filter((item) => STAFF_PATHS.includes(item.to));

  const unreadCount = useMemo(() => notifications.filter(n => !n.isRead).length, [notifications]);

  // 글로벌 실시간 시간 트래킹 엔진 (Background Engine)
  useEffect(() => {
    const checkGlobalActivityTime = () => {
      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayDateStr = now.toISOString().slice(0, 10);

      const savedTodos = localStorage.getItem("dashboard_todos");
      const todos = savedTodos ? JSON.parse(savedTodos) : [];

      const savedKeys = localStorage.getItem("dashboard_notified_keys");
      let notifiedKeys = savedKeys ? JSON.parse(savedKeys) : [];

      let hasUpdates = false;
      let updatedNotifications = [...notifications];

      todos.forEach(todo => {
        const uniqueKey = `${todayDateStr}_${todo.id}_${todo.time}`;

        if (todo.time === currentHHMM && !notifiedKeys.includes(uniqueKey)) {
          const sharedNotificationId = Date.now() + Math.random();

          const newNotif = {
            id: sharedNotificationId,
            text: todo.text,
            time: todo.time,
            isRead: false,
            timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          updatedNotifications = [newNotif, ...updatedNotifications];
          hasUpdates = true;

          const newToast = { id: sharedNotificationId, text: todo.text, time: todo.time };
          setToasts(prev => [...prev, newToast]);
          notifiedKeys.push(uniqueKey);

          setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== newToast.id));
          }, 30000);
        }
      });

      if (hasUpdates) {
        setNotifications(updatedNotifications);
        localStorage.setItem("dashboard_notified_keys", JSON.stringify(notifiedKeys));
      }
    };

    const timerId = setInterval(checkGlobalActivityTime, 5000);
    checkGlobalActivityTime();

    return () => clearInterval(timerId);
  }, [notifications]);

  // --------------------------------------------------------
  // ⭐ 핸들러 함수들
  // --------------------------------------------------------
  const handleNotificationClick = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handleNotificationDelete = (id, e) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleRemoveToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleLogout = async () => {
    try { await signOut(); } catch (error) { console.error("로그아웃 요청 실패:", error); }
    // 공용 PC 에서 다음 사람이 이전 기관 정보·할 일을 보지 않도록 업무 관련 캐시 삭제
    ["app_academy_info", "app_payment_settings", "dashboard_todos", "dashboard_notifications", "dashboard_notified_keys"]
      .forEach((key) => { try { localStorage.removeItem(key); } catch { /* 무시 */ } });
    setAuthStatus(false);
    setAccount({ username: "", email: "", provider: "local", role: "owner" });
    navigate("/");
  };

  const moveMenuItem = (index, direction) => {
    const newOrder = [...menuOrder];
    if (direction === "up" && index > 0) {
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    } else if (direction === "down" && index < newOrder.length - 1) {
      [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
    }
    setMenuOrder(newOrder);
  };

  const handleDragStart = (index) => (event) => {
    setDragItemIndex(index);
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", String(index));
    } catch {
      // 일부 브라우저는 text/plain 설정을 제한할 수 있습니다.
    }
  };

  const handleDragOver = (index) => (event) => {
    event.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index) => (event) => {
    event.preventDefault();
    const sourceIndex = dragItemIndex !== null ? dragItemIndex : Number(event.dataTransfer.getData("text/plain"));
    if (sourceIndex === index || sourceIndex < 0 || sourceIndex >= menuOrder.length) {
      setDragItemIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newOrder = [...menuOrder];
    const [moved] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(index, 0, moved);
    setMenuOrder(newOrder);
    setDragItemIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragItemIndex(null);
    setDragOverIndex(null);
  };

  const handleResetData = () => {
    if (window.confirm("이 브라우저의 테마, 글자 크기, 메뉴 순서와 알림만 초기화합니다. 계정·기관 설정·주문·학생 데이터는 유지됩니다. 계속할까요?")) {
      ["app_theme", "app_font_size", "dashboard_menu_order", "dashboard_notifications", "dashboard_notified_keys"].forEach((key) => localStorage.removeItem(key));
      setTheme("light");
      setFontSize("normal");
      setMenuOrder(initialNavItems);
      setNotifications([]);
      setSettingsMessage("화면 환경 설정만 초기화했습니다. 업무 데이터는 보존했습니다.");
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsMessage("");
    try {
      const saved = await saveAppSettings({ academy: academyInfo, payment: paymentSettings });
      setAcademyInfo(saved.academy);
      setPaymentSettings(saved.payment);
      setSettingsMessage("기관 및 수납 설정을 데이터베이스에 저장했습니다.");
      return true;
    } catch (error) {
      setSettingsMessage(error.response?.data?.detail || "설정을 저장하지 못했습니다. 서버 연결과 권한을 확인하세요.");
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
      setAdminAccounts((current) => [...current, created]);
      setNewAccount({ email: "", username: "", role: "staff" });
      setSettingsMessage(`${created.email} 을(를) 등록했습니다. 이 Google 계정은 로그인 후 '관리자'를 선택하면 바로 들어올 수 있습니다.`);
    } catch (error) {
      setSettingsMessage(error.response?.data?.detail || "계정을 등록하지 못했습니다.");
    }
  };

  const handleAccountAccessChange = async (target, field, value) => {
    const payload = {
      role: field === "role" ? value : target.role,
      pricing_tier: field === "pricing_tier" ? value : target.pricing_tier,
    };
    try {
      const updated = await updateAdminAccount(target.account_id, payload);
      setAdminAccounts((current) => current.map((row) => row.account_id === updated.account_id ? updated : row));
      setSettingsMessage(`${updated.email} 계정 설정을 저장했습니다.`);
    } catch (error) {
      setSettingsMessage(error.response?.data?.detail || "계정 권한을 저장하지 못했습니다.");
      fetchAdminAccounts().then(setAdminAccounts).catch(() => {});
    }
  };

  const handleExportData = async () => {
    try {
      const payload = await exportAdminData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `facility-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setSettingsMessage("기관 설정과 쇼핑몰 주문 내역을 내보냈습니다.");
    } catch (error) {
      setSettingsMessage(error.response?.data?.detail || "데이터를 내보내지 못했습니다.");
    }
  };

  const handleImportSettings = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const settings = payload.settings || payload;
      if (!settings.academy || !settings.payment) throw new Error("기관 및 수납 설정이 포함된 JSON 파일이 아닙니다.");
      const saved = await importAdminSettings(settings);
      setAcademyInfo(saved.settings?.academy || settings.academy);
      setPaymentSettings(saved.settings?.payment || settings.payment);
      setSettingsMessage("기관 및 수납 설정을 복원했습니다. 기존 주문·학생 정보는 변경하지 않았습니다.");
    } catch (error) {
      setSettingsMessage(error.response?.data?.detail || error.message || "설정 파일을 복원하지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const logo = await resizeImageFile(file, "logo");   // 256px PNG 로 줄여 저장
      setAcademyInfo(prev => ({ ...prev, logo }));
    } catch (error) {
      setSettingsMessage(error.message);
    }
  };

  if (authChecking) return <div className="auth-loading">관리자 세션을 확인하고 있습니다.</div>;
  if (!authStatus) return null;

  return (
    <div className="app-shell app-shell-responsive">
      <aside className="sidebar">
        {/* ⭐ 설정된 학원명/로고를 동적으로 렌더링 */}
        <div className="sidebar-brand">
          <div className="sidebar-logo" style={{ overflow: 'hidden', padding: academyInfo.logo ? 0 : undefined, background: academyInfo.logo ? "transparent" : "var(--primary)" }}>
            {academyInfo.logo ? (
              <img src={academyInfo.logo} alt="로고" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              academyInfo.name ? academyInfo.name.charAt(0) : "학"
            )}
          </div>
          <div>
            <div className="sidebar-brand-name">{academyInfo.name || "학원명 미설정"}</div>
            <div className="sidebar-brand-sub">{academyInfo.branch || "지점명"}</div>
          </div>
        </div>

        <div className="sidebar-section-label">메뉴</div>
        <nav>
          {visibleMenu.map((item, index) => (
            <NavLink
              key={item.id}
              to={item.to}
              draggable={isOwner}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDrop={handleDrop(index)}
              onDragEnd={handleDragEnd}
              className={({ isActive }) => {
                const base = isActive ? "nav-link active" : "nav-link";
                return dragOverIndex === index ? `${base} drag-over` : base;
              }}
            >
              <span style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "community" && (
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 9999, background: "var(--primary)", color: "#fff" }}>N</span>
              )}
              {item.id === "checkout" && (
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 9999, background: "var(--danger-soft)", color: "var(--danger-text)" }}>미납</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* ⭐ 설정된 원장님 이름/직책을 동적으로 렌더링 */}
        <div className="sidebar-foot">
          <div className="avatar">
            {academyInfo.principal ? academyInfo.principal.charAt(0) : "원"}
          </div>
          <div>
            <div className="sidebar-foot-name">{academyInfo.principal || "이름 미설정"}</div>
            <div className="sidebar-foot-role">{academyInfo.role || "관리자"} · {authStatus ? account.username : "로그아웃 상태"}</div>
          </div>
          {isOwner ? (
            <div
              className="sidebar-foot-gear"
              onClick={() => setIsSettingsOpen(true)}
              style={{ cursor: "pointer" }}
              title="통합 환경 설정"
            >
              ⚙
            </div>
          ) : (
            <button type="button" className="sidebar-foot-gear" onClick={handleLogout} title="로그아웃" style={{ border: 0, background: "transparent", cursor: "pointer" }}>⎋</button>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-search">
            <input placeholder="학생 이름 또는 전화번호 검색" />
            <span className="kbd">⌘K</span>
          </div>
          
          <button type="button" className="btn ghost sm" style={{ marginLeft: "auto", marginRight: 8 }} onClick={() => navigate("/")}>역할 변경</button>
          <div className="topbar-bell-wrapper">
            <button className="topbar-bell" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
              🔔
              {unreadCount > 0 && (
                <span className="topbar-bell-badge">{unreadCount}</span>
              )}
            </button>

            {isDropdownOpen && (
              <div className="notification-dropdown">
                <div className="notification-header">실시간 업무 알림 센터</div>
                {notifications.length === 0 ? (
                  <div className="notification-empty">도착한 정시 알림 내역이 없습니다.</div>
                ) : (
                  notifications.map((n) => (
                    <div 
                      key={n.id} 
                      className={`notification-item ${n.isRead ? '' : 'unread'}`}
                      onClick={() => handleNotificationClick(n.id)}
                    >
                      <div className="notification-item-body">
                        <div className="notification-item-text">
                          <span className="notification-notif-time">[{n.time}]</span> {n.text}
                        </div>
                        <div className="notification-item-meta">
                          {n.timestamp} · {n.isRead ? "확인됨" : "새 알림"}
                        </div>
                      </div>
                      <button 
                        className="notification-del-btn"
                        onClick={(e) => handleNotificationDelete(n.id, e)}
                      >
                        삭제
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="page">
          <Outlet />
        </div>
      </main>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast-item">
            <div className="toast-content">
              <div className="toast-title">📅 오늘의 할 일</div>
              <div className="toast-text">
                <span className="toast-time">[{t.time}]</span> {t.text}
              </div>
            </div>
            <button className="toast-close-btn" onClick={() => handleRemoveToast(t.id)}>✕</button>
          </div>
        ))}
      </div>

      {/* ⭐ 대폭 업그레이드된 설정 모달창 (Settings Modal) */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: "min(540px, 96vw)", maxHeight: "90vh", overflowY: "auto" }}>
            <style>{SETTINGS_STYLES}</style>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0 }}>통합 환경 설정</h3>
              <button 
                className="btn ghost sm"
                onClick={() => setIsSettingsOpen(false)}
                style={{ padding: "4px 8px", minHeight: "auto", border: "none", background: "transparent", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* 탭 네비게이션 (Tab Navigation) */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: "20px" }}>
              {["화면/레이아웃", "기관 정보", "수납/결제", "계정 관리", "데이터 관리"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, padding: "10px", background: "none", border: "none",
                    borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent",
                    color: activeTab === tab ? "var(--primary)" : "var(--text-2)",
                    fontWeight: activeTab === tab ? "bold" : "normal", cursor: "pointer", transition: "all 0.2s"
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
            
            {/* 탭 내용 영역 (Tab Contents) */}
            <div style={{ minHeight: "320px" }}>
              
              {/* 1. 화면/레이아웃 탭 */}
              {activeTab === "화면/레이아웃" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="form-row">
                      <label>테마 (Theme)</label>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className={theme === "light" ? "btn" : "btn ghost"}
                          onClick={() => setTheme("light")}
                        >라이트</button>
                        <button
                          type="button"
                          className={theme === "dark" ? "btn" : "btn ghost"}
                          onClick={() => setTheme("dark")}
                        >다크</button>
                      </div>
                    </div>
                    <div className="form-row">
                      <label>글씨체 크기</label>
                      <select className="select" value={fontSize} onChange={(e) => setFontSize(e.target.value)}>
                        <option value="small">작게</option>
                        <option value="normal">보통</option>
                        <option value="large">크게</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "12px", fontWeight: "bold", fontSize: "14px", color: "var(--text-2)" }}>
                      사이드바 메뉴 순서 변경
                    </label>
                    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                      {menuOrder.map((item, index) => (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={handleDragStart(index)}
                          onDragOver={handleDragOver(index)}
                          onDrop={handleDrop(index)}
                          onDragEnd={handleDragEnd}
                          style={{ 
                            display: "flex", justifyContent: "space-between", alignItems: "center", 
                            padding: "10px 16px", borderBottom: index !== menuOrder.length - 1 ? "1px solid var(--border)" : "none",
                            background: dragOverIndex === index ? "var(--surface-hover)" : "var(--surface)",
                            cursor: "grab"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span>{item.icon}</span> <span>{item.label}</span>
                          </div>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button onClick={() => moveMenuItem(index, "up")} disabled={index === 0} style={{ padding: "4px 8px", cursor: index === 0 ? "not-allowed" : "pointer", background: "var(--surface-hover)", border: "1px solid var(--border)", borderRadius: "4px", opacity: index === 0 ? 0.5 : 1 }}>▲</button>
                            <button onClick={() => moveMenuItem(index, "down")} disabled={index === menuOrder.length - 1} style={{ padding: "4px 8px", cursor: index === menuOrder.length - 1 ? "not-allowed" : "pointer", background: "var(--surface-hover)", border: "1px solid var(--border)", borderRadius: "4px", opacity: index === menuOrder.length - 1 ? 0.5 : 1 }}>▼</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 2. 기관 정보 설정 탭 (도장명, 관장명, 로고 등) */}
              {activeTab === "기관 정보" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="form-row">
                    <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold", fontSize: "14px" }}>로고 이미지 등록</label>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--surface-hover)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid var(--border)" }}>
                        {academyInfo.logo ? <img src={academyInfo.logo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="logo"/> : <span style={{fontSize: 12, color: "var(--text-3)"}}>로고</span>}
                      </div>
                      <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ fontSize: "12px", flex: 1 }} />
                      {academyInfo.logo && (
                        <button className="btn sm ghost" onClick={() => setAcademyInfo({...academyInfo, logo: ""})}>삭제</button>
                      )}
                    </div>
                  </div>

                  <div className="form-row">
                    <label>시설 유형</label>
                    <select className="select" value={academyInfo.facilityType || "학원"} onChange={(e) => setAcademyInfo({ ...academyInfo, facilityType: e.target.value })}>
                      {["학원", "체육관", "도장", "기타"].map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>쇼핑몰 추천 등 시설 유형별 기능에 사용됩니다.</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="form-row">
                      <label>도장/학원 이름</label>
                      <input type="text" className="input" value={academyInfo.name} onChange={(e) => setAcademyInfo({...academyInfo, name: e.target.value})} placeholder="예: 한빛학원" />
                    </div>
                    <div className="form-row">
                      <label>지점명 (캠퍼스)</label>
                      <input type="text" className="input" value={academyInfo.branch} onChange={(e) => setAcademyInfo({...academyInfo, branch: e.target.value})} placeholder="예: 강남캠퍼스" />
                    </div>
                    <div className="form-row">
                      <label>관장/원장 이름</label>
                      <input type="text" className="input" value={academyInfo.principal} onChange={(e) => setAcademyInfo({...academyInfo, principal: e.target.value})} placeholder="예: 김선생님" />
                    </div>
                    <div className="form-row">
                      <label>관리자 직책</label>
                      <input type="text" className="input" value={academyInfo.role} onChange={(e) => setAcademyInfo({...academyInfo, role: e.target.value})} placeholder="예: 원장" />
                    </div>
                  </div>

                  <div className="form-row">
                    <label>대표 연락처</label>
                    <input type="text" className="input" value={academyInfo.phone} onChange={(e) => setAcademyInfo({...academyInfo, phone: e.target.value})} placeholder="예: 02-123-4567" />
                  </div>
                  <div className="form-row">
                    <label>도장/학원 주소</label>
                    <input type="text" className="input" value={academyInfo.address} onChange={(e) => setAcademyInfo({...academyInfo, address: e.target.value})} placeholder="상세 주소를 입력하세요" />
                  </div>
                </div>
              )}

              {/* 3. 수납/결제 세팅 탭 */}
              {activeTab === "수납/결제" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div className="settings-form-grid">
                    <div className="form-row">
                      <label>기본 결제일(수납일)</label>
                      <select className="select" value={paymentSettings.defaultPaymentDay} onChange={(e) => setPaymentSettings({...paymentSettings, defaultPaymentDay: e.target.value})}>
                        {[...Array(31)].map((_, i) => (
                          <option key={i+1} value={i+1}>매월 {i+1}일</option>
                        ))}
                        <option value="last">매월 말일</option>
                      </select>
                    </div>
                    <div className="form-row">
                      <label>전체 기본 수강료 (원)</label>
                      <input 
                        type="number" 
                        className="input" 
                        value={paymentSettings.baseTuitionFee} 
                        onChange={(e) => setPaymentSettings({...paymentSettings, baseTuitionFee: Number(e.target.value)})} 
                      />
                    </div>
                  </div>

                  <div className="settings-form-grid">
                    <div className="form-row">
                      <label>B2B 기본 정산 방식</label>
                      <select className="select" value={paymentSettings.b2bPaymentMethod || "카카오페이"} onChange={(event) => setPaymentSettings((current) => ({ ...current, b2bPaymentMethod: event.target.value }))}>
                        <option>카카오페이</option>
                        <option>월말 일괄 정산</option>
                        <option>세금계산서 요청</option>
                      </select>
                    </div>
                    <div className="form-row">
                      <label>세금계산서 수신 이메일</label>
                      <input type="email" className="input" value={paymentSettings.taxInvoiceEmail || ""} onChange={(event) => setPaymentSettings((current) => ({ ...current, taxInvoiceEmail: event.target.value }))} placeholder="billing@example.kr" />
                    </div>
                  </div>
 
                  <div className="form-row">
                    <label>수업별 수강료 개별 책정</label>
                    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "12px", maxHeight: "160px", overflowY: "auto", background: "var(--surface-2)" }}>
                      {classesList.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--text-3)", textAlign: "center", padding: "10px 0" }}>
                          등록된 수업이 없습니다. 수업 메뉴에서 추가해주세요.
                        </div>
                      ) : (
                        classesList.map(cls => {
                          const clsId = cls.id || cls.class_id;
                          const customFeeObj = paymentSettings.classFees.find(c => String(c.classId) === String(clsId));
                          const customFee = customFeeObj ? customFeeObj.fee : "";
                           
                          return (
                            <div key={clsId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                              <span style={{ fontSize: "13px", fontWeight: 500 }}>{cls.name}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <input 
                                  type="number" 
                                  className="input" 
                                  style={{ width: "130px", height: "32px", fontSize: "13px" }}
                                  placeholder="기본 수강료 적용"
                                  value={customFee}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPaymentSettings(prev => {
                                      const filtered = prev.classFees.filter(c => String(c.classId) !== String(clsId));
                                      if (val === "") return { ...prev, classFees: filtered };
                                      return { ...prev, classFees: [...filtered, { classId: clsId, fee: Number(val) }] };
                                    });
                                  }}
                                />
                                <span style={{ fontSize: "13px", color: "var(--text-2)" }}>원</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "4px", display: "inline-block" }}>
                      ※ 비워두면 상단에 설정된 '전체 기본 수강료'가 자동으로 적용됩니다.
                    </span>
                  </div>
                </div>
              )}

              {activeTab === "계정 관리" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  {authStatus ? (
                    <div style={{ display: "grid", gap: "14px", padding: "18px", background: "var(--surface-2)", borderRadius: "12px", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>현재 로그인 계정</div>
                        <div style={{ fontSize: "13px", color: "var(--text-2)" }}>
                          {account.username} · {account.email}
                        </div>
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-2)" }}>
                        로그인 방식: {account.provider === "google" ? "Google 계정" : "이메일 계정"} · 권한: {account.role === "owner" ? "관리자" : "직원"}
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button className="btn danger" onClick={handleLogout}>로그아웃</button>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>Google 계정으로 로그인합니다. 비밀번호는 Google 계정 보안 설정에서 관리하세요.</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn ghost sm" type="button" onClick={() => navigate("/")}>학부모/관리자 역할 변경</button>
                      </div>
                      {account.role === "owner" && <section className="account-access-list">
                      <div><strong>계정 및 계약 등급</strong><span>가격 등급은 B2B 주문의 서버 가격 계산에 적용됩니다.</span></div>
                      {adminAccounts.map((managedAccount) => <div className="account-access-row" key={managedAccount.account_id}>
                        <div><strong>{managedAccount.username}</strong><span>{managedAccount.email}</span></div>
                        <label>역할<select className="select" value={managedAccount.role} onChange={(event) => handleAccountAccessChange(managedAccount, "role", event.target.value)}><option value="owner">관리자</option><option value="staff">직원</option></select></label>
                        <label>계약 등급<select className="select" value={managedAccount.pricing_tier} onChange={(event) => handleAccountAccessChange(managedAccount, "pricing_tier", event.target.value)}><option value="STANDARD">일반</option><option value="VIP">VIP</option></select></label>
                      </div>)}
                      <form onSubmit={handleCreateAccount} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 90px auto", gap: 8, alignItems: "end" }}>
                        <input className="input" type="email" required placeholder="추가할 Google 이메일" value={newAccount.email} onChange={(e) => setNewAccount((c) => ({ ...c, email: e.target.value }))} />
                        <input className="input" placeholder="이름(선택)" value={newAccount.username} onChange={(e) => setNewAccount((c) => ({ ...c, username: e.target.value }))} />
                        <select className="select" value={newAccount.role} onChange={(e) => setNewAccount((c) => ({ ...c, role: e.target.value }))}><option value="staff">직원</option><option value="owner">관리자</option></select>
                        <button className="btn sm" type="submit">등록</button>
                      </form>
                      <small>등록한 Google 계정은 로그인 후 '관리자'를 선택하면 초대 코드 없이 들어옵니다. (초대 코드: ADMIN_SIGNUP_CODE / STAFF_SIGNUP_CODE)</small>
                      </section>}
                    </div>
                  ) : null}
                </div>
              )}

              {/* 4. 데이터 관리 탭 */}
              {activeTab === "데이터 관리" && (
                <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                  <section style={{ padding: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    <h4 style={{ margin: "0 0 5px" }}>백업 및 복원</h4>
                    <p style={{ margin: "0 0 12px", color: "var(--text-2)", fontSize: 12, lineHeight: 1.6 }}>학생 연락처 등 개인정보, 수업, 출결, 결제, 청구서와 B2B 주문을 포함한 전체 백업을 JSON으로 내보냅니다. 복원은 기관·수납 설정만 덮어씁니다.</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button className="btn ghost sm" type="button" onClick={handleExportData}>데이터 내보내기</button>
                      <label className="btn ghost sm" style={{ cursor: "pointer" }}>설정 파일 복원<input type="file" accept="application/json,.json" onChange={handleImportSettings} style={{ display: "none" }} /></label>
                    </div>
                  </section>
                  <section style={{ padding: 16, border: "1px solid var(--border)" }}>
                    <h4 style={{ margin: "0 0 5px" }}>화면 환경 초기화</h4>
                    <p style={{ margin: "0 0 12px", color: "var(--text-2)", fontSize: 12, lineHeight: 1.6 }}>테마, 글자 크기, 메뉴 순서와 브라우저 알림만 기본값으로 되돌립니다. 서버의 계정·학생·결제·주문 데이터는 유지됩니다.</p>
                    <button className="btn danger sm" type="button" onClick={handleResetData}>화면 설정 초기화</button>
                  </section>
                </div>
              )}

            </div>

            {settingsMessage && <div role="status" style={{ marginTop: 14, padding: "9px 12px", background: "var(--primary-soft)", color: "var(--primary-text)", fontSize: 12 }}>{settingsMessage}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
              <button 
                className="btn ghost" 
                onClick={() => setIsSettingsOpen(false)}
                style={{ padding: "8px 16px", background: "var(--surface-hover)", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                닫기
              </button>
              <button 
                className="btn" 
                onClick={async () => {
                  const saved = await handleSaveSettings();
                  if (saved) setIsSettingsOpen(false);
                }}
                disabled={settingsSaving}
                style={{ padding: "8px 16px", background: "var(--primary)", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                {settingsSaving ? "저장 중..." : "저장 및 닫기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
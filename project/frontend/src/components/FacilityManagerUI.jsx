import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { devSignIn, fetchGoogleAuthConfig, fetchMe, selectRole, signInWithGoogle, signOut } from "../api";

// =====================================================================
// 디자인 시스템
// =====================================================================
const STYLES = `
.fm-root *{box-sizing:border-box;}
.fm-root{font-family:var(--font-sans);color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 1;}
.fm-root button{font-family:inherit;cursor:pointer;}
.public-wrap{min-height:100vh;background:linear-gradient(160deg, rgba(59,130,246,0.12) 0%, var(--bg) 40%);display:flex;flex-direction:column;}
.public-header{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 28px;display:flex;align-items:center;gap:12px;}
.public-header .logo{width:34px;height:34px;background:var(--primary);border-radius:8px;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;}
.public-body{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 20px;}
.landing-hero{text-align:center;max-width:760px;width:100%;}
.landing-hero h1{font-size:30px;font-weight:800;letter-spacing:-.025em;margin:0 0 8px;}
.landing-hero p{font-size:15px;color:var(--text-2);margin:0 0 32px;}
.choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
@media (max-width:680px){.choice-grid{grid-template-columns:1fr;}}
.choice-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:30px 26px;text-align:left;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s;}
.choice-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg);border-color:var(--primary);}
.choice-card .ico{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:16px;}
.choice-card h2{font-size:19px;font-weight:700;margin:0 0 6px;}
.choice-card p{font-size:13px;color:var(--text-2);margin:0 0 16px;line-height:1.55;}
.choice-card .go{font-size:13px;font-weight:700;color:var(--primary);}
.admin-tools{max-width:820px;width:100%;}
.admin-tools-heading{text-align:center;margin-bottom:24px;}
.admin-tools-heading h1{font-size:25px;margin:0 0 6px;}
.admin-tools-heading p{font-size:13px;color:var(--text-2);margin:0;}
.admin-tools-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
.admin-tool-card{display:flex;flex-direction:column;align-items:flex-start;width:100%;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:12px;text-align:left;transition:border-color .15s,transform .15s,box-shadow .15s;}
.admin-tool-card:hover{transform:translateY(-2px);border-color:var(--primary);box-shadow:var(--shadow);}
.admin-tool-card .ico{width:46px;height:46px;display:grid;place-items:center;margin-bottom:14px;border-radius:8px;font-size:23px;}
.admin-tool-card h2{font-size:17px;margin:0 0 5px;}
.admin-tool-card p{font-size:12px;color:var(--text-2);margin:0 0 17px;line-height:1.6;}
.admin-tool-card .go{margin-top:auto;color:var(--primary-text);font-size:12px;font-weight:700;}
.admin-tools-actions{display:flex;justify-content:center;gap:10px;margin-top:18px;}
.auth-divider{display:flex;align-items:center;gap:10px;margin:18px 0 12px;color:var(--text-3);font-size:11px;}
.auth-divider:before,.auth-divider:after{content:"";height:1px;flex:1;background:var(--border);}
.google-button-wrap{display:flex;justify-content:center;min-height:42px;}
.google-disabled{padding:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-3);font-size:11px;line-height:1.5;}
.auth-mode-toggle{width:100%;margin-top:12px;padding:8px;border:0;background:transparent;color:var(--primary-text);font:inherit;font-size:12px;font-weight:700;}
@media (max-width:680px){.admin-tools-grid{grid-template-columns:1fr;gap:10px;}.admin-tool-card{padding:17px;}.admin-tools-heading h1{font-size:21px;}.admin-tools-actions{flex-direction:column;}.admin-tools-actions .btn{justify-content:center;}}
.public-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;width:min(520px,94vw);box-shadow:var(--shadow-lg);}
.public-card h2{font-size:20px;font-weight:700;margin:0 0 4px;}
.public-card .sub{font-size:13px;color:var(--text-2);margin:0 0 20px;}
.hint-box{background:var(--primary-soft);color:var(--primary-text);border-radius:8px;padding:9px 12px;font-size:12px;margin-bottom:16px;line-height:1.6;}
.form-row{margin-bottom:14px;}
.form-row label{display:block;font-size:12px;color:var(--text-2);margin-bottom:5px;font-weight:500;}
.form-row .input,.form-row .select{width:100%;}
.form-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;}
.input,.select{font-family:inherit;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);transition:border-color .12s;min-height:36px;}
.input:focus,.select:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(59,130,246,.1);}
.btn{font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;border:1px solid transparent;background:var(--primary);color:#fff;transition:background .12s;min-height:36px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}
.btn:hover{background:var(--primary-hover);}
.btn.ghost{background:var(--surface);color:var(--text);border-color:var(--border);font-weight:500;}
.btn.ghost:hover{background:var(--surface-hover);}
.btn.danger{background:transparent;color:var(--danger);border-color:var(--border);font-weight:500;}
.btn.danger:hover{background:var(--danger-soft);}
.btn.sm{padding:5px 10px;font-size:12px;min-height:28px;}
.linkbtn{background:none;border:none;color:var(--text-2);font-size:13px;cursor:pointer;padding:6px 8px;border-radius:6px;}
.linkbtn:hover{background:var(--surface-hover);color:var(--text);}
.empty{padding:56px 20px;text-align:center;color:var(--text-3);font-size:13px;background:var(--surface);border:1px dashed var(--border-strong);border-radius:var(--radius-lg);}
.role-card{position:relative;}
.role-card .invite{margin-top:12px;display:grid;gap:6px;}
.role-card .invite .input{width:100%;}
.role-card[aria-disabled="true"]{opacity:.6;cursor:wait;}
.user-chip{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:12px;color:var(--text-2);}
.user-chip img{width:28px;height:28px;border-radius:50%;}
.dev-login{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);display:grid;gap:8px;}
`;

function Banner({ tone, children }) {
  const map = {
    success: ["var(--success-soft)", "var(--success-text)", "var(--success)"],
    warning: ["var(--warning-soft)", "var(--warning-text)", "var(--warning)"],
    danger: ["var(--danger-soft)", "var(--danger-text)", "var(--danger)"],
  };
  const [bg, color, border] = map[tone] || map.warning;
  return (
    <div role="alert" style={{ background: bg, color, border: `1px solid ${border}`, borderRadius: 8,
      padding: "10px 14px", fontSize: 13, fontWeight: 500, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Header({ title, me, onLogout, onBack }) {
  return (
    <div className="public-header">
      <div className="logo">학</div>
      <div className="sidebar-brand-name">{title}</div>
      {me ? (
        <div className="user-chip">
          {me.user.picture && <img src={me.user.picture} alt="" referrerPolicy="no-referrer" />}
          <span>{me.user.name || me.user.email}</span>
          {onBack && <button className="linkbtn" onClick={onBack}>역할 선택</button>}
          <button className="linkbtn" onClick={onLogout}>로그아웃</button>
        </div>
      ) : null}
    </div>
  );
}

function GoogleSignInButton({ config, disabled, onCredential }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!config?.enabled || !buttonRef.current || disabled) return undefined;
    let timer;
    let attempts = 0;
    const drawButton = () => {
      const identity = window.google?.accounts?.id;
      if (!identity) {
        if (attempts++ < 40) timer = window.setTimeout(drawButton, 250); // GIS 스크립트 로딩 대기
        return;
      }
      buttonRef.current.replaceChildren();
      identity.initialize({ client_id: config.client_id, callback: (result) => result.credential && onCredential(result.credential) });
      identity.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "continue_with", width: 300, locale: "ko" });
    };
    drawButton();
    return () => window.clearTimeout(timer);
  }, [config, disabled, onCredential]);

  if (!config?.enabled) {
    return <div className="google-disabled">Google 로그인을 사용하려면 서버에 GOOGLE_CLIENT_ID 설정이 필요합니다. (README 참고)</div>;
  }
  return <div className="google-button-wrap" ref={buttonRef} aria-label="Google 계정으로 계속하기" />;
}

/* 1단계: Google 로그인 */
function LoginScreen({ config, error, busy, onCredential, onDevLogin }) {
  const [devEmail, setDevEmail] = useState("");
  return (
    <div className="public-wrap">
      <Header title="시설 통합 관리 시스템" />
      <div className="public-body">
        <div className="public-card" style={{ width: "min(420px,94vw)", textAlign: "center" }}>
          <h2>로그인</h2>
          <div className="sub">Google 계정으로 로그인한 뒤 학부모 또는 관리자 화면을 선택합니다.</div>
          {error && <Banner tone="danger">{error}</Banner>}
          <GoogleSignInButton config={config} disabled={busy} onCredential={onCredential} />
          {config?.dev_login && (
            <form className="dev-login" onSubmit={(e) => { e.preventDefault(); onDevLogin(devEmail); }}>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>개발 모드 로그인 (DEV_LOGIN_ENABLED=true, 로컬 전용)</span>
              <input className="input" type="email" placeholder="test@example.com" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} required />
              <button className="btn ghost" type="submit" disabled={busy} style={{ justifyContent: "center" }}>개발용으로 로그인</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* 2단계: 역할 선택 (학부모 / 관리자) — 관리자 권한은 서버가 판정 */
function RoleSelect({ me, error, busy, onParent, onAdmin, onLogout }) {
  const [inviteCode, setInviteCode] = useState("");
  const [showInvite, setShowInvite] = useState(!me.can_admin);
  return (
    <div className="public-wrap">
      <Header title="역할 선택" me={me} onLogout={onLogout} />
      <div className="public-body">
        <div className="landing-hero">
          <h1>어떤 화면으로 들어갈까요?</h1>
          <p>{me.user.name || me.user.email} 님, 이용할 역할을 선택하세요. 언제든 다시 바꿀 수 있습니다.</p>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="choice-grid">
            <div className="choice-card role-card" role="button" tabIndex={0} aria-disabled={busy}
              onClick={() => !busy && onParent()} onKeyDown={(e) => e.key === "Enter" && !busy && onParent()}>
              <div className="ico" style={{ background: "var(--primary-soft)" }}>👪</div>
              <h2>학부모</h2>
              <p>자녀 출결 확인, 수강료 결제, 공지사항과 커뮤니티를 이용합니다.</p>
              <div className="go">학부모 화면으로 →</div>
            </div>
            <div className="choice-card role-card" role="button" tabIndex={0} aria-disabled={busy}
              onClick={() => !busy && onAdmin(inviteCode)} onKeyDown={(e) => e.key === "Enter" && !busy && onAdmin(inviteCode)}>
              <div className="ico" style={{ background: "var(--warning-soft)" }}>🔐</div>
              <h2>관리자</h2>
              <p>시설 관리(학생·수업·출결·결제)와 쇼핑몰 추천을 이용합니다.</p>
              {me.can_admin
                ? <div className="go">{me.admin?.role === "staff" ? "직원" : "원장"} 계정으로 들어가기 →</div>
                : <div className="go">초대 코드로 관리자 등록 →</div>}
              {showInvite ? (
                <div className="invite" onClick={(e) => e.stopPropagation()}>
                  <input className="input" placeholder="관리자/직원 초대 코드" value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)} autoComplete="one-time-code" />
                  <small style={{ color: "var(--text-3)", fontSize: 11 }}>원장이 이메일을 미리 등록했다면 코드 없이 들어갈 수 있습니다.</small>
                </div>
              ) : (
                <button type="button" className="auth-mode-toggle" onClick={(e) => { e.stopPropagation(); setShowInvite(true); }}>초대 코드 입력</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 3단계(관리자): 시설 관리 / 쇼핑몰 선택 */
function AdminWorkspace({ me, onFacility, onShop, onB2B, onBack, onLogout }) {
  const isOwner = me.admin?.role === "owner";
  return (
    <div className="public-wrap">
      <Header title="관리자 업무 선택" me={me} onBack={onBack} onLogout={onLogout} />
      <div className="public-body">
        <div className="admin-tools">
          <div className="admin-tools-heading">
            <h1>어떤 업무를 시작할까요?</h1>
            <p>{isOwner ? "원장" : "직원"} 계정 · 나머지 기능은 관리자 메뉴에서 계속 이용할 수 있습니다.</p>
          </div>
          <div className="admin-tools-grid">
            {isOwner && (
              <button type="button" className="admin-tool-card" onClick={onFacility}>
                <span className="ico" style={{ background: "var(--primary-soft)" }}>🏫</span>
                <h2>시설 관리</h2>
                <p>대시보드, 학생·수업·출결, 커뮤니티, 원격결제, AI 비서를 관리합니다.</p>
                <span className="go">시설 관리 열기 →</span>
              </button>
            )}
            <button type="button" className="admin-tool-card" onClick={onShop}>
              <span className="ico" style={{ background: "var(--success-soft)" }}>🛍️</span>
              <h2>쇼핑몰</h2>
              <p>DDM 쇼핑몰(ddmmall77.com) 단체복·키링·매달을 우리 시설 일정에 맞춰 추천받습니다.</p>
              <span className="go">쇼핑몰 열기 →</span>
            </button>
          </div>
          <div className="admin-tools-actions">
            <button type="button" className="btn ghost" onClick={onB2B}>B2B 교재·물품 발주</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FacilityManagerUI() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(true);
  const [screen, setScreen] = useState("login"); // login → role → admin-tools
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchGoogleAuthConfig().then(setConfig).catch(() => setConfig({ enabled: false }));
    fetchMe()
      .then((current) => {
        setMe(current);
        setScreen(current.active_role === "admin" && current.can_admin ? "admin-tools" : "role");
      })
      .catch(() => setScreen("login"))
      .finally(() => setChecking(false));
  }, []);

  const run = async (task, fallback) => {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (err) {
      setError(err.response?.data?.detail || fallback);
    } finally {
      setBusy(false);
    }
  };

  const afterLogin = (current) => { setMe(current); setScreen("role"); };
  const handleCredential = useCallback(
    (credential) => run(async () => afterLogin(await signInWithGoogle(credential)), "Google 계정 인증에 실패했습니다."),
    [],
  );
  const handleDevLogin = (email) => run(async () => afterLogin(await devSignIn(email, email.split("@")[0])), "개발용 로그인에 실패했습니다.");
  const handleParent = () => run(async () => { await selectRole("parent"); navigate("/parentportal"); }, "학부모 모드로 전환하지 못했습니다.");
  const handleAdmin = (inviteCode) => run(async () => {
    const current = await selectRole("admin", inviteCode.trim());
    setMe(current);
    setScreen("admin-tools");
  }, "관리자 권한을 확인하지 못했습니다.");
  const handleLogout = () => run(async () => {
    try { await signOut(); } finally { window.google?.accounts?.id?.disableAutoSelect?.(); setMe(null); setScreen("login"); }
  }, "로그아웃하지 못했습니다.");

  if (checking) return <div className="auth-loading">로그인 상태를 확인하고 있습니다.</div>;

  return (
    <div className="fm-root">
      <style>{STYLES}</style>
      {screen === "login" || !me ? (
        <LoginScreen config={config} error={error} busy={busy} onCredential={handleCredential} onDevLogin={handleDevLogin} />
      ) : screen === "role" ? (
        <RoleSelect me={me} error={error} busy={busy} onParent={handleParent} onAdmin={handleAdmin} onLogout={handleLogout} />
      ) : (
        <AdminWorkspace
          me={me}
          onFacility={() => navigate("/dashboard")}
          onShop={() => navigate("/shop")}
          onB2B={() => navigate("/b2b-shop")}
          onBack={() => { setError(""); setScreen("role"); }}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

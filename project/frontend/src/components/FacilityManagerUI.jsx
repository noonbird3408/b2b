import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createFacility, deleteFacility, devSignIn, enterFacility, errorText, fetchAllFacilityNotifications, fetchFacilities,
  fetchGoogleAuthConfig, fetchMe, markAllFacilityNotificationsRead, selectRole, signInWithGoogle, signOut, updateFacility,
} from "../api";
import { BRAND } from "../utils/brand";
import {
  FACILITY_TYPES, NOTIFICATION_META, facilityColor, facilityTypeLabel, relativeTime, startVisiblePolling,
} from "../utils/constants";
import SubjectPicker from "./SubjectPicker.jsx";
import Brand from "./Brand.jsx";
import AccountModal, { UserAvatar } from "./AccountSettings.jsx";
import JoinByCode from "./JoinByCode.jsx";
import { resizeImageFile } from "../utils/image";

// =====================================================================
// 메인(/) : 로그인 → 역할 선택(학부모/관리자) → 관리자는 학원 선택·생성·수정·삭제
//   학부모는 /parentportal (학원 검색·입장) 으로 이동
// =====================================================================
const STYLES = `
.fm-root{min-height:100vh;background:linear-gradient(160deg, rgba(59,130,246,0.10) 0%, var(--bg) 42%);display:flex;flex-direction:column;color:var(--text);}
.fm-header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:5;}
.fm-user{display:flex;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:var(--text-2);min-width:0;}
.fm-user img{width:28px;height:28px;border-radius:50%;}
.fm-user .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;}
.fm-user{flex-wrap:nowrap;}
.fm-body{flex:1;display:flex;justify-content:center;padding:36px 20px 48px;}
.fm-center{align-items:center;}
.fm-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;width:min(420px,100%);box-shadow:var(--shadow-lg);text-align:center;}
.fm-card h1{font-size:22px;margin:0 0 6px;}
.fm-card p{font-size:13px;color:var(--text-2);margin:0 0 20px;}
.fm-hero{width:min(760px,100%);text-align:center;}
.fm-hero h1{font-size:28px;font-weight:800;letter-spacing:-.025em;margin:0 0 8px;}
.fm-hero>p{font-size:14px;color:var(--text-2);margin:0 0 28px;}
.choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.choice-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:26px 24px;text-align:left;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s;}
.choice-card:hover,.choice-card:focus-visible{transform:translateY(-3px);box-shadow:var(--shadow-lg);border-color:var(--primary);outline:none;}
.choice-card[aria-disabled="true"]{opacity:.6;cursor:wait;}
.choice-card .ico{width:50px;height:50px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:25px;margin-bottom:14px;}
.choice-card h2{font-size:19px;margin:0 0 6px;}
.choice-card p{font-size:13px;color:var(--text-2);margin:0 0 14px;line-height:1.55;}
.choice-card .go{font-size:13px;font-weight:700;color:var(--primary-text);}
.choice-card .invite{margin-top:12px;display:grid;gap:6px;}
.choice-card .invite .input{width:100%;min-width:0;}
.fm-link{width:100%;margin-top:10px;padding:6px;border:0;background:transparent;color:var(--primary-text);font-size:12px;font-weight:700;}
.google-button-wrap{display:flex;justify-content:center;min-height:42px;}
.google-disabled{padding:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-3);font-size:12px;border-radius:8px;}
.dev-login{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);display:grid;gap:8px;}
.dev-login .input{min-width:0;}
.fac-wrap{width:min(1080px,100%);}
.fac-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:18px;}
.fac-head h1{font-size:24px;margin:0;}
.fac-head p{margin:4px 0 0;color:var(--text-2);font-size:13px;}
.fac-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
.fac-card{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px;cursor:pointer;transition:border-color .12s,box-shadow .12s,transform .12s;text-align:left;}
.fac-card:hover,.fac-card:focus-visible{border-color:var(--primary);box-shadow:var(--shadow);transform:translateY(-2px);outline:none;}
.fac-card.current{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft);}
.fac-card .top{display:flex;gap:12px;align-items:center;}
.fac-card .logo{width:44px;height:44px;border-radius:10px;background:var(--primary-soft);color:var(--primary-text);display:grid;place-items:center;font-weight:800;font-size:18px;overflow:hidden;flex-shrink:0;}
.fac-card .logo img{width:100%;height:100%;object-fit:cover;}
.fac-card h3{margin:0;font-size:16px;line-height:1.3;}
.fac-card .meta{font-size:12px;color:var(--text-3);}
.fac-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.fac-stats div{background:var(--surface-2);border-radius:8px;padding:7px 8px;text-align:center;}
.fac-stats b{display:block;font-size:16px;}
.fac-stats span{font-size:11px;color:var(--text-3);}
.fac-actions{display:flex;gap:6px;margin-top:auto;}
.fac-new{border:1.5px dashed var(--border-strong);background:transparent;align-items:center;justify-content:center;min-height:180px;color:var(--text-2);font-weight:700;}
.fac-new .plus{font-size:28px;line-height:1;color:var(--primary);}
.fac-alert{position:absolute;top:12px;right:12px;}
.fm-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px;}
.fm-form-grid .full{grid-column:1/-1;}
.fm-check{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-2);}
.fm-me{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:transparent;border-radius:999px;padding:2px 8px 2px 2px;color:var(--text-2);font-size:12px;min-width:0;}
.fm-me:hover{border-color:var(--border);background:var(--surface-2);}
.fm-join{margin-top:18px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px 20px;text-align:left;}
.fm-join h3{margin:0 0 4px;font-size:15px;}
.fm-join>p{margin:0 0 12px;font-size:12.5px;color:var(--text-2);}
.fm-logo-pick{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.fm-logo-pick .pv{width:64px;height:64px;border-radius:14px;border:1px solid var(--border);background:var(--primary-soft);color:var(--primary-text);display:grid;place-items:center;font-weight:800;font-size:24px;overflow:hidden;flex-shrink:0;}
.fm-logo-pick .pv img{width:100%;height:100%;object-fit:cover;}
.fac-card{border-left:4px solid var(--fac-color,var(--border));}
.fac-card.fac-new{border-left:1.5px dashed var(--border-strong);}
.fac-card.current{border-left-color:var(--fac-color);}
.fac-unread{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--fac-color);background:color-mix(in srgb,var(--fac-color) 12%,transparent);border-radius:999px;padding:2px 8px;margin-top:4px;}
.fm-bell{position:relative;}
.fm-bell-btn{position:relative;width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);display:grid;place-items:center;font-size:14px;}
.fm-bell-btn .cnt{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;}
.fm-notif{position:absolute;top:42px;right:0;width:360px;max-height:min(520px,75dvh);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);z-index:50;overflow:hidden;text-align:left;}
.fm-notif-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--surface-2);font-weight:700;font-size:13px;}
.fm-notif-filter{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;}
.fm-notif-filter button{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface);font-size:12px;color:var(--text-2);}
.fm-notif-filter button.active{border-color:var(--text-2);color:var(--text);font-weight:700;}
.fm-notif-filter b{font-size:10.5px;color:var(--danger);}
.fm-notif-list{overflow-y:auto;}
.fm-notif-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--border);border-left:4px solid var(--fac-color);background:var(--surface);padding:10px 12px;cursor:pointer;}
.fm-notif-item:hover{background:var(--surface-hover);}
.fm-notif-item.unread{background:color-mix(in srgb,var(--fac-color) 7%,var(--surface));}
.fm-notif-fac{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--fac-color);margin-bottom:3px;max-width:100%;}
.fm-notif-fac span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fm-notif-title{font-size:13px;color:var(--text);}
.fm-notif-item.unread .fm-notif-title{font-weight:700;}
.fm-notif-body{font-size:12px;color:var(--text-2);margin-top:2px;line-height:1.45;}
.fm-notif-meta{font-size:11px;color:var(--text-3);margin-top:3px;}
.fm-notif-empty{padding:30px 16px;text-align:center;color:var(--text-3);font-size:13px;}
@media(max-width:640px){
  .fm-header{padding:10px 12px;gap:8px;}
  .fm-user .name{display:none;}
  .fm-body{padding:22px 12px 32px;}
  .fm-hero h1{font-size:22px;}
  .choice-grid,.fm-form-grid{grid-template-columns:1fr;}
  .fac-head h1{font-size:20px;}
  .fm-notif{position:fixed;top:56px;left:8px;right:8px;width:auto;}
}
`;

function Banner({ tone = "danger", children }) {
  return <div className={`fl-banner ${tone}`} role="alert">{children}</div>;
}

function Header({ me, onRole, onLogout, bell, onAccount }) {
  return (
    <header className="fm-header">
      <Brand />
      {me ? (
        <div className="fm-user">
          {bell}
          <button type="button" className="fm-me" onClick={onAccount} title="내 계정 (이름·프로필 사진)" aria-label="내 계정">
            <UserAvatar user={me.user} size={28} />
            <span className="name">{me.user.name || me.user.email}</span>
          </button>
          {onRole && <button className="btn ghost sm" type="button" onClick={onRole}>역할 변경</button>}
          <button className="btn ghost sm" type="button" onClick={onLogout}>로그아웃</button>
        </div>
      ) : null}
    </header>
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
      identity.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "continue_with", width: 280, locale: "ko" });
    };
    drawButton();
    return () => window.clearTimeout(timer);
  }, [config, disabled, onCredential]);

  if (!config?.enabled) return <div className="google-disabled">Google 로그인 설정(GOOGLE_CLIENT_ID)이 필요합니다.</div>;
  return <div className="google-button-wrap" ref={buttonRef} aria-label="Google 계정으로 계속하기" />;
}

function LoginScreen({ config, error, busy, onCredential, onDevLogin, inviteCode }) {
  const [devEmail, setDevEmail] = useState("");
  return (
    <div className="fm-body fm-center">
      <div className="fm-card">
        <h1>{BRAND.logo} {BRAND.name} 시작하기</h1>
        <p>{BRAND.tagline} — 출결·수납·소통·물품 구매까지 학원 운영을 한곳에서.</p>
        {error && <Banner>{error}</Banner>}
        {inviteCode && <Banner tone="info">🔑 초대 코드 {inviteCode} — 로그인하면 바로 학원 등록 화면으로 이어집니다.</Banner>}
        <GoogleSignInButton config={config} disabled={busy} onCredential={onCredential} />
        {config?.dev_login && (
          <form className="dev-login" onSubmit={(e) => { e.preventDefault(); onDevLogin(devEmail); }}>
            <small style={{ color: "var(--text-3)" }}>개발 모드 로그인 (로컬 전용)</small>
            <input className="input" type="email" placeholder="test@example.com" value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)} required />
            <button className="btn ghost" type="submit" disabled={busy} style={{ justifyContent: "center" }}>개발용으로 로그인</button>
          </form>
        )}
      </div>
    </div>
  );
}

function RoleSelect({ me, error, busy, onParent, onAdmin, onJoined }) {
  const [inviteCode, setInviteCode] = useState("");
  const [showInvite, setShowInvite] = useState(!me.can_admin);
  return (
    <div className="fm-body fm-center">
      <div className="fm-hero">
        <h1>어떤 화면으로 들어갈까요?</h1>
        <p>{me.user.name || me.user.email} 님, 이용할 역할을 선택하세요.</p>
        {error && <Banner>{error}</Banner>}
        <div className="choice-grid">
          <div className="choice-card" role="button" tabIndex={0} aria-disabled={busy}
            onClick={() => !busy && onParent()} onKeyDown={(e) => e.key === "Enter" && !busy && onParent()}>
            <div className="ico" style={{ background: "var(--primary-soft)" }}>👪</div>
            <h2>학부모</h2>
            <p>학원을 찾아 가입 신청하고, 자녀 출결·수강료·커뮤니티를 이용합니다.</p>
            <div className="go">학부모로 시작 →</div>
          </div>
          <div className="choice-card" role="button" tabIndex={0} aria-disabled={busy}
            onClick={() => !busy && onAdmin(inviteCode)} onKeyDown={(e) => e.key === "Enter" && !busy && onAdmin(inviteCode)}>
            <div className="ico" style={{ background: "var(--warning-soft)" }}>🔐</div>
            <h2>관리자</h2>
            <p>내 학원을 만들거나 선택해 학생·수업·출결·수납·커뮤니티를 관리합니다.</p>
            <div className="go">{me.can_admin ? "관리자로 시작 →" : "초대 코드로 등록 →"}</div>
            {showInvite ? (
              <div className="invite" onClick={(e) => e.stopPropagation()}>
                <input className="input" placeholder="관리자/직원 초대 코드" value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)} autoComplete="one-time-code"
                  onKeyDown={(e) => e.key === "Enter" && !busy && onAdmin(inviteCode)} />
              </div>
            ) : (
              <button type="button" className="fm-link" onClick={(e) => { e.stopPropagation(); setShowInvite(true); }}>초대 코드 입력</button>
            )}
          </div>
        </div>
        <section className="fm-join" aria-label="초대 코드로 학원 등록">
          <h3>🔑 학원에서 받은 초대 코드가 있나요?</h3>
          <p>숫자 6자리를 입력하면 학부모 또는 직원으로 그 학원에 바로 등록됩니다.</p>
          <JoinByCode onJoined={onJoined} />
        </section>
      </div>
    </div>
  );
}

function JoinScreen({ code, onJoined, onCancel }) {
  return (
    <div className="fm-body fm-center">
      <div className="fm-card" style={{ textAlign: "left" }}>
        <h1 style={{ textAlign: "center" }}>🔑 초대 코드로 등록</h1>
        <p style={{ textAlign: "center" }}>초대받은 학원을 확인하고 참여하세요.</p>
        <JoinByCode initialCode={code} autoCheck onJoined={onJoined} />
        <button type="button" className="fm-link" onClick={onCancel}>초대 코드 없이 계속하기</button>
      </div>
    </div>
  );
}

const EMPTY_FACILITY = { name: "", facility_type: "학원", branch: "", region: "", address: "", phone: "", description: "",
  principal: "", base_tuition_fee: "", is_public: true, subjects: [], logo: "" };

function FacilityForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FACILITY, ...(initial || {}),
    base_tuition_fee: initial?.base_tuition_fee ?? "" }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const pickLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const logo = await resizeImageFile(file, "logo");
      setForm((f) => ({ ...f, logo }));
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = { ...form, base_tuition_fee: form.base_tuition_fee === "" ? null : Number(form.base_tuition_fee),
      logo: form.logo || "" };
    try {
      const saved = initial?.facility_id ? await updateFacility(initial.facility_id, payload) : await createFacility(payload);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err, "학원 정보를 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{initial?.facility_id ? "학원 정보 수정" : "새 학원 만들기"}</h3>
        {error && <Banner>{error}</Banner>}
        <div className="fm-form-grid">
          <div className="form-row full"><label>학원 프로필 사진</label>
            <div className="fm-logo-pick">
              <div className="pv">{form.logo ? <img src={form.logo} alt="학원 사진 미리보기" /> : (form.name || "학").charAt(0)}</div>
              <label className="btn ghost sm" style={{ cursor: "pointer" }}>
                사진 선택<input type="file" accept="image/*" onChange={pickLogo} style={{ display: "none" }} />
              </label>
              {form.logo && <button type="button" className="btn ghost sm" onClick={() => setForm((f) => ({ ...f, logo: "" }))}>삭제</button>}
              <small style={{ color: "var(--text-3)", flexBasis: "100%" }}>학원 목록·학부모 검색·초대 화면에 보입니다. 정사각형 사진이 가장 잘 보여요.</small>
            </div>
          </div>
          <div className="form-row full"><label>학원 이름 *</label>
            <input className="input" required maxLength={100} value={form.name} onChange={set("name")} placeholder="예: 쑥쑥 수학학원" /></div>
          <div className="form-row"><label>학원 종류</label>
            <select className="select" value={form.facility_type} onChange={set("facility_type")}>
              {FACILITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="form-row"><label>지점</label>
            <input className="input" maxLength={100} value={form.branch} onChange={set("branch")} placeholder="예: 용인 본관" /></div>
          <div className="form-row"><label>지역 (학부모 검색용)</label>
            <input className="input" maxLength={50} value={form.region} onChange={set("region")} placeholder="예: 경기 용인시" /></div>
          <div className="form-row"><label>대표 연락처</label>
            <input className="input" maxLength={30} value={form.phone} onChange={set("phone")} placeholder="031-000-0000" /></div>
          <div className="form-row full"><label>주소</label>
            <input className="input" maxLength={200} value={form.address} onChange={set("address")} /></div>
          <div className="form-row"><label>원장 이름</label>
            <input className="input" maxLength={50} value={form.principal} onChange={set("principal")} /></div>
          <div className="form-row"><label>기본 월 수강료 (원)</label>
            <input className="input" type="number" min="0" value={form.base_tuition_fee} onChange={set("base_tuition_fee")} /></div>
          <div className="form-row full"><label>주요 과목 <small style={{ color: "var(--text-3)", fontWeight: 400 }}>— 쇼핑몰 교재·교구 추천에 사용 (개설한 수업에서도 자동으로 찾아요)</small></label>
            <SubjectPicker value={form.subjects} onChange={(subjects) => setForm((f) => ({ ...f, subjects }))} /></div>
          <div className="form-row full"><label>소개</label>
            <textarea maxLength={1000} value={form.description} onChange={set("description")} placeholder="학부모 검색 화면에 보이는 소개" /></div>
          <label className="fm-check full"><input type="checkbox" checked={form.is_public} onChange={set("is_public")} /> 학부모 검색에 노출</label>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </div>
  );
}

function DeleteFacility({ facility, onClose, onDeleted }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      await deleteFacility(facility.facility_id, name);
      onDeleted();
    } catch (err) {
      setError(errorText(err, "학원을 삭제하지 못했습니다."));
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>학원 삭제</h3>
        <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 0 }}>
          <b>{facility.name}</b> 을(를) 목록에서 삭제합니다. 학생·결제 기록은 보관되며 학부모는 더 이상 이 학원에 들어올 수 없습니다.
          확인을 위해 학원 이름을 입력하세요.
        </p>
        {error && <Banner>{error}</Banner>}
        <input className="input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder={facility.name} autoFocus />
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn" style={{ background: "var(--danger)" }} disabled={name.trim() !== facility.name}>삭제</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// 메인(학원 선택) 화면 알림 — 내가 관리하는 모든 학원의 알림을 한곳에서. 학원마다 고정 색 + 이름으로 구분
// ---------------------------------------------------------------------
const MAIN_NOTIFY_INTERVAL = 30000;
const STAFF_PATHS = ["/attendances", "/members", "/classes", "/inventory", "/shop"];

function useAllFacilityNotifications(enabled) {
  const [state, setState] = useState({ unread: 0, unread_by_facility: {}, items: [] });
  const refresh = useCallback(async () => {
    try { setState(await fetchAllFacilityNotifications({ limit: 50 })); } catch { /* 다음 주기에 재시도 */ }
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    return startVisiblePolling(refresh, MAIN_NOTIFY_INTERVAL);
  }, [enabled, refresh]);
  return [state, refresh, setState];
}

function MainNotificationBell({ data, refresh, setData, onOpenItem }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(null);      // null = 전체, 숫자 = facility_id
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const facilities = [];
  const seen = new Set();
  data.items.forEach((n) => {
    if (!seen.has(n.facility_id)) { seen.add(n.facility_id); facilities.push({ id: n.facility_id, name: n.facility_name }); }
  });
  const items = filter == null ? data.items : data.items.filter((n) => n.facility_id === filter);

  const readAll = async () => {
    const payload = filter == null ? { all: true } : { ids: items.filter((n) => !n.is_read).map((n) => n.notification_id) };
    await markAllFacilityNotificationsRead(payload).catch(() => null);
    refresh();
  };
  const clickItem = async (n) => {
    if (!n.is_read) {
      setData((prev) => ({
        ...prev,
        unread: Math.max(0, prev.unread - 1),
        unread_by_facility: { ...prev.unread_by_facility, [n.facility_id]: Math.max(0, (prev.unread_by_facility[n.facility_id] || 1) - 1) },
        items: prev.items.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x)),
      }));
      markAllFacilityNotificationsRead({ ids: [n.notification_id] }).catch(() => null);
    }
    setOpen(false);
    onOpenItem(n);
  };

  return (
    <div className="fm-bell" ref={wrapRef}>
      <button type="button" className="fm-bell-btn" onClick={() => { setOpen((v) => !v); if (!open) refresh(); }}
        aria-label={`전체 학원 알림 ${data.unread}건`} aria-expanded={open}>
        🔔{data.unread > 0 && <span className="cnt">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open && (
        <div className="fm-notif" role="dialog" aria-label="전체 학원 알림">
          <div className="fm-notif-head">
            <span>전체 학원 알림 {data.unread > 0 ? `(${data.unread})` : ""}</span>
            {items.some((n) => !n.is_read) && <button type="button" className="btn ghost sm" onClick={readAll}>모두 읽음</button>}
          </div>
          {facilities.length > 1 && (
            <div className="fm-notif-filter">
              <button type="button" className={filter == null ? "active" : ""} onClick={() => setFilter(null)}>전체</button>
              {facilities.map((f) => (
                <button key={f.id} type="button" className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
                  <span className="fac-dot" style={{ background: facilityColor(f.id) }} />{f.name}
                  {data.unread_by_facility[f.id] > 0 && <b>{data.unread_by_facility[f.id]}</b>}
                </button>
              ))}
            </div>
          )}
          <div className="fm-notif-list">
            {items.length === 0 ? <div className="fm-notif-empty">새 알림이 없습니다.</div> : items.map((n) => (
              <button type="button" key={n.notification_id} className={`fm-notif-item${n.is_read ? "" : " unread"}`}
                style={{ "--fac-color": facilityColor(n.facility_id) }} onClick={() => clickItem(n)}>
                <div className="fm-notif-fac">
                  <span className="fac-dot" style={{ background: facilityColor(n.facility_id) }} />
                  <span>{n.facility_name}</span>
                </div>
                <div className="fm-notif-title">{NOTIFICATION_META[n.kind]?.icon || "🔔"} {n.title}</div>
                {n.body && <div className="fm-notif-body">{n.body}</div>}
                <div className="fm-notif-meta">{relativeTime(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FacilityPicker({ me, onEntered, unreadByFacility = {}, onJoined }) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);     // {} = 새 학원
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    fetchFacilities().then(setItems).catch((err) => { setItems([]); setError(errorText(err, "학원 목록을 불러오지 못했습니다.")); });
  }, []);
  useEffect(load, [load]);

  const enter = async (facility) => {
    setBusyId(facility.facility_id);
    setError("");
    try {
      const current = await enterFacility(facility.facility_id);
      onEntered(current);
    } catch (err) {
      setError(errorText(err, "학원에 들어가지 못했습니다."));
      setBusyId(null);
    }
  };

  return (
    <div className="fm-body">
      <div className="fac-wrap">
        <div className="fac-head">
          <div>
            <h1>내 학원</h1>
            <p>관리할 학원을 선택하세요.</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" onClick={() => setJoinOpen(true)}>🔑 초대 코드</button>
            {me.can_create_facility && <button type="button" className="btn" onClick={() => setEditing({})}>+ 새 학원</button>}
          </div>
        </div>
        {error && <Banner>{error}</Banner>}
        {items === null ? <div className="fl-skeleton" style={{ height: 160 }} /> : (
          <div className="fac-grid">
            {items.map((f) => (
              <div key={f.facility_id} className={`fac-card${me.facility?.facility_id === f.facility_id ? " current" : ""}`}
                style={{ "--fac-color": facilityColor(f.facility_id) }}
                role="button" tabIndex={0} aria-busy={busyId === f.facility_id}
                onClick={() => enter(f)} onKeyDown={(e) => e.key === "Enter" && enter(f)}>
                {f.pending_applications > 0 && <span className="badge warning fac-alert no-dot">가입 신청 {f.pending_applications}</span>}
                <div className="top">
                  <div className="logo">{f.logo ? <img src={f.logo} alt="" /> : f.name.charAt(0)}</div>
                  <div style={{ minWidth: 0 }}>
                    <h3>{f.name}</h3>
                    <div className="meta">{[facilityTypeLabel(f.facility_type), f.branch, f.region].filter(Boolean).join(" · ")}</div>
                    {unreadByFacility[f.facility_id] > 0 && <span className="fac-unread">🔔 새 알림 {unreadByFacility[f.facility_id]}</span>}
                  </div>
                </div>
                <div className="fac-stats">
                  <div><b>{f.student_count}</b><span>학생</span></div>
                  <div><b>{f.class_count}</b><span>수업</span></div>
                  <div><b>{f.parent_count}</b><span>학부모</span></div>
                </div>
                <div className="fac-actions" onClick={(e) => e.stopPropagation()}>
                  <span className={`badge ${f.my_role === "owner" ? "primary" : "gray"} no-dot`}>{f.my_role === "owner" ? "원장" : "직원"}</span>
                  {!f.is_public && <span className="badge gray no-dot">비공개</span>}
                  {f.my_role === "owner" && (
                    <>
                      <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setEditing(f)}>수정</button>
                      <button type="button" className="btn danger sm" onClick={() => setDeleting(f)}>삭제</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {me.can_create_facility && (
              <button type="button" className="fac-card fac-new" onClick={() => setEditing({})}>
                <span className="plus">＋</span>새 학원 만들기
              </button>
            )}
            {!items.length && !me.can_create_facility && (
              <div className="empty" style={{ gridColumn: "1/-1" }}>초대받은 학원이 없습니다. 원장에게 이 Google 계정을 직원으로 등록해 달라고 요청하세요.</div>
            )}
          </div>
        )}
      </div>
      {editing && <FacilityForm initial={editing.facility_id ? editing : null} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }} />}
      {deleting && <DeleteFacility facility={deleting} onClose={() => setDeleting(null)}
        onDeleted={() => { setDeleting(null); load(); }} />}
      {joinOpen && (
        <div className="modal-backdrop" onClick={() => setJoinOpen(false)}>
          <div className="modal" style={{ width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>초대 코드로 학원 등록</h3>
              <button type="button" className="btn ghost sm" onClick={() => setJoinOpen(false)} aria-label="닫기">✕</button>
            </div>
            <JoinByCode onJoined={(result) => { setJoinOpen(false); onJoined(result); }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function FacilityManagerUI() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(true);
  const [screen, setScreen] = useState("login"); // login → role → facilities
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const joinCode = (params.get("join") || "").replace(/\D/g, "").slice(0, 6);
  const showMainBell = screen === "facilities" && !!me?.can_admin && me?.active_role === "admin";
  const [allNotifications, refreshAllNotifications, setAllNotifications] = useAllFacilityNotifications(showMainBell);

  useEffect(() => {
    fetchGoogleAuthConfig().then(setConfig).catch(() => setConfig({ enabled: false }));
    fetchMe()
      .then((current) => {
        setMe(current);
        if (joinCode) setScreen("join");
        else if (params.get("role") === "1") setScreen("role");
        else if (current.active_role === "admin" && current.can_admin) setScreen("facilities");
        else if (current.active_role === "parent") navigate("/parentportal", { replace: true });
        else setScreen("role");
      })
      .catch((err) => {
        // 401(세션 없음/만료)일 때만 로그인 화면. 서버 일시 오류는 로그인을 풀지 않고 안내만 표시
        const status = err?.response?.status;
        if (status && status !== 401 && status !== 403) setError(errorText(err, "서버에 연결하지 못했습니다. 잠시 후 새로고침하세요."));
        setScreen("login");
      })
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (task, fallback) => {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  // 초대 링크(/join?code=)로 들어왔으면 로그인 후 바로 코드 확인 화면으로
  const afterLogin = (current) => { setMe(current); setScreen(joinCode ? "join" : "role"); };
  const handleJoined = (result) => {
    setMe(result.me);
    setParams({}, { replace: true });
    navigate(result.target);
  };
  const handleCredential = useCallback(
    (credential) => run(async () => afterLogin(await signInWithGoogle(credential)), "Google 계정 인증에 실패했습니다."),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const handleDevLogin = (email) => run(async () => afterLogin(await devSignIn(email, email.split("@")[0])), "개발용 로그인에 실패했습니다.");
  const handleParent = () => run(async () => { await selectRole("parent"); navigate("/parentportal"); }, "학부모 모드로 전환하지 못했습니다.");
  const handleAdmin = (inviteCode) => run(async () => {
    const current = await selectRole("admin", inviteCode.trim());
    setMe(current);
    setParams({}, { replace: true });
    setScreen("facilities");
  }, "관리자 권한을 확인하지 못했습니다.");
  const handleLogout = () => run(async () => {
    try { await signOut(); } finally {
      window.google?.accounts?.id?.disableAutoSelect?.();
      ["app_academy_info", "app_payment_settings", "dashboard_notified_keys"].forEach((k) => { try { localStorage.removeItem(k); } catch { /* 무시 */ } });
      setMe(null);
      setScreen("login");
    }
  }, "로그아웃하지 못했습니다.");
  const handleEntered = (current) => {
    setMe(current);
    navigate(current.facility?.my_role === "owner" ? "/dashboard" : "/attendances");
  };
  // 메인 알림을 누르면: 그 학원으로 입장 → 알림이 가리키는 화면으로 이동
  const handleOpenNotification = (n) => run(async () => {
    const current = await enterFacility(n.facility_id);
    setMe(current);
    const isOwner = current.facility?.my_role === "owner";
    let target = n.link ? `/${String(n.link).replace(/^\//, "")}` : NOTIFICATION_META[n.kind]?.admin;
    if (target === "/members" && n.member_id) target = `/members?member=${n.member_id}`;
    if (!target || !(isOwner || STAFF_PATHS.some((p) => target.startsWith(p)))) target = isOwner ? "/dashboard" : "/attendances";
    navigate(target);
  }, "알림의 학원으로 이동하지 못했습니다.");

  if (checking) return <div className="auth-loading">로그인 상태를 확인하고 있습니다.</div>;

  return (
    <div className="fm-root">
      <style>{STYLES}</style>
      <Header me={me} onLogout={handleLogout} onRole={screen === "facilities" ? () => { setError(""); setScreen("role"); } : null}
        onAccount={() => setAccountOpen(true)}
        bell={showMainBell ? (
          <MainNotificationBell data={allNotifications} refresh={refreshAllNotifications} setData={setAllNotifications}
            onOpenItem={handleOpenNotification} />
        ) : null} />
      {screen === "login" || !me ? (
        <LoginScreen config={config} error={error} busy={busy} onCredential={handleCredential} onDevLogin={handleDevLogin} inviteCode={joinCode} />
      ) : screen === "join" ? (
        <JoinScreen code={joinCode} onJoined={handleJoined} onCancel={() => { setParams({}, { replace: true }); setScreen("role"); }} />
      ) : screen === "role" ? (
        <RoleSelect me={me} error={error} busy={busy} onParent={handleParent} onAdmin={handleAdmin} onJoined={handleJoined} />
      ) : (
        <>
          {error && <div style={{ width: "min(1080px, calc(100% - 24px))", margin: "16px auto 0" }}><Banner>{error}</Banner></div>}
          <FacilityPicker me={me} onEntered={handleEntered} unreadByFacility={allNotifications.unread_by_facility} onJoined={handleJoined} />
        </>
      )}
      {accountOpen && me && <AccountModal me={me} onClose={() => setAccountOpen(false)} onSaved={setMe} />}
    </div>
  );
}

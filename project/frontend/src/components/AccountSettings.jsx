import { useEffect, useState } from "react";
import { errorText, updateProfile } from "../api";
import { resizeImageFile } from "../utils/image";
import PushSettings from "./PushSettings.jsx";

// =====================================================================
// v13 계정 설정 — 앱에서 쓰는 이름·프로필 사진 (학부모·관리자 공통)
//   - Google 로그인 정보와 따로 저장되어 다시 로그인해도 바뀌지 않음
//   - 비우거나 'Google 사진으로' 를 누르면 Google 프로필로 되돌아감
// =====================================================================
const AVATAR_PRESET = { maxSize: 256, quality: 0.85, mime: "image/jpeg" };   // 약 20~40KB

const STYLES = `
.acct{display:grid;gap:14px;}
.acct-photo{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.acct-avatar{width:72px;height:72px;border-radius:50%;overflow:hidden;flex-shrink:0;display:grid;place-items:center;
  background:var(--primary-soft);color:var(--primary-text);font-size:28px;font-weight:800;border:1px solid var(--border);}
.acct-avatar img{width:100%;height:100%;object-fit:cover;}
.acct-photo-actions{display:flex;gap:6px;flex-wrap:wrap;}
.acct-hint{margin:4px 0 0;font-size:12px;color:var(--text-3);line-height:1.5;}
.acct-row{display:grid;gap:6px;}
.acct-row label{font-size:13px;font-weight:600;color:var(--text-2);}
.acct-email{padding:9px 12px;border:1px dashed var(--border);border-radius:8px;font-size:13px;color:var(--text-2);background:var(--surface-2);overflow-wrap:anywhere;}
`;

export function UserAvatar({ user, size = 32, className = "" }) {
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <span className={`user-avatar ${className}`} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {user?.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initial}
    </span>
  );
}

/** 설정 화면 안에 넣는 계정 폼. onSaved(me) — 저장 후 서버가 돌려준 최신 세션 정보 */
export function AccountForm({ me, onSaved, roleHint }) {
  const user = me?.user || {};
  const [name, setName] = useState(user.display_name || "");
  const [avatar, setAvatar] = useState(undefined);     // undefined = 바꾸지 않음, "" = Google 사진으로, data URL = 새 사진
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);       // {tone, text}

  useEffect(() => { setName(user.display_name || ""); setAvatar(undefined); }, [user.display_name, user.picture]);

  // 미리보기: 그대로 → 지금 사진 / "" → Google 사진 / 새 사진
  const previewPicture = avatar === undefined ? user.picture : avatar === "" ? user.google_picture : avatar;
  const dirty = name.trim() !== (user.display_name || "") || avatar !== undefined;

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setAvatar(await resizeImageFile(file, AVATAR_PRESET));
      setMessage(null);
    } catch (err) {
      setMessage({ tone: "danger", text: err.message });
    }
  };

  const save = async (e) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed.length < 2) { setMessage({ tone: "danger", text: "이름은 2자 이상 입력하세요." }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const payload = { display_name: trimmed };
      if (avatar !== undefined) payload.avatar = avatar;
      const next = await updateProfile(payload);
      setAvatar(undefined);
      setMessage({ tone: "success", text: "계정 정보를 저장했습니다." });
      onSaved?.(next);
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "계정 정보를 저장하지 못했습니다.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="acct" onSubmit={save}>
      <style>{STYLES}</style>
      <div className="acct-photo">
        <div className="acct-avatar">
          {previewPicture ? <img src={previewPicture} alt="프로필 사진 미리보기" referrerPolicy="no-referrer" />
            : (name || user.google_name || user.email || "?").trim().charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="acct-photo-actions">
            <label className="btn ghost sm" style={{ cursor: "pointer" }}>
              사진 변경<input type="file" accept="image/*" onChange={pickPhoto} style={{ display: "none" }} />
            </label>
            {((user.has_custom_avatar && avatar === undefined) || avatar) && (
              <button type="button" className="btn ghost sm" onClick={() => setAvatar(user.has_custom_avatar ? "" : undefined)}>
                Google 사진으로
              </button>
            )}
          </div>
          <p className="acct-hint">사진은 자동으로 작게 줄여서 저장합니다.</p>
        </div>
      </div>
      <div className="acct-row">
        <label htmlFor="acct-name">이름 (닉네임)</label>
        <input id="acct-name" className="input" maxLength={20} value={name} onChange={(e) => setName(e.target.value)}
          placeholder={user.google_name || "이름"} />
        <p className="acct-hint" style={{ margin: 0 }}>
          비워 두면 Google 이름({user.google_name || "-"})을 씁니다.{roleHint ? ` ${roleHint}` : ""}
        </p>
      </div>
      <div className="acct-row">
        <label>로그인 계정</label>
        <div className="acct-email">{user.email} · Google</div>
      </div>
      {message && <div className={`fl-banner ${message.tone}`} role="status">{message.text}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn" type="submit" disabled={saving || !dirty}>{saving ? "저장 중…" : "계정 저장"}</button>
      </div>
    </form>
  );
}

/** 단독 모달 (메인 화면·학부모 포털) */
export default function AccountModal({ me, onClose, onSaved, roleHint, actions }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "min(460px, 100%)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="내 계정">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>내 계정</h3>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <AccountForm me={me} onSaved={onSaved} roleHint={roleHint} />
        <section style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>📱 휴대폰 알림</h4>
          <PushSettings compact />
        </section>
        {actions && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { errorText, previewInvite, redeemInvite } from "../api";
import { facilityTypeLabel } from "../utils/constants";

// =====================================================================
// v13 초대 코드로 학원 등록 — 숫자 6자리 입력(또는 /join?code= 링크) → 학원 확인 → 참여
//   onJoined({me, target, already_member, facility_name, role}) 로 결과를 넘기면 화면이 이동합니다.
// =====================================================================
const STYLES = `
.join{display:grid;gap:12px;text-align:left;}
.join-input{display:flex;gap:8px;}
.join-input .input{flex:1;min-width:0;font-size:22px;letter-spacing:.35em;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;height:48px;}
.join-input .btn{flex-shrink:0;height:48px;}
.join-card{display:flex;gap:12px;align-items:center;padding:14px;border:1px solid var(--primary);border-radius:12px;background:var(--primary-soft);}
.join-card .lg{width:48px;height:48px;border-radius:12px;background:var(--surface);display:grid;place-items:center;font-weight:800;font-size:20px;color:var(--primary-text);overflow:hidden;flex-shrink:0;}
.join-card .lg img{width:100%;height:100%;object-fit:cover;}
.join-card b{display:block;font-size:15px;}
.join-card small{display:block;color:var(--text-2);font-size:12px;margin-top:2px;}
.join-hint{margin:0;font-size:12px;color:var(--text-3);line-height:1.55;}
`;

const onlyDigits = (v) => String(v || "").replace(/\D/g, "").slice(0, 6);

export default function JoinByCode({ initialCode = "", onJoined, autoCheck = false }) {
  const [code, setCode] = useState(onlyDigits(initialCode));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  const check = async (value = code) => {
    if (value.length !== 6) { setError("초대 코드 숫자 6자리를 입력하세요."); return; }
    setBusy(true);
    setError("");
    try {
      setPreview(await previewInvite(value));
    } catch (e) {
      setPreview(null);
      setError(errorText(e, "초대 코드를 확인하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  // 링크(/join?code=123456)로 들어오면 바로 확인
  useEffect(() => {
    if (autoCheck && !checkedRef.current && onlyDigits(initialCode).length === 6) {
      checkedRef.current = true;
      check(onlyDigits(initialCode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, initialCode]);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      onJoined?.(await redeemInvite(code));
    } catch (e) {
      setError(errorText(e, "학원에 등록하지 못했습니다."));
      setBusy(false);
    }
  };

  const f = preview?.facility;
  return (
    <div className="join">
      <style>{STYLES}</style>
      <form className="join-input" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="초대 코드 6자리"
          value={code} onChange={(e) => { setCode(onlyDigits(e.target.value)); setPreview(null); setError(""); }} maxLength={6} />
        <button className="btn ghost" type="submit" disabled={busy || code.length !== 6}>{busy && !preview ? "확인 중…" : "확인"}</button>
      </form>
      {error && <div className="fl-banner danger" role="alert">{error}</div>}
      {f && (
        <>
          <div className="join-card">
            <div className="lg">{f.logo ? <img src={f.logo} alt="" /> : f.name.charAt(0)}</div>
            <div style={{ minWidth: 0 }}>
              <b>{f.name}</b>
              <small>{[facilityTypeLabel(f.facility_type), f.branch, f.region].filter(Boolean).join(" · ")}</small>
              <small><b style={{ display: "inline", fontSize: 12 }}>{preview.role_label}</b>(으)로 등록됩니다{preview.already_member ? " · 이미 등록된 학원" : ""}</small>
            </div>
          </div>
          <button className="btn" type="button" onClick={join} disabled={busy} style={{ justifyContent: "center", height: 44 }}>
            {busy ? "등록 중…" : preview.already_member ? "이 학원으로 들어가기" : `${preview.role_label}로 참여하기`}
          </button>
        </>
      )}
      <p className="join-hint">학원에서 받은 숫자 6자리 코드를 입력하세요. 학부모는 등록 후 자녀 가입 신청을, 직원은 원장이 허용한 화면을 이용할 수 있습니다.</p>
    </div>
  );
}

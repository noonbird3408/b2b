import { useCallback, useEffect, useState } from "react";
import { errorText } from "../api";
import {
  INSTALL_EVENT, canInstall, enablePush, getPushStatus, isIOS, isStandalone, promptInstall, sendTestPush, turnOffPush,
} from "../utils/push";

// =====================================================================
// v14 휴대폰 알림 설정 (학부모·관리자 공통)
//   - 알림 켜기/끄기 · 테스트 알림 · 앱 설치(홈 화면에 추가)
//   - 아이폰은 Safari 로 '홈 화면에 추가'한 앱에서만 알림을 받을 수 있어 단계 안내를 보여 줌
// =====================================================================
const STYLES = `
.push-card{display:grid;gap:12px;}
.push-status{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);}
.push-status .ico{font-size:22px;line-height:1;}
.push-status b{display:block;font-size:14px;}
.push-status small{display:block;font-size:12px;color:var(--text-2);margin-top:2px;line-height:1.5;}
.push-status.on{border-color:var(--success);background:var(--success-soft);}
.push-status.warn{border-color:var(--warning);background:var(--warning-soft);}
.push-actions{display:flex;gap:8px;flex-wrap:wrap;}
.push-steps{margin:0;padding-left:20px;font-size:13px;line-height:1.8;color:var(--text-2);}
.push-steps b{color:var(--text);}
.push-nudge{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--primary-soft);border-bottom:1px solid var(--border);
  font-size:12.5px;color:var(--primary-text);}
.push-nudge span{flex:1;min-width:0;}
`;

export function usePushStatus() {
  const [status, setStatus] = useState(null);
  const [installable, setInstallable] = useState(canInstall());
  const refresh = useCallback(() => getPushStatus().then(setStatus).catch(() => setStatus({ supported: false })), []);
  useEffect(() => {
    refresh();
    const onInstall = () => setInstallable(canInstall());
    window.addEventListener(INSTALL_EVENT, onInstall);
    return () => window.removeEventListener(INSTALL_EVENT, onInstall);
  }, [refresh]);
  return { status, refresh, installable };
}

export default function PushSettings({ compact = false }) {
  const { status, refresh, installable } = usePushStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const run = async (task, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      if (okText) setMessage({ tone: "success", text: okText });
    } catch (e) {
      setMessage({ tone: "danger", text: errorText(e, e?.message || "처리하지 못했습니다.") });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!status) return <div className="fl-skeleton" style={{ height: 90 }} />;

  const on = status.subscribed;
  const denied = status.permission === "denied";
  return (
    <div className="push-card">
      <style>{STYLES}</style>
      {status.needsInstall ? (
        <div className="push-status warn">
          <span className="ico" aria-hidden="true">📲</span>
          <div><b>아이폰은 홈 화면 앱에서 알림을 받을 수 있어요</b><small>iOS 16.4 이상 · Safari 에서 아래 순서로 설치한 뒤 앱을 열고 알림을 켜 주세요.</small></div>
        </div>
      ) : !status.supported ? (
        <div className="push-status warn">
          <span className="ico" aria-hidden="true">⚠️</span>
          <div><b>이 브라우저는 휴대폰 알림을 지원하지 않아요</b><small>안드로이드는 Chrome·삼성 인터넷, PC 는 Chrome·Edge 에서 이용하세요.</small></div>
        </div>
      ) : (
        <div className={`push-status ${on ? "on" : denied ? "warn" : ""}`}>
          <span className="ico" aria-hidden="true">{on ? "🔔" : denied ? "🔕" : "📱"}</span>
          <div>
            <b>{on ? "이 기기로 알림을 받고 있어요" : denied ? "알림이 차단되어 있어요" : "휴대폰 알림이 꺼져 있어요"}</b>
            <small>{on ? "등원·하원, 결제, 공지, 가입 신청 등 새 알림이 오면 앱을 닫아 둬도 휴대폰에 바로 떠요."
              : denied ? "브라우저(또는 휴대폰) 설정 → 사이트 설정 → 알림에서 이 사이트를 '허용'으로 바꾼 뒤 다시 켜 주세요."
                : "켜 두면 앱을 닫아 둬도 새 알림이 휴대폰 알림으로 옵니다."}</small>
          </div>
        </div>
      )}

      {status.needsInstall && (
        <ol className="push-steps">
          <li>Safari 아래쪽 <b>공유 버튼(□↑)</b>을 누르기</li>
          <li><b>홈 화면에 추가</b> 선택 → 추가</li>
          <li>홈 화면의 <b>쑥쑥</b> 아이콘으로 열고 이 화면에서 <b>알림 켜기</b></li>
        </ol>
      )}

      <div className="push-actions">
        {status.supported && !on && !denied && (
          <button type="button" className="btn" disabled={busy}
            onClick={() => run(enablePush, "알림을 켰습니다. '테스트 알림'으로 확인해 보세요.")}>
            {busy ? "켜는 중…" : "🔔 이 기기에서 알림 켜기"}
          </button>
        )}
        {status.supported && on && (
          <>
            <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => run(sendTestPush, "테스트 알림을 보냈습니다. 몇 초 안에 도착해요. (앱을 보고 있으면 화면 위에 바로 떠요)")}>테스트 알림</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(turnOffPush, "이 기기의 알림을 껐습니다.")}>알림 끄기</button>
          </>
        )}
        {installable && !isStandalone() && (
          <button type="button" className="btn ghost sm" onClick={() => promptInstall().then(refresh)}>📲 앱 설치</button>
        )}
      </div>
      {!compact && !isStandalone() && !isIOS() && (
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          홈 화면에 앱으로 설치하면 주소창 없이 앱처럼 열립니다. ({installable ? "'앱 설치' 버튼" : "브라우저 메뉴 → '앱 설치' 또는 '홈 화면에 추가'"})
        </p>
      )}
      {message && <div className={`fl-banner ${message.tone}`} role="status">{message.text}</div>}
    </div>
  );
}

/** 알림 패널 맨 위의 짧은 안내 — 아직 안 켠 기기에서만 */
export function PushNudge({ onOpenSettings }) {
  const { status, refresh } = usePushStatus();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("push_nudge_hidden") === "1"; } catch { return false; } });
  if (hidden || !status || status.subscribed || status.permission === "denied") return null;
  if (!status.supported && !status.needsInstall) return null;
  const hide = () => { setHidden(true); try { sessionStorage.setItem("push_nudge_hidden", "1"); } catch { /* 무시 */ } };
  return (
    <div className="push-nudge">
      <style>{STYLES}</style>
      <span>📱 {status.needsInstall ? "홈 화면에 앱을 추가하면 휴대폰으로 알림을 받을 수 있어요" : "휴대폰으로도 알림을 받아 보세요"}</span>
      {status.needsInstall
        ? onOpenSettings && <button type="button" className="btn ghost sm" onClick={onOpenSettings}>방법 보기</button>
        : <button type="button" className="btn sm" disabled={busy}
            onClick={async () => { setBusy(true); try { await enablePush(); } catch (e) { if (onOpenSettings) onOpenSettings(); } finally { setBusy(false); refresh(); } }}>
            {busy ? "…" : "켜기"}
          </button>}
      <button type="button" className="btn ghost sm" onClick={hide} aria-label="안내 닫기">✕</button>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { createInvite, errorText, fetchInvites, revokeInvite } from "../api";

// =====================================================================
// v13 초대 코드 관리 (원장) — 학부모·직원용 6자리 코드와 링크를 만들고, 사용 현황을 보고, 폐기합니다.
// =====================================================================
const STYLES = `
.inv-new{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:8px;align-items:end;}
.inv-new label{display:grid;gap:4px;font-size:12px;color:var(--text-2);}
.inv-list{display:grid;gap:8px;}
.inv-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);}
.inv-item.off{opacity:.55;}
.inv-code{font-size:22px;font-weight:800;letter-spacing:.18em;font-variant-numeric:tabular-nums;color:var(--text);}
.inv-meta{font-size:12px;color:var(--text-2);line-height:1.6;min-width:0;}
.inv-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
@media(max-width:600px){.inv-new{grid-template-columns:1fr 1fr;}.inv-new .btn{grid-column:1/-1;}.inv-item{grid-template-columns:1fr;}.inv-actions{justify-content:flex-start;}}
`;

const joinLink = (code) => `${window.location.origin}/join?code=${code}`;
const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 클립보드 권한이 없는 환경(일부 모바일·http) 대비
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export default function InviteManager() {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ role: "parent", expires_days: 7, max_uses: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(() => {
    fetchInvites().then(setItems).catch((e) => { setItems([]); setMessage({ tone: "danger", text: errorText(e, "초대 코드를 불러오지 못했습니다.") }); });
  }, []);
  useEffect(load, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await createInvite({ role: form.role, expires_days: Number(form.expires_days),
        ...(form.max_uses ? { max_uses: Number(form.max_uses) } : {}) });
      setItems((prev) => [created, ...(prev || [])]);
      setMessage({ tone: "success", text: `${created.role_label}용 초대 코드 ${created.code} 를 만들었습니다.` });
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "초대 코드를 만들지 못했습니다.") });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text, label) => {
    setMessage((await copyText(text)) ? { tone: "success", text: `${label}을(를) 복사했습니다.` } : { tone: "danger", text: "복사하지 못했습니다. 직접 선택해 복사하세요." });
  };

  const share = async (inv) => {
    const text = `초대 코드 ${inv.code} (${inv.role_label}용)\n${joinLink(inv.code)}`;
    if (navigator.share) {
      try { await navigator.share({ title: "학원 초대", text }); return; } catch { /* 취소 → 복사로 */ }
    }
    copy(text, "초대 안내문");
  };

  const revoke = async (inv) => {
    if (!window.confirm(`초대 코드 ${inv.code} 를 폐기할까요? 이미 등록한 사람에게는 영향이 없습니다.`)) return;
    try {
      await revokeInvite(inv.invite_id);
      setItems((prev) => prev.map((x) => (x.invite_id === inv.invite_id ? { ...x, revoked: true, active: false } : x)));
    } catch (err) {
      setMessage({ tone: "danger", text: errorText(err, "폐기하지 못했습니다.") });
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <style>{STYLES}</style>
      <section className="settings-section">
        <h4>새 초대 코드</h4>
        <p>숫자 6자리 코드나 링크를 보내면 받은 사람이 로그인 후 바로 이 학원에 등록됩니다. 비공개 학원도 코드로는 들어올 수 있습니다.</p>
        <form className="inv-new" onSubmit={create}>
          <label>대상
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="parent">학부모</option><option value="staff">직원</option>
            </select>
          </label>
          <label>유효 기간
            <select className="select" value={form.expires_days} onChange={(e) => setForm({ ...form, expires_days: e.target.value })}>
              <option value={1}>1일</option><option value={3}>3일</option><option value={7}>7일</option><option value={14}>14일</option><option value={30}>30일</option>
            </select>
          </label>
          <label>사용 횟수
            <input className="input" type="number" min="1" max="1000" placeholder="제한 없음" value={form.max_uses}
              onChange={(e) => setForm({ ...form, max_uses: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={busy}>{busy ? "만드는 중…" : "코드 만들기"}</button>
        </form>
      </section>

      {message && <div className={`fl-banner ${message.tone}`} role="status">{message.text}</div>}

      {items === null ? <div className="fl-skeleton" style={{ height: 120 }} /> : items.length === 0 ? (
        <div className="empty">아직 만든 초대 코드가 없습니다.</div>
      ) : (
        <div className="inv-list">
          {items.map((inv) => (
            <div key={inv.invite_id} className={`inv-item${inv.active ? "" : " off"}`}>
              <div className="inv-code" aria-label={`초대 코드 ${inv.code.split("").join(" ")}`}>{inv.code}</div>
              <div className="inv-meta">
                <span className={`badge ${inv.role === "staff" ? "warning" : "primary"} no-dot`} style={{ marginRight: 6 }}>{inv.role_label}</span>
                {inv.revoked ? "폐기됨" : inv.active ? `${fmt(inv.expires_at)}까지` : "만료됨"}
                <div>사용 {inv.use_count}{inv.max_uses ? ` / ${inv.max_uses}` : ""}회</div>
              </div>
              <div className="inv-actions">
                {inv.active && (
                  <>
                    <button type="button" className="btn ghost sm" onClick={() => copy(inv.code, "코드")}>코드 복사</button>
                    <button type="button" className="btn ghost sm" onClick={() => copy(joinLink(inv.code), "초대 링크")}>링크 복사</button>
                    <button type="button" className="btn ghost sm" onClick={() => share(inv)}>공유</button>
                    <button type="button" className="btn danger sm" onClick={() => revoke(inv)}>폐기</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

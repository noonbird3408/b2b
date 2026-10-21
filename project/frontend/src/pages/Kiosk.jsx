import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { errorText, fetchKioskToday, fetchMe, kioskCheck, kioskLookup } from "../api";

// 출석 키오스크 — 시설 입구 태블릿용 전체 화면
// 관리자·직원 계정으로 로그인한 기기에서 열고, 학생(보호자)이 연락처 뒤 4자리로 등원/하원합니다.
// 이름은 서버에서 가려서(김*준) 내려오며, 처리 즉시 학부모 포털로 알림이 갑니다.

const RESET_MS = 7000;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "확인"];

const styles = {
  page: { minHeight: "100vh", background: "linear-gradient(160deg,#0f172a,#1e3a8a)", color: "#fff", display: "flex",
    flexDirection: "column", fontFamily: "inherit", userSelect: "none" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 28px" },
  main: { flex: 1, display: "grid", gridTemplateColumns: "minmax(320px, 440px) minmax(280px, 1fr)", gap: 28,
    padding: "8px 28px 28px", alignItems: "start", maxWidth: 1100, width: "100%", margin: "0 auto", boxSizing: "border-box" },
  card: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 20, padding: 24 },
  dots: { display: "flex", gap: 14, justifyContent: "center", margin: "10px 0 22px" },
  key: { height: 72, fontSize: 26, fontWeight: 700, borderRadius: 16, border: "none", cursor: "pointer",
    background: "rgba(255,255,255,0.14)", color: "#fff" },
  bigBtn: { flex: 1, height: 64, fontSize: 20, fontWeight: 800, borderRadius: 14, border: "none", cursor: "pointer" },
};

export default function Kiosk() {
  const [auth, setAuth] = useState("checking");   // checking | ok | denied
  const [digits, setDigits] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [message, setMessage] = useState(null);   // { tone: ok|warn|error, text }
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(null);
  const [clock, setClock] = useState(new Date());
  const resetTimer = useRef(null);

  const reset = useCallback(() => {
    setDigits(""); setCandidates(null); setMessage(null);
  }, []);

  const scheduleReset = useCallback(() => {
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(reset, RESET_MS);
  }, [reset]);

  const refreshToday = useCallback(() => {
    fetchKioskToday().then(setToday).catch(() => {});
  }, []);

  useEffect(() => {
    fetchMe()
      .then((me) => setAuth(me?.active_role === "admin" && me?.can_admin ? "ok" : "denied"))
      .catch(() => setAuth("denied"));
  }, []);

  useEffect(() => {
    if (auth !== "ok") return undefined;
    refreshToday();
    const t1 = window.setInterval(refreshToday, 30000);
    const t2 = window.setInterval(() => setClock(new Date()), 1000);
    return () => { window.clearInterval(t1); window.clearInterval(t2); window.clearTimeout(resetTimer.current); };
  }, [auth, refreshToday]);

  const lookup = useCallback(async (value) => {
    setBusy(true); setMessage(null);
    try {
      const rows = await kioskLookup(value);
      if (!rows.length) {
        setMessage({ tone: "error", text: "일치하는 학생이 없습니다. 번호를 다시 확인해 주세요." });
        setDigits(""); scheduleReset();
      } else {
        setCandidates(rows); scheduleReset();
      }
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error, "조회하지 못했습니다.") });
      setDigits("");
    } finally {
      setBusy(false);
    }
  }, [scheduleReset]);

  const press = useCallback((key) => {
    if (busy || candidates) return;
    if (key === "지움") { setDigits((d) => d.slice(0, -1)); return; }
    if (key === "확인") return;   // 4자리가 되면 자동 조회
    setDigits((d) => (d.length >= 4 ? d : d + key));
  }, [busy, candidates, digits, lookup]);

  // 4자리가 채워지면 자동 조회
  useEffect(() => {
    if (digits.length !== 4 || candidates || busy) return undefined;
    const t = window.setTimeout(() => lookup(digits), 150);
    return () => window.clearTimeout(t);
  }, [digits]); // 숫자가 바뀔 때만 실행 (lookup·busy 는 의도적으로 제외)

  // 물리 키보드 입력 지원 (USB 키패드 등)
  useEffect(() => {
    if (auth !== "ok") return undefined;
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("지움");
      else if (e.key === "Enter") press("확인");
      else if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [auth, press, reset]);

  const act = async (member, action) => {
    setBusy(true);
    try {
      const result = await kioskCheck(member.member_id, action);
      setMessage({
        tone: result.today_status === "LATE" && action === "in" ? "warn" : "ok",
        text: `${result.message}${result.parent_notified ? " · 보호자에게 알림을 보냈습니다" : ""}`,
      });
      setCandidates(null); setDigits("");
      refreshToday();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error, "처리하지 못했습니다.") });
    } finally {
      setBusy(false);
      scheduleReset();
    }
  };

  if (auth === "checking") return <div style={styles.page}><div style={{ margin: "auto" }}>키오스크를 준비하는 중입니다…</div></div>;
  if (auth === "denied") {
    return (
      <div style={styles.page}>
        <div style={{ margin: "auto", textAlign: "center", maxWidth: 420, padding: 24 }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <h2>관리자 로그인이 필요합니다</h2>
          <p style={{ opacity: 0.8, lineHeight: 1.6 }}>키오스크는 원장·직원 계정으로 로그인한 기기(태블릿)에서만 열 수 있습니다.
            로그인 후 관리자 화면 왼쪽 메뉴의 “출석 키오스크”를 눌러 주세요.</p>
          <Link to="/" style={{ color: "#93c5fd" }}>로그인 화면으로</Link>
        </div>
      </div>
    );
  }

  const toneColor = { ok: "#22c55e", warn: "#f59e0b", error: "#ef4444" };
  const brandName = today?.brand?.name || "출석 체크";

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{brandName}</div>
          <div style={{ opacity: 0.7, fontSize: 14 }}>
            {clock.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })} · {clock.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <Link to="/attendances" style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, textDecoration: "none" }}>관리자 화면으로 ↩</Link>
      </header>

      <main style={styles.main} className="kiosk-main">
        <section style={styles.card} aria-label="번호 입력">
          <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700 }}>보호자 연락처 뒤 4자리를 눌러 주세요</div>
          <div style={styles.dots} aria-live="polite">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ width: 54, height: 64, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30, fontWeight: 800, background: digits[i] ? "#fff" : "rgba(255,255,255,0.1)", color: "#1e3a8a" }}>
                {digits[i] || ""}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {KEYS.map((key) => (
              <button key={key} type="button" onClick={() => press(key)} disabled={busy}
                style={{ ...styles.key, ...(key === "확인" ? { background: "#3b82f6", fontSize: 20 } : {}), ...(key === "지움" ? { fontSize: 18 } : {}) }}>
                {key}
              </button>
            ))}
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {message && (
            <div role="status" style={{ ...styles.card, borderColor: toneColor[message.tone], background: `${toneColor[message.tone]}22`,
              fontSize: 22, fontWeight: 700, textAlign: "center", lineHeight: 1.5 }}>
              {message.tone === "error" ? "⚠️ " : message.tone === "warn" ? "⏰ " : "✅ "}{message.text}
            </div>
          )}

          {candidates && (
            <div style={styles.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>본인을 선택해 주세요</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {candidates.map((m) => (
                  <div key={m.member_id} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                      <span style={{ fontSize: 24, fontWeight: 800 }}>{m.masked_name}</span>
                      <span style={{ fontSize: 13, opacity: 0.75 }}>{m.classes.join(", ") || "수강 반 없음"}</span>
                    </div>
                    {m.next_action === "done" ? (
                      <div style={{ opacity: 0.8 }}>오늘은 {m.check_in_time} 등원 · {m.check_out_time} 하원을 마쳤습니다.</div>
                    ) : (
                      <div style={{ display: "flex", gap: 10 }}>
                        <button type="button" disabled={busy || m.next_action !== "in"} onClick={() => act(m, "in")}
                          style={{ ...styles.bigBtn, background: m.next_action === "in" ? "#22c55e" : "rgba(255,255,255,0.12)", color: "#fff",
                            opacity: m.next_action === "in" ? 1 : 0.5 }}>
                          등원{m.check_in_time ? ` (${m.check_in_time})` : ""}
                        </button>
                        <button type="button" disabled={busy || m.next_action !== "out"} onClick={() => act(m, "out")}
                          style={{ ...styles.bigBtn, background: m.next_action === "out" ? "#f97316" : "rgba(255,255,255,0.12)", color: "#fff",
                            opacity: m.next_action === "out" ? 1 : 0.5 }}>
                          하원
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={reset} style={{ marginTop: 14, background: "transparent", color: "#cbd5e1", border: "none", cursor: "pointer", fontSize: 15 }}>
                ← 다시 입력
              </button>
            </div>
          )}

          <div style={styles.card}>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {[["재원", today?.active_members], ["등원", today?.checked_in], ["하원", today?.checked_out]].map(([label, value]) => (
                <div key={label} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "10px 0" }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>오늘 {label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>{value ?? "–"}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>최근 처리</div>
            {(today?.recent || []).length === 0 ? (
              <div style={{ opacity: 0.6, fontSize: 14 }}>아직 오늘 출결 기록이 없습니다.</div>
            ) : (
              today.recent.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i ? "1px solid rgba(255,255,255,0.08)" : "none", fontSize: 15 }}>
                  <span>{r.masked_name}</span>
                  <span style={{ opacity: 0.85 }}>{r.action === "out" ? "🏠 하원" : r.status === "LATE" ? "⏰ 지각" : "🟢 등원"} {r.time}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      <style>{`@media (max-width: 760px) { .kiosk-main { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

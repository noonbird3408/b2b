import { SUBJECTS } from "../utils/constants";

/** 주요 과목 칩 — 쇼핑몰이 이 과목의 교재·교구를 먼저 추천합니다(개설 수업에서도 자동으로 찾음) */
export default function SubjectPicker({ value, onChange }) {
  const selected = new Set(value || []);
  const toggle = (s) => onChange(SUBJECTS.filter((x) => (x === s ? !selected.has(s) : selected.has(x))));
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="주요 과목">
      {SUBJECTS.map((s) => (
        <button key={s} type="button" className={`chip${selected.has(s) ? " active" : ""}`} aria-pressed={selected.has(s)}
          onClick={() => toggle(s)} style={selected.has(s) ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}>
          {s}
        </button>
      ))}
    </div>
  );
}

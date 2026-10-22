import { Link } from "react-router-dom";

/**
 * 모든 화면 공통 서비스 표시 "facilink" — 누르면 메인(/)으로 이동합니다.
 * 메인은 로그인 상태에 따라 로그인 → 역할 선택 → (관리자) 시설 선택 / (학부모) 내 시설 화면으로 이어집니다.
 */
export default function Brand({ sub, compact = false, to = "/" }) {
  return (
    <Link to={to} className={`fl-brand${compact ? " compact" : ""}`} aria-label="facilink 메인으로 이동">
      <span className="fl-brand-logo" aria-hidden="true">f</span>
      <span className="fl-brand-text">
        <strong>facilink</strong>
        {sub ? <small>{sub}</small> : null}
      </span>
    </Link>
  );
}

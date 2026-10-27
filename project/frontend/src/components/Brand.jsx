import { Link } from "react-router-dom";
import { BRAND } from "../utils/brand";

/**
 * 모든 화면 공통 서비스 표시(utils/brand.js) — 누르면 메인(/)으로 이동합니다.
 * 메인은 로그인 상태에 따라 로그인 → 역할 선택 → (관리자) 학원 선택 / (학부모) 내 학원 화면으로 이어집니다.
 */
export default function Brand({ sub, compact = false, to = "/" }) {
  return (
    <Link to={to} className={`fl-brand${compact ? " compact" : ""}`} aria-label={`${BRAND.name} 메인으로 이동`}>
      <span className="fl-brand-logo" aria-hidden="true">{BRAND.logo}</span>
      <span className="fl-brand-text">
        <strong>{BRAND.name}</strong>
        <small>{sub || BRAND.tagline}</small>
      </span>
    </Link>
  );
}

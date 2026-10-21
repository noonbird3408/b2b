import { useEffect, useState } from "react";

/** 사진 크게 보기 (관리자 커뮤니티·학부모 포털 공용). ←/→ 키, Esc 로 닫기 */
export default function Lightbox({ photos, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const count = photos.length;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [count, onClose]);

  if (!count) return null;
  const navBtn = {
    position: "absolute", top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: 9999,
    border: "none", background: "rgba(255,255,255,0.18)", color: "#fff", fontSize: 22, cursor: "pointer",
  };
  return (
    <div role="dialog" aria-label="사진 보기" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src={photos[index]} alt={`사진 ${index + 1}`} onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "92vw", maxHeight: "86vh", objectFit: "contain", borderRadius: 8 }} />
      {count > 1 && (
        <>
          <button type="button" aria-label="이전 사진" style={{ ...navBtn, left: 16 }} onClick={(e) => { e.stopPropagation(); setIndex((index - 1 + count) % count); }}>‹</button>
          <button type="button" aria-label="다음 사진" style={{ ...navBtn, right: 16 }} onClick={(e) => { e.stopPropagation(); setIndex((index + 1) % count); }}>›</button>
        </>
      )}
      <div style={{ position: "absolute", bottom: 20, color: "#fff", fontSize: 14 }}>{index + 1} / {count}</div>
      <button type="button" aria-label="닫기" onClick={onClose}
        style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#fff", fontSize: 28, cursor: "pointer" }}>✕</button>
    </div>
  );
}

/** 게시물 사진 격자 (최대 4장 표시, 나머지는 +N) — 누르면 Lightbox */
export function PhotoGrid({ photos, onOpen }) {
  if (!photos?.length) return null;
  const shown = photos.slice(0, 4);
  return (
    <div style={{ display: "grid", gridTemplateColumns: photos.length === 1 ? "1fr" : "1fr 1fr", gap: 8, borderRadius: "var(--radius-lg, 12px)", overflow: "hidden", marginBottom: 14 }}>
      {shown.map((src, i) => (
        <button key={i} type="button" onClick={() => onOpen(i)} aria-label={`사진 ${i + 1} 크게 보기`}
          style={{ position: "relative", padding: 0, border: "none", cursor: "zoom-in", background: "none" }}>
          <img src={src} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
          {i === 3 && photos.length > 4 && (
            <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 24, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center" }}>+{photos.length - 4}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// =====================================================================
// 이미지 업로드 전 축소 — 휴대폰 원본 사진(3~10MB)을 그대로 보내면
// Vercel 함수 요청 한도(4.5MB)를 넘어 업로드가 실패합니다. 브라우저에서 먼저 줄여 보냅니다.
// =====================================================================

/** 용도별 기본 크기 (긴 변 픽셀, JPEG 품질) */
export const IMAGE_PRESETS = {
  profile: { maxSize: 512, quality: 0.85, mime: "image/jpeg" },     // 학생 프로필 (~60KB)
  post: { maxSize: 1600, quality: 0.82, mime: "image/jpeg" },       // 커뮤니티 사진 (~300KB)
  document: { maxSize: 1600, quality: 0.85, mime: "image/jpeg" },   // OCR 서류 사진 (글자 판독 가능 크기)
  logo: { maxSize: 256, quality: 0.92, mime: "image/png" },         // 기관 로고 (투명 배경 유지)
};

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽지 못했습니다. JPG·PNG 사진을 선택하세요.")); };
    img.src = url;
  });
}

/**
 * 이미지 파일 → 축소된 data URL ("data:image/jpeg;base64,...")
 * @param {File} file
 * @param {"profile"|"post"|"document"|"logo"|{maxSize:number, quality:number, mime:string}} preset
 */
export async function resizeImageFile(file, preset = "post") {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("이미지 파일만 올릴 수 있습니다.");
  }
  const { maxSize, quality, mime } = typeof preset === "string" ? IMAGE_PRESETS[preset] : preset;
  const img = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (mime === "image/jpeg") {        // 투명 영역이 검게 나오지 않도록 흰 배경
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(mime, quality);
}

/** 여러 장을 순서대로 축소 */
export async function resizeImageFiles(files, preset = "post") {
  const results = [];
  for (const file of files) results.push(await resizeImageFile(file, preset));
  return results;
}

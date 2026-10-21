import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 서버: /api 요청을 FastAPI(8000)로 프록시 → 프론트와 API 가 같은 출처가 되어
// 세션 쿠키·CORS 설정이 배포(Vercel, 같은 도메인)와 동일하게 동작합니다.
const backend = process.env.VITE_DEV_BACKEND || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        // 자주 바뀌지 않는 라이브러리를 별도 청크로 분리해 브라우저 캐시 효율을 높임
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});

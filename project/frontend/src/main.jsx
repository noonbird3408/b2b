import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./index.css";
import FacilityManagerUI from "./components/FacilityManagerUI.jsx";

// [PERF] 라우트 단위 코드 분할 — 로그인 화면은 관리자/쇼핑몰/AI 페이지 코드를 내려받지 않습니다.
const Layout = lazy(() => import("./components/Layout.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Members = lazy(() => import("./pages/Members.jsx"));
const Classes = lazy(() => import("./pages/Classes.jsx"));
const Attendances = lazy(() => import("./pages/Attendances.jsx"));
const AIservice = lazy(() => import("./pages/AIservice.jsx"));
const Community = lazy(() => import("./pages/Community.jsx"));
const AdminCheckout = lazy(() => import("./pages/AdminCheckout.jsx"));
const Shop = lazy(() => import("./pages/Shop.jsx"));
const B2BShop = lazy(() => import("./pages/B2BShopLive.jsx"));
const ParentPortal = lazy(() => import("./pages/ParentPortal.jsx"));
const Inventory = lazy(() => import("./pages/Inventory.jsx"));

const Loading = () => <div className="auth-loading">화면을 불러오는 중입니다.</div>;

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* 1) Google 로그인 → 2) 학부모/관리자 선택 → 3) 관리자는 학원 관리/쇼핑몰 선택 */}
          <Route path="/" element={<FacilityManagerUI />} />
          {/* 학부모 (카카오페이 결과는 /checkout?kakao=... 로 돌아옴) */}
          <Route path="/parentportal" element={<ParentPortal />} />
          <Route path="/checkout" element={<ParentPortal />} />
          {/* 관리자 */}
          <Route path="/b2b-shop" element={<B2BShop />} />
          {/* v10: 출석 키오스크 삭제 — 예전 주소로 들어오면 출석 체크 화면으로 */}
          <Route path="/kiosk" element={<Navigate to="/attendances" replace />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/members" element={<Members />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/attendances" element={<Attendances />} />
            <Route path="/aiservice" element={<AIservice />} />
            <Route path="/community" element={<Community />} />
            <Route path="/admin-checkout" element={<AdminCheckout />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/inventory" element={<Inventory />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
  </BrowserRouter>
);

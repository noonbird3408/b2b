import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { enterFacility, enterParentFacility, fetchMe, selectRole } from "../api";
import { NOTIFICATION_META } from "../utils/constants";

// =====================================================================
// v14 휴대폰 알림을 눌렀을 때 도착하는 화면 (/open?a=admin|parent&f=학원&k=종류&l=링크&m=학생)
//   알림이 온 학원으로 먼저 들어간 뒤 그 알림의 화면으로 이동합니다.
//   (다른 학원을 보고 있었더라도 알림의 학원으로 맞춰 줌 — 로그인이 풀렸으면 메인으로)
// =====================================================================
const STAFF_PATHS = ["/attendances", "/members", "/classes", "/inventory", "/shop"];
const PARENT_TABS = { children: "kids", notices: "feed", feed: "feed", pay: "pay" };

export default function OpenNotification() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const audience = params.get("a") === "parent" ? "parent" : "admin";
    const facilityId = Number(params.get("f")) || null;
    const kind = params.get("k") || "";
    const link = params.get("l") || "";
    const memberId = params.get("m");
    (async () => {
      try {
        const me = await fetchMe();
        if (audience === "parent") {
          if (me.active_role !== "parent") await selectRole("parent");
          if (facilityId) await enterParentFacility(facilityId);
          const tab = PARENT_TABS[link] || PARENT_TABS[NOTIFICATION_META[kind]?.parent] || "kids";
          navigate(`/parentportal?tab=${tab}`, { replace: true });
          return;
        }
        if (!me.can_admin) { navigate("/", { replace: true }); return; }
        if (me.active_role !== "admin") await selectRole("admin");
        const current = facilityId ? await enterFacility(facilityId) : me;
        const isOwner = current.facility?.my_role === "owner";
        let target = link ? `/${link.replace(/^\//, "")}` : NOTIFICATION_META[kind]?.admin;
        if (target === "/members" && memberId) target = `/members?member=${memberId}`;
        if (!target || !(isOwner || STAFF_PATHS.some((p) => target.startsWith(p)))) target = isOwner ? "/dashboard" : "/attendances";
        navigate(target, { replace: true });
      } catch {
        navigate("/", { replace: true });       // 로그인 만료·권한 없음 → 메인(로그인)으로
      }
    })();
  }, [navigate, params]);

  return <div className="auth-loading">알림 내용을 여는 중입니다…</div>;
}

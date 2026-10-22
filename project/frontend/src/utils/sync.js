import { useEffect, useRef } from "react";
import { DATA_CHANGED_EVENT } from "../api";

/**
 * 서버 데이터가 바뀌면(관리자 셸·학부모 포털이 data_version 변화를 감지) callback 을 다시 실행합니다.
 *  - 다른 기기에서 학부모가 결제했거나, 다른 탭에서 수업을 고친 경우에도 화면이 자동으로 최신화됩니다.
 *  - callback 은 최신 값을 참조하도록 ref 로 보관합니다(매 렌더마다 이벤트를 다시 붙이지 않음).
 */
export function useDataRefresh(callback) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const handler = () => ref.current?.();
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
  }, []);
}

/** data_version 이 바뀌었음을 알림 (셸에서만 호출) */
export function announceDataChanged(version) {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { version } }));
}

/** 원 단위 금액 표시 */
export const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;

export const DAY_LABELS = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일" };
export const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const STATUS_LABEL = { PRESENT: "출석", LATE: "지각", ABSENT: "결석" };
export const STATUS_TONE = { PRESENT: "success", LATE: "warning", ABSENT: "danger" };

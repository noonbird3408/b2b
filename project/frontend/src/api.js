import axios from "axios";

// =====================================================================
// 모든 REST 호출은 이 파일에 모읍니다.
//  - 개발: Vite 프록시(/api → http://localhost:8000)를 쓰므로 baseURL 은 빈 값(같은 출처)
//  - 배포(Vercel): 프론트와 /api 가 같은 도메인 → 역시 빈 값
//  - 백엔드를 다른 도메인에 둘 때만 VITE_API_BASE_URL 지정
// =====================================================================
const API = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 15000,
  withCredentials: true,
});

const AI_TIMEOUT = { timeout: 60000 }; // AI 분석/OCR 은 오래 걸릴 수 있음

// 428 = 학원을 아직 고르지 않음(또는 접근 권한이 사라짐) → 화면이 학원 선택으로 이동하도록 알림
export const FACILITY_REQUIRED_EVENT = "facilink:facility-required";
// 서버 데이터 버전이 바뀌었을 때(다른 기기·다른 사용자의 변경 포함) 화면들이 다시 불러오도록 알림
export const DATA_CHANGED_EVENT = "facilink:data-changed";
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 428) {
      window.dispatchEvent(new CustomEvent(FACILITY_REQUIRED_EVENT, { detail: error.response.data?.detail }));
    }
    return Promise.reject(error);
  },
);
const data = (r) => r.data;

/** 서버 오류 메시지(한국어 detail)를 꺼내는 공통 함수 */
export const errorText = (error, fallback = "요청을 처리하지 못했습니다.") =>
  error?.response?.data?.detail || (error?.code === "ECONNABORTED" ? "서버 응답이 늦습니다. 잠시 후 다시 시도하세요." : error?.message) || fallback;

/** 브라우저 기준 오늘 날짜 YYYY-MM-DD (toISOString 은 UTC 라 한국 시간 오전 9시 전에는 어제가 됨) */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ----- 인증 (Google 로그인 + 역할 선택) -----
export const fetchGoogleAuthConfig = () => API.get("/api/auth/google/config").then(data);
export const signInWithGoogle = (credential) => API.post("/api/auth/google", { credential }).then(data);
export const devSignIn = (email, name) => API.post("/api/auth/dev-login", { email, name }).then(data);
export const fetchMe = () => API.get("/api/auth/me").then(data);
/** role: "parent" | "admin" — 관리자 권한은 서버가 판정 */
export const selectRole = (role, inviteCode = "") => API.post("/api/auth/role", { role, invite_code: inviteCode }).then(data);
export const signOut = () => API.post("/api/auth/logout").then(data);
export const fetchAdminAccounts = () => API.get("/api/admin/accounts").then(data);
export const createAdminAccount = (payload) => API.post("/api/admin/accounts", payload).then(data);
export const updateAdminAccount = (accountId, payload) => API.patch(`/api/admin/accounts/${accountId}`, payload).then(data);
export const deleteAdminAccount = (accountId) => API.delete(`/api/admin/accounts/${accountId}`);

// ----- 학원 (관리자: 내 학원 목록·생성·수정·삭제·입장) -----
export const fetchFacilities = () => API.get("/api/facilities").then(data);
export const createFacility = (payload) => API.post("/api/facilities", payload).then(data);
export const updateFacility = (id, payload) => API.put(`/api/facilities/${id}`, payload).then(data);
/** 삭제(보관) — 실수 방지를 위해 학원 이름을 한 번 더 입력받아 서버가 확인 */
export const deleteFacility = (id, confirmName) => API.delete(`/api/facilities/${id}`, { params: { confirm_name: confirmName } });
export const enterFacility = (id) => API.post(`/api/facilities/${id}/enter`).then(data);
export const exitFacility = () => API.post("/api/facilities/exit").then(data);
/** 가벼운 동기화 확인 — {data_version} */
export const fetchSyncVersion = () => API.get("/api/sync").then(data);

// ----- 기관 설정 / 백업 -----
export const fetchAppSettings = () => API.get("/api/settings").then(data);
export const saveAppSettings = (payload) => API.put("/api/settings", payload).then(data);
export const exportAdminData = () => API.get("/api/admin/data-export").then(data);
export const importAdminSettings = (payload) => API.post("/api/admin/data-import", payload).then(data);
export const fetchAcademyInfo = () => API.get("/api/academy").then(data);
/** 시연용 데모 데이터 넣기 (학생이 없을 때만, force=true 면 추가) */
export const loadDemoData = (force = false) => API.post("/api/admin/demo-data", { force }).then(data);

// ----- 상단 요약 · 알림함 (주기적 조회) -----
export const fetchAdminSummary = () => API.get("/api/admin/summary").then(data);
export const fetchAdminNotifications = (params) => API.get("/api/notifications", { params }).then(data);
export const markAdminNotificationsRead = (payload) => API.post("/api/notifications/read", payload).then(data);

// ----- 오늘의 업무 (계정별 서버 저장) -----
export const fetchTodos = () => API.get("/api/todos").then(data);
export const createTodo = (payload) => API.post("/api/todos", payload).then(data);
export const updateTodo = (id, payload) => API.put(`/api/todos/${id}`, payload).then(data);
export const deleteTodo = (id) => API.delete(`/api/todos/${id}`);
export const clearTodos = (doneOnly = true) => API.delete("/api/todos", { params: { done_only: doneOnly } }).then(data);

// ----- 외부 쇼핑몰 (ddmmall77) 연동 + 추천 -----
export const fetchShopInfo = () => API.get("/api/shop/info").then(data);
export const fetchShopProducts = (params) => API.get("/api/shop/products", { params }).then(data);
/** 검색·맞춤 검색 — {q, category, min_price, max_price, quantity, fit: all|facility, include_quote, personalize, sort} */
export const searchShopProducts = (params) => API.get("/api/shop/search", { params }).then(data);
export const fetchShopRecommendations = (params) => API.get("/api/shop/recommendations", { params }).then(data);
export const logShopClick = (productId, context = "catalog") =>
  API.post(`/api/shop/products/${productId}/click`, { context }).then(data).catch(() => null);
export const createShopProduct = (payload) => API.post("/api/shop/products", payload).then(data);
export const updateShopProduct = (id, payload) => API.put(`/api/shop/products/${id}`, payload).then(data);
export const deactivateShopProduct = (id) => API.delete(`/api/shop/products/${id}`);
export const syncShopProducts = () => API.post("/api/shop/sync").then(data);
// v11 제휴몰 · 장바구니 · 주문 · 모의 결제 (금액은 모두 서버 계산)
export const fetchShopMalls = () => API.get("/api/shop/malls").then(data);
export const connectShopMall = (code) => API.post(`/api/shop/malls/${encodeURIComponent(code)}/connect`).then(data);
export const disconnectShopMall = (code) => API.delete(`/api/shop/malls/${encodeURIComponent(code)}/connect`).then(data);
export const quoteShopCart = (items) => API.post("/api/shop/cart/quote", { items }).then(data);
export const createShopOrder = (items, memo = "") => API.post("/api/shop/orders", { items, memo }).then(data);
export const fetchShopOrders = (params) => API.get("/api/shop/orders", { params }).then(data);
export const payShopOrder = (id, method, expectedTotal) =>
  API.post(`/api/shop/orders/${id}/pay`, { method, expected_total: expectedTotal }).then(data);
export const receiveShopOrder = (id) => API.post(`/api/shop/orders/${id}/receive`).then(data);
export const cancelShopOrder = (id, reason = "") => API.post(`/api/shop/orders/${id}/cancel`, { reason }).then(data);

// ----- B2B 발주 -----
export const fetchB2BProducts = (params) => API.get("/api/b2b/products", { params }).then(data);
export const fetchB2BClasses = () => API.get("/api/b2b/classes").then(data);
export const fetchB2BPortal = () => API.get("/api/b2b/portal").then(data);
export const fetchB2BRecommendations = (params) => API.get("/api/b2b/recommendations", { params }).then(data);
export const fetchB2BOrders = (params) => API.get("/api/b2b/orders", { params }).then(data);
export const createB2BOrder = (payload) => API.post("/api/b2b/orders", payload).then(data);
export const approveB2BOrder = (orderId) => API.post(`/api/b2b/orders/${orderId}/approve`).then(data);
export const rejectB2BOrder = (orderId) => API.post(`/api/b2b/orders/${orderId}/reject`).then(data);
export const prepareB2BPayment = (orderId) => API.post(`/api/b2b/orders/${orderId}/payment-ready`).then(data);
export const settleB2BOrder = (orderId) => API.post(`/api/b2b/orders/${orderId}/settle`).then(data);
export const requestB2BSample = (sku) => API.post(`/api/b2b/samples/${encodeURIComponent(sku)}`).then(data);
export const fetchB2BSamples = () => API.get("/api/b2b/samples").then(data);

// ----- 회원 (사진 photo_url 은 payload 에 포함해 함께 저장) -----
export const fetchMembers = (params) => API.get("/api/members", { params }).then(data);
export const createMember = (payload) => API.post("/api/members", payload).then(data);
export const updateMember = (id, payload) => API.put(`/api/members/${id}`, payload).then(data);
export const deleteMember = (id) => API.delete(`/api/members/${id}`);
/** {member_id: [수업명]} — 학생별 수강 수업을 한 번에 조회 */
export const fetchEnrollmentMap = () => API.get("/api/enrollments/by-member").then(data);
export const fetchMemberNotes = (memberId) => API.get(`/api/members/${memberId}/notes`).then(data);
export const createMemberNote = (memberId, content) => API.post(`/api/members/${memberId}/notes`, { content }).then(data);
export const deleteMemberNote = (noteId) => API.delete(`/api/member-notes/${noteId}`);
/** 학부모 알림 보내기 → {sent, message} (연결된 학부모가 없으면 sent=0) */
export const notifyMemberParents = (memberId, payload) => API.post(`/api/members/${memberId}/notify`, payload).then(data);
export const fetchMember = (memberId) => API.get(`/api/members/${memberId}`).then(data);
/** 수업별 출결 요약 + 최근 기록 + 12주 추이 */
export const fetchMemberAttendanceSummary = (memberId, params) =>
  API.get(`/api/members/${memberId}/attendance-summary`, { params }).then(data);

// ----- 가입(수강) 신청 심사 -----
export const fetchApplications = (status = "PENDING") => API.get("/api/applications", { params: { status } }).then(data);
export const approveApplication = (id, payload = {}) => API.post(`/api/applications/${id}/approve`, payload).then(data);
export const rejectApplication = (id, reason = "") => API.post(`/api/applications/${id}/reject`, { reason }).then(data);

// ----- 수업 -----
export const fetchClasses = () => API.get("/api/classes").then(data);
export const createClass = (payload) => API.post("/api/classes", payload).then(data);
export const updateClass = (id, payload) => API.put(`/api/classes/${id}`, payload).then(data);
export const deleteClass = (id) => API.delete(`/api/classes/${id}`);
export const fetchMemberClasses = (memberId) => API.get(`/api/members/${memberId}/classes`).then(data);
export const enrollStudent = (classId, memberId) => API.post(`/api/classes/${classId}/members/${memberId}`).then(data);
export const unenrollStudent = (classId, memberId) => API.delete(`/api/classes/${classId}/members/${memberId}`).then(data);

// ----- 출결 -----
export const fetchAttendances = (params) => API.get("/api/attendances", { params }).then(data);
export const createAttendance = (payload) => API.post("/api/attendances", payload).then(data);
export const deleteAttendance = (id) => API.delete(`/api/attendances/${id}`);
/** 출결 저장(있으면 변경) — {member_id, attendance_date, status}
 *  응답의 parent_notified = 이번 처리로 알림을 받은 학부모 수, parent_linked = 학부모 계정 연결 여부 (v10) */
export const markAttendance = (payload) => API.post("/api/attendances/mark", payload).then(data);
export const bulkAttendance = (payload) => API.post("/api/attendances/bulk", payload).then(data);
export const checkoutAttendance = (attendanceId) => API.post(`/api/attendances/${attendanceId}/checkout`).then(data);


// ----- 결제(이력) -----
export const fetchPayments = (params) => API.get("/api/payments", { params }).then(data);
export const createPayment = (payload) => API.post("/api/payments", payload).then(data);

// ----- 청구서(인보이스) -----
export const fetchInvoices = (params) => API.get("/api/invoices", { params }).then(data);
export const createInvoice = (payload) => API.post("/api/invoices", payload).then(data);
export const updateInvoice = (invoiceId, payload) => API.patch(`/api/invoices/${invoiceId}`, payload).then(data);
export const deleteInvoice = (invoiceId) => API.delete(`/api/invoices/${invoiceId}`).then(data);
/** 현장 수납 처리 — method: CASH / TRANSFER / CARD */
export const markInvoicePaid = (invoiceId, payload) => API.post(`/api/invoices/${invoiceId}/mark-paid`, payload).then(data);
/** 수강료 일괄 청구 — {member_ids?, class_id?, item_name, amount?, due_date?} (amount 생략 시 설정 기준) */
export const bulkCreateInvoices = (payload) => API.post("/api/invoices/bulk", payload).then(data);

// ----- 카카오페이 원격결제 (관리자) -----
export const fetchKakaoStatus = () => API.get("/api/payments/kakao/status").then(data);
export const kakaoReady = (payload) => API.post("/api/payments/kakao-ready", payload).then(data);
export const fetchKakaoPending = (params) => API.get("/api/payments/kakao/pending", { params }).then(data);
export const cleanupKakaoPending = (params) => API.post("/api/payments/kakao/cleanup", null, { params }).then(data);

// ----- 공지사항 -----
export const fetchNotices = (params) => API.get("/api/notices", { params }).then(data);
export const createNotice = (payload) => API.post("/api/notices", payload).then(data);
export const updateNotice = (id, payload) => API.put(`/api/notices/${id}`, payload).then(data);
export const deleteNotice = (id) => API.delete(`/api/notices/${id}`);
/** 공지 자동 작성 — {keywords: "에버랜드, 10/25, 선택 참여", class_id?, use_ai?} → {title, content, content_html, category, ...} */
export const draftNotice = (payload) => API.post("/api/notices/draft", payload, AI_TIMEOUT).then(data);

// ----- 첨부파일 (파일 1개씩 multipart 로 — Vercel 요청 한도 4.5MB) -----
const fileForm = (file) => { const form = new FormData(); form.append("file", file); return form; };
export const uploadNoticeAttachment = (noticeId, file) => API.post(`/api/notices/${noticeId}/attachments`, fileForm(file), AI_TIMEOUT).then(data);
export const uploadPostAttachment = (postId, file) => API.post(`/api/community/posts/${postId}/attachments`, fileForm(file), AI_TIMEOUT).then(data);
export const deleteAttachment = (attachmentId) => API.delete(`/api/community/attachments/${attachmentId}`);
export const uploadParentAttachment = (postId, file) => API.post(`/api/parent/community/posts/${postId}/attachments`, fileForm(file), AI_TIMEOUT).then(data);
export const deleteParentAttachment = (attachmentId) => API.delete(`/api/parent/community/attachments/${attachmentId}`);

// ----- 커뮤니티 게시판 (관리자) -----
/** params: {category: ALL|NOTICE|FREE|QUESTION|PHOTO|INFO, q, field: title|content|title_content|author, page, size} */
export const fetchCommunityBoard = (params) => API.get("/api/community/board", { params }).then(data);
export const fetchCommunityPost = (id) => API.get(`/api/community/posts/${id}`).then(data);
export const moderatePost = (id, decision) => API.post(`/api/community/posts/${id}/moderate`, { decision }).then(data);
export const fetchModerationPosts = (status = "PENDING") => API.get("/api/community/moderation/posts", { params: { status } }).then(data);
export const fetchCommunityMembers = () => API.get("/api/community/members").then(data);
/** action: warn / mute / unmute / ban / unban */
export const sanctionCommunityMember = (membershipId, payload) =>
  API.post(`/api/community/members/${membershipId}/sanction`, payload).then(data);
export const fetchCommunityPosts = () => API.get("/api/community/posts").then(data);
export const createCommunityPost = (payload) => API.post("/api/community/posts", payload).then(data); // {content, photos:[base64...]}
export const updateCommunityPost = (id, payload) => API.put(`/api/community/posts/${id}`, payload).then(data);
export const likeCommunityPost = (id) => API.post(`/api/community/posts/${id}/like`).then(data);
export const deleteCommunityPost = (id) => API.delete(`/api/community/posts/${id}`);
export const fetchComments = (postId) => API.get(`/api/community/posts/${postId}/comments`).then(data);
export const createComment = (postId, payload) => API.post(`/api/community/posts/${postId}/comments`, payload).then(data);
export const deleteComment = (commentId) => API.delete(`/api/community/comments/${commentId}`);
// ----- 커뮤니티 AI 모니터링 -----
export const fetchModerationQueue = (status = "pending") => API.get("/api/community/moderation", { params: { status } }).then(data);
export const moderateComment = (commentId, decision) => API.post(`/api/community/comments/${commentId}/moderate`, { decision }).then(data);
export const fetchModerationStats = () => API.get("/api/community/moderation/stats").then(data);
export const downloadModerationDataset = () => API.get("/api/community/moderation/export", { responseType: "blob" }).then(data);

// ----- 학부모: 학원 찾기·입장 / 자녀 프로필 / 가입 신청 (학원 선택 전에도 사용) -----
export const searchFacilities = (params) => API.get("/api/parent/facilities/search", { params }).then(data);
export const fetchMyFacilities = () => API.get("/api/parent/facilities/mine").then(data);
export const fetchFacilityDetail = (id) => API.get(`/api/parent/facilities/${id}`).then(data);
export const enterParentFacility = (id) => API.post(`/api/parent/facilities/${id}/enter`).then(data);
export const exitParentFacility = () => API.post("/api/parent/facilities/exit").then(data);
export const leaveParentFacility = (id) => API.delete(`/api/parent/facilities/${id}/membership`);
export const fetchChildProfiles = () => API.get("/api/parent/child-profiles").then(data);
export const createChildProfile = (payload) => API.post("/api/parent/child-profiles", payload).then(data);
export const updateChildProfile = (id, payload) => API.put(`/api/parent/child-profiles/${id}`, payload).then(data);
export const deleteChildProfile = (id) => API.delete(`/api/parent/child-profiles/${id}`);
/** 가입 신청 — 예상 비용은 서버가 수업 수강료로 계산 */
export const applyToFacility = (facilityId, payload) => API.post(`/api/parent/facilities/${facilityId}/applications`, payload).then(data);
export const fetchParentApplications = () => API.get("/api/parent/applications").then(data);
export const cancelParentApplication = (id) => API.post(`/api/parent/applications/${id}/cancel`).then(data);

// ----- 학부모 포털 (학부모 세션 전용, 연결된 자녀 데이터만) -----
export const fetchParentChildren = () => API.get("/api/parent/children").then(data);
export const linkParentChild = (childName, phone) => API.post("/api/parent/children", { child_name: childName, phone }).then(data);
export const unlinkParentChild = (memberId) => API.delete(`/api/parent/children/${memberId}`);
export const fetchParentInvoices = (status = "UNPAID") => API.get("/api/parent/invoices", { params: { status } }).then(data);
export const fetchParentAttendances = (memberId, days = 30) =>
  API.get("/api/parent/attendances", { params: { member_id: memberId, days } }).then(data);
export const parentKakaoReady = (invoiceId) => API.post("/api/parent/payments/kakao-ready", { invoice_id: invoiceId }).then(data);
export const fetchParentNotices = () => API.get("/api/parent/notices").then(data);
export const fetchParentPosts = () => API.get("/api/parent/community/posts").then(data);
export const createParentPost = (payload) => API.post("/api/parent/community/posts", payload).then(data);
export const fetchParentBoard = (params) => API.get("/api/parent/community/board", { params }).then(data);
export const fetchParentPost = (id) => API.get(`/api/parent/community/posts/${id}`).then(data);
export const updateParentPost = (id, payload) => API.put(`/api/parent/community/posts/${id}`, payload).then(data);
export const deleteParentPost = (id) => API.delete(`/api/parent/community/posts/${id}`);
export const deleteParentComment = (commentId) => API.delete(`/api/parent/community/comments/${commentId}`);
export const updateParentMembership = (nickname) => API.put("/api/parent/membership", { nickname }).then(data);
export const likeParentPost = (id) => API.post(`/api/parent/community/posts/${id}/like`).then(data);
export const fetchParentComments = (postId) => API.get(`/api/parent/community/posts/${postId}/comments`).then(data);
export const createParentComment = (postId, content) =>
  API.post(`/api/parent/community/posts/${postId}/comments`, { content }).then(data);
export const markParentNoticesRead = (noticeIds) => API.post("/api/parent/notices/read", { notice_ids: noticeIds }).then(data);
export const fetchParentSummary = () => API.get("/api/parent/summary").then(data);
export const fetchParentNotifications = (params) => API.get("/api/parent/notifications", { params }).then(data);
export const markParentNotificationsRead = (payload) => API.post("/api/parent/notifications/read", payload).then(data);
export const fetchParentAssignments = () => API.get("/api/parent/assignments").then(data);

// ----- 재고 관리 · 구매 확인 (직원도 사용, 승인·삭제는 원장) -----
export const fetchInventory = (params) => API.get("/api/inventory", { params }).then(data);
export const createInventoryItem = (payload) => API.post("/api/inventory", payload).then(data);
export const updateInventoryItem = (id, payload) => API.put(`/api/inventory/${id}`, payload).then(data);
export const deleteInventoryItem = (id) => API.delete(`/api/inventory/${id}`);
/** {change: +입고 / −사용, reason: IN|OUT|ADJUST, note} */
export const adjustInventory = (id, payload) => API.post(`/api/inventory/${id}/adjust`, payload).then(data);
export const fetchInventoryLogs = (id) => API.get(`/api/inventory/${id}/logs`).then(data);
export const fetchPurchaseCheck = () => API.get("/api/inventory/purchase-check").then(data);
export const fetchPurchaseRequests = (params) => API.get("/api/inventory/requests", { params }).then(data);
export const createPurchaseRequest = (payload) => API.post("/api/inventory/requests", payload).then(data);
/** decision: APPROVED(구매) / REJECTED(반려) */
export const decidePurchaseRequest = (id, decision, note = "") => API.post(`/api/inventory/requests/${id}/decide`, { decision, note }).then(data);
export const receivePurchaseRequest = (id, payload = {}) => API.post(`/api/inventory/requests/${id}/receive`, payload).then(data);
export const cancelPurchaseRequest = (id) => API.post(`/api/inventory/requests/${id}/cancel`).then(data);

// ----- 대시보드 -----
export const fetchDashboardStats = () => API.get("/api/dashboard/stats").then(data);
export const fetchUnpaidMembers = () => API.get("/api/dashboard/unpaid").then(data);
/** 운영 인사이트 (출석률·수납률·매출 추이·반별·이탈 위험·지표 정의) — 서버에서 집계 */
export const fetchDashboardInsights = () => API.get("/api/dashboard/insights").then(data);

// ----- 과제 -----
export const fetchAssignments = (classId) => API.get(`/api/classes/${classId}/assignments`).then(data);
export const createAssignment = (classId, formData) => API.post(`/api/classes/${classId}/assignments`, formData).then(data);
export const updateAssignment = (id, formData) => API.put(`/api/assignments/${id}`, formData).then(data);
export const deleteAssignment = (id) => API.delete(`/api/assignments/${id}`);
export const fetchSubmissions = (assignmentId) => API.get(`/api/assignments/${assignmentId}/submissions`).then(data);
export const updateSubmission = (assignmentId, memberId, payload) =>
  API.put(`/api/assignments/${assignmentId}/submissions/${memberId}`, payload).then(data);
/** 첨부 파일 주소 (관리자 / 학부모) — <a href> 로 내려받기 */
export const assignmentFileUrl = (assignmentId, parent = false) =>
  `${import.meta.env.VITE_API_BASE_URL || ""}/api/${parent ? "parent/" : ""}assignments/${assignmentId}/file`;

// ----- AI (서버 프록시 — 키는 서버 환경변수에만 존재) -----
const aiError = (error, fallback) => {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  if (status === 503) return new Error(detail || "AI 기능이 서버에서 비활성화되어 있습니다. 관리자에게 문의하세요.");
  if (status === 429) return new Error("429 ⚠️ API 사용량(Quota)을 초과했습니다. 잠시 후 다시 시도해 주세요.");
  return new Error(detail || fallback);
};

/**
 * AI 분석 요청. 이름·연락처·사진 등 개인정보는 서버가 제거/가명화한 뒤 Gemini 로 보냅니다.
 * @param {string} message 질문
 * @param {any} context 추가 자료(객체 또는 문자열, 선택)
 * @param {{includeDb?: boolean}} options includeDb=true 면 서버가 DB 요약을 직접 첨부
 */
export const analyzeDataWithAI = async (message, context = null, { includeDb = false } = {}) => {
  const payload = {
    message,
    include_db: includeDb,
    context: context == null ? null : typeof context === "object" ? JSON.stringify(context) : String(context),
  };
  try {
    return (await API.post("/api/ai/analyze", payload, AI_TIMEOUT)).data.text;
  } catch (error) {
    throw aiError(error, "AI 요청 처리 중 오류가 발생했습니다.");
  }
};

/** 등록 서류 사진 → 학생 정보(JSON). 실제 Vision 호출은 서버가 수행 */
export const extractStudentInfoFromImage = async (base64Image, mimeType) => {
  try {
    return (await API.post("/api/ai/extract-student", { image_base64: base64Image, mime_type: mimeType || "image/jpeg" }, AI_TIMEOUT)).data;
  } catch (error) {
    throw aiError(error, "사진에서 학생 정보를 추출하지 못했습니다. 다시 시도해 주세요.");
  }
};

export default API;

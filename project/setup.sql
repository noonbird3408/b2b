-- =====================================================================
-- 시설 통합 관리 시스템 — Supabase 테이블 생성 스크립트 (setup.sql)
--
-- 사용법: Supabase 대시보드 → 왼쪽 메뉴 SQL Editor → New query
--         → 이 파일 내용을 전부 복사해 붙여넣기 → Run (Ctrl+Enter)
--         → 맨 아래에 "setup 완료" 결과가 보이면 성공
--
-- 안전: 이미 있는 테이블·인덱스는 건너뜁니다(IF NOT EXISTS). DROP/DELETE 가 없어
--       여러 번 실행해도 기존 데이터는 지워지지 않습니다.
-- 이 파일은 backend/scripts/export_schema.py 로 자동 생성됩니다. 직접 고치지 마세요.
-- =====================================================================

CREATE TABLE IF NOT EXISTS academy_settings (
	setting_key VARCHAR(64) NOT NULL, 
	setting_value TEXT NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (setting_key)
);

CREATE TABLE IF NOT EXISTS activity_logs (
	log_id SERIAL NOT NULL, 
	actor_type VARCHAR(10) NOT NULL, 
	actor_id INTEGER, 
	action VARCHAR(40) NOT NULL, 
	target_type VARCHAR(20), 
	target_id INTEGER, 
	summary VARCHAR(200) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (log_id)
);
CREATE INDEX IF NOT EXISTS ix_activity_logs_action ON activity_logs (action);
CREATE INDEX IF NOT EXISTS ix_activity_logs_created_at ON activity_logs (created_at);

CREATE TABLE IF NOT EXISTS admin_accounts (
	account_id SERIAL NOT NULL, 
	email VARCHAR(254) NOT NULL, 
	username VARCHAR(100) NOT NULL, 
	password_hash VARCHAR(255), 
	google_subject VARCHAR(255), 
	provider VARCHAR(20) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	pricing_tier VARCHAR(20) NOT NULL, 
	failed_logins INTEGER NOT NULL, 
	locked_until TIMESTAMP WITHOUT TIME ZONE, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (account_id), 
	UNIQUE (google_subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_admin_accounts_email ON admin_accounts (email);

CREATE TABLE IF NOT EXISTS app_users (
	user_id SERIAL NOT NULL, 
	email VARCHAR(254) NOT NULL, 
	google_subject VARCHAR(255) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	picture VARCHAR(500), 
	link_failures INTEGER NOT NULL, 
	link_locked_until TIMESTAMP WITHOUT TIME ZONE, 
	last_login_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (user_id), 
	UNIQUE (google_subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_app_users_email ON app_users (email);

CREATE TABLE IF NOT EXISTS b2b_products (
	product_id SERIAL NOT NULL, 
	sku VARCHAR(40) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	category VARCHAR(60) NOT NULL, 
	description VARCHAR(500) NOT NULL, 
	price INTEGER NOT NULL, 
	unit VARCHAR(20) NOT NULL, 
	sample_available BOOLEAN NOT NULL, 
	minimum_quantity INTEGER NOT NULL, 
	active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (product_id)
);
CREATE INDEX IF NOT EXISTS ix_b2b_products_category ON b2b_products (category);
CREATE INDEX IF NOT EXISTS ix_b2b_products_name ON b2b_products (name);
CREATE UNIQUE INDEX IF NOT EXISTS ix_b2b_products_sku ON b2b_products (sku);

CREATE TABLE IF NOT EXISTS classes (
	class_id SERIAL NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	teacher VARCHAR(50) NOT NULL, 
	start_date DATE NOT NULL, 
	end_date DATE NOT NULL, 
	days_of_week VARCHAR(40), 
	start_time TIME WITHOUT TIME ZONE, 
	end_time TIME WITHOUT TIME ZONE, 
	description TEXT, 
	color_index INTEGER, 
	schedule_detail TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (class_id)
);

CREATE TABLE IF NOT EXISTS community_posts (
	post_id SERIAL NOT NULL, 
	author VARCHAR(50), 
	content TEXT NOT NULL, 
	photos TEXT, 
	like_count INTEGER, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (post_id)
);

CREATE TABLE IF NOT EXISTS members (
	member_id SERIAL NOT NULL, 
	name VARCHAR(50) NOT NULL, 
	gender CHAR(1) NOT NULL, 
	age INTEGER NOT NULL, 
	enrollment_date DATE NOT NULL, 
	withdrawal_date DATE, 
	payment_date DATE, 
	father_name VARCHAR(50), 
	mother_name VARCHAR(50), 
	father_phone VARCHAR(20), 
	mother_phone VARCHAR(20), 
	address VARCHAR(200), 
	status VARCHAR(10), 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	photo_url TEXT, 
	PRIMARY KEY (member_id)
);

CREATE TABLE IF NOT EXISTS notices (
	notice_id SERIAL NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	content TEXT NOT NULL, 
	author VARCHAR(50), 
	category VARCHAR(20), 
	is_pinned BOOLEAN, 
	class_id INTEGER, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (notice_id)
);
CREATE INDEX IF NOT EXISTS ix_notices_class_id ON notices (class_id);

CREATE TABLE IF NOT EXISTS shop_products (
	product_id SERIAL NOT NULL, 
	external_id VARCHAR(80) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	category VARCHAR(60) NOT NULL, 
	description VARCHAR(500) NOT NULL, 
	price INTEGER, 
	url VARCHAR(500) NOT NULL, 
	image_url VARCHAR(500), 
	tags VARCHAR(300) NOT NULL, 
	facility_types VARCHAR(100) NOT NULL, 
	min_quantity INTEGER NOT NULL, 
	source VARCHAR(10) NOT NULL, 
	active BOOLEAN NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (product_id)
);
CREATE INDEX IF NOT EXISTS ix_shop_products_category ON shop_products (category);
CREATE UNIQUE INDEX IF NOT EXISTS ix_shop_products_external_id ON shop_products (external_id);

CREATE TABLE IF NOT EXISTS admin_todos (
	todo_id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	due_time VARCHAR(5) NOT NULL, 
	text VARCHAR(200) NOT NULL, 
	tag VARCHAR(10) NOT NULL, 
	done BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (todo_id), 
	FOREIGN KEY(account_id) REFERENCES admin_accounts (account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_admin_todos_account_id ON admin_todos (account_id);

CREATE TABLE IF NOT EXISTS assignments (
	assignment_id SERIAL NOT NULL, 
	class_id INTEGER NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	content TEXT, 
	due_date VARCHAR(20) NOT NULL, 
	file_name VARCHAR(255), 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (assignment_id), 
	FOREIGN KEY(class_id) REFERENCES classes (class_id)
);

CREATE TABLE IF NOT EXISTS attendances (
	attendance_id SERIAL NOT NULL, 
	member_id INTEGER NOT NULL, 
	attendance_date DATE NOT NULL, 
	status VARCHAR(10), 
	check_in_time TIME WITHOUT TIME ZONE, 
	check_out_time TIME WITHOUT TIME ZONE, 
	note VARCHAR(200), 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (attendance_id), 
	CONSTRAINT uq_attendance_member_date UNIQUE (member_id, attendance_date), 
	FOREIGN KEY(member_id) REFERENCES members (member_id)
);
CREATE INDEX IF NOT EXISTS ix_attendances_attendance_date ON attendances (attendance_date);

CREATE TABLE IF NOT EXISTS b2b_orders (
	order_id SERIAL NOT NULL, 
	order_number VARCHAR(40) NOT NULL, 
	account_id INTEGER NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	class_name VARCHAR(120) NOT NULL, 
	payment_method VARCHAR(32) NOT NULL, 
	subtotal INTEGER NOT NULL, 
	discount INTEGER NOT NULL, 
	total INTEGER NOT NULL, 
	custom_note VARCHAR(500) NOT NULL, 
	paid_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (order_id), 
	FOREIGN KEY(account_id) REFERENCES admin_accounts (account_id)
);
CREATE INDEX IF NOT EXISTS ix_b2b_orders_account_id ON b2b_orders (account_id);
CREATE INDEX IF NOT EXISTS ix_b2b_orders_created_at ON b2b_orders (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ix_b2b_orders_order_number ON b2b_orders (order_number);
CREATE INDEX IF NOT EXISTS ix_b2b_orders_status ON b2b_orders (status);

CREATE TABLE IF NOT EXISTS b2b_sample_requests (
	request_id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (request_id), 
	FOREIGN KEY(account_id) REFERENCES admin_accounts (account_id), 
	FOREIGN KEY(product_id) REFERENCES b2b_products (product_id)
);
CREATE INDEX IF NOT EXISTS ix_b2b_sample_requests_account_id ON b2b_sample_requests (account_id);

CREATE TABLE IF NOT EXISTS community_comments (
	comment_id SERIAL NOT NULL, 
	post_id INTEGER NOT NULL, 
	author VARCHAR(50), 
	content TEXT NOT NULL, 
	user_id INTEGER, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (comment_id), 
	FOREIGN KEY(post_id) REFERENCES community_posts (post_id)
);
CREATE INDEX IF NOT EXISTS ix_community_comments_post_id ON community_comments (post_id);
CREATE INDEX IF NOT EXISTS ix_community_comments_user_id ON community_comments (user_id);

CREATE TABLE IF NOT EXISTS community_likes (
	like_id SERIAL NOT NULL, 
	post_id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (like_id), 
	CONSTRAINT uq_community_like UNIQUE (post_id, user_id), 
	FOREIGN KEY(post_id) REFERENCES community_posts (post_id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES app_users (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_community_likes_post_id ON community_likes (post_id);
CREATE INDEX IF NOT EXISTS ix_community_likes_user_id ON community_likes (user_id);

CREATE TABLE IF NOT EXISTS community_photos (
	photo_id SERIAL NOT NULL, 
	post_id INTEGER NOT NULL, 
	position INTEGER NOT NULL, 
	mime_type VARCHAR(30) NOT NULL, 
	data TEXT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (photo_id), 
	FOREIGN KEY(post_id) REFERENCES community_posts (post_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_community_photos_post_id ON community_photos (post_id);

CREATE TABLE IF NOT EXISTS enrollments (
	enrollment_id SERIAL NOT NULL, 
	member_id INTEGER NOT NULL, 
	class_id INTEGER NOT NULL, 
	enrolled_at DATE DEFAULT CURRENT_DATE NOT NULL, 
	status VARCHAR(10), 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (enrollment_id), 
	CONSTRAINT uq_enrollment_member_class UNIQUE (member_id, class_id), 
	FOREIGN KEY(member_id) REFERENCES members (member_id), 
	FOREIGN KEY(class_id) REFERENCES classes (class_id)
);

CREATE TABLE IF NOT EXISTS invoices (
	invoice_id SERIAL NOT NULL, 
	member_id INTEGER NOT NULL, 
	item_name VARCHAR(200) NOT NULL, 
	amount INTEGER NOT NULL, 
	status VARCHAR(10) NOT NULL, 
	due_date DATE, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (invoice_id), 
	FOREIGN KEY(member_id) REFERENCES members (member_id)
);
CREATE INDEX IF NOT EXISTS ix_invoices_member_id ON invoices (member_id);

CREATE TABLE IF NOT EXISTS member_notes (
	note_id SERIAL NOT NULL, 
	member_id INTEGER NOT NULL, 
	author VARCHAR(100) NOT NULL, 
	content TEXT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (note_id), 
	FOREIGN KEY(member_id) REFERENCES members (member_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_member_notes_created_at ON member_notes (created_at);
CREATE INDEX IF NOT EXISTS ix_member_notes_member_id ON member_notes (member_id);

CREATE TABLE IF NOT EXISTS notice_reads (
	read_id SERIAL NOT NULL, 
	notice_id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	read_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (read_id), 
	CONSTRAINT uq_notice_read UNIQUE (notice_id, user_id), 
	FOREIGN KEY(notice_id) REFERENCES notices (notice_id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES app_users (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_notice_reads_notice_id ON notice_reads (notice_id);
CREATE INDEX IF NOT EXISTS ix_notice_reads_user_id ON notice_reads (user_id);

CREATE TABLE IF NOT EXISTS notifications (
	notification_id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	audience VARCHAR(10) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	body VARCHAR(1000) NOT NULL, 
	link VARCHAR(200), 
	member_id INTEGER, 
	is_read BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (notification_id), 
	FOREIGN KEY(user_id) REFERENCES app_users (user_id) ON DELETE CASCADE, 
	FOREIGN KEY(member_id) REFERENCES members (member_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications (created_at);
CREATE INDEX IF NOT EXISTS ix_notifications_member_id ON notifications (member_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id);

CREATE TABLE IF NOT EXISTS parent_links (
	link_id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	member_id INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (link_id), 
	CONSTRAINT uq_parent_link UNIQUE (user_id, member_id), 
	FOREIGN KEY(user_id) REFERENCES app_users (user_id) ON DELETE CASCADE, 
	FOREIGN KEY(member_id) REFERENCES members (member_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_parent_links_member_id ON parent_links (member_id);
CREATE INDEX IF NOT EXISTS ix_parent_links_user_id ON parent_links (user_id);

CREATE TABLE IF NOT EXISTS payment_pending (
	partner_order_id VARCHAR(64) NOT NULL, 
	tid VARCHAR(64) NOT NULL, 
	member_id INTEGER NOT NULL, 
	partner_user_id VARCHAR(64) NOT NULL, 
	invoice_id INTEGER, 
	amount INTEGER NOT NULL, 
	item_name VARCHAR(200) NOT NULL, 
	payment_type VARCHAR(20) NOT NULL, 
	status VARCHAR(12) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (partner_order_id), 
	FOREIGN KEY(member_id) REFERENCES members (member_id)
);

CREATE TABLE IF NOT EXISTS payments (
	payment_id SERIAL NOT NULL, 
	member_id INTEGER NOT NULL, 
	amount INTEGER NOT NULL, 
	paid_at DATE NOT NULL, 
	payment_type VARCHAR(20), 
	method VARCHAR(20), 
	note VARCHAR(200), 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (payment_id), 
	FOREIGN KEY(member_id) REFERENCES members (member_id)
);
CREATE INDEX IF NOT EXISTS ix_payments_paid_at ON payments (paid_at);

CREATE TABLE IF NOT EXISTS shop_click_events (
	event_id SERIAL NOT NULL, 
	account_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	context VARCHAR(30) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (event_id), 
	FOREIGN KEY(account_id) REFERENCES admin_accounts (account_id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES shop_products (product_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_shop_click_events_account_id ON shop_click_events (account_id);
CREATE INDEX IF NOT EXISTS ix_shop_click_events_created_at ON shop_click_events (created_at);
CREATE INDEX IF NOT EXISTS ix_shop_click_events_product_id ON shop_click_events (product_id);

CREATE TABLE IF NOT EXISTS user_sessions (
	token_hash VARCHAR(64) NOT NULL, 
	user_id INTEGER NOT NULL, 
	active_role VARCHAR(10), 
	expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	revoked BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (token_hash), 
	FOREIGN KEY(user_id) REFERENCES app_users (user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_user_sessions_expires_at ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS assignment_files (
	assignment_id INTEGER NOT NULL, 
	file_name VARCHAR(255) NOT NULL, 
	mime_type VARCHAR(100) NOT NULL, 
	size_bytes INTEGER NOT NULL, 
	data TEXT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (assignment_id), 
	FOREIGN KEY(assignment_id) REFERENCES assignments (assignment_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
	submission_id SERIAL NOT NULL, 
	assignment_id INTEGER NOT NULL, 
	member_id INTEGER NOT NULL, 
	status VARCHAR(12) NOT NULL, 
	note VARCHAR(200), 
	checked_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (submission_id), 
	CONSTRAINT uq_submission_assignment_member UNIQUE (assignment_id, member_id), 
	FOREIGN KEY(assignment_id) REFERENCES assignments (assignment_id) ON DELETE CASCADE, 
	FOREIGN KEY(member_id) REFERENCES members (member_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_assignment_submissions_assignment_id ON assignment_submissions (assignment_id);
CREATE INDEX IF NOT EXISTS ix_assignment_submissions_member_id ON assignment_submissions (member_id);

CREATE TABLE IF NOT EXISTS b2b_order_items (
	item_id SERIAL NOT NULL, 
	order_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	sku VARCHAR(40) NOT NULL, 
	product_name VARCHAR(200) NOT NULL, 
	unit VARCHAR(20) NOT NULL, 
	quantity INTEGER NOT NULL, 
	unit_price INTEGER NOT NULL, 
	PRIMARY KEY (item_id), 
	FOREIGN KEY(order_id) REFERENCES b2b_orders (order_id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES b2b_products (product_id)
);
CREATE INDEX IF NOT EXISTS ix_b2b_order_items_order_id ON b2b_order_items (order_id);

CREATE TABLE IF NOT EXISTS b2b_payment_pending (
	partner_order_id VARCHAR(64) NOT NULL, 
	tid VARCHAR(64) NOT NULL, 
	order_id INTEGER NOT NULL, 
	account_id INTEGER NOT NULL, 
	amount INTEGER NOT NULL, 
	status VARCHAR(12) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (partner_order_id), 
	FOREIGN KEY(order_id) REFERENCES b2b_orders (order_id), 
	FOREIGN KEY(account_id) REFERENCES admin_accounts (account_id)
);
CREATE INDEX IF NOT EXISTS ix_b2b_payment_pending_order_id ON b2b_payment_pending (order_id);

CREATE TABLE IF NOT EXISTS comment_reviews (
	comment_id INTEGER NOT NULL, 
	model VARCHAR(30) NOT NULL, 
	flagged BOOLEAN NOT NULL, 
	score INTEGER NOT NULL, 
	reasons VARCHAR(300) NOT NULL, 
	decision VARCHAR(10), 
	decided_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(), 
	PRIMARY KEY (comment_id), 
	FOREIGN KEY(comment_id) REFERENCES community_comments (comment_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_comment_reviews_created_at ON comment_reviews (created_at);

-- 이전 버전으로 이미 테이블을 만든 경우를 위한 컬럼 보완 (있으면 건너뜀)
ALTER TABLE notices ADD COLUMN IF NOT EXISTS class_id INTEGER;
CREATE INDEX IF NOT EXISTS ix_notices_class_id ON notices (class_id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS schedule_detail TEXT;
ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS user_id INTEGER;
CREATE INDEX IF NOT EXISTS ix_community_comments_user_id ON community_comments (user_id);

-- Supabase 는 public 스키마의 테이블을 Data API(anon 키)로 노출합니다.
-- RLS(행 수준 보안)를 켜 두면 브라우저에서 테이블에 직접 접근할 수 없습니다.
-- 이 앱은 백엔드(Vercel)가 DB 비밀번호로 접속하므로 RLS 정책 없이도 정상 동작합니다.
ALTER TABLE academy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_sample_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_click_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_payment_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_reviews ENABLE ROW LEVEL SECURITY;

SELECT 'setup 완료 — 테이블 33개 준비됨' AS result;

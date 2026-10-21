# 시설 통합 관리 시스템 (학원 · 체육관 · 도장)

Google 계정으로 로그인한 뒤 **학부모** 또는 **관리자**를 골라 쓰는 시설 관리 웹앱입니다.

| 역할 | 들어가는 화면 | 할 수 있는 일 |
|---|---|---|
| 학부모 | 학부모 포털 | 자녀 연결, 최근 출결·출석률, 미납 청구서 카카오페이 결제, 공지, 커뮤니티(좋아요·댓글) |
| 관리자(원장) | 시설 관리 / 쇼핑몰 | 학생·수업·출결·청구서·원격결제, 커뮤니티, AI 비서·서류 인식, 쇼핑몰(ddmmall77.com) 추천, B2B 발주 |
| 관리자(직원) | 쇼핑몰 | 쇼핑몰 추천, B2B 발주 요청 (시설 관리 API 는 서버가 차단) |

**배포 구조** — 서버를 따로 빌리지 않습니다.

```
 브라우저 ──▶ Vercel ─┬─ 화면(React, frontend/)            정적 파일
                      └─ /api/* (FastAPI, api/index.py)     Python 함수 ──▶ Supabase (PostgreSQL DB)
                                  │
                                  └─ Google 로그인 토큰 확인 (Google OAuth)
```

---

## 목차

0. [준비물](#0-준비물)
1. [Supabase — 데이터베이스 만들기](#1-supabase--데이터베이스-만들기)
2. [Google 로그인(OAuth) 설정](#2-google-로그인oauth-설정)
3. [배포 준비 도우미 실행 (setup.bat)](#3-배포-준비-도우미-실행-setupbat)
4. [GitHub 에 올리기](#4-github-에-올리기)
5. [Vercel 배포](#5-vercel-배포)
6. [마무리: 주소 연결과 첫 로그인](#6-마무리-주소-연결과-첫-로그인)
7. [환경변수 정리표](#7-환경변수-정리표)
8. [문제 해결](#8-문제-해결)
9. [수정 후 다시 배포하기](#9-수정-후-다시-배포하기)
10. [부록: 폴더 구조 · 테스트 · v8 변경 내역](#10-부록)

---

## 0. 준비물

| 준비물 | 용도 | 비용 |
|---|---|---|
| [Supabase](https://supabase.com) 계정 | 데이터베이스 | 무료 플랜 |
| [Google Cloud](https://console.cloud.google.com) 계정 (일반 Gmail 가능) | Google 로그인 | 무료 |
| [GitHub](https://github.com) 계정 | 코드 저장소 (Vercel 이 여기서 코드를 가져감) | 무료 |
| [Vercel](https://vercel.com) 계정 (GitHub 으로 가입 추천) | 웹사이트·API 배포 | Hobby(무료) |
| 내 PC 의 **Python 3.10 이상** | 3단계의 배포 준비 도우미 실행용 | 무료 |

> Python 설치 시 첫 화면에서 **"Add python.exe to PATH"** 를 꼭 체크하세요.
> 전체 과정은 처음이면 40분 정도 걸립니다. 각 단계에서 **메모해 둘 값**을 표시해 두었습니다.

---

## 1. Supabase — 데이터베이스 만들기

### 1-1. 프로젝트 만들기

1. [supabase.com](https://supabase.com) → **Start your project** → GitHub 계정으로 로그인
2. **New project** 클릭
3. 입력 내용
   - **Name**: `facility-manager` (아무 이름이나 가능)
   - **Database Password**: 비밀번호 입력 → 📝 **메모** (다시 볼 수 없습니다)
     - ⚠️ **영문 대소문자 + 숫자만** 쓰세요. `@ : / ? # %` 같은 특수문자가 있으면 연결 주소가 깨집니다.
   - **Region**: **Northeast Asia (Seoul)** — Vercel 함수도 서울(`icn1`)에서 실행되도록 맞춰 두었습니다.
4. **Create new project** → 1~2분 기다리면 대시보드가 열립니다.

### 1-2. 테이블 만들기 (setup.sql 붙여넣기)

1. 왼쪽 메뉴 **SQL Editor** 클릭
2. **New query**(또는 `+`) 클릭
3. 이 저장소의 **`setup.sql`** 파일을 메모장으로 열어 **전체 선택(Ctrl+A) → 복사(Ctrl+C)**
4. SQL Editor 에 **붙여넣기(Ctrl+V)** → 오른쪽 아래 **Run** (또는 Ctrl+Enter)
5. 결과 창에 **`setup 완료 — 테이블 24개 준비됨`** 이 보이면 성공
6. 확인: 왼쪽 메뉴 **Table Editor** 에 `members`, `app_users` 등 24개 테이블이 보입니다.

> `setup.sql` 은 이미 있는 테이블은 건너뛰고 아무것도 지우지 않으므로 **여러 번 실행해도 안전**합니다.
> 실행을 깜빡해도 백엔드가 첫 요청 때 없는 테이블을 만들지만, 보안 설정(RLS)까지 확실히 하려면 이 단계를 해 두세요.

### 1-3. 연결 주소 복사 (가장 많이 틀리는 단계)

1. 프로젝트 대시보드 **맨 위의 `Connect` 버튼** 클릭
2. **Connection String** 탭에서 **Method(또는 Type)** 를 **`Transaction pooler`** 로 선택
3. 표시된 주소를 복사합니다. 모양은 이렇습니다.
   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres
   ```
4. **`[YOUR-PASSWORD]` 를 대괄호까지 지우고** 1-1 에서 만든 비밀번호로 바꿉니다.
   ```
   틀림: postgresql://postgres.abcdefghijkl:[MyPass1234]@aws-0-...:6543/postgres
   맞음: postgresql://postgres.abcdefghijkl:MyPass1234@aws-0-...:6543/postgres
   ```
5. 📝 완성된 주소를 **메모** → 이것이 `DATABASE_URL` 입니다.

꼭 확인할 세 가지:

| 확인 | 맞는 예 | 틀린 예 (시간 초과·접속 실패) |
|---|---|---|
| 주소 종류 | `...pooler.supabase.com:6543` | `db.abcdefghijkl.supabase.co:5432` (직접 연결 — IPv6 전용이라 Vercel 에서 접속 불가) |
| 사용자명 | `postgres.abcdefghijkl` | `postgres` (풀러는 점 뒤에 프로젝트 ID 가 붙어야 함) |
| 비밀번호 | `MyPass1234` | `[MyPass1234]` |

> 비밀번호를 잊었다면: **Project Settings → Database → Reset database password** 에서 새로 만들 수 있습니다.

---

## 2. Google 로그인(OAuth) 설정

이 앱은 Google 의 "Google 계정으로 로그인" 버튼을 씁니다. 필요한 값은 **클라이언트 ID 하나**뿐입니다(클라이언트 보안 비밀번호는 쓰지 않음).

### 2-1. 프로젝트 만들기

1. [console.cloud.google.com](https://console.cloud.google.com) 접속 → 위쪽 **프로젝트 선택** → **새 프로젝트**
2. 이름 `facility-manager` → **만들기** → 만든 프로젝트가 선택되어 있는지 확인

### 2-2. 앱 정보 등록 (OAuth 동의 화면)

1. 왼쪽 메뉴(☰) → **API 및 서비스** → **OAuth 동의 화면** (화면 이름이 **Google Auth Platform** 으로 보일 수 있습니다)
2. **시작하기(Get started)** 를 눌러 차례로 입력
   - **앱 정보**: 앱 이름 `시설 통합 관리 시스템`, 사용자 지원 이메일 = 내 Gmail
   - **대상(Audience)**: **외부(External)**
   - **연락처 정보**: 내 Gmail
   - 정책 동의 체크 → **만들기**

### 2-3. 클라이언트 ID 만들기

1. **Google Auth Platform → 클라이언트(Clients)** → **클라이언트 만들기(Create client)**
   (예전 화면: API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID)
2. **애플리케이션 유형**: **웹 애플리케이션**
3. **승인된 JavaScript 원본** → **URI 추가**
   - 지금은 비워 두거나 `http://localhost:5173` 만 넣어도 됩니다.
   - **Vercel 주소는 배포 후 6단계에서 추가**합니다(아직 주소가 없으므로).
4. **승인된 리디렉션 URI** 는 **비워 둡니다** (이 앱은 리디렉션 방식을 쓰지 않음).
5. **만들기** → 팝업의 **클라이언트 ID** 복사
   📝 **메모** → `123456789012-xxxxxxxx.apps.googleusercontent.com` 형태가 `GOOGLE_CLIENT_ID` 입니다.

### 2-4. 누가 로그인할 수 있게 할지 정하기 (중요)

처음 만든 앱은 **"테스트 중(Testing)"** 상태라서 **등록한 테스트 사용자만** 로그인할 수 있습니다.
학부모가 로그인하다 "액세스 차단됨" 이 뜨는 원인이 대부분 이것입니다.

- **발표·시연만 할 때**: **Google Auth Platform → 대상(Audience) → 테스트 사용자 → Add users** 에 로그인할 Gmail 들을 추가 (최대 100명)
- **누구나 로그인하게 할 때**: 같은 화면의 **게시 상태 → 앱 게시(Publish app)**
  이 앱은 이메일·이름·프로필 사진(기본 범위)만 요청하므로 Google 검수 없이 바로 게시됩니다.

---

## 3. 배포 준비 도우미 실행 (setup.bat)

메모한 값을 넣으면 **형식을 검사**하고, **관리자 초대 코드·Cron 비밀값을 자동 생성**해서
Vercel 에 그대로 붙여 넣을 파일(`.env.vercel`)을 만들어 줍니다.

1. 프로젝트 폴더의 **`setup.bat` 더블클릭** (macOS/Linux: 터미널에서 `./setup.sh`)
2. 질문에 답합니다.

   | 질문 | 입력 |
   |---|---|
   | Supabase 연결 주소 | 1-3 의 `DATABASE_URL` (대괄호를 실수로 남겨도 자동으로 지워 줌) |
   | Google 클라이언트 ID | 2-3 의 `GOOGLE_CLIENT_ID` |
   | 직원용 초대 코드도 만들까요? | 직원 계정이 필요하면 `y`, 아니면 Enter |
   | Gemini API 키 / 카카오페이 키 | 있으면 입력, 없으면 Enter (나중에 Vercel 에서 추가 가능) |
   | Supabase 에 접속해 테이블 상태를 확인할까요? | Enter(예) — 처음 한 번 패키지 설치로 1~3분 걸립니다 |

3. 끝나면 화면에 **최초 관리자 초대 코드**가 크게 표시됩니다. 📝 **메모** (`.env.vercel` 파일에도 들어 있음)
4. 만들어지는 파일 (둘 다 GitHub 에 올라가지 않도록 `.gitignore` 에 등록되어 있음)
   - `.env.vercel` — 5단계에서 Vercel 에 붙여 넣을 값
   - `backend/.env` — 내 PC 에서 연결 점검(`setup.bat check`)할 때 쓰는 값
5. 마지막에 더 이상 쓰지 않는 파일(`supabase/schema.sql`, `start.bat` 등)을 `_to_delete/` 폴더로 옮길지 묻습니다.
   삭제가 아니라 이동이라 되돌릴 수 있고, `_to_delete/` 는 GitHub 에 올라가지 않습니다.

> `✓ Supabase 연결 성공 — 테이블 24/24개 준비됨` 이 나오면 DB 준비는 끝입니다.
> 실패하면 메시지에 원인이 나옵니다 → [8. 문제 해결](#8-문제-해결)

다른 명령 (선택)

| 명령 | 하는 일 |
|---|---|
| `setup.bat check` | Supabase 연결·테이블 다시 확인 (없는 테이블은 만들 수 있음) |
| `setup.bat demo` | 발표용 가상 데이터(학생 12명·수업·출결·청구서·공지) 넣기 |
| `setup.bat test` | 백엔드 자동 테스트 실행 |
| `setup.bat local` → `setup.bat run` | 내 PC 에서 미리보기 (배포에는 필요 없음) |

---

## 4. GitHub 에 올리기

1. GitHub → 오른쪽 위 **+** → **New repository** → 이름 입력 → **Private** 추천 → **Create repository**
2. 이 프로젝트 폴더(`setup.sql`, `vercel.json` 이 있는 폴더)에서 터미널을 열고:
   ```bash
   git init
   git add .
   git commit -m "시설 통합 관리 시스템"
   git branch -M main
   git remote add origin https://github.com/<내아이디>/<저장소이름>.git
   git push -u origin main
   ```
   (명령어가 어렵다면 [GitHub Desktop](https://desktop.github.com) 으로 폴더를 추가해 Publish 해도 됩니다.)
3. GitHub 저장소 화면에서 **`.env`, `.env.vercel` 이 보이지 않는지** 확인하세요. 보이면 즉시 삭제하고 Supabase 비밀번호를 재설정하세요.

---

## 5. Vercel 배포

1. [vercel.com](https://vercel.com) → **Continue with GitHub** 로 가입/로그인
2. **Add New… → Project** → 4단계 저장소 옆 **Import**
3. 설정 화면에서 확인할 것
   - **Root Directory**: `vercel.json` 이 있는 폴더.
     저장소 맨 위에 바로 `vercel.json` 이 있으면 그대로 두고, `project/` 같은 하위 폴더 안에 있으면 **Edit** 를 눌러 그 폴더를 고릅니다.
   - **Framework Preset**: **Other** (빌드 명령은 `vercel.json` 에 이미 들어 있어 건드리지 않아도 됩니다)
4. **Environment Variables** 펼치기 → `.env.vercel` 파일을 메모장으로 열어 **전체 복사** →
   **Key 입력칸에 붙여넣기** 하면 여러 줄이 한 번에 들어갑니다(또는 **Import .env** 버튼으로 파일 선택).
   최소한 아래 4개가 있어야 합니다: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ADMIN_SIGNUP_CODE`, `CRON_SECRET`
5. **Deploy** → 2~3분 뒤 🎉 화면이 나오면 완료
6. 📝 배포 주소 **메모** — 프로젝트 화면의 **Domains** 에 있는 `https://<프로젝트이름>.vercel.app`

> `backend/.env` 를 통째로 복사하지 마세요. 그 안의 로컬 전용 값(예: localhost 주소)은 배포에서 문제를 일으킵니다. 꼭 `.env.vercel` 을 쓰세요.
> 사이트 주소(`BACKEND_BASE_URL` 등), 쿠키 보안(HTTPS), CORS 는 Vercel 에서 자동으로 맞춰지므로 따로 넣지 않습니다.

---

## 6. 마무리: 주소 연결과 첫 로그인

### 6-1. Google 에 배포 주소 등록

1. Google Cloud → **Google Auth Platform → 클라이언트** → 2-3 에서 만든 클라이언트 클릭
2. **승인된 JavaScript 원본 → URI 추가** → `https://<프로젝트이름>.vercel.app` (끝에 `/` 없이)
3. **저장** → 반영까지 **5분 정도** 걸릴 수 있습니다.

> Vercel 의 미리보기(Preview) 배포 주소는 매번 바뀌어서 Google 로그인이 되지 않습니다. 항상 위의 고정 주소로 접속하세요.

### 6-2. 상태 확인

브라우저에서 `https://<프로젝트이름>.vercel.app/api/health` 를 엽니다.

```json
{ "ok": true, "db_connected": true, "tables_ready": true, "today": "2026-10-21",
  "config": { "google_login": true, "admin_invite_code": true, "cron_secret": true, "kakao_pay": false, "gemini_ai": false } }
```

- `ok: true` 이면 정상입니다.
- 문제가 있으면 `"problem"` 항목에 원인과 해결 방법이 한국어로 나옵니다.

### 6-3. 첫 로그인 (원장 계정 만들기)

1. `https://<프로젝트이름>.vercel.app` 접속 → **Google 계정으로 계속하기**
2. **관리자** 카드 → 초대 코드 칸에 3단계의 **최초 관리자 초대 코드** 입력 → 카드 클릭
3. 원장(owner) 계정이 만들어지고 **시설 관리 / 쇼핑몰** 선택 화면으로 이동합니다.
4. 처음 할 일: 오른쪽 위 **설정 → 기관 정보**에서 기관명·시설 유형(학원/체육관/도장) 저장

이후 계정 추가 방법

- **다른 관리자·직원**: 설정 → 계정 관리에서 그 사람의 Gmail 을 등록 → 그 사람은 초대 코드 없이 "관리자" 선택 가능
- **학부모**: 원장이 학생을 등록할 때 **보호자 연락처**를 입력 → 학부모는 로그인 후 "학부모" 선택 → **자녀 이름 + 그 연락처**로 자녀 연결

> 보안: 초대 코드나 자녀 연결 확인을 **5번 틀리면 30분 동안 잠깁니다**.

---

## 7. 환경변수 정리표

Vercel → 프로젝트 → **Settings → Environment Variables** 에서 관리합니다. 바꾼 뒤에는 꼭 [다시 배포](#9-수정-후-다시-배포하기)하세요.

| 이름 | 필수 | 어디서 구하나 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | 1-3 | Supabase **Transaction pooler(6543)** 주소 |
| `GOOGLE_CLIENT_ID` | ✅ | 2-3 | `...apps.googleusercontent.com` |
| `ADMIN_SIGNUP_CODE` | ✅ | setup.bat 이 생성 | 최초 원장 등록용, **12자 이상** |
| `CRON_SECRET` | ✅ | setup.bat 이 생성 | 매일 03:00(한국) 결제 대기·만료 세션 자동 정리 인증 |
| `STAFF_SIGNUP_CODE` | | setup.bat 이 생성 | 직원 등록용 초대 코드, 12자 이상 |
| `GEMINI_API_KEY` | | [Google AI Studio](https://aistudio.google.com/apikey) | AI 비서·서류 사진 인식. 없으면 해당 기능만 꺼짐 |
| `KAKAO_SECRET_KEY` | | [카카오페이 개발자센터](https://developers.kakaopay.com) | 테스트 결제(Secret key dev). 없으면 결제 버튼만 꺼짐 |
| `KAKAO_CID` | | | 기본 `TC0ONETIME`(테스트용 가맹점) |
| `SHOP_BASE_URL` / `SHOP_NAME` | | | 연결할 쇼핑몰. 기본 `https://ddmmall77.com` / `DDM` |
| `APP_TIMEZONE` | | | '오늘' 계산 기준. 기본 `Asia/Seoul` (Vercel 서버는 UTC) |
| `GEMINI_MODELS` | | | 사용할 모델 순서, 기본 `gemini-2.5-flash-lite,gemini-2.5-flash` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | | Supabase → Project Settings → API | 과제 첨부 파일 보관용(선택). 없으면 첨부 파일은 Vercel 임시 폴더에 저장되어 사라질 수 있음 |

> 모든 키·비밀번호는 **Vercel 환경변수에만** 넣고 코드나 GitHub 에 올리지 마세요. 서비스 역할 키(service_role)는 특히 프론트엔드에 절대 넣으면 안 됩니다.

---

## 8. 문제 해결

먼저 `https://<배포주소>/api/health` 의 `problem` 메시지를 확인하세요. 서버 로그는 Vercel → 프로젝트 → **Logs** 에서 볼 수 있습니다.

| 증상 | 원인 | 해결 |
|---|---|---|
| `connection timeout expired` / health 의 `연결 시간 초과` | 직접 연결 주소(`db.xxx.supabase.co:5432`) 사용 | 1-3 의 **Transaction pooler(6543)** 주소로 바꾸기 |
| `password authentication failed` | 비밀번호에 `[ ]` 가 남음, 또는 비밀번호 틀림 | 대괄호 제거. 모르면 Supabase 에서 비밀번호 재설정 후 주소 갱신 |
| `Tenant or user not found` | 사용자명이 `postgres` 만 있음 | 풀러 주소의 사용자명 `postgres.<프로젝트ID>` 그대로 쓰기 |
| `DB 테이블이 없습니다` | setup.sql 미실행 | 1-2 실행 또는 `setup.bat check` |
| health 가 갑자기 연결 실패 (며칠 안 쓴 뒤) | 무료 Supabase 프로젝트는 일정 기간 사용이 없으면 **일시 중지** | Supabase 대시보드에서 프로젝트 **Restore** |
| Google 버튼 대신 "GOOGLE_CLIENT_ID 설정이 필요" | Vercel 환경변수 누락 | `GOOGLE_CLIENT_ID` 추가 후 Redeploy |
| Google 로그인 창에 `origin_mismatch` | 승인된 JavaScript 원본에 배포 주소 없음 | 6-1 진행, 5분 기다린 뒤 다시 시도. `https://` 포함, 끝 `/` 없음 |
| "액세스 차단됨: 앱이 테스트 중" | OAuth 앱이 테스트 모드 | 2-4: 테스트 사용자 추가 또는 앱 게시 |
| 관리자 선택 시 `초대 코드가 유효하지 않습니다` | 코드 오타 | `.env.vercel` 또는 Vercel 환경변수의 `ADMIN_SIGNUP_CODE` 확인 (5회 틀리면 30분 잠김) |
| `12자 이상의 ADMIN_SIGNUP_CODE 를 설정하세요` | 코드가 없거나 너무 짧음 | `setup.bat` 을 다시 실행해 새 코드 생성 → Vercel 값 교체 → Redeploy |
| 사이트는 열리는데 `/api/...` 가 404 | Root Directory 를 잘못 지정 | Vercel → Settings → General → Root Directory 를 `vercel.json` 이 있는 폴더로 |
| 빌드 실패 `npm ERR!` | 프론트 의존성 문제 | Vercel → Deployments → 실패한 배포의 로그 확인. 내 PC 에서 `cd frontend && npm install && npm run build` 로 재현 |
| 사진 올릴 때 `너무 큽니다` | 사진이 매우 큼 | 앱이 자동으로 줄여 올리지만, 한 게시물 사진 수를 줄이세요 (최대 10장) |
| 학생 삭제 시 `결제 기록이 있는 학생은 삭제할 수 없습니다` | 회계 기록 보존 정책 | 학생 정보 수정에서 상태를 **퇴원**으로 변경 |
| 카카오페이 버튼이 비활성 | `KAKAO_SECRET_KEY` 없음 | 키 추가 후 Redeploy. 카카오페이 개발자센터에 사이트 도메인 등록이 필요할 수 있습니다(직접 확인 필요) |
| 업로드한 과제 첨부 파일이 사라짐 | Vercel 은 파일을 영구 저장하지 않음 | 7번 표의 Supabase Storage 변수 설정 |

---

## 9. 수정 후 다시 배포하기

- **코드를 고쳤을 때**: GitHub 에 push 하면 Vercel 이 자동으로 다시 배포합니다.
  ```bash
  git add .
  git commit -m "수정 내용"
  git push
  ```
- **환경변수만 바꿨을 때**: Vercel → **Deployments** → 맨 위 배포의 **⋯ → Redeploy** (환경변수는 새 배포부터 적용)
- **테이블(모델)을 바꿨을 때**: `cd backend && python scripts/export_schema.py > ../setup.sql` 로 setup.sql 을 다시 만든 뒤 Supabase SQL Editor 에서 실행
  (새 테이블은 자동으로 추가되지만, 기존 테이블에 컬럼을 추가하는 변경은 자동 반영되지 않으므로 `ALTER TABLE ... ADD COLUMN` 을 직접 실행해야 합니다)

---

## 10. 부록

### 폴더 구조

```
project/                      ← Vercel Root Directory (vercel.json 이 있는 곳)
├── setup.sql                 Supabase SQL Editor 에 붙여 넣는 테이블 생성 스크립트
├── setup.py / setup.bat / setup.sh   배포 준비 도우미
├── vercel.json               Vercel 설정 (빌드·서울 리전·/api 라우팅·Cron·보안 헤더)
├── requirements.txt          Vercel Python 함수 의존성 (backend/requirements.txt 와 동일하게 유지)
├── .python-version           Vercel Python 버전 (3.12)
├── api/index.py              Vercel 함수 진입점 → backend/main.py 의 FastAPI app 실행
├── backend/
│   ├── main.py               FastAPI 백엔드 (모델·인증·API 전체)
│   ├── .env.example          환경변수 예시
│   ├── scripts/export_schema.py   모델 → setup.sql 생성
│   ├── scripts/seed_demo.py       데모 데이터 (setup.bat demo)
│   └── tests/                pytest 테스트 (setup.bat test)
└── frontend/
    ├── src/api.js            모든 REST 호출
    ├── src/utils/image.js    업로드 전 사진 축소
    ├── src/components/       로그인·역할 선택(FacilityManagerUI), 관리자 셸(Layout)
    └── src/pages/            각 화면
```

### 테스트

```bash
setup.bat test                # Windows (내부적으로 cd backend && pytest -q)
```

- 기본은 임시 SQLite 로 실행하며, SQLite 도 외래키를 강제하도록 설정해 Supabase 와 같은 오류를 미리 잡습니다.
- PostgreSQL 로 검증하려면 **비어 있는 테스트용 DB** 주소를 `TEST_DATABASE_URL` 에 넣고 실행하세요. (운영 Supabase 주소는 넣지 마세요)

### 로그인 · 권한 흐름 (보고서용)

1. 브라우저가 Google 에서 받은 ID 토큰을 `POST /api/auth/google` 로 전송 → 서버가 Google 에 검증(aud·iss·이메일 인증) → `app_users` 저장 + HttpOnly 세션 쿠키 발급
2. `POST /api/auth/role` 로 학부모/관리자 선택. 관리자는 **서버가** `admin_accounts` 등록 여부 또는 초대 코드로 판정
3. 미들웨어가 모든 `/api/*` 를 보호: `/api/parent/*` 는 학부모 세션, 나머지는 관리자 세션, 직원은 `/api/shop/*`·`/api/b2b/*` 만
4. 공개 API 는 로그인·결제 콜백·헬스 체크·Cron 뿐 (`main.py` 의 `_PUBLIC_API_PATHS`)

### v8 변경 내역 (코드 검토 결과)

**Supabase·Vercel 에서 실제로 나던 오류 수정**

| 문제 | 수정 | 검증 |
|---|---|---|
| PostgreSQL 은 외래키를 강제해서 출결이 있는 학생, 과제가 있는 수업, 댓글이 있는 게시물을 지우면 500 오류 | 연결 데이터를 먼저 정리하고 삭제. 결제 기록이 있는 학생은 회계 보존을 위해 '퇴원' 처리 안내(409) | 실제 PostgreSQL 16 에서 v7=500 → v8=정상 확인 |
| 학생·커뮤니티 목록 응답에 사진(base64)이 통째로 들어가 Vercel 응답 한도(4.5MB) 초과 | 목록에는 사진 URL 만, 사진은 전용 주소로 한 장씩 (브라우저 캐시) | 학생 30명(사진 200KB): 8.0MB → 8.7KB, 게시물 10개(사진 3장): 8.0MB → 2.0KB |
| 휴대폰 원본 사진 업로드가 요청 한도(4.5MB) 초과 | 브라우저에서 축소 후 업로드 (프로필 512px, 게시물·서류 1600px, 로고 256px) | 4032×3024 사진 → 144KB~570KB |
| Vercel 서버 시계(UTC) 때문에 한국 시간 00~09시에 '오늘'이 어제로 계산 (출결 통계·결제일) | `APP_TIMEZONE`(Asia/Seoul) 기준으로 통일 | 테스트 `test_today_uses_app_timezone` |
| Vercel 기본 리전이 미국(iad1)이라 서울 Supabase 와 쿼리마다 왕복 지연 | `vercel.json` 에 서울 리전(`icn1`) 지정 | — |
| 요청마다 DB 연결 2개(인증용 + 처리용) | 요청당 1개로 공유 | — |
| DB 오류가 영어 500 으로만 표시 | 연결 실패·테이블 없음·입력 초과를 한국어 안내로, `/api/health` 에 원인 표시 | 테스트 |

**보안 강화**

- 관리자 초대 코드 무차별 대입 방지(5회 실패 → 30분 잠금), 12자 미만 초대 코드는 사용 안 함
- 같은 청구서로 결제창을 두 번 열면 이전 결제창을 무효화 → 이중 결제 방지 (금액은 계속 서버가 청구서에서 확정)
- 개발용 로그인은 서버리스·Supabase 에서는 설정과 무관하게 꺼짐 (로컬 SQLite 전용)
- 입력 길이·사진 형식 검증(사진은 PNG/JPG/WEBP/GIF data URL 만), 서류 OCR 결과는 정해진 필드만 반환
- 서류 사진은 인식에만 쓰고 저장하지 않음(연락처·주소가 찍힌 서류가 프로필 사진으로 남던 문제), 브라우저 콘솔의 개인정보 출력 제거
- API 응답 `Cache-Control: no-store`, 보안 헤더(nosniff·frame 차단 등), 운영에서 API 문서(/docs) 숨김
- 로그아웃 시 브라우저에 남은 기관 정보·할 일 캐시 삭제

**정리**

- MySQL 지원 제거 (PyMySQL 의존성·MySQL 전용 코드·설정 삭제), Supabase 용 `setup.sql` 을 저장소 루트로 이동
- 배포 준비 도우미(`setup.py`)를 Supabase·Google·Vercel 흐름에 맞게 재작성

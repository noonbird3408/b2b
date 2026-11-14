# 쑥쑥

**학원과 교육 시설의 학생 관리, 출결, 수납, 물품 관리를 한곳에서 처리하는 웹 서비스입니다.**

운영자는 대시보드에서 오늘의 출결과 수납 현황을 확인할 수 있습니다. 학부모는 자녀를 연결해 출결, 청구 내역, 공지 등을 확인합니다.

## 주요 기능

| 기능 | 사용 흐름 |
| --- | --- |
| 대시보드 | 재원생, 출결, 미납과 매출 현황을 확인합니다. |
| 학생·수업 관리 | 학생을 등록하고 수업과 시간표를 관리합니다. 학부모의 가입 신청과 기존 학생 연결을 처리합니다. |
| 출결·수납 | 수업별 출결을 기록하고 청구서, 미납, 납부 내역을 관리합니다. 카카오페이 연동을 설정할 수 있습니다. |
| 학부모 포털 | 자녀의 출결과 수납, 과제, 공지를 확인하고 알림을 받습니다. |
| 커뮤니티 | 공지와 게시글을 공유하고 댓글을 작성합니다. Gemini 연동을 설정하면 공지 문장 다듬기를 사용할 수 있습니다. |
| 쇼핑몰·재고 | 교육 물품을 찾아 주문하고 시설의 품목과 재고를 관리합니다. |

## 구현

- **프론트엔드** | React, Vite, React Router
- **백엔드** | FastAPI, SQLAlchemy
- **인증·데이터** | Google 로그인, Supabase PostgreSQL, 로컬 개발용 SQLite
- **배포** | Vercel

운영자와 학부모의 화면과 권한을 나누고, 시설을 기준으로 운영 데이터를 조회합니다. Vite 개발 서버는 `/api` 요청을 FastAPI로 프록시해 프론트엔드와 API를 같은 출처에서 사용할 수 있게 합니다.

화면 코드는 경로별로 나눠 필요한 시점에 불러옵니다. 학부모 포털의 30일 출결 집계는 기록을 한 번 순회해 전체와 수업별 출석률에 필요한 값을 계산합니다.

## 로컬 실행

Node.js 18 이상과 Python 3.12를 사용합니다. 새로 체크아웃한 저장소에서 아래 명령을 실행하면 의존성을 설치하고, DB 연결 설정이 비어 있을 경우 로컬 SQLite와 개발용 로그인을 설정합니다.

```powershell
cd project
python setup.py local
python setup.py run
```

- 화면 | `http://localhost:5173`
- API 문서 | `http://localhost:8000/docs`
- Supabase, Google 로그인, 카카오페이, Gemini와 Vercel 설정 | [설치·배포 안내](project/README.md)

## 저장소 구조

| 경로 | 역할 |
| --- | --- |
| [`project/frontend/`](project/frontend/) | 관리 화면, 학부모 포털, 쇼핑몰 |
| [`project/backend/`](project/backend/) | API, 데이터 모델, 백엔드 테스트 |
| [`project/setup.sql`](project/setup.sql) | PostgreSQL 초기 스키마 |
| [`project/setup.py`](project/setup.py) | 로컬 실행, 검증, 시연 데이터 도우미 |

## 검증

저장소의 `project/`에서 백엔드 테스트를 실행합니다. 프론트엔드 빌드는 `project/frontend/`에서 실행합니다.

```powershell
python setup.py test
cd frontend
npm.cmd run build
```

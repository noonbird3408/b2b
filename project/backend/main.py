# =====================================================================
# 시설 통합 관리 시스템 - FastAPI 백엔드 (v8)
# 배포 : Vercel(api/index.py 가 이 app 을 실행) + Supabase(PostgreSQL)
# 로컬 미리보기(선택): python ../setup.py local  →  python ../setup.py run
# Swagger : http://localhost:8000/docs (로컬 실행 시)
#
# v8 변경점
#   - DB: Supabase(PostgreSQL) 전용 + 테스트/로컬용 SQLite. MySQL 지원 종료
#   - 시간: 서버(Vercel=UTC)와 무관하게 APP_TIMEZONE(기본 Asia/Seoul) 기준 '오늘'
#   - 사진: 목록 응답에서 base64 를 빼고 사진 전용 URL 로 제공(Vercel 4.5MB 응답 한도 대응)
#   - 삭제: 외래키가 강제되는 PostgreSQL 에서 학생·수업·게시물 삭제가 실패하던 문제 수정
#   - 보안: 초대 코드 무차별 대입 잠금, 같은 청구서 이중 결제 방지, 입력 길이 검증
#   - 운영: /api/health 에서 DB 연결·테이블·설정 상태를 한 번에 확인
# =====================================================================

import os
import sys
import uuid
import json
import re
import base64
import hashlib
import secrets
import logging
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, List
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

import requests  # 카카오페이 / Google / 쇼핑몰 REST 호출용

from fastapi import FastAPI, HTTPException, Depends, Query, Form, File, UploadFile, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import (
    create_engine, Column, Integer, String, Date, Time, CHAR, Text,
    Boolean, TIMESTAMP, ForeignKey, UniqueConstraint, func, and_, or_, inspect, text,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship, selectinload, defer
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError, DataError
from sqlalchemy.pool import NullPool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facility")
# backend/.env 를 실행 위치와 무관하게 읽음 (Vercel 에서는 대시보드 환경변수 사용)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
load_dotenv()

# Vercel 서버리스 환경 여부 (Vercel 이 자동으로 VERCEL=1 을 주입)
IS_SERVERLESS = bool(os.getenv("VERCEL")) or os.getenv("SERVERLESS", "").lower() == "true"


# ---------------------------------------------------------------------
# 시간 기준 — Vercel 서버 시계는 UTC 라서 _today() 를 쓰면 한국 시간 00~09시에
# '어제'로 계산됩니다. 모든 '지금/오늘'은 APP_TIMEZONE 기준으로 계산합니다.
# ---------------------------------------------------------------------
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Seoul")
try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo(APP_TIMEZONE)
except Exception:  # tzdata 가 없는 환경 대비 (한국은 서머타임이 없어 고정 +9 로 충분)
    logger.warning("시간대 %s 를 불러오지 못해 UTC+9 로 대체합니다.", APP_TIMEZONE)
    _TZ = timezone(timedelta(hours=9))


def _now() -> datetime:
    """APP_TIMEZONE 기준 현재 시각(타임존 정보 없는 값 — DB TIMESTAMP 컬럼과 같은 형식)"""
    return datetime.now(_TZ).replace(tzinfo=None)


def _today() -> date:
    return _now().date()


# ---------------------------------------------------------------------
# DB 설정 — Supabase(PostgreSQL) 운영 / SQLite 테스트·로컬
# ---------------------------------------------------------------------
def _normalize_database_url(url: str) -> str:
    """Supabase 가 주는 postgres:// URL 을 SQLAlchemy + psycopg3 드라이버 형식으로 변환"""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("sqlite:///./"):  # 상대 경로 SQLite 는 실행 위치와 무관하게 backend/ 기준
        url = "sqlite:///" + os.path.join(os.path.dirname(os.path.abspath(__file__)), url[len("sqlite:///./"):])
    return url


_raw_database_url = os.getenv("DATABASE_URL", "").strip()
DATABASE_PROBLEM = ""   # 설정 오류 안내(있으면 API 가 503 으로 이유를 알려 줌)
if not _raw_database_url:
    if IS_SERVERLESS:
        DATABASE_PROBLEM = "DATABASE_URL 환경변수가 없습니다. Vercel → Settings → Environment Variables 에 Supabase 연결 주소를 넣고 다시 배포하세요."
    _raw_database_url = "sqlite:////tmp/facility.db" if IS_SERVERLESS else "sqlite:///./facility.db"
elif _raw_database_url.startswith("mysql"):
    DATABASE_PROBLEM = "MySQL 은 더 이상 지원하지 않습니다. DATABASE_URL 을 Supabase(PostgreSQL) 주소로 바꾸세요."
    _raw_database_url = "sqlite:////tmp/facility.db" if IS_SERVERLESS else "sqlite:///./facility.db"
if DATABASE_PROBLEM:
    logger.error(DATABASE_PROBLEM)

DATABASE_URL = _normalize_database_url(_raw_database_url)
DB_DIALECT = DATABASE_URL.split(":", 1)[0].split("+", 1)[0]  # postgresql / sqlite


def _engine_kwargs() -> dict:
    kwargs = {"echo": False, "pool_pre_ping": True}
    if DB_DIALECT == "sqlite":
        kwargs["connect_args"] = {"check_same_thread": False}
    elif DB_DIALECT == "postgresql":
        # Supabase 트랜잭션 풀러(6543)는 prepared statement 를 지원하지 않음.
        # 연결이 안 될 때 Vercel 함수가 오래 멈추지 않도록 10초에서 끊음.
        kwargs["connect_args"] = {"prepare_threshold": None, "connect_timeout": 10}
    if IS_SERVERLESS:
        # 서버리스 인스턴스는 수명이 짧아 자체 커넥션 풀 대신 Supabase 풀러에 맡김
        kwargs["poolclass"] = NullPool
    return kwargs


engine = create_engine(DATABASE_URL, **_engine_kwargs())
if DB_DIALECT == "sqlite":
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _sqlite_enforce_foreign_keys(dbapi_connection, _record):
        # SQLite 도 Supabase(PostgreSQL)처럼 외래키를 강제 → 로컬·테스트에서 같은 오류를 미리 발견
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()

# (v8.1) 과제 첨부 파일은 DB(assignment_files)에 저장하므로 별도 업로드 폴더를 쓰지 않습니다.

# Base.metadata.create_all() 은 모든 모델 정의 뒤(파일 맨 아래)에서 호출합니다.


# ---------------------------------------------------------------------
# ORM 모델
# ---------------------------------------------------------------------
class Member(Base):
    __tablename__ = "members"
    member_id        = Column(Integer, primary_key=True, autoincrement=True)
    name             = Column(String(50), nullable=False)
    gender           = Column(CHAR(1),    nullable=False)
    age              = Column(Integer,    nullable=False)
    enrollment_date  = Column(Date,       nullable=False)
    withdrawal_date  = Column(Date)
    payment_date     = Column(Date)
    father_name      = Column(String(50))
    mother_name      = Column(String(50))
    father_phone     = Column(String(20))
    mother_phone     = Column(String(20))
    address          = Column(String(200))
    status           = Column(String(10), default="ACTIVE")
    created_at       = Column(TIMESTAMP, default=_now, server_default=func.now())
    updated_at       = Column(TIMESTAMP, default=_now, server_default=func.now(), onupdate=_now)
    photo_url        = Column(Text)   # 학생 프로필 사진 (base64 data URL)


class Attendance(Base):
    __tablename__ = "attendances"
    # [FIX] 같은 회원·같은 날짜 중복을 DB 차원에서 차단 (앱 레벨 검사만으로는 동시성에 취약)
    __table_args__ = (
        UniqueConstraint("member_id", "attendance_date", name="uq_attendance_member_date"),
    )
    attendance_id    = Column(Integer, primary_key=True, autoincrement=True)
    member_id        = Column(Integer, ForeignKey("members.member_id"), nullable=False)
    attendance_date  = Column(Date,     nullable=False, index=True)
    status           = Column(String(10), default="PRESENT")
    check_in_time    = Column(Time)
    check_out_time   = Column(Time)
    note             = Column(String(200))
    created_at       = Column(TIMESTAMP, default=_now, server_default=func.now())
    member           = relationship("Member")


class Payment(Base):
    __tablename__ = "payments"
    payment_id       = Column(Integer, primary_key=True, autoincrement=True)
    member_id        = Column(Integer, ForeignKey("members.member_id"), nullable=False)
    amount           = Column(Integer, nullable=False)
    paid_at          = Column(Date,    nullable=False, index=True)
    payment_type     = Column(String(20), default="TUITION")
    method           = Column(String(20), default="CARD")
    note             = Column(String(200))
    created_at       = Column(TIMESTAMP, default=_now, server_default=func.now())
    member           = relationship("Member")


class Notice(Base):
    __tablename__ = "notices"
    notice_id        = Column(Integer, primary_key=True, autoincrement=True)
    title            = Column(String(200), nullable=False)
    content          = Column(Text,        nullable=False)
    author           = Column(String(50),  default="관리자")
    category         = Column(String(20),  default="GENERAL")
    is_pinned        = Column(Boolean,     default=False)
    # v8.1: 반 공지 — 값이 있으면 그 반 수강생의 학부모에게만 보이는 공지 (없으면 전체 공지)
    class_id         = Column(Integer, index=True)
    created_at       = Column(TIMESTAMP,   default=_now, server_default=func.now())
    updated_at       = Column(TIMESTAMP,   default=_now, server_default=func.now(), onupdate=_now)


# 수업 (classes)
class Class(Base):
    __tablename__ = "classes"
    class_id     = Column(Integer, primary_key=True, autoincrement=True)
    name         = Column(String(100), nullable=False)
    teacher      = Column(String(50),  nullable=False)
    start_date   = Column(Date,        nullable=False)
    end_date     = Column(Date,        nullable=False)
    days_of_week = Column(String(40),  default="")
    start_time   = Column(Time)
    end_time     = Column(Time)
    description  = Column(Text)
    color_index  = Column(Integer, default=0)
    # v8.1: 요일별 수업 시간 JSON [{"day":"MON","start":"14:00","end":"15:00"}] — 요일마다 시간이 다를 때
    schedule_detail = Column(Text)
    created_at   = Column(TIMESTAMP, default=_now, server_default=func.now())
    updated_at   = Column(TIMESTAMP, default=_now, server_default=func.now(), onupdate=_now)
    enrollments  = relationship("Enrollment", back_populates="cls",
                                cascade="all, delete-orphan")


# 수강 (enrollments) - 학생-수업 N:M 매핑
class Enrollment(Base):
    __tablename__ = "enrollments"
    # [FIX] 같은 회원·같은 수업 중복 등록을 DB 차원에서 차단
    __table_args__ = (
        UniqueConstraint("member_id", "class_id", name="uq_enrollment_member_class"),
    )
    enrollment_id = Column(Integer, primary_key=True, autoincrement=True)
    member_id     = Column(Integer, ForeignKey("members.member_id"), nullable=False)
    class_id      = Column(Integer, ForeignKey("classes.class_id"),  nullable=False)
    enrolled_at   = Column(Date,    nullable=False, default=_today, server_default=func.current_date())
    status        = Column(String(10), default="ACTIVE")
    created_at    = Column(TIMESTAMP, default=_now, server_default=func.now())
    member        = relationship("Member")
    cls           = relationship("Class", back_populates="enrollments")


# 수업관리 - 과제
class Assignment(Base):
    __tablename__ = "assignments"
    assignment_id = Column(Integer, primary_key=True, autoincrement=True)
    class_id      = Column(Integer, ForeignKey("classes.class_id"), nullable=False)
    title         = Column(String(200), nullable=False)
    content       = Column(Text)
    due_date      = Column(String(20),  nullable=False)  # YYYY-MM-DD
    file_name     = Column(String(255))                   # 서버에 저장된 파일명
    created_at    = Column(TIMESTAMP,   default=_now, server_default=func.now())


# v8.1: 과제 첨부 파일 — Vercel 은 파일을 영구 저장하지 않으므로 DB 에 보관 (파일당 4MB 이하)
class AssignmentFile(Base):
    __tablename__ = "assignment_files"
    assignment_id = Column(Integer, ForeignKey("assignments.assignment_id", ondelete="CASCADE"), primary_key=True)
    file_name     = Column(String(255), nullable=False)   # 원래 파일 이름(표시·다운로드용)
    mime_type     = Column(String(100), nullable=False, default="application/octet-stream")
    size_bytes    = Column(Integer, nullable=False, default=0)
    data          = Column(Text, nullable=False)          # base64
    created_at    = Column(TIMESTAMP, default=_now, server_default=func.now())


# v8.1: 과제 제출 현황 (학생별) — 관리자가 확인 표시, 학부모 포털에서 조회
class AssignmentSubmission(Base):
    __tablename__ = "assignment_submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "member_id", name="uq_submission_assignment_member"),)
    submission_id = Column(Integer, primary_key=True, autoincrement=True)
    assignment_id = Column(Integer, ForeignKey("assignments.assignment_id", ondelete="CASCADE"), nullable=False, index=True)
    member_id     = Column(Integer, ForeignKey("members.member_id", ondelete="CASCADE"), nullable=False, index=True)
    status        = Column(String(12), nullable=False, default="SUBMITTED")   # SUBMITTED / LATE / MISSING
    note          = Column(String(200))
    checked_at    = Column(TIMESTAMP, default=_now, onupdate=_now)


# v8.1: 학생 상담·특이사항 메모 (이력으로 쌓임 — 관리자 전용)
class MemberNote(Base):
    __tablename__ = "member_notes"
    note_id    = Column(Integer, primary_key=True, autoincrement=True)
    member_id  = Column(Integer, ForeignKey("members.member_id", ondelete="CASCADE"), nullable=False, index=True)
    author     = Column(String(100), nullable=False, default="관리자")
    content    = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now(), index=True)


# v8.1: 알림함 — 등·하원, 공지, 청구서, 결제 완료, 미납 안내, 과제, 댓글 검토 등.
#        받는 사람은 Google 로그인 사용자(app_users). 화면은 주기적으로 새 알림을 조회(폴링)합니다.
class Notification(Base):
    __tablename__ = "notifications"
    notification_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("app_users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    audience   = Column(String(10), nullable=False, default="parent")    # parent / admin (어느 화면의 알림함인지)
    kind       = Column(String(20), nullable=False)                      # CHECK_IN / CHECK_OUT / NOTICE / INVOICE / PAYMENT / UNPAID / ASSIGNMENT / MODERATION
    title      = Column(String(200), nullable=False)
    body       = Column(String(1000), nullable=False, default="")
    link       = Column(String(200))                                     # 눌렀을 때 이동할 화면(탭) 힌트
    member_id  = Column(Integer, ForeignKey("members.member_id", ondelete="CASCADE"), index=True)
    is_read    = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now(), index=True)


# v8.1: 관리자 오늘의 업무 (브라우저 저장 → 계정별 서버 저장, 다른 기기에서도 동일)
class AdminTodo(Base):
    __tablename__ = "admin_todos"
    todo_id    = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("admin_accounts.account_id", ondelete="CASCADE"), nullable=False, index=True)
    due_time   = Column(String(5), nullable=False, default="")     # HH:MM (선택)
    text       = Column(String(200), nullable=False)
    tag        = Column(String(10), nullable=False, default="primary")
    done       = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


# v8.1: 동작(이벤트) 로그 — 누가·언제·무엇을. 대시보드 '최근 활동'과 이용 분석에 사용.
#        개인정보는 남기지 않고 대상 ID 와 요약만 기록합니다.
class ActivityLog(Base):
    __tablename__ = "activity_logs"
    log_id     = Column(Integer, primary_key=True, autoincrement=True)
    actor_type = Column(String(10), nullable=False)        # admin / parent / kiosk / system
    actor_id   = Column(Integer)                           # admin_accounts.account_id 또는 app_users.user_id
    action     = Column(String(40), nullable=False, index=True)
    target_type = Column(String(20))
    target_id  = Column(Integer)
    summary    = Column(String(200), nullable=False, default="")
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now(), index=True)


# v8.1: 댓글 자동 모니터링 결과 + 관리자 판정 (판정 결과는 향후 AI 모델 학습 라벨로 활용)
class CommentReview(Base):
    __tablename__ = "comment_reviews"
    comment_id = Column(Integer, ForeignKey("community_comments.comment_id", ondelete="CASCADE"), primary_key=True)
    model      = Column(String(30), nullable=False, default="rule_v1")
    flagged    = Column(Boolean, nullable=False, default=False)       # 자동 판정: 검토 필요 여부
    score      = Column(Integer, nullable=False, default=0)           # 0~100 위험 점수
    reasons    = Column(String(300), nullable=False, default="")
    decision   = Column(String(10))                                   # None(대기) / APPROVED / HIDDEN
    decided_at = Column(TIMESTAMP)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now(), index=True)


# 카카오페이 결제 대기 (ready ~ approve 사이의 tid·주문정보 보관)
# 인메모리 대신 DB에 저장 → 서버 재시작/다중 워커 환경에서도 안전.
class PaymentPending(Base):
    __tablename__ = "payment_pending"
    partner_order_id = Column(String(64), primary_key=True)   # 주문 식별자
    tid              = Column(String(64), nullable=False)     # 카카오페이 거래 ID
    member_id        = Column(Integer, ForeignKey("members.member_id"), nullable=False)
    partner_user_id  = Column(String(64), nullable=False)
    invoice_id       = Column(Integer)   # [FEED/PAY] 연결된 청구서(있으면 결제 성공 시 PAID 처리)
    amount           = Column(Integer, nullable=False)
    item_name        = Column(String(200), nullable=False, default="수강료")
    payment_type     = Column(String(20),  nullable=False, default="TUITION")
    status           = Column(String(12),  nullable=False, default="READY")  # READY/APPROVED/CANCELED/FAILED
    created_at       = Column(TIMESTAMP, default=_now, server_default=func.now())


# [FEED] 커뮤니티 게시물 (밴드 스타일 피드) — 원장이 작성, 학부모가 열람
class CommunityPost(Base):
    __tablename__ = "community_posts"
    post_id    = Column(Integer, primary_key=True, autoincrement=True)
    author     = Column(String(50), default="관리자")
    content    = Column(Text, nullable=False)
    photos     = Column(Text)   # v7 이전 형식(사진 JSON). v8 부터는 community_photos 테이블 사용
    like_count = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())

class CommunityComment(Base):
    __tablename__ = "community_comments"
    comment_id = Column(Integer, primary_key=True, autoincrement=True)
    post_id    = Column(Integer, ForeignKey("community_posts.post_id"), nullable=False, index=True)
    author     = Column(String(50), default="관리자")
    content    = Column(Text, nullable=False)
    # v8.1: 작성한 학부모(app_users) — 본인 댓글의 '검토 중' 표시용. 관리자 댓글은 비어 있음
    user_id    = Column(Integer, index=True)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())
    post       = relationship("CommunityPost")


# v8.1: 좋아요 — 사용자당 게시물 1회 (새로고침해도 다시 누를 수 없음, 다시 누르면 취소)
class CommunityLike(Base):
    __tablename__ = "community_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_community_like"),)
    like_id    = Column(Integer, primary_key=True, autoincrement=True)
    post_id    = Column(Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("app_users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


# v8.1: 공지 읽음 확인 — 학부모가 공지를 열람하면 기록, 관리자 화면에 '읽음 N가정' 표시
class NoticeRead(Base):
    __tablename__ = "notice_reads"
    __table_args__ = (UniqueConstraint("notice_id", "user_id", name="uq_notice_read"),)
    read_id    = Column(Integer, primary_key=True, autoincrement=True)
    notice_id  = Column(Integer, ForeignKey("notices.notice_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("app_users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    read_at    = Column(TIMESTAMP, default=_now, server_default=func.now())


# v8: 커뮤니티 사진을 게시물 행(JSON)에서 분리 — 목록 응답에는 사진 URL 만 담고,
#     사진은 /api/.../community/photos/{photo_id} 로 한 장씩 내려받습니다(브라우저 캐시 가능).
#     v7 이전 게시물의 community_posts.photos(JSON)는 처음 조회될 때 이 테이블로 옮겨집니다.
class CommunityPhoto(Base):
    __tablename__ = "community_photos"
    photo_id   = Column(Integer, primary_key=True, autoincrement=True)
    post_id    = Column(Integer, ForeignKey("community_posts.post_id", ondelete="CASCADE"), nullable=False, index=True)
    position   = Column(Integer, nullable=False, default=0)
    mime_type  = Column(String(30), nullable=False, default="image/jpeg")
    data       = Column(Text, nullable=False)   # base64 본문(data URL 머리말 제외)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


# [PAY] 청구서(인보이스) — 원장이 발행, 학부모가 이름+연락처로 조회·결제
class Invoice(Base):
    __tablename__ = "invoices"
    invoice_id = Column(Integer, primary_key=True, autoincrement=True)
    member_id  = Column(Integer, ForeignKey("members.member_id"), nullable=False, index=True)
    item_name  = Column(String(200), nullable=False, default="수강료")
    amount     = Column(Integer, nullable=False)
    status     = Column(String(10), nullable=False, default="UNPAID")  # UNPAID / PAID
    due_date   = Column(Date)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())
    member     = relationship("Member")


class AdminAccount(Base):
    __tablename__ = "admin_accounts"
    account_id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(254), nullable=False, unique=True, index=True)
    username = Column(String(100), nullable=False)
    password_hash = Column(String(255))
    google_subject = Column(String(255), unique=True)
    provider = Column(String(20), nullable=False, default="local")
    role = Column(String(20), nullable=False, default="owner")
    pricing_tier = Column(String(20), nullable=False, default="STANDARD")
    failed_logins = Column(Integer, nullable=False, default=0)
    locked_until = Column(TIMESTAMP)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


# v7: Google 로그인 사용자 (학부모·관리자 공통 신원). 관리자 권한은 admin_accounts 의
#     같은 이메일 행이 있을 때만 부여되며, 역할 선택 시 서버가 검증합니다.
#     (v6 의 admin_sessions 테이블은 더 이상 사용하지 않지만 데이터 보존을 위해 삭제하지 않습니다.)
class AppUser(Base):
    __tablename__ = "app_users"
    user_id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(254), nullable=False, unique=True, index=True)
    google_subject = Column(String(255), nullable=False, unique=True)
    name = Column(String(100), nullable=False, default="")
    picture = Column(String(500))
    link_failures = Column(Integer, nullable=False, default=0)   # 자녀 연결 실패 횟수(무차별 대입 방지)
    link_locked_until = Column(TIMESTAMP)
    last_login_at = Column(TIMESTAMP)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


class UserSession(Base):
    __tablename__ = "user_sessions"
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("app_users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    active_role = Column(String(10))            # None(선택 전) / parent / admin
    expires_at = Column(TIMESTAMP, nullable=False, index=True)
    revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


# 학부모(Google 계정) ↔ 자녀(members) 연결. 연결된 자녀의 데이터만 학부모 API 로 노출됩니다.
class ParentLink(Base):
    __tablename__ = "parent_links"
    __table_args__ = (UniqueConstraint("user_id", "member_id", name="uq_parent_link"),)
    link_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("app_users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey("members.member_id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())
    member = relationship("Member")


class AcademySetting(Base):
    __tablename__ = "academy_settings"
    setting_key = Column(String(64), primary_key=True)
    setting_value = Column(Text, nullable=False)
    updated_at = Column(TIMESTAMP, default=_now, server_default=func.now(), onupdate=_now)


class B2BProduct(Base):
    __tablename__ = "b2b_products"
    product_id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String(40), nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    category = Column(String(60), nullable=False, index=True)
    description = Column(String(500), nullable=False, default="")
    price = Column(Integer, nullable=False)
    unit = Column(String(20), nullable=False, default="개")
    sample_available = Column(Boolean, nullable=False, default=False)
    minimum_quantity = Column(Integer, nullable=False, default=1)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


class B2BOrder(Base):
    __tablename__ = "b2b_orders"
    order_id = Column(Integer, primary_key=True, autoincrement=True)
    order_number = Column(String(40), nullable=False, unique=True, index=True)
    account_id = Column(Integer, ForeignKey("admin_accounts.account_id"), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="PENDING_APPROVAL", index=True)
    class_name = Column(String(120), nullable=False, default="전체 기관")
    payment_method = Column(String(32), nullable=False)
    subtotal = Column(Integer, nullable=False)
    discount = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False)
    custom_note = Column(String(500), nullable=False, default="")
    paid_at = Column(TIMESTAMP)
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now(), index=True)
    items = relationship("B2BOrderItem", cascade="all, delete-orphan", order_by="B2BOrderItem.item_id")
    account = relationship("AdminAccount")


class B2BOrderItem(Base):
    __tablename__ = "b2b_order_items"
    item_id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("b2b_orders.order_id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("b2b_products.product_id"), nullable=False)
    sku = Column(String(40), nullable=False)
    product_name = Column(String(200), nullable=False)
    unit = Column(String(20), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Integer, nullable=False)


class B2BSampleRequest(Base):
    __tablename__ = "b2b_sample_requests"
    request_id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("admin_accounts.account_id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("b2b_products.product_id"), nullable=False)
    status = Column(String(20), nullable=False, default="REQUESTED")
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())
    product = relationship("B2BProduct")


class B2BPaymentPending(Base):
    __tablename__ = "b2b_payment_pending"
    partner_order_id = Column(String(64), primary_key=True)
    tid = Column(String(64), nullable=False)
    order_id = Column(Integer, ForeignKey("b2b_orders.order_id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("admin_accounts.account_id"), nullable=False)
    amount = Column(Integer, nullable=False)
    status = Column(String(12), nullable=False, default="READY")
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now())


# v7: 외부 쇼핑몰(기본 ddmmall77.com) 카탈로그. 결제는 외부 쇼핑몰에서 이뤄지고
#     이 시스템은 상품 정보 + 추천 + 클릭(동작) 로그만 관리합니다.
class ShopProduct(Base):
    __tablename__ = "shop_products"
    product_id = Column(Integer, primary_key=True, autoincrement=True)
    external_id = Column(String(80), nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(60), nullable=False, index=True)
    description = Column(String(500), nullable=False, default="")
    price = Column(Integer)                       # None = 견적 문의
    url = Column(String(500), nullable=False)     # 쇼핑몰 상품/주문 페이지
    image_url = Column(String(500))
    tags = Column(String(300), nullable=False, default="")   # 콤마 구분 (추천 키워드 매칭용)
    facility_types = Column(String(100), nullable=False, default="")  # 콤마 구분, 빈 값 = 전체
    min_quantity = Column(Integer, nullable=False, default=1)
    source = Column(String(10), nullable=False, default="seed")   # seed / sync / manual
    active = Column(Boolean, nullable=False, default=True)
    updated_at = Column(TIMESTAMP, default=_now, server_default=func.now(), onupdate=_now)


# 쇼핑몰 상품 클릭 로그 (누가·언제·무엇을) — 추천 고도화를 위한 동작 데이터
class ShopClickEvent(Base):
    __tablename__ = "shop_click_events"
    event_id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("admin_accounts.account_id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("shop_products.product_id", ondelete="CASCADE"), nullable=False, index=True)
    context = Column(String(30), nullable=False, default="catalog")   # catalog / recommendation
    created_at = Column(TIMESTAMP, default=_now, server_default=func.now(), index=True)


# ---------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------
class MemberOut(BaseModel):
    member_id: int
    name: str
    gender: str
    age: int
    enrollment_date: date
    withdrawal_date: Optional[date] = None
    payment_date: Optional[date] = None
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    father_phone: Optional[str] = None
    mother_phone: Optional[str] = None
    address: Optional[str] = None
    status: str
    photo_url: Optional[str] = None
    unpaid_amount: int = 0          # v8.1: 미납 청구서 합계 (미납 기준 = UNPAID 청구서가 있는가)
    unpaid_count: int = 0
    class Config: from_attributes = True


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    gender: str
    age: int = Field(ge=0, le=150)
    enrollment_date: date
    payment_date: Optional[date] = None
    father_name: Optional[str] = Field(None, max_length=50)
    mother_name: Optional[str] = Field(None, max_length=50)
    father_phone: Optional[str] = Field(None, max_length=20)
    mother_phone: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = Field(None, max_length=200)
    photo_url: Optional[str] = None   # 새 사진: data:image/...;base64,... / 기존 사진 유지: 받은 URL 그대로

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v):
        if v not in ("M", "F"):
            raise ValueError("gender 는 'M' 또는 'F' 여야 합니다.")
        return v

class MemberUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    gender: str
    age: int = Field(ge=0, le=150)
    enrollment_date: date
    withdrawal_date: Optional[date] = None
    payment_date: Optional[date] = None
    father_name: Optional[str] = Field(None, max_length=50)
    mother_name: Optional[str] = Field(None, max_length=50)
    father_phone: Optional[str] = Field(None, max_length=20)
    mother_phone: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = Field(None, max_length=200)
    status: str = Field("ACTIVE", max_length=10)
    photo_url: Optional[str] = None

    @field_validator("withdrawal_date", "payment_date", mode="before")
    @classmethod
    def empty_string_to_none(cls, v):
        return None if v == "" else v

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v):
        if v not in ("M", "F"):
            raise ValueError("gender 는 'M' 또는 'F' 여야 합니다.")
        return v


class AttendanceOut(BaseModel):
    attendance_id: int
    member_id: int
    member_name: Optional[str] = None
    attendance_date: date
    status: str
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    note: Optional[str] = None
    class Config: from_attributes = True


class AttendanceCreate(BaseModel):
    member_id: int
    attendance_date: date
    status: str = Field("PRESENT", max_length=10)
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    note: Optional[str] = Field(None, max_length=200)


class PaymentOut(BaseModel):
    payment_id: int
    member_id: int
    member_name: Optional[str] = None
    amount: int
    paid_at: date
    payment_type: str
    method: str
    note: Optional[str] = None
    class Config: from_attributes = True


# [ADD] 결제 등록 스키마 (원본에는 결제 생성 엔드포인트가 없었음)
class PaymentCreate(BaseModel):
    member_id: int
    amount: int = Field(gt=0, le=100_000_000)
    paid_at: date
    payment_type: str = Field("TUITION", max_length=20)
    method: str = Field("CARD", max_length=20)
    note: Optional[str] = Field(None, max_length=200)


class NoticeOut(BaseModel):
    notice_id: int
    title: str
    content: str
    author: str
    category: str
    is_pinned: bool
    created_at: Optional[str] = None
    class_id: Optional[int] = None          # v8.1: 반 공지면 반 ID
    class_name: Optional[str] = None
    read_count: int = 0                     # v8.1: 읽은 학부모 수
    target_count: int = 0                   # v8.1: 공지를 받는 학부모 수
    class Config: from_attributes = True


class NoticeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(max_length=20000)
    author: str = Field("관리자", max_length=50)
    category: str = Field("GENERAL", max_length=20)
    is_pinned: bool = False
    class_id: Optional[int] = None          # 비우면 전체 공지
    notify_parents: bool = True             # 등록 시 학부모 알림 보내기


class MemberBrief(BaseModel):
    """수업에 속한 학생의 요약 정보"""
    member_id: int
    name: str
    gender: str
    age: int
    class Config: from_attributes = True


class ClassOut(BaseModel):
    class_id: int
    name: str
    teacher: str
    start_date: date
    end_date: date
    days_of_week: str = ""
    start_time: Optional[str] = None
    end_time:   Optional[str] = None
    description: Optional[str] = None
    color_index: int = 0
    student_count: int = 0
    students: List[MemberBrief] = []
    schedules: List[dict] = []      # v8.1: [{"day":"MON","start":"14:00","end":"15:00"}]


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    teacher: str = Field(max_length=50)
    start_date: date
    end_date: date
    days_of_week: str = Field("", max_length=40)        # "MON,WED,FRI"
    start_time: Optional[str] = None  # "14:00"
    end_time:   Optional[str] = None  # "15:30"
    description: Optional[str] = Field(None, max_length=5000)
    color_index: int = 0
    # v8.1: 요일별 시간. 보내면 days_of_week/start_time/end_time 보다 우선합니다.
    schedules: Optional[List["ScheduleItem"]] = None

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def empty_time_to_none(cls, v):
        return None if v == "" else v


class ScheduleItem(BaseModel):
    day: str = Field(max_length=10)      # MON~SUN, DAILY, 또는 월~일/매일
    start: str = Field("", max_length=5)
    end: str = Field("", max_length=5)


class ClassUpdate(ClassCreate):
    pass


ClassCreate.model_rebuild()
ClassUpdate.model_rebuild()


class EnrollmentOut(BaseModel):
    enrollment_id: int
    member_id: int
    class_id: int
    enrolled_at: date
    status: str
    class Config: from_attributes = True


# [ADD] AI 분석 요청 스키마 (프론트에서 키를 들고 있지 않도록 서버 프록시용)
class AIAnalyzeRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    context: Optional[str] = None
    include_db: bool = False   # True 면 서버가 DB 요약을 가명화해 컨텍스트로 첨부


# ---------------------------------------------------------------------
# 공용 유틸
# ---------------------------------------------------------------------
def _parse_time(v):
    """ "HH:MM" 문자열 / time / None 을 안전하게 time 객체로 변환 """
    if v in (None, ""):
        return None
    if isinstance(v, time):
        return v
    try:
        return datetime.strptime(v, "%H:%M").time()
    except (ValueError, TypeError):
        raise HTTPException(400, f"시간 형식이 올바르지 않습니다(HH:MM): {v!r}")


# ---------------------------------------------------------------------
# 카카오페이 결제 대기 정리 (수동 + 자동 공용 로직)
#   - 종결 상태(APPROVED/CANCELED/FAILED)는 짧은 타임아웃으로 정리
#   - READY(진행중)는 느린 결제를 끊지 않도록 별도의 긴 타임아웃 적용
# ---------------------------------------------------------------------
PENDING_TERMINAL_STATUSES = ("APPROVED", "CANCELED", "FAILED")
# 기본값: 종결 60분 / 진행중 24시간
CLEANUP_TERMINAL_MINUTES = int(os.getenv("KAKAO_CLEANUP_TERMINAL_MINUTES", "60"))
CLEANUP_READY_MINUTES = int(os.getenv("KAKAO_CLEANUP_READY_MINUTES", "1440"))


def _cleanup_pending(db, terminal_older_than_minutes: int, ready_older_than_minutes: int) -> dict:
    """오래된 결제 대기 레코드를 정리. 두 종류의 타임아웃을 분리 적용합니다."""
    now = _now()
    terminal_cutoff = now - timedelta(minutes=terminal_older_than_minutes)
    ready_cutoff = now - timedelta(minutes=ready_older_than_minutes)

    deleted_terminal = (
        db.query(PaymentPending)
        .filter(PaymentPending.status.in_(PENDING_TERMINAL_STATUSES),
                PaymentPending.created_at < terminal_cutoff)
        .delete(synchronize_session=False)
    )
    deleted_ready = (
        db.query(PaymentPending)
        .filter(PaymentPending.status == "READY",
                PaymentPending.created_at < ready_cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {
        "deleted": deleted_terminal + deleted_ready,
        "deleted_terminal": deleted_terminal,
        "deleted_ready": deleted_ready,
        "terminal_older_than_minutes": terminal_older_than_minutes,
        "ready_older_than_minutes": ready_older_than_minutes,
    }


def _scheduled_cleanup():
    """APScheduler 가 주기적으로 호출하는 자동 정리 작업 (자체 DB 세션 사용)."""
    db = SessionLocal()
    try:
        res = _cleanup_pending(db, CLEANUP_TERMINAL_MINUTES, CLEANUP_READY_MINUTES)
        if res["deleted"]:
            logger.info("[scheduler] 결제 대기 자동 정리: %s", res)
    except Exception as e:  # 스케줄러 스레드가 죽지 않도록 방어
        logger.error("[scheduler] 결제 대기 정리 실패: %s", e)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: "FastAPI"):
    # 상시 실행 서버(로컬/VM)에서만 APScheduler 로 1시간마다 결제 대기 정리.
    # 서버리스(Vercel)는 프로세스가 요청 사이에 멈추므로 Vercel Cron → /api/cron/cleanup 사용.
    scheduler = None
    if not IS_SERVERLESS and os.getenv("DISABLE_SCHEDULER", "").lower() != "true":
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler = BackgroundScheduler(daemon=True)
        scheduler.add_job(_scheduled_cleanup, "interval", hours=1,
                          id="kakao_pending_cleanup", replace_existing=True)
        scheduler.start()
        logger.info("APScheduler 시작: 결제 대기 자동 정리 (1시간 간격, 종결=%d분/진행중=%d분)",
                    CLEANUP_TERMINAL_MINUTES, CLEANUP_READY_MINUTES)
    try:
        yield
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)
            logger.info("APScheduler 종료")


# ---------------------------------------------------------------------
# 앱 설정
# ---------------------------------------------------------------------
app = FastAPI(title="시설 통합 관리 API", version="0.8.1", lifespan=lifespan,
              # 운영(Vercel)에서는 API 문서 화면을 숨김 — 엔드포인트 목록 노출 최소화
              docs_url=None if IS_SERVERLESS else "/docs",
              redoc_url=None, openapi_url=None if IS_SERVERLESS else "/openapi.json")

# CORS 허용 출처 (환경변수 CORS_ORIGINS 로 콤마구분 오버라이드 가능)
# Vercel 배포는 프론트와 API 가 같은 도메인이라 CORS 가 필요 없으므로 기본값을 비워 둡니다.
_default_origins = [] if IS_SERVERLESS else ["http://localhost:5173", "http://127.0.0.1:5173"]
_origins = os.getenv("CORS_ORIGINS")
allow_origins = [o.strip() for o in _origins.split(",") if o.strip()] if _origins else _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db(request: Request):
    """요청당 DB 세션 1개. 인증 미들웨어가 이미 연 세션이 있으면 그대로 재사용합니다
    (서버리스에서는 연결마다 비용이 커서 요청당 연결 수를 줄임)."""
    shared = getattr(request.state, "db", None)
    if shared is not None:
        yield shared
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------
# 공통 오류 응답 — 프론트가 그대로 보여 줄 수 있는 한국어 문자열(detail)로 통일
# ---------------------------------------------------------------------
_MISSING_TABLE_HINT = "DB 테이블이 없습니다. Supabase → SQL Editor 에서 setup.sql 을 실행한 뒤 다시 시도하세요."
_DB_DOWN_HINT = "데이터베이스에 연결하지 못했습니다. /api/health 에서 원인을 확인하세요."


def _db_error_detail(exc: Exception) -> tuple:
    message = str(getattr(exc, "orig", exc)).lower()
    if isinstance(exc, ProgrammingError) and ("does not exist" in message or "no such table" in message or "undefined" in message):
        return 503, _MISSING_TABLE_HINT
    if isinstance(exc, OperationalError) and "no such table" in message:
        return 503, _MISSING_TABLE_HINT
    if isinstance(exc, DataError):
        return 400, "입력값이 허용 범위를 넘었습니다(글자 수·숫자 크기를 확인하세요)."
    return 503, _DB_DOWN_HINT


@app.exception_handler(OperationalError)
@app.exception_handler(ProgrammingError)
@app.exception_handler(DataError)
async def _database_exception_handler(request: Request, exc: Exception):
    status, detail = _db_error_detail(exc)
    logger.error("DB 오류 %s %s: %s", request.method, request.url.path, exc)
    return _json_error(request, status, detail)


@app.exception_handler(IntegrityError)
async def _integrity_exception_handler(request: Request, exc: IntegrityError):
    logger.warning("무결성 오류 %s %s: %s", request.method, request.url.path, exc)
    return _json_error(request, 409, "다른 데이터와 충돌합니다(중복 또는 연결된 데이터). 새로고침 후 다시 시도하세요.")


_FIELD_LABELS = {"name": "이름", "title": "제목", "content": "내용", "amount": "금액", "age": "나이",
                 "phone": "연락처", "address": "주소", "email": "이메일", "item_name": "항목명"}


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    """Pydantic 검증 오류(422)를 한 줄짜리 한국어 안내로 변환"""
    parts = []
    for error in exc.errors()[:3]:
        field = str(error.get("loc", ["", ""])[-1])
        label = _FIELD_LABELS.get(field, field)
        ctx = error.get("ctx") or {}
        kind = error.get("type", "")
        if kind == "string_too_long":
            parts.append(f"{label}: {ctx.get('max_length')}자 이하로 입력하세요")
        elif kind == "string_too_short":
            parts.append(f"{label}: 값을 입력하세요")
        elif kind in ("greater_than", "greater_than_equal", "less_than", "less_than_equal"):
            parts.append(f"{label}: 허용 범위를 벗어났습니다")
        elif kind == "missing":
            parts.append(f"{label}: 필수 항목입니다")
        else:
            parts.append(f"{label}: {error.get('msg', '형식이 올바르지 않습니다')}")
    return _json_error(request, 422, "입력값을 확인하세요 — " + "; ".join(parts))


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("처리되지 않은 오류 %s %s", request.method, request.url.path)
    return _json_error(request, 500, "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.")


def _public_base_url(request: Request, configured: str = "") -> str:
    """콜백·리다이렉트에 쓸 사이트 주소. 환경변수가 없으면 요청이 들어온 주소를 사용합니다
    (Vercel 은 프론트와 API 가 같은 도메인이라 BACKEND/FRONTEND_BASE_URL 을 따로 넣을 필요가 없음)."""
    if configured:
        return configured.rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc).split(",")[0].strip()
    if proto not in ("http", "https") or not re.fullmatch(r"[A-Za-z0-9.\-]+(:\d{1,5})?", host or ""):
        raise HTTPException(400, "요청 주소를 확인할 수 없습니다.")
    return f"{proto}://{host}"


# =====================================================================
# 인증 — Google 로그인 단일화 + 역할 선택(학부모 / 관리자)
#   1) POST /api/auth/google : Google ID token 검증 → app_users + 세션 쿠키 발급(역할 미선택)
#   2) POST /api/auth/role   : 'parent' 또는 'admin' 선택. admin 은 admin_accounts 에
#                              같은 이메일이 등록돼 있거나 초대 코드가 맞을 때만 허용
#   3) 미들웨어가 /api/parent/* 는 학부모 세션, 그 외 /api/* 는 관리자 세션을 요구
# =====================================================================
AUTH_COOKIE_NAME = "facility_session"
AUTH_SESSION_DAYS = 14
AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "true" if IS_SERVERLESS else "false").lower() == "true"
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
ADMIN_SIGNUP_CODE = os.getenv("ADMIN_SIGNUP_CODE", "").strip()
STAFF_SIGNUP_CODE = os.getenv("STAFF_SIGNUP_CODE", "").strip()
CRON_SECRET = os.getenv("CRON_SECRET", "").strip()
# 초대 코드는 추측하기 어려워야 함 — 짧은 코드는 설정돼 있어도 사용하지 않음
MIN_INVITE_CODE_LENGTH = 12
for _name, _code in (("ADMIN_SIGNUP_CODE", ADMIN_SIGNUP_CODE), ("STAFF_SIGNUP_CODE", STAFF_SIGNUP_CODE)):
    if _code and len(_code) < MIN_INVITE_CODE_LENGTH:
        logger.error("%s 가 %d자 미만이라 사용하지 않습니다. setup.py 로 새 코드를 만드세요.", _name, MIN_INVITE_CODE_LENGTH)
# 개발/테스트 전용: Google 없이 로그인. 서버리스(Vercel)와 Supabase DB 에서는 켜져 있어도 무시
# (실수로 켜 둔 채 운영 DB 에 붙으면 아무 이메일로나 로그인할 수 있게 되므로).
DEV_LOGIN_ENABLED = (os.getenv("DEV_LOGIN_ENABLED", "").lower() == "true"
                     and not IS_SERVERLESS and DB_DIALECT == "sqlite")
# 자녀 연결·초대 코드 확인 실패 잠금 (같은 계정 기준)
VERIFY_MAX_FAILURES = 5
VERIFY_LOCK_MINUTES = 30


def _usable_code(code: str) -> str:
    return code if len(code) >= MIN_INVITE_CODE_LENGTH else ""


def _ensure_not_locked(user: "AppUser") -> None:
    if user.link_locked_until and user.link_locked_until > _now():
        minutes = max(1, int((user.link_locked_until - _now()).total_seconds() // 60) + 1)
        raise HTTPException(429, f"확인 시도가 너무 많습니다. 약 {minutes}분 뒤에 다시 시도하세요.")


def _record_failed_attempt(db: Session, user: "AppUser") -> None:
    """자녀 연결·초대 코드 확인 실패를 기록하고, 5번 연속 실패하면 30분 잠금"""
    user.link_failures = (user.link_failures or 0) + 1
    if user.link_failures >= VERIFY_MAX_FAILURES:
        user.link_failures = 0
        user.link_locked_until = _now() + timedelta(minutes=VERIFY_LOCK_MINUTES)
    db.commit()


def _clear_failed_attempts(user: "AppUser") -> None:
    user.link_failures = 0
    user.link_locked_until = None


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=10, max_length=4096)


class DevLoginRequest(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field("개발용 사용자", max_length=100)


class RoleSelectRequest(BaseModel):
    role: str = Field(max_length=10)                 # parent / admin
    invite_code: str = Field("", max_length=200)     # 관리자 최초 등록 시에만 필요


class AccountAccessUpdate(BaseModel):
    role: str
    pricing_tier: str


class AdminAccountCreate(BaseModel):
    email: str = Field(max_length=254)
    username: str = Field("", max_length=100)
    role: str = "staff"


class SettingsUpdate(BaseModel):
    academy: dict
    payment: dict


class B2BOrderItemInput(BaseModel):
    sku: str
    quantity: int


class B2BOrderCreate(BaseModel):
    items: List[B2BOrderItemInput]
    payment_method: str
    class_name: str = "전체 기관"
    custom_note: str = ""


EMAIL_PATTERN = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


def _account_to_out(account: AdminAccount) -> dict:
    return {
        "account_id": account.account_id,
        "email": account.email,
        "username": account.username,
        "provider": account.provider,
        "role": account.role,
        "pricing_tier": account.pricing_tier,
        "is_active": bool(account.is_active),
    }


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        AUTH_COOKIE_NAME, raw_token,
        max_age=AUTH_SESSION_DAYS * 24 * 60 * 60,
        httponly=True, secure=AUTH_COOKIE_SECURE, samesite="lax", path="/",
    )


def _new_user_session(user: AppUser, response: Response, db: Session) -> UserSession:
    raw_token = secrets.token_urlsafe(48)
    session = UserSession(
        token_hash=_hash_token(raw_token), user_id=user.user_id,
        expires_at=_now() + timedelta(days=AUTH_SESSION_DAYS),
    )
    db.add(session)
    db.commit()
    _set_session_cookie(response, raw_token)
    return session


def _resolve_user_session(db: Session, raw_token: Optional[str]):
    """쿠키 토큰 → (UserSession, AppUser). 만료·폐기 세션은 None."""
    if not raw_token:
        return None, None
    row = (db.query(UserSession, AppUser)
             .join(AppUser, AppUser.user_id == UserSession.user_id)
             .filter(UserSession.token_hash == _hash_token(raw_token),
                     UserSession.revoked.is_(False),
                     UserSession.expires_at > _now())
             .first())
    return (row[0], row[1]) if row else (None, None)


def _admin_account_for(db: Session, user: AppUser) -> Optional[AdminAccount]:
    """Google 사용자와 같은 이메일의 활성 관리자 계정"""
    return (db.query(AdminAccount)
              .filter(func.lower(AdminAccount.email) == user.email.lower(),
                      AdminAccount.is_active.is_(True))
              .first())


# 로그인 없이 호출 가능한 API (이유)
#  - auth/*            : 로그인·로그아웃·세션 확인 자체
#  - kakao/status      : 결제 버튼 활성화 여부(비밀 없음)
#  - kakao-success 등  : 카카오페이 서버가 브라우저를 리다이렉트시키는 콜백(order_id 로 검증)
#  - cron/cleanup      : Vercel Cron 호출. 핸들러에서 CRON_SECRET 을 검증
#  - health            : 배포 헬스 체크(민감 정보 없음)
_PUBLIC_API_PATHS = {
    "/api/auth/google", "/api/auth/google/config", "/api/auth/dev-login",
    "/api/auth/logout", "/api/auth/me", "/api/auth/role",
    "/api/payments/kakao/status",
    "/api/payments/kakao-success", "/api/payments/kakao-cancel", "/api/payments/kakao-fail",
    "/api/cron/cleanup", "/api/health",
}
# 직원(staff) 계정도 사용할 수 있는 관리자 영역 (쇼핑몰·발주 + 출석 키오스크 + 알림함·상단 요약)
_STAFF_API_PREFIXES = ("/api/b2b/", "/api/shop/", "/api/kiosk/", "/api/notifications", "/api/admin/summary")


def _public_api_request(method: str, path: str) -> bool:
    return path in _PUBLIC_API_PATHS


def _json_error(request: Request, status_code: int, detail: str) -> JSONResponse:
    response = JSONResponse({"detail": detail}, status_code=status_code)
    origin = request.headers.get("origin")
    if origin in allow_origins:  # 미들웨어 단계 응답에도 CORS 헤더 부여
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response


def _authorize(request: Request, db: Session):
    """세션·역할 검사. 통과하면 None, 막아야 하면 (상태코드, 메시지)를 돌려줌."""
    path = request.url.path
    session, user = _resolve_user_session(db, request.cookies.get(AUTH_COOKIE_NAME))
    if not session:
        return 401, "로그인이 필요합니다."
    request.state.user = user
    request.state.session = session
    if path.startswith("/api/parent/"):
        if session.active_role != "parent":
            return 403, "학부모 모드를 선택한 뒤 이용하세요."
        return None
    if session.active_role != "admin":
        return 403, "관리자 모드를 선택한 뒤 이용하세요."
    account = _admin_account_for(db, user)
    if not account:
        return 403, "관리자 권한이 없는 계정입니다."
    if account.role != "owner" and not path.startswith(_STAFF_API_PREFIXES):
        return 403, "원장(관리자) 권한이 필요합니다."
    request.state.account = account
    return None


_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
}


@app.middleware("http")
async def protect_api(request: Request, call_next):
    """기본 보호: /api/* 는 로그인 + 역할이 맞아야 통과 (허용 목록만 공개)"""
    path = request.url.path
    if path.startswith("/api/") and DATABASE_PROBLEM and path != "/api/health":
        return _json_error(request, 503, DATABASE_PROBLEM)
    if not path.startswith("/api/") or request.method == "OPTIONS" or _public_api_request(request.method, path):
        response = await call_next(request)
    else:
        db = SessionLocal()
        request.state.db = db     # get_db 가 같은 세션을 재사용 → 요청당 DB 연결 1개
        try:
            try:
                # 동기 DB 호출이 이벤트 루프를 막지 않도록 스레드풀에서 실행
                denied = await run_in_threadpool(_authorize, request, db)
            except (OperationalError, ProgrammingError) as exc:
                status, detail = _db_error_detail(exc)
                logger.error("인증 단계 DB 오류: %s", exc)
                return _json_error(request, status, detail)
            if denied:
                return _json_error(request, *denied)
            response = await call_next(request)
        finally:
            request.state.db = None
            await run_in_threadpool(db.close)
    for key, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if path.startswith("/api/") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"   # 개인정보 응답이 공유 캐시에 남지 않도록
    return response


def current_account(request: Request) -> AdminAccount:
    account = getattr(request.state, "account", None)
    if not account:
        raise HTTPException(401, "관리자 로그인이 필요합니다.")
    return account


def owner_account(account: AdminAccount = Depends(current_account)) -> AdminAccount:
    if account.role != "owner":
        raise HTTPException(403, "원장 권한이 필요합니다.")
    return account


def current_parent(request: Request) -> AppUser:
    user = getattr(request.state, "user", None)
    session = getattr(request.state, "session", None)
    if not user or not session or session.active_role != "parent":
        raise HTTPException(401, "학부모 로그인이 필요합니다.")
    return user


# =====================================================================
# v8.1 알림·동작 로그 공통
#   - 알림(notifications): 학부모/관리자 화면이 주기적으로 조회(폴링)해 새 알림을 표시
#     Vercel 서버리스는 WebSocket 연결을 유지할 수 없어, 가벼운 요약 API 를 10~20초마다 조회하는 방식 사용
#   - 동작 로그(activity_logs): 누가·언제·무엇을 (개인정보 없이 대상 ID 와 요약만)
#   알림·로그 행은 원래 작업과 같은 트랜잭션에 추가되므로 작업이 커밋될 때만 함께 저장됩니다.
# =====================================================================
NOTIFICATION_KINDS = {"CHECK_IN", "CHECK_OUT", "ABSENT", "NOTICE", "INVOICE", "PAYMENT", "UNPAID",
                      "ASSIGNMENT", "COMMENT", "MODERATION", "LINK"}


def _log(db: Session, actor_type: str, actor_id: Optional[int], action: str,
         target_type: Optional[str] = None, target_id: Optional[int] = None, summary: str = "") -> None:
    db.add(ActivityLog(actor_type=actor_type, actor_id=actor_id, action=action[:40],
                       target_type=target_type, target_id=target_id, summary=(summary or "")[:200]))


def _actor(request: Request) -> tuple:
    """요청한 사람 (actor_type, actor_id, 표시 이름)"""
    account = getattr(request.state, "account", None)
    if account is not None:
        return "admin", account.account_id, account.username or "관리자"
    user = getattr(request.state, "user", None)
    if user is not None:
        return "parent", user.user_id, user.name or "학부모"
    return "system", None, "시스템"


def _parent_user_ids(db: Session, member_ids) -> dict:
    """학생 ID → 연결된 학부모(app_users) ID 목록"""
    member_ids = [m for m in set(member_ids or []) if m]
    result: dict = {}
    if member_ids:
        for member_id, user_id in (db.query(ParentLink.member_id, ParentLink.user_id)
                                     .filter(ParentLink.member_id.in_(member_ids)).all()):
            result.setdefault(member_id, []).append(user_id)
    return result


def _notify_parents(db: Session, member_ids, kind: str, title: str, body: str = "", link: str = "") -> int:
    """학생들의 학부모에게 알림. 같은 학부모에게 형제가 여럿이어도 학생별로 1건씩. 받은 사람 수를 반환."""
    sent = 0
    for member_id, user_ids in _parent_user_ids(db, member_ids if isinstance(member_ids, (list, set, tuple)) else [member_ids]).items():
        for user_id in set(user_ids):
            db.add(Notification(user_id=user_id, audience="parent", kind=kind, title=title[:200],
                                body=(body or "")[:1000], link=link or None, member_id=member_id))
            sent += 1
    return sent


def _notify_all_parents(db: Session, kind: str, title: str, body: str = "", link: str = "") -> int:
    """연결된 자녀가 있는 모든 학부모에게 1건씩 (전체 공지 등)"""
    user_ids = {uid for (uid,) in db.query(ParentLink.user_id).distinct().all()}
    for user_id in user_ids:
        db.add(Notification(user_id=user_id, audience="parent", kind=kind, title=title[:200],
                            body=(body or "")[:1000], link=link or None))
    return len(user_ids)


def _owner_user_ids(db: Session) -> List[int]:
    """원장(owner) 관리자 계정에 해당하는 Google 사용자 ID"""
    return [uid for (uid,) in (db.query(AppUser.user_id)
                                 .join(AdminAccount, func.lower(AdminAccount.email) == func.lower(AppUser.email))
                                 .filter(AdminAccount.role == "owner", AdminAccount.is_active.is_(True)).all())]


def _notify_admins(db: Session, kind: str, title: str, body: str = "", link: str = "",
                   member_id: Optional[int] = None) -> int:
    user_ids = _owner_user_ids(db)
    for user_id in user_ids:
        db.add(Notification(user_id=user_id, audience="admin", kind=kind, title=title[:200],
                            body=(body or "")[:1000], link=link or None, member_id=member_id))
    return len(user_ids)


def _notification_out(n: "Notification", member_names: dict) -> dict:
    return {"notification_id": n.notification_id, "kind": n.kind, "title": n.title, "body": n.body,
            "link": n.link, "member_id": n.member_id, "member_name": member_names.get(n.member_id),
            "is_read": bool(n.is_read), "created_at": n.created_at.isoformat() if n.created_at else None}


def _list_notifications(db: Session, user_id: int, audience: str, limit: int, unread_only: bool) -> dict:
    query = db.query(Notification).filter(Notification.user_id == user_id, Notification.audience == audience)
    unread = query.filter(Notification.is_read.is_(False)).count()
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))
    rows = query.order_by(Notification.created_at.desc(), Notification.notification_id.desc()).limit(limit).all()
    ids = {n.member_id for n in rows if n.member_id}
    names = dict(db.query(Member.member_id, Member.name).filter(Member.member_id.in_(ids)).all()) if ids else {}
    return {"unread": unread, "items": [_notification_out(n, names) for n in rows]}


class NotificationReadRequest(BaseModel):
    ids: List[int] = []
    all: bool = False


def _mark_notifications_read(db: Session, user_id: int, audience: str, payload: NotificationReadRequest) -> dict:
    query = db.query(Notification).filter(Notification.user_id == user_id, Notification.audience == audience,
                                          Notification.is_read.is_(False))
    if not payload.all:
        if not payload.ids:
            return {"updated": 0}
        query = query.filter(Notification.notification_id.in_(payload.ids[:500]))
    updated = query.update({"is_read": True}, synchronize_session=False)
    db.commit()
    return {"updated": updated}


def _mask_name(name: str) -> str:
    """키오스크·공개 화면용 이름 가리기: 김민준 → 김*준, 이준 → 이*"""
    name = (name or "").strip()
    if len(name) <= 1:
        return name or "?"
    if len(name) == 2:
        return name[0] + "*"
    return name[0] + "*" * (len(name) - 2) + name[-1]


def _signup_role(db: Session, invite_code: str) -> str:
    """초대 코드 → 부여할 관리자 역할. 첫 계정은 반드시 ADMIN_SIGNUP_CODE 필요."""
    invite_code = (invite_code or "").strip()
    admin_code, staff_code = _usable_code(ADMIN_SIGNUP_CODE), _usable_code(STAFF_SIGNUP_CODE)
    if db.query(AdminAccount).count() == 0:
        if not admin_code:
            raise HTTPException(503, f"최초 관리자 등록을 위해 서버에 {MIN_INVITE_CODE_LENGTH}자 이상의 ADMIN_SIGNUP_CODE 를 설정하세요.")
        if invite_code and secrets.compare_digest(invite_code.encode(), admin_code.encode()):
            return "owner"
        raise HTTPException(403, "등록된 관리자가 없습니다. 최초 관리자 초대 코드를 입력하세요.")
    if not invite_code:
        raise HTTPException(403, "관리자로 등록되지 않은 계정입니다. 원장에게 이메일 등록을 요청하거나 초대 코드를 입력하세요.")
    if admin_code and secrets.compare_digest(invite_code.encode(), admin_code.encode()):
        return "owner"
    if staff_code and secrets.compare_digest(invite_code.encode(), staff_code.encode()):
        return "staff"
    raise HTTPException(403, "초대 코드가 유효하지 않습니다.")


def _me_out(db: Session, session: UserSession, user: AppUser) -> dict:
    account = _admin_account_for(db, user)
    return {
        "user": {"email": user.email, "name": user.name, "picture": user.picture},
        "active_role": session.active_role,
        "admin": _account_to_out(account) if account else None,
        "can_admin": bool(account),
        "children_count": db.query(ParentLink).filter(ParentLink.user_id == user.user_id).count(),
    }


def _verify_google_credential(credential: str) -> dict:
    try:
        verify_response = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": credential}, timeout=8,
        )
        if verify_response.status_code != 200:
            raise ValueError("Google ID token invalid")
        claims = verify_response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Google ID token 검증 실패: %s", exc)
        raise HTTPException(401, "Google 계정을 확인하지 못했습니다.")
    if claims.get("aud") != GOOGLE_CLIENT_ID or claims.get("email_verified") not in (True, "true"):
        raise HTTPException(401, "Google 계정의 이메일 인증을 확인할 수 없습니다.")
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(401, "Google 발급 토큰이 아닙니다.")
    return claims


def _login_user(db: Session, response: Response, email: str, subject: str, name: str, picture: Optional[str]) -> dict:
    email = email.strip().lower()
    if not email or not subject:
        raise HTTPException(401, "Google 계정 정보가 충분하지 않습니다.")
    user = db.query(AppUser).filter(AppUser.google_subject == subject).first()
    if not user:
        user = db.query(AppUser).filter(func.lower(AppUser.email) == email).first()
        if user and user.google_subject != subject:
            raise HTTPException(409, "이 이메일에는 다른 Google 계정이 연결되어 있습니다.")
    if not user:
        user = AppUser(email=email, google_subject=subject)
        db.add(user)
    user.email = email
    user.name = (name or email.split("@")[0])[:100]
    user.picture = (picture or None) and picture[:500]
    user.last_login_at = _now()
    # v6 에서 이메일로 만든 관리자 계정은 Google 계정으로 자동 연결
    account = db.query(AdminAccount).filter(func.lower(AdminAccount.email) == email).first()
    if account:
        if account.google_subject and account.google_subject != subject:
            raise HTTPException(409, "이 이메일의 관리자 계정에는 다른 Google 계정이 연결되어 있습니다.")
        account.google_subject = subject
        account.provider = "google"
    db.commit()
    db.refresh(user)
    session = _new_user_session(user, response, db)
    return _me_out(db, session, user)


@app.get("/api/auth/google/config")
def google_auth_config():
    return {"client_id": GOOGLE_CLIENT_ID, "enabled": bool(GOOGLE_CLIENT_ID), "dev_login": DEV_LOGIN_ENABLED}


@app.post("/api/auth/google")
def google_auth(payload: GoogleAuthRequest, response: Response, db: Session = Depends(get_db)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google 로그인이 설정되지 않았습니다. GOOGLE_CLIENT_ID를 설정하세요.")
    claims = _verify_google_credential(payload.credential)
    return _login_user(db, response, str(claims.get("email", "")), str(claims.get("sub", "")),
                       str(claims.get("name") or ""), claims.get("picture"))


@app.post("/api/auth/dev-login")
def dev_login(payload: DevLoginRequest, response: Response, db: Session = Depends(get_db)):
    """로컬 개발 전용 로그인. DEV_LOGIN_ENABLED=true 이고 서버리스가 아닐 때만 동작."""
    if not DEV_LOGIN_ENABLED:
        raise HTTPException(404, "Not Found")
    email = payload.email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(400, "올바른 이메일 주소를 입력하세요.")
    return _login_user(db, response, email, f"dev:{email}", payload.name, None)


def _session_from_request(request: Request, db: Session):
    session, user = _resolve_user_session(db, request.cookies.get(AUTH_COOKIE_NAME))
    if not session:
        raise HTTPException(401, "로그인이 필요합니다.")
    return session, user


@app.get("/api/auth/me")
def auth_me(request: Request, db: Session = Depends(get_db)):
    session, user = _session_from_request(request, db)
    return _me_out(db, session, user)


@app.post("/api/auth/role")
def select_role(payload: RoleSelectRequest, request: Request, db: Session = Depends(get_db)):
    """로그인 후 역할 선택. 관리자 권한은 서버에서만 판정합니다(화면 분기만으로 보호하지 않음)."""
    session, user = _session_from_request(request, db)
    if payload.role == "parent":
        session.active_role = "parent"
        _log(db, "parent", user.user_id, "auth.parent", None, None, "학부모 모드 진입")
    elif payload.role == "admin":
        account = db.query(AdminAccount).filter(func.lower(AdminAccount.email) == user.email.lower()).first()
        if account and not account.is_active:
            raise HTTPException(403, "비활성화된 관리자 계정입니다.")
        if not account:
            # 초대 코드 무차별 대입 방지: 틀린 코드 5회 → 30분 잠금 (자녀 연결 실패와 같은 카운터)
            _ensure_not_locked(user)
            try:
                role = _signup_role(db, payload.invite_code)
            except HTTPException as exc:
                if exc.status_code == 403 and payload.invite_code.strip():
                    _record_failed_attempt(db, user)
                raise
            _clear_failed_attempts(user)
            account = AdminAccount(email=user.email, username=user.name or user.email.split("@")[0],
                                   google_subject=user.google_subject, provider="google", role=role)
            db.add(account)
        session.active_role = "admin"
    else:
        raise HTTPException(400, "역할은 parent 또는 admin 이어야 합니다.")
    db.commit()
    return _me_out(db, session, user)


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response, db: Session = Depends(get_db)):
    raw_token = request.cookies.get(AUTH_COOKIE_NAME)
    if raw_token:
        session = db.query(UserSession).filter(UserSession.token_hash == _hash_token(raw_token)).first()
        if session:
            session.revoked = True
            db.commit()
    response.delete_cookie(AUTH_COOKIE_NAME, path="/", httponly=True, secure=AUTH_COOKIE_SECURE, samesite="lax")
    return {"ok": True}


@app.get("/api/admin/accounts")
def list_admin_accounts(db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    return [_account_to_out(row) for row in db.query(AdminAccount).order_by(AdminAccount.account_id).all()]


@app.post("/api/admin/accounts", status_code=201)
def create_admin_account(payload: AdminAccountCreate, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    """원장이 관리자/직원 Google 이메일을 미리 등록 → 해당 사용자는 초대 코드 없이 '관리자' 선택 가능"""
    email = payload.email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(400, "올바른 이메일 주소를 입력하세요.")
    if payload.role not in {"owner", "staff"}:
        raise HTTPException(400, "역할은 owner 또는 staff 여야 합니다.")
    if db.query(AdminAccount).filter(func.lower(AdminAccount.email) == email).first():
        raise HTTPException(409, "이미 등록된 이메일입니다.")
    row = AdminAccount(email=email, username=(payload.username.strip() or email.split("@")[0])[:100],
                       provider="google", role=payload.role)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _account_to_out(row)


@app.patch("/api/admin/accounts/{account_id}")
def update_admin_account(account_id: int, payload: AccountAccessUpdate, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    target = db.query(AdminAccount).filter(AdminAccount.account_id == account_id).first()
    if not target:
        raise HTTPException(404, "계정을 찾을 수 없습니다.")
    if payload.role not in {"owner", "staff"} or payload.pricing_tier not in {"STANDARD", "VIP"}:
        raise HTTPException(400, "계정 역할 또는 계약 등급이 올바르지 않습니다.")
    if target.account_id == account.account_id and payload.role != "owner":
        owner_count = db.query(AdminAccount).filter(AdminAccount.role == "owner", AdminAccount.is_active.is_(True)).count()
        if owner_count <= 1:
            raise HTTPException(409, "마지막 관리자 계정의 관리자 권한은 해제할 수 없습니다.")
    target.role = payload.role
    target.pricing_tier = payload.pricing_tier
    db.commit()
    db.refresh(target)
    return _account_to_out(target)


FACILITY_TYPES = ("학원", "체육관", "도장", "기타")
DEFAULT_ACADEMY_SETTINGS = {
    "name": "우리 시설", "branch": "본점", "principal": "원장님",
    "role": "관리자", "phone": "", "address": "", "logo": "",
    "facilityType": "학원",   # 시설 유형 — 쇼핑몰 추천 등 시설별 동작에 사용
    "weatherCity": "용인",     # 대시보드 날씨 지역 (프론트의 도시 목록 중 하나)
    "lateGraceMinutes": 10,   # 키오스크 등원 시 수업 시작 후 몇 분까지 '출석'으로 볼지
}
DEFAULT_PAYMENT_SETTINGS = {
    "defaultPaymentDay": "1",
    "baseTuitionFee": 200000,
    "classFees": [],
    "b2bPaymentMethod": "카카오페이",
    "taxInvoiceEmail": "",
}


def _read_settings(db: Session, key: str, default: dict) -> dict:
    row = db.query(AcademySetting).filter(AcademySetting.setting_key == key).first()
    if not row:
        return default.copy()
    try:
        value = json.loads(row.setting_value)
        return value if isinstance(value, dict) else default.copy()
    except (ValueError, TypeError):
        return default.copy()


SETTINGS_MAX_CHARS = 600_000        # 설정 JSON 전체(로고 포함) 상한
LOGO_MAX_CHARS = 450_000            # 로고 data URL 상한(약 330KB) — 프론트가 256px PNG 로 줄여서 보냄


def _validate_settings_size(academy: dict, payment: dict) -> None:
    logo = academy.get("logo") or ""
    if logo and (not isinstance(logo, str) or not re.match(r"data:image/(png|jpeg|webp|gif);base64,", logo)):
        raise HTTPException(400, "로고는 PNG/JPG/WEBP 이미지만 사용할 수 있습니다.")
    if len(logo) > LOGO_MAX_CHARS:
        raise HTTPException(413, "로고 이미지가 너무 큽니다. 더 작은 이미지를 선택하세요.")
    if len(json.dumps(academy, ensure_ascii=False)) + len(json.dumps(payment, ensure_ascii=False)) > SETTINGS_MAX_CHARS:
        raise HTTPException(413, "설정 데이터가 너무 큽니다.")


def _write_settings(db: Session, academy: dict, payment: dict) -> None:
    _validate_settings_size(academy, payment)
    for key, value in (("academy_info", academy), ("payment_settings", payment)):
        row = db.query(AcademySetting).filter(AcademySetting.setting_key == key).first()
        encoded = json.dumps(value, ensure_ascii=False)
        if row:
            row.setting_value = encoded
        else:
            db.add(AcademySetting(setting_key=key, setting_value=encoded))
    db.commit()


@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    return {
        "academy": _read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS),
        "payment": _read_settings(db, "payment_settings", DEFAULT_PAYMENT_SETTINGS),
    }


@app.put("/api/settings")
def put_settings(payload: SettingsUpdate, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    academy = {**DEFAULT_ACADEMY_SETTINGS, **payload.academy}
    payment = {**DEFAULT_PAYMENT_SETTINGS, **payload.payment}
    if not str(academy.get("name", "")).strip():
        raise HTTPException(400, "기관명을 입력하세요.")
    if academy.get("facilityType") not in FACILITY_TYPES:
        raise HTTPException(400, f"시설 유형은 {', '.join(FACILITY_TYPES)} 중 하나여야 합니다.")
    try:
        fee = int(payment.get("baseTuitionFee", 0))
    except (ValueError, TypeError):
        raise HTTPException(400, "기본 수강료는 숫자로 입력하세요.")
    if fee < 0:
        raise HTTPException(400, "기본 수강료는 0 이상이어야 합니다.")
    payment["baseTuitionFee"] = fee
    payment_method = payment.get("b2bPaymentMethod")
    if payment_method not in {"카카오페이", "월말 일괄 정산", "세금계산서 요청"}:
        raise HTTPException(400, "지원하지 않는 B2B 정산 방식입니다.")
    invoice_email = str(payment.get("taxInvoiceEmail", "")).strip()
    if invoice_email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", invoice_email):
        raise HTTPException(400, "세금계산서 이메일 주소를 확인하세요.")
    payment["taxInvoiceEmail"] = invoice_email
    try:
        academy["lateGraceMinutes"] = max(0, min(60, int(academy.get("lateGraceMinutes", 10))))
    except (ValueError, TypeError):
        raise HTTPException(400, "지각 기준(분)은 0~60 사이 숫자로 입력하세요.")
    _write_settings(db, academy, payment)
    return {"academy": academy, "payment": payment}


@app.get("/api/academy")
def get_academy_info(db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    return _read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS)


def _brand(db: Session) -> dict:
    """화면 상단·학부모 포털에 표시할 기관 정보 (연락처·주소 외 민감 정보 없음)"""
    academy = {**DEFAULT_ACADEMY_SETTINGS, **_read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS)}
    return {key: academy.get(key) for key in ("name", "branch", "principal", "role", "logo", "facilityType",
                                              "weatherCity", "lateGraceMinutes")}


# ---------------------------------------------------------------------
# v8.1 관리자 상단 요약 (20초마다 폴링): 알림 수, 메뉴 배지, 오늘 할 일(정시 알림용), 기관 정보
# ---------------------------------------------------------------------
@app.get("/api/admin/summary")
def admin_summary(request: Request, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    user = request.state.user
    since = _now() - timedelta(hours=24)
    pending_reviews = (db.query(func.count(CommentReview.comment_id))
                         .filter(CommentReview.flagged.is_(True), CommentReview.decision.is_(None)).scalar() or 0)
    unpaid = db.query(func.count(Invoice.invoice_id)).filter(Invoice.status == "UNPAID").scalar() or 0
    new_comments = (db.query(func.count(CommunityComment.comment_id))
                      .filter(CommunityComment.user_id.isnot(None), CommunityComment.created_at >= since).scalar() or 0)
    todos = (db.query(AdminTodo).filter(AdminTodo.account_id == account.account_id, AdminTodo.done.is_(False),
                                        AdminTodo.due_time != "").order_by(AdminTodo.due_time).all())
    unread = (db.query(func.count(Notification.notification_id))
                .filter(Notification.user_id == user.user_id, Notification.audience == "admin",
                        Notification.is_read.is_(False)).scalar() or 0)
    return {
        "brand": _brand(db),
        "account": _account_to_out(account),
        "unread_notifications": int(unread),
        "badges": {"unpaid_invoices": int(unpaid), "moderation_pending": int(pending_reviews),
                   "community_new": int(new_comments)},
        "todos": [{"todo_id": t.todo_id, "due_time": t.due_time, "text": t.text} for t in todos],
        "server_time": _now().isoformat(timespec="seconds"),
    }


@app.get("/api/notifications")
def admin_notifications(request: Request, limit: int = Query(30, ge=1, le=100), unread_only: bool = False,
                        db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    return _list_notifications(db, request.state.user.user_id, "admin", limit, unread_only)


@app.post("/api/notifications/read")
def admin_notifications_read(payload: NotificationReadRequest, request: Request, db: Session = Depends(get_db),
                             account: AdminAccount = Depends(current_account)):
    return _mark_notifications_read(db, request.state.user.user_id, "admin", payload)


# ---------------------------------------------------------------------
# v8.1 오늘의 업무 (계정별 서버 저장 — 기존에는 브라우저 localStorage 에만 저장되어 기기마다 달랐음)
# ---------------------------------------------------------------------
TODO_TAGS = {"primary", "success", "warning", "danger"}


class TodoCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    due_time: str = Field("", max_length=5)
    tag: str = "primary"

    @field_validator("due_time")
    @classmethod
    def _valid_time(cls, v):
        if v and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            raise ValueError("시간은 HH:MM 형식이어야 합니다.")
        return v


class TodoUpdate(TodoCreate):
    done: bool = False


def _todo_out(t: AdminTodo) -> dict:
    return {"todo_id": t.todo_id, "text": t.text, "due_time": t.due_time, "tag": t.tag, "done": bool(t.done),
            "created_at": t.created_at.isoformat() if t.created_at else None}


@app.get("/api/todos")
def list_todos(db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    rows = (db.query(AdminTodo).filter(AdminTodo.account_id == account.account_id)
              .order_by(AdminTodo.done, AdminTodo.due_time == "", AdminTodo.due_time, AdminTodo.todo_id).all())
    return [_todo_out(t) for t in rows]


@app.post("/api/todos", status_code=201)
def create_todo(payload: TodoCreate, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    if db.query(AdminTodo).filter(AdminTodo.account_id == account.account_id).count() >= 200:
        raise HTTPException(400, "업무는 200개까지 등록할 수 있습니다. 완료한 업무를 정리해 주세요.")
    row = AdminTodo(account_id=account.account_id, text=payload.text.strip(), due_time=payload.due_time,
                    tag=payload.tag if payload.tag in TODO_TAGS else "primary")
    db.add(row); db.commit(); db.refresh(row)
    return _todo_out(row)


def _own_todo(db: Session, todo_id: int, account: AdminAccount) -> AdminTodo:
    row = db.query(AdminTodo).filter(AdminTodo.todo_id == todo_id, AdminTodo.account_id == account.account_id).first()
    if not row:
        raise HTTPException(404, "업무를 찾을 수 없습니다.")
    return row


@app.put("/api/todos/{todo_id}")
def update_todo(todo_id: int, payload: TodoUpdate, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    row = _own_todo(db, todo_id, account)
    row.text, row.due_time, row.done = payload.text.strip(), payload.due_time, payload.done
    row.tag = payload.tag if payload.tag in TODO_TAGS else "primary"
    db.commit(); db.refresh(row)
    return _todo_out(row)


@app.delete("/api/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: int, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    db.delete(_own_todo(db, todo_id, account)); db.commit()


@app.delete("/api/todos")
def clear_todos(done_only: bool = True, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    query = db.query(AdminTodo).filter(AdminTodo.account_id == account.account_id)
    if done_only:
        query = query.filter(AdminTodo.done.is_(True))
    deleted = query.delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@app.get("/api/admin/data-export")
def export_admin_data(db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    orders = db.query(B2BOrder).order_by(B2BOrder.created_at.desc()).all()
    return {
        "version": 1,
        "exported_at": _now().isoformat(),
        "settings": {
            "academy": _read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS),
            "payment": _read_settings(db, "payment_settings", DEFAULT_PAYMENT_SETTINGS),
        },
        "members": [{
            "member_id": member.member_id,
            "name": member.name,
            "gender": member.gender,
            "age": member.age,
            "enrollment_date": member.enrollment_date.isoformat() if member.enrollment_date else None,
            "withdrawal_date": member.withdrawal_date.isoformat() if member.withdrawal_date else None,
            "father_name": member.father_name,
            "mother_name": member.mother_name,
            "father_phone": member.father_phone,
            "mother_phone": member.mother_phone,
            "address": member.address,
            "status": member.status,
        } for member in db.query(Member).options(defer(Member.photo_url)).order_by(Member.member_id).all()],
        "classes": [{
            "class_id": cls.class_id,
            "name": cls.name,
            "teacher": cls.teacher,
            "start_date": cls.start_date.isoformat() if cls.start_date else None,
            "end_date": cls.end_date.isoformat() if cls.end_date else None,
            "description": cls.description,
        } for cls in db.query(Class).order_by(Class.class_id).all()],
        "attendances": [{
            "attendance_id": row.attendance_id,
            "member_id": row.member_id,
            "attendance_date": row.attendance_date.isoformat() if row.attendance_date else None,
            "status": row.status,
        } for row in db.query(Attendance).order_by(Attendance.attendance_date.desc()).all()],
        "invoices": [{
            "invoice_id": invoice.invoice_id,
            "member_id": invoice.member_id,
            "item_name": invoice.item_name,
            "amount": invoice.amount,
            "status": invoice.status,
            "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        } for invoice in db.query(Invoice).order_by(Invoice.invoice_id).all()],
        "payments": [{
            "payment_id": payment.payment_id,
            "member_id": payment.member_id,
            "amount": payment.amount,
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
            "payment_type": payment.payment_type,
            "method": payment.method,
            "note": payment.note,
        } for payment in db.query(Payment).order_by(Payment.payment_id).all()],
        "orders": [{
            "order_number": order.order_number,
            "status": order.status,
            "total": order.total,
            "payment_method": order.payment_method,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "items": [{"sku": item.sku, "name": item.product_name, "quantity": item.quantity, "unit_price": item.unit_price} for item in order.items],
        } for order in orders],
    }


class DemoDataRequest(BaseModel):
    force: bool = False


@app.post("/api/admin/demo-data", status_code=201)
def load_demo_data(payload: DemoDataRequest, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    """v8.1: 전시회·발표용 가상 데이터 넣기 (학생이 없을 때만, force=true 면 추가로 넣음). 기존 데이터는 지우지 않습니다."""
    import demo_data
    try:
        result = demo_data.seed(db, sys.modules[__name__], account=account, force=payload.force)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(409, str(exc))
    _log(db, "admin", account.account_id, "admin.demo_data", None, None, "데모 데이터 입력")
    db.commit()
    return result


@app.post("/api/admin/data-import")
def import_admin_settings(payload: SettingsUpdate, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    academy = {**DEFAULT_ACADEMY_SETTINGS, **payload.academy}
    payment = {**DEFAULT_PAYMENT_SETTINGS, **payload.payment}
    if not str(academy.get("name", "")).strip():
        raise HTTPException(400, "가져올 데이터에 기관명이 없습니다.")
    _write_settings(db, academy, payment)
    return {"ok": True}


B2B_PRODUCT_SEEDS = [
    {"sku": "BK-101", "name": "파이썬 기초 실습서", "category": "교재", "description": "입문 과정 · 12주 커리큘럼", "price": 18000, "unit": "권", "sample_available": True, "minimum_quantity": 1},
    {"sku": "BK-204", "name": "수학 실전 문제집 2", "category": "교재", "description": "중등 과정 · 개념 확인과 실전 문제", "price": 14500, "unit": "권", "sample_available": True, "minimum_quantity": 1},
    {"sku": "BK-310", "name": "영어 어휘 워크북", "category": "교재", "description": "레벨별 어휘 학습 · 정답 포함", "price": 9500, "unit": "권", "sample_available": True, "minimum_quantity": 1},
    {"sku": "ST-015", "name": "수업용 보드마카 세트", "category": "수업 물품", "description": "검정·파랑·빨강 12자루", "price": 12000, "unit": "세트", "sample_available": False, "minimum_quantity": 1},
    {"sku": "ST-028", "name": "A4 복사지 80g", "category": "소모품", "description": "2,500매 · 주기적 재구매 품목", "price": 26500, "unit": "박스", "sample_available": False, "minimum_quantity": 1},
    {"sku": "ST-036", "name": "출석 스티커 롤", "category": "소모품", "description": "1,000매 · 일일 출석 체크용", "price": 8000, "unit": "롤", "sample_available": False, "minimum_quantity": 1},
    {"sku": "MK-100", "name": "학원 로고 에코백", "category": "홍보물", "description": "최소 30개 · 로고 인쇄 옵션", "price": 4200, "unit": "개", "sample_available": False, "minimum_quantity": 30},
    {"sku": "MK-120", "name": "학원 홍보 볼펜", "category": "홍보물", "description": "최소 100개 · 단면 로고 인쇄", "price": 650, "unit": "개", "sample_available": False, "minimum_quantity": 100},
]


def _ensure_b2b_products(db: Session) -> None:
    existing = {row.sku for row in db.query(B2BProduct.sku).all()}
    added = False
    for product in B2B_PRODUCT_SEEDS:
        if product["sku"] not in existing:
            db.add(B2BProduct(**product))
            added = True
    if added:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Concurrent first requests may seed the same catalog at once.
            if db.query(B2BProduct).count() == 0:
                raise


def _b2b_unit_price(product: B2BProduct, quantity: int, account: AdminAccount) -> int:
    tier_rate = 0.12 if account.pricing_tier == "VIP" else 0.05
    volume_rate = 0.10 if quantity >= 50 else 0.05 if quantity >= 20 else 0
    return round(product.price * (1 - min(tier_rate + volume_rate, 0.20)))


def _b2b_product_out(product: B2BProduct, account: AdminAccount, quantity: int = 1) -> dict:
    return {
        "product_id": product.product_id,
        "sku": product.sku,
        "name": product.name,
        "category": product.category,
        "description": product.description,
        "price": product.price,
        "unit_price": _b2b_unit_price(product, quantity, account),
        "unit": product.unit,
        "sample_available": bool(product.sample_available),
        "minimum_quantity": product.minimum_quantity,
    }


def _b2b_order_out(order: B2BOrder) -> dict:
    return {
        "order_id": order.order_id,
        "order_number": order.order_number,
        "status": order.status,
        "class_name": order.class_name,
        "payment_method": order.payment_method,
        "subtotal": order.subtotal,
        "discount": order.discount,
        "total": order.total,
        "custom_note": order.custom_note,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "paid_at": order.paid_at.isoformat() if order.paid_at else None,
        "account_email": order.account.email if order.account else None,
        "items": [{
            "sku": item.sku,
            "name": item.product_name,
            "quantity": item.quantity,
            "unit": item.unit,
            "unit_price": item.unit_price,
        } for item in order.items],
    }


@app.get("/api/b2b/products")
def list_b2b_products(q: str = "", category: str = "", db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    _ensure_b2b_products(db)
    query = db.query(B2BProduct).filter(B2BProduct.active.is_(True))
    if category and category != "전체":
        query = query.filter(B2BProduct.category == category)
    if q.strip():
        escaped = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(or_(func.lower(B2BProduct.name).like(pattern, escape="\\"), func.lower(B2BProduct.sku).like(pattern, escape="\\")))
    products = query.order_by(B2BProduct.category, B2BProduct.name).limit(100).all()
    return [_b2b_product_out(product, account) for product in products]


@app.get("/api/b2b/classes")
def list_b2b_classes(db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    # [PERF] 반마다 COUNT 쿼리를 날리던 N+1 → GROUP BY 1회
    counts = dict(
        db.query(Enrollment.class_id, func.count(Enrollment.enrollment_id))
          .join(Member, Member.member_id == Enrollment.member_id)
          .filter(Enrollment.status == "ACTIVE", Member.status == "ACTIVE")
          .group_by(Enrollment.class_id).all()
    )
    rows = db.query(Class.class_id, Class.name).order_by(Class.name).all()
    return [{"class_id": cid, "name": name, "student_count": int(counts.get(cid, 0))} for cid, name in rows]


@app.get("/api/b2b/portal")
def get_b2b_portal(db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    academy = _read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS)
    payment = _read_settings(db, "payment_settings", DEFAULT_PAYMENT_SETTINGS)
    return {
        "account": _account_to_out(account),
        "academy": {key: academy.get(key) for key in ("name", "branch", "logo")},
        "payment_method": payment.get("b2bPaymentMethod", "카카오페이"),
    }


@app.get("/api/b2b/recommendations")
def b2b_recommendations(sku: Optional[str] = None, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    _ensure_b2b_products(db)
    purchased_statuses = ["PAID", "SETTLEMENT_PENDING"]
    base = db.query(B2BOrderItem.product_id, func.sum(B2BOrderItem.quantity).label("quantity")) \
        .join(B2BOrder, B2BOrder.order_id == B2BOrderItem.order_id) \
        .filter(B2BOrder.status.in_(purchased_statuses))
    if sku:
        source = db.query(B2BProduct.product_id).filter(B2BProduct.sku == sku).scalar()
        if source:
            same_orders = db.query(B2BOrderItem.order_id).join(B2BOrder).filter(
                B2BOrderItem.product_id == source,
                B2BOrder.status.in_(purchased_statuses),
            ).subquery()
            base = base.filter(B2BOrderItem.order_id.in_(same_orders), B2BOrderItem.product_id != source)
    rows = base.group_by(B2BOrderItem.product_id).order_by(func.sum(B2BOrderItem.quantity).desc()).limit(6).all()
    products_by_id = {product.product_id: product for product in db.query(B2BProduct).filter(B2BProduct.active.is_(True)).all()}
    recommendations = []
    for product_id, quantity in rows:
        product = products_by_id.get(product_id)
        if product:
            recommendations.append({**_b2b_product_out(product, account), "reason": f"DB 주문 이력 {int(quantity)}개 기준 인기 상품"})
    source = "purchase_history"
    if not recommendations:
        source = "catalog_fallback"
        products = db.query(B2BProduct).filter(B2BProduct.active.is_(True)).order_by(B2BProduct.sample_available.desc(), B2BProduct.name).limit(6).all()
        recommendations = [{**_b2b_product_out(product, account), "reason": "구매 이력이 쌓이면 기관 구매 패턴 추천으로 전환됩니다."} for product in products]
    return {"source": source, "items": recommendations}


@app.get("/api/b2b/orders")
def list_b2b_orders(status: Optional[str] = None, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    query = db.query(B2BOrder)
    if account.role != "owner":
        query = query.filter(B2BOrder.account_id == account.account_id)
    if status:
        query = query.filter(B2BOrder.status == status)
    orders = query.order_by(B2BOrder.created_at.desc()).limit(200).all()
    return [_b2b_order_out(order) for order in orders]


@app.post("/api/b2b/orders", status_code=201)
def create_b2b_order(payload: B2BOrderCreate, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    _ensure_b2b_products(db)
    if not payload.items or len(payload.items) > 100:
        raise HTTPException(400, "주문 상품을 1~100개 선택하세요.")
    payment_method = payload.payment_method.strip()
    if payment_method not in {"카카오페이", "월말 일괄 정산", "세금계산서 요청"}:
        raise HTTPException(400, "지원하지 않는 정산 방식입니다.")
    requested = {}
    for item in payload.items:
        if item.quantity < 1 or item.quantity > 10000:
            raise HTTPException(400, "상품 수량은 1~10,000 범위여야 합니다.")
        requested[item.sku] = requested.get(item.sku, 0) + item.quantity

    subtotal = 0
    total = 0
    order_items = []
    products = db.query(B2BProduct).filter(B2BProduct.sku.in_(requested), B2BProduct.active.is_(True)).all()
    products_by_sku = {product.sku: product for product in products}
    if len(products_by_sku) != len(requested):
        raise HTTPException(400, "판매 중인 상품을 찾지 못했습니다.")
    for sku, quantity in requested.items():
        product = products_by_sku[sku]
        if quantity < product.minimum_quantity:
            raise HTTPException(400, f"{product.name} 최소 주문 수량은 {product.minimum_quantity}{product.unit}입니다.")
        unit_price = _b2b_unit_price(product, quantity, account)
        subtotal += product.price * quantity
        total += unit_price * quantity
        order_items.append(B2BOrderItem(
            product_id=product.product_id, sku=product.sku, product_name=product.name,
            unit=product.unit, quantity=quantity, unit_price=unit_price,
        ))
    status_value = "PENDING_APPROVAL" if account.role != "owner" else (
        "AWAITING_PAYMENT" if payment_method == "카카오페이" else "SETTLEMENT_PENDING"
    )
    order = B2BOrder(
        order_number=f"B2B-{_now():%y%m%d}-{uuid.uuid4().hex[:8].upper()}",
        account_id=account.account_id, status=status_value,
        class_name=payload.class_name.strip()[:120] or "전체 기관",
        payment_method=payment_method,
        subtotal=subtotal, discount=subtotal - total, total=total,
        custom_note=payload.custom_note.strip()[:500], items=order_items,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _b2b_order_out(order)


@app.post("/api/b2b/orders/{order_id}/approve")
def approve_b2b_order(order_id: int, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    order = db.query(B2BOrder).filter(B2BOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")
    if order.status != "PENDING_APPROVAL":
        raise HTTPException(409, "승인 대기 상태의 주문만 승인할 수 있습니다.")
    order.status = "AWAITING_PAYMENT" if order.payment_method == "카카오페이" else "SETTLEMENT_PENDING"
    db.commit()
    db.refresh(order)
    return _b2b_order_out(order)


@app.post("/api/b2b/orders/{order_id}/reject")
def reject_b2b_order(order_id: int, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    order = db.query(B2BOrder).filter(B2BOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")
    if order.status != "PENDING_APPROVAL":
        raise HTTPException(409, "승인 대기 상태의 주문만 반려할 수 있습니다.")
    order.status = "REJECTED"
    db.commit()
    return _b2b_order_out(order)


@app.post("/api/b2b/orders/{order_id}/settle")
def settle_b2b_order(order_id: int, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    """v8.1: 월말 정산·세금계산서 주문을 '결제 완료'로 확정 (기존에는 정산 대기에서 끝낼 방법이 없었음)"""
    order = db.query(B2BOrder).filter(B2BOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")
    if order.status != "SETTLEMENT_PENDING":
        raise HTTPException(409, "정산 대기 상태의 주문만 정산 완료로 바꿀 수 있습니다.")
    order.status = "PAID"
    order.paid_at = _now()
    _log(db, "admin", account.account_id, "b2b.settle", "order", order.order_id, order.order_number)
    db.commit(); db.refresh(order)
    return _b2b_order_out(order)


@app.post("/api/b2b/orders/{order_id}/payment-ready")
def b2b_payment_ready(order_id: int, request: Request, db: Session = Depends(get_db),
                      account: AdminAccount = Depends(owner_account)):
    order = db.query(B2BOrder).filter(B2BOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")
    if order.status != "AWAITING_PAYMENT" or order.payment_method != "카카오페이":
        raise HTTPException(409, "카카오페이 결제를 진행할 수 있는 주문 상태가 아닙니다.")
    if order.account_id != account.account_id and account.role != "owner":
        raise HTTPException(403, "다른 계정이 생성한 주문은 결제할 수 없습니다.")
    headers = _kakao_headers()
    base = _public_base_url(request, BACKEND_BASE_URL)
    # 같은 주문의 이전 결제창 무효화(이중 결제 방지)
    db.query(B2BPaymentPending).filter(B2BPaymentPending.order_id == order.order_id,
                                       B2BPaymentPending.status == "READY").update(
        {"status": "CANCELED"}, synchronize_session=False)
    partner_order_id = f"b2b_{uuid.uuid4().hex}"
    partner_user_id = f"account_{account.account_id}"
    body = {
        "cid": KAKAO_CID,
        "partner_order_id": partner_order_id,
        "partner_user_id": partner_user_id,
        "item_name": order.items[0].product_name if len(order.items) == 1 else f"기관 상품 {len(order.items)}종",
        "quantity": 1,
        "total_amount": order.total,
        "tax_free_amount": 0,
        "approval_url": f"{base}/api/payments/kakao-success?order_id={partner_order_id}",
        "cancel_url": f"{base}/api/payments/kakao-cancel?order_id={partner_order_id}",
        "fail_url": f"{base}/api/payments/kakao-fail?order_id={partner_order_id}",
    }
    try:
        payment_response = requests.post(f"{KAKAO_API_BASE}/online/v1/payment/ready", json=body, headers=headers, timeout=10)
    except requests.RequestException as exc:
        db.rollback()
        logger.error("B2B KakaoPay ready 통신 오류: %s", exc)
        raise HTTPException(502, "카카오페이 결제 준비 중 오류가 발생했습니다.")
    if payment_response.status_code != 200:
        db.rollback()
        logger.error("B2B KakaoPay ready 실패 %s: %s", payment_response.status_code, payment_response.text[:500])
        raise HTTPException(502, "카카오페이 결제 준비에 실패했습니다.")
    data = payment_response.json()
    db.add(B2BPaymentPending(partner_order_id=partner_order_id, tid=data["tid"], order_id=order.order_id, account_id=account.account_id, amount=order.total))
    db.commit()
    return {
        "next_redirect_pc_url": data.get("next_redirect_pc_url"),
        "next_redirect_mobile_url": data.get("next_redirect_mobile_url"),
        "next_redirect_app_url": data.get("next_redirect_app_url"),
    }


@app.post("/api/b2b/samples/{sku}", status_code=201)
def request_b2b_sample(sku: str, db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    _ensure_b2b_products(db)
    product = db.query(B2BProduct).filter(B2BProduct.sku == sku, B2BProduct.active.is_(True)).first()
    if not product:
        raise HTTPException(404, "상품을 찾을 수 없습니다.")
    if not product.sample_available:
        raise HTTPException(400, "이 상품은 샘플 신청을 지원하지 않습니다.")
    request_row = B2BSampleRequest(account_id=account.account_id, product_id=product.product_id)
    db.add(request_row)
    db.commit()
    return {"request_id": request_row.request_id, "sku": product.sku, "status": request_row.status}


@app.get("/api/b2b/samples")
def list_b2b_samples(db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    rows = db.query(B2BSampleRequest).filter(B2BSampleRequest.account_id == account.account_id).order_by(B2BSampleRequest.created_at.desc()).limit(100).all()
    return [{"request_id": row.request_id, "sku": row.product.sku, "name": row.product.name, "status": row.status, "created_at": row.created_at.isoformat() if row.created_at else None} for row in rows]


# ---------------------------------------------------------------------
# 이미지(data URL) 공통 처리 — 사진은 DB 에 base64 로 두되, 목록 응답에는 넣지 않고
# 사진 전용 URL 로 내려 줍니다. (Vercel 함수 요청·응답 본문 한도 4.5MB 대응)
# ---------------------------------------------------------------------
_IMAGE_DATA_URL_RE = re.compile(r"data:(image/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)\Z")
MEMBER_PHOTO_MAX_CHARS = 400_000          # 학생 사진 1장 ≈ 300KB (프론트가 512px 로 줄여서 보냄)
COMMUNITY_PHOTO_MAX_CHARS = 1_500_000     # 게시물 사진 1장 ≈ 1.1MB (프론트가 1600px 로 줄여서 보냄)
COMMUNITY_PHOTO_MAX_COUNT = 10
COMMUNITY_PHOTOS_TOTAL_MAX_CHARS = 4_000_000   # 한 번에 올리는 사진 합계 (요청 본문 4.5MB 미만)
_PHOTO_CACHE_HEADERS = {"Cache-Control": "private, max-age=31536000, immutable"}


def _parse_image_data_url(value: str, max_chars: int, label: str) -> tuple:
    """data:image/...;base64,... 검증 → (mime, base64 본문)"""
    value = (value or "").strip()
    if len(value) > max_chars:
        raise HTTPException(413, f"{label}이(가) 너무 큽니다. 더 작은 사진을 선택하세요.")
    match = _IMAGE_DATA_URL_RE.match(value)
    if not match:
        raise HTTPException(400, f"{label}은(는) PNG·JPG·WEBP·GIF 이미지만 올릴 수 있습니다.")
    mime = "image/jpeg" if match.group(1) == "image/jpg" else match.group(1)
    body = re.sub(r"\s", "", match.group(2))
    try:
        base64.b64decode(body, validate=True)
    except (ValueError, TypeError):
        raise HTTPException(400, f"{label} 데이터가 손상되었습니다.")
    return mime, body


def _image_response(mime: str, body_b64: str) -> Response:
    return Response(content=base64.b64decode(body_b64), media_type=mime, headers=_PHOTO_CACHE_HEADERS)


# ---------------------------------------------------------------------
# 회원 (members) API
# ---------------------------------------------------------------------
def _member_photo_url(m: Member) -> str:
    version = int(m.updated_at.timestamp()) if m.updated_at else 0
    return f"/api/members/{m.member_id}/photo?v={version}"


def _unpaid_by_member(db: Session, member_ids=None) -> dict:
    """학생 ID → (미납 합계, 미납 건수). 미납 정의: 상태가 UNPAID 인 청구서"""
    query = (db.query(Invoice.member_id, func.coalesce(func.sum(Invoice.amount), 0), func.count(Invoice.invoice_id))
               .filter(Invoice.status == "UNPAID"))
    if member_ids is not None:
        if not member_ids:
            return {}
        query = query.filter(Invoice.member_id.in_(list(member_ids)))
    return {mid: (int(total), int(cnt)) for mid, total, cnt in query.group_by(Invoice.member_id).all()}


def _member_out(m: Member, has_photo: bool, unpaid: tuple = (0, 0)) -> dict:
    """관리자 화면용 학생 정보. 사진은 base64 대신 사진 URL 로 내려 줍니다."""
    return {
        "unpaid_amount": unpaid[0], "unpaid_count": unpaid[1],
        "member_id": m.member_id, "name": m.name, "gender": m.gender, "age": m.age,
        "enrollment_date": m.enrollment_date, "withdrawal_date": m.withdrawal_date,
        "payment_date": m.payment_date, "father_name": m.father_name, "mother_name": m.mother_name,
        "father_phone": m.father_phone, "mother_phone": m.mother_phone, "address": m.address,
        "status": m.status or "ACTIVE",
        "photo_url": _member_photo_url(m) if has_photo else None,
    }


_HAS_PHOTO = (func.coalesce(func.length(Member.photo_url), 0) > 0).label("has_photo")


def _resolve_member_photo(value: Optional[str], current: Optional[str]) -> Optional[str]:
    """요청의 photo_url 해석: 빈 값=사진 삭제, 기존 사진 URL=그대로 유지, data URL=새 사진"""
    value = (value or "").strip()
    if not value:
        return None
    if value.startswith("/api/members/"):
        return current
    mime, body = _parse_image_data_url(value, MEMBER_PHOTO_MAX_CHARS, "학생 사진")
    return f"data:{mime};base64,{body}"


@app.get("/api/members", response_model=List[MemberOut])
def list_members(
    status: Optional[str] = None,
    q: Optional[str] = None,                  # 이름 검색
    class_id: Optional[int] = None,           # 수업별 필터 (해당 수업 수강자만)
    db: Session = Depends(get_db),
):
    # [PERF] 사진(base64) 컬럼은 읽지 않고 '사진 있음' 여부만 계산
    query = db.query(Member).options(defer(Member.photo_url))
    if status:
        query = query.filter(Member.status == status)
    if q and q.strip():
        # [FIX] LIKE 와일드카드(%, _) 이스케이프 — 사용자 입력이 패턴으로 해석되지 않도록
        q = q.strip()
        safe = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{safe}%"
        conditions = [Member.name.like(pattern, escape="\\"), Member.father_name.like(pattern, escape="\\"),
                      Member.mother_name.like(pattern, escape="\\")]
        digits = re.sub(r"\D", "", q)
        if len(digits) >= 3:   # 전화번호 일부(뒤 4자리 등)로도 검색
            conditions += [_digits_expr(Member.father_phone).like(f"%{digits}%"),
                           _digits_expr(Member.mother_phone).like(f"%{digits}%")]
        query = query.filter(or_(*conditions))
    if class_id:
        query = query.join(Enrollment, Enrollment.member_id == Member.member_id) \
                     .filter(Enrollment.class_id == class_id)
    rows = query.add_columns(_HAS_PHOTO).order_by(Member.member_id).all()
    unpaid = _unpaid_by_member(db)
    return [_member_out(m, has_photo, unpaid.get(m.member_id, (0, 0))) for m, has_photo in rows]


@app.get("/api/enrollments/by-member")
def enrollment_class_names(db: Session = Depends(get_db)):
    """[PERF] 학생별 수강 수업 이름 맵 {member_id: [수업명]} — 학생 수만큼 호출하던 N+1 대체"""
    rows = (db.query(Enrollment.member_id, Class.name)
              .join(Class, Class.class_id == Enrollment.class_id)
              .order_by(Enrollment.member_id, Class.class_id).all())
    result: dict = {}
    for member_id, class_name in rows:
        result.setdefault(member_id, []).append(class_name)
    return result


@app.get("/api/members/{member_id}", response_model=MemberOut)
def get_member(member_id: int, db: Session = Depends(get_db)):
    m = db.query(Member).filter(Member.member_id == member_id).first()
    if not m:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    return _member_out(m, bool(m.photo_url), _unpaid_by_member(db, [member_id]).get(member_id, (0, 0)))


# ---------- v8.1 상담·특이사항 기록 (기존 '특이사항 저장'은 서버에 저장되지 않던 문제) ----------
class MemberNoteCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


def _note_out(n: MemberNote) -> dict:
    return {"note_id": n.note_id, "member_id": n.member_id, "author": n.author, "content": n.content,
            "created_at": n.created_at.isoformat() if n.created_at else None}


@app.get("/api/members/{member_id}/notes")
def list_member_notes(member_id: int, db: Session = Depends(get_db)):
    rows = (db.query(MemberNote).filter(MemberNote.member_id == member_id)
              .order_by(MemberNote.created_at.desc(), MemberNote.note_id.desc()).limit(100).all())
    return [_note_out(n) for n in rows]


@app.post("/api/members/{member_id}/notes", status_code=201)
def create_member_note(member_id: int, payload: MemberNoteCreate, request: Request, db: Session = Depends(get_db)):
    if not db.query(Member.member_id).filter(Member.member_id == member_id).first():
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    actor_type, actor_id, actor_name = _actor(request)
    note = MemberNote(member_id=member_id, author=actor_name[:100], content=payload.content.strip())
    db.add(note)
    _log(db, actor_type, actor_id, "member.note", "member", member_id, "상담 기록 작성")
    db.commit(); db.refresh(note)
    return _note_out(note)


@app.delete("/api/member-notes/{note_id}", status_code=204)
def delete_member_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(MemberNote).filter(MemberNote.note_id == note_id).first()
    if not note:
        raise HTTPException(404, "기록을 찾을 수 없습니다.")
    db.delete(note); db.commit()


# ---------- v8.1 학부모에게 알림 보내기 (미납 안내 등 — 기존에는 '전송됨' 창만 뜨고 실제 전송 없음) ----------
class MemberNotifyRequest(BaseModel):
    title: str = Field("안내", max_length=100)
    message: str = Field(min_length=1, max_length=1000)
    kind: str = "UNPAID"


@app.post("/api/members/{member_id}/notify")
def notify_member_parents(member_id: int, payload: MemberNotifyRequest, request: Request, db: Session = Depends(get_db)):
    member = db.query(Member.member_id, Member.name).filter(Member.member_id == member_id).first()
    if not member:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    kind = payload.kind if payload.kind in NOTIFICATION_KINDS else "UNPAID"
    sent = _notify_parents(db, [member_id], kind, payload.title.strip() or "안내", payload.message.strip(),
                           link="pay" if kind == "UNPAID" else "children")
    actor_type, actor_id, _ = _actor(request)
    _log(db, actor_type, actor_id, "member.notify", "member", member_id, f"학부모 알림 {sent}건")
    db.commit()
    return {"sent": sent, "message": f"{member.name} 학생 학부모 {sent}명에게 보냈습니다." if sent else
            "연결된 학부모 계정이 없어 보내지 못했습니다. 학부모가 포털에서 자녀를 연결하면 알림을 받을 수 있습니다."}


@app.get("/api/members/{member_id}/photo")
def get_member_photo(member_id: int, db: Session = Depends(get_db)):
    """학생 사진 (관리자 전용 — 미들웨어가 보호). URL 의 v= 값이 바뀌면 새 사진"""
    photo = db.query(Member.photo_url).filter(Member.member_id == member_id).scalar()
    if not photo:
        raise HTTPException(404, "사진이 없습니다.")
    match = _IMAGE_DATA_URL_RE.match(photo.strip())
    if not match:
        raise HTTPException(404, "사진 형식을 읽을 수 없습니다.")
    mime = "image/jpeg" if match.group(1) == "image/jpg" else match.group(1)
    return _image_response(mime, re.sub(r"\s", "", match.group(2)))


@app.post("/api/members", response_model=MemberOut, status_code=201)
def create_member(payload: MemberCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    data["photo_url"] = _resolve_member_photo(data.get("photo_url"), None)
    m = Member(**data)
    db.add(m); db.commit(); db.refresh(m)
    return _member_out(m, bool(m.photo_url))


@app.delete("/api/members/{member_id}", status_code=204)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    """학생 삭제. PostgreSQL 은 외래키를 강제하므로 연결된 출결·수강·미납 청구서를 먼저 지웁니다.
    결제 기록이 있는 학생은 회계 기록 보존을 위해 삭제하지 않고 '퇴원' 처리를 안내합니다."""
    m = db.query(Member).filter(Member.member_id == member_id).first()
    if not m:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    has_payment_record = (
        db.query(Payment.payment_id).filter(Payment.member_id == member_id).first()
        or db.query(Invoice.invoice_id).filter(Invoice.member_id == member_id, Invoice.status == "PAID").first()
        or db.query(PaymentPending.partner_order_id).filter(PaymentPending.member_id == member_id,
                                                            PaymentPending.status == "APPROVED").first()
    )
    if has_payment_record:
        raise HTTPException(409, "결제 기록이 있는 학생은 삭제할 수 없습니다. 학생 정보 수정에서 상태를 '퇴원'으로 바꿔 주세요(결제 기록 보존).")
    for model in (Attendance, Enrollment, Invoice, PaymentPending, ParentLink):
        db.query(model).filter(model.member_id == member_id).delete(synchronize_session=False)
    db.delete(m); db.commit()


@app.put("/api/members/{member_id}", response_model=MemberOut)
def update_member(member_id: int, payload: MemberUpdate, db: Session = Depends(get_db)):
    m = db.query(Member).filter(Member.member_id == member_id).first()
    if not m:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    data = payload.model_dump()
    data["photo_url"] = _resolve_member_photo(data.get("photo_url"), m.photo_url)
    for key, value in data.items():
        setattr(m, key, value)
    db.commit(); db.refresh(m)
    return _member_out(m, bool(m.photo_url), _unpaid_by_member(db, [member_id]).get(member_id, (0, 0)))


# ---------------------------------------------------------------------
# 출결 (attendances) API
# ---------------------------------------------------------------------
def _att_to_out(a: Attendance, member_name: Optional[str] = None) -> dict:
    return {
        "attendance_id": a.attendance_id,
        "member_id": a.member_id,
        "member_name": member_name if member_name is not None else (a.member.name if a.member else None),
        "attendance_date": a.attendance_date,
        "status": a.status,
        "check_in_time":  a.check_in_time.strftime("%H:%M")  if a.check_in_time  else None,
        "check_out_time": a.check_out_time.strftime("%H:%M") if a.check_out_time else None,
        "note": a.note,
    }


@app.get("/api/attendances", response_model=List[AttendanceOut])
def list_attendances(
    target_date: Optional[date] = Query(None, description="조회 기준일"),
    member_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    # [PERF] 행마다 member 를 지연 로딩(사진 base64 포함)하던 N+1 → 이름 컬럼만 JOIN
    query = db.query(Attendance, Member.name).outerjoin(Member, Member.member_id == Attendance.member_id)
    if target_date:
        query = query.filter(Attendance.attendance_date == target_date)
    if member_id:
        query = query.filter(Attendance.member_id == member_id)
    rows = query.order_by(Attendance.attendance_date.desc(),
                          Attendance.check_in_time.asc()).all()
    return [_att_to_out(a, name) for a, name in rows]


@app.post("/api/attendances", response_model=AttendanceOut, status_code=201)
def create_attendance(payload: AttendanceCreate, request: Request, db: Session = Depends(get_db)):
    member = db.query(Member).filter(Member.member_id == payload.member_id).first()
    if not member:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")

    # 같은 날 같은 회원 중복 방지 (DB UNIQUE 제약과 이중 방어)
    exists = (
        db.query(Attendance)
        .filter(Attendance.member_id == payload.member_id,
                Attendance.attendance_date == payload.attendance_date)
        .first()
    )
    if exists:
        raise HTTPException(400, "해당 날짜에 이미 출결 기록이 있습니다.")
    if payload.status not in ATTENDANCE_STATUSES:
        raise HTTPException(400, "출결 상태는 PRESENT / LATE / ABSENT 중 하나여야 합니다.")

    a = Attendance(
        member_id=payload.member_id,
        attendance_date=payload.attendance_date,
        status=payload.status,
        check_in_time=_parse_time(payload.check_in_time),    # [FIX] 문자열 → time 변환
        check_out_time=_parse_time(payload.check_out_time),  # [FIX]
        note=payload.note,
    )
    db.add(a)
    actor_type, actor_id, _ = _actor(request)
    _after_attendance_change(db, member, a, None, actor_type, actor_id)
    db.commit(); db.refresh(a)
    return _att_to_out(a)


@app.delete("/api/attendances/{attendance_id}", status_code=204)
def delete_attendance(attendance_id: int, db: Session = Depends(get_db)):
    a = db.query(Attendance).filter(Attendance.attendance_id == attendance_id).first()
    if not a:
        raise HTTPException(404, "출결 기록을 찾을 수 없습니다.")
    db.delete(a); db.commit()


# =====================================================================
# v8.1 수업 시간표 · 출결 처리 공통 (키오스크·출석 화면 공용)
#   출결은 "학생 1명 × 하루 1건"(시설 출입 기준)으로 기록합니다. 여러 반을 듣는 학생도 하루 1번만 체크.
# =====================================================================
ATTENDANCE_STATUSES = ("PRESENT", "LATE", "ABSENT")
STATUS_KO = {"PRESENT": "출석", "LATE": "지각", "ABSENT": "결석"}
WEEKDAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
_KO_DAY = {"월": "MON", "화": "TUE", "수": "WED", "목": "THU", "금": "FRI", "토": "SAT", "일": "SUN",
           "매일": "DAILY", "DAILY": "DAILY"}


def _normalize_day(day: str) -> str:
    day = (day or "").strip().upper()
    return _KO_DAY.get(day, _KO_DAY.get((day or "").strip(), day))


def _class_schedule(c: "Class") -> List[dict]:
    """수업의 요일별 시간 [{"day":"MON","start":"14:00","end":"15:00"}]. 'DAILY' 는 매일."""
    if c.schedule_detail:
        try:
            items = json.loads(c.schedule_detail)
            out = [{"day": _normalize_day(i.get("day")), "start": i.get("start") or "", "end": i.get("end") or ""}
                   for i in items if isinstance(i, dict) and i.get("day")]
            if out:
                return out
        except (ValueError, TypeError):
            pass
    start = c.start_time.strftime("%H:%M") if c.start_time else ""
    end = c.end_time.strftime("%H:%M") if c.end_time else ""
    return [{"day": _normalize_day(d), "start": start, "end": end}
            for d in (c.days_of_week or "").split(",") if d.strip()]


def _sessions_on(c: "Class", day: date) -> List[dict]:
    """해당 날짜에 열리는 수업 시간 (운영 기간 밖이면 빈 목록)"""
    if (c.start_date and day < c.start_date) or (c.end_date and day > c.end_date):
        return []
    code = WEEKDAY_CODES[day.weekday()]
    return [s for s in _class_schedule(c) if s["day"] in (code, "DAILY")]


def _member_sessions_today(db: Session, member_id: int, day: date) -> List[dict]:
    rows = (db.query(Class).join(Enrollment, Enrollment.class_id == Class.class_id)
              .filter(Enrollment.member_id == member_id).all())
    sessions = []
    for c in rows:
        for sess in _sessions_on(c, day):
            sessions.append({"class_id": c.class_id, "class_name": c.name, **sess})
    return sorted(sessions, key=lambda x: x["start"] or "99:99")


def _auto_check_in_status(db: Session, member_id: int, now: datetime) -> str:
    """키오스크 등원 시 출석/지각 자동 판정: 오늘 가장 이른 수업 시작 + 유예시간이 지났으면 지각"""
    grace = int(_brand(db).get("lateGraceMinutes") or 10)
    for sess in _member_sessions_today(db, member_id, now.date()):
        if not sess["start"]:
            continue
        hh, mm = map(int, sess["start"].split(":"))
        start_at = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        end_at = start_at + timedelta(hours=3)
        if sess["end"]:
            eh, em = map(int, sess["end"].split(":"))
            end_at = now.replace(hour=eh, minute=em, second=0, microsecond=0)
        if now <= start_at + timedelta(minutes=grace):
            return "PRESENT"
        if now <= end_at:
            return "LATE"
    return "PRESENT"


def _after_attendance_change(db: Session, member: Member, row: Attendance, before: Optional[str],
                             actor_type: str, actor_id: Optional[int]) -> None:
    """출결이 바뀌면 동작 로그 + (오늘 기록이면) 학부모 알림"""
    _log(db, actor_type, actor_id, "attendance.mark", "member", member.member_id,
         f"{row.attendance_date} {STATUS_KO.get(row.status, row.status)}")
    if row.attendance_date != _today() or before == row.status:
        return
    at = row.check_in_time.strftime("%H:%M") if row.check_in_time else _now().strftime("%H:%M")
    if row.status == "PRESENT":
        _notify_parents(db, [member.member_id], "CHECK_IN", f"{member.name} 학생 등원", f"{at}에 안전하게 등원했습니다.", "children")
    elif row.status == "LATE":
        _notify_parents(db, [member.member_id], "CHECK_IN", f"{member.name} 학생 등원(지각)", f"{at}에 등원했습니다.", "children")
    elif row.status == "ABSENT":
        _notify_parents(db, [member.member_id], "ABSENT", f"{member.name} 학생 결석",
                        "오늘 결석으로 처리되었습니다. 사정이 있으시면 시설로 연락 주세요.", "children")


def _mark_attendance(db: Session, member: Member, day: date, status: str, actor_type: str,
                     actor_id: Optional[int], note: Optional[str] = None) -> Attendance:
    """출결 저장(있으면 변경, 없으면 생성) — 상태 변경 시 삭제 후 재생성하던 2회 요청을 1회로"""
    if status not in ATTENDANCE_STATUSES:
        raise HTTPException(400, "출결 상태는 PRESENT / LATE / ABSENT 중 하나여야 합니다.")
    row = db.query(Attendance).filter(Attendance.member_id == member.member_id, Attendance.attendance_date == day).first()
    before = row.status if row else None
    if not row:
        row = Attendance(member_id=member.member_id, attendance_date=day)
        db.add(row)
    row.status = status
    if status == "ABSENT":
        row.check_in_time = row.check_out_time = None
    elif not row.check_in_time:
        row.check_in_time = _now().time().replace(second=0, microsecond=0) if day == _today() else None
    if note is not None:
        row.note = note[:200] or None
    db.flush()
    _after_attendance_change(db, member, row, before, actor_type, actor_id)
    return row


class AttendanceMark(BaseModel):
    member_id: int
    attendance_date: date
    status: str = Field(max_length=10)
    note: Optional[str] = Field(None, max_length=200)


class AttendanceBulk(BaseModel):
    attendance_date: date
    member_ids: List[int] = Field(max_length=500)
    status: str = Field(max_length=10)
    only_unchecked: bool = True


@app.post("/api/attendances/mark", response_model=AttendanceOut)
def mark_attendance(payload: AttendanceMark, request: Request, db: Session = Depends(get_db)):
    member = db.query(Member).filter(Member.member_id == payload.member_id).first()
    if not member:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    actor_type, actor_id, _ = _actor(request)
    row = _mark_attendance(db, member, payload.attendance_date, payload.status, actor_type, actor_id, payload.note)
    db.commit(); db.refresh(row)
    return _att_to_out(row, member.name)


@app.post("/api/attendances/bulk")
def bulk_attendance(payload: AttendanceBulk, request: Request, db: Session = Depends(get_db)):
    """미체크 전원 출석 / 출석 마감(결석) — 학생 수만큼 보내던 요청을 1회로"""
    if payload.status not in ATTENDANCE_STATUSES:
        raise HTTPException(400, "출결 상태는 PRESENT / LATE / ABSENT 중 하나여야 합니다.")
    members = db.query(Member).filter(Member.member_id.in_(payload.member_ids or [-1]), Member.status == "ACTIVE").all()
    checked = {mid for (mid,) in db.query(Attendance.member_id).filter(
        Attendance.attendance_date == payload.attendance_date, Attendance.member_id.in_([m.member_id for m in members] or [-1]))}
    actor_type, actor_id, _ = _actor(request)
    changed = 0
    for member in members:
        if payload.only_unchecked and member.member_id in checked:
            continue
        _mark_attendance(db, member, payload.attendance_date, payload.status, actor_type, actor_id)
        changed += 1
    db.commit()
    return {"changed": changed, "skipped": len(members) - changed}


@app.post("/api/attendances/{attendance_id}/checkout", response_model=AttendanceOut)
def checkout_attendance(attendance_id: int, request: Request, db: Session = Depends(get_db)):
    row = db.query(Attendance).filter(Attendance.attendance_id == attendance_id).first()
    if not row:
        raise HTTPException(404, "출결 기록을 찾을 수 없습니다.")
    member = db.query(Member).filter(Member.member_id == row.member_id).first()
    actor_type, actor_id, _ = _actor(request)
    _check_out(db, member, row, actor_type, actor_id)
    db.commit(); db.refresh(row)
    return _att_to_out(row, member.name)


def _check_out(db: Session, member: Member, row: Attendance, actor_type: str, actor_id: Optional[int]) -> None:
    if row.status == "ABSENT":
        raise HTTPException(409, "결석 처리된 학생은 하원 처리할 수 없습니다.")
    if row.check_out_time:
        raise HTTPException(409, "이미 하원 처리되었습니다.")
    row.check_out_time = _now().time().replace(second=0, microsecond=0)
    _log(db, actor_type, actor_id, "attendance.checkout", "member", member.member_id, f"{row.attendance_date} 하원")
    if row.attendance_date == _today():
        _notify_parents(db, [member.member_id], "CHECK_OUT", f"{member.name} 학생 하원",
                        f"{row.check_out_time.strftime('%H:%M')}에 하원했습니다.", "children")


# ---------------------------------------------------------------------
# v8.1 출석 키오스크 — 태블릿에서 보호자 연락처 뒤 4자리 → 등원/하원 (관리자·직원 세션으로 연 화면)
#   이름은 가려서(김*준) 보여 주고, 학부모에게 즉시 알림이 갑니다.
# ---------------------------------------------------------------------
class KioskCheck(BaseModel):
    member_id: int
    action: str = Field(max_length=5)   # in / out


def _kiosk_member_out(db: Session, m: Member, today_row: Optional[Attendance], class_names: List[str]) -> dict:
    status = today_row.status if today_row else None
    next_action = "in" if not today_row or status == "ABSENT" else ("done" if today_row.check_out_time else "out")
    return {
        "member_id": m.member_id, "masked_name": _mask_name(m.name), "classes": class_names,
        "today_status": status,
        "check_in_time": today_row.check_in_time.strftime("%H:%M") if today_row and today_row.check_in_time else None,
        "check_out_time": today_row.check_out_time.strftime("%H:%M") if today_row and today_row.check_out_time else None,
        "next_action": next_action,
    }


@app.get("/api/kiosk/lookup")
def kiosk_lookup(digits: str = Query(..., min_length=4, max_length=4), db: Session = Depends(get_db)):
    if not digits.isdigit():
        raise HTTPException(400, "숫자 4자리를 입력하세요.")
    members = (db.query(Member).options(defer(Member.photo_url))
                 .filter(Member.status == "ACTIVE",
                         or_(_digits_expr(Member.father_phone).like(f"%{digits}"),
                             _digits_expr(Member.mother_phone).like(f"%{digits}")))
                 .order_by(Member.name).limit(10).all())
    ids = [m.member_id for m in members]
    today_rows = {a.member_id: a for a in db.query(Attendance).filter(
        Attendance.attendance_date == _today(), Attendance.member_id.in_(ids or [-1]))}
    class_map: dict = {}
    for member_id, name in (db.query(Enrollment.member_id, Class.name).join(Class, Class.class_id == Enrollment.class_id)
                              .filter(Enrollment.member_id.in_(ids or [-1])).all()):
        class_map.setdefault(member_id, []).append(name)
    return [_kiosk_member_out(db, m, today_rows.get(m.member_id), class_map.get(m.member_id, [])) for m in members]


@app.post("/api/kiosk/check")
def kiosk_check(payload: KioskCheck, request: Request, db: Session = Depends(get_db)):
    member = db.query(Member).filter(Member.member_id == payload.member_id, Member.status == "ACTIVE").first()
    if not member:
        raise HTTPException(404, "학생을 찾을 수 없습니다.")
    actor_id = getattr(request.state, "account", None) and request.state.account.account_id
    today = _today()
    row = db.query(Attendance).filter(Attendance.member_id == member.member_id, Attendance.attendance_date == today).first()
    if payload.action == "in":
        if row and row.status in ("PRESENT", "LATE"):
            raise HTTPException(409, f"{_mask_name(member.name)} 학생은 이미 {row.check_in_time.strftime('%H:%M') if row.check_in_time else ''} 등원했습니다.")
        status = _auto_check_in_status(db, member.member_id, _now())
        row = _mark_attendance(db, member, today, status, "kiosk", actor_id)
        message = f"{_mask_name(member.name)} 학생 {'등원 완료' if status == 'PRESENT' else '등원 (지각)'}"
    elif payload.action == "out":
        if not row or row.status == "ABSENT":
            raise HTTPException(409, "오늘 등원 기록이 없습니다. 먼저 등원을 눌러 주세요.")
        _check_out(db, member, row, "kiosk", actor_id)
        message = f"{_mask_name(member.name)} 학생 하원 완료"
    else:
        raise HTTPException(400, "action 은 in 또는 out 이어야 합니다.")
    db.commit(); db.refresh(row)
    return {**_kiosk_member_out(db, member, row, []), "message": message,
            "parent_notified": bool(_parent_user_ids(db, [member.member_id]))}


@app.get("/api/kiosk/today")
def kiosk_today(db: Session = Depends(get_db)):
    today = _today()
    rows = db.query(Attendance).filter(Attendance.attendance_date == today).all()
    checked_in = sum(1 for a in rows if a.status in ("PRESENT", "LATE"))
    checked_out = sum(1 for a in rows if a.check_out_time)
    recent = (db.query(Attendance, Member.name).join(Member, Member.member_id == Attendance.member_id)
                .filter(Attendance.attendance_date == today, Attendance.status != "ABSENT")
                .order_by(func.coalesce(Attendance.check_out_time, Attendance.check_in_time).desc()).limit(6).all())
    active = db.query(func.count(Member.member_id)).filter(Member.status == "ACTIVE").scalar() or 0
    return {"brand": _brand(db), "date": today.isoformat(), "active_members": int(active),
            "checked_in": checked_in, "checked_out": checked_out,
            "recent": [{"masked_name": _mask_name(name), "status": a.status,
                        "time": (a.check_out_time or a.check_in_time).strftime("%H:%M") if (a.check_out_time or a.check_in_time) else None,
                        "action": "out" if a.check_out_time else "in"} for a, name in recent]}


# ---------------------------------------------------------------------
# 결제 (payments) API
# ---------------------------------------------------------------------
def _payment_to_out(p: Payment, member_name: Optional[str] = None) -> dict:
    return {
        "payment_id": p.payment_id,
        "member_id":  p.member_id,
        "member_name": member_name if member_name is not None else (p.member.name if p.member else None),
        "amount":     p.amount,
        "paid_at":    p.paid_at,
        "payment_type": p.payment_type,
        "method":     p.method,
        "note":       p.note,
    }


@app.get("/api/payments", response_model=List[PaymentOut])
def list_payments(
    member_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Payment, Member.name).outerjoin(Member, Member.member_id == Payment.member_id)
    if member_id:
        query = query.filter(Payment.member_id == member_id)
    rows = query.order_by(Payment.paid_at.desc()).all()
    return [_payment_to_out(p, name) for p, name in rows]


# [ADD] 결제 등록 — 대시보드 매출/미납 통계가 의존하므로 쓰기 경로 추가
@app.post("/api/payments", response_model=PaymentOut, status_code=201)
def create_payment(payload: PaymentCreate, db: Session = Depends(get_db)):
    m = db.query(Member).filter(Member.member_id == payload.member_id).first()
    if not m:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    p = Payment(**payload.model_dump())
    db.add(p)
    # 회원의 최근 납부일 갱신 (미납 통계가 일관되도록)
    if m.payment_date is None or payload.paid_at > m.payment_date:
        m.payment_date = payload.paid_at
    db.commit(); db.refresh(p)
    return _payment_to_out(p)


# =====================================================================
# 카카오페이 단건결제 (원격결제)
#   KakaoPay 온라인 결제 API : https://open-api.kakaopay.com
#   인증 헤더 : Authorization: SECRET_KEY {KAKAO_SECRET_KEY}
#   흐름 : ready(준비) → 사용자 결제 → success(승인) 순서로 진행됩니다.
#
#   ⚠️ 보안: 시크릿 키는 절대 소스/저장소에 하드코딩하지 마세요.
#            반드시 환경변수 KAKAO_SECRET_KEY 로만 주입합니다.
#            (CID 'TC0ONETIME' 은 테스트용 공개 식별자라 기본값으로 둡니다.)
# =====================================================================
KAKAO_SECRET_KEY = os.getenv("KAKAO_SECRET_KEY", "")
KAKAO_CID = os.getenv("KAKAO_CID", "TC0ONETIME")
KAKAO_API_BASE = os.getenv("KAKAO_API_BASE", "https://open-api.kakaopay.com")

# 카카오페이가 결제 후 사용자를 돌려보낼 주소들. 비워 두면 요청이 들어온 주소(예: https://내앱.vercel.app)를 사용
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "").strip()
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "").strip()


def _kakao_headers():
    if not KAKAO_SECRET_KEY:
        raise HTTPException(
            503, "카카오페이가 설정되지 않았습니다. 서버에 KAKAO_SECRET_KEY 환경변수를 설정하세요.")
    return {
        "Authorization": f"SECRET_KEY {KAKAO_SECRET_KEY}",
        "Content-Type": "application/json",
    }


class KakaoReadyRequest(BaseModel):
    member_id: int
    amount: int
    item_name: str = "수강료"
    payment_type: str = "TUITION"
    invoice_id: Optional[int] = None   # [PAY] 청구서 연결 시 결제 성공하면 PAID 처리


@app.get("/api/payments/kakao/status")
def kakao_status():
    """프론트가 카카오페이 사용 가능 여부를 미리 확인하는 헬스 체크"""
    return {"enabled": bool(KAKAO_SECRET_KEY), "cid": KAKAO_CID}


def _kakao_ready_core(db: Session, request: Request, member: Member, amount: int, item_name: str, payment_type: str,
                      invoice_id: Optional[int], partner_user_id: str) -> dict:
    """결제 준비 공통 로직. 금액·항목은 호출 측에서 서버 데이터로 확정해 넘깁니다."""
    if amount <= 0:
        raise HTTPException(400, "결제 금액이 올바르지 않습니다.")
    headers = _kakao_headers()   # 키가 없으면 여기서 503 (DB 를 건드리기 전에)
    base = _public_base_url(request, BACKEND_BASE_URL)
    if invoice_id:
        # 같은 청구서로 열려 있던 이전 결제창은 무효화 → 두 창에서 각각 승인되는 이중 결제 방지
        db.query(PaymentPending).filter(PaymentPending.invoice_id == invoice_id,
                                        PaymentPending.status == "READY").update(
            {"status": "CANCELED"}, synchronize_session=False)
    partner_order_id = f"order_{uuid.uuid4().hex}"
    body = {
        "cid": KAKAO_CID,
        "partner_order_id": partner_order_id,
        "partner_user_id": partner_user_id,
        "item_name": item_name,
        "quantity": 1,
        "total_amount": amount,
        "tax_free_amount": 0,
        # 승인 후 카카오페이가 pg_token 을 붙여 이 주소로 리다이렉트합니다.
        "approval_url": f"{base}/api/payments/kakao-success?order_id={partner_order_id}",
        "cancel_url":   f"{base}/api/payments/kakao-cancel?order_id={partner_order_id}",
        "fail_url":     f"{base}/api/payments/kakao-fail?order_id={partner_order_id}",
    }
    try:
        resp = requests.post(f"{KAKAO_API_BASE}/online/v1/payment/ready",
                             json=body, headers=headers, timeout=10)
    except requests.RequestException as e:
        db.rollback()
        logger.error("KakaoPay ready 통신 오류: %s", e)
        raise HTTPException(502, "카카오페이 결제 준비 중 오류가 발생했습니다.")
    if resp.status_code != 200:
        db.rollback()
        logger.error("KakaoPay ready 실패 %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(502, "카카오페이 결제 준비에 실패했습니다.")

    data = resp.json()
    db.add(PaymentPending(
        partner_order_id=partner_order_id, tid=data["tid"], member_id=member.member_id,
        partner_user_id=partner_user_id, invoice_id=invoice_id, amount=amount,
        item_name=item_name, payment_type=payment_type, status="READY",
    ))
    db.commit()
    return {
        "tid": data["tid"],
        "partner_order_id": partner_order_id,
        "next_redirect_pc_url": data.get("next_redirect_pc_url"),
        "next_redirect_mobile_url": data.get("next_redirect_mobile_url"),
        "next_redirect_app_url": data.get("next_redirect_app_url"),
    }


@app.post("/api/payments/kakao-ready")
def kakao_ready(payload: KakaoReadyRequest, request: Request, db: Session = Depends(get_db),
                account: AdminAccount = Depends(owner_account)):
    """관리자 원격결제 준비. 청구서가 연결되면 금액·항목은 청구서 값으로 확정합니다."""
    member = db.query(Member).filter(Member.member_id == payload.member_id).first()
    if not member:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    item_name, payment_type, amount = payload.item_name, payload.payment_type, payload.amount
    if payload.invoice_id:
        invoice = db.query(Invoice).filter(
            Invoice.invoice_id == payload.invoice_id,
            Invoice.member_id == payload.member_id,
            Invoice.status == "UNPAID",
        ).first()
        if not invoice:
            raise HTTPException(400, "미납 청구서를 확인할 수 없습니다.")
        item_name, payment_type, amount = invoice.item_name, "TUITION", invoice.amount
    return _kakao_ready_core(db, request, member, amount, item_name, payment_type, payload.invoice_id,
                             partner_user_id=f"admin{account.account_id}_member{member.member_id}")


def _payment_result_path(partner_user_id: str) -> str:
    """결제 결과를 보여줄 프론트 화면: 관리자가 시작한 결제는 관리자 원격결제 화면으로"""
    return "/admin-checkout" if (partner_user_id or "").startswith("admin") else "/checkout"


def _approve_b2b_kakao_payment(order_id: str, pg_token: str, db: Session, front: str):
    pending = db.query(B2BPaymentPending).filter(
        B2BPaymentPending.partner_order_id == order_id
    ).with_for_update().first()
    if not pending:
        return None
    order = db.query(B2BOrder).filter(B2BOrder.order_id == pending.order_id).first()
    if pending.status != "READY" or not order:
        return RedirectResponse(f"{front}/b2b-shop?payment=fail&reason=already")
    body = {
        "cid": KAKAO_CID,
        "tid": pending.tid,
        "partner_order_id": order_id,
        "partner_user_id": f"account_{pending.account_id}",
        "pg_token": pg_token,
    }
    try:
        payment_response = requests.post(f"{KAKAO_API_BASE}/online/v1/payment/approve", json=body, headers=_kakao_headers(), timeout=10)
    except requests.RequestException as exc:
        logger.error("B2B KakaoPay approve 통신 오류: %s", exc)
        pending.status = "FAILED"
        db.commit()
        return RedirectResponse(f"{front}/b2b-shop?payment=fail&reason=network")
    if payment_response.status_code != 200:
        logger.error("B2B KakaoPay approve 실패 %s: %s", payment_response.status_code, payment_response.text)
        pending.status = "FAILED"
        db.commit()
        return RedirectResponse(f"{front}/b2b-shop?payment=fail&reason=approve")
    result = payment_response.json()
    pending.status = "APPROVED"
    order.status = "PAID"
    order.paid_at = _now()
    db.commit()
    return RedirectResponse(f"{front}/b2b-shop?payment=success&order_no={order.order_number}")


@app.get("/api/payments/kakao-success")
def kakao_success(request: Request, order_id: str = Query(..., max_length=64), pg_token: str = Query(..., max_length=100),
                  db: Session = Depends(get_db)):
    """2단계: 결제 승인. 승인 성공 시 결제 이력을 DB에 기록하고 납부일을 갱신합니다."""
    front = _public_base_url(request, FRONTEND_BASE_URL)
    b2b_result = _approve_b2b_kakao_payment(order_id, pg_token, db, front)
    if b2b_result:
        return b2b_result
    # 동시에 같은 콜백이 두 번 들어와도 한 번만 승인되도록 행 잠금
    pending = db.query(PaymentPending).filter(
        PaymentPending.partner_order_id == order_id).with_for_update().first()
    if not pending:
        # 주문 정보가 없는 경우 (잘못된 접근 등)
        return RedirectResponse(f"{front}/checkout?kakao=fail&reason=expired")
    result_url = f"{front}{_payment_result_path(pending.partner_user_id)}"
    if pending.status != "READY":
        # 이미 처리된 주문 — 중복 승인 방지
        return RedirectResponse(f"{result_url}?kakao=fail&reason=already")

    body = {
        "cid": KAKAO_CID,
        "tid": pending.tid,
        "partner_order_id": order_id,
        "partner_user_id": pending.partner_user_id,
        "pg_token": pg_token,
    }
    try:
        resp = requests.post(f"{KAKAO_API_BASE}/online/v1/payment/approve",
                             json=body, headers=_kakao_headers(), timeout=10)
    except requests.RequestException as e:
        logger.error("KakaoPay approve 통신 오류: %s", e)
        return RedirectResponse(f"{result_url}?kakao=fail&reason=network")

    if resp.status_code != 200:
        logger.error("KakaoPay approve 실패 %s: %s", resp.status_code, resp.text)
        pending.status = "FAILED"
        db.commit()
        return RedirectResponse(f"{result_url}?kakao=fail&reason=approve")

    result = resp.json()
    aid = result.get("aid", "")
    today = _today()

    # ✅ 결제 이력 기록 + 회원 납부일 갱신 (미납 상태 해제)
    member = db.query(Member).filter(Member.member_id == pending.member_id).first()
    if member:
        pay = Payment(
            member_id=member.member_id,
            amount=pending.amount,
            paid_at=today,
            payment_type=pending.payment_type,
            method="KAKAOPAY",
            note=f"카카오페이 결제 (tid={pending.tid}, aid={aid})",
        )
        db.add(pay)
        if member.payment_date is None or today > member.payment_date:
            member.payment_date = today

    # [PAY] 연결된 청구서가 있으면 완납 처리
    if pending.invoice_id:
        inv = db.query(Invoice).filter(Invoice.invoice_id == pending.invoice_id).first()
        if inv:
            inv.status = "PAID"

    pending.status = "APPROVED"
    # v8.1: 결제 완료 알림 (학부모 + 원장) · 동작 로그
    if member:
        _notify_parents(db, [member.member_id], "PAYMENT", f"{member.name} 학생 {pending.item_name} 결제 완료",
                        f"{pending.amount:,}원이 카카오페이로 결제되었습니다.", "pay")
        if not (pending.partner_user_id or "").startswith("admin"):
            _notify_admins(db, "PAYMENT", f"{member.name} 학생 학부모 결제 완료",
                           f"{pending.item_name} {pending.amount:,}원 (카카오페이)", "checkout", member.member_id)
    _log(db, "parent" if (pending.partner_user_id or "").startswith("parent") else "admin", None,
         "payment.kakao", "member", pending.member_id, f"{pending.amount:,}원 카카오페이")
    db.commit()
    return RedirectResponse(
        f"{result_url}?kakao=success"
        f"&member_id={pending.member_id}&amount={pending.amount}"
    )


@app.get("/api/payments/kakao-cancel")
def kakao_cancel(request: Request, order_id: str = Query(..., max_length=64), db: Session = Depends(get_db)):
    """사용자가 결제를 취소한 경우"""
    front = _public_base_url(request, FRONTEND_BASE_URL)
    pending = db.query(PaymentPending).filter(
        PaymentPending.partner_order_id == order_id).first()
    if pending and pending.status == "READY":
        pending.status = "CANCELED"
        db.commit()
    elif not pending:
        b2b_pending = db.query(B2BPaymentPending).filter(B2BPaymentPending.partner_order_id == order_id).first()
        if b2b_pending and b2b_pending.status == "READY":
            b2b_pending.status = "CANCELED"
            db.commit()
            return RedirectResponse(f"{front}/b2b-shop?payment=cancel")
    path = _payment_result_path(pending.partner_user_id) if pending else "/checkout"
    return RedirectResponse(f"{front}{path}?kakao=cancel")


@app.get("/api/payments/kakao-fail")
def kakao_fail(request: Request, order_id: str = Query(..., max_length=64), db: Session = Depends(get_db)):
    """결제가 실패한 경우"""
    front = _public_base_url(request, FRONTEND_BASE_URL)
    pending = db.query(PaymentPending).filter(
        PaymentPending.partner_order_id == order_id).first()
    if pending and pending.status == "READY":
        pending.status = "FAILED"
        db.commit()
    elif not pending:
        b2b_pending = db.query(B2BPaymentPending).filter(B2BPaymentPending.partner_order_id == order_id).first()
        if b2b_pending and b2b_pending.status == "READY":
            b2b_pending.status = "FAILED"
            db.commit()
            return RedirectResponse(f"{front}/b2b-shop?payment=fail")
    path = _payment_result_path(pending.partner_user_id) if pending else "/checkout"
    return RedirectResponse(f"{front}{path}?kakao=fail")


# ---- 결제 대기 현황 조회 / 정리 ----------------------------------------
def _pending_to_out(p: PaymentPending, names: dict) -> dict:
    return {
        "partner_order_id": p.partner_order_id,
        "tid": p.tid,
        "member_id": p.member_id,
        "member_name": names.get(p.member_id),
        "amount": p.amount,
        "item_name": p.item_name,
        "payment_type": p.payment_type,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@app.get("/api/payments/kakao/pending")
def list_kakao_pending(status: Optional[str] = None, db: Session = Depends(get_db)):
    """결제 대기/진행 현황 목록. status(READY/APPROVED/CANCELED/FAILED)로 필터 가능."""
    q = db.query(PaymentPending)
    if status:
        q = q.filter(PaymentPending.status == status)
    rows = q.order_by(PaymentPending.created_at.desc()).all()
    # [PERF] 전체 회원(사진 포함)을 읽던 방식 → 필요한 회원의 이름만 조회
    member_ids = {p.member_id for p in rows}
    names = dict(db.query(Member.member_id, Member.name).filter(Member.member_id.in_(member_ids)).all()) if member_ids else {}
    return [_pending_to_out(p, names) for p in rows]


@app.post("/api/payments/kakao/cleanup")
def cleanup_kakao_pending(
    terminal_older_than_minutes: int = Query(
        CLEANUP_TERMINAL_MINUTES, ge=1,
        description="종결 상태(FAILED/CANCELED/APPROVED) 정리 기준(분). 기본 60분"),
    ready_older_than_minutes: int = Query(
        CLEANUP_READY_MINUTES, ge=5,
        description="진행중(READY) 정리 기준(분). 느린 결제 보호를 위해 길게. 기본 1440분(24시간)"),
    db: Session = Depends(get_db),
):
    """오래된 결제 대기 레코드를 정리합니다(수동 실행).
    종결 상태는 짧은 타임아웃으로, 진행중(READY)은 별도의 긴 타임아웃으로 삭제하여
    아직 결제 중일 수 있는 느린 거래를 끊지 않습니다. (자동 정리는 1시간마다 실행)"""
    res = _cleanup_pending(db, terminal_older_than_minutes, ready_older_than_minutes)
    logger.info("결제 대기 정리(수동): %s", res)
    return res


# ---------------------------------------------------------------------
# 공지사항 (notices) API
# ---------------------------------------------------------------------
def _notice_to_out(n: Notice, class_names: Optional[dict] = None, read_counts: Optional[dict] = None,
                   target_counts: Optional[dict] = None) -> dict:
    return {
        "notice_id": n.notice_id,
        "title":     n.title,
        "content":   n.content,
        "author":    n.author,
        "category":  n.category,
        "is_pinned": bool(n.is_pinned),
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "class_id": n.class_id,
        "class_name": (class_names or {}).get(n.class_id) if n.class_id else None,
        "read_count": int((read_counts or {}).get(n.notice_id, 0)),
        "target_count": int((target_counts or {}).get(n.class_id or 0, 0)),
    }


def _notice_targets(db: Session) -> dict:
    """공지 대상 학부모 수: {0: 전체 공지 대상, class_id: 그 반 학부모 수}"""
    counts = {0: db.query(func.count(func.distinct(ParentLink.user_id))).scalar() or 0}
    for class_id, cnt in (db.query(Enrollment.class_id, func.count(func.distinct(ParentLink.user_id)))
                            .join(ParentLink, ParentLink.member_id == Enrollment.member_id)
                            .group_by(Enrollment.class_id).all()):
        counts[class_id] = cnt
    return counts


def _notices_out(db: Session, rows: List[Notice]) -> List[dict]:
    ids = [n.notice_id for n in rows]
    read_counts = dict(db.query(NoticeRead.notice_id, func.count(NoticeRead.read_id))
                         .filter(NoticeRead.notice_id.in_(ids or [-1])).group_by(NoticeRead.notice_id).all())
    class_names = dict(db.query(Class.class_id, Class.name).all())
    targets = _notice_targets(db)
    return [_notice_to_out(n, class_names, read_counts, targets) for n in rows]


def _validate_notice_class(db: Session, class_id: Optional[int]) -> Optional[str]:
    if not class_id:
        return None
    name = db.query(Class.name).filter(Class.class_id == class_id).scalar()
    if not name:
        raise HTTPException(404, "공지 대상 반을 찾을 수 없습니다.")
    return name


@app.get("/api/notices", response_model=List[NoticeOut])
def list_notices(class_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Notice)
    if class_id:
        query = query.filter(Notice.class_id == class_id)
    rows = query.order_by(Notice.is_pinned.desc(), Notice.created_at.desc(), Notice.notice_id.desc()).limit(300).all()
    return _notices_out(db, rows)


@app.post("/api/notices", response_model=NoticeOut, status_code=201)
def create_notice(payload: NoticeCreate, request: Request, db: Session = Depends(get_db)):
    class_name = _validate_notice_class(db, payload.class_id)
    n = Notice(**payload.model_dump(exclude={"notify_parents"}))
    if not payload.class_id:
        n.class_id = None
    db.add(n); db.flush()
    sent = 0
    if payload.notify_parents:
        title = f"[{class_name}] {n.title}" if class_name else f"[공지] {n.title}"
        body = n.content[:120]
        if class_name:
            member_ids = [mid for (mid,) in db.query(Enrollment.member_id).filter(Enrollment.class_id == n.class_id)]
            sent = _notify_parents(db, member_ids, "NOTICE", title, body, "notices")
        else:
            sent = _notify_all_parents(db, "NOTICE", title, body, "notices")
    actor_type, actor_id, _ = _actor(request)
    _log(db, actor_type, actor_id, "notice.create", "notice", n.notice_id, f"공지 등록 (알림 {sent}건)")
    db.commit(); db.refresh(n)
    return _notices_out(db, [n])[0]


@app.delete("/api/notices/{notice_id}", status_code=204)
def delete_notice(notice_id: int, db: Session = Depends(get_db)):
    n = db.query(Notice).filter(Notice.notice_id == notice_id).first()
    if not n:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다.")
    db.query(NoticeRead).filter(NoticeRead.notice_id == notice_id).delete(synchronize_session=False)
    db.delete(n); db.commit()

@app.put("/api/notices/{notice_id}", response_model=NoticeOut)
def update_notice(notice_id: int, payload: NoticeCreate, db: Session = Depends(get_db)):
    n = db.query(Notice).filter(Notice.notice_id == notice_id).first()
    if not n:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다.")
    _validate_notice_class(db, payload.class_id)
    n.title = payload.title
    n.content = payload.content
    n.author = payload.author
    n.category = payload.category
    n.is_pinned = payload.is_pinned
    n.class_id = payload.class_id or None
    db.commit()
    db.refresh(n)
    return _notices_out(db, [n])[0]


# ---------------------------------------------------------------------
# 커뮤니티 피드 (밴드 스타일) — 학부모 열람 / 원장 작성
# ---------------------------------------------------------------------
class CommunityPostCreate(BaseModel):
    content: str = Field("", max_length=10000)
    author: str = Field("관리자", max_length=50)
    photos: List[str] = []   # 새 사진: data URL (프론트가 줄여서 보냄)

class CommunityPostUpdate(BaseModel):
    content: str = Field("", max_length=10000)
    photos: List[str] = []   # 기존 사진은 받은 사진 URL 그대로, 새 사진은 data URL

class CommunityCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    author: str = Field("관리자", max_length=50)


_PHOTO_REF_RE = re.compile(r"^/api/(?:parent/)?community/photos/(\d+)$")


def _community_photo_path(photo_id: int, parent: bool) -> str:
    # 학부모 화면은 /api/parent/* 만 통과하므로 역할별로 경로를 나눠 줍니다(같은 사진).
    return f"/api/{'parent/' if parent else ''}community/photos/{photo_id}"


def _photo_mime(value: str) -> str:
    return "image/jpeg" if value == "image/jpg" else value


def _migrate_legacy_photos(db: Session, post_ids: List[int]) -> None:
    """v7 이전 게시물의 photos(JSON 문자열)를 community_photos 로 옮김 — 게시물당 한 번만 실행"""
    if not post_ids:
        return
    legacy = (db.query(CommunityPost)
                .filter(CommunityPost.post_id.in_(post_ids), CommunityPost.photos.isnot(None),
                        func.length(CommunityPost.photos) > 2)
                .with_for_update(skip_locked=True).all())
    if not legacy:
        return
    for post in legacy:
        try:
            items = json.loads(post.photos)
        except (ValueError, TypeError):
            items = []
        for position, item in enumerate(items if isinstance(items, list) else []):
            match = _IMAGE_DATA_URL_RE.match(item.strip()) if isinstance(item, str) else None
            if match:
                db.add(CommunityPhoto(post_id=post.post_id, position=position, mime_type=_photo_mime(match.group(1)),
                                      data=re.sub(r"\s", "", match.group(2))))
        post.photos = None
    db.commit()


def _photo_ids_by_post(db: Session, post_ids: List[int]) -> dict:
    result: dict = {}
    if post_ids:
        for photo_id, post_id in (db.query(CommunityPhoto.photo_id, CommunityPhoto.post_id)
                                    .filter(CommunityPhoto.post_id.in_(post_ids))
                                    .order_by(CommunityPhoto.post_id, CommunityPhoto.position, CommunityPhoto.photo_id)):
            result.setdefault(post_id, []).append(photo_id)
    return result


def _post_to_out(p: CommunityPost, photo_ids: List[int], parent: bool = False,
                 comment_count: int = 0, liked: bool = False) -> dict:
    return {
        "post_id": p.post_id,
        "author": p.author,
        "content": p.content,
        "photos": [_community_photo_path(pid, parent) for pid in photo_ids],
        "like_count": p.like_count or 0,
        "liked": liked,                     # v8.1: 내가 좋아요를 눌렀는지
        "comment_count": comment_count,     # v8.1: 보이는 댓글 수
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _visible_comment_filter():
    """학부모에게 보이는 댓글: 자동 검토 대상이 아니거나, 관리자가 승인한 댓글"""
    return or_(CommentReview.comment_id.is_(None),
               and_(CommentReview.flagged.is_(False), or_(CommentReview.decision.is_(None), CommentReview.decision != "HIDDEN")),
               CommentReview.decision == "APPROVED")


def _comment_counts(db: Session, post_ids: List[int]) -> dict:
    if not post_ids:
        return {}
    return dict(db.query(CommunityComment.post_id, func.count(CommunityComment.comment_id))
                  .outerjoin(CommentReview, CommentReview.comment_id == CommunityComment.comment_id)
                  .filter(CommunityComment.post_id.in_(post_ids), _visible_comment_filter())
                  .group_by(CommunityComment.post_id).all())


def _liked_posts(db: Session, user_id: Optional[int], post_ids: List[int]) -> set:
    if not user_id or not post_ids:
        return set()
    return {pid for (pid,) in db.query(CommunityLike.post_id).filter(
        CommunityLike.user_id == user_id, CommunityLike.post_id.in_(post_ids))}


def _list_posts(db: Session, parent: bool, limit: int, user_id: Optional[int] = None) -> List[dict]:
    rows = (db.query(CommunityPost).options(defer(CommunityPost.photos))
              .order_by(CommunityPost.created_at.desc(), CommunityPost.post_id.desc()).limit(limit).all())
    ids = [p.post_id for p in rows]
    _migrate_legacy_photos(db, ids)
    photo_map = _photo_ids_by_post(db, ids)
    counts = _comment_counts(db, ids)
    liked = _liked_posts(db, user_id, ids)
    return [_post_to_out(p, photo_map.get(p.post_id, []), parent, int(counts.get(p.post_id, 0)), p.post_id in liked)
            for p in rows]


def _single_post_out(db: Session, p: CommunityPost) -> dict:
    return _post_to_out(p, _photo_ids_by_post(db, [p.post_id]).get(p.post_id, []),
                        comment_count=int(_comment_counts(db, [p.post_id]).get(p.post_id, 0)))


def _parse_photo_items(items: List[str], existing_ids: Optional[set] = None) -> list:
    """사진 목록 검증 → [("keep", photo_id) | ("new", (mime, base64))]"""
    if len(items) > COMMUNITY_PHOTO_MAX_COUNT:
        raise HTTPException(400, f"사진은 게시물당 {COMMUNITY_PHOTO_MAX_COUNT}장까지 올릴 수 있습니다.")
    if sum(len(item or "") for item in items) > COMMUNITY_PHOTOS_TOTAL_MAX_CHARS:
        raise HTTPException(413, "한 번에 올리는 사진 용량이 너무 큽니다. 사진 수를 줄여 주세요.")
    parsed = []
    for item in items:
        ref = _PHOTO_REF_RE.match((item or "").split("?", 1)[0])
        if ref:
            photo_id = int(ref.group(1))
            if existing_ids is None or photo_id not in existing_ids:
                raise HTTPException(400, "이 게시물의 사진이 아닙니다.")
            parsed.append(("keep", photo_id))
        else:
            parsed.append(("new", _parse_image_data_url(item, COMMUNITY_PHOTO_MAX_CHARS, "사진")))
    return parsed


@app.get("/api/community/posts")
def list_community_posts(request: Request, limit: int = Query(100, ge=1, le=300), db: Session = Depends(get_db)):
    """피드 목록 (최신순, 관리자). 사진은 URL 로만 내려 줍니다."""
    return _list_posts(db, parent=False, limit=limit, user_id=request.state.user.user_id)


@app.get("/api/community/photos/{photo_id}")
def get_community_photo(photo_id: int, db: Session = Depends(get_db)):
    row = db.query(CommunityPhoto.mime_type, CommunityPhoto.data).filter(CommunityPhoto.photo_id == photo_id).first()
    if not row:
        raise HTTPException(404, "사진을 찾을 수 없습니다.")
    return _image_response(row.mime_type, row.data)


@app.post("/api/community/posts", status_code=201)
def create_community_post(payload: CommunityPostCreate, db: Session = Depends(get_db)):
    """게시물 작성 (원장). 사진은 data URL 리스트로 받아 사진 테이블에 따로 저장합니다."""
    photos = _parse_photo_items(payload.photos or [])
    if not payload.content.strip() and not photos:
        raise HTTPException(400, "내용 또는 사진을 입력하세요.")
    p = CommunityPost(author=payload.author or "관리자", content=payload.content, photos=None)
    db.add(p)
    db.flush()
    for position, (_, (mime, body)) in enumerate(photos):
        db.add(CommunityPhoto(post_id=p.post_id, position=position, mime_type=mime, data=body))
    db.commit(); db.refresh(p)
    return _single_post_out(db, p)


def _toggle_like(db: Session, post_id: int, user: AppUser, actor_type: str) -> dict:
    """좋아요 토글 — 사용자당 1회. 다시 누르면 취소 (기존: 누를 때마다 무제한 증가)"""
    p = db.query(CommunityPost).options(defer(CommunityPost.photos)).filter(CommunityPost.post_id == post_id).first()
    if not p:
        raise HTTPException(404, "게시물을 찾을 수 없습니다.")
    existing = db.query(CommunityLike).filter(CommunityLike.post_id == post_id, CommunityLike.user_id == user.user_id).first()
    if existing:
        db.delete(existing)
        liked = False
    else:
        db.add(CommunityLike(post_id=post_id, user_id=user.user_id))
        liked = True
        _log(db, actor_type, user.user_id, "community.like", "post", post_id, "좋아요")
    db.flush()
    p.like_count = db.query(func.count(CommunityLike.like_id)).filter(CommunityLike.post_id == post_id).scalar() or 0
    db.commit()
    return {"post_id": post_id, "like_count": p.like_count, "liked": liked}


@app.post("/api/community/posts/{post_id}/like")
def like_community_post(post_id: int, request: Request, db: Session = Depends(get_db)):
    return _toggle_like(db, post_id, request.state.user, "admin")


@app.delete("/api/community/posts/{post_id}", status_code=204)
def delete_community_post(post_id: int, db: Session = Depends(get_db)):
    p = db.query(CommunityPost).filter(CommunityPost.post_id == post_id).first()
    if not p:
        raise HTTPException(404, "게시물을 찾을 수 없습니다.")
    # PostgreSQL 외래키: 댓글(검토 기록)·사진·좋아요를 먼저 지움
    comment_ids = [cid for (cid,) in db.query(CommunityComment.comment_id).filter(CommunityComment.post_id == post_id)]
    if comment_ids:
        db.query(CommentReview).filter(CommentReview.comment_id.in_(comment_ids)).delete(synchronize_session=False)
    db.query(CommunityLike).filter(CommunityLike.post_id == post_id).delete(synchronize_session=False)
    db.query(CommunityComment).filter(CommunityComment.post_id == post_id).delete(synchronize_session=False)
    db.query(CommunityPhoto).filter(CommunityPhoto.post_id == post_id).delete(synchronize_session=False)
    db.delete(p); db.commit()

@app.put("/api/community/posts/{post_id}")
def update_community_post(post_id: int, payload: CommunityPostUpdate, db: Session = Depends(get_db)):
    p = db.query(CommunityPost).options(defer(CommunityPost.photos)).filter(CommunityPost.post_id == post_id).first()
    if not p:
        raise HTTPException(404, "게시물을 찾을 수 없습니다.")
    _migrate_legacy_photos(db, [post_id])
    existing = {pid for (pid,) in db.query(CommunityPhoto.photo_id).filter(CommunityPhoto.post_id == post_id)}
    items = _parse_photo_items(payload.photos or [], existing)
    if not payload.content.strip() and not items:
        raise HTTPException(400, "내용 또는 사진을 입력하세요.")
    kept = {value for kind, value in items if kind == "keep"}
    removed = existing - kept
    if removed:
        db.query(CommunityPhoto).filter(CommunityPhoto.photo_id.in_(removed)).delete(synchronize_session=False)
    for position, (kind, value) in enumerate(items):
        if kind == "keep":
            db.query(CommunityPhoto).filter(CommunityPhoto.photo_id == value).update({"position": position}, synchronize_session=False)
        else:
            mime, body = value
            db.add(CommunityPhoto(post_id=post_id, position=position, mime_type=mime, data=body))
    p.content = payload.content
    db.commit()
    db.refresh(p)
    return _single_post_out(db, p)

def _comment_out(c: CommunityComment, review: Optional[CommentReview] = None, viewer_user_id: Optional[int] = None,
                 admin: bool = False) -> dict:
    out = {"comment_id": c.comment_id, "post_id": c.post_id, "author": c.author, "content": c.content,
           "created_at": c.created_at.isoformat() if c.created_at else None,
           "mine": bool(viewer_user_id and c.user_id == viewer_user_id),
           "pending_review": bool(review and review.flagged and review.decision is None)}
    if admin:
        out["from_parent"] = c.user_id is not None
        out["review"] = None if not review else {
            "flagged": bool(review.flagged), "score": review.score, "reasons": review.reasons,
            "model": review.model, "decision": review.decision}
    return out


def _comments_with_reviews(db: Session, post_id: int):
    return (db.query(CommunityComment, CommentReview)
              .outerjoin(CommentReview, CommentReview.comment_id == CommunityComment.comment_id)
              .filter(CommunityComment.post_id == post_id)
              .order_by(CommunityComment.created_at.asc(), CommunityComment.comment_id.asc()).limit(500).all())


@app.get("/api/community/posts/{post_id}/comments")
def list_community_comments(post_id: int, db: Session = Depends(get_db)):
    """관리자: 모든 댓글 + 자동 검토 결과"""
    return [_comment_out(c, r, admin=True) for c, r in _comments_with_reviews(db, post_id)]


def _parent_visible_comments(db: Session, post_id: int, user_id: int) -> List[dict]:
    """학부모: 공개 댓글 + 본인의 '검토 중' 댓글 (숨김 처리된 댓글은 제외)"""
    out = []
    for c, r in _comments_with_reviews(db, post_id):
        if r and r.decision == "HIDDEN":
            continue
        if r and r.flagged and r.decision is None and c.user_id != user_id:
            continue
        out.append(_comment_out(c, r, viewer_user_id=user_id))
    return out


@app.post("/api/community/posts/{post_id}/comments", status_code=201)
def create_community_comment(post_id: int, payload: CommunityCommentCreate, db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, "댓글 내용을 입력하세요.")
    if not db.query(CommunityPost.post_id).filter(CommunityPost.post_id == post_id).first():
        raise HTTPException(404, "게시물을 찾을 수 없습니다.")
    c = CommunityComment(post_id=post_id, author=payload.author or "관리자", content=content)
    db.add(c); db.commit(); db.refresh(c)
    return _comment_out(c, admin=True)

@app.delete("/api/community/comments/{comment_id}", status_code=204)
def delete_community_comment(comment_id: int, db: Session = Depends(get_db)):
    c = db.query(CommunityComment).filter(CommunityComment.comment_id == comment_id).first()
    if not c:
        raise HTTPException(404, "댓글을 찾을 수 없습니다.")
    db.query(CommentReview).filter(CommentReview.comment_id == comment_id).delete(synchronize_session=False)
    db.delete(c); db.commit()


# =====================================================================
# v8.1 커뮤니티 AI 모니터링 (학부모 댓글 → 자동 판정 → 관리자 검토)
#   - 판정 엔진: backend/moderation.py (rule_v1, MODERATION_AI=true 면 애매한 댓글만 Gemini 재확인)
#   - 관리자 판정(승인/숨김)은 라벨로 쌓여 정밀도·재현율 계산과 학습 데이터 내보내기에 사용
# =====================================================================
import moderation as _moderation   # noqa: E402  (같은 backend 폴더의 순수 모듈)

MODERATION_AI = os.getenv("MODERATION_AI", "").lower() == "true"


def _gemini_judge(text_value: str) -> Optional[dict]:
    if not (MODERATION_AI and GEMINI_API_KEY):
        return None
    prompt = ("다음은 학원·체육관 학부모 커뮤니티 댓글입니다. 욕설, 비방, 광고/스팸, 개인정보 노출이 있으면 유해로 판단하세요.\n"
              '반드시 JSON 한 줄로만 답하세요: {"harmful": true|false, "reason": "20자 이내"}\n\n댓글: ' + text_value[:500])
    try:
        resp = generate_content_with_fallback(contents=[prompt])
        match = re.search(r"\{.*\}", resp.text or "", re.S)
        return json.loads(match.group(0)) if match else None
    except Exception as exc:   # AI 실패 시 규칙 판정만 사용
        logger.warning("Gemini 댓글 판정 실패: %s", exc)
        return None


def _review_comment(db: Session, comment: CommunityComment) -> CommentReview:
    result = _moderation.moderate_text(comment.content, _gemini_judge if MODERATION_AI else None)
    review = CommentReview(comment_id=comment.comment_id, model=result.model, flagged=result.flagged,
                           score=result.score, reasons=", ".join(result.reasons)[:300])
    db.add(review)
    return review


class ModerationDecision(BaseModel):
    decision: str = Field(max_length=10)   # APPROVED / HIDDEN


@app.get("/api/community/moderation")
def moderation_queue(status: str = "pending", limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    """검토 대상 목록. status=pending(검토 대기) / flagged(자동 탐지 전체) / all(학부모 댓글 전체)"""
    query = (db.query(CommunityComment, CommentReview, CommunityPost.content)
               .outerjoin(CommentReview, CommentReview.comment_id == CommunityComment.comment_id)
               .join(CommunityPost, CommunityPost.post_id == CommunityComment.post_id)
               .filter(CommunityComment.user_id.isnot(None)))
    if status == "pending":
        query = query.filter(CommentReview.flagged.is_(True), CommentReview.decision.is_(None))
    elif status == "flagged":
        query = query.filter(CommentReview.flagged.is_(True))
    rows = query.order_by(CommunityComment.created_at.desc()).limit(limit).all()
    return [{**_comment_out(c, r, admin=True), "post_excerpt": (post_content or "")[:60]} for c, r, post_content in rows]


@app.post("/api/community/comments/{comment_id}/moderate")
def moderate_comment(comment_id: int, payload: ModerationDecision, request: Request, db: Session = Depends(get_db)):
    if payload.decision not in ("APPROVED", "HIDDEN"):
        raise HTTPException(400, "decision 은 APPROVED(공개) 또는 HIDDEN(숨김) 이어야 합니다.")
    comment = db.query(CommunityComment).filter(CommunityComment.comment_id == comment_id).first()
    if not comment:
        raise HTTPException(404, "댓글을 찾을 수 없습니다.")
    review = db.query(CommentReview).filter(CommentReview.comment_id == comment_id).first()
    if not review:   # 자동 탐지되지 않은 댓글을 관리자가 직접 숨김 → '놓친 유해 댓글' 라벨
        review = CommentReview(comment_id=comment_id, model=_moderation.MODEL_NAME, flagged=False, score=0, reasons="")
        db.add(review)
    review.decision = payload.decision
    review.decided_at = _now()
    actor_type, actor_id, _ = _actor(request)
    _log(db, actor_type, actor_id, "moderation.decide", "comment", comment_id, payload.decision)
    db.commit()
    return _comment_out(comment, review, admin=True)


def _moderation_stats(db: Session) -> dict:
    rows = (db.query(CommentReview.flagged, CommentReview.decision, CommentReview.reasons)
              .join(CommunityComment, CommunityComment.comment_id == CommentReview.comment_id)
              .filter(CommunityComment.user_id.isnot(None)).all())
    total = db.query(func.count(CommunityComment.comment_id)).filter(CommunityComment.user_id.isnot(None)).scalar() or 0
    flagged = [r for r in rows if r.flagged]
    tp = sum(1 for r in flagged if r.decision == "HIDDEN")         # 탐지 O, 실제 유해
    fp = sum(1 for r in flagged if r.decision == "APPROVED")       # 탐지 O, 실제 정상
    fn = sum(1 for r in rows if not r.flagged and r.decision == "HIDDEN")   # 탐지 X, 관리자가 숨김
    reasons: dict = {}
    for r in flagged:
        for reason in filter(None, (x.strip() for x in (r.reasons or "").split(","))):
            key = reason.split(":")[0]
            reasons[key] = reasons.get(key, 0) + 1
    precision = round(tp / (tp + fp) * 100, 1) if tp + fp else None
    recall = round(tp / (tp + fn) * 100, 1) if tp + fn else None
    f1 = round(2 * precision * recall / (precision + recall), 1) if precision and recall else None
    return {
        "model": _moderation.MODEL_NAME + ("+gemini" if MODERATION_AI and GEMINI_API_KEY else ""),
        "parent_comments": int(total), "auto_flagged": len(flagged),
        "pending": sum(1 for r in flagged if r.decision is None),
        "reviewed": tp + fp, "true_positive": tp, "false_positive": fp, "false_negative": fn,
        "precision": precision, "recall": recall, "f1": f1, "by_reason": reasons,
        "definitions": {
            "precision": "자동 탐지 중 관리자가 '숨김'으로 확정한 비율 = TP / (TP + FP)",
            "recall": "관리자가 숨긴 유해 댓글 중 자동 탐지가 먼저 잡은 비율 = TP / (TP + FN). FN 은 탐지되지 않았는데 관리자가 직접 숨긴 댓글",
        },
    }


@app.get("/api/community/moderation/stats")
def moderation_stats(db: Session = Depends(get_db)):
    return _moderation_stats(db)


@app.get("/api/community/moderation/export")
def moderation_export(db: Session = Depends(get_db)):
    """학습 데이터 CSV (text,label,source). 전화번호·이메일 등은 가려서 내보냅니다.
    label: 1 = 유해(관리자 숨김), 0 = 정상(관리자 승인 또는 자동 통과). 판정 대기 댓글은 제외."""
    import csv
    import io
    rows = (db.query(CommunityComment.content, CommentReview.flagged, CommentReview.decision)
              .outerjoin(CommentReview, CommentReview.comment_id == CommunityComment.comment_id)
              .filter(CommunityComment.user_id.isnot(None)).order_by(CommunityComment.comment_id).all())
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["text", "label", "source"])
    for content, flagged, decision in rows:
        if decision == "HIDDEN":
            label, source = 1, "admin_hidden"
        elif decision == "APPROVED":
            label, source = 0, "admin_approved"
        elif flagged:
            continue
        else:
            label, source = 0, "auto_pass"
        writer.writerow([_moderation.mask_personal_info(content).replace("\n", " "), label, source])
    return Response(content="\ufeff" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="comment_labels.csv"'})


# ---------------------------------------------------------------------
# 청구서(인보이스) — 원장 발행 / 학부모 조회
# ---------------------------------------------------------------------
class InvoiceCreate(BaseModel):
    member_id: int
    item_name: str = "수강료"
    amount: int
    due_date: Optional[date] = None


def _invoice_to_out(iv: Invoice, member_name: Optional[str] = None) -> dict:
    return {
        "invoice_id": iv.invoice_id,
        "member_id": iv.member_id,
        "member_name": member_name if member_name is not None else (iv.member.name if iv.member else None),
        "item_name": iv.item_name,
        "amount": iv.amount,
        "status": iv.status,
        "due_date": iv.due_date.isoformat() if iv.due_date else None,
        "created_at": iv.created_at.isoformat() if iv.created_at else None,
    }


@app.get("/api/invoices")
def list_invoices(status: Optional[str] = None, db: Session = Depends(get_db)):
    """청구서 목록 (관리자). status=UNPAID/PAID 필터 가능."""
    q = db.query(Invoice, Member.name).outerjoin(Member, Member.member_id == Invoice.member_id)
    if status:
        q = q.filter(Invoice.status == status)
    rows = q.order_by(Invoice.status.asc(), Invoice.created_at.desc()).all()
    return [_invoice_to_out(iv, name) for iv, name in rows]


def _invoice_notice_body(iv: Invoice) -> str:
    due = f" · 납부 기한 {iv.due_date.month}월 {iv.due_date.day}일" if iv.due_date else ""
    return f"{iv.item_name} {iv.amount:,}원{due}. 학부모 포털 '결제' 탭에서 바로 결제할 수 있습니다."


@app.post("/api/invoices", status_code=201)
def create_invoice(payload: InvoiceCreate, request: Request, db: Session = Depends(get_db)):
    """청구서 발행 (관리자)."""
    member = db.query(Member).filter(Member.member_id == payload.member_id).first()
    if not member:
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    if payload.amount <= 0:
        raise HTTPException(400, "금액이 올바르지 않습니다.")
    iv = Invoice(member_id=payload.member_id, item_name=payload.item_name,
                 amount=payload.amount, due_date=payload.due_date, status="UNPAID")
    db.add(iv); db.flush()
    _notify_parents(db, [member.member_id], "INVOICE", f"{member.name} 학생 청구서 도착", _invoice_notice_body(iv), "pay")
    actor_type, actor_id, _ = _actor(request)
    _log(db, actor_type, actor_id, "invoice.create", "member", member.member_id, f"{iv.item_name} {iv.amount:,}원")
    db.commit(); db.refresh(iv)
    return _invoice_to_out(iv)


# ---------- v8.1 현장 수납 (현금·계좌이체·카드 단말기) — 카카오페이 없이 '납부 완료' 처리 ----------
OFFLINE_METHODS = {"CASH": "현금", "TRANSFER": "계좌이체", "CARD": "카드(현장)"}


class InvoicePaidRequest(BaseModel):
    method: str = "CASH"
    paid_at: Optional[date] = None
    note: Optional[str] = Field(None, max_length=150)


@app.post("/api/invoices/{invoice_id}/mark-paid")
def mark_invoice_paid(invoice_id: int, payload: InvoicePaidRequest, request: Request, db: Session = Depends(get_db),
                      account: AdminAccount = Depends(owner_account)):
    iv = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).with_for_update().first()
    if not iv:
        raise HTTPException(404, "청구서를 찾을 수 없습니다.")
    if iv.status == "PAID":
        raise HTTPException(409, "이미 납부된 청구서입니다.")
    if payload.method not in OFFLINE_METHODS:
        raise HTTPException(400, f"수납 방법은 {', '.join(OFFLINE_METHODS)} 중 하나여야 합니다.")
    paid_at = payload.paid_at or _today()
    member = db.query(Member).filter(Member.member_id == iv.member_id).first()
    db.add(Payment(member_id=iv.member_id, amount=iv.amount, paid_at=paid_at, payment_type="TUITION",
                   method=payload.method, note=(payload.note or f"{iv.item_name} 현장 수납({OFFLINE_METHODS[payload.method]})")[:200]))
    iv.status = "PAID"
    if member and (member.payment_date is None or paid_at > member.payment_date):
        member.payment_date = paid_at
    # 열려 있던 카카오페이 결제창은 무효화 (이중 결제 방지)
    db.query(PaymentPending).filter(PaymentPending.invoice_id == invoice_id, PaymentPending.status == "READY").update(
        {"status": "CANCELED"}, synchronize_session=False)
    if member:
        _notify_parents(db, [member.member_id], "PAYMENT", f"{member.name} 학생 {iv.item_name} 납부 확인",
                        f"{iv.amount:,}원 {OFFLINE_METHODS[payload.method]} 납부가 확인되었습니다.", "pay")
    _log(db, "admin", account.account_id, "invoice.paid", "member", iv.member_id,
         f"{iv.amount:,}원 {OFFLINE_METHODS[payload.method]}")
    db.commit(); db.refresh(iv)
    return _invoice_to_out(iv, member.name if member else None)


# ---------- v8.1 수강료 일괄 청구 — 설정의 기본 수강료/반별 수강료로 금액 자동 계산 ----------
class InvoiceBulkCreate(BaseModel):
    member_ids: Optional[List[int]] = Field(None, max_length=1000)   # 비우면 재원생 전체(또는 class_id 반 전체)
    class_id: Optional[int] = None
    item_name: str = Field(min_length=1, max_length=200)
    amount: Optional[int] = Field(None, gt=0, le=100_000_000)        # 비우면 설정 기준 자동 계산
    due_date: Optional[date] = None


def _tuition_for(member_id: int, class_ids: List[int], payment: dict) -> int:
    """반별 수강료가 설정된 반들의 합계, 없으면 기본 수강료"""
    fees = {}
    for item in payment.get("classFees") or []:
        try:
            fees[int(item.get("classId"))] = int(item.get("fee") or 0)
        except (TypeError, ValueError, AttributeError):
            continue
    total = sum(fees.get(cid, 0) for cid in class_ids)
    return total if total > 0 else int(payment.get("baseTuitionFee") or 0)


@app.post("/api/invoices/bulk", status_code=201)
def bulk_create_invoices(payload: InvoiceBulkCreate, request: Request, db: Session = Depends(get_db),
                         account: AdminAccount = Depends(owner_account)):
    query = db.query(Member.member_id, Member.name).filter(Member.status == "ACTIVE")
    if payload.member_ids:
        query = query.filter(Member.member_id.in_(payload.member_ids))
    if payload.class_id:
        query = query.join(Enrollment, Enrollment.member_id == Member.member_id).filter(Enrollment.class_id == payload.class_id)
    members = query.all()
    if not members:
        raise HTTPException(400, "청구할 재원생이 없습니다.")
    ids = [m.member_id for m in members]
    already = {mid for (mid,) in db.query(Invoice.member_id).filter(
        Invoice.member_id.in_(ids), Invoice.status == "UNPAID", Invoice.item_name == payload.item_name.strip())}
    class_map: dict = {}
    for member_id, class_id in db.query(Enrollment.member_id, Enrollment.class_id).filter(Enrollment.member_id.in_(ids)):
        class_map.setdefault(member_id, []).append(class_id)
    payment = _read_settings(db, "payment_settings", DEFAULT_PAYMENT_SETTINGS)
    created, skipped, total, no_fee = 0, 0, 0, 0
    for m in members:
        if m.member_id in already:
            skipped += 1
            continue
        amount = payload.amount or _tuition_for(m.member_id, class_map.get(m.member_id, []), payment)
        if amount <= 0:
            no_fee += 1
            continue
        iv = Invoice(member_id=m.member_id, item_name=payload.item_name.strip(), amount=amount,
                     due_date=payload.due_date, status="UNPAID")
        db.add(iv); db.flush()
        _notify_parents(db, [m.member_id], "INVOICE", f"{m.name} 학생 청구서 도착", _invoice_notice_body(iv), "pay")
        created += 1
        total += amount
    _log(db, "admin", account.account_id, "invoice.bulk", None, None, f"{payload.item_name} {created}건 {total:,}원")
    db.commit()
    return {"created": created, "skipped_existing": skipped, "skipped_no_fee": no_fee, "total_amount": total}


class InvoiceUpdate(BaseModel):
    item_name: Optional[str] = None
    amount: Optional[int] = None
    due_date: Optional[date] = None


@app.patch("/api/invoices/{invoice_id}")
def update_invoice(invoice_id: int, payload: InvoiceUpdate, db: Session = Depends(get_db)):
    """청구서 수정 (관리자). 미납 상태만 수정 가능."""
    iv = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()
    if not iv:
        raise HTTPException(404, "청구서를 찾을 수 없습니다.")
    if iv.status == "PAID":
        raise HTTPException(400, "이미 납부된 청구서는 수정할 수 없습니다.")
    if payload.item_name is not None:
        iv.item_name = payload.item_name
    if payload.amount is not None:
        if payload.amount <= 0:
            raise HTTPException(400, "금액이 올바르지 않습니다.")
        iv.amount = payload.amount
    if payload.due_date is not None:
        iv.due_date = payload.due_date
    db.commit(); db.refresh(iv)
    return _invoice_to_out(iv)


@app.delete("/api/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)):
    """청구서 삭제 (관리자). 미납 상태만 삭제 가능."""
    iv = db.query(Invoice).filter(Invoice.invoice_id == invoice_id).first()
    if not iv:
        raise HTTPException(404, "청구서를 찾을 수 없습니다.")
    if iv.status == "PAID":
        raise HTTPException(400, "이미 납부된 청구서는 삭제할 수 없습니다.")
    db.delete(iv); db.commit()


# ---------------------------------------------------------------------
# 대시보드 통계
# ---------------------------------------------------------------------
@app.get("/api/dashboard/stats")
def dashboard_stats(db: Session = Depends(get_db)):
    total_active = db.query(Member).filter(Member.status == "ACTIVE").count()
    total_withdrawn = db.query(Member).filter(Member.status == "WITHDRAWN").count()

    today = _today()
    today_present = (
        db.query(Attendance)
        .filter(and_(Attendance.attendance_date == today,
                     Attendance.status == "PRESENT"))
        .count()
    )
    today_absent = (
        db.query(Attendance)
        .filter(and_(Attendance.attendance_date == today,
                     Attendance.status == "ABSENT"))
        .count()
    )

    # 60일 이상 미납 의심 회원 수
    # [FIX] payment_date 가 NULL(한 번도 납부 기록 없음)인 활동회원도 미납 의심에 포함.
    #       기존 `payment_date < cutoff` 만으로는 NULL 이 비교에서 탈락해 누락되었음.
    cutoff = today - timedelta(days=60)
    unpaid_count = (
        db.query(Member)
        .filter(Member.status == "ACTIVE",
                or_(Member.payment_date.is_(None), Member.payment_date < cutoff))
        .count()
    )

    # 이번달 매출 합
    month_start = today.replace(day=1)
    revenue = (
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.paid_at >= month_start)
        .scalar()
    )

    return {
        "total_active":   total_active,
        "total_withdrawn":total_withdrawn,
        "today_present":  today_present,
        "today_absent":   today_absent,
        "unpaid_count":   unpaid_count,
        "month_revenue":  int(revenue or 0),
    }


@app.get("/api/dashboard/unpaid", response_model=List[MemberOut])
def unpaid_members(days: int = 60, db: Session = Depends(get_db)):
    cutoff = _today() - timedelta(days=days)
    # [FIX] NULL payment_date 포함 (위 stats 와 동일 기준)
    rows = (
        db.query(Member).options(defer(Member.photo_url)).add_columns(_HAS_PHOTO)
        .filter(Member.status == "ACTIVE",
                or_(Member.payment_date.is_(None), Member.payment_date < cutoff))
        .order_by(Member.payment_date.asc())
        .all()
    )
    unpaid = _unpaid_by_member(db)
    return [_member_out(m, has_photo, unpaid.get(m.member_id, (0, 0))) for m, has_photo in rows]


# =====================================================================
# v8.1 운영 인사이트 대시보드 — 집계는 서버(SQL)에서, 화면은 표시만
#   기존 대시보드의 증감률·수납률·미납 금액은 고정값/가짜 계산이었음 → 실제 데이터로 계산하고 지표 정의를 함께 내려 줌
# =====================================================================
INSIGHT_DEFINITIONS = {
    "attendance_rate_today": "오늘 출석률 = (출석 + 지각) ÷ 오늘 수업이 있는 재원생 수. 오늘 수업이 없으면 ÷ 오늘 출결 기록 수",
    "attendance_rate_30d": "30일 출석률 = 최근 30일 출결 기록 중 (출석 + 지각) 비율 (기록 없는 날 제외)",
    "collection_rate": "이달 수납률 = 이번 달 발행된 청구서 중 납부 완료 금액 ÷ 발행 금액",
    "unpaid": "미납 = 상태가 '미납'인 청구서 (연체 = 납부 기한이 지난 미납)",
    "member_change": "재원생 증감 = 이번 달 신규 등록 − 이번 달 퇴원",
    "risk": "이탈 위험 = 최근 30일 출석률 70% 미만(기록 4건 이상), 최근 3회 연속 결석, 연체 청구서 중 해당 항목 점수 합",
    "parent_active_7d": "학부모 앱 활성 = 최근 7일 동안 학부모 포털을 이용한(로그·열람·댓글·좋아요) 계정 수",
}


def _pct(numerator: float, denominator: float) -> Optional[float]:
    return round(numerator / denominator * 100, 1) if denominator else None


def _month_start(day: date, offset: int = 0) -> date:
    y, m = day.year, day.month + offset
    while m <= 0:
        y, m = y - 1, m + 12
    while m > 12:
        y, m = y + 1, m - 12
    return date(y, m, 1)


@app.get("/api/dashboard/insights")
def dashboard_insights(db: Session = Depends(get_db)):
    today = _today()
    month_start = _month_start(today)
    prev_month_start = _month_start(today, -1)

    # --- 재원생 ---
    active_ids = [mid for (mid,) in db.query(Member.member_id).filter(Member.status == "ACTIVE")]
    active = len(active_ids)
    new_this_month = db.query(func.count(Member.member_id)).filter(Member.enrollment_date >= month_start).scalar() or 0
    left_this_month = (db.query(func.count(Member.member_id))
                         .filter(Member.status == "WITHDRAWN", Member.withdrawal_date >= month_start).scalar() or 0)

    # --- 출결: 최근 60일을 한 번에 읽어 일자별·학생별로 집계 ---
    since60 = today - timedelta(days=59)
    att_rows = (db.query(Attendance.member_id, Attendance.attendance_date, Attendance.status)
                  .filter(Attendance.attendance_date >= since60).all())
    by_day: dict = {}
    by_member: dict = {}
    for member_id, day, status in att_rows:
        by_day.setdefault(day, {"PRESENT": 0, "LATE": 0, "ABSENT": 0})
        if status in by_day[day]:
            by_day[day][status] += 1
        by_member.setdefault(member_id, []).append((day, status))

    def window_rate(start: date, end: date):
        present = total = 0
        for day, counts in by_day.items():
            if start <= day <= end:
                present += counts["PRESENT"] + counts["LATE"]
                total += sum(counts.values())
        return _pct(present, total)

    rate_30 = window_rate(today - timedelta(days=29), today)
    rate_prev_30 = window_rate(today - timedelta(days=59), today - timedelta(days=30))

    def series(end: date):
        out = []
        for i in range(6, -1, -1):
            day = end - timedelta(days=i)
            c = by_day.get(day, {"PRESENT": 0, "LATE": 0, "ABSENT": 0})
            out.append({"date": day.isoformat(), "weekday": "월화수목금토일"[day.weekday()],
                        "present": c["PRESENT"], "late": c["LATE"], "absent": c["ABSENT"], "total": c["PRESENT"] + c["LATE"]})
        return out

    # --- 반별: 오늘 수업 여부·오늘 출석률·30일 출석률 ---
    classes = (db.query(Class).options(selectinload(Class.enrollments).selectinload(Enrollment.member)
                                       .load_only(Member.member_id, Member.status)).all())
    today_status = {mid: st for mid, day, st in att_rows if day == today}
    expected_today: set = set()
    class_rows = []
    for c in classes:
        members = [e.member_id for e in c.enrollments if e.member and e.member.status == "ACTIVE"]
        sessions = _sessions_on(c, today)
        if sessions:
            expected_today.update(members)
        present_today = sum(1 for mid in members if today_status.get(mid) in ("PRESENT", "LATE"))
        p30 = t30 = 0
        for mid in members:
            for day, st in by_member.get(mid, []):
                if day >= today - timedelta(days=29):
                    t30 += 1
                    p30 += st in ("PRESENT", "LATE")
        if c.end_date and c.end_date < today:
            continue
        class_rows.append({"class_id": c.class_id, "name": c.name, "enrolled": len(members),
                           "scheduled_today": bool(sessions),
                           "time_today": f"{sessions[0]['start']}~{sessions[0]['end']}" if sessions and sessions[0]["start"] else None,
                           "present_today": present_today,
                           "rate_today": _pct(present_today, len(members)) if sessions else None,
                           "rate_30d": _pct(p30, t30)})
    today_counts = by_day.get(today, {"PRESENT": 0, "LATE": 0, "ABSENT": 0})
    attended_today = today_counts["PRESENT"] + today_counts["LATE"]
    recorded_today = sum(today_counts.values())
    denominator_today = len(expected_today) or recorded_today

    # --- 청구·수납 ---
    month_invoices = db.query(Invoice.amount, Invoice.status).filter(Invoice.created_at >= datetime.combine(month_start, time())).all()
    billed = sum(a for a, _ in month_invoices)
    collected = sum(a for a, st in month_invoices if st == "PAID")
    unpaid_rows = (db.query(Invoice.member_id, Invoice.amount, Invoice.due_date)
                     .filter(Invoice.status == "UNPAID").all())
    unpaid_total = sum(a for _, a, _ in unpaid_rows)
    overdue_ids = {mid for mid, _, due in unpaid_rows if due and due < today}

    # --- 매출 (최근 6개월, 실제 결제 이력) ---
    six_start = _month_start(today, -5)
    revenue: dict = {}
    for paid_at, amount in db.query(Payment.paid_at, Payment.amount).filter(Payment.paid_at >= six_start).all():
        key = f"{paid_at.year}-{paid_at.month:02d}"
        revenue[key] = revenue.get(key, 0) + int(amount or 0)
    months = []
    for i in range(5, -1, -1):
        m = _month_start(today, -i)
        key = f"{m.year}-{m.month:02d}"
        months.append({"month": key, "label": f"{m.month}월", "amount": revenue.get(key, 0)})
    this_rev, last_rev = months[-1]["amount"], months[-2]["amount"]

    # --- 미납 학생 (실제 미납 금액) ---
    names = dict(db.query(Member.member_id, Member.name).filter(Member.member_id.in_({r[0] for r in unpaid_rows} or {-1})).all())
    linked = {mid for (mid,) in db.query(ParentLink.member_id).distinct()}
    unpaid_members: dict = {}
    for member_id, amount, due in unpaid_rows:
        item = unpaid_members.setdefault(member_id, {"member_id": member_id, "name": names.get(member_id),
                                                     "amount": 0, "count": 0, "oldest_due": None, "parent_linked": member_id in linked})
        item["amount"] += int(amount)
        item["count"] += 1
        if due and (item["oldest_due"] is None or due.isoformat() < item["oldest_due"]):
            item["oldest_due"] = due.isoformat()
    for item in unpaid_members.values():
        item["overdue_days"] = (today - date.fromisoformat(item["oldest_due"])).days if item["oldest_due"] and item["oldest_due"] < today.isoformat() else 0
    unpaid_list = sorted(unpaid_members.values(), key=lambda x: (-x["overdue_days"], -x["amount"]))

    # --- 이탈 위험 학생 (규칙 기반 점수 + 사유) ---
    active_names = dict(db.query(Member.member_id, Member.name).filter(Member.status == "ACTIVE").all())
    risks = []
    for member_id in active_ids:
        records = sorted(by_member.get(member_id, []), key=lambda x: x[0])
        recent = [st for day, st in records if day >= today - timedelta(days=29)]
        score, reasons = 0, []
        if len(recent) >= 4:
            rate = sum(st in ("PRESENT", "LATE") for st in recent) / len(recent)
            if rate < 0.7:
                score += 40 if rate < 0.5 else 25
                reasons.append(f"30일 출석률 {round(rate * 100)}%")
        streak = 0
        for _, st in reversed(records):
            if st != "ABSENT":
                break
            streak += 1
        if streak >= 3:
            score += 35
            reasons.append(f"최근 {streak}회 연속 결석")
        if member_id in overdue_ids:
            score += 25
            reasons.append("연체 청구서")
        if score:
            risks.append({"member_id": member_id, "name": active_names.get(member_id), "score": min(score, 100), "reasons": reasons})
    risks.sort(key=lambda x: -x["score"])

    # --- 학부모 앱 이용 · 최근 활동 ---
    week_ago = _now() - timedelta(days=7)
    parent_accounts = db.query(func.count(func.distinct(ParentLink.user_id))).scalar() or 0
    parent_active = (db.query(func.count(func.distinct(ActivityLog.actor_id)))
                       .filter(ActivityLog.actor_type == "parent", ActivityLog.created_at >= week_ago).scalar() or 0)
    recent_logs = (db.query(ActivityLog).filter(ActivityLog.actor_type.in_(("parent", "kiosk", "admin")))
                     .order_by(ActivityLog.created_at.desc(), ActivityLog.log_id.desc()).limit(12).all())
    log_member_ids = {l.target_id for l in recent_logs if l.target_type == "member" and l.target_id}
    log_names = dict(db.query(Member.member_id, Member.name).filter(Member.member_id.in_(log_member_ids or {-1})).all())

    return {
        "generated_at": _now().isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "members": {"active": active, "new_this_month": int(new_this_month), "left_this_month": int(left_this_month),
                    "change": int(new_this_month) - int(left_this_month)},
        "attendance": {
            "today": {"present": today_counts["PRESENT"], "late": today_counts["LATE"], "absent": today_counts["ABSENT"],
                      "recorded": recorded_today, "expected": len(expected_today),
                      "unchecked": max(0, len(expected_today) - recorded_today) if expected_today else None,
                      "rate": _pct(attended_today, denominator_today)},
            "rate_30d": rate_30, "rate_prev_30d": rate_prev_30,
            "rate_change": round(rate_30 - rate_prev_30, 1) if rate_30 is not None and rate_prev_30 is not None else None,
            "this_week": series(today), "last_week": series(today - timedelta(days=7)),
        },
        "classes": sorted(class_rows, key=lambda x: (not x["scheduled_today"], x["name"])),
        "billing": {"month_billed": billed, "month_collected": collected, "collection_rate": _pct(collected, billed),
                    "unpaid_total": unpaid_total, "unpaid_count": len(unpaid_rows), "unpaid_members": len(unpaid_members),
                    "overdue_members": len(overdue_ids)},
        "revenue": {"months": months, "this_month": this_rev, "last_month": last_rev,
                    "change_rate": _pct(this_rev - last_rev, last_rev)},
        "unpaid_members": unpaid_list[:50],
        "risk_students": risks[:8],
        "parents": {"linked_accounts": int(parent_accounts), "active_7d": int(parent_active)},
        "recent_activity": [{"time": l.created_at.isoformat(timespec="minutes") if l.created_at else None,
                             "actor": {"parent": "학부모", "kiosk": "키오스크", "admin": "관리자"}.get(l.actor_type, l.actor_type),
                             "action": l.action, "member_name": log_names.get(l.target_id) if l.target_type == "member" else None,
                             "summary": l.summary} for l in recent_logs],
        "definitions": INSIGHT_DEFINITIONS,
    }


# =====================================================================
# 수업 (classes) API
# =====================================================================
def _class_to_out(c: Class, with_students: bool = False) -> dict:
    student_count = len(c.enrollments) if c.enrollments is not None else 0
    out = {
        "class_id":     c.class_id,
        "name":         c.name,
        "teacher":      c.teacher,
        "start_date":   c.start_date,
        "end_date":     c.end_date,
        "days_of_week": c.days_of_week or "",
        "start_time":   c.start_time.strftime("%H:%M") if c.start_time else None,
        "end_time":     c.end_time.strftime("%H:%M")   if c.end_time   else None,
        "description":  c.description,
        "color_index":  c.color_index or 0,
        "student_count": student_count,
        "students": [],
        "schedules": _class_schedule(c),
    }
    if with_students:
        out["students"] = [
            {
                "member_id": e.member.member_id,
                "name":      e.member.name,
                "gender":    e.member.gender,
                "age":       e.member.age,
            }
            for e in c.enrollments if e.member and e.member.status == "ACTIVE"
        ]
    return out


@app.get("/api/classes", response_model=List[ClassOut])
def list_classes(db: Session = Depends(get_db)):
    """모든 수업 목록 (수강 인원수 포함)"""
    # [PERF] 수업 → 수강 → 학생을 2번의 IN 쿼리로 미리 로딩 (기존: 수업·수강마다 지연 로딩)
    rows = (db.query(Class)
              .options(selectinload(Class.enrollments).selectinload(Enrollment.member)
                       .load_only(Member.member_id, Member.name, Member.gender, Member.age, Member.status))
              .order_by(Class.class_id).all())
    return [_class_to_out(c, with_students=True) for c in rows]


@app.get("/api/classes/{class_id}", response_model=ClassOut)
def get_class(class_id: int, db: Session = Depends(get_db)):
    """수업 1개 상세 (수강 학생 목록 포함)"""
    c = (db.query(Class)
           .options(selectinload(Class.enrollments).selectinload(Enrollment.member)
                    .load_only(Member.member_id, Member.name, Member.gender, Member.age, Member.status))
           .filter(Class.class_id == class_id).first())
    if not c:
        raise HTTPException(404, "수업을 찾을 수 없습니다.")
    return _class_to_out(c, with_students=True)


def _class_data(payload: ClassCreate) -> dict:
    """요청 → 컬럼 값. schedules 가 오면 요일별 시간을 JSON 으로 저장하고, 이전 컬럼(days/start/end)도 함께 채움"""
    data = payload.model_dump(exclude={"schedules"})
    if payload.end_date < payload.start_date:
        raise HTTPException(400, "운영 종료일이 시작일보다 빠릅니다.")
    if payload.schedules is not None:
        items = []
        for item in payload.schedules[:14]:
            day = _normalize_day(item.day)
            if day not in WEEKDAY_CODES and day != "DAILY":
                raise HTTPException(400, f"요일 값이 올바르지 않습니다: {item.day}")
            start, end = _parse_time(item.start), _parse_time(item.end)
            if start and end and end <= start:
                raise HTTPException(400, f"{item.day} 수업의 종료 시간이 시작 시간보다 빠릅니다.")
            items.append({"day": day, "start": start.strftime("%H:%M") if start else "", "end": end.strftime("%H:%M") if end else ""})
        data["schedule_detail"] = json.dumps(items, ensure_ascii=False) if items else None
        data["days_of_week"] = ",".join(i["day"] for i in items)
        data["start_time"] = _parse_time(items[0]["start"]) if items else None
        data["end_time"] = _parse_time(items[0]["end"]) if items else None
    else:
        # [FIX] "HH:MM" 문자열을 time 으로 변환해 저장
        data["start_time"] = _parse_time(data.get("start_time"))
        data["end_time"] = _parse_time(data.get("end_time"))
    return data


@app.post("/api/classes", response_model=ClassOut, status_code=201)
def create_class(payload: ClassCreate, db: Session = Depends(get_db)):
    c = Class(**_class_data(payload))
    db.add(c); db.commit(); db.refresh(c)
    return _class_to_out(c, with_students=True)


@app.put("/api/classes/{class_id}", response_model=ClassOut)
def update_class(class_id: int, payload: ClassUpdate, db: Session = Depends(get_db)):
    c = db.query(Class).filter(Class.class_id == class_id).first()
    if not c:
        raise HTTPException(404, "수업을 찾을 수 없습니다.")
    for k, v in _class_data(payload).items():
        setattr(c, k, v)
    db.commit(); db.refresh(c)
    return _class_to_out(c, with_students=True)


@app.delete("/api/classes/{class_id}", status_code=204)
def delete_class(class_id: int, db: Session = Depends(get_db)):
    c = db.query(Class).filter(Class.class_id == class_id).first()
    if not c:
        raise HTTPException(404, "수업을 찾을 수 없습니다.")
    # PostgreSQL 외래키: 과제를 먼저 지움 (수강 기록은 relationship cascade 로 함께 삭제)
    db.query(Assignment).filter(Assignment.class_id == class_id).delete(synchronize_session=False)
    db.delete(c); db.commit()


# ---------- 수강 등록 / 취소 ----------
@app.post("/api/classes/{class_id}/members/{member_id}",
          response_model=EnrollmentOut, status_code=201)
def enroll_student(class_id: int, member_id: int, db: Session = Depends(get_db)):
    if not db.query(Member).filter(Member.member_id == member_id).first():
        raise HTTPException(404, "회원을 찾을 수 없습니다.")
    if not db.query(Class).filter(Class.class_id == class_id).first():
        raise HTTPException(404, "수업을 찾을 수 없습니다.")
    exists = (db.query(Enrollment)
                .filter(Enrollment.member_id == member_id,
                        Enrollment.class_id == class_id)
                .first())
    if exists:
        raise HTTPException(400, "이미 수강 신청된 학생입니다.")

    e = Enrollment(member_id=member_id, class_id=class_id)
    db.add(e); db.commit(); db.refresh(e)
    return e


@app.delete("/api/classes/{class_id}/members/{member_id}", status_code=204)
def unenroll_student(class_id: int, member_id: int, db: Session = Depends(get_db)):
    e = (db.query(Enrollment)
            .filter(Enrollment.member_id == member_id,
                    Enrollment.class_id == class_id)
            .first())
    if not e:
        raise HTTPException(404, "수강 기록을 찾을 수 없습니다.")
    db.delete(e); db.commit()


@app.get("/api/members/{member_id}/classes", response_model=List[ClassOut])
def list_member_classes(member_id: int, db: Session = Depends(get_db)):
    """특정 학생이 수강하는 모든 수업 목록"""
    if not db.query(Member).filter(Member.member_id == member_id).first():
        raise HTTPException(404, "회원을 찾을 수 없습니다.")

    rows = (db.query(Class)
              .join(Enrollment, Enrollment.class_id == Class.class_id)
              .filter(Enrollment.member_id == member_id)
              .order_by(Class.class_id)
              .all())
    return [_class_to_out(c, with_students=False) for c in rows]


# ---------- 과제 (수업관리 상세 대시보드) ----------
# v8.1: 첨부 파일은 DB(assignment_files)에 저장 — Vercel 함수의 /tmp 는 요청이 끝나면 사라지기 때문.
#       Vercel 요청 본문 한도(4.5MB) 때문에 파일은 4MB 이하만 받습니다.
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "4")) * 1024 * 1024
SUBMISSION_STATUSES = {"SUBMITTED": "제출", "LATE": "지각 제출", "MISSING": "미제출"}


def _parse_due_date(value: str) -> str:
    try:
        return date.fromisoformat((value or "").strip()).isoformat()
    except ValueError:
        raise HTTPException(400, "제출 기한은 YYYY-MM-DD 형식이어야 합니다.")


async def _read_upload(file: Optional[UploadFile]) -> Optional[tuple]:
    """업로드 파일 → (원래 이름, MIME, 바이트). 경로 탐색 방지를 위해 이름은 basename 만 사용"""
    if not file or not file.filename:
        return None
    original = os.path.basename(file.filename.replace("\\", "/"))[-200:]
    if not original:
        raise HTTPException(400, "유효하지 않은 파일명입니다.")
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"첨부 파일은 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 이하만 가능합니다.")
    return original, (file.content_type or "application/octet-stream")[:100], content


def _save_assignment_file(db: Session, assignment: Assignment, upload: tuple) -> None:
    name, mime, content = upload
    row = db.query(AssignmentFile).filter(AssignmentFile.assignment_id == assignment.assignment_id).first()
    if not row:
        row = AssignmentFile(assignment_id=assignment.assignment_id)
        db.add(row)
    row.file_name, row.mime_type, row.size_bytes = name, mime, len(content)
    row.data = base64.b64encode(content).decode()
    assignment.file_name = name


def _assignment_out(a: Assignment, file_meta: Optional[tuple], counts: dict, enrolled: int) -> dict:
    return {"assignment_id": a.assignment_id, "class_id": a.class_id, "title": a.title, "content": a.content,
            "due_date": a.due_date, "file_name": file_meta[0] if file_meta else a.file_name,
            "file_size": file_meta[1] if file_meta else None, "has_file": bool(file_meta),
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "submitted": int(counts.get("SUBMITTED", 0)) + int(counts.get("LATE", 0)), "enrolled": enrolled}


def _assignments_out(db: Session, rows: List[Assignment]) -> List[dict]:
    ids = [a.assignment_id for a in rows]
    files = {aid: (name, size) for aid, name, size in db.query(
        AssignmentFile.assignment_id, AssignmentFile.file_name, AssignmentFile.size_bytes).filter(
        AssignmentFile.assignment_id.in_(ids or [-1]))}
    counts: dict = {}
    for aid, status, cnt in (db.query(AssignmentSubmission.assignment_id, AssignmentSubmission.status,
                                      func.count(AssignmentSubmission.submission_id))
                               .filter(AssignmentSubmission.assignment_id.in_(ids or [-1]))
                               .group_by(AssignmentSubmission.assignment_id, AssignmentSubmission.status)):
        counts.setdefault(aid, {})[status] = cnt
    class_ids = {a.class_id for a in rows}
    enrolled = dict(db.query(Enrollment.class_id, func.count(Enrollment.enrollment_id))
                      .join(Member, Member.member_id == Enrollment.member_id)
                      .filter(Enrollment.class_id.in_(class_ids or {-1}), Member.status == "ACTIVE")
                      .group_by(Enrollment.class_id).all())
    return [_assignment_out(a, files.get(a.assignment_id), counts.get(a.assignment_id, {}), int(enrolled.get(a.class_id, 0)))
            for a in rows]


@app.get("/api/classes/{class_id}/assignments")
def list_class_assignments(class_id: int, db: Session = Depends(get_db)):
    rows = (db.query(Assignment).filter(Assignment.class_id == class_id)
              .order_by(Assignment.due_date.desc(), Assignment.assignment_id.desc()).all())
    return _assignments_out(db, rows)


@app.post("/api/classes/{class_id}/assignments")
async def create_class_assignment(
    class_id: int,
    request: Request,
    title: str = Form(..., min_length=1, max_length=200),
    content: Optional[str] = Form("", max_length=20000),
    due_date: str = Form(..., max_length=20),
    notify_parents: bool = Form(True),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.class_id == class_id).first()
    if not cls:
        raise HTTPException(404, "수업을 찾을 수 없습니다.")
    upload = await _read_upload(file)
    new_assign = Assignment(class_id=class_id, title=title.strip(), content=content, due_date=_parse_due_date(due_date))
    db.add(new_assign); db.flush()
    if upload:
        _save_assignment_file(db, new_assign, upload)
    sent = 0
    if notify_parents:
        member_ids = [mid for (mid,) in db.query(Enrollment.member_id).filter(Enrollment.class_id == class_id)]
        sent = _notify_parents(db, member_ids, "ASSIGNMENT", f"[{cls.name}] 새 과제: {new_assign.title}",
                               f"제출 기한 {new_assign.due_date}", "children")
    actor_type, actor_id, _ = _actor(request)
    _log(db, actor_type, actor_id, "assignment.create", "class", class_id, f"과제 출제 (알림 {sent}건)")
    db.commit(); db.refresh(new_assign)
    return {"status": "success", "assignment_id": new_assign.assignment_id, "file_name": new_assign.file_name,
            **_assignments_out(db, [new_assign])[0]}


@app.put("/api/assignments/{assignment_id}")
async def update_class_assignment(
    assignment_id: int,
    title: str = Form(..., min_length=1, max_length=200),
    content: Optional[str] = Form("", max_length=20000),
    due_date: str = Form(..., max_length=20),
    remove_file: bool = Form(False),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """v8.1: 과제 수정 (기존: '준비 중' 안내만 표시). 새 파일을 올리면 교체, remove_file=true 면 첨부 삭제"""
    a = db.query(Assignment).filter(Assignment.assignment_id == assignment_id).first()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다.")
    upload = await _read_upload(file)
    a.title, a.content, a.due_date = title.strip(), content, _parse_due_date(due_date)
    if upload:
        _save_assignment_file(db, a, upload)
    elif remove_file:
        db.query(AssignmentFile).filter(AssignmentFile.assignment_id == assignment_id).delete(synchronize_session=False)
        a.file_name = None
    db.commit(); db.refresh(a)
    return _assignments_out(db, [a])[0]


@app.delete("/api/assignments/{assignment_id}", status_code=204)
def delete_class_assignment(assignment_id: int, db: Session = Depends(get_db)):
    a = db.query(Assignment).filter(Assignment.assignment_id == assignment_id).first()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다.")
    db.query(AssignmentFile).filter(AssignmentFile.assignment_id == assignment_id).delete(synchronize_session=False)
    db.query(AssignmentSubmission).filter(AssignmentSubmission.assignment_id == assignment_id).delete(synchronize_session=False)
    db.delete(a); db.commit()


def _assignment_file_response(db: Session, assignment_id: int) -> Response:
    row = db.query(AssignmentFile).filter(AssignmentFile.assignment_id == assignment_id).first()
    if not row:
        raise HTTPException(404, "첨부 파일이 없습니다. (v8.1 이전에 올린 파일은 서버에 남아 있지 않을 수 있습니다)")
    from urllib.parse import quote
    return Response(content=base64.b64decode(row.data), media_type=row.mime_type,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.file_name)}",
                             "Cache-Control": "private, no-store"})


@app.get("/api/assignments/{assignment_id}/file")
def download_assignment_file(assignment_id: int, db: Session = Depends(get_db)):
    return _assignment_file_response(db, assignment_id)


class SubmissionUpdate(BaseModel):
    status: str = Field(max_length=12)          # SUBMITTED / LATE / MISSING / NONE(기록 삭제)
    note: Optional[str] = Field(None, max_length=200)


@app.get("/api/assignments/{assignment_id}/submissions")
def list_submissions(assignment_id: int, db: Session = Depends(get_db)):
    """수강생별 제출 현황 (기존: 학생 순번으로 만든 가짜 표)"""
    a = db.query(Assignment).filter(Assignment.assignment_id == assignment_id).first()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다.")
    students = (db.query(Member.member_id, Member.name).join(Enrollment, Enrollment.member_id == Member.member_id)
                  .filter(Enrollment.class_id == a.class_id, Member.status == "ACTIVE").order_by(Member.name).all())
    subs = {s.member_id: s for s in db.query(AssignmentSubmission).filter(AssignmentSubmission.assignment_id == assignment_id)}
    return [{"member_id": mid, "name": name, "status": subs[mid].status if mid in subs else "NONE",
             "note": subs[mid].note if mid in subs else None,
             "checked_at": subs[mid].checked_at.isoformat() if mid in subs and subs[mid].checked_at else None}
            for mid, name in students]


@app.put("/api/assignments/{assignment_id}/submissions/{member_id}")
def update_submission(assignment_id: int, member_id: int, payload: SubmissionUpdate, request: Request,
                      db: Session = Depends(get_db)):
    if not db.query(Assignment.assignment_id).filter(Assignment.assignment_id == assignment_id).first():
        raise HTTPException(404, "과제를 찾을 수 없습니다.")
    row = db.query(AssignmentSubmission).filter(AssignmentSubmission.assignment_id == assignment_id,
                                                AssignmentSubmission.member_id == member_id).first()
    if payload.status == "NONE":
        if row:
            db.delete(row)
        db.commit()
        return {"member_id": member_id, "status": "NONE"}
    if payload.status not in SUBMISSION_STATUSES:
        raise HTTPException(400, "상태는 SUBMITTED / LATE / MISSING / NONE 중 하나여야 합니다.")
    if not row:
        row = AssignmentSubmission(assignment_id=assignment_id, member_id=member_id)
        db.add(row)
    row.status, row.note, row.checked_at = payload.status, payload.note, _now()
    actor_type, actor_id, _ = _actor(request)
    _log(db, actor_type, actor_id, "assignment.check", "member", member_id, SUBMISSION_STATUSES[payload.status])
    db.commit()
    return {"member_id": member_id, "status": row.status, "note": row.note, "checked_at": row.checked_at.isoformat()}


# =====================================================================
# AI 기능
# =====================================================================
# [FIX/ADD] 서버 사이드 Gemini 프록시.
#   - API 키는 절대 프론트로 내려가지 않고 서버 환경변수(GEMINI_API_KEY)에서만 읽음.
#   - 패키지/키가 없으면 서버는 정상 부팅하되 이 엔드포인트만 503 을 반환.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# 콤마 구분 env 로 교체 가능. 앞에서부터 시도하고 429/503 이면 다음 모델로 폴백
GEMINI_MODEL_PRIORITY = [m.strip() for m in os.getenv(
    "GEMINI_MODELS", "gemini-2.5-flash-lite,gemini-2.5-flash").split(",") if m.strip()]
_genai_client = None


def _get_genai_client():
    global _genai_client
    if not GEMINI_API_KEY:
        raise HTTPException(
            503, "AI 기능이 비활성화되어 있습니다. 서버에 GEMINI_API_KEY 환경변수를 설정하세요.")
    if _genai_client is None:
        try:
            from google import genai  # pip install google-genai
        except ImportError:
            raise HTTPException(
                503, "google-genai 패키지가 설치되어 있지 않습니다. requirements.txt 를 확인하세요.")
        _genai_client = genai.Client(api_key=GEMINI_API_KEY)
    return _genai_client

def generate_content_with_fallback(contents, **kwargs):
    """
    GEMINI_MODEL_PRIORITY 리스트 순서대로 컨텐츠 생성을 시도합니다.
    구글 서버 과부하(503)나 한도 초과(429)가 발생하면 자동으로 다음 모델로 토스합니다.
    """
    client = _get_genai_client()
    last_error = None
    
    for model_name in GEMINI_MODEL_PRIORITY:
        try:
            logger.info("AI 요청 시도: %s", model_name)
            
            # 구글 새로운 SDK 방식 구조 유지
            resp = client.models.generate_content(
                model=model_name,
                contents=contents,
                **kwargs
            )
            
            logger.info("AI 요청 성공: %s", model_name)
            return resp  # 성공 시 즉시 응답 객체 반환
            
        except Exception as e:
            last_error = e
            error_msg = str(e).lower()
            
            # 구글 서버 가용성 문제(503) 혹은 무료 버전 트래픽 제한(429) 에러 코드 감지
            if "503" in error_msg or "unavailable" in error_msg or "429" in error_msg or "exhausted" in error_msg:
                logger.warning("모델 %s 장애(%s). 다음 순위 모델로 전환합니다.", model_name, e)
                continue  # 다음 루프(다음 모델)로 이동
            else:
                # API 키 오류, 프롬프트 문법 오류 등은 모델을 바꿔도 해결 안 되므로 즉시 예외 발생
                raise e
                
    logger.error("모든 백업 모델 요청이 실패했습니다.")
    raise last_error


@app.get("/api/ai/status")
def ai_status():
    """프론트가 AI 사용 가능 여부를 미리 확인할 수 있는 헬스 체크"""
    return {
        "enabled": bool(GEMINI_API_KEY), 
        "main_model": GEMINI_MODEL_PRIORITY[0],
        "backup_models": GEMINI_MODEL_PRIORITY[1:]
    }

# ---- AI 프롬프트 개인정보 보호: 민감 필드 제거 + 이름 가명화 -----------------
#   Gemini 로 보내기 전 이름을 S0001 같은 토큰으로 바꾸고, 답변을 받은 뒤 서버에서
#   원래 이름으로 되돌립니다. 연락처·주소·사진·부모 이름은 아예 보내지 않습니다.
AI_SENSITIVE_KEYS = {"photo_url", "photos", "father_phone", "mother_phone", "phone", "address",
                     "father_name", "mother_name", "email", "logo"}
AI_NAME_KEYS = {"name", "member_name", "student_name"}
AI_CONTEXT_MAX_CHARS = int(os.getenv("AI_CONTEXT_MAX_CHARS", "120000"))


class _Pseudonymizer:
    def __init__(self):
        self.forward: dict = {}

    def token(self, name: str) -> str:
        if name not in self.forward:
            self.forward[name] = f"S{len(self.forward) + 1:04d}"
        return self.forward[name]

    def scrub(self, value):
        if isinstance(value, dict):
            out = {}
            for key, item in value.items():
                if key in AI_SENSITIVE_KEYS:
                    continue
                if key in AI_NAME_KEYS and isinstance(item, str) and item.strip():
                    out[key] = self.token(item.strip())
                else:
                    out[key] = self.scrub(item)
            return out
        if isinstance(value, list):
            return [self.scrub(item) for item in value]
        if isinstance(value, str) and value.startswith("data:") and ";base64," in value[:80]:
            return "[이미지 생략]"
        return value

    def restore(self, text: str) -> str:
        for name, token in sorted(self.forward.items(), key=lambda kv: -len(kv[1])):
            text = text.replace(token, name)
        return text


def _ai_db_context(db: Session) -> dict:
    """AI 비서용 DB 요약 (서버에서 생성 — 프론트가 전체 원생 데이터를 내려받아 다시 보내지 않음)"""
    since = _today() - timedelta(days=60)
    members = db.query(Member.member_id, Member.name, Member.gender, Member.age, Member.status,
                       Member.enrollment_date, Member.payment_date).all()
    class_rows = db.query(Class.class_id, Class.name, Class.teacher, Class.days_of_week).all()
    enroll = db.query(Enrollment.member_id, Enrollment.class_id).all()
    attendance = (db.query(Attendance.member_id, Attendance.attendance_date, Attendance.status)
                    .filter(Attendance.attendance_date >= since).all())
    names = {m.member_id: m.name for m in members}
    students_by_class: dict = {}
    for e in enroll:
        students_by_class.setdefault(e.class_id, []).append(names.get(e.member_id))
    return {
        "기준일": _today().isoformat(),
        "members": [{"name": m.name, "gender": m.gender, "age": m.age, "status": m.status,
                     "enrollment_date": m.enrollment_date.isoformat() if m.enrollment_date else None,
                     "last_payment_date": m.payment_date.isoformat() if m.payment_date else None}
                    for m in members],
        "classes": [{"class_name": c.name, "teacher": c.teacher, "days": c.days_of_week,
                     "students": students_by_class.get(c.class_id, [])}
                    for c in class_rows],
        "attendances_last_60_days": [{"name": names.get(a.member_id), "date": a.attendance_date.isoformat(),
                                      "status": a.status} for a in attendance],
    }


@app.post("/api/ai/analyze")
def ai_analyze(payload: AIAnalyzeRequest, db: Session = Depends(get_db)):
    _get_genai_client()
    pseudo = _Pseudonymizer()
    blocks = []
    if payload.include_db:
        blocks.append("[학원 DB 요약]\n" + json.dumps(pseudo.scrub(_ai_db_context(db)), ensure_ascii=False))
    if payload.context:
        try:
            parsed = json.loads(payload.context)
            blocks.append("[추가 자료]\n" + json.dumps(pseudo.scrub(parsed), ensure_ascii=False))
        except (ValueError, TypeError):
            blocks.append("[추가 자료]\n" + payload.context)  # 관리자가 직접 올린 텍스트/CSV
    context_block = "\n\n".join(blocks)
    if len(context_block) > AI_CONTEXT_MAX_CHARS:
        context_block = context_block[:AI_CONTEXT_MAX_CHARS] + "\n...(이하 생략)"
    prompt = (
        f"{context_block}\n\n사용자 질문: {payload.message}\n\n"
        "요구사항: 제공된 자료가 있다면 해당 데이터를 기반으로 분석하고, 사용자의 질문에 친절하고 정확하게 답변해 주세요. "
        "S0001 같은 학생 식별 토큰은 그대로 사용하세요."
    )
    try:
        resp = generate_content_with_fallback(contents=[prompt])
        return {"text": pseudo.restore(resp.text or "")}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Gemini API 통신 오류: %s", e)
        raise HTTPException(502, "AI 분석 요청 처리 중 오류가 발생했습니다.")


# [MERGE] 사진(서류) OCR → 학생 정보 추출 (서버 사이드 Gemini Vision 프록시)
#   친구 모듈의 extractStudentInfoFromImage 를 백엔드로 이전했습니다.
#   (프론트엔드에 키를 노출하지 않기 위함 — /api/ai/analyze 와 동일한 원칙)
class StudentOCRRequest(BaseModel):
    image_base64: str            # data URL 또는 순수 base64 (프론트가 1600px 로 줄여서 보냄)
    mime_type: str = Field("image/jpeg", max_length=30)


@app.post("/api/ai/extract-student")
def ai_extract_student(payload: StudentOCRRequest):
    _get_genai_client()
    if len(payload.image_base64) > 4_000_000:   # Vercel 요청 본문 한도(4.5MB) 안쪽
        raise HTTPException(413, "이미지가 너무 큽니다. 더 작은 사진을 올려 주세요.")
    if payload.mime_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "JPG·PNG·WEBP 이미지만 인식할 수 있습니다.")

    # data URL 헤더(data:image/...;base64,) 제거
    raw = payload.image_base64.strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(400, "유효하지 않은 이미지 데이터입니다.")

    today_str = _today().isoformat()
    year = _today().year
    prompt = (
        "이 이미지는 학원 학생 등록 신청서 또는 관련 서류입니다. "
        "이미지를 분석해서 다음 JSON 형식으로만 추출해주세요. 다른 설명이나 마크다운은 절대 넣지 마세요.\n\n"
        "추출할 데이터 스키마:\n{\n"
        '  "name": "학생 이름 (한글 2~5자, 추출 불가시 빈 문자열)",\n'
        '  "gender": "M 또는 F (남자는 M, 여자는 F. 추출 불가시 빈 문자열)",\n'
        f'  "age": 나이 숫자 (생년월일/출생연도만 있으면 {year}년 기준 환산, 추출 불가시 빈 문자열),\n'
        '  "mother_phone": "어머니 연락처 (숫자와 하이픈만, 추출 불가시 빈 문자열)",\n'
        '  "father_phone": "아버지 연락처 (숫자와 하이픈만, 추출 불가시 빈 문자열)",\n'
        '  "address": "주소 (추출 불가시 빈 문자열)",\n'
        f'  "enrollment_date": "입관일 (있으면 YYYY-MM-DD, 없으면 {today_str})",\n'
        f'  "payment_date": "결제일 (있으면 YYYY-MM-DD, 없으면 {today_str})"\n'
        "}\n\n지시사항:\n"
        "1. 모/부 연락처 구분이 안 되면 첫 번째를 mother_phone, 두 번째를 father_phone 에 넣으세요.\n"
        "2. 반드시 중괄호 {} 로 감싸진 순수 JSON 문자열만 응답하세요."
    )

    try:
        from google.genai import types  # lazy import
        # [FIX] 정의되지 않은 GEMINI_MODEL 참조로 항상 실패하던 버그 → 공통 폴백 호출 사용
        resp = generate_content_with_fallback(
            contents=[prompt, types.Part.from_bytes(data=image_bytes, mime_type=payload.mime_type)],
        )
        text = (resp.text or "").strip()
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise ValueError("JSON 응답을 찾을 수 없습니다.")
        parsed = json.loads(match.group(0))
        if not isinstance(parsed, dict):
            raise ValueError("JSON 객체가 아닙니다.")
        allowed = ("name", "gender", "age", "mother_phone", "father_phone", "address", "enrollment_date", "payment_date")
        return {key: parsed.get(key, "") for key in allowed}   # 정해진 필드만 돌려줌
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Gemini OCR 오류: %s", e)
        raise HTTPException(502, "사진에서 학생 정보를 추출하지 못했습니다.")


# =====================================================================
# 학부모 API (/api/parent/*) — 학부모 세션 + 본인에게 연결된 자녀 데이터만
# =====================================================================
class ParentChildLink(BaseModel):
    child_name: str = Field(max_length=50)
    phone: str = Field(max_length=30)


class ParentKakaoReady(BaseModel):
    invoice_id: int


class ParentCommentCreate(BaseModel):
    content: str = Field(max_length=1000)


def _digits_expr(column):
    """DB 의 전화번호 컬럼에서 '-', ' ', '+' 제거 (PostgreSQL/SQLite 공통 REPLACE)"""
    return func.replace(func.replace(func.replace(column, "-", ""), " ", ""), "+", "")


def _linked_member_ids(db: Session, user: AppUser) -> List[int]:
    return [mid for (mid,) in db.query(ParentLink.member_id).filter(ParentLink.user_id == user.user_id).all()]


def _require_linked(db: Session, user: AppUser, member_id: int) -> None:
    if member_id not in _linked_member_ids(db, user):
        raise HTTPException(403, "연결된 자녀의 정보만 조회할 수 있습니다.")


def _parent_display_name(user: AppUser) -> str:
    name = (user.name or "").strip()
    return f"{name[0]}** 학부모" if name else "학부모"


@app.get("/api/parent/children")
def parent_children(db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    """연결된 자녀 목록 — 화면에 필요한 최소 필드만 (연락처·주소·사진 제외)"""
    members = (db.query(Member.member_id, Member.name, Member.status, Member.enrollment_date)
                 .join(ParentLink, ParentLink.member_id == Member.member_id)
                 .filter(ParentLink.user_id == user.user_id).order_by(Member.name).all())
    ids = [m.member_id for m in members]
    class_map: dict = {}
    if ids:
        for member_id, class_name in (db.query(Enrollment.member_id, Class.name)
                                        .join(Class, Class.class_id == Enrollment.class_id)
                                        .filter(Enrollment.member_id.in_(ids)).all()):
            class_map.setdefault(member_id, []).append(class_name)
    today_rows = {a.member_id: a for a in db.query(Attendance).filter(
        Attendance.attendance_date == _today(), Attendance.member_id.in_(ids or [-1]))}
    unpaid = _unpaid_by_member(db, ids)

    def today_out(a):
        if not a:
            return None
        return {"status": a.status, "check_in_time": a.check_in_time.strftime("%H:%M") if a.check_in_time else None,
                "check_out_time": a.check_out_time.strftime("%H:%M") if a.check_out_time else None}

    return [{"member_id": m.member_id, "name": m.name, "status": m.status,
             "enrollment_date": m.enrollment_date.isoformat() if m.enrollment_date else None,
             "classes": class_map.get(m.member_id, []),
             "today": today_out(today_rows.get(m.member_id)),
             "unpaid_amount": unpaid.get(m.member_id, (0, 0))[0]} for m in members]


@app.post("/api/parent/children", status_code=201)
def parent_link_child(payload: ParentChildLink, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    """자녀 연결: 자녀 이름 + 학원에 등록된 보호자 연락처가 일치해야 함.
    로그인한 Google 계정에만 연결되고, 실패 5회 시 30분 잠금(무차별 대입 방지)."""
    row = db.query(AppUser).filter(AppUser.user_id == user.user_id).first()
    _ensure_not_locked(row)
    digits = re.sub(r"\D", "", payload.phone or "")
    name = (payload.child_name or "").strip()
    member = None
    if len(digits) >= 9 and name:
        member = (db.query(Member)
                    .filter(Member.name == name,
                            or_(_digits_expr(Member.father_phone) == digits,
                                _digits_expr(Member.mother_phone) == digits))
                    .first())
    if not member:
        _record_failed_attempt(db, row)
        raise HTTPException(404, "일치하는 학생을 찾지 못했습니다. 이름과 학원에 등록한 보호자 연락처를 확인하세요.")
    _clear_failed_attempts(row)
    if not db.query(ParentLink).filter(ParentLink.user_id == user.user_id, ParentLink.member_id == member.member_id).first():
        db.add(ParentLink(user_id=user.user_id, member_id=member.member_id))
        _notify_admins(db, "LINK", f"{member.name} 학생 학부모 계정 연결", f"{_parent_display_name(user)} 님이 포털에 연결했습니다.",
                       "members", member.member_id)
        _log(db, "parent", user.user_id, "parent.link", "member", member.member_id, "자녀 연결")
    db.commit()
    return {"member_id": member.member_id, "name": member.name}


@app.delete("/api/parent/children/{member_id}", status_code=204)
def parent_unlink_child(member_id: int, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    db.query(ParentLink).filter(ParentLink.user_id == user.user_id, ParentLink.member_id == member_id).delete()
    db.commit()


@app.get("/api/parent/invoices")
def parent_invoices(status: str = "UNPAID", db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    ids = _linked_member_ids(db, user)
    if not ids:
        return []
    q = (db.query(Invoice, Member.name).join(Member, Member.member_id == Invoice.member_id)
           .filter(Invoice.member_id.in_(ids)))
    if status in ("UNPAID", "PAID"):
        q = q.filter(Invoice.status == status)
    return [_invoice_to_out(iv, name) for iv, name in q.order_by(Invoice.created_at.desc()).limit(100).all()]


@app.get("/api/parent/attendances")
def parent_attendances(member_id: int, days: int = Query(30, ge=1, le=365),
                       db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    _require_linked(db, user, member_id)
    since = _today() - timedelta(days=days)
    rows = (db.query(Attendance).filter(Attendance.member_id == member_id, Attendance.attendance_date >= since)
              .order_by(Attendance.attendance_date.desc()).all())
    present = sum(1 for a in rows if a.status == "PRESENT")
    late = sum(1 for a in rows if a.status == "LATE")
    return {
        "member_id": member_id, "days": days,
        # 출석률 정의(대시보드와 동일): 기간 내 출결 기록 중 (출석 + 지각) 비율 (기록 없는 날은 제외)
        "summary": {"records": len(rows), "present": present, "late": late,
                    "absent": sum(1 for a in rows if a.status == "ABSENT"),
                    "rate": _pct(present + late, len(rows))},
        "items": [{"date": a.attendance_date.isoformat(), "status": a.status,
                   "check_in_time": a.check_in_time.strftime("%H:%M") if a.check_in_time else None}
                  for a in rows],
    }


@app.post("/api/parent/payments/kakao-ready")
def parent_kakao_ready(payload: ParentKakaoReady, request: Request, db: Session = Depends(get_db),
                       user: AppUser = Depends(current_parent)):
    """학부모 결제 준비: 금액·항목은 클라이언트 값이 아니라 청구서(DB)에서 확정"""
    invoice = db.query(Invoice).filter(Invoice.invoice_id == payload.invoice_id, Invoice.status == "UNPAID").first()
    if not invoice:
        raise HTTPException(404, "미납 청구서를 찾을 수 없습니다.")
    _require_linked(db, user, invoice.member_id)
    member = db.query(Member).filter(Member.member_id == invoice.member_id).first()
    return _kakao_ready_core(db, request, member, invoice.amount, invoice.item_name, "TUITION", invoice.invoice_id,
                             partner_user_id=f"parent{user.user_id}_member{member.member_id}")


def _parent_class_children(db: Session, user: AppUser) -> dict:
    """학부모의 자녀가 듣는 반 → 자녀 이름 목록"""
    result: dict = {}
    for class_id, name in (db.query(Enrollment.class_id, Member.name)
                             .join(ParentLink, ParentLink.member_id == Enrollment.member_id)
                             .join(Member, Member.member_id == Enrollment.member_id)
                             .filter(ParentLink.user_id == user.user_id).all()):
        result.setdefault(class_id, []).append(name)
    return result


@app.get("/api/parent/notices")
def parent_notices(db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    """전체 공지 + 우리 아이가 듣는 반의 공지. 추천 v1(규칙 기반): 고정 → 우리 아이 반 공지 → 최신 순"""
    my_classes = _parent_class_children(db, user)
    rows = (db.query(Notice).filter(or_(Notice.class_id.is_(None), Notice.class_id.in_(list(my_classes) or [-1])))
              .order_by(Notice.is_pinned.desc(), Notice.created_at.desc()).limit(100).all())
    read_ids = {nid for (nid,) in db.query(NoticeRead.notice_id).filter(NoticeRead.user_id == user.user_id)}
    class_names = dict(db.query(Class.class_id, Class.name).filter(Class.class_id.in_(list(my_classes) or [-1])).all())
    out = []
    for n in rows:
        item = _notice_to_out(n, class_names)
        item.pop("read_count"); item.pop("target_count")
        item["is_read"] = n.notice_id in read_ids
        item["for_children"] = my_classes.get(n.class_id, []) if n.class_id else []
        item["reason"] = (f"{', '.join(item['for_children'])} 학생의 {item['class_name']} 공지" if n.class_id else
                          ("중요 공지" if n.is_pinned else ("긴급 공지" if n.category == "URGENT" else None)))
        out.append(item)
    out.sort(key=lambda x: (not x["is_pinned"], not x["class_id"], x["is_read"]), reverse=False)
    return out


class NoticeReadRequest(BaseModel):
    notice_ids: List[int] = Field(max_length=200)


@app.post("/api/parent/notices/read")
def parent_notices_read(payload: NoticeReadRequest, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    """학부모가 공지를 열람하면 읽음 기록 (관리자 화면의 '읽음 N가정')"""
    ids = set(payload.notice_ids)
    already = {nid for (nid,) in db.query(NoticeRead.notice_id).filter(NoticeRead.user_id == user.user_id,
                                                                       NoticeRead.notice_id.in_(ids or {-1}))}
    valid = {nid for (nid,) in db.query(Notice.notice_id).filter(Notice.notice_id.in_(ids - already or {-1}))}
    for notice_id in valid:
        db.add(NoticeRead(notice_id=notice_id, user_id=user.user_id))
    if valid:
        _log(db, "parent", user.user_id, "notice.read", None, None, f"공지 {len(valid)}건 열람")
    db.commit()
    return {"marked": len(valid)}


# ---------- v8.1 학부모 요약·알림함 (10초마다 폴링) ----------
@app.get("/api/parent/summary")
def parent_summary(db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    brand = _brand(db)
    academy = _read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS)
    unread = (db.query(func.count(Notification.notification_id))
                .filter(Notification.user_id == user.user_id, Notification.audience == "parent",
                        Notification.is_read.is_(False)).scalar() or 0)
    return {"facility": {"name": brand.get("name"), "branch": brand.get("branch"), "logo": brand.get("logo"),
                         "phone": academy.get("phone") or ""},
            "unread_notifications": int(unread), "server_time": _now().isoformat(timespec="seconds")}


@app.get("/api/parent/notifications")
def parent_notifications(limit: int = Query(30, ge=1, le=100), unread_only: bool = False,
                         db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    return _list_notifications(db, user.user_id, "parent", limit, unread_only)


@app.post("/api/parent/notifications/read")
def parent_notifications_read(payload: NotificationReadRequest, db: Session = Depends(get_db),
                              user: AppUser = Depends(current_parent)):
    return _mark_notifications_read(db, user.user_id, "parent", payload)


@app.get("/api/parent/assignments")
def parent_assignments(db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    """자녀 반의 과제 (최근 60일 이후 기한) + 자녀별 제출 상태"""
    children = (db.query(Member.member_id, Member.name).join(ParentLink, ParentLink.member_id == Member.member_id)
                  .filter(ParentLink.user_id == user.user_id).all())
    child_ids = [c.member_id for c in children]
    names = {c.member_id: c.name for c in children}
    enroll = db.query(Enrollment.member_id, Enrollment.class_id).filter(Enrollment.member_id.in_(child_ids or [-1])).all()
    class_children: dict = {}
    for member_id, class_id in enroll:
        class_children.setdefault(class_id, []).append(member_id)
    since = (_today() - timedelta(days=60)).isoformat()
    rows = (db.query(Assignment, Class.name).join(Class, Class.class_id == Assignment.class_id)
              .filter(Assignment.class_id.in_(list(class_children) or [-1]), Assignment.due_date >= since)
              .order_by(Assignment.due_date.desc()).limit(100).all())
    ids = [a.assignment_id for a, _ in rows]
    subs = {(s.assignment_id, s.member_id): s.status for s in db.query(AssignmentSubmission).filter(
        AssignmentSubmission.assignment_id.in_(ids or [-1]), AssignmentSubmission.member_id.in_(child_ids or [-1]))}
    files = {aid for (aid,) in db.query(AssignmentFile.assignment_id).filter(AssignmentFile.assignment_id.in_(ids or [-1]))}
    today = _today().isoformat()
    return [{"assignment_id": a.assignment_id, "class_name": class_name, "title": a.title, "content": a.content,
             "due_date": a.due_date, "overdue": a.due_date < today, "has_file": a.assignment_id in files,
             "file_name": a.file_name,
             "children": [{"member_id": mid, "name": names.get(mid), "status": subs.get((a.assignment_id, mid), "NONE")}
                          for mid in class_children.get(a.class_id, [])]}
            for a, class_name in rows]


@app.get("/api/parent/assignments/{assignment_id}/file")
def parent_assignment_file(assignment_id: int, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    class_id = db.query(Assignment.class_id).filter(Assignment.assignment_id == assignment_id).scalar()
    if not class_id or class_id not in _parent_class_children(db, user):
        raise HTTPException(403, "자녀가 수강하는 반의 과제만 받을 수 있습니다.")
    return _assignment_file_response(db, assignment_id)


@app.get("/api/parent/community/posts")
def parent_posts(db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    return _list_posts(db, parent=True, limit=50, user_id=user.user_id)


@app.get("/api/parent/community/photos/{photo_id}")
def parent_community_photo(photo_id: int, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    return get_community_photo(photo_id, db)


@app.post("/api/parent/community/posts/{post_id}/like")
def parent_like_post(post_id: int, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    return _toggle_like(db, post_id, user, "parent")


@app.get("/api/parent/community/posts/{post_id}/comments")
def parent_comments(post_id: int, db: Session = Depends(get_db), user: AppUser = Depends(current_parent)):
    return _parent_visible_comments(db, post_id, user.user_id)


@app.post("/api/parent/community/posts/{post_id}/comments", status_code=201)
def parent_create_comment(post_id: int, payload: ParentCommentCreate, db: Session = Depends(get_db),
                          user: AppUser = Depends(current_parent)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, "댓글은 1~1000자로 입력하세요.")
    if not db.query(CommunityPost.post_id).filter(CommunityPost.post_id == post_id).first():
        raise HTTPException(404, "게시물을 찾을 수 없습니다.")
    # 작성자 이름은 클라이언트가 아닌 서버가 결정 (사칭 방지, 이름 일부 마스킹)
    comment = CommunityComment(post_id=post_id, author=_parent_display_name(user), content=content, user_id=user.user_id)
    db.add(comment); db.flush()
    review = _review_comment(db, comment)          # v8.1: 자동 모니터링
    if review.flagged:
        _notify_admins(db, "MODERATION", "검토가 필요한 댓글", f"자동 탐지: {review.reasons}", "community")
    else:
        _notify_admins(db, "COMMENT", f"{comment.author} 님의 새 댓글", content[:80], "community")
    _log(db, "parent", user.user_id, "community.comment", "post", post_id, "검토 대기" if review.flagged else "댓글 작성")
    db.commit(); db.refresh(comment)
    return _comment_out(comment, review, viewer_user_id=user.user_id)


# =====================================================================
# 외부 쇼핑몰 연동 (/api/shop/*) — 기본: https://ddmmall77.com
#   - 결제/주문은 쇼핑몰에서 처리, 이 시스템은 카탈로그·추천·클릭 로그만 관리
#   - 추천 v1: 규칙/콘텐츠 기반 (시설 유형 + 회원 규모 + 공지/수업의 행사 키워드 + 클릭 이력)
#   - 쇼핑몰이 /products.json 을 제공하면 POST /api/shop/sync 로 카탈로그 자동 갱신
# =====================================================================
SHOP_BASE_URL = os.getenv("SHOP_BASE_URL", "https://ddmmall77.com").rstrip("/")
SHOP_NAME = os.getenv("SHOP_NAME", "DDM")
SHOP_CATEGORIES = ["야구점퍼", "키링", "태권도 용품", "매달", "기타굿즈", "단체주문"]

SHOP_SEEDS = [
    {"external_id": "seed:jumper-team", "name": "단체 야구점퍼 맞춤 제작", "category": "야구점퍼",
     "description": "1벌부터 제작 · 시안 무료 · 10벌 이상 단체 할인", "path": "/custom.html",
     "tags": "단체복,유니폼,팀,행사,대회,졸업", "facility_types": ""},
    {"external_id": "seed:jumper-design", "name": "야구점퍼 직접 디자인하기", "category": "야구점퍼",
     "description": "정면·후면 디자인을 직접 구성하고 접수", "path": "/custom.html",
     "tags": "단체복,디자인,유니폼", "facility_types": ""},
    {"external_id": "seed:keyring", "name": "아크릴 키링 주문제작", "category": "키링",
     "description": "1개부터 · 4~7cm · 볼체인/열쇠고리 선택 · 개별 OPP 포장", "path": "/keyring.html",
     "tags": "기념품,선물,수료,졸업,이벤트,홍보", "facility_types": ""},
    {"external_id": "seed:medal", "name": "맞춤 매달", "category": "매달",
     "description": "대회·시상·승급 기념 매달 1개부터 제작", "path": "/index.html#list",
     "tags": "매달,시상,대회,승급,수료", "facility_types": ""},
    {"external_id": "seed:taekwondo", "name": "태권도 용품", "category": "태권도 용품",
     "description": "도장 운영에 필요한 태권도 용품", "path": "/index.html#list",
     "tags": "태권도,도복,띠,승급,심사", "facility_types": "도장"},
    {"external_id": "seed:goods", "name": "기타 굿즈", "category": "기타굿즈",
     "description": "기관 로고를 넣은 홍보·기념 굿즈", "path": "/index.html#list",
     "tags": "홍보,기념품,선물,모집", "facility_types": ""},
    {"external_id": "seed:inquiry", "name": "단체 주문 견적·시안 상담", "category": "단체주문",
     "description": "단체복 10벌 이상 할인 · 제작 7~10일 · 3만원 이상 무료배송", "path": "/inquiry.html",
     "tags": "단체복,견적,대회,행사", "facility_types": ""},
]

# (키워드들, 관련 상품 태그, 표시 이름)
SHOP_EVENT_RULES = [
    (("대회", "시합", "경기", "토너먼트"), ("매달", "대회", "단체복"), "대회"),
    (("심사", "승급", "승단", "품새"), ("승급", "매달", "태권도"), "승급·심사"),
    (("수료", "졸업", "종강", "방학식"), ("수료", "졸업", "기념품"), "수료·졸업"),
    (("행사", "캠프", "체육대회", "운동회", "발표회", "소풍", "축제", "공연"), ("행사", "단체복", "기념품"), "행사"),
    (("개강", "입관", "오픈", "신규", "모집", "체험"), ("홍보", "모집", "기념품"), "신규 모집"),
]


class ShopProductInput(BaseModel):
    name: str
    category: str
    url: str
    description: str = ""
    price: Optional[int] = None
    image_url: Optional[str] = None
    tags: str = ""
    facility_types: str = ""
    min_quantity: int = 1
    active: bool = True


class ShopClickInput(BaseModel):
    context: str = "catalog"


def _shop_url(path_or_url: str) -> str:
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url
    return f"{SHOP_BASE_URL}/{path_or_url.lstrip('/')}"


def _with_tracking(url: str, context: str) -> str:
    """쇼핑몰 유입 분석용 UTM 파라미터 (#fragment 는 유지)"""
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    query.update({"utm_source": "facility_manager", "utm_medium": "referral", "utm_content": context})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _split_csv(value: Optional[str]) -> List[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def _validate_http_url(url: str) -> str:
    url = (url or "").strip()
    if not re.fullmatch(r"https?://[^\s]+", url) and not url.startswith("/"):
        raise HTTPException(400, "상품 URL 은 http(s):// 로 시작하거나 쇼핑몰 기준 경로(/...)여야 합니다.")
    return _shop_url(url)[:500]


def _ensure_shop_products(db: Session) -> None:
    existing = {eid for (eid,) in db.query(ShopProduct.external_id).all()}
    missing = [seed for seed in SHOP_SEEDS if seed["external_id"] not in existing]
    if not missing:
        return
    for seed in missing:
        data = {k: v for k, v in seed.items() if k != "path"}
        db.add(ShopProduct(**data, url=_shop_url(seed["path"]), source="seed"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # 동시 첫 요청이 같은 시드를 넣은 경우


def _shop_product_out(p: ShopProduct, context: str = "catalog") -> dict:
    return {
        "product_id": p.product_id, "external_id": p.external_id, "name": p.name,
        "category": p.category, "description": p.description, "price": p.price,
        "price_label": f"{p.price:,}원~" if p.price else "견적 문의",
        "url": _with_tracking(p.url, context), "image_url": p.image_url,
        "tags": _split_csv(p.tags), "facility_types": _split_csv(p.facility_types),
        "min_quantity": p.min_quantity, "source": p.source, "active": bool(p.active),
    }


def _facility_type(db: Session) -> str:
    academy = _read_settings(db, "academy_info", DEFAULT_ACADEMY_SETTINGS)
    facility = academy.get("facilityType") or "학원"
    if facility == "학원" and re.search(r"태권|도장|합기|유도|검도|주짓수", academy.get("name", "")):
        facility = "도장"  # 설정 전 기관명으로 추정
    return facility


def _shop_context(db: Session) -> dict:
    """추천에 쓰는 시설 신호 수집 (개인정보 없이 집계/텍스트만)"""
    since_notice = _now() - timedelta(days=60)
    active_members = db.query(func.count(Member.member_id)).filter(Member.status == "ACTIVE").scalar() or 0
    class_sizes = (db.query(func.count(Enrollment.enrollment_id))
                     .join(Member, Member.member_id == Enrollment.member_id)
                     .filter(Member.status == "ACTIVE").group_by(Enrollment.class_id).all())
    largest_class = max((int(c) for (c,) in class_sizes), default=0)
    texts = [(f"공지 '{title}'", f"{title} {content}") for title, content in
             db.query(Notice.title, Notice.content).filter(Notice.created_at >= since_notice).limit(100).all()]
    texts += [(f"수업 '{name}'", f"{name} {desc or ''}") for name, desc in
              db.query(Class.name, Class.description).filter(Class.end_date >= _today()).limit(100).all()]
    events = []
    for keywords, tags, label in SHOP_EVENT_RULES:
        for source, text in texts:
            hit = next((kw for kw in keywords if kw in text), None)
            if hit:
                events.append({"label": label, "keyword": hit, "source": source, "tags": tags})
                break
    return {"facility_type": _facility_type(db), "active_members": int(active_members),
            "largest_class": largest_class, "events": events}


def _score_shop_product(p: ShopProduct, ctx: dict, clicks: int) -> tuple:
    tags = set(_split_csv(p.tags))
    facilities = _split_csv(p.facility_types)
    score, reasons = 1.0, []
    if facilities:
        if ctx["facility_type"] in facilities:
            score += 4
            reasons.append(f"{ctx['facility_type']} 시설 맞춤 상품")
        else:
            score -= 5
    for event in ctx["events"]:
        matched = tags.intersection(event["tags"])
        if matched:
            score += 3
            reasons.append(f"{event['source']}에서 '{event['keyword']}' 감지 → {event['label']} 준비")
    group = max(ctx["active_members"], ctx["largest_class"])
    if "단체복" in tags and group >= 10:
        score += 3
        reasons.append(f"활성 회원 {ctx['active_members']}명 · 최대 반 {ctx['largest_class']}명 — 10벌 이상 단체 할인 대상")
    elif "단체복" in tags and group > 0:
        score += 1
        reasons.append(f"활성 회원 {ctx['active_members']}명 규모 단체복")
    if clicks:
        score += min(3.0, round(clicks ** 0.5, 2))
        reasons.append(f"최근 90일 관리자 조회 {clicks}회")
    if not reasons:
        reasons.append("기본 추천 상품")
    return round(score, 2), reasons


@app.get("/api/shop/info")
def shop_info(account: AdminAccount = Depends(current_account)):
    return {"name": SHOP_NAME, "base_url": SHOP_BASE_URL, "categories": SHOP_CATEGORIES}


@app.get("/api/shop/products")
def list_shop_products(q: str = "", category: str = "", include_inactive: bool = False,
                       db: Session = Depends(get_db), account: AdminAccount = Depends(current_account)):
    _ensure_shop_products(db)
    query = db.query(ShopProduct)
    if not (include_inactive and account.role == "owner"):
        query = query.filter(ShopProduct.active.is_(True))
    if category and category != "전체":
        query = query.filter(ShopProduct.category == category)
    if q.strip():
        safe = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{safe}%"
        query = query.filter(or_(func.lower(ShopProduct.name).like(pattern, escape="\\"),
                                 func.lower(ShopProduct.tags).like(pattern, escape="\\")))
    return [_shop_product_out(p) for p in query.order_by(ShopProduct.category, ShopProduct.name).limit(200).all()]


@app.get("/api/shop/recommendations")
def shop_recommendations(limit: int = Query(6, ge=1, le=20), db: Session = Depends(get_db),
                         account: AdminAccount = Depends(current_account)):
    _ensure_shop_products(db)
    ctx = _shop_context(db)
    since = _now() - timedelta(days=90)
    clicks = dict(db.query(ShopClickEvent.product_id, func.count(ShopClickEvent.event_id))
                    .filter(ShopClickEvent.created_at >= since).group_by(ShopClickEvent.product_id).all())
    scored = []
    for p in db.query(ShopProduct).filter(ShopProduct.active.is_(True)).all():
        score, reasons = _score_shop_product(p, ctx, int(clicks.get(p.product_id, 0)))
        if score > 0:
            scored.append((score, p, reasons))
    scored.sort(key=lambda item: (-item[0], item[1].name))
    return {
        "strategy": "rule_based_v1",
        "context": {k: v for k, v in ctx.items() if k != "events"} | {
            "events": [{"label": e["label"], "keyword": e["keyword"], "source": e["source"]} for e in ctx["events"]]},
        "items": [{**_shop_product_out(p, "recommendation"), "score": score, "reasons": reasons}
                  for score, p, reasons in scored[:limit]],
    }


@app.post("/api/shop/products/{product_id}/click", status_code=201)
def log_shop_click(product_id: int, payload: ShopClickInput, db: Session = Depends(get_db),
                   account: AdminAccount = Depends(current_account)):
    if not db.query(ShopProduct.product_id).filter(ShopProduct.product_id == product_id).first():
        raise HTTPException(404, "상품을 찾을 수 없습니다.")
    context = payload.context if payload.context in ("catalog", "recommendation") else "catalog"
    db.add(ShopClickEvent(account_id=account.account_id, product_id=product_id, context=context))
    db.commit()
    return {"ok": True}


@app.post("/api/shop/products", status_code=201)
def create_shop_product(payload: ShopProductInput, db: Session = Depends(get_db),
                        account: AdminAccount = Depends(owner_account)):
    if not payload.name.strip() or not payload.category.strip():
        raise HTTPException(400, "상품명과 분류를 입력하세요.")
    row = ShopProduct(
        external_id=f"manual:{uuid.uuid4().hex[:12]}", name=payload.name.strip()[:200],
        category=payload.category.strip()[:60], description=payload.description.strip()[:500],
        price=payload.price if payload.price and payload.price > 0 else None,
        url=_validate_http_url(payload.url), image_url=(payload.image_url or None) and payload.image_url[:500],
        tags=payload.tags[:300], facility_types=payload.facility_types[:100],
        min_quantity=max(1, payload.min_quantity), source="manual", active=payload.active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _shop_product_out(row)


@app.put("/api/shop/products/{product_id}")
def update_shop_product(product_id: int, payload: ShopProductInput, db: Session = Depends(get_db),
                        account: AdminAccount = Depends(owner_account)):
    row = db.query(ShopProduct).filter(ShopProduct.product_id == product_id).first()
    if not row:
        raise HTTPException(404, "상품을 찾을 수 없습니다.")
    row.name, row.category = payload.name.strip()[:200], payload.category.strip()[:60]
    row.description = payload.description.strip()[:500]
    row.price = payload.price if payload.price and payload.price > 0 else None
    row.url = _validate_http_url(payload.url)
    row.image_url = (payload.image_url or None) and payload.image_url[:500]
    row.tags, row.facility_types = payload.tags[:300], payload.facility_types[:100]
    row.min_quantity, row.active = max(1, payload.min_quantity), payload.active
    db.commit()
    db.refresh(row)
    return _shop_product_out(row)


@app.delete("/api/shop/products/{product_id}", status_code=204)
def deactivate_shop_product(product_id: int, db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    """삭제 대신 비활성화(클릭 로그 보존). 시드 상품도 다시 생성되지 않습니다."""
    row = db.query(ShopProduct).filter(ShopProduct.product_id == product_id).first()
    if not row:
        raise HTTPException(404, "상품을 찾을 수 없습니다.")
    row.active = False
    db.commit()


@app.post("/api/shop/sync")
def sync_shop_products(db: Session = Depends(get_db), account: AdminAccount = Depends(owner_account)):
    """쇼핑몰의 {SHOP_BASE_URL}/products.json 을 읽어 카탈로그를 갱신 (형식은 README 참고)"""
    feed_url = os.getenv("SHOP_FEED_URL", f"{SHOP_BASE_URL}/products.json")
    try:
        resp = requests.get(feed_url, timeout=10, headers={"Accept": "application/json"})
    except requests.RequestException as exc:
        logger.warning("쇼핑몰 상품 피드 요청 실패: %s", exc)
        raise HTTPException(502, "쇼핑몰에 연결하지 못했습니다.")
    if resp.status_code != 200:
        raise HTTPException(404, f"쇼핑몰 상품 피드를 찾지 못했습니다({resp.status_code}). {feed_url} 에 products.json 을 올려 주세요.")
    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(502, "상품 피드가 JSON 형식이 아닙니다.")
    items = data.get("products", []) if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise HTTPException(502, "상품 피드 형식이 올바르지 않습니다.")
    created = updated = 0
    shop_host = urlsplit(SHOP_BASE_URL).netloc
    for item in items[:500]:
        if not isinstance(item, dict) or not item.get("id") or not item.get("name"):
            continue
        url = _shop_url(str(item.get("url") or "/index.html"))
        if urlsplit(url).netloc != shop_host:
            continue  # 다른 도메인으로의 링크는 받지 않음 (오픈 리다이렉트/피싱 방지)
        tags = item.get("tags") or ""
        tags = ",".join(tags) if isinstance(tags, list) else str(tags)
        facility_types = item.get("facility_types") or ""
        facility_types = ",".join(facility_types) if isinstance(facility_types, list) else str(facility_types)
        external_id = f"sync:{str(item['id'])[:70]}"
        row = db.query(ShopProduct).filter(ShopProduct.external_id == external_id).first()
        if not row:
            row = ShopProduct(external_id=external_id, source="sync")
            db.add(row)
            created += 1
        else:
            updated += 1
        row.name = str(item["name"])[:200]
        row.category = str(item.get("category") or "기타굿즈")[:60]
        row.description = str(item.get("description") or "")[:500]
        price = item.get("price")
        row.price = int(price) if isinstance(price, (int, float)) and price > 0 else None
        row.url = url[:500]
        image = item.get("image") or item.get("image_url")
        row.image_url = _shop_url(str(image))[:500] if image else None
        row.tags, row.facility_types = tags[:300], facility_types[:100]
        row.min_quantity = max(1, int(item.get("min_quantity") or 1))
        row.active = bool(item.get("active", True))
    db.commit()
    return {"feed_url": feed_url, "created": created, "updated": updated}


# =====================================================================
# 운영: 헬스 체크 / Vercel Cron
# =====================================================================
def _db_connection_hint(exc: Exception) -> str:
    """DB 연결 실패 원인 추정 (비밀번호 등 비밀 값은 응답에 넣지 않음)"""
    message = str(getattr(exc, "orig", exc)).lower()
    if "timeout" in message or "timed out" in message:
        return "연결 시간 초과 — Supabase 'Transaction pooler'(포트 6543) 주소인지 확인하세요. db.<프로젝트>.supabase.co 직접 연결은 IPv6 전용이라 Vercel 에서 접속되지 않습니다."
    if "password authentication failed" in message:
        return "비밀번호가 틀렸습니다 — [ ] 괄호를 지웠는지, 특수문자를 URL 인코딩했는지 확인하세요."
    if "tenant or user not found" in message:
        return "사용자명이 잘못되었습니다 — 풀러 주소의 사용자명은 postgres.<프로젝트ID> 형식이어야 합니다."
    if "could not translate host name" in message or "name or service not known" in message or "nodename nor servname" in message:
        return "호스트 주소를 찾지 못했습니다 — Supabase 에서 복사한 주소를 그대로 붙여 넣었는지 확인하세요."
    if "paused" in message or "not available" in message:
        return "Supabase 프로젝트가 일시 중지되었을 수 있습니다 — 대시보드에서 Restore 하세요."
    return "DATABASE_URL 과 Supabase 프로젝트 상태를 확인하세요."


@app.get("/api/health")
def health():
    """배포 확인용 상태 점검. 비밀 값은 절대 포함하지 않고 '설정됨/안 됨'만 알려 줍니다."""
    result = {
        "ok": False, "version": app.version, "db": DB_DIALECT, "serverless": IS_SERVERLESS,
        "timezone": APP_TIMEZONE, "today": _today().isoformat(),
        "db_connected": False, "tables_ready": False,
        "config": {
            "google_login": bool(GOOGLE_CLIENT_ID),
            "admin_invite_code": bool(_usable_code(ADMIN_SIGNUP_CODE)),
            "cron_secret": bool(CRON_SECRET),
            "kakao_pay": bool(KAKAO_SECRET_KEY),
            "gemini_ai": bool(GEMINI_API_KEY),
        },
    }
    if DATABASE_PROBLEM:
        result["problem"] = DATABASE_PROBLEM
        return result
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            result["db_connected"] = True
            insp = inspect(conn)
            result["tables_ready"] = all(insp.has_table(t) for t in ("app_users", "community_photos", "notifications"))
    except Exception as exc:   # 원인 안내만 하고 예외 내용(호스트·사용자명)은 노출하지 않음
        logger.error("헬스 체크 DB 연결 실패: %s", exc)
        result["problem"] = _db_connection_hint(exc)
        return result
    if not result["tables_ready"]:
        result["problem"] = _MISSING_TABLE_HINT
    elif not result["config"]["google_login"]:
        result["problem"] = "GOOGLE_CLIENT_ID 가 없습니다 — Google 로그인 버튼이 표시되지 않습니다."
    elif not result["config"]["admin_invite_code"]:
        result["problem"] = f"ADMIN_SIGNUP_CODE({MIN_INVITE_CODE_LENGTH}자 이상)가 없습니다 — 최초 관리자를 등록할 수 없습니다."
    result["ok"] = result["db_connected"] and result["tables_ready"]
    return result


@app.get("/api/cron/cleanup")
def cron_cleanup(request: Request, db: Session = Depends(get_db)):
    """Vercel Cron 전용. Vercel 은 CRON_SECRET 환경변수를 Authorization: Bearer 헤더로 보냅니다."""
    if not CRON_SECRET:
        raise HTTPException(503, "CRON_SECRET 이 설정되지 않았습니다.")
    if not secrets.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {CRON_SECRET}".encode()):
        raise HTTPException(401, "인증 실패")
    result = _cleanup_pending(db, CLEANUP_TERMINAL_MINUTES, CLEANUP_READY_MINUTES)
    expired = (db.query(UserSession)
                 .filter(or_(UserSession.expires_at < _now(), UserSession.revoked.is_(True)))
                 .delete(synchronize_session=False))
    # v8.1: 읽은 알림 90일, 동작 로그 1년 보관
    old_notifications = (db.query(Notification)
                           .filter(Notification.is_read.is_(True), Notification.created_at < _now() - timedelta(days=90))
                           .delete(synchronize_session=False))
    old_logs = db.query(ActivityLog).filter(ActivityLog.created_at < _now() - timedelta(days=365)).delete(synchronize_session=False)
    db.commit()
    return {**result, "expired_sessions_deleted": expired, "old_notifications_deleted": old_notifications,
            "old_activity_logs_deleted": old_logs}


# ---------------------------------------------------------------------
# 테이블 생성은 모든 모델이 정의된 "맨 마지막"에 호출.
#   기존 테이블·데이터는 건드리지 않고, 없는 테이블만 새로 만듭니다(비파괴).
#   권장: Supabase SQL Editor 에서 저장소 루트의 setup.sql 을 한 번 실행.
#   (setup.sql 을 깜빡해도 첫 요청 때 자동 생성되도록 AUTO_CREATE_TABLES 기본값은 true)
# ---------------------------------------------------------------------
# 이미 있는 테이블에 나중에 추가된 컬럼 (create_all 은 기존 테이블에 컬럼을 추가하지 않으므로 ALTER 로 보완)
#   (테이블, 컬럼, 타입, 인덱스 이름) — 모두 NULL 허용 컬럼이라 기존 데이터에 영향 없음
COLUMN_PATCHES = [
    ("notices", "class_id", "INTEGER", "ix_notices_class_id"),
    ("classes", "schedule_detail", "TEXT", None),
    ("community_comments", "user_id", "INTEGER", "ix_community_comments_user_id"),
]


def _apply_column_patches(existing: set) -> List[str]:
    targets = [p for p in COLUMN_PATCHES if p[0] in existing]
    if not targets:
        return []
    added = []
    with engine.begin() as conn:
        insp = inspect(conn)
        columns = {table: {c["name"] for c in insp.get_columns(table)} for table in {p[0] for p in targets}}
        for table, column, ddl, index in targets:
            if column in columns[table]:
                continue
            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}'))
            if index:
                conn.execute(text(f'CREATE INDEX IF NOT EXISTS {index} ON "{table}" ("{column}")'))
            added.append(f"{table}.{column}")
    if added:
        logger.info("컬럼 추가: %s", ", ".join(added))
    return added


def init_db() -> List[str]:
    """없는 테이블만 만들고, 새로 만든 테이블 이름을 돌려줌. 모두 있으면 조회 몇 번으로 끝남(콜드스타트 부담 최소)."""
    existing = set(inspect(engine).get_table_names())
    _apply_column_patches(existing)
    missing = [t for t in Base.metadata.sorted_tables if t.name not in existing]
    if not missing:
        return []
    Base.metadata.create_all(bind=engine, tables=missing)
    if DB_DIALECT == "postgresql":
        # Supabase 는 public 스키마를 Data API(anon 키)로 노출하므로 RLS 를 켜서 직접 접근을 막음.
        # (이 앱은 DB 비밀번호로 접속하는 백엔드만 쓰므로 RLS 정책이 없어도 정상 동작)
        with engine.begin() as conn:
            for table in missing:
                conn.execute(text(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY'))
    logger.info("테이블 생성: %s", ", ".join(t.name for t in missing))
    return [t.name for t in missing]


if os.getenv("AUTO_CREATE_TABLES", "true").lower() == "true" and not DATABASE_PROBLEM:
    try:
        init_db()
    except Exception as exc:  # DB 미기동 상태에서도 import 는 되도록 (헬스 체크/에러 메시지 확인용)
        logger.error("테이블 자동 생성 실패 — DATABASE_URL 과 DB 상태를 확인하세요: %s", exc)

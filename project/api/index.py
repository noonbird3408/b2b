"""Vercel Python 서버리스 진입점.

vercel.json 의 rewrites 가 /api/* 요청을 이 함수로 보내고, FastAPI 는 원래 경로(/api/...)를
그대로 받아 라우팅합니다. 로컬 개발에서는 이 파일을 쓰지 않습니다(uvicorn main:app).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from main import app  # noqa: E402,F401  (Vercel 이 ASGI app 변수를 찾아 실행)

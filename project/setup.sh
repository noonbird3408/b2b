#!/usr/bin/env bash
# 시설 통합 관리 시스템 - 배포 준비 도우미:  ./setup.sh  (예: ./setup.sh check)  권한 오류 시: chmod +x setup.sh
cd "$(dirname "$0")" || exit 1
PY=$(command -v python3 || command -v python)
[ -z "$PY" ] && { echo "Python 3.10 이상을 설치하세요."; exit 1; }
exec "$PY" setup.py "$@"

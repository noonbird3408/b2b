@echo off
REM 시설 통합 관리 시스템 - 배포 준비 도우미 (더블클릭해서 실행). 예: setup.bat check / setup.bat demo
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 setup.py %*
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    python setup.py %*
  ) else (
    echo [오류] Python 3.10 이상을 설치하세요: https://www.python.org/downloads/  ^(설치 시 "Add python.exe to PATH" 체크^)
  )
)
pause

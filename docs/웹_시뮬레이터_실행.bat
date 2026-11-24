@echo off
chcp 949 >nul
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
    echo [로컬 서버 모드] Python이 감지되어 폴더 자동저장 서버와 함께 브라우저를 실행합니다...
    start "" python server.py
) else (
    echo [단독 웹 모드] 기본 웹 브라우저로 노후 현금흐름 시뮬레이터를 실행합니다...
    start "" "%~dp0index.html"
)

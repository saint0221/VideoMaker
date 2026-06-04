@echo off
setlocal EnableDelayedExpansion

set PORT=3000
set APP_DIR=%~dp0
set LOG=%TEMP%\youtube-pd-server.log

:: Node.js 확인
where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 설치해주세요.
    pause
    exit /b 1
)

:: 이미 실행 중?
curl -s "http://localhost:%PORT%" >nul 2>&1
if not errorlevel 1 (
    echo [OK] 서버가 이미 실행 중입니다 -^> http://localhost:%PORT%
    start "" "http://localhost:%PORT%"
    exit /b 0
)

echo [>>] YouTube PD 서버 시작 중...
cd /d "%APP_DIR%"

:: .env.local 로드 (기존 환경변수 덮어쓰기)
if exist ".env.local" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /v "^#" .env.local`) do (
        if not "%%A"=="" set %%A=%%B
    )
)

:: ANTHROPIC_API_KEY 제거 후 서버 시작
set ANTHROPIC_API_KEY=
start /b cmd /c "npm run dev > "%LOG%" 2>&1"

:: 최대 30초 대기
echo 서버 준비 대기 중
for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    curl -s "http://localhost:%PORT%" >nul 2>&1
    if not errorlevel 1 (
        echo [OK] 서버 준비 완료 (%%i초)
        start "" "http://localhost:%PORT%"
        echo [i] 로그: %LOG%
        exit /b 0
    )
    set /p "=." <nul
)

echo.
echo [X] 서버 시작 실패. 로그 확인: %LOG%
pause
exit /b 1

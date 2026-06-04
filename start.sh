#!/bin/bash
set -euo pipefail

# 스크립트가 있는 디렉토리를 앱 루트로 사용 (경로 하드코딩 불필요)
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3000
LOG="/tmp/youtube-pd-server.log"
PID_FILE="/tmp/youtube-pd.pid"

# Load nvm / brew node
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node > /dev/null 2>&1; then
    echo "❌ Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 설치해주세요."
    exit 1
fi

# 브라우저 열기 (macOS / Linux 크로스플랫폼)
open_browser() {
    if command -v open > /dev/null 2>&1; then
        open "http://localhost:$PORT"       # macOS
    elif command -v xdg-open > /dev/null 2>&1; then
        xdg-open "http://localhost:$PORT"   # Linux
    fi
}

# Already running?
if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
    echo "✅ 서버가 이미 실행 중입니다 → http://localhost:$PORT"
    open_browser
    exit 0
fi

# Kill stale PID
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    kill "$OLD_PID" 2>/dev/null || true
    rm -f "$PID_FILE"
fi

echo "🚀 YouTube PD 서버 시작 중..."
cd "$APP_DIR"

# Load .env.local explicitly so shell env vars don't override it
ENV_FILE="$APP_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
        export "$key=$value"
    done < <(grep -v '^#' "$ENV_FILE" | grep '=')
fi

nohup env -u ANTHROPIC_API_KEY npm run dev > "$LOG" 2>&1 &
echo $! > "$PID_FILE"

# Wait up to 30s
for i in {1..30}; do
    if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
        echo "✅ 서버 준비 완료 (${i}초)"
        open_browser
        echo "📋 로그: tail -f $LOG"
        exit 0
    fi
    printf "."
    sleep 1
done

echo ""
echo "❌ 서버 시작 실패. 로그 확인: tail -f $LOG"
exit 1

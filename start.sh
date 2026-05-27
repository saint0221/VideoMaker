#!/bin/bash
set -euo pipefail

APP_DIR="/Users/hongss/VideoMaker"
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

# Already running?
if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
    echo "✅ 서버가 이미 실행 중입니다 → http://localhost:$PORT"
    open "http://localhost:$PORT"
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
        open "http://localhost:$PORT"
        echo "📋 로그: tail -f $LOG"
        exit 0
    fi
    printf "."
    sleep 1
done

echo ""
echo "❌ 서버 시작 실패. 로그 확인: tail -f $LOG"
exit 1

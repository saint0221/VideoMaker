#!/bin/bash
# EC2 배포 업데이트 스크립트
# 사용법: ./deploy.sh
# 위치: ~/VideoMaker/deploy.sh (EC2 서버)

set -e

cd "$(dirname "$0")"

echo "📦 최신 코드 가져오는 중..."
git checkout -- package-lock.json 2>/dev/null || true
git pull origin main

echo "📦 의존성 설치 중..."
npm install --production=false

echo "🔨 빌드 중..."
npm run build

echo "♻️  PM2 재시작..."
pm2 restart all

echo "✅ 배포 완료"
pm2 status

# VideoMaker — EC2 배포 가이드

팀원들과 공유 가능한 Next.js 16 앱을 EC2에 배포하는 완전한 단계별 가이드입니다.
SSE 스트리밍, 백그라운드 프로세스, 데이터 지속성을 고려해 구성했습니다.

---

## 1. EC2 인스턴스 선택 및 생성

### 권장 인스턴스 타입

| 사용 시나리오 | 권장 타입 | 이유 |
|-------------|---------|------|
| 팀 내부 공유 (5~10명 동시) | `t4g.medium` | Graviton3, 1GB 메모리로 충분, 비용 효율적 |
| 병렬 프로세스 많음 (이미지/영상 생성) | `t4g.large` | 2GB 메모리, 버스트 성능 제공 |
| 프로덕션 준비 (24/7) | `t4g.xlarge` 또는 `m7g.large` | 일정한 성능, Graviton3 비용 절감 |

**선택**: `t4g.medium` (테스트) 또는 `t4g.large` (권장)

### 인스턴스 생성 CLI 명령어

```bash
# 변수 설정
INSTANCE_TYPE="t4g.large"
AMI_ID="ami-0c9bfc21ac5bf10eb"  # Ubuntu 24.04 LTS (ap-northeast-2 리전)
KEY_PAIR_NAME="videomaker-key"
SECURITY_GROUP_NAME="videomaker-sg"
REGION="ap-northeast-2"

# 1. 키페어 생성 (처음 1회만)
aws ec2 create-key-pair \
  --key-name "$KEY_PAIR_NAME" \
  --region "$REGION" \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/videomaker-key.pem

chmod 400 ~/.ssh/videomaker-key.pem

# 2. 보안 그룹 생성
aws ec2 create-security-group \
  --group-name "$SECURITY_GROUP_NAME" \
  --description "VideoMaker deployment security group" \
  --region "$REGION"

# 생성된 보안 그룹 ID 확인
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SECURITY_GROUP_NAME" \
  --region "$REGION" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)

echo "Security Group ID: $SG_ID"

# 3. 보안 그룹 규칙 추가
# SSH (관리자만)
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0 \
  --region "$REGION"

# HTTP
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 \
  --region "$REGION"

# HTTPS
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region "$REGION"

# 4. EC2 인스턴스 생성
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_PAIR_NAME" \
  --security-group-ids "$SG_ID" \
  --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=50,VolumeType=gp3,DeleteOnTermination=true}" \
  --region "$REGION" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=VideoMaker},{Key=Environment,Value=team-shared}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"

# 5. 인스턴스가 running 상태가 될 때까지 대기
aws ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID" \
  --region "$REGION"

# 6. 퍼블릭 IP 주소 확인
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$REGION" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "Public IP: $PUBLIC_IP"
echo "SSH 접속: ssh -i ~/.ssh/videomaker-key.pem ubuntu@$PUBLIC_IP"
```

---

## 2. 서버 초기 설정

EC2 인스턴스에 SSH로 접속한 후 아래 명령어를 실행합니다.

```bash
# 자신의 IP로 대체
PUBLIC_IP="YOUR_PUBLIC_IP"
ssh -i ~/.ssh/videomaker-key.pem ubuntu@$PUBLIC_IP
```

### 서버 내 명령어들

```bash
# 1. 시스템 업데이트
sudo apt-get update && sudo apt-get upgrade -y

# 2. Node.js 22 설치 (NodeSource 저장소)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 버전 확인
node --version  # v22.x.x
npm --version   # 10.x.x

# 3. git, curl, wget 등 필수 도구 설치
sudo apt-get install -y git curl wget build-essential

# 4. PM2 전역 설치
sudo npm install -g pm2

# PM2 시작 스크립트 활성화 (재부팅 후 자동 시작)
sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu
sudo pm2 save

# 5. Nginx 설치
sudo apt-get install -y nginx

# Nginx 시작
sudo systemctl start nginx
sudo systemctl enable nginx

# 6. Certbot 설치 (Let's Encrypt SSL용, 도메인 있는 경우만)
sudo apt-get install -y certbot python3-certbot-nginx

# 7. 앱 디렉토리 생성
mkdir -p /home/ubuntu/videomaker
cd /home/ubuntu/videomaker
```

---

## 3. 앱 배포

```bash
# 현재 위치: /home/ubuntu/videomaker

# 1. 저장소 클론
git clone https://github.com/YOUR_ORG/VideoMaker.git .
# 또는 기존 로컬 리포지토리에서 push된 상태라면:
git clone <your-repo-url> .

# 2. 의존성 설치
npm install

# 3. 빌드 (프로덕션 최적화)
npm run build

# 빌드 결과 확인 (`.next` 폴더 생성됨)
ls -la .next

# 4. 빌드 후 불필요한 파일 제거 (선택)
rm -rf node_modules/.cache
```

---

## 4. 환경변수 관리

### 방법 1: `.env.local` 파일 (간단, 팀 내부용)

```bash
# /home/ubuntu/videomaker/.env.local 생성
cat > /home/ubuntu/videomaker/.env.local << 'EOF'
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxx
ELEVENLABS_API_KEY=xxxxxxxxxxxxxxx
FAL_API_KEY=xxxxxxxxxxxxxxx
KLING_API_KEY=xxxxxxxxxxxxxxx
YOUTUBE_CLIENT_ID=xxxxxxxxxxxxxxx
YOUTUBE_CLIENT_SECRET=xxxxxxxxxxxxxxx
YOUTUBE_REFRESH_TOKEN=xxxxxxxxxxxxxxx
NODE_ENV=production
EOF

# 파일 권한 설정 (ubuntu 사용자만 읽기)
chmod 600 /home/ubuntu/videomaker/.env.local

# .env.local이 git에 추가되지 않았는지 확인
cat /home/ubuntu/videomaker/.gitignore | grep -E "env.local|.env"
```

### 방법 2: AWS Secrets Manager (권장, 프로덕션)

```bash
# AWS CLI 설정 (선택사항, EC2 IAM Role을 추천)
# EC2 IAM Role이 이미 Secrets Manager 접근 권한을 가진다고 가정

# 시크릿 생성
aws secretsmanager create-secret \
  --name videomaker/env \
  --secret-string '{
    "ANTHROPIC_API_KEY": "sk-ant-xxxxxxxxxxxxxxx",
    "ELEVENLABS_API_KEY": "xxxxxxxxxxxxxxx",
    "FAL_API_KEY": "xxxxxxxxxxxxxxx",
    "KLING_API_KEY": "xxxxxxxxxxxxxxx",
    "YOUTUBE_CLIENT_ID": "xxxxxxxxxxxxxxx",
    "YOUTUBE_CLIENT_SECRET": "xxxxxxxxxxxxxxx",
    "YOUTUBE_REFRESH_TOKEN": "xxxxxxxxxxxxxxx"
  }' \
  --region ap-northeast-2

# 시크릿 조회
aws secretsmanager get-secret-value \
  --secret-id videomaker/env \
  --region ap-northeast-2 \
  --query 'SecretString' \
  --output text | jq .
```

#### Secrets Manager에서 환경변수 로드하는 스크립트

```bash
# /home/ubuntu/videomaker/load-secrets.sh 생성
cat > /home/ubuntu/videomaker/load-secrets.sh << 'EOF'
#!/bin/bash
set -e

SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id videomaker/env \
  --region ap-northeast-2 \
  --query 'SecretString' \
  --output text)

# 각 키-값을 환경변수로 내보내기
export ANTHROPIC_API_KEY=$(echo "$SECRET_JSON" | jq -r '.ANTHROPIC_API_KEY')
export ELEVENLABS_API_KEY=$(echo "$SECRET_JSON" | jq -r '.ELEVENLABS_API_KEY')
export FAL_API_KEY=$(echo "$SECRET_JSON" | jq -r '.FAL_API_KEY')
export KLING_API_KEY=$(echo "$SECRET_JSON" | jq -r '.KLING_API_KEY')
export YOUTUBE_CLIENT_ID=$(echo "$SECRET_JSON" | jq -r '.YOUTUBE_CLIENT_ID')
export YOUTUBE_CLIENT_SECRET=$(echo "$SECRET_JSON" | jq -r '.YOUTUBE_CLIENT_SECRET')
export YOUTUBE_REFRESH_TOKEN=$(echo "$SECRET_JSON" | jq -r '.YOUTUBE_REFRESH_TOKEN')
export NODE_ENV=production

exec "$@"
EOF

chmod +x /home/ubuntu/videomaker/load-secrets.sh
```

---

## 5. PM2 설정 — 자동 재시작 및 로그 관리

```bash
# /home/ubuntu/videomaker/ecosystem.config.js 생성
cat > /home/ubuntu/videomaker/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'videomaker',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/home/ubuntu/videomaker',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // 메모리 기반 재시작 (500MB 초과)
      max_memory_restart: '500M',
      // 크래시 시 자동 재시작
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      // 로그 파일
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/ubuntu/videomaker/logs/error.log',
      out_file: '/home/ubuntu/videomaker/logs/out.log',
      log_file: '/home/ubuntu/videomaker/logs/combined.log',
    },
  ],
};
EOF

# 로그 디렉토리 생성
mkdir -p /home/ubuntu/videomaker/logs

# PM2 시작
cd /home/ubuntu/videomaker
pm2 start ecosystem.config.js

# PM2 상태 확인
pm2 status

# PM2 로그 확인
pm2 logs videomaker

# 로그 보존 설정 (선택)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
pm2 save
```

---

## 6. Nginx 설정 — 리버스 프록시 & SSE

### 핵심: SSE를 위한 버퍼링 비활성화

```bash
# /etc/nginx/sites-available/videomaker 생성
sudo tee /etc/nginx/sites-available/videomaker > /dev/null << 'EOF'
upstream next_app {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name _;  # IP로만 접근하거나 도메인 입력

    # 도메인이 있으면 변경: server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 100M;  # 업로드 파일 크기 제한

    # SSE 스트리밍 설정
    location /api/projects/ {
        proxy_pass http://next_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE를 위해 버퍼링 비활성화
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;

        # 타임아웃 설정 (긴 실행 프로세스 고려)
        proxy_read_timeout 3600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }

    # 나머지 요청
    location / {
        proxy_pass http://next_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 일반 요청은 버퍼링 활성화 (성능)
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;

        # 타임아웃
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    # 데이터 디렉토리 직접 접근 차단
    location ~ /\.well-known {
        allow all;
    }
    location ~ /data/ {
        deny all;
    }
}
EOF

# Nginx 심볼릭 링크 생성
sudo ln -sf /etc/nginx/sites-available/videomaker /etc/nginx/sites-enabled/videomaker

# 기본 사이트 비활성화 (선택)
sudo rm -f /etc/nginx/sites-enabled/default

# Nginx 설정 테스트
sudo nginx -t

# Nginx 재시작
sudo systemctl restart nginx
```

---

## 7. SSL 설정 (Let's Encrypt)

### 도메인이 있는 경우

```bash
# 도메인을 Route 53에 등록했다고 가정

# 1. Route 53에서 DNS 레코드 확인
# A 레코드: yourdomain.com → EC2 Public IP
# CNAME: www.yourdomain.com → yourdomain.com

# 2. Certbot으로 인증서 발급
sudo certbot certonly \
  --standalone \
  -d yourdomain.com \
  -d www.yourdomain.com \
  -m your-email@example.com \
  --agree-tos \
  --non-interactive

# 인증서 위치
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem

# 3. Nginx 설정 업데이트
sudo tee /etc/nginx/sites-available/videomaker > /dev/null << 'EOF'
upstream next_app {
    server 127.0.0.1:3000;
}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 서버
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL 보안 설정
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 100M;

    # SSE 스트리밍
    location /api/projects/ {
        proxy_pass http://next_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        proxy_read_timeout 3600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }

    location / {
        proxy_pass http://next_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    location ~ /data/ {
        deny all;
    }
}
EOF

# Nginx 재시작
sudo systemctl restart nginx

# 4. 인증서 자동 갱신 (Certbot이 자동으로 설정함)
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### 도메인 없는 경우 (Self-Signed 인증서)

```bash
# 자체 서명 인증서 생성 (유효 기간 365일)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/videomaker.key \
  -out /etc/ssl/certs/videomaker.crt \
  -subj "/C=KR/ST=Seoul/L=Seoul/O=Team/CN=videomaker"

# Nginx 설정 (IP 주소로만 접근)
sudo tee /etc/nginx/sites-available/videomaker > /dev/null << 'EOF'
upstream next_app {
    server 127.0.0.1:3000;
}

server {
    listen 443 ssl http2 default_server;
    server_name _;

    ssl_certificate /etc/ssl/certs/videomaker.crt;
    ssl_certificate_key /etc/ssl/private/videomaker.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 100M;

    location /api/projects/ {
        proxy_pass http://next_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        proxy_read_timeout 3600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }

    location / {
        proxy_pass http://next_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    location ~ /data/ {
        deny all;
    }
}

# HTTP는 HTTPS로 리다이렉트 (선택)
server {
    listen 80 default_server;
    server_name _;
    return 301 https://$host$request_uri;
}
EOF

# Nginx 재시작
sudo systemctl restart nginx

# 브라우저 접속: https://YOUR_EC2_IP (자체 서명 경고 무시)
```

---

## 8. 데이터 디렉토리 보호

```bash
# data/ 폴더 권한 설정
sudo chown -R ubuntu:ubuntu /home/ubuntu/videomaker/data
chmod 700 /home/ubuntu/videomaker/data

# Nginx가 /data 경로에 접근하지 못하도록 이미 설정됨
# (위의 Nginx 설정에서 `location ~ /data/ { deny all; }`)

# data/ 폴더 백업 전략 (선택)
# 일일 자동 백업을 S3로 (다음 단계 참고)
```

---

## 9. 배포 검증

```bash
# EC2 SSH 접속
ssh -i ~/.ssh/videomaker-key.pem ubuntu@YOUR_PUBLIC_IP

# 1. PM2 상태 확인
pm2 status
pm2 logs videomaker --lines 50

# 2. Nginx 상태 확인
sudo systemctl status nginx

# 3. 포트 확인
sudo netstat -tlnp | grep -E '3000|80|443'

# 4. 앱 접속 확인 (브라우저 또는 curl)
# HTTP: curl http://YOUR_PUBLIC_IP/
# HTTPS: curl -k https://YOUR_PUBLIC_IP/

curl http://YOUR_PUBLIC_IP/api/projects
# JSON 응답 확인

# 5. SSE 스트림 테스트
curl -N http://YOUR_PUBLIC_IP/api/projects/test-project/stream

# 6. PM2 모니터링 대시보드
pm2 monit
```

---

## 10. 업데이트 배포

새로운 버전을 배포할 때의 절차:

```bash
# 로컬 머신에서 git push
git push origin main

# EC2 인스턴스에 SSH 접속
ssh -i ~/.ssh/videomaker-key.pem ubuntu@YOUR_PUBLIC_IP

# 서버에서 업데이트
cd /home/ubuntu/videomaker

# 1. 최신 코드 가져오기
git pull origin main

# 2. 의존성 업데이트 (필요 시)
npm install

# 3. 빌드
npm run build

# 4. PM2 재시작
pm2 restart videomaker

# 5. 로그 확인
pm2 logs videomaker --lines 30

# 모든 작업을 한 번에 실행하는 스크립트
cat > /home/ubuntu/videomaker/deploy.sh << 'EOF'
#!/bin/bash
set -e
cd /home/ubuntu/videomaker

echo "🔄 최신 코드 가져오기..."
git pull origin main

echo "📦 의존성 설치..."
npm install --omit=dev

echo "🏗️ 빌드..."
npm run build

echo "🔄 PM2 재시작..."
pm2 restart videomaker

echo "✅ 배포 완료!"
pm2 logs videomaker --lines 20
EOF

chmod +x /home/ubuntu/videomaker/deploy.sh

# 실행
/home/ubuntu/videomaker/deploy.sh
```

---

## 11. 데이터 백업 — S3 (선택)

```bash
# IAM 역할로 S3 접근 권한이 있다고 가정
# (EC2 시작 시 IAM Role 지정)

# 1. S3 버킷 생성
aws s3 mb s3://videomaker-backups-$(date +%s) --region ap-northeast-2

# 2. 자동 백업 스크립트
cat > /home/ubuntu/videomaker/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
S3_BUCKET="s3://videomaker-backups-YOUR_BUCKET_ID"
DATA_DIR="/home/ubuntu/videomaker/data"

echo "📦 백업 시작: $BACKUP_DATE"
aws s3 sync "$DATA_DIR" "$S3_BUCKET/backup-$BACKUP_DATE/" \
  --region ap-northeast-2 \
  --delete

echo "✅ 백업 완료"
EOF

chmod +x /home/ubuntu/videomaker/backup.sh

# 3. Cron으로 매일 자정 자동 백업
(crontab -l 2>/dev/null || echo "") | grep -v backup.sh | crontab -
(crontab -l 2>/dev/null || echo ""; echo "0 0 * * * /home/ubuntu/videomaker/backup.sh >> /var/log/videomaker-backup.log 2>&1") | crontab -

# 확인
crontab -l
```

---

## 12. 모니터링 및 유지보수

```bash
# PM2 리소스 모니터링
pm2 monit

# PM2 로그 rotate (자동)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
pm2 save

# 디스크 사용량 확인
df -h

# 메모리 사용량 확인
free -h

# Nginx 접근 로그 확인
sudo tail -f /var/log/nginx/access.log

# Nginx 에러 로그 확인
sudo tail -f /var/log/nginx/error.log

# 시스템 로그 확인
sudo journalctl -u nginx -f
sudo journalctl -u pm2-ubuntu -f
```

---

## 13. 긴급 문제 해결

### PM2 프로세스 재시작

```bash
pm2 restart videomaker
# 또는 모든 프로세스 재시작
pm2 restart all
```

### Nginx 설정 오류

```bash
# 설정 테스트
sudo nginx -t

# 기본 설정으로 복구
sudo cp /etc/nginx/sites-available/default.bak /etc/nginx/sites-enabled/default

# Nginx 재시작
sudo systemctl restart nginx
```

### 포트 충돌 확인

```bash
# 3000 포트 사용 중인 프로세스 확인
sudo lsof -i :3000

# 프로세스 강제 종료
sudo kill -9 <PID>

# PM2 재시작
pm2 restart videomaker
```

### 데이터 디렉토리 복구

```bash
# data/ 폴더가 손상된 경우 S3에서 복구
aws s3 sync s3://videomaker-backups-YOUR_BUCKET_ID/backup-LATEST/ \
  /home/ubuntu/videomaker/data \
  --region ap-northeast-2

# 권한 재설정
sudo chown -R ubuntu:ubuntu /home/ubuntu/videomaker/data
```

---

## 14. 환경변수 보안 체크리스트

배포 전 반드시 확인:

- [ ] `.env.local` 파일이 git에 추가되지 않음 (`.gitignore` 확인)
- [ ] EC2에 `.env.local` 또는 Secrets Manager로 환경변수 설정
- [ ] API 키가 로그에 노출되지 않음 (PM2 로그 확인)
- [ ] Nginx가 `/data` 경로 직접 접근 차단
- [ ] SSL 인증서 설정 완료 (Let's Encrypt 또는 self-signed)
- [ ] 백업 스크립트 실행 확인 (S3 sync)

---

## 15. 팀원 접속 정보

배포 완료 후 팀원들에게 공유:

```
앱 URL:
- HTTP: http://YOUR_EC2_PUBLIC_IP:80/
- HTTPS: https://YOUR_EC2_PUBLIC_IP:443/

또는 도메인 설정 시:
- https://yourdomain.com/

로그인 정보:
- YouTube OAuth 설정 완료 시 자동 로그인

지원 연락처:
- 배포 담당자: your-email@example.com
```

---

## 16. 비용 최적화 (월별 예상 비용)

| 리소스 | 규격 | 월 비용 |
|--------|------|---------|
| EC2 t4g.large | 2 vCPU, 8GB | ~$30 |
| EBS gp3 (50GB) | — | ~$2 |
| 데이터 전송 (나가기) | ~50GB | ~$4 |
| **합계** | — | **~$36 USD** |

비용 절감:
- 야간 자동 종료 (개발 단계): 추가 설정으로 50% 절감
- Reserved Instance (1년): 35% 절감
- Spot Instance: 70% 절감 (재시작 위험)

---

## 정리

**핵심 설정 요약:**

1. `t4g.large` EC2 (Graviton3, 비용 효율적)
2. Ubuntu 24.04 LTS
3. Node.js 22, npm
4. **PM2**: 자동 재시작, 로그 관리
5. **Nginx**: 리버스 프록시, SSE 버퍼링 OFF, 데이터 폴더 보호
6. **SSL**: Let's Encrypt (도메인) 또는 self-signed (내부)
7. **환경변수**: `.env.local` 또는 Secrets Manager
8. **백업**: S3 일일 sync
9. **모니터링**: PM2 로그, Nginx 로그

**일반적인 배포 소요 시간**: 30분 (SSL 인증서 발급 시간 제외)

**다음 단계**: 
- 도메인 구입 후 Route 53에 등록
- Let's Encrypt 인증서 발급
- 팀원 초대 및 테스트


#!/bin/bash
# Kiểm tra trạng thái hệ thống setupads.site

echo "=== Health Check: setupads.site ==="
echo ""

check() {
  local name=$1 cmd=$2
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✓ $name"
  else
    echo "✗ $name"
  fi
}

check "MySQL database" "mysql -u setu_setupads -p'*iF8ZxEf%SkEtBb6' setu_setupads -e 'SELECT 1'"
check "Redis" "redis-cli ping | grep -q PONG"
check "Next.js (port 3001)" "curl -sf -o /dev/null http://127.0.0.1:3001/login"
check "AI Service (port 8001)" "curl -sf http://127.0.0.1:8001/health | grep -q ok"
check "HTTPS site" "curl -sfk -o /dev/null https://setupads.site/login"
check "PM2 setupads" "pm2 describe setupads | grep -q online"
check "PM2 setupads-ai" "pm2 describe setupads-ai | grep -q online"

echo ""
echo "=== API Keys ==="
ENV="/home/setupads.site/public_html/apps/web/.env.local"
for key in FACEBOOK_CLIENT_ID GOOGLE_AI_API_KEY OPENAI_API_KEY; do
  val=$(grep "^${key}=" "$ENV" 2>/dev/null | sed 's/^[^=]*=//' | tr -d '"')
  if [ -n "$val" ]; then
    echo "✓ $key đã cấu hình"
  else
    echo "✗ $key chưa cấu hình (cần điền để dùng đầy đủ tính năng)"
  fi
done

echo ""
echo "AI models:" 
curl -s http://127.0.0.1:8001/health 2>/dev/null || echo "AI service không phản hồi"

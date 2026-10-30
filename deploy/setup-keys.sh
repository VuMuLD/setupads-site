#!/bin/bash
# Setup / cập nhật API keys cho setupads.site
# Usage: ./deploy/setup-keys.sh

ENV_FILE="/home/setupads.site/public_html/apps/web/.env.local"
AI_ENV="/home/setupads.site/public_html/apps/ai-service/.env"

echo "=== Setup API Keys cho setupads.site ==="
echo ""

read -p "Facebook App ID (FACEBOOK_CLIENT_ID): " FB_ID
read -p "Facebook App Secret (FACEBOOK_CLIENT_SECRET): " FB_SECRET
read -p "Google AI API Key (Gemini): " GOOGLE_KEY
read -p "OpenAI API Key (tùy chọn, Enter để bỏ qua): " OPENAI_KEY
read -p "Anthropic API Key (tùy chọn, Enter để bỏ qua): " ANTHROPIC_KEY

update_env() {
  local file=$1 key=$2 val=$3
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=\"${val}\"|" "$file"
  else
    echo "${key}=\"${val}\"" >> "$file"
  fi
}

[ -n "$FB_ID" ] && update_env "$ENV_FILE" "FACEBOOK_CLIENT_ID" "$FB_ID"
[ -n "$FB_ID" ] && update_env "$ENV_FILE" "NEXT_PUBLIC_FACEBOOK_CLIENT_ID" "$FB_ID"
[ -n "$FB_SECRET" ] && update_env "$ENV_FILE" "FACEBOOK_CLIENT_SECRET" "$FB_SECRET"
[ -n "$GOOGLE_KEY" ] && update_env "$ENV_FILE" "GOOGLE_AI_API_KEY" "$GOOGLE_KEY"
[ -n "$OPENAI_KEY" ] && update_env "$ENV_FILE" "OPENAI_API_KEY" "$OPENAI_KEY"
[ -n "$ANTHROPIC_KEY" ] && update_env "$ENV_FILE" "ANTHROPIC_API_KEY" "$ANTHROPIC_KEY"

[ -n "$GOOGLE_KEY" ] && update_env "$AI_ENV" "GOOGLE_AI_API_KEY" "$GOOGLE_KEY"
[ -n "$OPENAI_KEY" ] && update_env "$AI_ENV" "OPENAI_API_KEY" "$OPENAI_KEY"
[ -n "$ANTHROPIC_KEY" ] && update_env "$AI_ENV" "ANTHROPIC_API_KEY" "$ANTHROPIC_KEY"

echo ""
echo "Đang restart services..."
pm2 restart setupads setupads-ai
pm2 save

echo ""
echo "=== Hoàn tất! ==="
echo "Truy cập: https://setupads.site"
echo ""
echo "Facebook OAuth Redirect URI cần cấu hình trong Meta Developer:"
echo "  https://setupads.site/api/auth/callback/facebook"

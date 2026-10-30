# FB Ads Manager + AI Optimizer

SaaS quản lý quảng cáo Facebook tích hợp AI tư vấn tối ưu chi phí.

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Shadcn/UI, Recharts
- **Backend**: Next.js API Routes, NextAuth v5
- **AI Service**: Python FastAPI (Gemini 2.5 Flash, GPT-4o, Claude 3.5 Sonnet)
- **Database**: MySQL 8 (Prisma ORM)
- **Cache/Queue**: Redis + BullMQ
- **Cron**: node-cron (sync 6h, báo cáo ngày 7AM, báo cáo tuần Thứ 2)

## Yêu cầu

- Node.js 18+
- MySQL 8 (XAMPP/WAMP, port 3306)
- Python 3.12+ (cho AI service)
- Docker (tùy chọn, cho Redis + AI service)

## Cài đặt

### 1. Database MySQL

Tạo database qua phpMyAdmin:
```sql
CREATE DATABASE fb_ads_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Environment

```bash
cp .env.example apps/web/.env.local
```

Điền các giá trị:
- `DATABASE_URL=mysql://root@localhost:3306/fb_ads_manager`
- `NEXTAUTH_SECRET` - random 32+ chars
- `ENCRYPTION_KEY` - random 64 chars hex
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` - từ Meta Developer
- `GOOGLE_AI_API_KEY` - Gemini API key

### 3. Install & Migrate

```bash
npm install
npm run db:push
```

### 4. Chạy development

```bash
# Terminal 1: Next.js
npm run dev

# Terminal 2: AI Service (Python)
cd apps/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 3 (tùy chọn): Redis + AI via Docker
docker-compose up -d
```

Truy cập: http://localhost:3000

## Facebook App Setup

1. Tạo app tại https://developers.facebook.com
2. Thêm Facebook Login product
3. Permissions: `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`
4. OAuth Redirect: `http://localhost:3000/api/auth/callback/facebook`

## Cấu trúc

```
apps/web/          - Next.js frontend + API
apps/ai-service/   - Python FastAPI AI service
packages/shared/   - Shared types
```

## Tính năng

- Facebook OAuth login + quản lý Pages/Ad Accounts
- CRUD campaigns, ad sets, ads
- Dashboard metrics realtime
- AI phân tích hàng ngày/tuần (Gemini + GPT + Claude consensus)
- AI Chat Advisor
- Automation rules engine + auto-pilot
- Notifications (Web, Email, Telegram)
- Báo cáo export CSV
- AES-256 token encryption, rate limiting, audit log

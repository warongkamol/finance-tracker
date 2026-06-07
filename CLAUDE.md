# Finance Tracker — ระบบบันทึกรายรับรายจ่าย

## Project Overview
Mobile-first PWA สำหรับบันทึกรายรับ-รายจ่ายส่วนบุคคล ติดตามหนี้สิน/ผ่อนชำระ
วางแผนงบการเงินล่วงหน้า 12 เดือน พร้อม dashboard สรุปภาพรวมและ export รายงาน

## Tech Stack
- **Framework**: Next.js 14+ (App Router) + TypeScript
- **Database**: PostgreSQL 16 + Prisma ORM
- **Auth**: NextAuth.js v5 (Auth.js) — email/password, bcrypt
- **UI**: Tailwind CSS + shadcn/ui (mobile-first design)
- **Charts**: Recharts
- **Export**: html2canvas (image) + jsPDF (PDF)
- **Push Notifications**: Web Push API + Service Worker
- **Deploy**: Docker Compose + Traefik on VPS

## Infrastructure
- **VPS**: Hostinger — 1 core CPU, 4GB RAM, 50GB disk, Ubuntu
- **Reverse Proxy**: Traefik (existing, shared with n8n and other services)
- **Domain**: `finance.srv1068566.hstgr.cloud` (Hostinger subdomain)
- **SSL**: Auto via Traefik + Let's Encrypt
- **Source Control**: GitHub

## Key Documents
- `docs/TECHNICAL_SPEC.md` — Full specification, DB schema, API design, dev phases
- `prisma/schema.prisma` — Database schema (source of truth for DB)
- `docs/CHANGELOG.md` — Track what changed per phase

## Development Phases
- [x] Phase 0: Documentation & Project Setup
- [ ] Phase 1: Foundation — Auth + Transactions + Categories (MVP)
- [ ] Phase 2: Debt & Installments + PayLater flow
- [ ] Phase 3: Dashboard + Charts
- [ ] Phase 4: Budget Planning (12-month)
- [ ] Phase 5: Notifications & Recurring Transactions (PWA)
- [ ] Phase 6: Export (PDF/Image)
- [ ] Phase 7: Family Features (tag-based MVP)

## Current Phase: Phase 1

## Code Conventions
- **Language**: TypeScript strict mode
- **UI Text**: ภาษาไทย
- **Code / Comments / Commit messages**: English
- **Components**: Functional components + React hooks only
- **Naming**: camelCase (variables/functions), PascalCase (components/types/interfaces)
- **API Routes**: `/api/v1/[resource]` — RESTful
- **Database columns**: snake_case via Prisma `@map`
- **Validation**: Zod schemas shared between client and server
- **Error handling**: Consistent API response format `{ success, data?, error? }`

## Before Non-Trivial Changes
For schema changes, new endpoints, or anything touching shared/visibility
semantics (e.g. "let users rename/label/tag X for others" — clarify shared
vs. private-per-viewer scope before coding): trace what else needs updating
as a consequence (other routes, pages, types, relations), check whether it
overlaps or duplicates an existing feature (and whether that old thing
should be removed), then state the plan briefly before writing code. Skip
this ceremony for trivial one-line fixes.

## Project Structure
```
finance-tracker/
├── CLAUDE.md                    # ← This file (Cowork context)
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.mjs
├── prisma/
│   ├── schema.prisma            # Database schema
│   ├── seed.ts                  # Default categories & payment methods
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── (auth)/              # Public: login, register, forgot-password
│   │   │   ├── login/
│   │   │   └── register/
│   │   ├── (app)/               # Protected: all main features
│   │   │   ├── transactions/    # บันทึกรายรับ-รายจ่าย
│   │   │   ├── debts/           # หนี้สิน/ผ่อนชำระ
│   │   │   ├── budget/          # งบการเงิน 12 เดือน
│   │   │   ├── dashboard/       # แดชบอร์ด
│   │   │   ├── categories/      # จัดการหมวดหมู่
│   │   │   ├── settings/        # ตั้งค่า
│   │   │   └── layout.tsx       # Sidebar/BottomNav + auth guard
│   │   ├── api/v1/              # API Routes
│   │   │   ├── auth/
│   │   │   ├── transactions/
│   │   │   ├── categories/
│   │   │   ├── debts/
│   │   │   ├── budgets/
│   │   │   ├── recurring/
│   │   │   └── notifications/
│   │   ├── layout.tsx           # Root layout
│   │   └── page.tsx             # Redirect to dashboard or login
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── forms/               # Transaction form, Debt form, etc.
│   │   ├── charts/              # Dashboard chart components
│   │   ├── layout/              # Header, BottomNav, Sidebar
│   │   └── shared/              # Reusable components
│   ├── lib/
│   │   ├── auth.ts              # NextAuth config
│   │   ├── prisma.ts            # Prisma client singleton
│   │   ├── utils.ts             # Helpers
│   │   └── validations/         # Zod schemas
│   ├── hooks/                   # Custom React hooks
│   └── types/                   # TypeScript types/interfaces
├── public/
│   ├── manifest.json            # PWA manifest
│   ├── sw.js                    # Service Worker
│   └── icons/                   # PWA icons
└── docs/
    ├── TECHNICAL_SPEC.md        # Full technical specification
    └── CHANGELOG.md             # Development changelog
```

## Important Decisions
1. **Income + Expense ใช้หน้าเดียวกัน** — toggle ระหว่าง รายรับ/รายจ่าย โดย categories จะเปลี่ยนตาม type
2. **PayLater flow** — เมื่อจ่ายงวด: สร้าง transaction (expense) + อัพเดต debt_payment + ลดยอดคงค้าง ทั้งหมดใน 1 DB transaction
3. **Budget = user กรอกเอง** — ใช้ plan vs actual comparison ไม่ใช่ auto-forecast
4. **Family = tag-based ใน MVP** — ไม่มี multi-account sharing ในเฟสแรก
5. **Push Notification** — Web Push API ไม่ใช้ Firebase, default แจ้งเตือนวันที่ 1 ของเดือน
6. **Interest rate** — schema รองรับแต่ UI ยังไม่ทำ, ใช้วิธี flat rate (ยอดเต็ม ÷ เดือน) ก่อน

## Quick Commands
```bash
# Development
docker compose up -d          # Start all services
npx prisma migrate dev        # Run migrations
npx prisma db seed            # Seed default data
npm run dev                   # Start Next.js dev server

# Production
docker compose -f docker-compose.prod.yml up -d --build
```

# Technical Specification — Finance Tracker
> Version: 1.1 | Last updated: 2026-06-03 | Status: Phase 0 Complete

---

## 1. Product Overview

### 1.1 Vision
แอปบันทึกรายรับ-รายจ่ายส่วนบุคคล ที่ใช้งานง่ายบนมือถือ รองรับการติดตามหนี้สิน
วางแผนงบการเงินล่วงหน้า และดู dashboard สรุปภาพรวมทางการเงิน

### 1.2 Target Users
- บุคคลทั่วไปที่ต้องการติดตามรายรับ-รายจ่าย
- ผู้ที่มีรายการผ่อนชำระ/หนี้สิน หลายรายการ
- ครอบครัวที่ต้องการดูภาพรวมค่าใช้จ่ายรวม

### 1.3 Key Principles
- **Mobile-first** — ออกแบบสำหรับมือถือเป็นหลัก responsive บน desktop
- **Speed** — โหลดเร็ว ใช้ client-side rendering เพื่อลดภาระ server (1 core)
- **Simplicity** — UI เรียบง่าย บันทึกได้เร็วภายใน 3 taps
- **Zero additional cost** — ทุกอย่างรันบน VPS ที่มีอยู่

---

## 2. Functional Requirements

### 2.1 Authentication (Phase 1)
| Feature | Detail |
|---|---|
| Register | Email + password + ชื่อ |
| Login | Email + password, remember me |
| Forgot Password | Email link reset (ใช้ SMTP หรือ magic link) |
| Session | JWT token, auto-refresh |
| Security | bcrypt hash, rate limiting on login |

### 2.2 Transaction Recording (Phase 1)
| Feature | Detail |
|---|---|
| Type toggle | รายรับ / รายจ่าย — categories เปลี่ยนตาม type |
| Date | Date picker, default = วันนี้ |
| Category | เลือกจาก list (filter by type), รองรับ sub-category |
| Amount | ตัวเลข, รองรับทศนิยม 2 ตำแหน่ง |
| Description | Text field — ค่าอะไร |
| Payment Method | เงินสด / QR Payment / โอนธนาคาร / บัตรเครดิต / บัตรเดบิต / PayLater / อื่นๆ |
| Family tag | เลือกชื่อสมาชิกครอบครัว (optional, Phase 7) |
| Quick entry | บันทึกได้เร็ว ไม่ต้องกรอกทุก field |

**Transaction List**
- แสดงรายการตามเดือน (default = เดือนปัจจุบัน)
- Filter: ประเภท, หมวดหมู่, ช่วงวันที่
- Search: ค้นหาจาก description
- Edit / Delete ได้
- แสดงรายการผ่อนที่ต้องจ่ายในเดือนนั้น (จาก Debt module)

### 2.3 Categories (Phase 1)
| Feature | Detail |
|---|---|
| Types | แยก INCOME / EXPENSE |
| Sub-categories | ผ่าน parent_id (self-referencing) |
| CRUD | เพิ่ม / แก้ไข / ลบ ได้ทั้งหมด |
| Defaults | Seed ข้อมูลเริ่มต้น (ดูหัวข้อ 7) |
| Icon + Color | แต่ละหมวดมี icon และสี (optional) |
| Sort order | ลำดับการแสดงผล |

### 2.4 Debt & Installments (Phase 2)
| Feature | Detail |
|---|---|
| Name | ชื่อรายการ เช่น "ผ่อน iPhone", "Shopee PayLater" |
| Total amount | ยอดเต็ม |
| Total months | จำนวนเดือนที่ผ่อน |
| Monthly amount | ถ้าใส่ = ใช้ตามที่ใส่, ถ้าไม่ใส่ = totalAmount ÷ totalMonths |
| Interest rate | Reserved field — schema รองรับ แต่ UI ยังไม่ active |
| Start date | วันที่เริ่มต้นจ่าย |
| End date | Auto-calculate จาก startDate + totalMonths |
| Notes | หมายเหตุ |
| Status | ACTIVE / COMPLETED / CANCELLED |

**Debt Payment Tracking**
- ระบบ auto-generate `debt_payment` records สำหรับทุกงวด เมื่อสร้าง debt
- แต่ละงวดมี: dueDate, amount, status (PENDING/PAID/OVERDUE)
- แสดงในหน้า Transaction ของเดือนนั้น เป็น "รอบันทึก"
- เมื่อ user กด "จ่ายแล้ว":
  1. สร้าง Transaction (type=EXPENSE) 
  2. อัพเดต DebtPayment.status = PAID
  3. Link transaction ↔ debtPayment
  4. **ทั้ง 3 steps ใน 1 database transaction**
- ยอดค้าง = จำนวนงวดที่ status = PENDING หรือ OVERDUE × monthlyAmount

**PayLater Specific Flow**
- PayLater (เช่น Shopee PayLater) = Debt ประเภทหนึ่ง
- เมื่อสร้าง debt type=PAY_LATER → auto-link กับ PaymentMethod
- เมื่อจ่ายงวด → deduct จากยอดหนี้ + บันทึกรายจ่าย

### 2.5 Budget Planning — 12 Months (Phase 4)
| Feature | Detail |
|---|---|
| Input | User กรอกเอง — ไม่ใช่ auto-forecast |
| Structure | แต่ละเดือนมี list ของ BudgetItem |
| BudgetItem types | รายได้ / ค่าใช้จ่าย / หนี้สิน / เงินออม-ลงทุน |
| Category link | แต่ละ item link กับ Category (optional) |
| Editable | เพิ่ม/ลบ/แก้ไข item ได้ตลอดเวลา |
| Comparison | Dashboard แสดง plan vs actual |
| Copy | สามารถ copy งบจากเดือนก่อนหน้า เพื่อเป็น template |

### 2.6 Dashboard (Phase 3)
| Feature | Detail |
|---|---|
| Period selector | เดือน / ปี |
| Total income | ยอดรายรับรวม ในช่วงที่เลือก |
| Total expense | ยอดรายจ่ายรวม ในช่วงที่เลือก |
| Net | รายรับ - รายจ่าย |
| By category | Pie chart + list แยกตามหมวดหมู่ |
| Upcoming payments | รายการผ่อนที่จะถึงกำหนดจาก Debt module |
| Monthly comparison | Bar chart เปรียบเทียบรายจ่ายรายเดือน |
| Yearly comparison | เปรียบเทียบข้ามปี |
| Category trend | เปรียบเทียบรายจ่ายแยกหมวด ข้ามเดือน/ปี |
| Budget vs actual | เทียบงบที่ตั้งไว้ vs จ่ายจริง (Phase 4+) |

### 2.7 Recurring Transactions (Phase 5)
| Feature | Detail |
|---|---|
| Name | ชื่อรายการประจำ เช่น "Netflix", "ค่าเช่า" |
| Amount | ยอดจ่าย |
| Category | หมวดหมู่ |
| Frequency | รายเดือน / รายปี |
| Reminder day | วันที่แจ้งเตือน (default = 1, range 1-28) |
| Auto-record | ไม่ auto-record, แค่แจ้งเตือนแล้ว user กดบันทึกเอง |

### 2.8 Notifications (Phase 5)
| Feature | Detail |
|---|---|
| Channel | Web Push (PWA) — ไม่ใช้ email |
| Debt reminder | แจ้งเตือนก่อนวันครบกำหนดจ่ายงวด |
| Recurring reminder | แจ้งเตือนรายจ่ายประจำ |
| Overdue alert | แจ้งเมื่อเลยกำหนดจ่าย |
| In-app center | หน้ารวม notification ในแอป (read/unread) |
| Custom day | เลือกวันที่ต้องการแจ้งเตือนได้ per item |
| Default day | วันที่ 1 ของทุกเดือน |

### 2.9 Export (Phase 6)
| Feature | Detail |
|---|---|
| Dashboard → Image | html2canvas capture |
| Dashboard → PDF | jsPDF |
| Transaction list → PDF | table format, filter ตามที่แสดง |
| Filename | auto: `finance_[type]_[YYYYMM].pdf` |

### 2.10 Family Features — MVP (Phase 7)
| Feature | Detail |
|---|---|
| Approach | Tag-based (ไม่ใช่ multi-account) |
| Family members | จัดการรายชื่อสมาชิกใน Settings |
| Tag transaction | เลือก "ครอบครัว" + ชื่อสมาชิก |
| Dashboard filter | ของฉัน / ครอบครัว / ทั้งหมด |
| Per-member summary | ดูยอดรวมรายจ่ายแยกตามสมาชิก |
| Future upgrade | Household model (separate accounts + invitation) |

---

## 3. Architecture

### 3.1 System Architecture
```
Internet
    │
    ▼
┌─────────────────────────────────────────────────┐
│  VPS Hostinger (Ubuntu, 1 core, 4GB, 50GB)      │
│                                                  │
│  ┌──────────┐                                    │
│  │ Traefik  │◄── SSL termination (Let's Encrypt) │
│  │ :80/:443 │    Routing by subdomain            │
│  └────┬─────┘                                    │
│       │                                          │
│       ├── finance.srv1068566.hstgr.cloud         │
│       │   ┌───────────────────┐                  │
│       ├──►│ Next.js App :3000 │                  │
│       │   │ (Docker container)│                  │
│       │   │ - SSR/CSR pages   │                  │
│       │   │ - API routes      │                  │
│       │   │ - Auth (NextAuth) │                  │
│       │   │ - Cron jobs       │                  │
│       │   └───────┬───────────┘                  │
│       │           │                              │
│       │   ┌───────▼───────────┐                  │
│       │   │ PostgreSQL :5432  │                  │
│       │   │ (Docker container)│                  │
│       │   │ - All app data    │                  │
│       │   │ - Volume mounted  │                  │
│       │   └───────────────────┘                  │
│       │                                          │
│       ├── n8n.srv1068566.hstgr.cloud             │
│       └──►│ n8n (existing)    │                  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 3.2 Performance Strategy (1 Core Optimization)
- **Client-Side Rendering (CSR)** เป็นหลัก — dashboard, charts, forms ทำบน browser
- **Static Generation** สำหรับ layout, login page
- **API Routes** lightweight — query → return JSON
- **No SSR** สำหรับ data-heavy pages (ลด CPU load)
- **Connection pooling** — Prisma connection limit ตั้งไว้ต่ำ (max 5)
- **Indexes** — ทุก foreign key + date columns + composite index ที่ query บ่อย

---

## 4. Database Design

### 4.1 Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// AUTH & USERS
// ============================================================

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String    @map("password_hash")
  name            String
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  categories      Category[]
  transactions    Transaction[]
  debts           Debt[]
  budgets         Budget[]
  recurringTxns   RecurringTransaction[]
  pushSubs        PushSubscription[]
  notifications   Notification[]
  paymentMethods  PaymentMethod[]
  familyMembers   FamilyMember[]

  @@map("users")
}

// ============================================================
// CATEGORIES (with sub-categories)
// ============================================================

enum CategoryType {
  INCOME
  EXPENSE
}

model Category {
  id              String       @id @default(cuid())
  name            String
  type            CategoryType
  icon            String?      // emoji or icon name
  color           String?      // hex color code
  parentId        String?      @map("parent_id")
  parent          Category?    @relation("SubCategories", fields: [parentId], references: [id], onDelete: SetNull)
  children        Category[]   @relation("SubCategories")
  userId          String       @map("user_id")
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  isDefault       Boolean      @default(false) @map("is_default")
  sortOrder       Int          @default(0) @map("sort_order")
  createdAt       DateTime     @default(now()) @map("created_at")

  transactions    Transaction[]
  budgetItems     BudgetItem[]
  recurringTxns   RecurringTransaction[]

  @@index([userId, type])
  @@map("categories")
}

// ============================================================
// PAYMENT METHODS
// ============================================================

enum PaymentMethodType {
  CASH
  QR_PAYMENT
  BANK_TRANSFER
  CREDIT_CARD
  DEBIT_CARD
  PAY_LATER
  OTHER
}

model PaymentMethod {
  id              String             @id @default(cuid())
  name            String
  type            PaymentMethodType
  userId          String             @map("user_id")
  user            User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  isDefault       Boolean            @default(false) @map("is_default")
  sortOrder       Int                @default(0) @map("sort_order")
  createdAt       DateTime           @default(now()) @map("created_at")

  transactions    Transaction[]

  @@index([userId])
  @@map("payment_methods")
}

// ============================================================
// TRANSACTIONS (Income + Expense)
// ============================================================

enum TransactionType {
  INCOME
  EXPENSE
}

model Transaction {
  id              String           @id @default(cuid())
  type            TransactionType
  amount          Decimal          @db.Decimal(12, 2)
  description     String?
  date            DateTime         @db.Date
  categoryId      String           @map("category_id")
  category        Category         @relation(fields: [categoryId], references: [id])
  paymentMethodId String?          @map("payment_method_id")
  paymentMethod   PaymentMethod?   @relation(fields: [paymentMethodId], references: [id])
  userId          String           @map("user_id")
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Family tagging (Phase 7)
  isFamily        Boolean          @default(false) @map("is_family")
  familyMemberId  String?          @map("family_member_id")
  familyMember    FamilyMember?    @relation(fields: [familyMemberId], references: [id])

  // Link to debt payment (when paying an installment)
  debtPaymentId   String?          @unique @map("debt_payment_id")
  debtPayment     DebtPayment?     @relation(fields: [debtPaymentId], references: [id])

  // Link to recurring transaction
  recurringTxnId  String?          @map("recurring_txn_id")
  recurringTxn    RecurringTransaction? @relation(fields: [recurringTxnId], references: [id])

  createdAt       DateTime         @default(now()) @map("created_at")
  updatedAt       DateTime         @updatedAt @map("updated_at")

  @@index([userId, date])
  @@index([userId, type, date])
  @@index([categoryId])
  @@map("transactions")
}

// ============================================================
// DEBTS & INSTALLMENTS
// ============================================================

enum DebtStatus {
  ACTIVE
  COMPLETED
  CANCELLED
}

model Debt {
  id              String     @id @default(cuid())
  name            String
  totalAmount     Decimal    @db.Decimal(12, 2) @map("total_amount")
  monthlyAmount   Decimal?   @db.Decimal(12, 2) @map("monthly_amount")
  totalMonths     Int        @map("total_months")
  interestRate    Decimal?   @db.Decimal(5, 2) @map("interest_rate") // Reserved
  startDate       DateTime   @db.Date @map("start_date")
  endDate         DateTime   @db.Date @map("end_date") // Calculated
  notes           String?
  status          DebtStatus @default(ACTIVE)
  userId          String     @map("user_id")
  user            User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  payments        DebtPayment[]

  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  @@index([userId, status])
  @@map("debts")
}

enum PaymentStatus {
  PENDING
  PAID
  OVERDUE
}

model DebtPayment {
  id              String        @id @default(cuid())
  debtId          String        @map("debt_id")
  debt            Debt          @relation(fields: [debtId], references: [id], onDelete: Cascade)
  installmentNo   Int           @map("installment_no") // งวดที่
  dueDate         DateTime      @db.Date @map("due_date")
  amount          Decimal       @db.Decimal(12, 2)
  status          PaymentStatus @default(PENDING)
  paidDate        DateTime?     @db.Date @map("paid_date")

  transaction     Transaction?  // Linked when PAID

  createdAt       DateTime      @default(now()) @map("created_at")

  @@index([debtId, status])
  @@index([dueDate, status])
  @@map("debt_payments")
}

// ============================================================
// BUDGET PLANNING (12-month)
// ============================================================

enum BudgetItemType {
  INCOME
  EXPENSE
  LIABILITY
  SAVING
}

model Budget {
  id              String       @id @default(cuid())
  userId          String       @map("user_id")
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  year            Int
  month           Int          // 1-12

  items           BudgetItem[]

  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@unique([userId, year, month])
  @@map("budgets")
}

model BudgetItem {
  id              String         @id @default(cuid())
  budgetId        String         @map("budget_id")
  budget          Budget         @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  name            String
  type            BudgetItemType
  amount          Decimal        @db.Decimal(12, 2)
  categoryId      String?        @map("category_id")
  category        Category?      @relation(fields: [categoryId], references: [id])
  notes           String?
  sortOrder       Int            @default(0) @map("sort_order")

  createdAt       DateTime       @default(now()) @map("created_at")

  @@index([budgetId])
  @@map("budget_items")
}

// ============================================================
// RECURRING TRANSACTIONS
// ============================================================

enum Frequency {
  MONTHLY
  YEARLY
}

model RecurringTransaction {
  id              String          @id @default(cuid())
  name            String
  type            TransactionType
  amount          Decimal         @db.Decimal(12, 2)
  categoryId      String          @map("category_id")
  category        Category        @relation(fields: [categoryId], references: [id])
  frequency       Frequency       @default(MONTHLY)
  reminderDay     Int             @default(1) @map("reminder_day") // 1-28
  isActive        Boolean         @default(true) @map("is_active")
  userId          String          @map("user_id")
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  transactions    Transaction[]

  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  @@index([userId, isActive])
  @@map("recurring_transactions")
}

// ============================================================
// FAMILY MEMBERS (Phase 7)
// ============================================================

model FamilyMember {
  id              String        @id @default(cuid())
  name            String
  userId          String        @map("user_id")
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  transactions    Transaction[]

  createdAt       DateTime      @default(now()) @map("created_at")

  @@index([userId])
  @@map("family_members")
}

// ============================================================
// NOTIFICATIONS & PUSH
// ============================================================

enum NotificationType {
  DEBT_REMINDER
  RECURRING_REMINDER
  OVERDUE_ALERT
  SYSTEM
}

model PushSubscription {
  id              String   @id @default(cuid())
  userId          String   @map("user_id")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint        String
  p256dh          String
  auth            String
  userAgent       String?  @map("user_agent")

  createdAt       DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("push_subscriptions")
}

model Notification {
  id              String           @id @default(cuid())
  userId          String           @map("user_id")
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  title           String
  message         String
  type            NotificationType
  referenceId     String?          @map("reference_id")
  referenceType   String?          @map("reference_type") // "debt_payment" | "recurring"
  isRead          Boolean          @default(false) @map("is_read")

  createdAt       DateTime         @default(now()) @map("created_at")

  @@index([userId, isRead])
  @@map("notifications")
}
```

### 4.2 Entity Relationship Summary
```
User (1) ──────┬──── (*) Category ──── (*) [self: parent/children]
               │
               ├──── (*) PaymentMethod
               │
               ├──── (*) Transaction
               │         ├── → Category
               │         ├── → PaymentMethod (optional)
               │         ├── → DebtPayment (optional, 1:1)
               │         ├── → RecurringTransaction (optional)
               │         └── → FamilyMember (optional)
               │
               ├──── (*) Debt
               │         └── (*) DebtPayment
               │                  └── → Transaction (optional, 1:1)
               │
               ├──── (*) Budget
               │         └── (*) BudgetItem
               │                  └── → Category (optional)
               │
               ├──── (*) RecurringTransaction
               │         ├── → Category
               │         └── (*) Transaction
               │
               ├──── (*) FamilyMember
               ├──── (*) PushSubscription
               └──── (*) Notification
```

---

## 5. API Design

### 5.1 Response Format
```typescript
// Success
{ success: true, data: T }

// Error
{ success: false, error: { code: string, message: string } }

// Paginated
{ success: true, data: T[], meta: { page, limit, total, totalPages } }
```

### 5.2 Endpoints

#### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | สมัครสมาชิก |
| POST | `/api/v1/auth/login` | เข้าสู่ระบบ |
| POST | `/api/v1/auth/forgot-password` | ส่ง reset link |
| POST | `/api/v1/auth/reset-password` | Reset password |
| GET | `/api/v1/auth/me` | ข้อมูล user ปัจจุบัน |

#### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/categories` | List ทั้งหมด (?type=INCOME/EXPENSE) |
| POST | `/api/v1/categories` | สร้างหมวดหมู่ |
| PUT | `/api/v1/categories/:id` | แก้ไข |
| DELETE | `/api/v1/categories/:id` | ลบ (soft: ย้าย transactions ไป "อื่นๆ") |

#### Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/transactions` | List (?month, ?year, ?type, ?categoryId, ?search) |
| GET | `/api/v1/transactions/:id` | รายละเอียด |
| POST | `/api/v1/transactions` | สร้าง |
| PUT | `/api/v1/transactions/:id` | แก้ไข |
| DELETE | `/api/v1/transactions/:id` | ลบ |
| GET | `/api/v1/transactions/summary` | สรุป (?month, ?year) |

#### Payment Methods
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/payment-methods` | List |
| POST | `/api/v1/payment-methods` | สร้าง |
| PUT | `/api/v1/payment-methods/:id` | แก้ไข |
| DELETE | `/api/v1/payment-methods/:id` | ลบ |

#### Debts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/debts` | List (?status=ACTIVE) |
| GET | `/api/v1/debts/:id` | รายละเอียด + payments |
| POST | `/api/v1/debts` | สร้าง (auto-generate payments) |
| PUT | `/api/v1/debts/:id` | แก้ไข |
| DELETE | `/api/v1/debts/:id` | ลบ/ยกเลิก |
| POST | `/api/v1/debts/:id/payments/:paymentId/pay` | บันทึกจ่ายงวด |
| GET | `/api/v1/debts/upcoming` | งวดที่จะถึงกำหนด (?month, ?year) |

#### Budgets
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/budgets` | List (?year) |
| GET | `/api/v1/budgets/:year/:month` | งบเดือนนั้น + items |
| PUT | `/api/v1/budgets/:year/:month` | สร้าง/อัพเดต (upsert) |
| POST | `/api/v1/budgets/:year/:month/copy-from/:srcYear/:srcMonth` | Copy จากเดือนอื่น |
| GET | `/api/v1/budgets/comparison` | Budget vs Actual (?year) |

#### Recurring Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/recurring` | List |
| POST | `/api/v1/recurring` | สร้าง |
| PUT | `/api/v1/recurring/:id` | แก้ไข |
| DELETE | `/api/v1/recurring/:id` | ลบ |
| POST | `/api/v1/recurring/:id/record` | บันทึกรายจ่ายจาก recurring |

#### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/notifications` | List (?unread=true) |
| PUT | `/api/v1/notifications/:id/read` | Mark as read |
| PUT | `/api/v1/notifications/read-all` | Mark all as read |
| POST | `/api/v1/push/subscribe` | Register push subscription |
| DELETE | `/api/v1/push/subscribe` | Unsubscribe |

#### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dashboard/summary` | ยอดรวม (?month, ?year) |
| GET | `/api/v1/dashboard/by-category` | แยกหมวด (?month, ?year, ?type) |
| GET | `/api/v1/dashboard/monthly-comparison` | เทียบรายเดือน (?year) |
| GET | `/api/v1/dashboard/yearly-comparison` | เทียบรายปี |
| GET | `/api/v1/dashboard/category-trend` | Trend หมวดหมู่ (?months=6) |

#### Family (Phase 7)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/family-members` | List สมาชิก |
| POST | `/api/v1/family-members` | เพิ่ม |
| PUT | `/api/v1/family-members/:id` | แก้ไข |
| DELETE | `/api/v1/family-members/:id` | ลบ |

#### Export
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/export/dashboard` | Export dashboard (?format=pdf/image) |
| POST | `/api/v1/export/transactions` | Export transaction list (?format=pdf) |

---

## 6. UI/UX Flow

### 6.1 Navigation Structure (Mobile-first)
```
Bottom Navigation Bar (4 tabs):
┌──────────┬──────────────┬──────────┬──────────┐
│ Dashboard│ Transactions │  Debts   │  Budget  │
│   🏠     │     📝       │   💳     │    📊   │
└──────────┴──────────────┴──────────┴──────────┘

Top-right: Notification bell (🔔) + Settings gear (⚙️)

Floating Action Button (FAB): Quick add transaction (+)
```

### 6.2 Screen Flow
```
Splash / Auth Check
    ├── Not logged in → Login page
    │                      ├── Register
    │                      └── Forgot Password
    │
    └── Logged in → Dashboard (home)
                        ├── [Bottom Nav] Transactions
                        │       ├── Transaction List (by month)
                        │       │   ├── Filter / Search
                        │       │   ├── Pending debt payments (highlighted)
                        │       │   └── Pending recurring (highlighted)
                        │       └── [FAB +] New Transaction form
                        │               ├── Toggle: รายรับ / รายจ่าย
                        │               ├── Date picker
                        │               ├── Category selector (filtered by type)
                        │               ├── Amount
                        │               ├── Description
                        │               └── Payment method
                        │
                        ├── [Bottom Nav] Debts
                        │       ├── Debt List (active / completed tabs)
                        │       ├── [+] New Debt form
                        │       └── Debt Detail
                        │               ├── Info summary
                        │               ├── Payment schedule (grid)
                        │               └── Pay button per installment
                        │
                        ├── [Bottom Nav] Budget
                        │       ├── 12-month grid view
                        │       ├── Month detail → edit items
                        │       └── Copy from another month
                        │
                        ├── [Notification bell] Notification center
                        │
                        └── [Settings gear] Settings
                                ├── Profile / change password
                                ├── Categories management
                                ├── Payment methods management
                                ├── Recurring transactions
                                ├── Family members (Phase 7)
                                └── Push notification settings
```

---

## 7. Default Seed Data

### 7.1 Expense Categories
| Category | Sub-categories | Icon |
|----------|---------------|------|
| อาหารและเครื่องดื่ม | อาหารเช้า, อาหารเที่ยง, อาหารเย็น, กาแฟ/ชา, ของกินเล่น | 🍽️ |
| เดินทาง/ค่ารถ | น้ำมัน, ค่าทางด่วน, ขนส่งสาธารณะ, Grab/Bolt, ซ่อมบำรุง | 🚗 |
| ที่พักอาศัย | ค่าเช่า, ค่าส่วนกลาง, ซ่อมแซม | 🏠 |
| สาธารณูปโภค | ค่าไฟ, ค่าน้ำ, ค่าเน็ต/โทรศัพท์ | ⚡ |
| สุขภาพ/การแพทย์ | ค่ายา, ค่าหมอ, ค่าประกันสุขภาพ | 🏥 |
| การศึกษา | ค่าเรียน, หนังสือ/คอร์ส | 📚 |
| บันเทิง | หนัง/ซีรีส์, เกม, ท่องเที่ยว, สมาชิกรายเดือน | 🎬 |
| ช้อปปิ้ง | เสื้อผ้า, อุปกรณ์ IT, ของใช้ในบ้าน | 🛒 |
| ผ่อนชำระ/หนี้สิน | (auto from Debt module) | 💳 |
| ประกัน | ประกันชีวิต, ประกันรถ | 🛡️ |
| ออม/ลงทุน | เงินออม, กองทุน, หุ้น | 💰 |
| อื่นๆ | — | 📌 |

### 7.2 Income Categories
| Category | Sub-categories | Icon |
|----------|---------------|------|
| เงินเดือน | — | 💼 |
| รายได้เสริม/ฟรีแลนซ์ | — | 💻 |
| ขายของ | — | 🏷️ |
| ดอกเบี้ย/เงินปันผล | — | 📈 |
| เงินคืน/Refund | — | 🔄 |
| อื่นๆ | — | 📌 |

### 7.3 Default Payment Methods
| Name | Type |
|------|------|
| เงินสด | CASH |
| QR Payment / PromptPay | QR_PAYMENT |
| โอนธนาคาร | BANK_TRANSFER |
| บัตรเครดิต | CREDIT_CARD |
| บัตรเดบิต | DEBIT_CARD |
| อื่นๆ | OTHER |

> PayLater จะถูกสร้างเมื่อ user สร้าง Debt ประเภท PayLater

---

## 8. Deployment Configuration

### 8.1 docker-compose.yml (Production)
```yaml
version: "3.8"

services:
  app:
    build: .
    container_name: finance-tracker
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://finance:${DB_PASSWORD}@db:5432/finance_tracker
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - NEXTAUTH_URL=https://finance.srv1068566.hstgr.cloud
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
    depends_on:
      db:
        condition: service_healthy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.finance.rule=Host(`finance.srv1068566.hstgr.cloud`)"
      - "traefik.http.routers.finance.entrypoints=websecure"
      - "traefik.http.routers.finance.tls.certresolver=letsencrypt"
      - "traefik.http.services.finance.loadbalancer.server.port=3000"
    networks:
      - traefik-public
      - finance-internal

  db:
    image: postgres:16-alpine
    container_name: finance-db
    restart: unless-stopped
    environment:
      - POSTGRES_DB=finance_tracker
      - POSTGRES_USER=finance
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finance -d finance_tracker"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - finance-internal

volumes:
  pgdata:

networks:
  traefik-public:
    external: true
  finance-internal:
    driver: bridge
```

### 8.2 .env.example
```env
# Database
DB_PASSWORD=change-me-to-a-strong-password

# NextAuth
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=https://finance.srv1068566.hstgr.cloud

# Web Push (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:your@email.com

# App
NODE_ENV=production
```

### 8.3 Dockerfile
```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.mjs ./

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
```

---

## 9. Development Phase Details

### Phase 1: Foundation (2-3 weeks)
**Goal**: สามารถสมัคร เข้าสู่ระบบ และบันทึกรายรับ-รายจ่ายได้

Tasks:
- [ ] Project scaffold: Next.js + TypeScript + Tailwind + shadcn/ui
- [ ] Docker + docker-compose setup
- [ ] Prisma schema (User, Category, PaymentMethod, Transaction)
- [ ] Seed default categories + payment methods
- [ ] Auth: register, login, logout, forgot password
- [ ] Middleware: auth guard for protected routes
- [ ] Category CRUD API + UI (with sub-categories)
- [ ] Payment Method CRUD API + UI
- [ ] Transaction form: type toggle, date, category, amount, description, payment method
- [ ] Transaction list: monthly view, filter, search, edit, delete
- [ ] Mobile-first layout: bottom nav, FAB button
- [ ] Basic error handling + loading states

### Phase 2: Debt & Installments (2 weeks)
**Goal**: บันทึกรายการผ่อน ติดตามการจ่ายงวด และ PayLater flow

Tasks:
- [ ] Debt CRUD API + UI
- [ ] Auto-generate debt_payment records
- [ ] Auto-calculate: monthlyAmount, endDate
- [ ] Debt detail page: payment schedule grid
- [ ] Pay installment flow (atomic: transaction + payment update)
- [ ] Show pending payments in Transaction page per month
- [ ] Overdue detection
- [ ] PayLater: link debt to payment method
- [ ] Debt summary: ยอดคงค้างทั้งหมด

### Phase 3: Dashboard (1-2 weeks)
**Goal**: ดูสรุปภาพรวมทางการเงิน

Tasks:
- [ ] Summary cards: total income, expense, net
- [ ] Expense by category: pie chart + list
- [ ] Upcoming debt payments
- [ ] Monthly comparison: bar chart
- [ ] Yearly comparison
- [ ] Category trend line chart
- [ ] Period selector (month/year)
- [ ] Responsive chart layout

### Phase 4: Budget Planning (1-2 weeks)
**Goal**: วางแผนงบ 12 เดือน และเทียบกับยอดจริง

Tasks:
- [ ] Budget CRUD: 12-month grid view
- [ ] Budget item management per month
- [ ] Copy budget from another month
- [ ] Budget vs actual comparison on dashboard
- [ ] Visual indicators: over/under budget

### Phase 5: Notifications & Recurring (1-2 weeks)
**Goal**: แจ้งเตือนรายจ่ายประจำและงวดผ่อน

Tasks:
- [ ] PWA setup: manifest.json + service worker
- [ ] Web Push: VAPID keys, subscription management
- [ ] Recurring transaction CRUD
- [ ] Record from recurring (quick-record)
- [ ] Cron job: daily check → send push for due items
- [ ] Notification center UI (in-app)
- [ ] Custom reminder day per recurring/debt
- [ ] Install prompt (Add to Home Screen)

### Phase 6: Export (1 week)
**Goal**: Export dashboard และ transaction list

Tasks:
- [ ] Dashboard → image (html2canvas)
- [ ] Dashboard → PDF (jsPDF)
- [ ] Transaction list → PDF (table format)
- [ ] Auto filename generation
- [ ] Share sheet integration (mobile)

### Phase 7: Family Features (2 weeks)
**Goal**: ติดตามค่าใช้จ่ายครอบครัว

Tasks:
- [ ] Family member management in settings
- [ ] Tag transaction as family + member
- [ ] Dashboard filter: mine / family / all
- [ ] Per-member expense summary
- [ ] Family expense report

---

## 10. Security Considerations

- **Passwords**: bcrypt with salt rounds = 12
- **Sessions**: HTTP-only, Secure, SameSite=Strict cookies
- **CSRF**: Built-in with NextAuth
- **Rate limiting**: Login endpoint (5 attempts per 15 min)
- **Input validation**: Zod on both client and server
- **SQL injection**: Prevented by Prisma ORM (parameterized queries)
- **XSS**: React auto-escaping + CSP headers
- **Data isolation**: Every query includes `userId` filter (row-level)
- **HTTPS**: Enforced by Traefik
- **Environment variables**: Never committed, .env in .gitignore
- **DB access**: Internal Docker network only, not exposed to host

---

## 11. Future Considerations (Post-MVP)

- **Household model**: Full multi-account family sharing with invitations
- **Interest rate calculator**: Active interest calculation for debts
- **OCR receipt scanning**: Upload receipt photo → auto-extract data
- **Bank statement import**: CSV/OFX import for bulk transactions
- **Multi-currency**: THB + foreign currency support
- **Telegram/LINE notifications**: Alternative push channels for iOS users
- **Data backup**: Scheduled PostgreSQL dump to cloud storage
- **Analytics**: Spending insights, anomaly detection

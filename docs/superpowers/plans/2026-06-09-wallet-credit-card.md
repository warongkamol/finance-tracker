# Wallet + Credit Card System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `PaymentMethod` model with a balance-tracking `Account` model (CASH / BANK_ACCOUNT / SAVINGS / E_WALLET / CREDIT_CARD), add inter-account transfers, and surface per-account balances plus a dashboard summary card.

**Architecture:** `Account` replaces `PaymentMethod` 1-to-1 via auto-migration. Balance is always computed (`initialBalance + Σ INCOME − Σ EXPENSE + Σ transfers in − Σ transfers out`) — never stored. Transfers create a `Transfer` record plus two linked `Transaction` rows (flagged `isTransfer=true`) inside a Prisma transaction. All existing summary/aggregate API routes must filter `isTransfer: false` to avoid double-counting.

**Tech Stack:** Next.js 14 App Router, Prisma ORM, PostgreSQL 16, TypeScript, Zod, react-hook-form, shadcn/ui (Sheet / Dialog / Select), lucide-react (`WalletCards` icon), Playwright (verification)

---

## File Map

### New files
| Path | Purpose |
|------|---------|
| `src/lib/validations/account.ts` | Zod schemas: createAccount, updateAccount, transfer |
| `src/app/api/v1/accounts/route.ts` | GET list + POST create |
| `src/app/api/v1/accounts/summary/route.ts` | GET dashboard card data |
| `src/app/api/v1/accounts/[id]/route.ts` | GET detail, PATCH update, DELETE |
| `src/app/api/v1/accounts/transfer/route.ts` | POST create transfer (atomic) |
| `src/components/forms/account-form.tsx` | Sheet form: create/edit account |
| `src/components/forms/transfer-form.tsx` | Sheet form: transfer between accounts |
| `src/app/(app)/accounts/page.tsx` | /accounts list page |
| `src/app/(app)/accounts/[id]/page.tsx` | /accounts/:id detail page |

### Modified files
| Path | Change |
|------|--------|
| `prisma/schema.prisma` | Add Account, Transfer models; add accountId + isTransfer to Transaction; categoryId nullable; add accountId to RecurringTransaction |
| `src/lib/validations/transaction.ts` | Add optional `accountId` field |
| `src/lib/validations/recurring.ts` | Add optional `accountId` field |
| `src/app/api/v1/transactions/route.ts` | Accept + persist `accountId`; exclude `isTransfer=true` from list |
| `src/app/api/v1/transactions/[id]/route.ts` | Accept + persist `accountId` on update |
| `src/app/api/v1/recurring/route.ts` | Accept + persist `accountId` |
| `src/app/api/v1/recurring/[id]/route.ts` | Accept + persist `accountId` on update |
| `src/app/api/v1/transactions/summary/route.ts` | Add `isTransfer: false` to where |
| `src/app/api/v1/dashboard/summary/route.ts` | Add `isTransfer: false` to where |
| `src/app/api/v1/dashboard/by-category/route.ts` | Add `isTransfer: false` to where |
| `src/app/api/v1/dashboard/category-trend/route.ts` | Add `isTransfer: false` to where |
| `src/app/api/v1/family/summary/route.ts` | Add `isTransfer: false` to where |
| `src/app/api/v1/budgets/comparison/route.ts` | Add `isTransfer: false` to where |
| `src/app/api/v1/budgets/yearly-comparison/route.ts` | Add `isTransfer: false` to where |
| `src/components/forms/transaction-form.tsx` | Swap payment-method picker → account picker |
| `src/components/forms/recurring-form.tsx` | Swap payment-method picker → account picker |
| `src/components/layout/bottom-nav.tsx` | Replace /recurring tab with /accounts tab |
| `src/app/(app)/settings/page.tsx` | Add link to /recurring (moved from nav) |
| `src/app/(app)/dashboard/page.tsx` | Add WalletSummaryCard above DebtBanner |

---

## Task 1: Schema — Account + Transfer models + Transaction changes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `AccountType` enum and `Account` model to schema**

In `prisma/schema.prisma`, after the `PaymentMethodType` enum block, add:

```prisma
enum AccountType {
  CASH
  BANK_ACCOUNT
  SAVINGS
  E_WALLET
  CREDIT_CARD
}

model Account {
  id             String      @id @default(cuid())
  userId         String      @map("user_id")
  user           User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  type           AccountType
  initialBalance Decimal     @default(0) @map("initial_balance") @db.Decimal(12, 2)
  creditLimit    Decimal?    @map("credit_limit") @db.Decimal(12, 2)
  statementDay   Int?        @map("statement_day")
  paymentDueDay  Int?        @map("payment_due_day")
  isDefault      Boolean     @default(false) @map("is_default")
  isActive       Boolean     @default(true) @map("is_active")
  sortOrder      Int         @default(0) @map("sort_order")
  createdAt      DateTime    @default(now()) @map("created_at")
  updatedAt      DateTime    @updatedAt @map("updated_at")

  transactions  Transaction[]
  recurringTxns RecurringTransaction[]
  transfersFrom Transfer[]   @relation("TransferFrom")
  transfersTo   Transfer[]   @relation("TransferTo")

  @@index([userId])
  @@map("accounts")
}

model Transfer {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fromAccountId String   @map("from_account_id")
  fromAccount   Account  @relation("TransferFrom", fields: [fromAccountId], references: [id])
  toAccountId   String   @map("to_account_id")
  toAccount     Account  @relation("TransferTo", fields: [toAccountId], references: [id])
  amount        Decimal  @db.Decimal(12, 2)
  date          DateTime @db.Date
  note          String?
  fromTxId      String?  @unique @map("from_tx_id")
  toTxId        String?  @unique @map("to_tx_id")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("transfers")
}
```

- [ ] **Step 2: Update `Transaction` model — add accountId, isTransfer; make categoryId nullable**

Find the `Transaction` model. Change `categoryId` from non-nullable to nullable, and add two new fields:

```prisma
// Change this:
categoryId      String          @map("category_id")
category        Category        @relation(fields: [categoryId], references: [id])

// To this:
categoryId      String?         @map("category_id")
category        Category?       @relation(fields: [categoryId], references: [id])
```

Add after `paymentMethodId` / `paymentMethod` block:

```prisma
  accountId    String?  @map("account_id")
  account      Account? @relation(fields: [accountId], references: [id])
  isTransfer   Boolean  @default(false) @map("is_transfer")
```

Add index: `@@index([accountId])` to Transaction's index block.

- [ ] **Step 3: Update `RecurringTransaction` model — add accountId**

In the `RecurringTransaction` model, after the `paymentMethod` relation line, add:

```prisma
  accountId       String?  @map("account_id")
  account         Account? @relation(fields: [accountId], references: [id])
```

- [ ] **Step 4: Update `User` model — add accounts and transfers relations**

In the `User` model, add:

```prisma
  accounts  Account[]
  transfers Transfer[]
```

- [ ] **Step 5: Run migration (creates tables, migrates data)**

```bash
npx prisma migrate dev --name add_account_transfer_wallet
```

When Prisma opens the migration SQL file for editing, ADD these SQL statements at the end (before the final closing), to migrate existing PaymentMethod data:

```sql
-- Migrate payment_methods → accounts (type mapping)
INSERT INTO accounts (id, user_id, name, type, initial_balance, is_default, sort_order, created_at, updated_at)
SELECT
  id,
  user_id,
  name,
  CASE type::text
    WHEN 'CASH'          THEN 'CASH'
    WHEN 'QR_PAYMENT'    THEN 'E_WALLET'
    WHEN 'BANK_TRANSFER' THEN 'BANK_ACCOUNT'
    WHEN 'CREDIT_CARD'   THEN 'CREDIT_CARD'
    WHEN 'DEBIT_CARD'    THEN 'BANK_ACCOUNT'
    WHEN 'PAY_LATER'     THEN 'BANK_ACCOUNT'
    ELSE 'CASH'
  END,
  0,
  is_default,
  sort_order,
  created_at,
  NOW()
FROM payment_methods;

-- Repoint transactions to accounts
UPDATE transactions SET account_id = payment_method_id WHERE payment_method_id IS NOT NULL;

-- Repoint recurring_transactions to accounts
UPDATE recurring_transactions SET account_id = payment_method_id WHERE payment_method_id IS NOT NULL;
```

Expected output: `✓ Generated Prisma Client` with no errors.

- [ ] **Step 6: Verify migration**

```bash
npx prisma studio
```

Open browser to `http://localhost:5555`. Confirm:
- `accounts` table has rows (same count as `payment_methods`)
- `transactions` rows have `account_id` populated (where `payment_method_id` was non-null)
- `recurring_transactions` rows have `account_id` populated

Close Prisma Studio (`Ctrl+C`).

- [ ] **Step 7: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `✓ Generated Prisma Client`

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Account, Transfer models; migrate PaymentMethod data"
```

---

## Task 2: Validation schemas

**Files:**
- Create: `src/lib/validations/account.ts`
- Modify: `src/lib/validations/transaction.ts`
- Modify: `src/lib/validations/recurring.ts`

- [ ] **Step 1: Create `src/lib/validations/account.ts`**

```typescript
import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().min(1, "กรุณาใส่ชื่อ").max(50, "ชื่อยาวเกินไป"),
  type: z.enum(["CASH", "BANK_ACCOUNT", "SAVINGS", "E_WALLET", "CREDIT_CARD"]),
  initialBalance: z.number().default(0),
  creditLimit: z.number().positive("วงเงินต้องมากกว่า 0").optional(),
  statementDay: z.number().int().min(1).max(28).optional(),
  paymentDueDay: z.number().int().min(1).max(28).optional(),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const updateAccountSchema = createAccountSchema.partial();

export const transferSchema = z
  .object({
    fromAccountId: z.string().cuid("รูปแบบ ID ไม่ถูกต้อง"),
    toAccountId: z.string().cuid("รูปแบบ ID ไม่ถูกต้อง"),
    amount: z.number().positive("จำนวนเงินต้องมากกว่า 0").max(999999999.99),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
    note: z.string().max(200).optional(),
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "ต้นทางและปลายทางต้องต่างกัน",
    path: ["toAccountId"],
  });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
```

- [ ] **Step 2: Update `src/lib/validations/transaction.ts` — add accountId**

Add `accountId` to `createTransactionSchema`:

```typescript
import { z } from "zod";

export const createTransactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z
    .number()
    .positive("จำนวนเงินต้องมากกว่า 0")
    .max(999999999.99, "จำนวนเงินเกินขีดจำกัด"),
  description: z.string().max(200, "คำอธิบายยาวเกินไป").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  paymentMethodId: z.string().min(1).nullable().optional(),
  accountId: z.string().cuid().nullable().optional(),
  isFamily: z.boolean().optional(),
  familyMemberId: z.string().min(1).nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
```

- [ ] **Step 3: Check and update `src/lib/validations/recurring.ts`**

Read the file, then add `accountId: z.string().cuid().nullable().optional()` to the existing schema (same pattern as step 2).

- [ ] **Step 4: Commit**

```bash
git add src/lib/validations/
git commit -m "feat(validation): add account + transfer schemas; add accountId to tx/recurring"
```

---

## Task 3: Add isTransfer filter to all aggregate routes

**Critical:** Without this, transfer legs inflate income/expense totals everywhere.

**Files:**
- Modify: `src/app/api/v1/transactions/summary/route.ts`
- Modify: `src/app/api/v1/transactions/route.ts`
- Modify: `src/app/api/v1/dashboard/summary/route.ts`
- Modify: `src/app/api/v1/dashboard/by-category/route.ts`
- Modify: `src/app/api/v1/dashboard/category-trend/route.ts`
- Modify: `src/app/api/v1/family/summary/route.ts`
- Modify: `src/app/api/v1/budgets/comparison/route.ts`
- Modify: `src/app/api/v1/budgets/yearly-comparison/route.ts`

- [ ] **Step 1: `transactions/summary/route.ts` — add `isTransfer: false` to baseWhere**

Find `const baseWhere = {` and add `isTransfer: false` to the object:

```typescript
const baseWhere = {
  userId: session.user.id,
  date: { gte: startDate, lt: endDate },
  isTransfer: false,
};
```

- [ ] **Step 2: `transactions/route.ts` — exclude transfer legs from list view**

Find the `where` object construction (the `if (familyFilter === "family")` block). After all the familyFilter branches build `where`, add before any remaining filters:

```typescript
// Always exclude auto-created transfer legs from the user-visible transaction list
(where as Record<string, unknown>).isTransfer = false;
```

Or more elegantly, add `isTransfer: false` directly into each branch's where object. Example for the default branch:

```typescript
} else {
  where = { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false };
}
```

Apply to ALL three branches (family, mine, default).

- [ ] **Step 3: `dashboard/summary/route.ts` — add `isTransfer: false`**

Find `let baseWhere: {` type declaration and add `isTransfer?: boolean` to the type. Add `isTransfer: false` in each branch that constructs `baseWhere`. Also add to the `splitGroups` groupBy query's where:

```typescript
const splitGroups = await prisma.transaction.groupBy({
  by: ["isFamily", "type"],
  where: { ...baseWhere, isTransfer: false },
  ...
```

- [ ] **Step 4: `dashboard/by-category/route.ts` — add `isTransfer: false`**

Find the `aggregateByCategory` helper function (or the inline where objects). Add `isTransfer: false` to every `where` that queries transactions. There are typically 2-4 query sites in this file.

- [ ] **Step 5: `dashboard/category-trend/route.ts` — add `isTransfer: false`**

Find the `where` object in the `groupBy` or `findMany` call. Add `isTransfer: false`.

- [ ] **Step 6: `family/summary/route.ts` — add `isTransfer: false`**

Find all `aggregate` or `groupBy` calls on `prisma.transaction`. Add `isTransfer: false` to each where.

- [ ] **Step 7: `budgets/comparison/route.ts` and `budgets/yearly-comparison/route.ts` — add filter**

In `comparison/route.ts`, find `prisma.transaction.findMany({` and add `isTransfer: false` to its `where` object.

In `yearly-comparison/route.ts`, find `prisma.transaction.findMany({` and add `isTransfer: false` to its `where` object.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If Prisma types complain about `isTransfer` not being on the Transaction where input, regenerate: `npx prisma generate`.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/v1/
git commit -m "fix(api): exclude isTransfer=true legs from all aggregate/summary routes"
```

---

## Task 4: Account list + create API

**Files:**
- Create: `src/app/api/v1/accounts/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAccountSchema } from "@/lib/validations/account";
import { Decimal } from "@/generated/prisma/client/runtime/library";

function getCycleStart(statementDay: number): Date {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (day >= statementDay) {
    return new Date(Date.UTC(year, month, statementDay));
  }
  return new Date(Date.UTC(year, month - 1, statementDay));
}

async function computeAccountBalance(
  accountId: string,
  initialBalance: Decimal
): Promise<number> {
  const [income, expense, tfOut, tfIn] = await Promise.all([
    prisma.transaction.aggregate({
      where: { accountId, type: "INCOME", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId, type: "EXPENSE", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { fromAccountId: accountId },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { toAccountId: accountId },
      _sum: { amount: true },
    }),
  ]);
  return (
    Number(initialBalance) +
    Number(income._sum.amount ?? 0) -
    Number(expense._sum.amount ?? 0) -
    Number(tfOut._sum.amount ?? 0) +
    Number(tfIn._sum.amount ?? 0)
  );
}

async function computeCycleUsed(
  accountId: string,
  statementDay: number
): Promise<number> {
  const cycleStart = getCycleStart(statementDay);
  const result = await prisma.transaction.aggregate({
    where: {
      accountId,
      type: "EXPENSE",
      isTransfer: false,
      date: { gte: cycleStart },
    },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const accounts = await prisma.account.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    const enriched = await Promise.all(
      accounts.map(async (acc) => {
        const balance = await computeAccountBalance(acc.id, acc.initialBalance);
        const cycleUsed =
          acc.type === "CREDIT_CARD" && acc.statementDay
            ? await computeCycleUsed(acc.id, acc.statementDay)
            : null;
        return {
          id: acc.id,
          name: acc.name,
          type: acc.type,
          balance,
          initialBalance: Number(acc.initialBalance),
          creditLimit: acc.creditLimit ? Number(acc.creditLimit) : null,
          cycleUsed,
          statementDay: acc.statementDay,
          paymentDueDay: acc.paymentDueDay,
          isDefault: acc.isDefault,
          isActive: acc.isActive,
          sortOrder: acc.sortOrder,
          createdAt: acc.createdAt,
        };
      })
    );

    return NextResponse.json({ success: true, data: enriched });
  } catch (err) {
    console.error("GET /api/v1/accounts error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.errors[0].message } },
        { status: 400 }
      );
    }

    const data = parsed.data;

    await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.account.updateMany({
          where: { userId: session.user.id },
          data: { isDefault: false },
        });
      }
      return tx.account.create({
        data: {
          userId: session.user.id,
          name: data.name,
          type: data.type,
          initialBalance: data.initialBalance ?? 0,
          creditLimit: data.creditLimit ?? null,
          statementDay: data.statementDay ?? null,
          paymentDueDay: data.paymentDueDay ?? null,
          isDefault: data.isDefault ?? false,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/v1/accounts error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test GET returns migrated accounts**

Start the dev server: `npm run dev -- -p 3001`

In a separate terminal, use the fixture account session cookie or write a quick curl:

```bash
# Quick smoke test — check accounts endpoint works
curl -s http://localhost:3001/api/v1/accounts \
  -H "Cookie: $(cat /tmp/session-cookie.txt 2>/dev/null || echo '')" | head -c 200
```

Expected: JSON with `success: true` (even if data is empty for a fresh test account).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/accounts/route.ts
git commit -m "feat(api): add GET/POST /api/v1/accounts with computed balance"
```

---

## Task 5: Account summary API (dashboard card)

**Files:**
- Create: `src/app/api/v1/accounts/summary/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getCycleStart(statementDay: number): Date {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (day >= statementDay) {
    return new Date(Date.UTC(year, month, statementDay));
  }
  return new Date(Date.UTC(year, month - 1, statementDay));
}

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const accounts = await prisma.account.findMany({
      where: { userId: session.user.id, isActive: true },
    });

    const creditAccounts = accounts.filter((a) => a.type === "CREDIT_CARD");
    const liquidAccounts = accounts.filter((a) => a.type !== "CREDIT_CARD");

    // Compute liquid balances
    const liquidBalances = await Promise.all(
      liquidAccounts.map(async (acc) => {
        const [income, expense, tfOut, tfIn] = await Promise.all([
          prisma.transaction.aggregate({ where: { accountId: acc.id, type: "INCOME", isTransfer: false }, _sum: { amount: true } }),
          prisma.transaction.aggregate({ where: { accountId: acc.id, type: "EXPENSE", isTransfer: false }, _sum: { amount: true } }),
          prisma.transfer.aggregate({ where: { fromAccountId: acc.id }, _sum: { amount: true } }),
          prisma.transfer.aggregate({ where: { toAccountId: acc.id }, _sum: { amount: true } }),
        ]);
        return (
          Number(acc.initialBalance) +
          Number(income._sum.amount ?? 0) -
          Number(expense._sum.amount ?? 0) -
          Number(tfOut._sum.amount ?? 0) +
          Number(tfIn._sum.amount ?? 0)
        );
      })
    );
    const liquidTotal = liquidBalances.reduce((sum, b) => sum + b, 0);

    // Compute credit card cycle used
    let creditUsed = 0;
    let creditLimit = 0;
    for (const acc of creditAccounts) {
      creditLimit += Number(acc.creditLimit ?? 0);
      if (acc.statementDay) {
        const cycleStart = getCycleStart(acc.statementDay);
        const result = await prisma.transaction.aggregate({
          where: { accountId: acc.id, type: "EXPENSE", isTransfer: false, date: { gte: cycleStart } },
          _sum: { amount: true },
        });
        creditUsed += Number(result._sum.amount ?? 0);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        liquidTotal,
        creditUsed,
        creditLimit,
        hasCreditCards: creditAccounts.length > 0,
      },
    });
  } catch (err) {
    console.error("GET /api/v1/accounts/summary error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/v1/accounts/summary/route.ts
git commit -m "feat(api): add GET /api/v1/accounts/summary for dashboard card"
```

---

## Task 6: Account detail + update + delete API

**Files:**
- Create: `src/app/api/v1/accounts/[id]/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateAccountSchema } from "@/lib/validations/account";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const account = await prisma.account.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชี" } },
        { status: 404 }
      );
    }

    const [income, expense, tfOut, tfIn] = await Promise.all([
      prisma.transaction.aggregate({ where: { accountId: id, type: "INCOME", isTransfer: false }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { accountId: id, type: "EXPENSE", isTransfer: false }, _sum: { amount: true } }),
      prisma.transfer.aggregate({ where: { fromAccountId: id }, _sum: { amount: true } }),
      prisma.transfer.aggregate({ where: { toAccountId: id }, _sum: { amount: true } }),
    ]);
    const balance =
      Number(account.initialBalance) +
      Number(income._sum.amount ?? 0) -
      Number(expense._sum.amount ?? 0) -
      Number(tfOut._sum.amount ?? 0) +
      Number(tfIn._sum.amount ?? 0);

    const recentTransactions = await prisma.transaction.findMany({
      where: { accountId: id, isTransfer: false },
      orderBy: { date: "desc" },
      take: 20,
      include: { category: { select: { name: true, icon: true } } },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: account.id,
        name: account.name,
        type: account.type,
        balance,
        initialBalance: Number(account.initialBalance),
        creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
        statementDay: account.statementDay,
        paymentDueDay: account.paymentDueDay,
        isDefault: account.isDefault,
        sortOrder: account.sortOrder,
        recentTransactions: recentTransactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description,
          date: t.date,
          categoryName: t.category?.name ?? null,
          categoryIcon: t.category?.icon ?? null,
        })),
      },
    });
  } catch (err) {
    console.error("GET /api/v1/accounts/[id] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const account = await prisma.account.findFirst({ where: { id, userId: session.user.id } });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชี" } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = updateAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.errors[0].message } },
        { status: 400 }
      );
    }

    const data = parsed.data;
    await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.account.updateMany({
          where: { userId: session.user.id, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.account.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.initialBalance !== undefined && { initialBalance: data.initialBalance }),
          ...(data.creditLimit !== undefined && { creditLimit: data.creditLimit }),
          ...(data.statementDay !== undefined && { statementDay: data.statementDay }),
          ...(data.paymentDueDay !== undefined && { paymentDueDay: data.paymentDueDay }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/v1/accounts/[id] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const account = await prisma.account.findFirst({ where: { id, userId: session.user.id } });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชี" } },
        { status: 404 }
      );
    }

    const [txCount, tfCount] = await Promise.all([
      prisma.transaction.count({ where: { accountId: id } }),
      prisma.transfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } }),
    ]);

    if (txCount > 0 || tfCount > 0) {
      return NextResponse.json(
        { success: false, error: { code: "HAS_TRANSACTIONS", message: "ไม่สามารถลบได้ มีรายการที่เชื่อมอยู่" } },
        { status: 409 }
      );
    }

    await prisma.account.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/v1/accounts/[id] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/v1/accounts/[id]/route.ts
git commit -m "feat(api): add GET/PATCH/DELETE /api/v1/accounts/[id]"
```

---

## Task 7: Transfer API

**Files:**
- Create: `src/app/api/v1/accounts/transfer/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transferSchema } from "@/lib/validations/account";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.errors[0].message } },
        { status: 400 }
      );
    }

    const { fromAccountId, toAccountId, amount, date, note } = parsed.data;

    // Verify both accounts belong to this user
    const [fromAcc, toAcc] = await Promise.all([
      prisma.account.findFirst({ where: { id: fromAccountId, userId: session.user.id } }),
      prisma.account.findFirst({ where: { id: toAccountId, userId: session.user.id } }),
    ]);
    if (!fromAcc || !toAcc) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชีที่ระบุ" } },
        { status: 404 }
      );
    }

    const txDate = new Date(date + "T00:00:00.000Z");

    const transfer = await prisma.$transaction(async (tx) => {
      const fromTx = await tx.transaction.create({
        data: {
          userId: session.user.id,
          type: "EXPENSE",
          amount,
          date: txDate,
          description: `โอน → ${toAcc.name}${note ? ` (${note})` : ""}`,
          accountId: fromAccountId,
          isTransfer: true,
          categoryId: null,
        },
      });
      const toTx = await tx.transaction.create({
        data: {
          userId: session.user.id,
          type: "INCOME",
          amount,
          date: txDate,
          description: `โอน ← ${fromAcc.name}${note ? ` (${note})` : ""}`,
          accountId: toAccountId,
          isTransfer: true,
          categoryId: null,
        },
      });
      return tx.transfer.create({
        data: {
          userId: session.user.id,
          fromAccountId,
          toAccountId,
          amount,
          date: txDate,
          note: note ?? null,
          fromTxId: fromTx.id,
          toTxId: toTx.id,
        },
      });
    });

    return NextResponse.json({ success: true, data: { id: transfer.id } }, { status: 201 });
  } catch (err) {
    console.error("POST /api/v1/accounts/transfer error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/v1/accounts/transfer/route.ts
git commit -m "feat(api): add POST /api/v1/accounts/transfer (atomic, isTransfer-flagged)"
```

---

## Task 8: Update transactions + recurring APIs to accept accountId

**Files:**
- Modify: `src/app/api/v1/transactions/route.ts`
- Modify: `src/app/api/v1/transactions/[id]/route.ts`
- Modify: `src/app/api/v1/recurring/route.ts`
- Modify: `src/app/api/v1/recurring/[id]/route.ts`

- [ ] **Step 1: `transactions/route.ts` POST — persist `accountId`**

In the POST handler, find where the transaction is created with `prisma.transaction.create`. Add `accountId` to the data object:

```typescript
const transaction = await prisma.transaction.create({
  data: {
    // ... existing fields ...
    accountId: body.accountId ?? null,
  },
  // ...
});
```

- [ ] **Step 2: `transactions/[id]/route.ts` PUT — persist `accountId`**

Find the `prisma.transaction.update` call. Add:

```typescript
...(body.accountId !== undefined && { accountId: body.accountId }),
```

- [ ] **Step 3: `recurring/route.ts` POST — persist `accountId`**

Same pattern: add `accountId: body.accountId ?? null` to `prisma.recurringTransaction.create`.

- [ ] **Step 4: `recurring/[id]/route.ts` PUT — persist `accountId`**

Add `...(body.accountId !== undefined && { accountId: body.accountId })` to the update data.

- [ ] **Step 5: Compile check + commit**

```bash
npx tsc --noEmit && git add src/app/api/v1/transactions/ src/app/api/v1/recurring/ && git commit -m "feat(api): accept accountId on transaction + recurring create/update"
```

---

## Task 9: Account form component

**Files:**
- Create: `src/components/forms/account-form.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createAccountSchema, type CreateAccountInput } from "@/lib/validations/account";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ExistingAccount {
  id: string;
  name: string;
  type: string;
  initialBalance: number;
  creditLimit: number | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isDefault: boolean;
  sortOrder: number;
}

interface AccountFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialAccount?: ExistingAccount;
}

const ACCOUNT_TYPES = [
  { value: "CASH",         label: "เงินสด",   emoji: "💵" },
  { value: "BANK_ACCOUNT", label: "ธนาคาร",   emoji: "🏦" },
  { value: "SAVINGS",      label: "ออมทรัพย์", emoji: "💰" },
  { value: "E_WALLET",     label: "E-Wallet",  emoji: "📱" },
  { value: "CREDIT_CARD",  label: "บัตรเครดิต", emoji: "💳" },
] as const;

function FormRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

export function AccountForm({ open, onClose, onSuccess, initialAccount }: AccountFormProps) {
  const isEdit = !!initialAccount;
  const [accountType, setAccountType] = useState<string>(initialAccount?.type ?? "CASH");
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<CreateAccountInput>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      name: initialAccount?.name ?? "",
      type: (initialAccount?.type as CreateAccountInput["type"]) ?? "CASH",
      initialBalance: initialAccount?.initialBalance ?? 0,
      creditLimit: initialAccount?.creditLimit ?? undefined,
      statementDay: initialAccount?.statementDay ?? undefined,
      paymentDueDay: initialAccount?.paymentDueDay ?? undefined,
      isDefault: initialAccount?.isDefault ?? false,
      sortOrder: initialAccount?.sortOrder ?? 0,
    },
  });

  function handleTypeSelect(type: string) {
    setAccountType(type);
    setValue("type", type as CreateAccountInput["type"]);
  }

  async function onSubmit(data: CreateAccountInput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/accounts/${initialAccount!.id}` : "/api/v1/accounts";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) { setServerError(json.error?.message ?? "เกิดข้อผิดพลาด"); return; }
      onSuccess();
      onClose();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>{isEdit ? "แก้ไขบัญชี" : "เพิ่มบัญชีใหม่"}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pb-8">
          <FormRow label="ประเภท">
            <div className="grid grid-cols-5 gap-1.5">
              {ACCOUNT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeSelect(t.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 rounded-xl text-center transition-all border",
                    accountType === t.value
                      ? "bg-primary text-white border-primary"
                      : "bg-secondary text-muted-foreground border-transparent"
                  )}
                >
                  <span className="text-[18px]">{t.emoji}</span>
                  <span className="text-[10px] font-medium leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          </FormRow>

          <FormRow label="ชื่อบัญชี" error={errors.name?.message}>
            <Input {...register("name")} placeholder="เช่น เงินออม, UOB Preferred" className="ios-card" />
          </FormRow>

          <FormRow label="ยอดเริ่มต้น (฿)" error={errors.initialBalance?.message}>
            <Input
              {...register("initialBalance", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              placeholder="0"
              className="ios-card"
            />
          </FormRow>

          {accountType === "CREDIT_CARD" && (
            <>
              <FormRow label="วงเงินสินเชื่อ (฿)" error={errors.creditLimit?.message}>
                <Input
                  {...register("creditLimit", { valueAsNumber: true })}
                  type="number"
                  inputMode="decimal"
                  placeholder="50000"
                  className="ios-card"
                />
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="รอบบิลปิดวันที่" error={errors.statementDay?.message}>
                  <Input
                    {...register("statementDay", { valueAsNumber: true })}
                    type="number"
                    inputMode="numeric"
                    min={1} max={28}
                    placeholder="15"
                    className="ios-card"
                  />
                </FormRow>
                <FormRow label="ครบกำหนดชำระวันที่" error={errors.paymentDueDay?.message}>
                  <Input
                    {...register("paymentDueDay", { valueAsNumber: true })}
                    type="number"
                    inputMode="numeric"
                    min={1} max={28}
                    placeholder="5"
                    className="ios-card"
                  />
                </FormRow>
              </div>
            </>
          )}

          {serverError && <p className="text-[13px] text-destructive text-center">{serverError}</p>}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? "บันทึก" : "เพิ่ม"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/forms/account-form.tsx
git commit -m "feat(ui): add AccountForm Sheet component"
```

---

## Task 10: Transfer form component

**Files:**
- Create: `src/components/forms/transfer-form.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { transferSchema, type TransferInput } from "@/lib/validations/account";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
}

interface TransferFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultFromAccountId?: string;
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function FormRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

export function TransferForm({ open, onClose, onSuccess, defaultFromAccountId }: TransferFormProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<TransferInput>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: defaultFromAccountId ?? "",
      toAccountId: "",
      amount: undefined,
      date: todayString(),
      note: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then((d) => { if (d.success) setAccounts(d.data); });
  }, [open]);

  async function onSubmit(data: TransferInput) {
    setServerError("");
    try {
      const res = await fetch("/api/v1/accounts/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, amount: Number(data.amount) }),
      });
      const json = await res.json();
      if (!json.success) { setServerError(json.error?.message ?? "เกิดข้อผิดพลาด"); return; }
      onSuccess();
      onClose();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  const watchedFrom = watch("fromAccountId");
  const watchedTo = watch("toAccountId");
  const fromBalance = accounts.find((a) => a.id === watchedFrom)?.balance;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="pb-4">
          <SheetTitle>โอนเงินระหว่างกระเป๋า</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pb-8">
          <FormRow label="จากบัญชี" error={errors.fromAccountId?.message}>
            <Select
              value={watchedFrom}
              onValueChange={(v) => setValue("fromAccountId", v)}
            >
              <SelectTrigger className="ios-card">
                <SelectValue placeholder="เลือกบัญชีต้นทาง" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.id === watchedTo}>
                    {TYPE_EMOJI[a.type] ?? "💰"} {a.name}
                    {fromBalance !== undefined && a.id === watchedFrom
                      ? ` (฿${fromBalance.toLocaleString("th-TH", { minimumFractionDigits: 2 })})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label="ไปยังบัญชี" error={errors.toAccountId?.message}>
            <Select
              value={watchedTo}
              onValueChange={(v) => setValue("toAccountId", v)}
            >
              <SelectTrigger className="ios-card">
                <SelectValue placeholder="เลือกบัญชีปลายทาง" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.id === watchedFrom}>
                    {TYPE_EMOJI[a.type] ?? "💰"} {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label="จำนวนเงิน (฿)" error={errors.amount?.message}>
            <Input
              {...register("amount", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              className="ios-card"
            />
          </FormRow>

          <FormRow label="วันที่" error={errors.date?.message}>
            <Input {...register("date")} type="date" className="ios-card" />
          </FormRow>

          <FormRow label="หมายเหตุ (ไม่บังคับ)">
            <Input {...register("note")} placeholder="เช่น เก็บเงินเที่ยว" className="ios-card" />
          </FormRow>

          {serverError && <p className="text-[13px] text-destructive text-center">{serverError}</p>}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยันโอน"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/forms/transfer-form.tsx
git commit -m "feat(ui): add TransferForm Sheet component"
```

---

## Task 11: /accounts list page

**Files:**
- Create: `src/app/(app)/accounts/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountForm } from "@/components/forms/account-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  initialBalance: number;
  creditLimit: number | null;
  cycleUsed: number | null;
  statementDay: number | null;
  isDefault: boolean;
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};

function formatCurrency(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardBalances, setOnboardBalances] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch("/api/v1/accounts");
    const json = await res.json();
    if (json.success) {
      setAccounts(json.data);
      // Show onboarding if never dismissed and all initialBalances are 0
      const neverOnboarded = !localStorage.getItem("wallet_onboarded");
      const allZero = json.data.length > 0 && json.data.every((a: Account) => a.initialBalance === 0);
      if (neverOnboarded && allZero) {
        const initial: Record<string, string> = {};
        json.data.forEach((a: Account) => { initial[a.id] = ""; });
        setOnboardBalances(initial);
        setOnboardOpen(true);
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleOnboardSave() {
    await Promise.all(
      Object.entries(onboardBalances)
        .filter(([, v]) => v !== "" && !isNaN(parseFloat(v)))
        .map(([id, v]) =>
          fetch(`/api/v1/accounts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initialBalance: parseFloat(v) }),
          })
        )
    );
    localStorage.setItem("wallet_onboarded", "true");
    setOnboardOpen(false);
    load();
  }

  const liquidTotal = accounts
    .filter((a) => a.type !== "CREDIT_CARD")
    .reduce((sum, a) => sum + a.balance, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold">กระเป๋าเงิน</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setTransferOpen(true)}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            โอน
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            เพิ่ม
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => router.push(`/accounts/${acc.id}`)}
            className="ios-card w-full px-4 py-3.5 text-left active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[22px]">{TYPE_EMOJI[acc.type] ?? "💰"}</span>
                <div>
                  <p className="text-[15px] font-semibold">{acc.name}</p>
                  {acc.type === "CREDIT_CARD" && acc.statementDay && (
                    <p className="text-[11px] text-muted-foreground">รอบบิลวันที่ {acc.statementDay}</p>
                  )}
                </div>
              </div>
              {acc.type === "CREDIT_CARD" && acc.creditLimit ? (
                <div className="text-right">
                  <p className="text-[13px] text-muted-foreground">
                    ใช้ไป{" "}
                    <span className="text-[#FF3B30] font-semibold">
                      ฿{formatCurrency(acc.cycleUsed ?? 0)}
                    </span>
                  </p>
                  <div className="mt-1 w-28 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#FF3B30] rounded-full"
                      style={{ width: `${Math.min(100, ((acc.cycleUsed ?? 0) / acc.creditLimit) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    วงเงิน ฿{formatCurrency(acc.creditLimit)}
                  </p>
                </div>
              ) : (
                <p className={cn("text-[17px] font-bold tabular-nums", acc.balance < 0 ? "text-[#FF3B30]" : "text-foreground")}>
                  ฿{formatCurrency(acc.balance)}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      {accounts.length > 0 && (
        <div className="ios-card px-4 py-3 flex justify-between items-center">
          <p className="text-[13px] text-muted-foreground">รวมเงินสด</p>
          <p className="text-[15px] font-bold tabular-nums">฿{formatCurrency(liquidTotal)}</p>
        </div>
      )}

      <AccountForm open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
      <TransferForm open={transferOpen} onClose={() => setTransferOpen(false)} onSuccess={load} />

      {/* Onboarding wizard */}
      <Sheet open={onboardOpen} onOpenChange={(o) => { if (!o) { localStorage.setItem("wallet_onboarded", "true"); setOnboardOpen(false); } }}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader className="pb-2">
            <SheetTitle>ตั้งยอดเริ่มต้น</SheetTitle>
            <p className="text-[13px] text-muted-foreground">กรอกยอดเงินปัจจุบันในแต่ละกระเป๋า เพื่อให้ยอดคงเหลือถูกต้อง</p>
          </SheetHeader>
          <div className="space-y-3 py-4">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center gap-3">
                <span className="text-[20px]">{TYPE_EMOJI[acc.type] ?? "💰"}</span>
                <p className="text-[14px] font-medium flex-1">{acc.name}</p>
                <div className="w-36">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={onboardBalances[acc.id] ?? ""}
                    onChange={(e) => setOnboardBalances((p) => ({ ...p, [acc.id]: e.target.value }))}
                    className="ios-card text-right"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pb-8">
            <Button
              variant="secondary"
              onClick={() => { localStorage.setItem("wallet_onboarded", "true"); setOnboardOpen(false); }}
            >
              ข้ามไปก่อน
            </Button>
            <Button onClick={handleOnboardSave}>บันทึก</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/accounts/page.tsx
git commit -m "feat(ui): add /accounts list page with onboarding wizard"
```

---

## Task 12: /accounts/[id] detail page

**Files:**
- Create: `src/app/(app)/accounts/[id]/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft, ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AccountForm } from "@/components/forms/account-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { cn } from "@/lib/utils";

interface AccountDetail {
  id: string;
  name: string;
  type: string;
  balance: number;
  initialBalance: number;
  creditLimit: number | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isDefault: boolean;
  sortOrder: number;
  recentTransactions: {
    id: string;
    type: "INCOME" | "EXPENSE";
    amount: number;
    description: string | null;
    date: string;
    categoryName: string | null;
    categoryIcon: string | null;
  }[];
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};
const TYPE_LABEL: Record<string, string> = {
  CASH: "เงินสด", BANK_ACCOUNT: "บัญชีธนาคาร", SAVINGS: "ออมทรัพย์", E_WALLET: "E-Wallet", CREDIT_CARD: "บัตรเครดิต",
};

function formatCurrency(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

export default function AccountDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/accounts/${params.id}`);
    const json = await res.json();
    if (json.success) setAccount(json.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [params.id]);

  async function handleDelete() {
    setDeleteLoading(true);
    setDeleteError("");
    const res = await fetch(`/api/v1/accounts/${params.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) { router.push("/accounts"); return; }
    setDeleteError(json.error?.message ?? "เกิดข้อผิดพลาด");
    setDeleteLoading(false);
  }

  if (loading || !account) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const isCreditCard = account.type === "CREDIT_CARD";

  return (
    <div className="pt-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/accounts")} className="flex items-center gap-1 text-primary">
          <ChevronLeft className="h-5 w-5" />
          <span className="text-[15px]">กระเป๋า</span>
        </button>
        <Button variant="ghost" size="sm" className="text-primary" onClick={() => setEditOpen(true)}>
          แก้ไข
        </Button>
      </div>

      {/* Balance card */}
      <div className="ios-card px-5 py-5 text-center space-y-1">
        <p className="text-[13px] text-muted-foreground">{TYPE_EMOJI[account.type]} {account.name}</p>
        <p className="text-[11px] text-muted-foreground">{TYPE_LABEL[account.type] ?? account.type}</p>
        <p className={cn("text-[36px] font-bold tabular-nums mt-2", account.balance < 0 ? "text-[#FF3B30]" : "text-foreground")}>
          ฿{formatCurrency(Math.abs(account.balance))}
          {account.balance < 0 && <span className="text-[20px]"> (ติดลบ)</span>}
        </p>
        {isCreditCard && account.creditLimit && (
          <div className="mt-3 space-y-1.5">
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-[#FF3B30] rounded-full"
                style={{ width: `${Math.min(100, (Math.abs(account.balance) / account.creditLimit) * 100)}%` }}
              />
            </div>
            <p className="text-[12px] text-muted-foreground">
              วงเงิน ฿{formatCurrency(account.creditLimit)} · ครบกำหนดชำระวันที่ {account.paymentDueDay ?? "-"}
            </p>
          </div>
        )}
      </div>

      {/* Transfer button */}
      <Button
        variant="secondary"
        className="w-full gap-2"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-4 w-4" />
        โอนออก
      </Button>

      {/* Recent transactions */}
      <div>
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">รายการล่าสุด</p>
        {account.recentTransactions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-6">ยังไม่มีรายการ</p>
        ) : (
          <div className="ios-card divide-y divide-border/50">
            {account.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-[18px]">{tx.categoryIcon ?? "📝"}</span>
                  <div>
                    <p className="text-[14px] font-medium">{tx.categoryName ?? tx.description ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(tx.date)}</p>
                  </div>
                </div>
                <p className={cn("text-[14px] font-semibold tabular-nums", tx.type === "INCOME" ? "text-[#34C759]" : "text-[#FF3B30]")}>
                  {tx.type === "INCOME" ? "+" : "−"}฿{formatCurrency(tx.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="pt-4 pb-2">
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => { setDeleteError(""); setDeleteDialog(true); }}
        >
          ลบบัญชีนี้
        </Button>
      </div>

      <AccountForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={() => { setEditOpen(false); load(); }}
        initialAccount={account}
      />
      <TransferForm
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={load}
        defaultFromAccountId={account.id}
      />

      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบบัญชี</DialogTitle>
            <DialogDescription>
              ลบ &ldquo;{account.name}&rdquo;? การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-[13px] text-destructive text-center">{deleteError}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteDialog(false)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "ลบ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/accounts/[id]/page.tsx
git commit -m "feat(ui): add /accounts/[id] detail page"
```

---

## Task 13: Dashboard wallet summary card

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add WalletSummaryCard to dashboard**

In `dashboard/page.tsx`, add a new state + fetch for accounts summary. Add this near the top of the component (alongside other state declarations):

```typescript
const [walletSummary, setWalletSummary] = useState<{
  liquidTotal: number;
  creditUsed: number;
  creditLimit: number;
  hasCreditCards: boolean;
} | null>(null);
const [walletLoading, setWalletLoading] = useState(true);
```

Add to the existing `useEffect` data fetching (or create a separate one):

```typescript
fetch("/api/v1/accounts/summary")
  .then((r) => r.json())
  .then((d) => { if (d.success) setWalletSummary(d.data); })
  .finally(() => setWalletLoading(false));
```

Add this JSX block between the period navigator and DebtBanner in the return statement:

```tsx
{/* Wallet summary card */}
{walletLoading ? (
  <div className="ios-card mx-0 px-4 py-3 space-y-2">
    <div className="h-3.5 w-20 bg-muted rounded animate-pulse" />
    <div className="h-3.5 w-32 bg-muted rounded animate-pulse" />
  </div>
) : walletSummary ? (
  <div className="ios-card px-4 py-3">
    <div className="flex items-center justify-between mb-2">
      <p className="text-[13px] font-semibold text-foreground">กระเป๋าเงิน</p>
      <Link href="/accounts" className="text-[12px] text-primary">ดูทั้งหมด →</Link>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-muted-foreground">💰 เงินสด</span>
      <span className="text-[13px] font-semibold tabular-nums">
        ฿{walletSummary.liquidTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
      </span>
    </div>
    {walletSummary.hasCreditCards && (
      <div className="flex items-center justify-between mt-1">
        <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต</span>
        <span className="text-[13px] font-semibold tabular-nums text-[#FF3B30]">
          ฿{walletSummary.creditUsed.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          {" / "}
          ฿{walletSummary.creditLimit.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </span>
      </div>
    )}
  </div>
) : null}
```

Make sure `Link` is imported from `"next/link"` (already imported in dashboard page).

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx
git commit -m "feat(ui): add wallet summary card to dashboard"
```

---

## Task 14: Update transaction form — account picker

**Files:**
- Modify: `src/components/forms/transaction-form.tsx`

- [ ] **Step 1: Add Account interface and state**

At the top of the file, add a new interface and update existing ones:

```typescript
interface Account {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}
```

In the component body, add:

```typescript
const [accounts, setAccounts] = useState<Account[]>([]);
```

- [ ] **Step 2: Fetch accounts alongside existing data**

In the `useEffect` `loadData`, add `fetch("/api/v1/accounts")` to the `Promise.all`:

```typescript
const [catRes, pmRes, fmRes, fgRes, accRes] = await Promise.all([
  fetch("/api/v1/categories"),
  fetch("/api/v1/payment-methods"),
  fetch("/api/v1/family-members"),
  fetch("/api/v1/family"),
  fetch("/api/v1/accounts"),
]);
// ...
const accData = await accRes.json();
if (accData.success) setAccounts(accData.data);
```

- [ ] **Step 3: Add accountId to form defaultValues**

In `useForm` defaultValues, add:

```typescript
accountId: defaultValues?.accountId ?? 
  null, // will be set to default account after load
```

After accounts load, set the default:

```typescript
// Inside loadData, after setAccounts:
const defaultAccount = accData.data?.find((a: Account) => a.isDefault) ?? accData.data?.[0];
if (defaultAccount && !defaultValues?.accountId) {
  setValue("accountId", defaultAccount.id);
}
```

- [ ] **Step 4: Replace payment method UI with account picker**

Find the JSX that renders the payment method `<Select>`. Replace it with:

```tsx
<FormRow label="ชำระด้วย" error={errors.accountId?.message}>
  <Select
    value={watch("accountId") ?? ""}
    onValueChange={(v) => setValue("accountId", v || null)}
  >
    <SelectTrigger className="ios-card">
      <SelectValue placeholder="เลือกกระเป๋าเงิน" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">ไม่ระบุ</SelectItem>
      {accounts.map((a) => (
        <SelectItem key={a.id} value={a.id}>
          {TYPE_EMOJI[a.type] ?? "💰"} {a.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</FormRow>
```

Add `TYPE_EMOJI` constant at the top of the file:

```typescript
const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};
```

- [ ] **Step 5: Update onSubmit to send accountId**

In `onSubmit`, ensure `accountId` is included in the body. The existing spread `...data` already includes it since it's in the schema.

- [ ] **Step 6: Update PrefillValues interface to include accountId**

```typescript
interface PrefillValues {
  type?: "INCOME" | "EXPENSE";
  amount?: number;
  categoryId?: string;
  paymentMethodId?: string | null;
  accountId?: string | null;  // add this
  description?: string;
}
```

- [ ] **Step 7: Update TransactionFormProps defaultValues type**

Add `accountId?: string | null` to the `defaultValues` object type in `TransactionFormProps`.

- [ ] **Step 8: Commit**

```bash
git add src/components/forms/transaction-form.tsx
git commit -m "feat(ui): swap payment-method picker for account picker in TransactionForm"
```

---

## Task 15: Update recurring form — account picker

**Files:**
- Modify: `src/components/forms/recurring-form.tsx`

- [ ] **Step 1: Read current file to understand structure**

Read `src/components/forms/recurring-form.tsx` and identify:
- Where `paymentMethods` state is declared
- Where payment methods are fetched
- Where the payment method select is rendered

- [ ] **Step 2: Apply same account picker pattern as Task 14**

Follow the exact same steps as Task 14 (Steps 1–7) adapted for `recurring-form.tsx`:
- Add `Account` interface + `accounts` state
- Fetch `/api/v1/accounts` in the data loading useEffect
- Add `accountId` to form schema (already done in Task 2 Step 3)
- Replace payment method `<Select>` with account picker `<Select>`
- Add `TYPE_EMOJI` constant

- [ ] **Step 3: Commit**

```bash
git add src/components/forms/recurring-form.tsx
git commit -m "feat(ui): swap payment-method picker for account picker in RecurringForm"
```

---

## Task 16: Bottom nav update + /recurring in Settings

**Files:**
- Modify: `src/components/layout/bottom-nav.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Update bottom nav — replace แจ้งเตือน with กระเป๋า**

In `src/components/layout/bottom-nav.tsx`, replace the entire `navItems` array:

```typescript
import { Home, Receipt, CreditCard, BarChart3, WalletCards } from "lucide-react";

const navItems = [
  { href: "/dashboard",    label: "หน้าหลัก",  icon: Home },
  { href: "/transactions", label: "รายการ",    icon: Receipt },
  { href: "/accounts",     label: "กระเป๋า",   icon: WalletCards },
  { href: "/debts",        label: "หนี้สิน",   icon: CreditCard },
  { href: "/budget",       label: "งบการเงิน", icon: BarChart3 },
] as const;
```

Remove `BellRing` from imports.

- [ ] **Step 2: Add /recurring link to Settings page**

In `src/app/(app)/settings/page.tsx`, find the section that has links to `/settings/categories` and `/settings/payment-methods`. Add a link row for recurring reminders:

```tsx
<Link
  href="/recurring"
  className="flex items-center justify-between px-4 py-3 active:bg-secondary transition-colors"
>
  <div className="flex items-center gap-3">
    <BellRing className="h-[18px] w-[18px] text-muted-foreground" />
    <span className="text-[15px]">การแจ้งเตือนซ้ำ</span>
  </div>
  <ChevronRight className="h-4 w-4 text-muted-foreground" />
</Link>
```

Import `BellRing` and `ChevronRight` from `lucide-react` if not already imported in settings page.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/bottom-nav.tsx src/app/(app)/settings/page.tsx
git commit -m "feat(nav): replace /recurring tab with /accounts; add /recurring link to Settings"
```

---

## Task 17: End-to-end Playwright verification

**Files:**
- Create (throwaway): `/tmp/wallet-e2e.mjs`

- [ ] **Step 1: Rebuild Docker image**

```bash
docker compose up -d --build
```

Wait for container to be healthy:

```bash
until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done && echo "ready"
```

- [ ] **Step 2: Write verification script**

Create `/tmp/wallet-e2e.mjs`:

```javascript
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const EMAIL = 'skill-runcheck@test.local';
const PASSWORD = 'SkillRunCheck123!';

const errors = [];
const results = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('response', r => {
  if (r.status() >= 400 && !r.url().includes('forgot-password')) {
    errors.push(`HTTP ${r.status()}: ${r.url()}`);
  }
});

// Auth
async function login() {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return page.url().includes('/dashboard');
}
async function register() {
  await page.goto(`${BASE}/register`);
  await page.fill('input[name="name"]', 'Skill Run Check');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirmPassword"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return page.url().includes('/dashboard');
}
if (!(await login())) await register();
console.log('Auth OK');

// T1: /accounts loads, migrated accounts visible
await page.goto(`${BASE}/accounts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
const cards = await page.locator('.ios-card').count();
results.push(cards > 0 ? `PASS: /accounts loads (${cards} cards)` : 'FAIL: no account cards');

// T2: Onboarding wizard — if shown, fill and save
const onboardTitle = page.getByText('ตั้งยอดเริ่มต้น').first();
const onboardVisible = await onboardTitle.isVisible().catch(() => false);
if (onboardVisible) {
  const inputs = await page.locator('input[type="number"]').all();
  if (inputs.length > 0) { await inputs[0].fill('5000'); }
  await page.getByText('บันทึก').click();
  await page.waitForTimeout(1000);
  results.push('PASS: onboarding wizard saved');
} else {
  results.push('SKIP: onboarding not shown (already dismissed or no accounts)');
}

// T3: Create a SAVINGS account via API
const createRes = await page.request.post(`${BASE}/api/v1/accounts`, {
  data: { name: 'Test Savings', type: 'SAVINGS', initialBalance: 10000, isDefault: false, sortOrder: 99 }
});
const createJson = await createRes.json();
const testAccountCreated = createJson.success;
results.push(testAccountCreated ? 'PASS: create SAVINGS account' : `FAIL: create account: ${JSON.stringify(createJson)}`);

// T4: Create CREDIT_CARD account
const ccRes = await page.request.post(`${BASE}/api/v1/accounts`, {
  data: { name: 'Test CC', type: 'CREDIT_CARD', initialBalance: 0, creditLimit: 30000, statementDay: 15, paymentDueDay: 5, isDefault: false, sortOrder: 100 }
});
const ccJson = await ccRes.json();
results.push(ccJson.success ? 'PASS: create CREDIT_CARD account' : `FAIL: create CC account: ${JSON.stringify(ccJson)}`);

// Reload accounts to get IDs
await page.goto(`${BASE}/accounts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1000);
const accsRes = await page.request.get(`${BASE}/api/v1/accounts`);
const accs = (await accsRes.json()).data ?? [];
const savingsAcc = accs.find(a => a.name === 'Test Savings');
const cashAcc = accs.find(a => a.type === 'CASH');
const ccAcc = accs.find(a => a.name === 'Test CC');

// T5: Create transaction linked to savings account
const catRes = await page.request.get(`${BASE}/api/v1/categories`);
const cats = (await catRes.json()).data ?? [];
const expCat = cats.find(c => c.type === 'EXPENSE');
if (savingsAcc && expCat) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-05`;
  const txRes = await page.request.post(`${BASE}/api/v1/transactions`, {
    data: { type: 'EXPENSE', amount: 500, categoryId: expCat.id, date: dateStr, accountId: savingsAcc.id }
  });
  const txJson = await txRes.json();
  if (txJson.success) {
    const updAccRes = await page.request.get(`${BASE}/api/v1/accounts/${savingsAcc.id}`);
    const updAcc = (await updAccRes.json()).data;
    const expectedBal = 10000 - 500;
    results.push(Math.abs(updAcc.balance - expectedBal) < 0.01
      ? `PASS: balance after EXPENSE: ${updAcc.balance}`
      : `FAIL: expected ${expectedBal}, got ${updAcc.balance}`);
    // Cleanup tx
    await page.request.delete(`${BASE}/api/v1/transactions/${txJson.data.id}`);
  } else {
    results.push(`FAIL: create tx for balance test: ${JSON.stringify(txJson)}`);
  }
} else {
  results.push('SKIP: no savings account or expense category for balance test');
}

// T6: Transfer between accounts
if (cashAcc && savingsAcc) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-05`;
  const tfRes = await page.request.post(`${BASE}/api/v1/accounts/transfer`, {
    data: { fromAccountId: cashAcc.id, toAccountId: savingsAcc.id, amount: 1000, date: dateStr, note: 'e2e test' }
  });
  const tfJson = await tfRes.json();
  results.push(tfJson.success ? `PASS: transfer created (id: ${tfJson.data?.id})` : `FAIL: transfer: ${JSON.stringify(tfJson)}`);
} else {
  results.push('SKIP: no cash or savings account for transfer test');
}

// T7: Dashboard shows wallet card
await page.goto(`${BASE}/dashboard`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
const walletCard = page.getByText('กระเป๋าเงิน').first();
results.push(await walletCard.isVisible().catch(() => false)
  ? 'PASS: dashboard wallet summary card visible'
  : 'FAIL: dashboard wallet summary card not visible');

// T8: Delete account with transactions blocked
if (savingsAcc) {
  const delRes = await page.request.delete(`${BASE}/api/v1/accounts/${savingsAcc.id}`);
  const delJson = await delRes.json();
  results.push(!delJson.success && delJson.error?.code === 'HAS_TRANSACTIONS'
    ? 'PASS: delete with transactions blocked correctly'
    : `FAIL: expected HAS_TRANSACTIONS block, got: ${JSON.stringify(delJson)}`);
}

// T9: Bottom nav has กระเป๋า tab
await page.goto(`${BASE}/dashboard`);
await page.waitForTimeout(500);
const walletTab = page.locator('nav').getByText('กระเป๋า').first();
results.push(await walletTab.isVisible().catch(() => false)
  ? 'PASS: กระเป๋า tab in bottom nav'
  : 'FAIL: กระเป๋า tab missing from bottom nav');

// Cleanup: delete test accounts (transfers first if any)
const cleanupIds = [savingsAcc?.id, ccAcc?.id].filter(Boolean);
for (const id of cleanupIds) {
  // Delete linked transactions first (isTransfer legs)
  const detailRes = await page.request.get(`${BASE}/api/v1/accounts/${id}`);
  const detail = (await detailRes.json()).data;
  if (detail?.recentTransactions) {
    for (const tx of detail.recentTransactions) {
      await page.request.delete(`${BASE}/api/v1/transactions/${tx.id}`).catch(() => {});
    }
  }
  // Delete transfer records via API (or just delete the account if no more tx)
  await page.request.delete(`${BASE}/api/v1/accounts/${id}`).catch(() => {});
}

await browser.close();

console.log('\n=== RESULTS ===');
results.forEach(r => console.log(r));
const unexpected = errors.filter(e => !e.includes('forgot-password'));
console.log('\n=== ERRORS ===');
unexpected.forEach(e => console.log(e));
const failed = results.filter(r => r.startsWith('FAIL'));
console.log(`\n${failed.length === 0 && unexpected.length === 0 ? '✓ All clear' : `✗ ${failed.length} failures, ${unexpected.length} unexpected errors`}`);
process.exit(failed.length > 0 || unexpected.length > 0 ? 1 : 0);
```

- [ ] **Step 3: Run from project directory**

```bash
cd "/Users/kwxnxxmbair/K Storage/Claude Workspace/finance-tracker"
cp /tmp/wallet-e2e.mjs wallet-e2e.mjs
node wallet-e2e.mjs 2>&1
rm wallet-e2e.mjs
```

Expected: all PASS, exit 0. If any FAIL — investigate and fix before proceeding.

- [ ] **Step 4: Final commit and push**

```bash
git add -A  # only if any loose files remain
git push origin main
```

- [ ] **Step 5: Rebuild production Docker image**

```bash
docker compose up -d --build
```

Wait for healthy: `until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done && echo "production ready"`

- [ ] **Step 6: Smoke test production**

```bash
curl -s http://localhost:3000/api/v1/accounts -H "Cookie: SESSION_COOKIE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('accounts:', len(d.get('data',[])), 'success:', d['success'])"
```

Confirm `success: true` (session cookie can be grabbed from browser DevTools after logging in).

# Wallet/CC Phase 2C-3 (Plan 1/2 — Core): Convert to Installment + Tier Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users convert raw CREDIT_CARD-account expense transactions into a tracked installment `Debt`, gated by a new `User.tier` (FREE/PRO), with converted transactions excluded from P&L sums and flagged "ผ่อนแล้ว" on `/transactions`.

**Architecture:** New `convertedToDebtId` FK column on `Transaction` + new `tier` enum column on `User`. One new endpoint `POST /api/v1/debts/convert` (shares payment/budget-item generation with the existing `POST /api/v1/debts` via an extracted helper `src/lib/debt-helpers.ts`) plus `GET /api/v1/debts/convertible-transactions`. New `ConvertToInstallmentDialog` wired into `TransactionForm`'s edit sheet. 9 existing P&L aggregate queries gain a `convertedToDebtId: null` filter.

**Tech Stack:** Next.js App Router API routes, Prisma/Postgres, Zod validation, React Hook Form, Tailwind, Playwright e2e.

---

## Part 1 — What's being built and why

### The real-world scenario

A Thai cardholder swipes their credit card a few times during a billing cycle. Before the statement cuts, they call the bank (or use this app) to convert some of those swipes into an installment plan ("ผ่อนชำระ"). The converted amount stops counting as "this cycle's spend" and instead becomes N monthly installments starting *next* cycle. This plan implements that flow end-to-end: a button in the transaction edit sheet, a dialog to configure months (and, for PRO users, interest rate + bundling multiple swipes), a new API endpoint that creates the `Debt` + `DebtPayment`s + LIABILITY `BudgetItem`s, and the ripple of excluding the now-converted transaction from every P&L sum in the app (dashboard, budgets, family summary, etc.) while still showing it in the `/transactions` list with a "ผ่อนแล้ว" badge.

This is C-3, building on top of already-shipped C-1 (label rename + `Debt.accountId` link) and C-2 (linked-debt remaining balance subtracted from CC balance, commit `a28f78b`, live on prod). **C-3 supersedes the C-2 spec's "Future Work" note** that assumed the original transaction would be *deleted* on conversion — that would have rewritten history. Instead we **keep** the original transaction, tag it via `convertedToDebtId`, and exclude it from sums. The converted amount simply disappears from *this* cycle's totals (correct — it's deferred to next cycle) without altering *past* months' numbers.

C-3 is also the **first concrete use of `User.tier`** (FREE/PRO). There is no billing/subscription integration in this plan — `tier` is set directly in the database for testing. That's a separate future project (see the `public-launch-prep` memory).

### Key design decisions

**Interest formula is a flat monthly rate applied to the whole term.** `Debt.interestRate` already exists in the schema (`Decimal(5,2)`, unused) and gets a concrete meaning here: a percentage representing the *monthly* rate (e.g. `1.50` = 1.5%/month). Conversion math: `monthlyRate = (interestRate ?? 0) / 100`, `totalAmount = principal * (1 + monthlyRate * totalMonths)`, `monthlyAmount = totalAmount / totalMonths`. Verified against the spec's worked example: `principal=3000, months=3, rate=1.5` → `totalAmount = 3000 * (1 + 0.015*3) = 3135`. This is the **only** place `interestRate` drives a calculation in this plan — the manual `DebtForm`'s informational-only `interestRate` field (spec Section B) is deferred to Plan 2.

**Tier is exposed via the existing `GET /api/v1/auth/me`.** No new endpoint needed — just add `tier: true` to its `select`. `TransactionForm` fetches this alongside its existing 4-way `Promise.all` in `loadData` and passes `tier` down to `ConvertToInstallmentDialog`, which uses it to show/hide the PRO-only multi-select and interest-rate controls. The actual *enforcement* (403s) happens server-side in `POST /api/v1/debts/convert` regardless of what the client sends — the UI gating is just to avoid showing controls a FREE user can't use.

**Payment/budget-item generation is extracted into a shared helper.** `POST /api/v1/debts` (existing) and the new `POST /api/v1/debts/convert` both need to create N `DebtPayment` rows (all `PENDING`) and N LIABILITY `BudgetItem`s (one per due-date month, upserting the month's `Budget`). This logic (currently inline in `debts/route.ts:133-173`) moves to `src/lib/debt-helpers.ts` as `createDebtPaymentsAndBudgetItems(tx, params)`, taking a `Prisma.TransactionClient` plus `{ debtId, debtName, totalMonths, monthlyAmount, startDate, userId }`. Both routes call it identically — this is a straight extraction, not a behavior change, so Task 2 includes a manual smoke-check that existing debt creation still works.

**The interest-rate + ต่อเดือน/ต่อปี toggle is built inline in `ConvertToInstallmentDialog`, not as a shared extracted component.** The spec (Section C.3) says this should be "the same component as Section B" (the manual `DebtForm`'s optional interest field), but Section B itself is out of scope for this plan (deferred to Plan 2 / "C-3b"). Building a shared component now for a single call site would be premature — when Plan 2 implements Section B, it can either reuse this dialog's inline pattern or extract a shared component at that point, when there are actually two call sites to share between.

**FREE vs PRO gating, enforced server-side in `POST /api/v1/debts/convert`:**
- `transactionIds.length > 1` requires `user.tier === "PRO"` (bundling multiple swipes into one debt).
- `interestRate` truthy (> 0) requires `user.tier === "PRO"`.
- Both violations return `403 { code: "TIER_RESTRICTED", message: "ฟีเจอร์นี้สำหรับ Pro" }`.
- A FREE user can still convert a *single* transaction with *no* interest — the baseline "ผ่อน 0%" flow stays free.

**Exclude-from-sums via `convertedToDebtId: null` filter, mirroring the existing `isTransfer: false` filter.** Section D's principle: any query that *sums* `Transaction.amount` for P&L (income/expense totals, by-category, trends, budget comparisons, family summary, account balances) must filter both `isTransfer: false` AND `convertedToDebtId: null`. Plain list/detail views (the `/transactions` list itself, `recentTransactions` on `/accounts/[id]`) are **unaffected** — a converted transaction still appears there, just with a badge, and is excluded only from the *totals*. Task 6 audits and patches all 9 such call sites found across `src/lib/account-balance.ts` and 8 API routes. Two other files from the spec's audit list need **no change**: `src/app/api/v1/transactions/route.ts` only builds a `findMany` `where` for the list view (no embedded sum/aggregate — confirmed by reading the file), and there are no PDF/CSV export endpoints in this codebase.

### Constraints and trade-offs

- **No retroactive history changes.** Converting a transaction never deletes or backdates anything — it just stops counting toward *current*-period sums going forward, and the new `Debt`'s payments start *next* month (`addMonths(today, 1)`).
- **Atomic, all-or-nothing conversion.** If any selected transaction id is invalid, not owned by the user, already converted, wrong type, or on a different account, the *whole* request is rejected with 400 — no partial conversions.
- **Floating-point rounding on `totalAmount`/`monthlyAmount`** follows the exact same pattern as the existing manual `POST /api/v1/debts` (`effectiveMonthly = totalAmount / totalMonths`, stored into `Decimal(12,2)` columns which Postgres rounds to 2dp on write). This is pre-existing behavior, not a new edge case — no special rounding logic added.
- **`accounts/summary` and `accounts/[id]` routes**: `accounts/[id]` and the `creditOutstanding` part of `accounts/summary` call `computeAccountBalance()` (patched in Task 6, file 1) so they're covered transitively. `accounts/summary`'s `liquidAccounts` aggregate (non-CREDIT_CARD accounts) is still patched directly in Task 6 per the spec's explicit file list and Section D's general principle, even though in practice a converted transaction can only exist on a CREDIT_CARD account — keeping it consistent with `account-balance.ts`'s pattern.

### Out of scope (deferred to Plan 2 / "C-3b")

- **Section B** — optional `interestRate` field + ต่อเดือน/ต่อปี toggle on the manual `DebtForm` (informational only, doesn't recompute totals).
- **Section E** — `/debts/[id]` "แปลงมาจากรายการ" traceability section showing the original converted transactions.
- **Section F** — `POST /api/v1/debts/[id]/unconvert` + "ยกเลิกการแปลง" UI to undo a conversion before any payment is made.

---

## Part 2 — Implementation Tasks

### Task 1: Schema — `User.tier` + `Transaction.convertedToDebtId`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `UserTier` enum and `tier` field to `User`**

In `prisma/schema.prisma`, insert a new enum immediately before `model User {` (currently line 61):

```prisma
enum UserTier {
  FREE
  PRO
}

model User {
```

Then add `tier` as the last scalar field of `User`, right after `updatedAt`:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  name         String
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  tier         UserTier @default(FREE)

  familyGroups UserFamilyGroup[]
```

- [ ] **Step 2: Add `convertedToDebtId`/`convertedToDebt` to `Transaction`**

In `model Transaction`, after the `recurringTxn` relation and before `createdAt`:

```prisma
  recurringTxnId String?               @map("recurring_txn_id")
  recurringTxn   RecurringTransaction? @relation(fields: [recurringTxnId], references: [id])

  convertedToDebtId String? @map("converted_to_debt_id")
  convertedToDebt   Debt?   @relation("DebtConvertedTransactions", fields: [convertedToDebtId], references: [id])

  createdAt DateTime @default(now()) @map("created_at")
```

Add a new index alongside the existing ones at the bottom of `model Transaction`:

```prisma
  @@index([userId, date])
  @@index([userId, type, date])
  @@index([categoryId])
  @@index([familyGroupId])
  @@index([accountId])
  @@index([convertedToDebtId])
  @@map("transactions")
```

- [ ] **Step 3: Add `convertedTransactions` back-relation to `Debt`**

In `model Debt`, alongside `payments`/`budgetItems`:

```prisma
  payments    DebtPayment[]
  budgetItems BudgetItem[]
  convertedTransactions Transaction[] @relation("DebtConvertedTransactions")
```

- [ ] **Step 4: Run the migration**

```bash
npx prisma migrate dev --name add_user_tier_and_transaction_conversion
```

Expected: migration applies cleanly, Prisma client regenerates. Existing users get `tier = FREE` (the `@default(FREE)`), existing transactions get `convertedToDebtId = NULL`.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors (the new fields are additive/optional, existing code is unaffected).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add User.tier and Transaction.convertedToDebtId for C-3 conversion"
```

---

### Task 2: Extract `createDebtPaymentsAndBudgetItems` helper

**Files:**
- Create: `src/lib/debt-helpers.ts`
- Modify: `src/app/api/v1/debts/route.ts`

- [ ] **Step 1: Create `src/lib/debt-helpers.ts`**

```typescript
import { Prisma } from "@/generated/prisma/client";
import { addMonths } from "@/lib/utils";

export async function createDebtPaymentsAndBudgetItems(
  tx: Prisma.TransactionClient,
  params: {
    debtId: string;
    debtName: string;
    totalMonths: number;
    monthlyAmount: number;
    startDate: Date;
    userId: string;
  }
) {
  const { debtId, debtName, totalMonths, monthlyAmount, startDate, userId } = params;

  const payments = Array.from({ length: totalMonths }, (_, i) => ({
    debtId,
    installmentNo: i + 1,
    dueDate: addMonths(startDate, i),
    amount: new Prisma.Decimal(monthlyAmount),
    status: "PENDING" as const,
  }));

  await tx.debtPayment.createMany({ data: payments });

  for (let i = 0; i < totalMonths; i++) {
    const dueDate = addMonths(startDate, i);
    const payYear = dueDate.getFullYear();
    const payMonth = dueDate.getMonth() + 1;

    const budget = await tx.budget.upsert({
      where: { userId_year_month: { userId, year: payYear, month: payMonth } },
      create: { userId, year: payYear, month: payMonth },
      update: {},
    });

    const maxOrder = await tx.budgetItem.aggregate({
      where: { budgetId: budget.id },
      _max: { sortOrder: true },
    });

    await tx.budgetItem.create({
      data: {
        budgetId: budget.id,
        debtId,
        name: debtName,
        type: "LIABILITY",
        amount: new Prisma.Decimal(monthlyAmount),
        notes: `งวดที่ ${i + 1}/${totalMonths}`,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });
  }
}
```

- [ ] **Step 2: Refactor `src/app/api/v1/debts/route.ts` POST to use the helper**

Add the import at the top (after the existing `addMonths` import on line 6):

```typescript
import { addMonths } from "@/lib/utils";
import { createDebtPaymentsAndBudgetItems } from "@/lib/debt-helpers";
```

Replace lines 133-173 (the inline payment-generation `Array.from` block through the closing `}` of the budget-item `for` loop) with a single call:

```typescript
      await createDebtPaymentsAndBudgetItems(tx, {
        debtId: created.id,
        debtName: created.name,
        totalMonths,
        monthlyAmount: effectiveMonthly,
        startDate: start,
        userId: session.user.id,
      });
```

The surrounding `prisma.$transaction(async (tx) => { ... })` block (lines 115-182) keeps its `tx.debt.create(...)` call before this and its `return tx.debt.findUnique(...)` after it, unchanged. `Prisma` (line 5 import) stays — still used for `Prisma.DebtWhereInput` on line 21. `addMonths` (line 6) stays — still used for `end = addMonths(start, totalMonths - 1)` on line 113.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual smoke check — existing debt creation still works**

Start the dev server (`npm run dev`), log in, go to `/debts`, create a new debt manually via the existing "+" form (e.g. name "Smoke test", totalAmount 1000, totalMonths 2, startDate today). Confirm:
- Debt appears in the list with `paymentCount` / progress showing 2 installments, both PENDING.
- `/budgets` for the current and next month shows a new LIABILITY item for this debt.

Then delete this test debt (existing "ยกเลิกหนี้" / delete flow) to clean up.

- [ ] **Step 5: Commit**

```bash
git add src/lib/debt-helpers.ts src/app/api/v1/debts/route.ts
git commit -m "refactor(debts): extract payment/budget-item generation into shared helper"
```

### Task 3: `convertToDebtSchema` validation

**Files:**
- Modify: `src/lib/validations/debt.ts`

- [ ] **Step 1: Append the new schema and type**

At the end of `src/lib/validations/debt.ts` (after `UpdateDebtInput`):

```typescript
export const convertToDebtSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1, "กรุณาเลือกรายการ"),
  totalMonths: z
    .number()
    .int("จำนวนงวดต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวนงวดต้องมากกว่า 0")
    .max(360, "จำนวนงวดเกินขีดจำกัด"),
  interestRate: z.number().min(0).max(99.99).nullable().optional(),
  name: z.string().min(1, "กรุณาใส่ชื่อรายการ").max(100, "ชื่อยาวเกินไป"),
});

export type ConvertToDebtInput = z.infer<typeof convertToDebtSchema>;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validations/debt.ts
git commit -m "feat(debts): add convertToDebtSchema validation"
```

---

### Task 4: `POST /api/v1/debts/convert`

**Files:**
- Create: `src/app/api/v1/debts/convert/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { convertToDebtSchema } from "@/lib/validations/debt";
import { addMonths } from "@/lib/utils";
import { createDebtPaymentsAndBudgetItems } from "@/lib/debt-helpers";

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
    const parsed = convertToDebtSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { transactionIds, totalMonths, interestRate, name } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { tier: true },
    });
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: transactionIds },
        userId: session.user.id,
        type: "EXPENSE",
        isTransfer: false,
        convertedToDebtId: null,
      },
      include: { account: { select: { id: true, type: true } } },
    });

    if (transactions.length !== transactionIds.length) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_TRANSACTIONS", message: "รายการที่เลือกไม่ถูกต้องหรือถูกแปลงไปแล้ว" },
        },
        { status: 400 }
      );
    }

    const accountId = transactions[0].accountId;
    const sameAccount = transactions.every((t) => t.accountId === accountId);
    if (!accountId || !sameAccount || transactions[0].account?.type !== "CREDIT_CARD") {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_ACCOUNT", message: "ต้องเป็นรายการจากบัญชีบัตรเครดิต/สินเชื่อใบเดียวกัน" },
        },
        { status: 400 }
      );
    }

    if (transactionIds.length > 1 && user.tier !== "PRO") {
      return NextResponse.json(
        { success: false, error: { code: "TIER_RESTRICTED", message: "ฟีเจอร์นี้สำหรับ Pro" } },
        { status: 403 }
      );
    }
    if ((interestRate ?? 0) > 0 && user.tier !== "PRO") {
      return NextResponse.json(
        { success: false, error: { code: "TIER_RESTRICTED", message: "ฟีเจอร์นี้สำหรับ Pro" } },
        { status: 403 }
      );
    }

    const principal = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const monthlyRate = (interestRate ?? 0) / 100;
    const totalAmount = principal * (1 + monthlyRate * totalMonths);
    const monthlyAmount = totalAmount / totalMonths;

    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const startDate = addMonths(today, 1);
    const endDate = addMonths(startDate, totalMonths - 1);

    const debt = await prisma.$transaction(async (tx) => {
      const created = await tx.debt.create({
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount,
          interestRate: interestRate ?? null,
          startDate,
          endDate,
          accountId,
          userId: session.user.id,
          status: "ACTIVE",
        },
      });

      await createDebtPaymentsAndBudgetItems(tx, {
        debtId: created.id,
        debtName: created.name,
        totalMonths,
        monthlyAmount,
        startDate,
        userId: session.user.id,
      });

      await tx.transaction.updateMany({
        where: { id: { in: transactionIds } },
        data: { convertedToDebtId: created.id },
      });

      return tx.debt.findUnique({
        where: { id: created.id },
        include: {
          account: { select: { id: true, name: true } },
          payments: { orderBy: { installmentNo: "asc" } },
        },
      });
    });

    return NextResponse.json(
      { success: true, data: { debt, convertedTransactionIds: transactionIds } },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (If `Prisma.TransactionClient` is not found via `@/generated/prisma/client`, check `src/app/api/v1/debts/route.ts`'s existing `Prisma` import — it uses the same path and already works for `Prisma.Decimal`/`Prisma.DebtWhereInput`, so `Prisma.TransactionClient` resolves from the same namespace.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/debts/convert/route.ts
git commit -m "feat(api): add POST /api/v1/debts/convert endpoint"
```

---

### Task 5: `GET /api/v1/debts/convertible-transactions`

**Files:**
- Create: `src/app/api/v1/debts/convertible-transactions/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { searchParams } = req.nextUrl;
    const accountId = searchParams.get("accountId");
    const excludeId = searchParams.get("excludeId");

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "ต้องระบุ accountId" } },
        { status: 400 }
      );
    }

    const account = await prisma.account.findFirst({
      where: { id: accountId, userId: session.user.id, type: "CREDIT_CARD" },
    });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ" } },
        { status: 404 }
      );
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: session.user.id,
        accountId,
        type: "EXPENSE",
        isTransfer: false,
        convertedToDebtId: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 50,
    });

    return NextResponse.json({ success: true, data: transactions });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/debts/convertible-transactions/route.ts
git commit -m "feat(api): add GET /api/v1/debts/convertible-transactions endpoint"
```

### Task 6: Exclude converted transactions from P&L sums (9 files)

Every aggregate/sum query below currently filters `isTransfer: false`. Each gets `convertedToDebtId: null` added alongside it. This is a single mechanical pattern repeated across 9 files — one commit covers all.

**Files:**
- Modify: `src/lib/account-balance.ts:9-16`
- Modify: `src/app/api/v1/dashboard/summary/route.ts:35,45,47,52,65`
- Modify: `src/app/api/v1/dashboard/by-category/route.ts:26`
- Modify: `src/app/api/v1/dashboard/category-trend/route.ts:31-37,57-63`
- Modify: `src/app/api/v1/transactions/summary/route.ts:22-26`
- Modify: `src/app/api/v1/budgets/comparison/route.ts:23-26`
- Modify: `src/app/api/v1/budgets/yearly-comparison/route.ts:29-32`
- Modify: `src/app/api/v1/family/summary/route.ts:41-45`
- Modify: `src/app/api/v1/accounts/summary/route.ts:25,29`

- [ ] **Step 1: `src/lib/account-balance.ts`**

Before (lines 9-16):

```typescript
    prisma.transaction.aggregate({
      where: { accountId, type: "INCOME", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId, type: "EXPENSE", isTransfer: false },
      _sum: { amount: true },
    }),
```

After:

```typescript
    prisma.transaction.aggregate({
      where: { accountId, type: "INCOME", isTransfer: false, convertedToDebtId: null },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId, type: "EXPENSE", isTransfer: false, convertedToDebtId: null },
      _sum: { amount: true },
    }),
```

- [ ] **Step 2: `src/app/api/v1/dashboard/summary/route.ts`**

Line 35 — the `baseWhere` type declaration. Before:

```typescript
let baseWhere: { userId?: string | { in: string[] }; isFamily?: boolean; familyGroupId?: string; date: { gte: Date; lt: Date }; isTransfer: boolean };
```

After:

```typescript
let baseWhere: { userId?: string | { in: string[] }; isFamily?: boolean; familyGroupId?: string; date: { gte: Date; lt: Date }; isTransfer: boolean; convertedToDebtId: null };
```

Line 45. Before:

```typescript
    baseWhere = { familyGroupId: familyGroupIdParam, date: { gte: startDate, lt: endDate }, isTransfer: false };
```

After:

```typescript
    baseWhere = { familyGroupId: familyGroupIdParam, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null };
```

Line 47. Before:

```typescript
    baseWhere = { userId: session.user.id, isFamily: true, date: { gte: startDate, lt: endDate }, isTransfer: false };
```

After:

```typescript
    baseWhere = { userId: session.user.id, isFamily: true, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null };
```

Line 52. Before:

```typescript
    baseWhere = { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false };
```

After:

```typescript
    baseWhere = { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null };
```

Line 65 — the `splitGroups` groupBy `where`. Before:

```typescript
      where: { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false },
```

After:

```typescript
      where: { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null },
```

- [ ] **Step 3: `src/app/api/v1/dashboard/by-category/route.ts`**

Line 26, inside `aggregateByCategory`. Before:

```typescript
        where: { ...where, categoryId: { not: null } },
```

After:

```typescript
        where: { ...where, categoryId: { not: null }, convertedToDebtId: null },
```

This single change covers all 5 call sites that funnel through `aggregateByCategory`.

- [ ] **Step 4: `src/app/api/v1/dashboard/category-trend/route.ts`**

Two spots, both end with `isTransfer: false,` — append `convertedToDebtId: null,` after it in each.

Lines 31-37 (`topCategories` groupBy `where`):

```typescript
      where: {
        userId: session.user.id,
        date: { gte: startDate, lt: endDate },
        isTransfer: false,
        convertedToDebtId: null,
        categoryId: { not: null },
      },
```

(Keep whatever other fields already exist in this `where` — only add the `convertedToDebtId: null,` line.)

Lines 57-63 (`transactions` findMany `where`): same — add `convertedToDebtId: null,` immediately after the existing `isTransfer: false,` line.

- [ ] **Step 5: `src/app/api/v1/transactions/summary/route.ts`**

Lines 22-26. Before:

```typescript
const baseWhere = {
  userId: session.user.id,
  date: { gte: startDate, lt: endDate },
  isTransfer: false,
};
```

After:

```typescript
const baseWhere = {
  userId: session.user.id,
  date: { gte: startDate, lt: endDate },
  isTransfer: false,
  convertedToDebtId: null,
};
```

- [ ] **Step 6: `src/app/api/v1/budgets/comparison/route.ts`**

Lines 23-26. Before:

```typescript
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate }, isTransfer: false },
      include: { category: true },
    }),
```

After:

```typescript
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate }, isTransfer: false, convertedToDebtId: null },
      include: { category: true },
    }),
```

- [ ] **Step 7: `src/app/api/v1/budgets/yearly-comparison/route.ts`**

Lines 29-32. Before:

```typescript
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false },
      select: { type: true, amount: true, date: true },
    }),
```

After:

```typescript
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null },
      select: { type: true, amount: true, date: true },
    }),
```

- [ ] **Step 8: `src/app/api/v1/family/summary/route.ts`**

Lines 41-45. Before:

```typescript
    prisma.transaction.groupBy({
      by: ["userId", "type"],
      where: { familyGroupId: groupId, date: { gte: startDate, lt: endDate }, isTransfer: false },
      _sum: { amount: true },
    }),
```

After:

```typescript
    prisma.transaction.groupBy({
      by: ["userId", "type"],
      where: { familyGroupId: groupId, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null },
      _sum: { amount: true },
    }),
```

- [ ] **Step 9: `src/app/api/v1/accounts/summary/route.ts`**

Lines 23-31, inside `liquidAccounts.map`. Before:

```typescript
    const [income, expense, tfOut, tfIn] = await Promise.all([
      prisma.transaction.aggregate({
        where: { accountId: acc.id, type: "INCOME", isTransfer: false },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { accountId: acc.id, type: "EXPENSE", isTransfer: false },
        _sum: { amount: true },
      }),
      prisma.transfer.aggregate({ where: { fromAccountId: acc.id }, _sum: { amount: true } }),
      prisma.transfer.aggregate({ where: { toAccountId: acc.id }, _sum: { amount: true } }),
    ]);
```

After:

```typescript
    const [income, expense, tfOut, tfIn] = await Promise.all([
      prisma.transaction.aggregate({
        where: { accountId: acc.id, type: "INCOME", isTransfer: false, convertedToDebtId: null },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { accountId: acc.id, type: "EXPENSE", isTransfer: false, convertedToDebtId: null },
        _sum: { amount: true },
      }),
      prisma.transfer.aggregate({ where: { fromAccountId: acc.id }, _sum: { amount: true } }),
      prisma.transfer.aggregate({ where: { toAccountId: acc.id }, _sum: { amount: true } }),
    ]);
```

- [ ] **Step 10: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/account-balance.ts src/app/api/v1/dashboard/summary/route.ts src/app/api/v1/dashboard/by-category/route.ts src/app/api/v1/dashboard/category-trend/route.ts src/app/api/v1/transactions/summary/route.ts src/app/api/v1/budgets/comparison/route.ts src/app/api/v1/budgets/yearly-comparison/route.ts src/app/api/v1/family/summary/route.ts src/app/api/v1/accounts/summary/route.ts
git commit -m "fix(reports): exclude converted-to-debt transactions from all P&L sums"
```

### Task 7: `ConvertToInstallmentDialog` + expose `tier` on `auth/me`

**Files:**
- Modify: `src/app/api/v1/auth/me/route.ts:17`
- Create: `src/components/forms/convert-to-installment-dialog.tsx`

- [ ] **Step 1: Expose `tier` on `GET /api/v1/auth/me`**

In `src/app/api/v1/auth/me/route.ts`, line 17. Before:

```typescript
    select: { id: true, email: true, name: true, createdAt: true },
```

After:

```typescript
    select: { id: true, email: true, name: true, createdAt: true, tier: true },
```

The `GET` handler returns `data: user` directly (line 27: `NextResponse.json({ success: true, data: user })`), so `tier: "FREE" | "PRO"` is now part of the response with no further changes.

- [ ] **Step 2: Create `src/components/forms/convert-to-installment-dialog.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check } from "lucide-react";
import { cn, formatCurrency, formatShortDate } from "@/lib/utils";

interface ConvertibleTransaction {
  id: string;
  date: string;
  description: string | null;
  amount: string;
  category: { id: string; name: string } | null;
}

interface ConvertToInstallmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    date: string;
    description: string | null;
    amount: number;
    accountId: string;
    categoryName: string;
  };
  tier: "FREE" | "PRO";
  onConverted: () => void;
}

export function ConvertToInstallmentDialog({
  open,
  onOpenChange,
  transaction,
  tier,
  onConverted,
}: ConvertToInstallmentDialogProps) {
  const [totalMonths, setTotalMonths] = useState("3");
  const [name, setName] = useState("");
  const [rateValue, setRateValue] = useState("0");
  const [rateUnit, setRateUnit] = useState<"month" | "year">("month");
  const [showMore, setShowMore] = useState(false);
  const [convertible, setConvertible] = useState<ConvertibleTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTotalMonths("3");
      setRateValue("0");
      setRateUnit("month");
      setShowMore(false);
      setSelectedIds([]);
      setError("");
      setName(`ผ่อน: ${transaction.description || transaction.categoryName}`);
    }
  }, [open, transaction]);

  async function loadConvertible() {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/debts/convertible-transactions?accountId=${transaction.accountId}&excludeId=${transaction.id}`
      );
      const json = await res.json();
      if (json.success) setConvertible(json.data);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleShowMore() {
    const next = !showMore;
    setShowMore(next);
    if (next && convertible.length === 0) loadConvertible();
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const totalMonthsNum = parseInt(totalMonths, 10) || 0;
  const rateValueNum = parseFloat(rateValue) || 0;
  const monthlyRatePercent = tier === "PRO" ? (rateUnit === "year" ? rateValueNum / 12 : rateValueNum) : 0;

  const principal =
    transaction.amount +
    convertible
      .filter((t) => selectedIds.includes(t.id))
      .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalAmount = totalMonthsNum > 0 ? principal * (1 + (monthlyRatePercent / 100) * totalMonthsNum) : 0;
  const monthlyAmount = totalMonthsNum > 0 ? totalAmount / totalMonthsNum : 0;

  async function handleSubmit() {
    setError("");
    if (totalMonthsNum < 1 || totalMonthsNum > 360) {
      setError("จำนวนเดือนต้องอยู่ระหว่าง 1-360");
      return;
    }
    if (!name.trim()) {
      setError("กรุณาใส่ชื่อรายการ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/debts/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds: [transaction.id, ...selectedIds],
          totalMonths: totalMonthsNum,
          interestRate: monthlyRatePercent > 0 ? monthlyRatePercent : null,
          name: name.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "เกิดข้อผิดพลาด");
        return;
      }
      onConverted();
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แบ่งชำระรายเดือน</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="ios-card px-4 py-3 text-[13px]">
            <div className="flex justify-between text-muted-foreground">
              <span>{formatShortDate(transaction.date)}</span>
              <span>{transaction.categoryName}</span>
            </div>
            <div className="mt-1 text-[16px] font-semibold">{formatCurrency(transaction.amount)}</div>
            {transaction.description && (
              <div className="text-muted-foreground">{transaction.description}</div>
            )}
          </div>

          <div>
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">จำนวนเดือน</label>
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              max="360"
              className="mt-1 bg-input h-11 rounded-xl border-0"
              value={totalMonths}
              onChange={(e) => setTotalMonths(e.target.value)}
            />
          </div>

          {tier === "PRO" ? (
            <div>
              <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">อัตราดอกเบี้ย (ไม่บังคับ)</label>
              <div className="mt-1 flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="bg-input h-11 rounded-xl border-0 flex-1"
                  value={rateValue}
                  onChange={(e) => setRateValue(e.target.value)}
                />
                <div className="ios-card p-1 grid grid-cols-2 gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRateUnit("month")}
                    className={cn("px-3 h-9 rounded-lg text-[13px] font-medium", rateUnit === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    ต่อเดือน
                  </button>
                  <button
                    type="button"
                    onClick={() => setRateUnit("year")}
                    className={cn("px-3 h-9 rounded-lg text-[13px] font-medium", rateUnit === "year" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    ต่อปี
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              ใส่ดอกเบี้ย / รวมหลายรายการ → อัพเกรด Pro
            </p>
          )}

          {tier === "PRO" && (
            <div>
              <button type="button" onClick={toggleShowMore} className="text-[13px] font-medium text-primary">
                {showMore ? "− ซ่อนรายการอื่น" : "+ เลือกรายการอื่นที่จะรวมผ่อนด้วย"}
              </button>

              {showMore && (
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {loadingMore ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : convertible.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground py-2">ไม่มีรายการอื่นในบัญชีนี้</p>
                  ) : (
                    convertible.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleSelected(t.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-input text-left"
                      >
                        <div
                          className={cn(
                            "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0",
                            selectedIds.includes(t.id) ? "bg-primary border-primary" : "border-muted-foreground/40"
                          )}
                        >
                          {selectedIds.includes(t.id) && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{t.description || t.category?.name || "อื่นๆ"}</div>
                          <div className="text-[12px] text-muted-foreground">{formatShortDate(t.date)}</div>
                        </div>
                        <div className="text-[13px] font-semibold">{formatCurrency(Number(t.amount))}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">ชื่อรายการหนี้</label>
            <Input
              className="mt-1 bg-input h-11 rounded-xl border-0"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="ios-card px-4 py-3 space-y-1 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ยอดรวม</span>
              <span className="font-semibold">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ยอดผ่อน/เดือน</span>
              <span className="font-semibold">{formatCurrency(monthlyAmount)}</span>
            </div>
          </div>

          {error && <p className="text-[13px] text-destructive text-center">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button type="button" className="flex-1" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            ยืนยัน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (This component isn't imported anywhere yet — Task 8 wires it in.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/auth/me/route.ts src/components/forms/convert-to-installment-dialog.tsx
git commit -m "feat(debts): add ConvertToInstallmentDialog and expose user tier on auth/me"
```

### Task 8: Wire convert entry point into `TransactionForm`

**Files:**
- Modify: `src/components/forms/transaction-form.tsx`

- [ ] **Step 1: Imports**

Line 11. Before:

```typescript
import { Loader2, Users } from "lucide-react";
```

After, and add two new imports below it:

```typescript
import { Loader2, Users, CreditCard } from "lucide-react";
import Link from "next/link";
import { ConvertToInstallmentDialog } from "@/components/forms/convert-to-installment-dialog";
```

- [ ] **Step 2: Extend `defaultValues` prop type**

In the `TransactionFormProps` interface (lines 52-70), `defaultValues` gains two fields. Before (end of the `defaultValues` object, lines 62-65):

```typescript
    isFamily?: boolean;
    familyMemberId?: string | null;
    familyMember?: { id: string; name: string } | null;
    familyGroupId?: string | null;
  };
```

After:

```typescript
    isFamily?: boolean;
    familyMemberId?: string | null;
    familyMember?: { id: string; name: string } | null;
    familyGroupId?: string | null;
    isTransfer?: boolean;
    convertedToDebtId?: string | null;
  };
```

- [ ] **Step 3: Add `findCategoryName` helper**

After the `FormRow` function (after line 89), add a module-level helper:

```typescript
function findCategoryName(categories: Category[], categoryId: string): string | null {
  for (const cat of categories) {
    if (cat.id === categoryId) return cat.name;
    const child = cat.children.find((c) => c.id === categoryId);
    if (child) return child.name;
  }
  return null;
}
```

- [ ] **Step 4: Add `tier` and `convertOpen` state**

Line 102, after `const [serverError, setServerError] = useState("");`:

```typescript
  const [serverError, setServerError] = useState("");
  const [tier, setTier] = useState<"FREE" | "PRO">("FREE");
  const [convertOpen, setConvertOpen] = useState(false);
```

- [ ] **Step 5: Fetch `tier` in `loadData`**

Lines 122-141. Before:

```typescript
        const [catRes, accRes, fmRes, fgRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/accounts"),
          fetch("/api/v1/family-members"),
          fetch("/api/v1/family"),
        ]);
        const catData = await catRes.json();
        const accData = await accRes.json();
        const fmData = await fmRes.json();
        const fgData = await fgRes.json();
        if (catData.success) setCategories(catData.data);
        if (accData.success) {
          setAccounts(accData.data);
          const defaultAccount = accData.data?.find((a: Account) => a.isDefault) ?? accData.data?.[0];
          if (defaultAccount && !isEdit && !prefill?.accountId) {
            setValue("accountId", defaultAccount.id);
          }
        }
        if (fmData.success) setFamilyMembers(fmData.data);
        if (fgData.success) setFamilyGroups(fgData.data.groups);
```

After:

```typescript
        const [catRes, accRes, fmRes, fgRes, meRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/accounts"),
          fetch("/api/v1/family-members"),
          fetch("/api/v1/family"),
          fetch("/api/v1/auth/me"),
        ]);
        const catData = await catRes.json();
        const accData = await accRes.json();
        const fmData = await fmRes.json();
        const fgData = await fgRes.json();
        const meData = await meRes.json();
        if (catData.success) setCategories(catData.data);
        if (accData.success) {
          setAccounts(accData.data);
          const defaultAccount = accData.data?.find((a: Account) => a.isDefault) ?? accData.data?.[0];
          if (defaultAccount && !isEdit && !prefill?.accountId) {
            setValue("accountId", defaultAccount.id);
          }
        }
        if (fmData.success) setFamilyMembers(fmData.data);
        if (fgData.success) setFamilyGroups(fgData.data.groups);
        if (meData.success) setTier(meData.data.tier);
```

- [ ] **Step 6: Compute `canConvert`**

Line 149, after `const filteredCategories = categories.filter((c) => c.type === txType);`:

```typescript
  const filteredCategories = categories.filter((c) => c.type === txType);

  const editingAccount = accounts.find((a) => a.id === defaultValues?.accountId);
  const canConvert =
    isEdit &&
    defaultValues?.type === "EXPENSE" &&
    defaultValues?.isTransfer === false &&
    !defaultValues?.convertedToDebtId &&
    editingAccount?.type === "CREDIT_CARD";
```

- [ ] **Step 7: Fragment-wrap the return, add entry point + converted-info row + dialog**

The current return starts at line 187 (`return (`) with `<form onSubmit={handleSubmit(onSubmit)} className="space-y-5">` and ends at line 358-360 (`</form>` then `);` then `}`). Wrap in a Fragment:

```typescript
  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
```

...all existing form content unchanged through the "Other fields" card (ends at line 347 with `</div>`)...

Then, between the "Other fields" card's closing `</div>` (line 347) and the `{serverError && ...}` line (line 349), insert:

```typescript
      {canConvert && (
        <button
          type="button"
          onClick={() => setConvertOpen(true)}
          className="ios-card w-full flex items-center justify-center gap-2 px-5 py-3 text-[14px] font-medium text-primary"
        >
          <CreditCard className="h-4 w-4" />
          แบ่งชำระรายเดือน
        </button>
      )}

      {isEdit && defaultValues?.convertedToDebtId && (
        <div className="ios-card px-5 py-4 space-y-1">
          <p className="text-[13px] text-muted-foreground">รายการนี้ถูกแปลงเป็นยอดผ่อนแล้ว</p>
          <Link href={`/debts/${defaultValues.convertedToDebtId}`} className="text-[14px] font-medium text-primary">
            ดูรายการหนี้ →
          </Link>
        </div>
      )}
```

Then, after the closing `</form>` (was line 358), before the final `);`, add the dialog as a sibling and close the Fragment:

```typescript
    </form>

    {canConvert && defaultValues && (
      <ConvertToInstallmentDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        transaction={{
          id: defaultValues.id,
          date: defaultValues.date,
          description: defaultValues.description,
          amount: parseFloat(defaultValues.amount),
          accountId: defaultValues.accountId ?? "",
          categoryName: findCategoryName(categories, defaultValues.categoryId) ?? "อื่นๆ",
        }}
        tier={tier}
        onConverted={() => { setConvertOpen(false); onSuccess(); }}
      />
    )}
    </>
  );
}
```

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. Note: `Transaction` (from `/transactions` page, Task 9) doesn't yet declare `isTransfer`/`convertedToDebtId` until Task 9 runs — but both new `defaultValues` fields are optional (`isTransfer?`, `convertedToDebtId?`), so `editingTx ?? undefined` (currently typed without these fields) remains assignable. `canConvert` will simply evaluate to `false` everywhere until Task 9 adds the real fields — this is expected and resolves once Task 9 lands.

- [ ] **Step 9: Commit**

```bash
git add src/components/forms/transaction-form.tsx
git commit -m "feat(transactions): wire convert-to-installment entry point into edit sheet"
```

### Task 9: `/transactions` — `Transaction` interface + "ผ่อนแล้ว" badge

**Files:**
- Modify: `src/app/(app)/transactions/page.tsx`

- [ ] **Step 1: Extend the `Transaction` interface**

Lines 27-45. Before (end of interface, lines 42-45):

```typescript
  isFamily: boolean;
  familyMember: { id: string; name: string } | null;
  user: { id: string; name: string };
}
```

After:

```typescript
  isFamily: boolean;
  familyMember: { id: string; name: string } | null;
  user: { id: string; name: string };
  isTransfer: boolean;
  convertedToDebtId: string | null;
}
```

`GET /api/v1/transactions` uses `include` (not `select`), so both new scalar columns are returned automatically once Task 1's migration lands — no API change needed for this list endpoint.

No change needed at line 530 (`defaultValues={editingTx ?? undefined}`) — `Transaction` now has these two fields as required, and `TransactionFormProps.defaultValues` declares them as optional (Task 8, Step 2), so `Transaction` remains structurally assignable and `editingTx.isTransfer`/`editingTx.convertedToDebtId` now carry real values through to `canConvert`.

- [ ] **Step 2: Add the "ผ่อนแล้ว" badge to the amount block**

Lines 398-404. Before:

```typescript
                    {/* Amount */}
                    <p className={cn(
                      "text-[15px] font-semibold tabular-nums shrink-0",
                      tx.type === "INCOME" ? "text-[#34C759]" : "text-foreground"
                    )}>
                      {tx.type === "INCOME" ? "+" : "−"}{formatCurrency(parseFloat(tx.amount))}
                    </p>
```

After:

```typescript
                    {/* Amount */}
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <p className={cn(
                        "text-[15px] font-semibold tabular-nums",
                        tx.type === "INCOME" ? "text-[#34C759]" : "text-foreground"
                      )}>
                        {tx.type === "INCOME" ? "+" : "−"}{formatCurrency(parseFloat(tx.amount))}
                      </p>
                      {tx.convertedToDebtId && (
                        <Link
                          href={`/debts/${tx.convertedToDebtId}`}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                        >
                          ผ่อนแล้ว
                        </Link>
                      )}
                    </div>
```

`Link` is already imported (line 13) and `cn`/`formatCurrency` are already used in this file — no new imports needed.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual UI check**

Start dev server, log in, open `/transactions`. Existing transactions (all with `convertedToDebtId: null`) should render exactly as before — amount right-aligned, no badge, no layout shift. This confirms the `flex-col` wrapper is visually equivalent to the old bare `<p>` when no badge is present.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/transactions/page.tsx"
git commit -m "feat(transactions): show ผ่อนแล้ว badge for converted transactions"
```

### Task 10: Playwright e2e — FREE and PRO conversion flows

Two scripts share a fixture user via `/tmp/run-check/c3-fixture.json` and an auth `storageState` file, with a `node -e` tier-flip in between. Run the dev server first: `npm run dev` (assume port 3001; adjust `BASE_URL` if different).

**Files:**
- Create: `/tmp/run-check/c3-verify-free.mjs`
- Create: `/tmp/run-check/c3-verify-pro.mjs`

- [ ] **Step 1: Create `/tmp/run-check/c3-verify-free.mjs`**

```javascript
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE_URL = "http://localhost:3001";
const EMAIL = `c3check${Date.now()}@example.com`;
const PASSWORD = "testpass123";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
  }
  console.log(`OK: ${label} = ${actual}`);
}

function assertStatus(res, expected, label) {
  if (res.status() !== expected) {
    throw new Error(`FAIL: ${label} — expected status ${expected}, got ${res.status()}`);
  }
  console.log(`OK: ${label} -> ${res.status()}`);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();

  // --- Setup: register fixture user (FREE tier) ---
  await page.goto(`${BASE_URL}/register`);
  await page.getByPlaceholder("ชื่อของคุณ").fill("C3 Check");
  await page.getByPlaceholder("email@example.com").fill(EMAIL);
  await page.getByPlaceholder("อย่างน้อย 8 ตัวอักษร").fill(PASSWORD);
  await page.getByPlaceholder("ยืนยันรหัสผ่าน").fill(PASSWORD);
  await page.getByRole("button", { name: "สมัครสมาชิก" }).click();
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
  console.log("OK: registered & logged in as", EMAIL);

  // --- Setup: find seeded CC + CASH accounts, and an EXPENSE category ---
  let res = await page.request.get(`${BASE_URL}/api/v1/accounts`);
  let { data: accounts } = await res.json();
  const cc = accounts.find((a) => a.type === "CREDIT_CARD");
  const cash = accounts.find((a) => a.type === "CASH");
  if (!cc) throw new Error("FAIL: no seeded CREDIT_CARD account found");
  if (!cash) throw new Error("FAIL: no seeded CASH account found");

  res = await page.request.get(`${BASE_URL}/api/v1/categories`);
  let { data: categories } = await res.json();
  const expenseCat = categories.find((c) => c.type === "EXPENSE");
  if (!expenseCat) throw new Error("FAIL: no EXPENSE category found");
  console.log("OK: setup - cc:", cc.id, "cash:", cash.id, "category:", expenseCat.id);

  // --- Setup: create 5 EXPENSE transactions on cc + 1 on cash ---
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  async function createExpense(amount, accountId, description) {
    const r = await page.request.post(`${BASE_URL}/api/v1/transactions`, {
      data: { type: "EXPENSE", amount, categoryId: expenseCat.id, accountId, date: dateStr, description },
    });
    const b = await r.json();
    if (!b.success) throw new Error("FAIL: create transaction: " + JSON.stringify(b));
    return b.data;
  }

  const tx1 = await createExpense(1000, cc.id, "C3 tx1");
  const tx2 = await createExpense(1500, cc.id, "C3 tx2");
  const tx3 = await createExpense(2000, cc.id, "C3 tx3");
  const tx4 = await createExpense(800, cc.id, "C3 tx4");
  const tx5 = await createExpense(1200, cc.id, "C3 PRO single convert");
  const txOther = await createExpense(500, cash.id, "C3 other-account");
  console.log("OK: created 6 transactions (tx1..tx5 on CC, txOther on CASH)");

  // --- Baseline: summary + CC balance before any conversion ---
  res = await page.request.get(`${BASE_URL}/api/v1/transactions/summary?year=${y}&month=${m}`);
  const summaryBefore = (await res.json()).data;

  res = await page.request.get(`${BASE_URL}/api/v1/accounts/${cc.id}`);
  const ccBefore = (await res.json()).data;

  // --- Scenario 1 (spec 3a): FREE, single tx, no interest -> 201 ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [tx1.id], totalMonths: 3, name: "ผ่อน เทส1" },
  });
  assertStatus(res, 201, "Scenario 1: FREE single-tx convert");
  let body = await res.json();
  const debt1 = body.data.debt;
  assertEqual(debt1.totalMonths, 3, "Scenario 1: debt1.totalMonths");
  assertEqual(Number(debt1.totalAmount), 1000, "Scenario 1: debt1.totalAmount (rate=0)");
  assertEqual(Number(debt1.monthlyAmount), round2(1000 / 3), "Scenario 1: debt1.monthlyAmount");
  assertEqual(debt1.payments.length, 3, "Scenario 1: debt1.payments.length");
  assertEqual(debt1.payments.every((p) => p.status === "PENDING"), true, "Scenario 1: all payments PENDING");
  assertEqual(body.data.convertedTransactionIds[0], tx1.id, "Scenario 1: convertedTransactionIds includes tx1");

  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const expectedStart = addMonths(today, 1).toISOString().slice(0, 10);
  assertEqual(debt1.startDate.slice(0, 10), expectedStart, "Scenario 1: debt1.startDate = next month");

  res = await page.request.get(`${BASE_URL}/api/v1/transactions?year=${y}&month=${m}`);
  let transactions = (await res.json()).data;
  let tx1Found = transactions.find((t) => t.id === tx1.id);
  assertEqual(tx1Found.convertedToDebtId, debt1.id, "Scenario 1: tx1.convertedToDebtId set");

  // --- Scenario 2 (spec 3b): FREE, multi-tx -> 403 ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [tx2.id, tx3.id], totalMonths: 2, name: "x" },
  });
  assertStatus(res, 403, "Scenario 2: FREE multi-tx convert -> 403");

  // --- Scenario 3 (spec 3c): FREE, interestRate > 0 -> 403 ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [tx2.id], totalMonths: 2, interestRate: 1.5, name: "x" },
  });
  assertStatus(res, 403, "Scenario 3: FREE interestRate>0 -> 403");

  // --- Scenario 4 (spec 3e): re-convert already-converted tx -> 400 ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [tx1.id], totalMonths: 3, name: "x" },
  });
  assertStatus(res, 400, "Scenario 4: re-convert already-converted tx -> 400");

  // --- Scenario 5: wrong account type (non-CREDIT_CARD) -> 400 ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [txOther.id], totalMonths: 3, name: "x" },
  });
  assertStatus(res, 400, "Scenario 5: non-CREDIT_CARD account -> 400");

  // --- Scenario 6 (spec 5, FREE): CC balance unchanged after no-interest conversion ---
  res = await page.request.get(`${BASE_URL}/api/v1/accounts/${cc.id}`);
  const ccAfter = (await res.json()).data;
  assertEqual(round2(ccAfter.balance), round2(ccBefore.balance), "Scenario 6: CC balance unchanged (FREE, no interest)");

  // --- Scenario 7 (Section D ripple): totalExpense excludes converted tx1 ---
  res = await page.request.get(`${BASE_URL}/api/v1/transactions/summary?year=${y}&month=${m}`);
  const summaryAfter = (await res.json()).data;
  assertEqual(summaryAfter.totalExpense, summaryBefore.totalExpense - 1000, "Scenario 7: totalExpense excludes converted tx1");

  // --- Persist fixture + session for the PRO-tier script ---
  await context.storageState({ path: "/tmp/run-check/c3-auth.json" });
  writeFileSync("/tmp/run-check/c3-fixture.json", JSON.stringify({
    email: EMAIL,
    ccAccountId: cc.id,
    cashAccountId: cash.id,
    categoryId: expenseCat.id,
    tx: { tx1: tx1.id, tx2: tx2.id, tx3: tx3.id, tx4: tx4.id, tx5: tx5.id, txOther: txOther.id },
    debt1Id: debt1.id,
  }, null, 2));

  console.log("\nALL FREE-TIER SCENARIOS PASSED");
  console.log("Fixture email (for cleanup):", EMAIL);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

```bash
mkdir -p /tmp/run-check
node /tmp/run-check/c3-verify-free.mjs
```

Expected: all 7 scenarios print `OK: ...`, ends with `ALL FREE-TIER SCENARIOS PASSED`, and `/tmp/run-check/c3-fixture.json` + `/tmp/run-check/c3-auth.json` exist.

- [ ] **Step 3: Flip the fixture user to PRO**

```bash
node -e "
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const fixture = JSON.parse(fs.readFileSync('/tmp/run-check/c3-fixture.json', 'utf-8'));
const prisma = new PrismaClient();
prisma.user.update({ where: { email: fixture.email }, data: { tier: 'PRO' } })
  .then(() => console.log('User upgraded to PRO'))
  .finally(() => prisma.\$disconnect());
"
```

Expected: `User upgraded to PRO`.

- [ ] **Step 4: Create `/tmp/run-check/c3-verify-pro.mjs`**

```javascript
import { chromium } from "playwright";
import { readFileSync } from "fs";

const BASE_URL = "http://localhost:3001";

const fixture = JSON.parse(readFileSync("/tmp/run-check/c3-fixture.json", "utf-8"));

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
  }
  console.log(`OK: ${label} = ${actual}`);
}

function assertStatus(res, expected, label) {
  if (res.status() !== expected) {
    throw new Error(`FAIL: ${label} — expected status ${expected}, got ${res.status()}`);
  }
  console.log(`OK: ${label} -> ${res.status()}`);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    storageState: "/tmp/run-check/c3-auth.json",
  });
  const page = await context.newPage();

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  // --- Scenario 7 (spec 3d): PRO, multi-tx + interest -> 201 ---
  let res = await page.request.get(`${BASE_URL}/api/v1/accounts/${fixture.ccAccountId}`);
  const ccBeforePro = (await res.json()).data;

  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: {
      transactionIds: [fixture.tx.tx2, fixture.tx.tx3],
      totalMonths: 4,
      interestRate: 1.5,
      name: "ผ่อน เทส2",
    },
  });
  assertStatus(res, 201, "Scenario 7: PRO multi-tx + interest convert");
  let body = await res.json();
  const debt2 = body.data.debt;
  const principal2 = 1500 + 2000;
  const expectedTotal2 = principal2 * (1 + 0.015 * 4);
  assertEqual(Number(debt2.totalAmount), round2(expectedTotal2), "Scenario 7: debt2.totalAmount");
  assertEqual(Number(debt2.monthlyAmount), round2(expectedTotal2 / 4), "Scenario 7: debt2.monthlyAmount");
  assertEqual(debt2.payments.length, 4, "Scenario 7: debt2.payments.length");
  assertEqual(debt2.payments.every((p) => p.status === "PENDING"), true, "Scenario 7: all payments PENDING");

  // --- convertible-transactions (spec C.5): only tx5 remains, excluding tx4 ---
  res = await page.request.get(
    `${BASE_URL}/api/v1/debts/convertible-transactions?accountId=${fixture.ccAccountId}&excludeId=${fixture.tx.tx4}`
  );
  assertStatus(res, 200, "convertible-transactions: 200");
  const convertible = (await res.json()).data;
  assertEqual(convertible.length, 1, "convertible-transactions: length");
  assertEqual(convertible[0].id, fixture.tx.tx5, "convertible-transactions: returns tx5");

  // --- Cross-account 400 (PRO) ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [fixture.tx.tx4, fixture.tx.txOther], totalMonths: 2, name: "x" },
  });
  assertStatus(res, 400, "Cross-account selection -> 400");

  // --- Balance ripple with interest (spec 5, PRO): balance decreases by interest amount ---
  res = await page.request.get(`${BASE_URL}/api/v1/accounts/${fixture.ccAccountId}`);
  const ccAfterPro = (await res.json()).data;
  const expectedDelta = -(expectedTotal2 - principal2);
  assertEqual(round2(ccAfterPro.balance - ccBeforePro.balance), round2(expectedDelta), "PRO balance ripple: decreases by interest amount");

  // --- Dashboard / transactions summary ripple: only tx4, tx5, txOther remain un-converted ---
  const expectedExpense = 800 + 1200 + 500;
  res = await page.request.get(`${BASE_URL}/api/v1/dashboard/summary?year=${y}&month=${m}`);
  const dashSummary = (await res.json()).data;
  assertEqual(dashSummary.totalExpense, expectedExpense, "dashboard/summary totalExpense excludes converted tx");

  res = await page.request.get(`${BASE_URL}/api/v1/transactions/summary?year=${y}&month=${m}`);
  const txSummary = (await res.json()).data;
  assertEqual(txSummary.totalExpense, expectedExpense, "transactions/summary totalExpense excludes converted tx");

  // --- Convert tx5 (single-tx, PRO user) via API, then verify UI ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts/convert`, {
    data: { transactionIds: [fixture.tx.tx5], totalMonths: 2, name: "ผ่อน เทส3" },
  });
  assertStatus(res, 201, "tx5 single-tx convert (PRO)");
  const debt3 = (await res.json()).data.debt;

  await page.goto(`${BASE_URL}/transactions`);
  await page.waitForLoadState("networkidle");

  const tx5Row = page.locator("div.flex.items-center.gap-3.px-4.py-3").filter({ hasText: "C3 PRO single convert" });
  await tx5Row.getByText("ผ่อนแล้ว").waitFor();
  await page.screenshot({ path: "/tmp/run-check/c3-badge.png" });
  console.log("OK: UI - tx5 row shows ผ่อนแล้ว badge");

  await tx5Row.getByText("ผ่อนแล้ว").click();
  await page.waitForURL(`${BASE_URL}/debts/${debt3.id}`);
  console.log("OK: UI - badge links to /debts/" + debt3.id);

  await page.goBack();
  await page.waitForLoadState("networkidle");

  // tx5 (converted): edit sheet shows read-only info, no convert button
  await tx5Row.getByRole("button").first().click();
  await page.getByText("รายการนี้ถูกแปลงเป็นยอดผ่อนแล้ว").waitFor();
  assertEqual(await page.getByRole("button", { name: "แบ่งชำระรายเดือน" }).count(), 0, "Converted tx: convert button removed");
  await page.getByRole("link", { name: "ดูรายการหนี้ →" }).waitFor();
  await page.screenshot({ path: "/tmp/run-check/c3-converted-sheet.png" });
  await page.getByRole("button", { name: "ยกเลิก" }).click();
  await page.waitForTimeout(300);

  // tx4 (unconverted CC expense, PRO): convert button visible
  const tx4Row = page.locator("div.flex.items-center.gap-3.px-4.py-3").filter({ hasText: "C3 tx4" });
  await tx4Row.getByRole("button").first().click();
  await page.getByRole("button", { name: "แบ่งชำระรายเดือน" }).waitFor();
  await page.screenshot({ path: "/tmp/run-check/c3-convert-entry.png" });
  console.log("OK: UI - unconverted CC expense shows แบ่งชำระรายเดือน button");
  await page.getByRole("button", { name: "ยกเลิก" }).click();

  console.log("\nALL PRO-TIER SCENARIOS PASSED");
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run it**

```bash
node /tmp/run-check/c3-verify-pro.mjs
```

Expected: all assertions print `OK: ...`, ends with `ALL PRO-TIER SCENARIOS PASSED`, and three screenshots exist in `/tmp/run-check/`.

- [ ] **Step 6: Clean up fixture data**

```bash
node -e "
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const fixture = JSON.parse(fs.readFileSync('/tmp/run-check/c3-fixture.json', 'utf-8'));
const prisma = new PrismaClient();
prisma.user.delete({ where: { email: fixture.email } })
  .then(() => console.log('Fixture user deleted'))
  .finally(() => prisma.\$disconnect());
"
rm -f /tmp/run-check/c3-fixture.json /tmp/run-check/c3-auth.json /tmp/run-check/c3-verify-free.mjs /tmp/run-check/c3-verify-pro.mjs /tmp/run-check/c3-badge.png /tmp/run-check/c3-converted-sheet.png /tmp/run-check/c3-convert-entry.png
```

Expected: `Fixture user deleted` (cascades remove the user's transactions, accounts, debts, payments, budgets, budget items via existing `onDelete: Cascade` relations).

- [ ] **Step 7: Commit**

Nothing under `src/` changes in this task (scripts live in `/tmp/run-check/`, not committed). No commit needed — this task only validates Tasks 1-9.




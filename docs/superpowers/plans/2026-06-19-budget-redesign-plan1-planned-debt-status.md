# Budget Redesign Plan 1 — PLANNED Debt Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PLANNED` status to `Debt` so a LIABILITY budget-page item can represent a financial *forecast* ("might buy an iPad next year") without committing to a real installment schedule, plus a "ยืนยันเป็นหนี้จริง" (confirm-as-real) action that locks in (possibly edited) totals and generates the real schedule.

**Architecture:** Extend the `DebtStatus` enum with `PLANNED`. Split the existing `createDebtPaymentsAndBudgetItems` helper (in `src/lib/debt-helpers.ts`) into two composable pieces — `createDebtPayments` (the real installment schedule) and `createBudgetItemsForDebt` (the budget-page forecast lines) — so a `PLANNED` debt can get budget lines without a schedule, and a later "confirm" action can wipe + regenerate both once amounts are locked in. This repo has no unit-test runner (no jest/vitest in `package.json`); verification throughout follows the existing project convention of `npx tsc --noEmit` after every code change plus a Playwright e2e script run by the plan executor directly (not a subagent) at the end, matching every prior debt/budget plan in `docs/superpowers/plans/`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma ORM + PostgreSQL, Zod validation, Tailwind + shadcn/ui, Playwright (manual e2e scripts, no jest).

**Scope note:** This is Plan 1 of a 6-plan breakdown of `docs/superpowers/specs/2026-06-18-budget-page-redesign-design.md` (Section 8 "Schema change — Planned liabilities", plus the parts of Section 6 that are pure backend/`/debts`-page work). The three new `/budget*` routes, the comparison-API rewrite, and the month-detail page's `DebtForm` swap are separate plans (2-6) that depend on this one's API surface (`status: "PLANNED"` on create, the `/confirm` endpoint) but are NOT implemented here.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `DebtStatus` enum gains `PLANNED` |
| `src/lib/debt-helpers.ts` | Split into `createDebtPayments`, `createBudgetItemsForDebt`, `createDebtPaymentsAndBudgetItems` (thin wrapper of both, kept for existing callers) |
| `src/lib/validations/debt.ts` | `createDebtSchema` gains optional `status: z.literal("PLANNED")`; new `confirmPlannedDebtSchema` |
| `src/app/api/v1/debts/route.ts` | POST branches on status (PLANNED = budget items only, no payments); GET's status filter allow-list gains `"PLANNED"` |
| `src/app/api/v1/debts/[id]/confirm/route.ts` | **New.** POST: validates debt is `PLANNED`, accepts optional `totalAmount`/`totalMonths` overrides, wipes old budget items, flips to `ACTIVE`, regenerates payments+budget items |
| `src/app/(app)/debts/page.tsx` | New "วางแผน" tab listing `PLANNED` debts |
| `src/app/(app)/debts/[id]/page.tsx` | PLANNED status label; placeholder block + "ยืนยันเป็นหนี้จริง" dialog instead of the (empty) payment schedule |

No new files beyond the `confirm` route. No new migration tooling — same `prisma migrate dev` flow used by every prior schema change in this repo.

---

## Task 1: Schema — add `PLANNED` to `DebtStatus`

**Files:**
- Modify: `prisma/schema.prisma:303-307`

- [ ] **Step 1: Edit the enum**

```prisma
enum DebtStatus {
  ACTIVE
  PLANNED
  COMPLETED
  CANCELLED
}
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name add_planned_debt_status --schema="/Users/kwxnxxmbair/K Storage/Claude Workspace/finance-tracker/prisma/schema.prisma"
```

Expected: creates `prisma/migrations/<timestamp>_add_planned_debt_status/migration.sql` containing `ALTER TYPE "DebtStatus" ADD VALUE 'PLANNED';`, applies cleanly (no pending-migration conflicts — this DB is the shared dev/prod Postgres on `localhost:5432`, same as every prior migration in this repo).

- [ ] **Step 3: Regenerate the Prisma client and verify**

```bash
npx prisma generate --schema="/Users/kwxnxxmbair/K Storage/Claude Workspace/finance-tracker/prisma/schema.prisma"
grep -n "PLANNED" "src/generated/prisma/enums.ts"
```

Expected: `PLANNED` appears in the generated `DebtStatus` enum. (Per this repo's documented Prisma gotcha, `prisma migrate dev` does not reliably regenerate the client by itself — always grep-verify after.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean (no code references `PLANNED` yet, so this only confirms the schema/client change itself didn't break anything).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(debts): add PLANNED status to DebtStatus enum"
```

---

## Task 2: Split `debt-helpers.ts` into payments-only and budget-items-only pieces

**Files:**
- Modify: `src/lib/debt-helpers.ts` (full rewrite of the file's contents)

- [ ] **Step 1: Replace the file contents**

```ts
import { Prisma } from "@/generated/prisma/client";
import { addMonths } from "@/lib/utils";

export async function createDebtPayments(
  tx: Prisma.TransactionClient,
  params: {
    debtId: string;
    totalMonths: number;
    monthlyAmount: number;
    startDate: Date;
  }
) {
  const { debtId, totalMonths, monthlyAmount, startDate } = params;

  const payments = Array.from({ length: totalMonths }, (_, i) => ({
    debtId,
    installmentNo: i + 1,
    dueDate: addMonths(startDate, i),
    amount: new Prisma.Decimal(monthlyAmount),
    status: "PENDING" as const,
  }));

  await tx.debtPayment.createMany({ data: payments });
}

export async function createBudgetItemsForDebt(
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
  await createDebtPayments(tx, params);
  await createBudgetItemsForDebt(tx, params);
}
```

This is a pure extraction — `createDebtPaymentsAndBudgetItems`'s behavior and signature are byte-for-byte unchanged for existing callers (`POST /api/v1/debts` for ACTIVE debts, `POST /api/v1/debts/convert`). Only new code (Task 4, Task 5) will call the two new exports directly.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/debt-helpers.ts
git commit -m "refactor(debts): split createDebtPaymentsAndBudgetItems into payments-only and budget-items-only helpers"
```

---

## Task 3: Validation — `status` on create, new confirm schema

**Files:**
- Modify: `src/lib/validations/debt.ts`

- [ ] **Step 1: Add `status` to `createDebtSchema` and a new `confirmPlannedDebtSchema`**

In `src/lib/validations/debt.ts`, add a `status` field to `createDebtSchema` (client may omit it — defaults to `ACTIVE` server-side in Task 4 — or explicitly request `"PLANNED"`; no other status is creatable directly, matching the existing `updateDebtSchema`'s restriction to `ACTIVE | COMPLETED | CANCELLED` only — `PLANNED → ACTIVE` can ONLY happen through the new confirm endpoint):

```ts
export const createDebtSchema = z.object({
  name: z.string().min(1, "กรุณาใส่ชื่อรายการ").max(100, "ชื่อยาวเกินไป"),
  totalAmount: z
    .number()
    .positive("จำนวนเงินต้องมากกว่า 0")
    .max(999999999.99, "จำนวนเงินเกินขีดจำกัด"),
  totalMonths: z
    .number()
    .int("จำนวนงวดต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวนงวดต้องมากกว่า 0")
    .max(360, "จำนวนงวดเกินขีดจำกัด"),
  monthlyAmount: z
    .number()
    .positive("จำนวนเงินต่องวดต้องมากกว่า 0")
    .max(999999999.99)
    .nullable()
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  notes: z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
  interestRate: z
    .number()
    .min(0, "อัตราดอกเบี้ยต้องไม่ติดลบ")
    .max(99.99, "อัตราดอกเบี้ยเกินขีดจำกัด")
    .nullable()
    .optional(),
  status: z.literal("PLANNED").optional(),
});

export const updateDebtSchema = createDebtSchema
  .omit({ status: true })
  .partial()
  .extend({
    status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  });

export type CreateDebtInput = z.infer<typeof createDebtSchema>;
export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;

export const confirmPlannedDebtSchema = z.object({
  totalAmount: z
    .number()
    .positive("จำนวนเงินต้องมากกว่า 0")
    .max(999999999.99, "จำนวนเงินเกินขีดจำกัด")
    .optional(),
  totalMonths: z
    .number()
    .int("จำนวนงวดต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวนงวดต้องมากกว่า 0")
    .max(360, "จำนวนงวดเกินขีดจำกัด")
    .optional(),
});

export type ConfirmPlannedDebtInput = z.infer<typeof confirmPlannedDebtSchema>;
```

(`updateDebtSchema` previously did `createDebtSchema.partial().extend({ status: ... })` — since `createDebtSchema` now has its OWN `status` field with a different, incompatible type (`z.literal("PLANNED")` vs `z.enum([...])`), `.omit({ status: true })` is added before `.partial().extend(...)` so the two `status` definitions don't collide. Everything else about `updateDebtSchema` is unchanged.)

Leave `convertToDebtSchema` (further down the file) untouched — out of scope.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validations/debt.ts
git commit -m "feat(debts): add PLANNED status to createDebtSchema, add confirmPlannedDebtSchema"
```

---

## Task 4: `POST /api/v1/debts` creates PLANNED debts without a schedule; `GET` filters by PLANNED

**Files:**
- Modify: `src/app/api/v1/debts/route.ts`

- [ ] **Step 1: Update the GET status filter allow-list**

In `src/app/api/v1/debts/route.ts`, change:

```ts
    if (statusParam === "ACTIVE" || statusParam === "COMPLETED" || statusParam === "CANCELLED") {
      where.status = statusParam as DebtStatus;
    }
```

to:

```ts
    if (statusParam === "ACTIVE" || statusParam === "PLANNED" || statusParam === "COMPLETED" || statusParam === "CANCELLED") {
      where.status = statusParam as DebtStatus;
    }
```

- [ ] **Step 2: Update the import and POST handler**

Change the import line:

```ts
import { createDebtPaymentsAndBudgetItems } from "@/lib/debt-helpers";
```

to:

```ts
import { createDebtPaymentsAndBudgetItems, createBudgetItemsForDebt } from "@/lib/debt-helpers";
```

In the `POST` handler, change the destructuring line:

```ts
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId, accountId, interestRate } = parsed.data;
```

to:

```ts
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId, accountId, interestRate, status } = parsed.data;
    const effectiveStatus = status === "PLANNED" ? "PLANNED" : "ACTIVE";
```

Change the `debt.create` call's `status: "ACTIVE",` line to:

```ts
          status: effectiveStatus,
```

Change the schedule-generation call:

```ts
      await createDebtPaymentsAndBudgetItems(tx, {
        debtId: created.id,
        debtName: created.name,
        totalMonths,
        monthlyAmount: effectiveMonthly,
        startDate: start,
        userId: session.user.id,
      });
```

to:

```ts
      if (effectiveStatus === "PLANNED") {
        // PLANNED debts are forecasts only — show up on the budget-page grid
        // immediately (createBudgetItemsForDebt) but generate no real
        // DebtPayment schedule until confirmed via POST /debts/[id]/confirm.
        await createBudgetItemsForDebt(tx, {
          debtId: created.id,
          debtName: created.name,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          startDate: start,
          userId: session.user.id,
        });
      } else {
        await createDebtPaymentsAndBudgetItems(tx, {
          debtId: created.id,
          debtName: created.name,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          startDate: start,
          userId: session.user.id,
        });
      }
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/debts/route.ts
git commit -m "feat(debts): POST /debts creates PLANNED debts with budget items but no payment schedule; GET filters by PLANNED"
```

---

## Task 5: `POST /api/v1/debts/[id]/confirm` — lock in a PLANNED debt as real

**Files:**
- Create: `src/app/api/v1/debts/[id]/confirm/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { confirmPlannedDebtSchema } from "@/lib/validations/debt";
import { addMonths } from "@/lib/utils";
import { createDebtPaymentsAndBudgetItems } from "@/lib/debt-helpers";

export async function POST(
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
    const existing = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการหนี้สิน" } },
        { status: 404 }
      );
    }

    if (existing.status !== "PLANNED") {
      return NextResponse.json(
        { success: false, error: { code: "NOT_PLANNED", message: "รายการนี้ไม่ใช่แผนการเงินที่รอยืนยัน" } },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = confirmPlannedDebtSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const totalAmount = parsed.data.totalAmount ?? Number(existing.totalAmount);
    const totalMonths = parsed.data.totalMonths ?? existing.totalMonths;
    const monthlyAmount = totalAmount / totalMonths;
    const startDate = existing.startDate;
    const endDate = addMonths(startDate, totalMonths - 1);

    const debt = await prisma.$transaction(async (tx) => {
      // PLANNED creation (Task 4) already made budget-item lines for the
      // ORIGINAL totalMonths span. totalAmount/totalMonths may have just
      // changed (the original entry was an estimate), so wipe them and let
      // createDebtPaymentsAndBudgetItems below recreate the correct set —
      // simpler and less error-prone than diffing old vs new month spans.
      await tx.budgetItem.deleteMany({ where: { debtId: id } });

      const updated = await tx.debt.update({
        where: { id },
        data: { totalAmount, totalMonths, monthlyAmount, endDate, status: "ACTIVE" },
      });

      await createDebtPaymentsAndBudgetItems(tx, {
        debtId: id,
        debtName: updated.name,
        totalMonths,
        monthlyAmount,
        startDate,
        userId: session.user.id,
      });

      return tx.debt.findUnique({
        where: { id },
        include: {
          account: { select: { id: true, name: true } },
          payments: { orderBy: { installmentNo: "asc" } },
        },
      });
    });

    return NextResponse.json({ success: true, data: debt });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/v1/debts/[id]/confirm/route.ts"
git commit -m "feat(api): add POST /api/v1/debts/[id]/confirm to convert a PLANNED debt to ACTIVE"
```

---

## Task 6: `/debts` page — "วางแผน" tab

**Files:**
- Modify: `src/app/(app)/debts/page.tsx`

- [ ] **Step 1: Extend `TabType` and the `Debt` interface**

Change:

```ts
type TabType = "ACTIVE" | "COMPLETED" | "CANCELLED";
```

to:

```ts
type TabType = "ACTIVE" | "PLANNED" | "COMPLETED" | "CANCELLED";
```

Change the `Debt` interface's status field:

```ts
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
```

to:

```ts
  status: "ACTIVE" | "PLANNED" | "COMPLETED" | "CANCELLED";
```

- [ ] **Step 2: Add the 4th tab button**

Change:

```tsx
      {/* Tabs */}
      <div className="ios-card p-1 grid grid-cols-3 gap-1">
        {(["ACTIVE", "COMPLETED", "CANCELLED"] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold transition-all",
              tab === t ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}
          >
            {t === "ACTIVE" ? "กำลังผ่อน" : t === "COMPLETED" ? "ชำระครบ" : "ยกเลิก"}
          </button>
        ))}
      </div>
```

to:

```tsx
      {/* Tabs */}
      <div className="ios-card p-1 grid grid-cols-4 gap-1">
        {(["ACTIVE", "PLANNED", "COMPLETED", "CANCELLED"] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold transition-all",
              tab === t ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}
          >
            {t === "ACTIVE" ? "กำลังผ่อน" : t === "PLANNED" ? "วางแผน" : t === "COMPLETED" ? "ชำระครบ" : "ยกเลิก"}
          </button>
        ))}
      </div>
```

- [ ] **Step 3: Update the empty-state copy for the PLANNED tab**

Change:

```tsx
          <p className="text-[16px] font-medium">
            {tab === "ACTIVE" ? "ยังไม่มีรายการผ่อนชำระ" : "ไม่มีรายการในหมวดนี้"}
          </p>
```

to:

```tsx
          <p className="text-[16px] font-medium">
            {tab === "ACTIVE" ? "ยังไม่มีรายการผ่อนชำระ" :
             tab === "PLANNED" ? "ไม่มีแผนการเงินที่รอยืนยัน" : "ไม่มีรายการในหมวดนี้"}
          </p>
```

(No other change needed — `fetchDebts` already does `fetch(\`/api/v1/debts?status=${tab}\`)` generically, and Task 4's GET allow-list now accepts `"PLANNED"`. The FAB and hero-balance card stay gated on `tab === "ACTIVE"` exactly as today — `PLANNED` debts are created only via the budget month-detail page's `DebtForm` flow, covered in a later plan, not from this page.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/debts/page.tsx"
git commit -m "feat(debts): add วางแผน (PLANNED) tab to /debts list page"
```

---

## Task 7: `/debts/[id]` detail page — PLANNED label + confirm dialog

**Files:**
- Modify: `src/app/(app)/debts/[id]/page.tsx`

- [ ] **Step 1: Extend the `Debt` interface and imports**

Change:

```ts
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
```

to:

```ts
  status: "ACTIVE" | "PLANNED" | "COMPLETED" | "CANCELLED";
```

Add `Input` to the imports (new import line, alongside the existing `Button`/`Dialog` imports):

```ts
import { Input } from "@/components/ui/input";
```

- [ ] **Step 2: Add confirm-dialog state and handler**

Add these state hooks alongside the existing ones (`payingId`, `confirmPay`, etc.):

```ts
  const [confirmPlanOpen, setConfirmPlanOpen] = useState(false);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmMonths, setConfirmMonths] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
```

Add a handler alongside `handleUnconvert`:

```ts
  function openConfirmPlan() {
    if (!debt) return;
    setConfirmAmount(String(Number(debt.totalAmount)));
    setConfirmMonths(String(debt.totalMonths));
    setConfirmError("");
    setConfirmPlanOpen(true);
  }

  async function handleConfirmPlanned() {
    const amt = parseFloat(confirmAmount);
    const months = parseInt(confirmMonths, 10);
    if (isNaN(amt) || amt <= 0) { setConfirmError("จำนวนเงินต้องมากกว่า 0"); return; }
    if (isNaN(months) || months < 1 || months > 360) { setConfirmError("จำนวนงวดต้อง 1-360 เดือน"); return; }

    setConfirmLoading(true);
    setConfirmError("");
    try {
      const res = await fetch(`/api/v1/debts/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalAmount: amt, totalMonths: months }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmPlanOpen(false);
        await fetchDebt();
      } else {
        setConfirmError(data.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
      }
    } finally {
      setConfirmLoading(false);
    }
  }
```

- [ ] **Step 3: Update the status label**

Change:

```tsx
          <p className="text-[13px] text-muted-foreground">
            {debt.status === "ACTIVE" ? "กำลังผ่อน" : debt.status === "COMPLETED" ? "ชำระครบแล้ว ✓" : "ยกเลิก"}
          </p>
```

to:

```tsx
          <p className="text-[13px] text-muted-foreground">
            {debt.status === "ACTIVE" ? "กำลังผ่อน" :
             debt.status === "PLANNED" ? "วางแผนไว้ (ยังไม่ใช่หนี้จริง)" :
             debt.status === "COMPLETED" ? "ชำระครบแล้ว ✓" : "ยกเลิก"}
          </p>
```

- [ ] **Step 4: Gate the payment-schedule section, add the PLANNED placeholder + CTA**

Change:

```tsx
      {/* Payment schedule */}
      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">ตารางผ่อนชำระ</p>

        <div className="ios-card overflow-hidden divide-y divide-border">
          {debt.payments.map((payment) => (
```

to:

```tsx
      {/* Payment schedule (PLANNED debts have none yet — show a confirm CTA instead) */}
      {debt.status === "PLANNED" ? (
        <div className="ios-card px-5 py-6 text-center space-y-3">
          <p className="text-3xl">📋</p>
          <p className="text-[14px] font-medium">เป็นแผนการเงิน ยังไม่มีตารางผ่อนชำระจริง</p>
          <p className="text-[12px] text-muted-foreground">
            กดยืนยันเมื่อพร้อมเริ่มผ่อนจริง — สามารถแก้ไขยอดรวมและจำนวนงวดได้ก่อนยืนยัน
          </p>
          <Button className="w-full" style={{ backgroundColor: "#FF9500" }} onClick={openConfirmPlan}>
            ยืนยันเป็นหนี้จริง
          </Button>
        </div>
      ) : (
      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">ตารางผ่อนชำระ</p>

        <div className="ios-card overflow-hidden divide-y divide-border">
          {debt.payments.map((payment) => (
```

Then change the closing of that block — find:

```tsx
            </div>
          ))}
        </div>
      </div>

      {/* Converted-from transactions */}
```

and change it to:

```tsx
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Converted-from transactions */}
```

- [ ] **Step 5: Add the confirm dialog**

Add a new `Dialog` block right after the existing "Unconvert dialog" block (before the closing `</div>` of the component):

```tsx
      {/* Confirm planned debt */}
      <Dialog open={confirmPlanOpen} onOpenChange={(open) => { if (!open) setConfirmPlanOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันเป็นหนี้จริง</DialogTitle>
            <DialogDescription>
              ยอดเดิมเป็นเพียงประมาณการ แก้ไขให้ตรงกับยอดจริงก่อนยืนยัน ระบบจะสร้างตารางผ่อนชำระให้ทันที
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <p className="text-[12px] text-muted-foreground">ยอดรวมทั้งหมด (บาท)</p>
              <Input type="number" inputMode="decimal" step="0.01" value={confirmAmount}
                onChange={(e) => setConfirmAmount(e.target.value)}
                className="bg-input h-11 rounded-xl border-0" />
            </div>
            <div className="space-y-1">
              <p className="text-[12px] text-muted-foreground">จำนวนงวด (เดือน)</p>
              <Input type="number" inputMode="numeric" min={1} max={360} value={confirmMonths}
                onChange={(e) => setConfirmMonths(e.target.value)}
                className="bg-input h-11 rounded-xl border-0" />
            </div>
            {confirmError && <p className="text-[12px] text-destructive">{confirmError}</p>}
          </div>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setConfirmPlanOpen(false)} disabled={confirmLoading}>ยกเลิก</Button>
            <Button onClick={handleConfirmPlanned} disabled={confirmLoading} style={{ backgroundColor: "#FF9500" }}>
              {confirmLoading ? "กำลังยืนยัน..." : "ยืนยัน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/debts/[id]/page.tsx"
git commit -m "feat(debts): show PLANNED placeholder + confirm-as-real dialog on debt detail page"
```

---

## Task 8: End-to-end verification (run directly, not via subagent)

This repo's established pattern (every prior debt/budget plan) is a single Playwright script run by whoever executes this plan, using a disposable fixture user, against `npm run dev -- -p 3001` with `NEXTAUTH_URL=http://localhost:3001` (the shared dev/prod Postgres on `:5432` means `:3000`'s prod container stays untouched). Clean up the fixture user and stop the dev server when done.

- [ ] **Step 1: Start the dev server**

```bash
NEXTAUTH_URL=http://localhost:3001 npm run dev -- -p 3001
```

Wait for "Ready" in the output before continuing.

- [ ] **Step 2: Write the e2e script**

Create `tmp-e2e-planned-debt.mjs` in the repo root (Playwright's `node_modules` resolution requires the script to live under the project root, not `/tmp`):

```js
import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = `plandebt-${Date.now()}@test.local`;
const PASSWORD = "TestPass123!";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS:", msg);
}

// --- Register + login ---
await page.goto(`${BASE}/register`);
await page.fill('input[name="name"]', "Plan Debt Test");
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|login/, { timeout: 15000 });
if (page.url().includes("login")) {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 15000 });
}

// --- A: create a PLANNED debt via API, verify no payments, budget items exist ---
const startDate = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
const createRes = await page.evaluate(async (startDate) => {
  const r = await fetch("/api/v1/debts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "iPad Pro 2026 (แผน)",
      totalAmount: 24000,
      totalMonths: 12,
      startDate,
      status: "PLANNED",
    }),
  });
  return { status: r.status, body: await r.json() };
}, startDate);

assert(createRes.status === 201, `POST /debts with status=PLANNED returns 201 (got ${createRes.status})`);
const debtId = createRes.body.data.id;
assert(createRes.body.data.status === "PLANNED", "created debt has status PLANNED");
assert(createRes.body.data.payments.length === 0, "PLANNED debt has zero DebtPayment rows");

// --- B: budget items exist across the span (check current month + next month) ---
const now = new Date();
const y1 = now.getFullYear(), m1 = now.getMonth() + 1;
const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const y2 = next.getFullYear(), m2 = next.getMonth() + 1;

const budget1 = await page.evaluate(async (y, m) => {
  const r = await fetch(`/api/v1/budgets/${y}/${m}`);
  return (await r.json()).data;
}, y1, m1);
const budget2 = await page.evaluate(async (y, m) => {
  const r = await fetch(`/api/v1/budgets/${y}/${m}`);
  return (await r.json()).data;
}, y2, m2);

assert(budget1.items.some(i => i.debtId === debtId), "month 1 budget has a LIABILITY item linked to the PLANNED debt");
assert(budget2.items.some(i => i.debtId === debtId), "month 2 budget has a LIABILITY item linked to the PLANNED debt");

// --- C: GET /debts?status=PLANNED returns it; status=ACTIVE does not ---
const plannedList = await page.evaluate(async () => (await (await fetch("/api/v1/debts?status=PLANNED")).json()).data);
const activeList = await page.evaluate(async () => (await (await fetch("/api/v1/debts?status=ACTIVE")).json()).data);
assert(plannedList.some(d => d.id === debtId), "GET /debts?status=PLANNED includes the new debt");
assert(!activeList.some(d => d.id === debtId), "GET /debts?status=ACTIVE excludes the PLANNED debt");

// --- D: /debts page shows it under the วางแผน tab ---
await page.goto(`${BASE}/debts`);
await page.click('button:has-text("วางแผน")');
await page.waitForTimeout(500);
assert((await page.locator(`text=iPad Pro 2026 (แผน)`).count()) > 0, "/debts วางแผน tab shows the PLANNED debt");

// --- E: detail page shows placeholder + confirm CTA, not a payment schedule ---
await page.goto(`${BASE}/debts/${debtId}`);
assert((await page.locator("text=วางแผนไว้ (ยังไม่ใช่หนี้จริง)").count()) > 0, "detail page shows PLANNED status label");
assert((await page.locator("text=เป็นแผนการเงิน ยังไม่มีตารางผ่อนชำระจริง").count()) > 0, "detail page shows the PLANNED placeholder");
assert((await page.locator("text=งวดที่ 1").count()) === 0, "detail page does NOT show a payment schedule for a PLANNED debt");

// --- F: confirm flow — edit totals, confirm, verify ACTIVE + new schedule ---
await page.click('button:has-text("ยืนยันเป็นหนี้จริง")');
const amountInputs = await page.locator('input[type="number"]').all();
await amountInputs[0].fill("30000");
await amountInputs[1].fill("10");
await page.click('button:has-text("ยืนยัน")');
await page.waitForTimeout(1000);

const confirmed = await page.evaluate(async (id) => (await (await fetch(`/api/v1/debts/${id}`)).json()).data, debtId);
assert(confirmed.status === "ACTIVE", "debt status flipped to ACTIVE after confirm");
assert(Number(confirmed.totalAmount) === 30000, "totalAmount updated to edited value (30000)");
assert(confirmed.totalMonths === 10, "totalMonths updated to edited value (10)");
assert(confirmed.payments.length === 10, "confirm generated exactly 10 DebtPayment rows");
assert(Math.abs(Number(confirmed.monthlyAmount) - 3000) < 0.01, "monthlyAmount recomputed as 30000/10=3000");

// --- G: old budget items (12-month span) were replaced by new (10-month span) ---
const budgetAfter1 = await page.evaluate(async (y, m) => {
  const r = await fetch(`/api/v1/budgets/${y}/${m}`);
  return (await r.json()).data;
}, y1, m1);
const itemsForDebt = budgetAfter1.items.filter(i => i.debtId === debtId);
assert(itemsForDebt.length === 1, "month 1 still has exactly one budget item for this debt (no duplicates from regeneration)");
assert(Math.abs(itemsForDebt[0].amount - 3000) < 0.01, "regenerated budget item amount matches new monthlyAmount (3000)");

// --- H: confirm on an already-ACTIVE debt is rejected ---
const reConfirm = await page.evaluate(async (id) => {
  const r = await fetch(`/api/v1/debts/${id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { status: r.status, body: await r.json() };
}, debtId);
assert(reConfirm.status === 400, "confirming an already-ACTIVE debt returns 400");
assert(reConfirm.body.error.code === "NOT_PLANNED", "rejection error code is NOT_PLANNED");

console.log("ALL ASSERTIONS PASSED");
await browser.close();
```

- [ ] **Step 3: Run the script**

```bash
node tmp-e2e-planned-debt.mjs
```

Expected: every line prints `PASS:` and the script ends with `ALL ASSERTIONS PASSED` and exit code 0.

- [ ] **Step 4: Clean up the fixture user and temp files**

```bash
docker exec finance-db psql -U finance -d finance_tracker -c "DELETE FROM users WHERE email LIKE 'plandebt-%@test.local';"
rm tmp-e2e-planned-debt.mjs
```

(Cascades delete the user's debts/budgets/budget-items automatically via existing FK `onDelete: Cascade` relations.)

- [ ] **Step 5: Stop the dev server**

Stop the `npm run dev -- -p 3001` process started in Step 1.

- [ ] **Step 6: Final full-repo typecheck**

```bash
npx tsc --noEmit
```

Expected: clean, confirming no leftover issues across all 7 prior tasks combined.

No commit for this task — it's verification only, nothing in the working tree changes (the fixture script and DB rows are deleted in Step 4).

---

## Self-Review Notes

- **Spec coverage:** This plan covers Section 8 in full (enum, no-schedule creation, exclusion from ACTIVE-only queries — verified all existing `status: "ACTIVE"` call sites use exact-match filters so `PLANNED` is excluded by construction, no code changes needed there beyond Task 4's GET allow-list) and the `/debts` page "หนี้สินวางแผน" + "ยืนยันเป็นหนี้จริง" requirements. It deliberately does NOT cover: the month-detail page's `DebtForm` swap (Section 6, LIABILITY case) — that's where `status: "PLANNED"` actually gets sent from the budget UI, planned for a later plan in this 6-plan series — or anything in Sections 3-5/5a (the three new pages, comparison API rewrite).
- **Placeholder scan:** no TBDs; every code block is complete and copy-pasteable.
- **Type consistency:** `createBudgetItemsForDebt`/`createDebtPayments`/`createDebtPaymentsAndBudgetItems` signatures match across Task 2 (definition) and Tasks 4-5 (call sites). `confirmPlannedDebtSchema`'s field names (`totalAmount`, `totalMonths`) match the `confirm` route's destructuring in Task 5 and the e2e script's request body in Task 8.

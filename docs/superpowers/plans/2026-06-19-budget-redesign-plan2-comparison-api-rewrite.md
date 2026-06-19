# Budget Redesign Plan 2 — Comparison API Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `GET /api/v1/budgets/comparison` so `actualNet` is apples-to-apples with `plannedNet` (it currently ignores liability/saving cash outflows entirely), and so it can detect actual transactions whose category has no matching budget item ("นอกแผน") for the upcoming Page 3 (`/budget/track`) UI.

**Architecture:** Single-file rewrite of `src/app/api/v1/budgets/comparison/route.ts`. No schema changes — this plan reuses data that already exists (`Transaction.debtPaymentId`, `Transfer.toAccountId` → `Account.type`, `BudgetItem.debtId`). The core insight: a debt installment can leave the wallet two different ways today — (a) a plain `EXPENSE` transaction tagged `debtPaymentId` (via the dedicated "pay installment" button), or (b) a generic account-to-account `Transfer` into a `CREDIT_CARD` account (via the "ชำระบัตรเครดิต" pay-down-the-card flow) which today is invisible to this endpoint because it filters out all `isTransfer:true` rows. Fixing this requires both adding the Transfer-based detection AND excluding `debtPaymentId`-tagged transactions from the generic `actualExpense` bucket — otherwise a debt paid via path (a) gets double-counted (once as `actualExpense`, once as the new `actualLiability`). The same `toAccount.type` pattern is reused symmetrically for `SAVINGS` accounts to compute `actualSaving`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma ORM + PostgreSQL, Zod validation. This repo has no unit-test runner (no jest/vitest in `package.json`); verification follows the existing project convention of `npx tsc --noEmit` after every code change plus a single consolidated Playwright e2e script run by the plan executor directly (not a subagent) at the end, matching every prior debt/budget plan in `docs/superpowers/plans/`.

**Scope note:** This is Plan 2 of the 6-plan breakdown of `docs/superpowers/specs/2026-06-18-budget-page-redesign-design.md`, covering Section 5a only. It does **not** touch the `/budget/[year]/[month]` page that currently consumes this endpoint (that page already reads `summary.actualNet`/`summary.plannedNet`/`items[].actual` — all of which keep their existing meaning and shape, just with corrected values, so no caller changes are needed) — and it does **not** build the Page 3 UI that will consume the new `unmatched` field (that's Plan 5, which depends on this plan's API surface).

**Design decisions confirmed with the user before writing this plan:**
1. **Transfer-based outflow detection rule:** any `Transfer` landing in a `CREDIT_CARD`-type account counts as an actual liability outflow; any `Transfer` landing in a `SAVINGS`-type account counts as an actual saving outflow. Uses the existing `Account.type` enum directly — no new schema, no check on `fromAccount.type`.
2. **Adjacent bug, fixed in this plan:** per-item `actual` for `LIABILITY`/`SAVING`-type budget items is always `0` today (the existing matching logic only branches on `INCOME`/`EXPENSE`). This plan fixes the `LIABILITY` case (every `LIABILITY` item carries a `debtId` via the existing Budget↔Debt sync, so its actual can be computed precisely from `debtPaymentId`-tagged transactions for that specific debt). The `SAVING` case is **not** fixable per-item in this plan — `BudgetItem` has no account/debt link for `SAVING` type (explicitly deferred in the spec's Section 9, "out of scope, today it's planning metadata only") — so a `SAVING` item's per-item `actual` stays `0`; only the new aggregate `summary.actualSaving` (via Transfer detection) reflects real money.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/api/v1/budgets/comparison/route.ts` | Full rewrite: exclude debt-payment transactions from `actualExpense`; fetch month's `Transfer`s; compute `actualLiabilityTransferOutflow`/`actualSavingTransferOutflow`; fix `LIABILITY` per-item `actual` via `debtId` match; add `summary.actualLiability`/`summary.actualSaving`; correct `summary.actualNet`; add new `unmatched.income`/`unmatched.expense` arrays |

No other file changes. No migration.

---

## Task 1: Fix `actualNet` — Transfer-based liability/saving outflows + debt-payment double-count fix

**Files:**
- Modify: `src/app/api/v1/budgets/comparison/route.ts` (full rewrite, see below)

- [ ] **Step 1: Replace the entire file contents**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/budgets/comparison?year=2026&month=6
// Returns plan vs actual for a given month
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(now.getFullYear()));
  const month = parseInt(req.nextUrl.searchParams.get("month") ?? String(now.getMonth() + 1));

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // last day of month

  const [budget, transactions, transfers] = await Promise.all([
    prisma.budget.findUnique({
      where: { userId_year_month: { userId: session.user.id, year, month } },
      include: { items: { include: { category: true }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }] } },
    }),
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate }, isTransfer: false, convertedToDebtId: null },
      include: { category: true, debtPayment: { select: { debtId: true } } },
    }),
    prisma.transfer.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate } },
      include: { toAccount: { select: { type: true } } },
    }),
  ]);

  // Debt-installment payments are tagged with debtPaymentId and belong to the
  // LIABILITY bucket below, not the generic EXPENSE bucket — exclude them here
  // so they aren't double-counted once also summed under their LIABILITY item.
  const nonDebtTransactions = transactions.filter(t => !t.debtPaymentId);
  const debtPaymentTransactions = transactions.filter(t => t.debtPaymentId);

  const actualIncome = nonDebtTransactions.filter(t => t.type === "INCOME").reduce((s, t) => s + Number(t.amount), 0);
  const actualExpense = nonDebtTransactions.filter(t => t.type === "EXPENSE").reduce((s, t) => s + Number(t.amount), 0);

  // A debt paid down via a credit-card-account Transfer (e.g. the "ชำระบัตรเครดิต"
  // flow) never creates a debtPaymentId-tagged transaction, so it's invisible to
  // the calc above — count any Transfer landing in a CREDIT_CARD account as a
  // real liability outflow. Same idea for SAVINGS accounts.
  const actualLiabilityTransferOutflow = transfers
    .filter(tr => tr.toAccount.type === "CREDIT_CARD")
    .reduce((s, tr) => s + Number(tr.amount), 0);
  const actualSavingTransferOutflow = transfers
    .filter(tr => tr.toAccount.type === "SAVINGS")
    .reduce((s, tr) => s + Number(tr.amount), 0);

  // A budget item pinned to a root category should roll up its children's
  // actuals too — matches how the dashboard's by-category breakdown sums
  // (transactions are tagged to leaf categories, but plans are usually made
  // against the main category).
  const matchesCategory = (t: (typeof nonDebtTransactions)[number], categoryId: string, isRoot: boolean) =>
    t.categoryId === categoryId || (isRoot && t.category?.parentId === categoryId);

  const items = (budget?.items ?? []).map(item => {
    let actual = 0;
    if (item.type === "INCOME" && item.categoryId) {
      const isRoot = item.category?.parentId == null;
      actual = nonDebtTransactions.filter(t => t.type === "INCOME" && matchesCategory(t, item.categoryId!, isRoot)).reduce((s, t) => s + Number(t.amount), 0);
    } else if (item.type === "EXPENSE" && item.categoryId) {
      const isRoot = item.category?.parentId == null;
      actual = nonDebtTransactions.filter(t => t.type === "EXPENSE" && matchesCategory(t, item.categoryId!, isRoot)).reduce((s, t) => s + Number(t.amount), 0);
    } else if (item.type === "INCOME") {
      actual = actualIncome;
    } else if (item.type === "EXPENSE") {
      actual = actualExpense;
    } else if (item.type === "LIABILITY" && item.debtId) {
      actual = debtPaymentTransactions.filter(t => t.debtPayment?.debtId === item.debtId).reduce((s, t) => s + Number(t.amount), 0);
    }
    // SAVING items have no real-money link yet (no accountId/debtId on
    // BudgetItem for SAVING) — actual stays 0 per-item; the aggregate
    // actualSaving total below still reflects real SAVINGS-account Transfers.

    const planned = Number(item.amount);
    const diff = item.type === "INCOME" ? actual - planned : planned - actual;
    const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      planned,
      actual,
      diff,
      pct,
      isOver: item.type !== "INCOME" && actual > planned,
      category: item.category ? { id: item.category.id, name: item.category.name, icon: item.category.icon } : null,
    };
  });

  const plannedIncome = items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.planned, 0);
  const plannedExpense = items.filter(i => i.type === "EXPENSE").reduce((s, i) => s + i.planned, 0);
  const plannedLiability = items.filter(i => i.type === "LIABILITY").reduce((s, i) => s + i.planned, 0);
  const plannedSaving = items.filter(i => i.type === "SAVING").reduce((s, i) => s + i.planned, 0);

  const actualLiability = items.filter(i => i.type === "LIABILITY").reduce((s, i) => s + i.actual, 0) + actualLiabilityTransferOutflow;
  const actualSaving = items.filter(i => i.type === "SAVING").reduce((s, i) => s + i.actual, 0) + actualSavingTransferOutflow;

  return NextResponse.json({
    success: true,
    data: {
      year, month,
      hasBudget: !!budget,
      summary: {
        plannedIncome, plannedExpense, plannedLiability, plannedSaving,
        actualIncome, actualExpense, actualLiability, actualSaving,
        plannedNet: plannedIncome - plannedExpense - plannedLiability - plannedSaving,
        actualNet: actualIncome - actualExpense - actualLiability - actualSaving,
      },
      items,
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/budgets/comparison/route.ts
git commit -m "fix(budgets): actualNet now accounts for Transfer-based liability/saving outflows"
```

---

## Task 2: Add unmatched-category detection (`unmatched.income` / `unmatched.expense`)

**Files:**
- Modify: `src/app/api/v1/budgets/comparison/route.ts` (full rewrite, see below — builds on Task 1's file)

- [ ] **Step 1: Replace the entire file contents**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/budgets/comparison?year=2026&month=6
// Returns plan vs actual for a given month
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(now.getFullYear()));
  const month = parseInt(req.nextUrl.searchParams.get("month") ?? String(now.getMonth() + 1));

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // last day of month

  const [budget, transactions, transfers] = await Promise.all([
    prisma.budget.findUnique({
      where: { userId_year_month: { userId: session.user.id, year, month } },
      include: { items: { include: { category: true }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }] } },
    }),
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate }, isTransfer: false, convertedToDebtId: null },
      include: { category: true, debtPayment: { select: { debtId: true } } },
    }),
    prisma.transfer.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate } },
      include: { toAccount: { select: { type: true } } },
    }),
  ]);

  // Debt-installment payments are tagged with debtPaymentId and belong to the
  // LIABILITY bucket below, not the generic EXPENSE bucket — exclude them here
  // so they aren't double-counted once also summed under their LIABILITY item.
  const nonDebtTransactions = transactions.filter(t => !t.debtPaymentId);
  const debtPaymentTransactions = transactions.filter(t => t.debtPaymentId);

  const actualIncome = nonDebtTransactions.filter(t => t.type === "INCOME").reduce((s, t) => s + Number(t.amount), 0);
  const actualExpense = nonDebtTransactions.filter(t => t.type === "EXPENSE").reduce((s, t) => s + Number(t.amount), 0);

  // A debt paid down via a credit-card-account Transfer (e.g. the "ชำระบัตรเครดิต"
  // flow) never creates a debtPaymentId-tagged transaction, so it's invisible to
  // the calc above — count any Transfer landing in a CREDIT_CARD account as a
  // real liability outflow. Same idea for SAVINGS accounts.
  const actualLiabilityTransferOutflow = transfers
    .filter(tr => tr.toAccount.type === "CREDIT_CARD")
    .reduce((s, tr) => s + Number(tr.amount), 0);
  const actualSavingTransferOutflow = transfers
    .filter(tr => tr.toAccount.type === "SAVINGS")
    .reduce((s, tr) => s + Number(tr.amount), 0);

  // A budget item pinned to a root category should roll up its children's
  // actuals too — matches how the dashboard's by-category breakdown sums
  // (transactions are tagged to leaf categories, but plans are usually made
  // against the main category).
  const matchesCategory = (t: (typeof nonDebtTransactions)[number], categoryId: string, isRoot: boolean) =>
    t.categoryId === categoryId || (isRoot && t.category?.parentId === categoryId);

  const items = (budget?.items ?? []).map(item => {
    let actual = 0;
    if (item.type === "INCOME" && item.categoryId) {
      const isRoot = item.category?.parentId == null;
      actual = nonDebtTransactions.filter(t => t.type === "INCOME" && matchesCategory(t, item.categoryId!, isRoot)).reduce((s, t) => s + Number(t.amount), 0);
    } else if (item.type === "EXPENSE" && item.categoryId) {
      const isRoot = item.category?.parentId == null;
      actual = nonDebtTransactions.filter(t => t.type === "EXPENSE" && matchesCategory(t, item.categoryId!, isRoot)).reduce((s, t) => s + Number(t.amount), 0);
    } else if (item.type === "INCOME") {
      actual = actualIncome;
    } else if (item.type === "EXPENSE") {
      actual = actualExpense;
    } else if (item.type === "LIABILITY" && item.debtId) {
      actual = debtPaymentTransactions.filter(t => t.debtPayment?.debtId === item.debtId).reduce((s, t) => s + Number(t.amount), 0);
    }
    // SAVING items have no real-money link yet (no accountId/debtId on
    // BudgetItem for SAVING) — actual stays 0 per-item; the aggregate
    // actualSaving total below still reflects real SAVINGS-account Transfers.

    const planned = Number(item.amount);
    const diff = item.type === "INCOME" ? actual - planned : planned - actual;
    const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      planned,
      actual,
      diff,
      pct,
      isOver: item.type !== "INCOME" && actual > planned,
      category: item.category ? { id: item.category.id, name: item.category.name, icon: item.category.icon } : null,
    };
  });

  const plannedIncome = items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.planned, 0);
  const plannedExpense = items.filter(i => i.type === "EXPENSE").reduce((s, i) => s + i.planned, 0);
  const plannedLiability = items.filter(i => i.type === "LIABILITY").reduce((s, i) => s + i.planned, 0);
  const plannedSaving = items.filter(i => i.type === "SAVING").reduce((s, i) => s + i.planned, 0);

  const actualLiability = items.filter(i => i.type === "LIABILITY").reduce((s, i) => s + i.actual, 0) + actualLiabilityTransferOutflow;
  const actualSaving = items.filter(i => i.type === "SAVING").reduce((s, i) => s + i.actual, 0) + actualSavingTransferOutflow;

  // --- Unmatched-category detection ---
  // A budget item with no categoryId is a catch-all that already absorbs
  // every transaction of its type into its own "actual" figure above — once
  // that catch-all exists, nothing of that type can be "outside the plan".
  const incomeItems = (budget?.items ?? []).filter(i => i.type === "INCOME");
  const expenseItems = (budget?.items ?? []).filter(i => i.type === "EXPENSE");
  const hasIncomeCatchAll = incomeItems.some(i => !i.categoryId);
  const hasExpenseCatchAll = expenseItems.some(i => !i.categoryId);

  const isCategoryMatched = (t: (typeof nonDebtTransactions)[number], typeItems: typeof incomeItems) =>
    typeItems.some(item => {
      if (!item.categoryId) return true;
      const isRoot = item.category?.parentId == null;
      return matchesCategory(t, item.categoryId, isRoot);
    });

  type UnmatchedRow = { categoryId: string | null; categoryName: string; categoryIcon: string | null; total: number };
  const aggregateByCategory = (txs: typeof nonDebtTransactions): UnmatchedRow[] => {
    const map = new Map<string, UnmatchedRow>();
    for (const t of txs) {
      const key = t.categoryId ?? "uncategorized";
      const amount = Number(t.amount);
      const existing = map.get(key);
      if (existing) {
        existing.total += amount;
      } else {
        map.set(key, {
          categoryId: t.categoryId ?? null,
          categoryName: t.category?.name ?? "ไม่ระบุหมวดหมู่",
          categoryIcon: t.category?.icon ?? null,
          total: amount,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  };

  const unmatchedIncome = hasIncomeCatchAll
    ? []
    : aggregateByCategory(nonDebtTransactions.filter(t => t.type === "INCOME" && !isCategoryMatched(t, incomeItems)));
  const unmatchedExpense = hasExpenseCatchAll
    ? []
    : aggregateByCategory(nonDebtTransactions.filter(t => t.type === "EXPENSE" && !isCategoryMatched(t, expenseItems)));

  return NextResponse.json({
    success: true,
    data: {
      year, month,
      hasBudget: !!budget,
      summary: {
        plannedIncome, plannedExpense, plannedLiability, plannedSaving,
        actualIncome, actualExpense, actualLiability, actualSaving,
        plannedNet: plannedIncome - plannedExpense - plannedLiability - plannedSaving,
        actualNet: actualIncome - actualExpense - actualLiability - actualSaving,
      },
      items,
      unmatched: {
        income: unmatchedIncome,
        expense: unmatchedExpense,
      },
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/budgets/comparison/route.ts
git commit -m "feat(budgets): comparison API detects transactions with no matching budget item"
```

---

## Task 3: Playwright e2e verification (no code change)

This is verification-only, matching the established convention for this repo's debt/budget plans (e.g. Plan 1's Task 8) — run by the plan executor directly, not a subagent, since it needs a long-lived dev server plus sequential steps.

**Files:**
- Create (temporary, deleted at the end): `tmp-e2e-budget-comparison.mjs` at the repo root (must live under the project root, not `/tmp`, so `node_modules` resolution for `playwright` works)

- [ ] **Step 1: Start the dev server on a free port**

```bash
NEXTAUTH_URL=http://localhost:3001 npm run dev -- -p 3001
```

Run this in the background. Wait for "Ready" in the output before continuing. (`.env`'s `NEXTAUTH_URL=http://localhost:3000` would otherwise misdirect NextAuth at the prod container if one is running on `:3000` — always override it for this port, per this repo's documented local-dev convention.)

- [ ] **Step 2: Write the verification script**

Create `tmp-e2e-budget-comparison.mjs`:

```javascript
import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = `budget-comparison-${Date.now()}@test.local`;
const PASSWORD = "TestPass123!";

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  // 1. Register + auto-login via the real UI (creates the seeded
  // CASH + CREDIT_CARD accounts + default categories via cloneDefaultsForUser).
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder("ชื่อของคุณ").fill("Comparison Fixture");
  await page.getByPlaceholder("email@example.com").fill(EMAIL);
  await page.getByPlaceholder("อย่างน้อย 8 ตัวอักษร").fill(PASSWORD);
  await page.getByPlaceholder("ยืนยันรหัสผ่าน").fill(PASSWORD);
  await page.getByRole("button", { name: "สมัครสมาชิก" }).click();
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 });

  // Helper: call an API route in the browser's authenticated context.
  const api = async (method, url, body) => {
    return page.evaluate(
      async ({ method, url, body }) => {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json() };
      },
      { method, url, body }
    );
  };

  // 2. Fetch seeded accounts + categories.
  const { json: accountsJson } = await api("GET", "/api/v1/accounts");
  const cashAccount = accountsJson.data.find(a => a.type === "CASH");
  const ccAccount = accountsJson.data.find(a => a.type === "CREDIT_CARD");
  assert(cashAccount && ccAccount, "seeded CASH + CREDIT_CARD accounts exist");

  const { json: categoriesJson } = await api("GET", "/api/v1/categories");
  const incomeRoots = categoriesJson.data.filter(c => c.type === "INCOME" && !c.parentId);
  const expenseRoots = categoriesJson.data.filter(c => c.type === "EXPENSE" && !c.parentId);
  assert(incomeRoots.length >= 2 && expenseRoots.length >= 2, "at least 2 root INCOME and 2 root EXPENSE categories exist");
  const [incomeBudgeted, incomeUnbudgeted] = incomeRoots;
  const [expenseBudgeted, expenseUnbudgeted] = expenseRoots;

  // 3. Create a SAVINGS account (not seeded by default).
  const { json: savingsJson } = await api("POST", "/api/v1/accounts", {
    name: "ออมทรัพย์ทดสอบ", type: "SAVINGS", initialBalance: 0, isDefault: false, sortOrder: 99,
  });
  const savingsAccount = savingsJson.data;
  assert(savingsJson.status === 201 && savingsAccount?.id, "SAVINGS account created");

  // 4. Pick the test month = today's year/month (matches the dev clock).
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const mm = String(month).padStart(2, "0");
  const dateStr = `${year}-${mm}-15`;
  const startOfMonth = `${year}-${mm}-01`;

  // 5. Create a Debt (auto-creates a LIABILITY budget item via existing sync)
  // with its first installment due in the test month.
  const { json: debtJson } = await api("POST", "/api/v1/debts", {
    name: "หนี้ทดสอบ Plan2", totalAmount: 3000, totalMonths: 3, startDate: startOfMonth,
  });
  const debt = debtJson.data;
  assert(debtJson.status === 201 && debt?.id, "debt created");

  const { json: debtDetailJson } = await api("GET", `/api/v1/debts/${debt.id}`);
  const firstPayment = debtDetailJson.data.payments[0];
  assert(firstPayment.dueDate.startsWith(`${year}-${mm}`), "debt's first installment falls in the test month");

  // 6. Pay the first installment (creates a debtPaymentId-tagged EXPENSE transaction).
  const { json: payJson } = await api("POST", `/api/v1/debts/${debt.id}/payments/${firstPayment.id}/pay`, { paidDate: dateStr });
  assert(payJson.success, "first installment paid");

  // 7. Set up the budget for the test month: budgeted INCOME + EXPENSE items
  // (the LIABILITY item already exists from step 5's sync).
  const { json: existingBudgetJson } = await api("GET", `/api/v1/budgets/${year}/${month}`);
  const liabilityItem = existingBudgetJson.data.items.find(i => i.type === "LIABILITY");
  assert(liabilityItem, "LIABILITY budget item auto-created by debt sync");

  await api("PUT", `/api/v1/budgets/${year}/${month}`, {
    items: [
      { name: "เงินเดือน", type: "INCOME", amount: 20000, categoryId: incomeBudgeted.id },
      { name: "ค่าใช้จ่ายทั่วไป", type: "EXPENSE", amount: 5000, categoryId: expenseBudgeted.id },
      { id: liabilityItem.id, name: liabilityItem.name, type: "LIABILITY", amount: liabilityItem.amount, debtId: debt.id },
    ],
  });

  // 8. Record actual transactions: one matched income, one unmatched income,
  // one matched expense, one unmatched expense.
  await api("POST", "/api/v1/transactions", { type: "INCOME", amount: 20000, date: dateStr, categoryId: incomeBudgeted.id });
  await api("POST", "/api/v1/transactions", { type: "INCOME", amount: 1500, date: dateStr, categoryId: incomeUnbudgeted.id });
  await api("POST", "/api/v1/transactions", { type: "EXPENSE", amount: 4000, date: dateStr, categoryId: expenseBudgeted.id });
  await api("POST", "/api/v1/transactions", { type: "EXPENSE", amount: 700, date: dateStr, categoryId: expenseUnbudgeted.id });

  // 9. Pay down the seeded credit card via Transfer (liability outflow, no
  // debtPaymentId — must be picked up by the new Transfer-based detection).
  await api("POST", "/api/v1/accounts/transfer", {
    fromAccountId: cashAccount.id, toAccountId: ccAccount.id, amount: 800, date: dateStr,
  });

  // 10. Move cash into savings via Transfer (saving outflow).
  await api("POST", "/api/v1/accounts/transfer", {
    fromAccountId: cashAccount.id, toAccountId: savingsAccount.id, amount: 2000, date: dateStr,
  });

  // 11. Call the rewritten comparison endpoint and assert.
  const { json: cmp } = await api("GET", `/api/v1/budgets/comparison?year=${year}&month=${month}`);
  const d = cmp.data;

  assert(d.summary.actualIncome === 20000, `actualIncome excludes nothing extra (got ${d.summary.actualIncome})`);
  assert(d.summary.actualExpense === 4000, `actualExpense excludes the debt-payment transaction (got ${d.summary.actualExpense})`);
  assert(d.summary.actualLiability === 1000 + 800, `actualLiability = installment (1000) + CC-payoff transfer (800) (got ${d.summary.actualLiability})`);
  assert(d.summary.actualSaving === 2000, `actualSaving = savings transfer (got ${d.summary.actualSaving})`);
  const expectedActualNet = 20000 - 4000 - (1000 + 800) - 2000;
  assert(d.summary.actualNet === expectedActualNet, `actualNet = ${expectedActualNet} (got ${d.summary.actualNet})`);

  const liabilityRow = d.items.find(i => i.type === "LIABILITY");
  assert(liabilityRow.actual === 1000, `LIABILITY item's own actual = paid installment only, not the CC transfer (got ${liabilityRow.actual})`);

  assert(d.unmatched.income.length === 1 && d.unmatched.income[0].total === 1500, "unmatched.income has the 1 unbudgeted income transaction");
  assert(d.unmatched.expense.length === 1 && d.unmatched.expense[0].total === 700, "unmatched.expense has the 1 unbudgeted expense transaction");

  console.log("ALL CHECKS PASSED");
} finally {
  await browser.close();
}
```

- [ ] **Step 3: Run the script**

```bash
node tmp-e2e-budget-comparison.mjs
```

Expected: every line prints `PASS: ...`, ending with `ALL CHECKS PASSED`. If any assertion throws, fix the implementation (Task 1/2's file) and re-run — do not edit the script's expected values to make a failure disappear unless you find an actual mistake in the script's own arithmetic.

- [ ] **Step 4: Clean up the fixture user**

```bash
docker exec finance-db psql -U finance -d finance_tracker -c "DELETE FROM users WHERE email='<the EMAIL value the script printed/used>'"
```

(Cascades delete the fixture's accounts, transactions, transfers, debts, budget, and budget items — same cleanup pattern used by every prior fixture in this repo.)

- [ ] **Step 5: Delete the temporary script and stop the dev server**

```bash
rm tmp-e2e-budget-comparison.mjs
```

Stop the `npm run dev -- -p 3001` background process.

- [ ] **Step 6: Final typecheck across the whole repo**

```bash
npx tsc --noEmit
```

Expected: clean.

No commit for this task (verification only, matches Plan 1's Task 8 convention — nothing here changes tracked files since the temp script is deleted).

---

## Self-Review Notes

- **Spec coverage:** Section 5a item 1 (actualNet Transfer fix) → Task 1. Section 5a item 2 (unmatched-category detection) → Task 2. Both verified together in Task 3.
- **Adjacent bug fix:** per-item `LIABILITY` actual (confirmed in-scope by user) → Task 1. Per-item `SAVING` actual explicitly left at `0` with an inline comment explaining why (no schema link exists yet, deferred per spec Section 9) — not silently dropped.
- **Double-count fix:** excluding `debtPaymentId`-tagged transactions from `actualExpense`/`EXPENSE`-item matching was not explicitly requested but is required for correctness once `actualLiability` is introduced — called out in the plan header and covered by Task 3's assertion that `actualExpense === 4000` (not `4000 + 1000`) and the `LIABILITY` item's own `actual === 1000` (not double-counting the CC transfer).
- **No caller breakage:** the existing `/budget/[year]/[month]` page only reads `summary.plannedIncome/plannedExpense/plannedNet/actualNet` and `items[].*` — all field names are preserved, only values change (correctly) and new fields (`summary.actualLiability`, `summary.actualSaving`, `unmatched`) are additive.

# Wallet/CC Phase 2C-2: Linked-Debt Balance Inclusion + Reverse Debt List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `Debt` linked to a credit-card/loan `Account` (via `Debt.accountId`, added in C-1) actually count toward that account's outstanding balance everywhere it's shown, and surface those linked debts on the account's own detail page.

**Architecture:** One shared balance helper (`computeAccountBalance`) gets a new subtraction term for linked `ACTIVE` debts' remaining balance — this single change propagates to `/accounts` (list), `/accounts/[id]` (detail), and the dashboard summary, since all three already call it. `/accounts/[id]`'s API route additionally gains a `linkedDebts` array (same enrichment formula `GET /api/v1/debts` already uses), rendered as a new "หนี้ที่ผูกกับบัญชีนี้" section on the account detail page.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma/PostgreSQL. No unit-test framework (jest/vitest) exists in this repo — verification per task is `npx tsc --noEmit`; full behavioral verification is one end-to-end Playwright script (Task 4) covering every scenario in the spec.

---

## Part 1 — Overview

### What's being built and why

C-1 (shipped, `69463be`) added `Debt.accountId` — an optional link from a debt to the credit-card/loan account it's billed through — but nothing consumed that link yet. A debt linked to a card represents money the user still owes *on that card*, so two things are currently wrong: (1) the card's "ใช้ไป" (used) figure doesn't include it, and (2) there's nowhere on the card's own page to see "you still owe X on this debt through this card". This plan fixes both.

### Key design decisions

**Single shared formula, three surfaces for free.** `computeAccountBalance(accountId, initialBalance, accountType)` in `src/lib/account-balance.ts` is called by `/api/v1/accounts` (list), `/api/v1/accounts/[id]` (detail), and `/api/v1/accounts/summary` (dashboard). For `CREDIT_CARD` accounts it currently returns `-initialBalance + netActivity`. We extend it to:

```
balance = -initialBalance + netActivity - Σ remainingBalance(linkedActiveDebts)
```

where `linkedActiveDebts` = `Debt` rows with `accountId = thisAccount.id AND status = "ACTIVE"`, and `remainingBalance` per debt = `Σ DebtPayment.amount WHERE status != "PAID"` (the exact formula `GET /api/v1/debts` already uses). Because all three routes derive every "ใช้ไป" / `creditOutstanding` figure from this one function, Task 1 alone fixes the number on `/accounts`, `/accounts/[id]`, and the dashboard's "ยอดบัตรเครดิต/สินเชื่อค้างจ่าย" row + wallet card.

**Why this can't double-count today.** Creating a `Debt` never creates a `Transaction`. Paying an installment (`POST .../payments/[paymentId]/pay`) creates an `EXPENSE` transaction tagged with `paymentMethodId`, **not** `accountId` — so a linked debt's remaining balance has never been represented in any `accountId`-scoped aggregate before. Adding it via `remainingBalance` is the first and only representation of that debt on the card. (A future "convert expense → debt" flow, C-3, will need to delete the original transaction to avoid double-counting — captured in the spec's "Future Work" section, out of scope here.)

**Only `ACTIVE` debts count/show.** By construction, an `ACTIVE` debt always has `remainingBalance > 0` (the pay-installment route flips status to `COMPLETED` once the last payment is `PAID`), so no extra `> 0` filter is needed. `CANCELLED` debts (written off via `DELETE /api/v1/debts/[id]` when they have ≥1 paid installment) are excluded from both the balance subtraction and the new list — they're no longer owed. When a debt completes, it disappears from both on the next page load with zero client-side special-casing.

**New section placement.** "หนี้ที่ผูกกับบัญชีนี้" sits between the transfer/ชำระ button and "รายการล่าสุด" on `/accounts/[id]`, only for `type === "CREDIT_CARD"` accounts with ≥1 qualifying (`ACTIVE`) linked debt. Each row shows the debt name, a progress bar (`paidCount`/`totalMonths`), "คงเหลือ ฿{remainingBalance}", and links to `/debts/[id]` — mirroring the row styling already used on `/debts`.

### Constraints / trade-offs

- No schema migration — `Debt.accountId` and `Debt.status` already exist from C-1.
- No new Zod validation needed — this is read/compute only, no new user input.
- `BalanceHero`'s "คงเหลือสุทธิ" (`liquidTotal`) is unaffected; it already excludes `CREDIT_CARD` accounts entirely.
- `creditLimit === null` accounts are unaffected by the progress-bar-vs-limit UI (still gated on `creditLimit` truthy) — only the raw "ใช้ไป" amount changes.

### Out of scope

- C-3: converting a CC expense `Transaction` into a `Debt`, `User.tier`, interest calculation, tier gating — deferred to a separate session per `project_state` memory.
- `/debts` list page — unchanged; a linked debt already appears there exactly as before.
- Any retroactive "link this old debt to an account" UI — debts get `accountId` only at creation time (C-1), unchanged here.

---

## Part 2 — Tasks

### Task 1: Extend `computeAccountBalance` to subtract linked-debt remaining balance

**Files:**
- Modify: `src/lib/account-balance.ts` (full file, 37 lines)

- [ ] **Step 1: Replace the file with the extended version**

Current file:

```ts
import { prisma } from "@/lib/prisma";

export async function computeAccountBalance(
  accountId: string,
  initialBalance: number,
  accountType: string
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
  const netActivity =
    Number(income._sum.amount ?? 0) -
    Number(expense._sum.amount ?? 0) -
    Number(tfOut._sum.amount ?? 0) +
    Number(tfIn._sum.amount ?? 0);

  // CREDIT_CARD: initialBalance is entered as a positive "ใช้ไปแล้ว" (already-owed)
  // amount, so it subtracts from balance instead of adding.
  return accountType === "CREDIT_CARD"
    ? -initialBalance + netActivity
    : initialBalance + netActivity;
}
```

Replace the whole file with:

```ts
import { prisma } from "@/lib/prisma";

export async function computeAccountBalance(
  accountId: string,
  initialBalance: number,
  accountType: string
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
  const netActivity =
    Number(income._sum.amount ?? 0) -
    Number(expense._sum.amount ?? 0) -
    Number(tfOut._sum.amount ?? 0) +
    Number(tfIn._sum.amount ?? 0);

  if (accountType !== "CREDIT_CARD") {
    return initialBalance + netActivity;
  }

  // Debts linked to this card (accountId = this account, still ACTIVE) are money
  // already owed on it that hasn't appeared in netActivity as a transaction yet.
  const linkedDebtRemaining = await prisma.debtPayment.aggregate({
    where: {
      status: { not: "PAID" },
      debt: { accountId, status: "ACTIVE" },
    },
    _sum: { amount: true },
  });

  // CREDIT_CARD: initialBalance is entered as a positive "ใช้ไปแล้ว" (already-owed)
  // amount, so it subtracts from balance instead of adding.
  return (
    -initialBalance + netActivity - Number(linkedDebtRemaining._sum.amount ?? 0)
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/account-balance.ts
git commit -m "feat(accounts): subtract linked-debt remaining balance from CC outstanding"
```

---

### Task 2: `GET /api/v1/accounts/[id]` — return linked-debt list

**Files:**
- Modify: `src/app/api/v1/accounts/[id]/route.ts:30-68`

- [ ] **Step 1: Insert the `linkedDebts` query after the balance computation**

Current (lines 30-44):

```ts
    const balance = await computeAccountBalance(
      id,
      Number(account.initialBalance),
      account.type
    );

    const recentTransactions = await prisma.transaction.findMany({
      where: { accountId: id, isTransfer: false },
      orderBy: { date: "desc" },
      take: 20,
      include: {
        category: { select: { name: true, icon: true } },
      },
    });
```

Replace with:

```ts
    const balance = await computeAccountBalance(
      id,
      Number(account.initialBalance),
      account.type
    );

    const linkedDebts =
      account.type === "CREDIT_CARD"
        ? await prisma.debt.findMany({
            where: { accountId: id, status: "ACTIVE" },
            include: { payments: true },
            orderBy: { createdAt: "desc" },
          })
        : [];

    const enrichedLinkedDebts = linkedDebts.map((debt) => {
      const remainingBalance = debt.payments
        .filter((p) => p.status !== "PAID")
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const paidCount = debt.payments.filter((p) => p.status === "PAID").length;
      return {
        id: debt.id,
        name: debt.name,
        totalMonths: debt.totalMonths,
        paidCount,
        remainingBalance,
      };
    });

    const recentTransactions = await prisma.transaction.findMany({
      where: { accountId: id, isTransfer: false },
      orderBy: { date: "desc" },
      take: 20,
      include: {
        category: { select: { name: true, icon: true } },
      },
    });
```

- [ ] **Step 2: Add `linkedDebts` to the response data**

Current (lines 45-68):

```ts
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
```

Replace with:

```ts
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
        linkedDebts: enrichedLinkedDebts,
      },
    });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/v1/accounts/[id]/route.ts"
git commit -m "feat(api): include linked ACTIVE debts in account detail response"
```

---

### Task 3: `/accounts/[id]` page — render "หนี้ที่ผูกกับบัญชีนี้" section

**Files:**
- Modify: `src/app/(app)/accounts/[id]/page.tsx`

- [ ] **Step 1: Add the `next/link` import**

Current (lines 1-12):

```tsx
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
import { cn, formatCurrency, formatShortDate } from "@/lib/utils";
```

Replace with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AccountForm } from "@/components/forms/account-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { cn, formatCurrency, formatShortDate } from "@/lib/utils";
```

- [ ] **Step 2: Extend the `AccountDetail` interface**

Current (lines 14-34):

```tsx
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
```

Replace with:

```tsx
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
  linkedDebts: {
    id: string;
    name: string;
    totalMonths: number;
    paidCount: number;
    remainingBalance: number;
  }[];
}
```

- [ ] **Step 3: Insert the new section between the transfer button and "รายการล่าสุด"**

Current (lines 123-134):

```tsx
      {/* Transfer / pay button */}
      <Button
        variant="secondary"
        className="w-full gap-2"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-4 w-4" />
        {isCreditCard ? "ชำระบัตรเครดิต/สินเชื่อ" : "โอนออก"}
      </Button>

      {/* Recent transactions */}
      <div>
```

Replace with:

```tsx
      {/* Transfer / pay button */}
      <Button
        variant="secondary"
        className="w-full gap-2"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-4 w-4" />
        {isCreditCard ? "ชำระบัตรเครดิต/สินเชื่อ" : "โอนออก"}
      </Button>

      {/* Linked debts */}
      {isCreditCard && account.linkedDebts.length > 0 && (
        <div>
          <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">หนี้ที่ผูกกับบัญชีนี้</p>
          <div className="ios-card divide-y divide-border/50">
            {account.linkedDebts.map((debt) => {
              const pct = debt.totalMonths === 0 ? 0 : Math.round((debt.paidCount / debt.totalMonths) * 100);
              return (
                <Link key={debt.id} href={`/debts/${debt.id}`} className="block px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-medium">{debt.name}</p>
                    <p className="text-[13px] font-semibold text-[#FF9500] tabular-nums">คงเหลือ {formatCurrency(debt.remainingBalance)}</p>
                  </div>
                  <div className="w-full bg-border/60 rounded-full h-1.5 mt-2">
                    <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">ผ่อนแล้ว {debt.paidCount}/{debt.totalMonths} งวด</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      <div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/accounts/[id]/page.tsx"
git commit -m "feat(accounts): show linked ACTIVE debts on account detail page"
```

---

### Task 4: End-to-end verification

**Files:**
- Create (temporary, not committed): `/tmp/run-check/c2-verify.mjs`

This script covers every scenario in the spec's Testing/Verification Plan: CC account with `creditLimit`, a linked debt (`totalMonths=4`) with 1 paid installment, checking `/accounts`, `/accounts/[id]`, and the dashboard all reflect the remaining balance and the new section (1/4 progress), then paying off the remaining 3 installments to confirm the section disappears and the balance returns to baseline, plus a `CANCELLED` linked debt excluded from everything.

- [ ] **Step 1: Start the dev server on port 3001**

Run (background): `npm run dev -- -p 3001`
Wait until it logs `Ready` before continuing.

- [ ] **Step 2: Write the verification script**

```js
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3001";
const EMAIL = `c2check${Date.now()}@example.com`;
const PASSWORD = "testpass123";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
  }
  console.log(`OK: ${label} = ${actual}`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();

  // --- Setup: register fixture user ---
  await page.goto(`${BASE_URL}/register`);
  await page.getByPlaceholder("ชื่อของคุณ").fill("C2 Check");
  await page.getByPlaceholder("email@example.com").fill(EMAIL);
  await page.getByPlaceholder("อย่างน้อย 8 ตัวอักษร").fill(PASSWORD);
  await page.getByPlaceholder("ยืนยันรหัสผ่าน").fill(PASSWORD);
  await page.getByRole("button", { name: "สมัครสมาชิก" }).click();
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
  console.log("OK: registered & logged in as", EMAIL);

  // --- Setup: find seeded CREDIT_CARD account, set creditLimit ---
  let res = await page.request.get(`${BASE_URL}/api/v1/accounts`);
  let { data: accounts } = await res.json();
  const cc = accounts.find((a) => a.type === "CREDIT_CARD");
  if (!cc) throw new Error("FAIL: no seeded CREDIT_CARD account found");
  const baselineUsed = Math.max(0, -cc.balance);

  res = await page.request.patch(`${BASE_URL}/api/v1/accounts/${cc.id}`, {
    data: { creditLimit: 10000 },
  });
  if (!(await res.json()).success) throw new Error("FAIL: PATCH creditLimit");
  console.log("OK: CC account", cc.id, "creditLimit set to 10000");

  // --- Setup: create main linked debt (totalMonths=4, monthlyAmount=1000) ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts`, {
    data: {
      name: "iPhone 15",
      totalAmount: 4000,
      totalMonths: 4,
      monthlyAmount: 1000,
      startDate: "2026-01-01",
      accountId: cc.id,
    },
  });
  let body = await res.json();
  if (!body.success) throw new Error("FAIL: POST /api/v1/debts (main): " + JSON.stringify(body));
  const debt = body.data;
  console.log("OK: created linked debt", debt.id, "with", debt.payments.length, "payments");

  // --- Setup: create second linked debt, to become CANCELLED ---
  res = await page.request.post(`${BASE_URL}/api/v1/debts`, {
    data: {
      name: "เงินกู้เพื่อน",
      totalAmount: 2000,
      totalMonths: 2,
      monthlyAmount: 1000,
      startDate: "2026-01-01",
      accountId: cc.id,
    },
  });
  body = await res.json();
  if (!body.success) throw new Error("FAIL: POST /api/v1/debts (cancel): " + JSON.stringify(body));
  const cancelDebt = body.data;

  // --- Pay installment 1/4 of main debt ---
  res = await page.request.post(
    `${BASE_URL}/api/v1/debts/${debt.id}/payments/${debt.payments[0].id}/pay`,
    { data: {} }
  );
  body = await res.json();
  if (!body.success) throw new Error("FAIL: pay main debt installment 1: " + JSON.stringify(body));
  console.log("OK: paid installment 1/4 of main debt (remaining = 3000)");

  // --- Pay installment 1/2 of cancel-debt, then DELETE -> CANCELLED ---
  res = await page.request.post(
    `${BASE_URL}/api/v1/debts/${cancelDebt.id}/payments/${cancelDebt.payments[0].id}/pay`,
    { data: {} }
  );
  body = await res.json();
  if (!body.success) throw new Error("FAIL: pay cancel-debt installment 1: " + JSON.stringify(body));

  res = await page.request.delete(`${BASE_URL}/api/v1/debts/${cancelDebt.id}`);
  body = await res.json();
  if (!body.success) throw new Error("FAIL: DELETE cancel-debt: " + JSON.stringify(body));
  console.log("OK: cancel-debt deleted (status -> CANCELLED, has 1 PAID payment)");

  const expectedUsed = baselineUsed + 3000;

  // --- Scenario A: /accounts list — "ใช้ไป" includes linked debt remaining ---
  await page.goto(`${BASE_URL}/accounts`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/run-check/c2-accounts-list.png" });

  res = await page.request.get(`${BASE_URL}/api/v1/accounts`);
  ({ data: accounts } = await res.json());
  const ccAfter = accounts.find((a) => a.id === cc.id);
  assertEqual(Math.max(0, -ccAfter.balance), expectedUsed, "Scenario A: /accounts ใช้ไป (cancelled debt excluded)");

  // --- Scenario B: /accounts/[id] — balance + linkedDebts + UI section ---
  res = await page.request.get(`${BASE_URL}/api/v1/accounts/${cc.id}`);
  let detail = (await res.json()).data;
  assertEqual(Math.max(0, -detail.balance), expectedUsed, "Scenario B: /accounts/[id] balance");
  assertEqual(detail.linkedDebts.length, 1, "Scenario B: linkedDebts.length");
  assertEqual(detail.linkedDebts[0].id, debt.id, "Scenario B: linkedDebts[0].id");
  assertEqual(detail.linkedDebts[0].paidCount, 1, "Scenario B: linkedDebts[0].paidCount");
  assertEqual(detail.linkedDebts[0].totalMonths, 4, "Scenario B: linkedDebts[0].totalMonths");
  assertEqual(detail.linkedDebts[0].remainingBalance, 3000, "Scenario B: linkedDebts[0].remainingBalance");

  await page.goto(`${BASE_URL}/accounts/${cc.id}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/run-check/c2-account-detail-with-debt.png" });

  await page.getByText("หนี้ที่ผูกกับบัญชีนี้").waitFor();
  await page.getByText("iPhone 15").waitFor();
  await page.getByText(/คงเหลือ.*3,000\.00/).waitFor();
  await page.getByText("ผ่อนแล้ว 1/4 งวด").waitFor();
  console.log("OK: Scenario B UI — section header, debt name, remaining, progress text all render");

  await page.getByText("iPhone 15").click();
  await page.waitForURL(`${BASE_URL}/debts/${debt.id}`);
  console.log("OK: Scenario B nav — row links to /debts/[id]");
  await page.goBack();
  await page.waitForLoadState("networkidle");

  // --- Scenario C: dashboard — creditOutstanding includes linked debt remaining ---
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/run-check/c2-dashboard.png" });

  res = await page.request.get(`${BASE_URL}/api/v1/accounts/summary`);
  const summary = (await res.json()).data;
  assertEqual(summary.creditOutstanding, expectedUsed, "Scenario C: dashboard creditOutstanding");

  // --- Scenario D: pay off remaining 3 installments -> COMPLETED -> section gone, balance back to baseline ---
  for (let i = 1; i <= 3; i++) {
    res = await page.request.post(
      `${BASE_URL}/api/v1/debts/${debt.id}/payments/${debt.payments[i].id}/pay`,
      { data: {} }
    );
    body = await res.json();
    if (!body.success) throw new Error(`FAIL: pay main debt installment ${i + 1}: ` + JSON.stringify(body));
  }
  console.log("OK: paid remaining 3 installments of main debt (should now be COMPLETED)");

  res = await page.request.get(`${BASE_URL}/api/v1/accounts/${cc.id}`);
  detail = (await res.json()).data;
  assertEqual(detail.linkedDebts.length, 0, "Scenario D: linkedDebts.length after payoff");
  assertEqual(Math.max(0, -detail.balance), baselineUsed, "Scenario D: balance back to baseline");

  await page.goto(`${BASE_URL}/accounts/${cc.id}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/run-check/c2-account-detail-after-payoff.png" });
  assertEqual(await page.getByText("หนี้ที่ผูกกับบัญชีนี้").count(), 0, "Scenario D UI: section removed after payoff");

  console.log("\nALL SCENARIOS PASSED");
  console.log("Fixture email (for cleanup):", EMAIL);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the script**

Run: `node /tmp/run-check/c2-verify.mjs`
Expected: every `OK:` line prints, ending with `ALL SCENARIOS PASSED`. Note the printed fixture email for Step 5.

- [ ] **Step 4: Review screenshots**

Open `/tmp/run-check/c2-accounts-list.png`, `/tmp/run-check/c2-account-detail-with-debt.png`, `/tmp/run-check/c2-dashboard.png`, `/tmp/run-check/c2-account-detail-after-payoff.png` — confirm at 430px width:
- `/accounts`: CC row's "ใช้ไป" amount and progress bar (vs. `creditLimit`) include the 3,000 remaining.
- `/accounts/[id]` (with debt): "หนี้ที่ผูกกับบัญชีนี้" section renders between the ชำระ button and "รายการล่าสุด", showing "iPhone 15", a ~25% progress bar, "คงเหลือ ฿3,000.00", "ผ่อนแล้ว 1/4 งวด".
- `/dashboard`: "ยอดบัตรเครดิต/สินเชื่อค้างจ่าย" row and the wallet card's outstanding figure both include the 3,000.
- `/accounts/[id]` (after payoff): "หนี้ที่ผูกกับบัญชีนี้" section is gone.

- [ ] **Step 5: Clean up the fixture user and temporary files**

Run (replace `<EMAIL>` with the value printed in Step 3):

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.delete({ where: { email: '<EMAIL>' } })
  .then(() => console.log('Fixture user deleted'))
  .finally(() => prisma.\$disconnect());
"
rm -f /tmp/run-check/c2-verify.mjs /tmp/run-check/c2-*.png
```

Then stop the dev server started in Step 1.

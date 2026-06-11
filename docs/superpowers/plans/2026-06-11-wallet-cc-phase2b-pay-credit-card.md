# Wallet/Credit Card Phase 2B — Outstanding-Balance Display Fix + Pay-Credit-Card Flow Implementation Plan

## Part 1 — Summary (read this first)

### What is being built and why

This is sub-project B of the "Wallet/Credit Card Phase 2" effort (see project
memory). It fixes a real user-visible bug and adds one new entry point:

1. **Bug:** On `/accounts` (per-card row) and on the dashboard's lower
   "กระเป๋าเงิน" card, the credit card "ใช้ไป" (amount used) figure is computed
   from the *current statement cycle's* expenses only (`cycleUsed` /
   `creditUsed`). Paying off the card via a Transfer does not reduce these
   numbers, because Transfers aren't part of that cycle-scoped query. Users
   pay their card and still see "ใช้ไป ฿500" unchanged — confusing and wrong.
2. **New feature:** A "ชำระบัตรเครดิต" (pay credit card) button on
   `/accounts/[id]` for credit-card accounts, replacing "โอนออก" for that
   account type.

### Key design decisions (and why)

- **No new computation logic.** `computeAccountBalance()`
  (`src/lib/account-balance.ts`) already computes
  `initialBalance + income - expense - transferOut + transferIn`, all-time.
  This is exactly "outstanding balance owed" for a credit card
  (`Math.max(0, -balance)`), and it ALREADY nets out payments made via the
  existing Account→Account Transfer flow. `creditOutstanding`
  (per-account `Math.max(0,-balance)` summed) was already added to
  `/api/v1/accounts/summary` in sub-project A. So this sub-project is
  **display-only**: point the two broken UI spots at numbers that already
  exist and are already correct.
- **Delete `cycleUsed`/`creditUsed` entirely** (confirmed by user — option
  "แทนที่ด้วยยอดค้างชำระจริง"). No secondary "this cycle" line is kept. Verified
  via grep: these fields have exactly the 6 call sites listed in Part 2,
  no other consumers.
- **Pay-CC reuses `TransferForm`**, not a new dialog. It already lets the user
  pick any source account and type any amount, which covers both month-end
  lump-sum and partial/weekly payments. It just needs a new
  `defaultToAccountId?: string` prop (mirroring the existing
  `defaultFromAccountId?: string`) so the destination is pre-selected to the
  card. `/accounts/[id]` then passes `defaultToAccountId` (CC) XOR
  `defaultFromAccountId` (everything else) — never both.
- **`getCycleStart` (`src/lib/utils.ts`) stays**, even though both routes stop
  calling it after this change. It's a small pure helper, plausibly useful
  for sub-project C's statement-cycle/interest logic. Only the now-dead
  imports/calls in the two route files are removed.

### Architecture overview

- **Backend** (`/api/v1/accounts` GET, `/api/v1/accounts/summary` GET): both
  drop their cycle-scoped "used" queries. `accounts/route.ts` loses the
  `computeCycleUsed` helper and the `cycleUsed` field on each item.
  `accounts/summary/route.ts` loses the `creditResults`/`creditUsed`
  Promise.all loop; `creditLimit` becomes a synchronous
  `.reduce()` over `creditAccounts` (already fetched, no new query).
  `liquidTotal`, `creditLimit`, `creditOutstanding`, `hasCreditCards` all
  remain unchanged in shape/meaning.
- **Frontend display swap**: `/accounts` page's CC row and the dashboard's
  lower wallet card switch from `cycleUsed`/`creditUsed` to
  `Math.max(0, -acc.balance)` (per-account, already in the `/api/v1/accounts`
  response) and `creditOutstanding` (aggregate, already in
  `/api/v1/accounts/summary`'s response since sub-project A) respectively.
- **New button**: `TransferForm` gains one optional prop.
  `/accounts/[id]`'s existing transfer button is relabeled
  conditionally and passes the new prop for CC accounts.

### Constraints / non-obvious tradeoffs

- No DB migration. No new API endpoints, no new validation schemas.
- Sub-project A's dashboard `BalanceHero` ("คงเหลือสุทธิ" / "ยอดบัตรเครดิตค้างจ่าย",
  fed by `liquidTotal`/`creditOutstanding` via a *different*, already-correct
  `walletSummary` prop type at `dashboard/page.tsx:118`) is **not touched** —
  only the lower "กระเป๋าเงิน" card's local state type
  (`dashboard/page.tsx:654-660`) loses `creditUsed`.

### Testing approach

This codebase has no unit/integration test suite — `package.json` has no
`test` script and there are no `*.test.*`/`*.spec.*` files anywhere. The
established pattern for every prior phase (incl. sub-project A) is:
`tsc --noEmit` + `eslint` clean on touched files, plus a throwaway Playwright
e2e script (`/tmp/run-check/*.mjs`) against `npm run dev -p 3001` with a
disposable fixture account, screenshots taken, fixture cleaned up after. This
plan follows that pattern: Tasks 1-5 are the code changes (each ending in a
`tsc --noEmit` sanity check), Task 6 is the full e2e verification mirroring
the spec's 8-step Verification Plan.

### Out of scope (deferred to sub-project C)

- `/transactions` per-tx "ชำระยอดนี้" prefill button on 💳 บัตรเครดิต rows.
- `/accounts` list per-row quick-pay action.
- Convert credit-card expense → Debt + interest, `user.tier` gating.

---

## Part 2 — Implementation Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken cycle-scoped "ใช้ไป" displays with the already-correct
all-time outstanding balance, and add a "ชำระบัตรเครดิต" button that opens
`TransferForm` pre-targeted at the card.

**Architecture:** Pure refactor + one new optional prop. Two API routes drop dead
fields; two pages swap which field they read; one form component gains
`defaultToAccountId`; one page conditionally passes it.

**Tech Stack:** Next.js 14 App Router API routes, Prisma, React/TSX, react-hook-form,
Playwright (e2e verification only, no committed test files).

---

### Task 1: Backend — drop dead `cycleUsed`/`creditUsed` fields

**Files:**
- Modify: `src/app/api/v1/accounts/route.ts`
- Modify: `src/app/api/v1/accounts/summary/route.ts`

- [ ] **Step 1: Remove `computeCycleUsed` helper and its import from `accounts/route.ts`**

In `src/app/api/v1/accounts/route.ts`, replace:

```ts
import { createAccountSchema } from "@/lib/validations/account";
import { getCycleStart } from "@/lib/utils";
import { computeAccountBalance } from "@/lib/account-balance";

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

export async function GET() {
```

with:

```ts
import { createAccountSchema } from "@/lib/validations/account";
import { computeAccountBalance } from "@/lib/account-balance";

export async function GET() {
```

- [ ] **Step 2: Remove `cycleUsed` from the per-account response in `accounts/route.ts`**

In the same file, replace:

```ts
        const balance = await computeAccountBalance(
          acc.id,
          Number(acc.initialBalance)
        );
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
```

with:

```ts
        const balance = await computeAccountBalance(
          acc.id,
          Number(acc.initialBalance)
        );
        return {
          id: acc.id,
          name: acc.name,
          type: acc.type,
          balance,
          initialBalance: Number(acc.initialBalance),
          creditLimit: acc.creditLimit ? Number(acc.creditLimit) : null,
          statementDay: acc.statementDay,
```

- [ ] **Step 3: Remove `getCycleStart` import from `accounts/summary/route.ts`**

In `src/app/api/v1/accounts/summary/route.ts`, replace:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCycleStart } from "@/lib/utils";
import { computeAccountBalance } from "@/lib/account-balance";
```

with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeAccountBalance } from "@/lib/account-balance";
```

- [ ] **Step 4: Remove the `creditResults`/`creditUsed` loop, make `creditLimit` synchronous, drop `creditUsed` from the response**

In the same file, replace:

```ts
    const creditResults = await Promise.all(
      creditAccounts.map(async (acc) => {
        if (!acc.statementDay) return { creditUsed: 0, creditLimit: Number(acc.creditLimit ?? 0) };
        const result = await prisma.transaction.aggregate({
          where: { accountId: acc.id, type: "EXPENSE", isTransfer: false, date: { gte: getCycleStart(acc.statementDay) } },
          _sum: { amount: true },
        });
        return { creditUsed: Number(result._sum.amount ?? 0), creditLimit: Number(acc.creditLimit ?? 0) };
      })
    );
    const creditUsed = creditResults.reduce((sum, r) => sum + r.creditUsed, 0);
    const creditLimit = creditResults.reduce((sum, r) => sum + r.creditLimit, 0);

    const creditOutstandingResults = await Promise.all(
      creditAccounts.map(async (acc) => {
        const balance = await computeAccountBalance(acc.id, Number(acc.initialBalance));
        return Math.max(0, -balance);
      })
    );
    const creditOutstanding = creditOutstandingResults.reduce((sum, v) => sum + v, 0);

    return NextResponse.json({
      success: true,
      data: {
        liquidTotal,
        creditUsed,
        creditLimit,
        creditOutstanding,
        hasCreditCards: creditAccounts.length > 0,
      },
    });
```

with:

```ts
    const creditLimit = creditAccounts.reduce((sum, acc) => sum + Number(acc.creditLimit ?? 0), 0);

    const creditOutstandingResults = await Promise.all(
      creditAccounts.map(async (acc) => {
        const balance = await computeAccountBalance(acc.id, Number(acc.initialBalance));
        return Math.max(0, -balance);
      })
    );
    const creditOutstanding = creditOutstandingResults.reduce((sum, v) => sum + v, 0);

    return NextResponse.json({
      success: true,
      data: {
        liquidTotal,
        creditLimit,
        creditOutstanding,
        hasCreditCards: creditAccounts.length > 0,
      },
    });
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from these two files (frontend still references
`cycleUsed`/`creditUsed` at this point — that's fixed in Tasks 2-3, and since
these are plain JSON API responses with no shared type, it won't surface as a
compile error here).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/accounts/route.ts src/app/api/v1/accounts/summary/route.ts
git commit -m "refactor(wallet): drop dead cycleUsed/creditUsed fields from accounts APIs"
```

---

### Task 2: `/accounts` list — switch CC row to all-time outstanding

**Files:**
- Modify: `src/app/(app)/accounts/page.tsx`

- [ ] **Step 1: Remove `cycleUsed` from the `Account` interface**

Replace:

```ts
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
```

with:

```ts
interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  initialBalance: number;
  creditLimit: number | null;
  statementDay: number | null;
  isDefault: boolean;
}
```

- [ ] **Step 2: Use `Math.max(0, -acc.balance)` for "ใช้ไป" and the progress bar**

Replace:

```tsx
              {acc.type === "CREDIT_CARD" && acc.creditLimit ? (
                <div className="text-right">
                  <p className="text-[13px] text-muted-foreground">
                    ใช้ไป{" "}
                    <span className="text-[#FF3B30] font-semibold">
                      {formatCurrency(acc.cycleUsed ?? 0)}
                    </span>
                  </p>
                  <div className="mt-1 w-28 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#FF3B30] rounded-full"
                      style={{ width: `${Math.min(100, ((acc.cycleUsed ?? 0) / acc.creditLimit) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    วงเงิน {formatCurrency(acc.creditLimit)}
                  </p>
                </div>
              ) : (
```

with:

```tsx
              {acc.type === "CREDIT_CARD" && acc.creditLimit ? (
                <div className="text-right">
                  <p className="text-[13px] text-muted-foreground">
                    ใช้ไป{" "}
                    <span className="text-[#FF3B30] font-semibold">
                      {formatCurrency(Math.max(0, -acc.balance))}
                    </span>
                  </p>
                  <div className="mt-1 w-28 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#FF3B30] rounded-full"
                      style={{ width: `${Math.min(100, (Math.max(0, -acc.balance) / acc.creditLimit) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    วงเงิน {formatCurrency(acc.creditLimit)}
                  </p>
                </div>
              ) : (
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no `cycleUsed` references remain in this file).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/accounts/page.tsx"
git commit -m "fix(wallet): /accounts CC row shows all-time outstanding instead of cycle-used"
```

---

### Task 3: Dashboard — switch lower wallet card to `creditOutstanding`

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Remove `creditUsed` from the `walletSummary` state type**

Around line 654, replace:

```ts
  const [walletSummary, setWalletSummary] = useState<{
    liquidTotal: number;
    creditUsed: number;
    creditLimit: number;
    creditOutstanding: number;
    hasCreditCards: boolean;
  } | null>(null);
```

with:

```ts
  const [walletSummary, setWalletSummary] = useState<{
    liquidTotal: number;
    creditLimit: number;
    creditOutstanding: number;
    hasCreditCards: boolean;
  } | null>(null);
```

- [ ] **Step 2: Display `creditOutstanding` instead of `creditUsed`**

Around line 898, replace:

```tsx
            {walletSummary.hasCreditCards && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต</span>
                <span className="text-[13px] font-semibold tabular-nums text-[#FF3B30]">
                  {formatCurrency(walletSummary.creditUsed)}
                  {" / "}
                  {formatCurrency(walletSummary.creditLimit)}
                </span>
              </div>
            )}
```

with:

```tsx
            {walletSummary.hasCreditCards && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต</span>
                <span className="text-[13px] font-semibold tabular-nums text-[#FF3B30]">
                  {formatCurrency(walletSummary.creditOutstanding)}
                  {" / "}
                  {formatCurrency(walletSummary.creditLimit)}
                </span>
              </div>
            )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (The separate `walletSummary` prop type used by `BalanceHero`
at line 118 already has no `creditUsed`/`creditLimit` — untouched, do not
edit it.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "fix(wallet): dashboard wallet card shows all-time creditOutstanding instead of creditUsed"
```

---

### Task 4: `TransferForm` — add `defaultToAccountId` prop

**Files:**
- Modify: `src/components/forms/transfer-form.tsx`

- [ ] **Step 1: Add the prop to `TransferFormProps`**

Replace:

```ts
interface TransferFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultFromAccountId?: string;
}
```

with:

```ts
interface TransferFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultFromAccountId?: string;
  defaultToAccountId?: string;
}
```

- [ ] **Step 2: Destructure the prop and seed `toAccountId`'s default value**

Replace:

```tsx
export function TransferForm({ open, onClose, onSuccess, defaultFromAccountId }: TransferFormProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: defaultFromAccountId ?? "",
      toAccountId: "",
      amount: undefined,
      date: todayString(),
      note: "",
    },
  });
```

with:

```tsx
export function TransferForm({ open, onClose, onSuccess, defaultFromAccountId, defaultToAccountId }: TransferFormProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: defaultFromAccountId ?? "",
      toAccountId: defaultToAccountId ?? "",
      amount: undefined,
      date: todayString(),
      note: "",
    },
  });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/transfer-form.tsx
git commit -m "feat(wallet): TransferForm accepts defaultToAccountId prop"
```

---

### Task 5: `/accounts/[id]` — pay-credit-card button

**Files:**
- Modify: `src/app/(app)/accounts/[id]/page.tsx`

- [ ] **Step 1: Relabel the transfer button for credit-card accounts**

Replace:

```tsx
      {/* Transfer button */}
      <Button
        variant="secondary"
        className="w-full gap-2"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-4 w-4" />
        โอนออก
      </Button>
```

with:

```tsx
      {/* Transfer / pay button */}
      <Button
        variant="secondary"
        className="w-full gap-2"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-4 w-4" />
        {isCreditCard ? "ชำระบัตรเครดิต" : "โอนออก"}
      </Button>
```

- [ ] **Step 2: Pass `defaultToAccountId` for credit cards, `defaultFromAccountId` otherwise**

Replace:

```tsx
      <TransferForm
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={load}
        defaultFromAccountId={account.id}
      />
```

with:

```tsx
      <TransferForm
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={load}
        {...(isCreditCard
          ? { defaultToAccountId: account.id }
          : { defaultFromAccountId: account.id })}
      />
```

- [ ] **Step 3: Type-check and lint all touched files**

Run: `npx tsc --noEmit`
Expected: clean, zero errors.

Run: `npx eslint src/app/api/v1/accounts/route.ts src/app/api/v1/accounts/summary/route.ts "src/app/(app)/accounts/page.tsx" "src/app/(app)/accounts/[id]/page.tsx" "src/app/(app)/dashboard/page.tsx" src/components/forms/transfer-form.tsx`
Expected: clean (or only pre-existing unrelated warnings in
`dashboard/page.tsx`, per sub-project A's notes — do not introduce new ones).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/accounts/[id]/page.tsx"
git commit -m "feat(wallet): add ชำระบัตรเครดิต button on credit card detail page"
```

---

### Task 6: End-to-end verification (Playwright, fixture account)

**Files:**
- Create (throwaway, not committed): `/tmp/run-check/wallet-cc-phase2b-check.mjs`

- [ ] **Step 1: Start a temporary dev server on a free port**

Run: `npm run dev -- -p 3001` (in background/separate terminal — do not touch
the production container on :3000).

- [ ] **Step 2: Write the verification script**

Create `/tmp/run-check/wallet-cc-phase2b-check.mjs`:

```js
// Wallet/CC Phase 2B: outstanding-balance display fix + pay-CC flow
// Expect ALL assertions PASS post-impl.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3001';
const OUT_DIR = '/tmp/run-check';
const ts = Date.now();
const U = { email: `phase2b-${ts}@test.local`, password: 'Phase2bCheck123!', name: 'Phase2B Check' };

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 } })).newPage();

async function register(p, u) {
  await p.goto(`${BASE}/register`);
  await p.fill('input[name="name"]', u.name);
  await p.fill('input[name="email"]', u.email);
  await p.fill('input[name="password"]', u.password);
  await p.fill('input[name="confirmPassword"]', u.password);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(1200);
  return p.url().includes('/dashboard');
}

async function api(method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }, { method, path, body });
}

console.log('Registering test user...');
if (!(await register(page, U))) throw new Error('register failed');
console.log('Registered:', U.email);

const accountsRes = await api('GET', '/api/v1/accounts');
const cash = accountsRes.json.data.find((a) => a.type === 'CASH');
const cc = accountsRes.json.data.find((a) => a.type === 'CREDIT_CARD');
if (!cash || !cc) throw new Error('starter accounts missing');
console.log('CASH:', cash.id, '/ CC:', cc.id);

// [precond] cycleUsed must be GONE from the response shape
console.log('\n[0] cycleUsed removed from /api/v1/accounts response:',
  cash.cycleUsed === undefined && cc.cycleUsed === undefined ? 'PASS' : 'FAIL');

await api('PATCH', `/api/v1/accounts/${cash.id}`, { initialBalance: 1000 });
await api('PATCH', `/api/v1/accounts/${cc.id}`, { creditLimit: 10000, statementDay: 5 });

const catsRes = await api('GET', '/api/v1/categories?type=EXPENSE');
const cat = catsRes.json.data[0];
const today = new Date().toISOString().slice(0, 10);

console.log('\n[setup] EXPENSE ฿500 on credit card...');
await api('POST', '/api/v1/transactions', {
  type: 'EXPENSE', amount: 500, date: today, categoryId: cat.id, accountId: cc.id,
});

// [1] /accounts list shows ใช้ไป ฿500 for CC row
console.log('\n[1] /accounts list after ฿500 CC expense...');
await page.goto(`${BASE}/accounts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT_DIR}/p2b-1-accounts-before.png`, fullPage: true });
let bodyText = await page.locator('body').innerText();
console.log('    [1] "ใช้ไป" shows 500.00:', bodyText.includes('500.00') ? 'PASS' : 'FAIL');

// [2] /accounts/[id] for the CC: button reads "ชำระบัตรเครดิต", opens TransferForm with destination pre-selected
console.log('\n[2] /accounts/[id] CC detail page...');
await page.goto(`${BASE}/accounts/${cc.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
const payBtn = page.locator('button:has-text("ชำระบัตรเครดิต")');
console.log('    [2a] "ชำระบัตรเครดิต" button present:', (await payBtn.count()) > 0 ? 'PASS' : 'FAIL');
await payBtn.click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/p2b-2-transferform.png`, fullPage: true });
const toSelectText = await page.locator('text=ไปยังบัญชี').locator('..').innerText().catch(() => '');
console.log('    [2b] destination select shows CC name:', toSelectText.includes('บัตรเครดิต') ? 'PASS' : `FAIL (${toSelectText})`);

// [3] Submit ฿300 payment CASH -> CC via the opened form
console.log('\n[3] Submit ฿300 payment via TransferForm...');
const fromSelect = page.locator('text=จากบัญชี').locator('..').locator('button[role="combobox"]');
await fromSelect.click();
await page.waitForTimeout(300);
await page.locator(`[role="option"]:has-text("เงินสด")`).first().click();
await page.fill('input[type="number"]', '300');
await page.click('button[type="submit"]:has-text("ยืนยันโอน")');
await page.waitForTimeout(1000);

// [4] /accounts list "ใช้ไป" now ฿200
console.log('\n[4] /accounts list after ฿300 payment...');
await page.goto(`${BASE}/accounts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT_DIR}/p2b-3-accounts-after.png`, fullPage: true });
bodyText = await page.locator('body').innerText();
console.log('    [4] "ใช้ไป" now shows 200.00:', bodyText.includes('200.00') ? 'PASS' : `FAIL (no 200.00 found)`);

// [5] Dashboard lower กระเป๋าเงิน card "ใช้ไป" also ฿200, and ยอดบัตรเครดิตค้างจ่าย also ฿200
console.log('\n[5] Dashboard wallet card + BalanceHero...');
await page.goto(`${BASE}/dashboard`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT_DIR}/p2b-4-dashboard.png`, fullPage: true });
bodyText = await page.locator('body').innerText();
console.log('    [5a] dashboard shows 200.00 (wallet card creditOutstanding):', bodyText.includes('200.00') ? 'PASS' : 'FAIL');
const heroBlock = page.locator('p:has-text("คงเหลือสุทธิ")').locator('..');
const heroText = await heroBlock.innerText().catch(() => '(not found)');
console.log('    [5b] คงเหลือสุทธิ shows 700 (unaffected):', heroText.includes('700') ? 'PASS' : `FAIL (${heroText})`);

await browser.close();
console.log('\nDone. fixture email (for cleanup):', U.email);
```

- [ ] **Step 3: Run the script**

Run: `node /tmp/run-check/wallet-cc-phase2b-check.mjs`
Expected: `[0]` through `[5b]` all print `PASS`. If `[1]` or `[4]` fail, check
that `Math.max(0, -acc.balance)` was wired correctly in Task 2. If `[5a]`
fails, check Task 3. If `[2a]`/`[2b]` fail, check Tasks 4-5.

- [ ] **Step 4: Clean up the fixture user**

Run (replace `<email>` with the printed fixture email):

```bash
docker compose exec -T db psql -U postgres -d finance_tracker -c \
  "DELETE FROM users WHERE email = '<email>';"
```

(Adjust container/db name if local dev DB differs — check
`docker-compose.override.yml` / `.env` for `DATABASE_URL`.)

- [ ] **Step 5: Stop the temporary dev server**

Kill the `npm run dev -- -p 3001` process started in Step 1.

- [ ] **Step 6: Final commit (if any cleanup-only changes)**

No source changes expected in this task — if all 5 prior tasks' commits are
in place and `git status` is clean, nothing to commit here. This task is
verification-only.

---

## Self-Review Notes

- **Spec coverage:** Items 1-2 (display fix, both surfaces) → Tasks 1-3.
  Item 2 (pay button) → Tasks 4-5. `getCycleStart` retained → confirmed not
  removed from `src/lib/utils.ts` (no task touches that file). Verification
  plan's 8 steps → covered by Task 6's script (steps 1-2 = setup/registration,
  3 = `[setup]` EXPENSE, 4 = `[2a]/[2b]`, 5 = `[3]` submit, 6 = `[4]`, 7 =
  `[5a]`, 8 = `[5b]`).
- **Placeholder scan:** none — every step has literal code/diffs/commands.
- **Type consistency:** `walletSummary` shape (`liquidTotal`, `creditLimit`,
  `creditOutstanding`, `hasCreditCards`) matches across Task 1 (API response),
  Task 3 (frontend state type + usage). `Account` interface in Task 2 matches
  Task 1's API response shape (no `cycleUsed` in either). `TransferFormProps`
  in Task 4 matches Task 5's usage (`defaultToAccountId`/`defaultFromAccountId`
  both optional, used mutually exclusively via spread).

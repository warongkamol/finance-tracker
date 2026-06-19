# Wallet/CC Phase 2C-3b: Manual Interest Rate, Debt Traceability & Undo Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three sections of the C-3 spec deferred from Plan 1 — (B) an optional, informational `interestRate` field on the manual debt-creation form, (E) a "แปลงมาจากรายการ" traceability section on `/debts/[id]` listing the original transactions a converted debt came from, and (F) a `POST /api/v1/debts/[id]/unconvert` endpoint + UI button to undo a conversion before any installment is paid.

**Architecture:** No new schema/migration — `Debt.interestRate` and `Transaction.convertedToDebtId`/`Debt.convertedTransactions` already exist (from C-3 schema + Plan 1). All three sections are additive reads/writes on existing tables. `createDebtSchema` gains `interestRate` (flows into `updateDebtSchema` automatically via `.partial()`). `GET /api/v1/debts/[id]` gains a `convertedTransactions` relation include. One new route file for unconvert.

**Tech Stack:** Next.js App Router API routes, Prisma/Postgres, Zod validation, React Hook Form, Tailwind, Playwright e2e.

---

## Part 1 — What's being built and why

### Section B — manual interest rate (informational only)

Today `DebtForm` (`src/components/forms/debt-form.tsx`) has no interest field, even though `Debt.interestRate` (`Decimal(5,2)`) has existed in the schema since C-3's migration and is already given a concrete meaning by Plan 1: **always stored as a monthly flat rate** (e.g. `1.50` = 1.5%/month).

For a *manually created* debt (e.g. a long-term bank loan the user already knows the monthly payment for), `interestRate` is **purely informational** — it does NOT recompute `totalAmount`/`monthlyAmount`. Those stay exactly as the user enters them today. The field just lets the user record "this loan carries 1.5%/month" for display on `/debts/[id]`.

The UI is a number input + a ต่อเดือน/ต่อปี (monthly/annual) toggle — annual input is divided by 12 client-side before submit, so the API and DB only ever see a monthly rate. This is the **same interaction pattern** `ConvertToInstallmentDialog` already built for PRO users in Plan 1 (`rateValue`/`rateUnit` state, `rateUnit === "year" ? val/12 : val`). Per Plan 1's explicit note, that dialog's rate UI was built **inline, not as a shared component**, deferring the "should this be shared" decision to this plan. With only two call sites and each form having its own local-state wiring around the input (the dialog recomputes `totalAmount` live; `DebtForm` does not), extracting a shared component now would add an abstraction layer for ~25 lines of near-identical-but-not-identical JSX. This plan keeps the same inline pattern in `DebtForm` — if a third call site ever appears, that's the trigger to extract.

**Schema/validation:** `createDebtSchema` gains `interestRate: z.number().min(0).max(99.99).nullable().optional()`. `updateDebtSchema = createDebtSchema.partial().extend({status...})` picks this up automatically — no separate edit needed there. `POST /api/v1/debts` persists it (`interestRate: interestRate ?? null`). There is no "edit existing debt" UI in this codebase (`DebtForm` is create-only, confirmed by grep — its only usage is the "เพิ่มรายการผ่อนชำระ" sheet on `/debts`), so `PUT /api/v1/debts/[id]` is intentionally left untouched.

**Display:** `/debts/[id]` already receives the full `Debt` row via `prisma.debt.findFirst` without a `select` — Prisma returns all scalars (including `interestRate`) by default regardless of the `include` block's contents (the same convention noted for C-2). So no API change is needed for *display* — just add `interestRate: string | null` to the page's `Debt` TS interface and render "ดอกเบี้ย {rate}% ต่อเดือน" when set and `> 0`.

### Section E — traceability ("แปลงมาจากรายการ")

`Transaction.convertedToDebtId` / `Debt.convertedTransactions` (the relation, added in Plan 1's schema task) is a **relation**, so unlike scalars it is NOT returned unless explicitly included. `GET /api/v1/debts/[id]` (`src/app/api/v1/debts/[id]/route.ts`) gains:

```ts
convertedTransactions: {
  select: { id: true, date: true, description: true, amount: true,
            category: { select: { id: true, name: true } } },
  orderBy: { date: "asc" },
}
```

`/debts/[id]` renders a new read-only section below the existing "ตารางผ่อนชำระ" (payment schedule) card, shown only when `convertedTransactions.length > 0`. Each row: category name, date + description, amount. No link back to `/transactions` (per spec — the originals aren't separately actionable from here).

### Section F — undo conversion

New `POST /api/v1/debts/[id]/unconvert`. Allowed only when **all** of:
- `convertedTransactions.length > 0` (it actually came from a conversion)
- `paidCount === 0` (no `DebtPayment` has `status === "PAID"`)
- `debt.status === "ACTIVE"`

Otherwise `400 { code: "CANNOT_UNCONVERT", message: "ไม่สามารถยกเลิกการแปลงได้" }`. On success: `updateMany` the linked transactions back to `convertedToDebtId: null`, then `prisma.debt.delete` — `DebtPayment.debt` and `BudgetItem.debt` are both `onDelete: Cascade`, so the generated payments and LIABILITY budget items disappear automatically (same cascade `DELETE /api/v1/debts/[id]` already relies on for hard-delete).

`/debts/[id]` shows a **"ยกเลิกการแปลง"** button + confirm dialog (same `Dialog`/`DialogFooter` pattern as the existing delete confirm) inside the new "แปลงมาจากรายการ" section, gated on `convertedTransactions.length > 0 && paidCount === 0` (mirrors the backend's first two conditions — `status === "ACTIVE"` is implicit since a non-ACTIVE debt's page doesn't show the pay-button row either, but this plan doesn't add an extra check for it since `paidCount === 0` already excludes the realistic "already cancelled with payments" cases the spec cares about). On success, `router.push("/debts")` (the debt row no longer exists — same as `handleDelete`'s hard-delete path).

### Constraints / out of scope

- No new migration. All three sections build on columns/relations that already exist on `main`.
- B's `interestRate` does not recompute anything for manually-created debts — only the *conversion* flow (Plan 1, already shipped) uses it in a formula.
- No "edit existing debt" flow is introduced — B is create-time only, matching `DebtForm`'s current scope.
- F's button visibility doesn't independently check `status === "ACTIVE"` (see above) — acceptable per spec's stated allowed-conditions, the backend is the source of truth regardless.

---

## Part 2 — Implementation Tasks

### Task 1: `interestRate` — validation schema + `POST /api/v1/debts` persistence

**Files:**
- Modify: `src/lib/validations/debt.ts`
- Modify: `src/app/api/v1/debts/route.ts`

- [ ] **Step 1: Add `interestRate` to `createDebtSchema`**

In `src/lib/validations/debt.ts`, change:

```ts
  familyGroupId: z.string().min(1).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
});
```

to:

```ts
  familyGroupId: z.string().min(1).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
  interestRate: z
    .number()
    .min(0, "อัตราดอกเบี้ยต้องไม่ติดลบ")
    .max(99.99, "อัตราดอกเบี้ยเกินขีดจำกัด")
    .nullable()
    .optional(),
});
```

`updateDebtSchema` is `createDebtSchema.partial().extend({...})` — it picks up the new optional field automatically, no separate edit needed.

- [ ] **Step 2: Persist `interestRate` in `POST /api/v1/debts`**

In `src/app/api/v1/debts/route.ts`, change:

```ts
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId, accountId } = parsed.data;
```

to:

```ts
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId, accountId, interestRate } = parsed.data;
```

Then in the `tx.debt.create({ data: {...} })` block, change:

```ts
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          startDate: start,
          endDate: end,
```

to:

```ts
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          interestRate: interestRate ?? null,
          startDate: start,
          endDate: end,
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validations/debt.ts src/app/api/v1/debts/route.ts
git commit -m "feat(debts): accept and persist optional interestRate on manual debt creation"
```

---

### Task 2: `DebtForm` — interest rate input + ต่อเดือน/ต่อปี toggle

**Files:**
- Modify: `src/components/forms/debt-form.tsx`

- [ ] **Step 1: Add local state for the rate input**

After the existing state declarations (after `const [creditAccounts, setCreditAccounts] = useState<CreditAccount[]>([]);`), add:

```ts
  const [interestValue, setInterestValue] = useState("0");
  const [interestUnit, setInterestUnit] = useState<"month" | "year">("month");
```

- [ ] **Step 2: Compute monthly rate and include in submit payload**

Change:

```ts
  async function onSubmit(data: CreateDebtInput) {
    setServerError("");
    try {
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        isFamily,
        familyGroupId: isFamily ? familyGroupId : null,
      };
```

to:

```ts
  async function onSubmit(data: CreateDebtInput) {
    setServerError("");
    try {
      const rateValueNum = parseFloat(interestValue) || 0;
      const monthlyRate = interestUnit === "year" ? rateValueNum / 12 : rateValueNum;
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        interestRate: monthlyRate > 0 ? monthlyRate : null,
        isFamily,
        familyGroupId: isFamily ? familyGroupId : null,
      };
```

- [ ] **Step 3: Add the input + toggle UI**

After the "ผ่อนผ่านบัญชี (ถ้ามี)" `FormRow` block (ends with the closing `</Select>` then `</FormRow>` right before the `{/* Family toggle ... */}` comment), insert a new `FormRow`:

```tsx
        <FormRow label="อัตราดอกเบี้ย (ไม่บังคับ)">
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0"
              className={cn(fieldClass, "flex-1")}
              value={interestValue}
              onChange={(e) => setInterestValue(e.target.value)}
            />
            <div className="ios-card p-1 grid grid-cols-2 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setInterestUnit("month")}
                className={cn("px-3 h-9 rounded-lg text-[13px] font-medium", interestUnit === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                ต่อเดือน
              </button>
              <button
                type="button"
                onClick={() => setInterestUnit("year")}
                className={cn("px-3 h-9 rounded-lg text-[13px] font-medium", interestUnit === "year" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                ต่อปี
              </button>
            </div>
          </div>
        </FormRow>
```

So the resulting order in the card is: ชื่อรายการ → จำนวนงวด → custom-monthly toggle → วันที่เริ่มต้นจ่าย → หมายเหตุ → ผ่อนผ่านบัญชี → **อัตราดอกเบี้ย (new)** → family toggle (if applicable).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/debt-form.tsx
git commit -m "feat(debts): add optional interest-rate input with monthly/annual toggle to DebtForm"
```

---

### Task 3: `GET /api/v1/debts/[id]` — include `convertedTransactions`

**Files:**
- Modify: `src/app/api/v1/debts/[id]/route.ts`

- [ ] **Step 1: Add `convertedTransactions` to the `include` block**

Change:

```ts
    const debt = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
      include: {
        account: { select: { id: true, name: true } },
        payments: {
          include: { transaction: { select: { id: true } } },
          orderBy: { installmentNo: "asc" },
        },
      },
    });
```

to:

```ts
    const debt = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
      include: {
        account: { select: { id: true, name: true } },
        payments: {
          include: { transaction: { select: { id: true } } },
          orderBy: { installmentNo: "asc" },
        },
        convertedTransactions: {
          select: {
            id: true,
            date: true,
            description: true,
            amount: true,
            category: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
      },
    });
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/debts/[id]/route.ts
git commit -m "feat(api): include convertedTransactions in debt detail response"
```

---

### Task 4: `POST /api/v1/debts/[id]/unconvert`

**Files:**
- Create: `src/app/api/v1/debts/[id]/unconvert/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
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
    const debt = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
      include: {
        convertedTransactions: { select: { id: true } },
        payments: { select: { status: true } },
      },
    });

    if (!debt) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการหนี้สิน" } },
        { status: 404 }
      );
    }

    const paidCount = debt.payments.filter((p) => p.status === "PAID").length;
    if (debt.convertedTransactions.length === 0 || paidCount > 0 || debt.status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, error: { code: "CANNOT_UNCONVERT", message: "ไม่สามารถยกเลิกการแปลงได้" } },
        { status: 400 }
      );
    }

    const transactionIds = debt.convertedTransactions.map((t) => t.id);

    await prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: { id: { in: transactionIds } },
        data: { convertedToDebtId: null },
      });
      await tx.debt.delete({ where: { id } });
    });

    return NextResponse.json({ success: true, data: { unconverted: true } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/debts/[id]/unconvert/route.ts
git commit -m "feat(api): add POST /api/v1/debts/[id]/unconvert endpoint"
```

---

### Task 5: `/debts/[id]` page — interest display, traceability section, undo button

**Files:**
- Modify: `src/app/(app)/debts/[id]/page.tsx`

**Depends on:** Task 3 (`convertedTransactions` in the GET response) and Task 4 (`/unconvert` endpoint).

- [ ] **Step 1: Add `ConvertedTransaction` interface and extend `Debt`**

Change:

```ts
interface Debt {
  id: string;
  name: string;
  totalAmount: string;
  monthlyAmount: string;
  totalMonths: number;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  account: { id: string; name: string } | null;
  payments: DebtPayment[];
  paidCount: number;
  remainingBalance: number;
}
```

to:

```ts
interface ConvertedTransaction {
  id: string;
  date: string;
  description: string | null;
  amount: string;
  category: { id: string; name: string } | null;
}

interface Debt {
  id: string;
  name: string;
  totalAmount: string;
  monthlyAmount: string;
  totalMonths: number;
  interestRate: string | null;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  account: { id: string; name: string } | null;
  payments: DebtPayment[];
  convertedTransactions: ConvertedTransaction[];
  paidCount: number;
  remainingBalance: number;
}
```

- [ ] **Step 2: Add unconvert state + handler**

After the existing state declarations:

```ts
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
```

add:

```ts
  const [unconvertDialogOpen, setUnconvertDialogOpen] = useState(false);
  const [unconvertLoading, setUnconvertLoading] = useState(false);
```

After `handleDelete`'s closing brace, add:

```ts
  async function handleUnconvert() {
    setUnconvertLoading(true);
    try {
      const res = await fetch(`/api/v1/debts/${id}/unconvert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if ((await res.json()).success) router.push("/debts");
    } finally {
      setUnconvertLoading(false);
    }
  }
```

- [ ] **Step 3: Show "ดอกเบี้ย X% ต่อเดือน" (Section B)**

In the summary card, change:

```tsx
        {debt.notes && (
          <p className="text-[13px] text-muted-foreground">{debt.notes}</p>
        )}

        {debt.account && (
```

to:

```tsx
        {debt.notes && (
          <p className="text-[13px] text-muted-foreground">{debt.notes}</p>
        )}

        {debt.interestRate && Number(debt.interestRate) > 0 && (
          <p className="text-[13px] text-muted-foreground">ดอกเบี้ย {Number(debt.interestRate)}% ต่อเดือน</p>
        )}

        {debt.account && (
```

- [ ] **Step 4: Add "แปลงมาจากรายการ" section + undo button (Sections E + F)**

The payment-schedule section currently ends with:

```tsx
        <div className="ios-card overflow-hidden divide-y divide-border">
          {debt.payments.map((payment) => (
            ...
          ))}
        </div>
      </div>

      {/* Confirm pay */}
```

Insert a new block between the payment-schedule `</div>` (the outer one, closing the `space-y-2` wrapper) and the `{/* Confirm pay */}` comment:

```tsx
        <div className="ios-card overflow-hidden divide-y divide-border">
          {debt.payments.map((payment) => (
            ...
          ))}
        </div>
      </div>

      {/* Converted-from transactions */}
      {debt.convertedTransactions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">แปลงมาจากรายการ</p>
          <div className="ios-card overflow-hidden divide-y divide-border">
            {debt.convertedTransactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate">{t.category?.name ?? "อื่นๆ"}</p>
                  <p className="text-[12px] text-muted-foreground truncate">
                    {formatShortDate(t.date)}{t.description ? ` · ${t.description}` : ""}
                  </p>
                </div>
                <p className="text-[14px] font-semibold tabular-nums shrink-0">{formatCurrency(Number(t.amount))}</p>
              </div>
            ))}
          </div>

          {debt.paidCount === 0 && (
            <Button variant="secondary" className="w-full" onClick={() => setUnconvertDialogOpen(true)}>
              ยกเลิกการแปลง
            </Button>
          )}
        </div>
      )}

      {/* Confirm pay */}
```

(`...` above represents the existing, unchanged `payment.map` body — do not rewrite it.)

- [ ] **Step 5: Add the unconvert confirm dialog**

After the existing "Delete dialog" `</Dialog>` (the last element before the page's closing `</div>`), add:

```tsx
      {/* Unconvert dialog */}
      <Dialog open={unconvertDialogOpen} onOpenChange={setUnconvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยกเลิกการแปลงเป็นยอดผ่อน</DialogTitle>
            <DialogDescription>
              รายการเดิมจะกลับมานับในยอดรวมตามปกติ และรายการผ่อนนี้จะถูกลบทั้งหมด ยืนยันหรือไม่?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setUnconvertDialogOpen(false)} disabled={unconvertLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleUnconvert} disabled={unconvertLoading}>
              {unconvertLoading ? "กำลังดำเนินการ..." : "ยืนยัน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/debts/[id]/page.tsx"
git commit -m "feat(debts): show interest rate, converted-transactions section, and undo-conversion button on debt detail"
```

---

### Task 6: Playwright e2e verification

**Files:**
- Temporary: `/tmp/run-check/wallet-cc-phase2c3b-check.mjs` (write here first), copy to a project-root temp file (e.g. `tmp-e2e-phase2c3b.mjs`) to run since `node_modules` resolution for `playwright` requires running from under the project root, delete both after.

**Depends on:** Tasks 1-5 all complete. Run directly by the controller (not a subagent) — needs a live dev server.

- [ ] **Step 1: Start dev server**

```bash
NEXTAUTH_URL=http://localhost:3001 npm run dev -- -p 3001
```

(Run in background / separate terminal — `.env`'s `NEXTAUTH_URL=http://localhost:3000` would otherwise misdirect auth at the prod container on `:3000`.)

- [ ] **Step 2: Write the e2e script**

```js
// Wallet/CC Phase 2C-3b: interestRate on DebtForm, traceability, undo conversion
// Expect ALL assertions PASS.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3001';
const OUT_DIR = '/tmp/run-check';
const ts = Date.now();
const U = { email: `phase2c3b-${ts}@test.local`, password: 'Phase2c3bCheck123!', name: 'Phase2C3B Check' };

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
const cc = accountsRes.json.data.find((a) => a.type === 'CREDIT_CARD');
if (!cc) throw new Error('starter CC account missing');
console.log('CC account:', cc.id);

const catsRes = await api('GET', '/api/v1/categories?type=EXPENSE');
const cat = catsRes.json.data[0];
const today = new Date().toISOString().slice(0, 10);

// ===== Section B: interestRate on DebtForm =====

console.log('\n[B1] Create debt with annual interest rate 24% (-> 2%/month)...');
await page.goto(`${BASE}/debts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.click('button[aria-label="เพิ่มรายการผ่อน"]');
await page.waitForTimeout(400);
await page.fill('input[name="totalAmount"]', '12000');
await page.fill('input[name="name"]', 'ทดสอบดอกเบี้ย');
await page.fill('input[name="totalMonths"]', '12');
const interestInput = page.locator('xpath=//label[contains(text(),"อัตราดอกเบี้ย")]/following-sibling::div//input[@type="number"]');
await interestInput.fill('24');
await page.click('button:has-text("ต่อปี")');
await page.click('button:has-text("บันทึกหนี้สิน")');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);

let debtsRes = await api('GET', '/api/v1/debts');
const debtB1 = debtsRes.json.data.find((d) => d.name === 'ทดสอบดอกเบี้ย');
console.log('    [B1] interestRate === 2 (24%/yr -> 2%/mo):', Number(debtB1?.interestRate) === 2 ? 'PASS' : `FAIL (${debtB1?.interestRate})`);

console.log('\n[B2] /debts/[id] shows "ดอกเบี้ย 2% ต่อเดือน"...');
await page.goto(`${BASE}/debts/${debtB1.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(600);
let bodyText = await page.locator('body').innerText();
console.log('    [B2] text present:', bodyText.includes('ดอกเบี้ย 2% ต่อเดือน') ? 'PASS' : 'FAIL');

console.log('\n[B3] Create debt WITHOUT interest -> no "ดอกเบี้ย" line...');
await page.goto(`${BASE}/debts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.click('button[aria-label="เพิ่มรายการผ่อน"]');
await page.waitForTimeout(400);
await page.fill('input[name="totalAmount"]', '3000');
await page.fill('input[name="name"]', 'No Interest Test');
await page.fill('input[name="totalMonths"]', '3');
await page.click('button:has-text("บันทึกหนี้สิน")');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);

debtsRes = await api('GET', '/api/v1/debts');
const debtB3 = debtsRes.json.data.find((d) => d.name === 'No Interest Test');
console.log('    [B3] interestRate is null:', debtB3?.interestRate === null ? 'PASS' : `FAIL (${debtB3?.interestRate})`);
await page.goto(`${BASE}/debts/${debtB3.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(600);
bodyText = await page.locator('body').innerText();
console.log('    [B3] no "ดอกเบี้ย" text:', !bodyText.includes('ดอกเบี้ย') ? 'PASS' : 'FAIL');

// ===== Section E + F: traceability + undo conversion =====

console.log('\n[E1] Create CC expense tx, convert to installment (FREE, no interest)...');
const txARes = await api('POST', '/api/v1/transactions', {
  type: 'EXPENSE', amount: 900, date: today, categoryId: cat.id, accountId: cc.id, description: 'ทดสอบ E2E A',
});
const txA = txARes.json.data;
const convARes = await api('POST', '/api/v1/debts/convert', {
  transactionIds: [txA.id], totalMonths: 3, name: 'ผ่อนทดสอบ E',
});
console.log('    [E1] convert status 201:', convARes.status === 201 ? 'PASS' : `FAIL (${convARes.status})`);
const debtA = convARes.json.data.debt;

console.log('\n[E2] GET /api/v1/debts/[id] includes convertedTransactions...');
const debtARes = await api('GET', `/api/v1/debts/${debtA.id}`);
const convTx = debtARes.json.data.convertedTransactions;
console.log('    [E2] length === 1:', convTx?.length === 1 ? 'PASS' : `FAIL (${JSON.stringify(convTx)})`);
console.log('    [E2] matches original tx (id, amount, category):',
  convTx?.[0]?.id === txA.id && Number(convTx[0].amount) === 900 && convTx[0].category?.id === cat.id ? 'PASS' : 'FAIL');

console.log('\n[E3] /debts/[id] shows "แปลงมาจากรายการ" section...');
await page.goto(`${BASE}/debts/${debtA.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(600);
bodyText = await page.locator('body').innerText();
console.log('    [E3] section header present:', bodyText.includes('แปลงมาจากรายการ') ? 'PASS' : 'FAIL');
console.log('    [E3] tx amount "900.00" present:', bodyText.includes('900.00') ? 'PASS' : 'FAIL');
console.log('    [E3] category name present:', bodyText.includes(cat.name) ? 'PASS' : 'FAIL');

console.log('\n[F1] "ยกเลิกการแปลง" button visible when paidCount===0...');
console.log('    [F1] button visible:', bodyText.includes('ยกเลิกการแปลง') ? 'PASS' : 'FAIL');

console.log('\n[F2] Click undo -> confirm -> debt deleted, tx reverted...');
await page.click('button:has-text("ยกเลิกการแปลง")');
await page.waitForTimeout(300);
await page.click('button:has-text("ยืนยัน")');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
console.log('    [F2] redirected to /debts:', page.url().endsWith('/debts') ? 'PASS' : `FAIL (${page.url()})`);

const debtAAfter = await api('GET', `/api/v1/debts/${debtA.id}`);
console.log('    [F2] debt no longer found:', debtAAfter.json?.success === false ? 'PASS' : `FAIL (${JSON.stringify(debtAAfter.json)})`);

const txsRes = await api('GET', '/api/v1/transactions');
const txAAfter = txsRes.json.data.find((t) => t.id === txA.id);
console.log('    [F2] tx convertedToDebtId is null again:', txAAfter?.convertedToDebtId === null ? 'PASS' : `FAIL (${txAAfter?.convertedToDebtId})`);

console.log('\n[F3] Negative case: convert + pay installment#1 -> undo not allowed...');
const txBRes = await api('POST', '/api/v1/transactions', {
  type: 'EXPENSE', amount: 600, date: today, categoryId: cat.id, accountId: cc.id, description: 'ทดสอบ E2E B',
});
const txB = txBRes.json.data;
const convBRes = await api('POST', '/api/v1/debts/convert', {
  transactionIds: [txB.id], totalMonths: 1, name: 'ผ่อนทดสอบ F-neg',
});
const debtB = convBRes.json.data.debt;
const payment1 = debtB.payments[0];
await api('POST', `/api/v1/debts/${debtB.id}/payments/${payment1.id}/pay`, {});

await page.goto(`${BASE}/debts/${debtB.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(600);
bodyText = await page.locator('body').innerText();
console.log('    [F3] "แปลงมาจากรายการ" still shown:', bodyText.includes('แปลงมาจากรายการ') ? 'PASS' : 'FAIL');
console.log('    [F3] "ยกเลิกการแปลง" button ABSENT (paidCount>0):', !bodyText.includes('ยกเลิกการแปลง') ? 'PASS' : 'FAIL');

const unconvBRes = await api('POST', `/api/v1/debts/${debtB.id}/unconvert`, {});
console.log('    [F3] unconvert API rejects (400):', unconvBRes.status === 400 ? 'PASS' : `FAIL (${unconvBRes.status})`);

await browser.close();
console.log('\nDone. fixture email (for cleanup):', U.email);
```

- [ ] **Step 3: Run the script**

```bash
cp /tmp/run-check/wallet-cc-phase2c3b-check.mjs ./tmp-e2e-phase2c3b.mjs
node tmp-e2e-phase2c3b.mjs
```

Expected: every line ends `PASS`. If any `FAIL`, fix the relevant Task and re-run (re-run will register a fresh fixture user each time since `U.email` is timestamp-based — no manual cleanup needed between retries).

- [ ] **Step 4: Clean up**

```bash
rm ./tmp-e2e-phase2c3b.mjs /tmp/run-check/wallet-cc-phase2c3b-check.mjs
docker exec finance-db psql -U finance -d finance_tracker -c "DELETE FROM users WHERE email LIKE 'phase2c3b-%@test.local'"
```

Stop the dev server (`:3001`).

- [ ] **Step 5: Final whole-plan check**

```bash
npx tsc --noEmit
```

Expected: clean (matches the rest of `main`).

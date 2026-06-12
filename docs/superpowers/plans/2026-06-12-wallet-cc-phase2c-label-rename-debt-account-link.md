# Wallet/CC Phase 2C-1: Label Rename + Debt↔Account Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden the `AccountType.CREDIT_CARD` Thai label from "บัตรเครดิต" to "บัตรเครดิต/สินเชื่อ" across 6 UI strings, and add an optional `Debt.accountId` FK so a manually-created installment debt can be tagged with the credit-card/loan account it's billed through.

**Architecture:** Pure additive change — one new nullable FK column (`debts.account_id`) plus a back-relation array on `Account`, a new optional Zod field on `createDebtSchema`, an ownership+type check in `POST /api/v1/debts` mirroring the existing `Transaction.accountId` pattern, `account: {id, name}` added to the two debt GET responses, a new `Select` in `DebtForm` restricted to `CREDIT_CARD`-type accounts, and a read-only "ผ่อนผ่าน: 💳 {name}" link on the debt detail page. The 6 label-rename sites are independent string edits.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (PostgreSQL), Zod, react-hook-form, shadcn/ui `Select`, Playwright (manual e2e script, no test framework).

---

## Part 1 — Overview (read this first)

### What is being built and why

This is sub-spec "1+2" of the larger sub-project C (converting credit-card expenses into tracked installment debts with tier-gated interest). Before that conversion flow can exist, two foundational pieces need to land:

1. **Label rename.** The `AccountType.CREDIT_CARD` enum value is displayed to users as "บัตรเครดิต" (literally "credit card") in 6 places. Most installment debts in this app are actually paid via a credit card, a bank loan, or a BNPL provider — not just a literal credit card. Renaming the displayed label to "บัตรเครดิต/สินเชื่อ" lets the same account type read naturally as "the account I owe money on / pay installments through" for all three cases. This is a **display-string-only** change — the enum value `CREDIT_CARD` itself, the seed default account name, and the unrelated legacy `PaymentMethod.type` label are untouched.

2. **`Debt.accountId` link.** `Debt` records currently have no way to reference which account they're billed through. Adding an optional `accountId` FK lets a user tag a manually-created debt (e.g. "ผ่อน iPhone ผ่านบัตร UOB") with the relevant `CREDIT_CARD`-type account, read-only/set-at-creation in this spec. This also lays the groundwork for the future "convert CC expense → Debt" flow (sub-spec C2), which will populate `accountId` automatically, and for a future "debts linked to this account" list on `/accounts/[id]` (sub-spec C3) — for which we add the `Account.debts` back-relation now even though no UI consumes it yet.

### Key design decisions

- **Single ambiguous 404, not a specific validation error.** When `accountId` is supplied to `POST /api/v1/debts`, one `findFirst({ id, userId, type: "CREDIT_CARD" })` check covers three failure modes — doesn't exist, belongs to another user, or exists but isn't a `CREDIT_CARD` account — all returning the same `404 NOT_FOUND "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ"`. This mirrors the existing `Transaction.accountId` ownership-check pattern (`transactions/route.ts`) and avoids leaking which accounts exist that the user can't link.
- **`updateDebtSchema` / `PUT /api/v1/debts/[id]` are NOT touched.** Grep confirmed the PUT route has zero frontend callers and `DebtForm` is create-only. Adding `accountId` to an unused update path would be dead code — retroactively linking existing debts is explicitly deferred to C2/C3 (no debt-edit UI exists).
- **Account picker scope = `CREDIT_CARD` type only.** The `DebtForm` dropdown fetches `/api/v1/accounts` and filters client-side to `type === "CREDIT_CARD"`. If the user has zero such accounts, the Select still renders with only "ไม่ระบุ" — no special-case empty state, matching other optional pickers in this codebase.
- **No reverse "debts linked to this account" UI yet.** `Account.debts Debt[]` back-relation is added purely so Prisma's client exposes the relation for C2/C3 — this task does not query or render it anywhere.

### Constraints and trade-offs

- One new migration (`add_debt_account_link`), additive only — all existing `Debt` rows get `accountId = NULL`, a valid permanent state (e.g. "ยืมเงินเพื่อน" has no linked account).
- **Layout risk:** "💳 บัตรเครดิต/สินเชื่อ" is ~4 chars longer than "💳 บัตรเครดิต" and appears in two compact pill/row contexts at mobile width (~430px) — the transaction-row pill tag and the dashboard wallet-card header. Task 9's e2e script takes screenshots of both for visual review; if either wraps/clips, the documented fallback is "💳 สินเชื่อ" for that pill only (not pre-applied — only if the screenshot shows a problem).
- No jest/vitest exists in this repo. Verification follows the established pattern from prior sub-projects: `npx tsc --noEmit` + an ad-hoc Playwright script under `/tmp/run-check/`, cleaned up after.

### Explicitly out of scope

- `src/lib/seed-defaults.ts:86` (`name: "บัตรเครดิต"`, the *default account name*, not a type label) and `src/components/forms/payment-method-form.tsx:30` (legacy `PaymentMethod.type` enum) — different concepts, left untouched.
- "Convert CC expense → Debt" flow, `User.tier` + interest calculation, reverse "หนี้ที่ผูกกับบัญชีนี้" list on `/accounts/[id]`, the deferred "ชำระยอดนี้" / "เปลี่ยนเป็นยอดผ่อน" buttons, and retroactive `accountId` linking for pre-existing debts — all sub-spec C2/C3, not this plan.

---

## Part 2 — Implementation Tasks

### Task 1: Database schema — `Debt.accountId` FK + `Account.debts` back-relation

**Files:**
- Modify: `prisma/schema.prisma:190-197` (Account model)
- Modify: `prisma/schema.prisma:311-324` (Debt model)
- Create: new migration via `prisma migrate dev`

- [ ] **Step 1: Add the back-relation to the `Account` model**

In `prisma/schema.prisma`, find:

```prisma
  transactions  Transaction[]
  recurringTxns RecurringTransaction[]
  transfersFrom Transfer[]   @relation("TransferFrom")
  transfersTo   Transfer[]   @relation("TransferTo")

  @@index([userId])
  @@map("accounts")
}
```

Replace with:

```prisma
  transactions  Transaction[]
  recurringTxns RecurringTransaction[]
  transfersFrom Transfer[]   @relation("TransferFrom")
  transfersTo   Transfer[]   @relation("TransferTo")
  debts         Debt[]

  @@index([userId])
  @@map("accounts")
}
```

- [ ] **Step 2: Add the `accountId` FK to the `Debt` model**

In `prisma/schema.prisma`, find:

```prisma
  status        DebtStatus   @default(ACTIVE)
  userId        String       @map("user_id")
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  payments    DebtPayment[]
  budgetItems BudgetItem[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([userId, status])
  @@index([familyGroupId])
  @@map("debts")
}
```

Replace with:

```prisma
  status        DebtStatus   @default(ACTIVE)
  userId        String       @map("user_id")
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  accountId     String?      @map("account_id")
  account       Account?     @relation(fields: [accountId], references: [id])

  payments    DebtPayment[]
  budgetItems BudgetItem[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([userId, status])
  @@index([familyGroupId])
  @@index([accountId])
  @@map("debts")
}
```

- [ ] **Step 3: Generate and apply the migration**

Run:

```bash
npx prisma migrate dev --name add_debt_account_link
```

Expected: a new `prisma/migrations/<timestamp>_add_debt_account_link/migration.sql` is created containing `ALTER TABLE "debts" ADD COLUMN "account_id" TEXT`, a `CREATE INDEX` on `account_id`, and an `ADD CONSTRAINT ... FOREIGN KEY ("account_id") REFERENCES "accounts"("id")`. The command also regenerates the Prisma client (`debt.accountId`, `debt.account`, `account.debts` become available in `@/generated/prisma/client`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add nullable Debt.accountId FK + Account.debts back-relation"
```

---

### Task 2: Validation schema — `accountId` on `createDebtSchema`

**Files:**
- Modify: `src/lib/validations/debt.ts:20-23`

- [ ] **Step 1: Add the `accountId` field**

In `src/lib/validations/debt.ts`, find:

```ts
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  notes: z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
});
```

Replace with:

```ts
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  notes: z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
});
```

(`updateDebtSchema` derives from `createDebtSchema.partial()` — no separate edit needed, and it is not used by any route per the design spec.)

- [ ] **Step 2: Commit**

```bash
git add src/lib/validations/debt.ts
git commit -m "feat(validation): add optional accountId to createDebtSchema"
```

---

### Task 3: `POST /api/v1/debts` — accountId ownership/type check + persist

**Files:**
- Modify: `src/app/api/v1/debts/route.ts:78-115`

- [ ] **Step 1: Destructure `accountId` from the parsed body**

In `src/app/api/v1/debts/route.ts`, find:

```ts
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId } = parsed.data;
```

Replace with:

```ts
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId, accountId } = parsed.data;
```

- [ ] **Step 2: Add the ownership/type check before `effectiveMonthly`**

In the same file, find:

```ts
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }

    const effectiveMonthly = monthlyAmount ?? totalAmount / totalMonths;
```

Replace with:

```ts
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }

    // accountId must reference a CREDIT_CARD/loan account owned by this user —
    // one check covers "doesn't exist", "belongs to another user", and "wrong type"
    if (accountId) {
      const acc = await prisma.account.findFirst({
        where: { id: accountId, userId: session.user.id, type: "CREDIT_CARD" },
      });
      if (!acc) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ" } },
          { status: 404 }
        );
      }
    }

    const effectiveMonthly = monthlyAmount ?? totalAmount / totalMonths;
```

- [ ] **Step 3: Persist `accountId` on create**

In the same file, find:

```ts
      const created = await tx.debt.create({
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          startDate: start,
          endDate: end,
          notes: notes ?? null,
          isFamily: isFamily ?? false,
          familyGroupId: isFamily ? (familyGroupId ?? null) : null,
          userId: session.user.id,
          status: "ACTIVE",
        },
      });
```

Replace with:

```ts
      const created = await tx.debt.create({
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          startDate: start,
          endDate: end,
          notes: notes ?? null,
          isFamily: isFamily ?? false,
          familyGroupId: isFamily ? (familyGroupId ?? null) : null,
          accountId: accountId ?? null,
          userId: session.user.id,
          status: "ACTIVE",
        },
      });
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/debts/route.ts
git commit -m "feat(api): validate + persist Debt.accountId on create"
```

---

### Task 4: GET routes — include linked account

**Files:**
- Modify: `src/app/api/v1/debts/route.ts:28-33` (GET list)
- Modify: `src/app/api/v1/debts/[id]/route.ts:22-27` (GET detail)

- [ ] **Step 1: Add `account` to the GET list `include`**

In `src/app/api/v1/debts/route.ts`, find:

```ts
      include: {
        payments: {
          select: { id: true, status: true, amount: true, dueDate: true, installmentNo: true },
          orderBy: { installmentNo: "asc" },
        },
      },
```

Replace with:

```ts
      include: {
        account: { select: { id: true, name: true } },
        payments: {
          select: { id: true, status: true, amount: true, dueDate: true, installmentNo: true },
          orderBy: { installmentNo: "asc" },
        },
      },
```

- [ ] **Step 2: Add `account` to the GET detail `include`**

In `src/app/api/v1/debts/[id]/route.ts`, find:

```ts
      include: {
        payments: {
          include: { transaction: { select: { id: true } } },
          orderBy: { installmentNo: "asc" },
        },
      },
```

Replace with:

```ts
      include: {
        account: { select: { id: true, name: true } },
        payments: {
          include: { transaction: { select: { id: true } } },
          orderBy: { installmentNo: "asc" },
        },
      },
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/debts/route.ts "src/app/api/v1/debts/[id]/route.ts"
git commit -m "feat(api): include linked account on debt list/detail responses"
```

---

### Task 5: `DebtForm` — account picker UI

**Files:**
- Modify: `src/components/forms/debt-form.tsx`

- [ ] **Step 1: Add `useEffect` import and `CreditAccount` interface**

In `src/components/forms/debt-form.tsx`, find:

```tsx
import { useState } from "react";
```

Replace with:

```tsx
import { useEffect, useState } from "react";
```

Then find:

```tsx
interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}
```

Replace with:

```tsx
interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}

interface CreditAccount {
  id: string;
  name: string;
  type: string;
}
```

- [ ] **Step 2: Fetch credit accounts on mount + wire `setValue`/defaults**

In the same file, find:

```tsx
export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false, familyGroups = [] }: DebtFormProps) {
  const [serverError, setServerError] = useState("");
  const [useCustomMonthly, setUseCustomMonthly] = useState(false);
  const [isFamily, setIsFamily] = useState(false);
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(null);

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CreateDebtInput>({
    resolver: zodResolver(createDebtSchema),
    defaultValues: { startDate: todayString(), totalMonths: 12 },
  });
```

Replace with:

```tsx
export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false, familyGroups = [] }: DebtFormProps) {
  const [serverError, setServerError] = useState("");
  const [useCustomMonthly, setUseCustomMonthly] = useState(false);
  const [isFamily, setIsFamily] = useState(false);
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(null);
  const [creditAccounts, setCreditAccounts] = useState<CreditAccount[]>([]);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<CreateDebtInput>({
    resolver: zodResolver(createDebtSchema),
    defaultValues: { startDate: todayString(), totalMonths: 12, accountId: null },
  });

  useEffect(() => {
    fetch("/api/v1/accounts")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setCreditAccounts(json.data.filter((a: CreditAccount) => a.type === "CREDIT_CARD"));
        }
      });
  }, []);
```

- [ ] **Step 3: Add the "ผ่อนผ่านบัญชี (ถ้ามี)" picker row**

In the same file, find:

```tsx
        <FormRow label="หมายเหตุ">
          <Input placeholder="เช่น บัตรกรุงไทย 0% ดอกเบี้ย" className={fieldClass} {...register("notes")} />
        </FormRow>
```

Replace with:

```tsx
        <FormRow label="หมายเหตุ">
          <Input placeholder="เช่น บัตรกรุงไทย 0% ดอกเบี้ย" className={fieldClass} {...register("notes")} />
        </FormRow>

        <FormRow label="ผ่อนผ่านบัญชี (ถ้ามี)">
          <Select
            value={watch("accountId") ?? "none"}
            onValueChange={(val) => setValue("accountId", val === "none" ? null : val, { shouldValidate: true })}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue placeholder="ไม่ระบุ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุ</SelectItem>
              {creditAccounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>💳 {acc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/debt-form.tsx
git commit -m "feat(debts): add credit-card/loan account picker to DebtForm"
```

---

### Task 6: Debt detail page — "ผ่อนผ่าน" linked-account row

**Files:**
- Modify: `src/app/(app)/debts/[id]/page.tsx`

- [ ] **Step 1: Import `Link` and add `account` to the `Debt` interface**

In `src/app/(app)/debts/[id]/page.tsx`, find:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
```

Replace with:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
```

Then find:

```tsx
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
  payments: DebtPayment[];
  paidCount: number;
  remainingBalance: number;
}
```

Replace with:

```tsx
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

- [ ] **Step 2: Render the "ผ่อนผ่าน" row in the summary card**

In the same file, find:

```tsx
        {debt.notes && (
          <p className="text-[13px] text-muted-foreground">{debt.notes}</p>
        )}
      </div>
```

Replace with:

```tsx
        {debt.notes && (
          <p className="text-[13px] text-muted-foreground">{debt.notes}</p>
        )}

        {debt.account && (
          <Link
            href={`/accounts/${debt.account.id}`}
            className="block text-[13px] text-primary"
          >
            ผ่อนผ่าน: 💳 {debt.account.name}
          </Link>
        )}
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/debts/[id]/page.tsx"
git commit -m "feat(debts): show linked credit-card/loan account on debt detail page"
```

---

### Task 7: Label rename — "บัตรเครดิต" → "บัตรเครดิต/สินเชื่อ" (6 sites)

**Files:**
- Modify: `src/app/(app)/accounts/[id]/page.tsx:40,130`
- Modify: `src/components/forms/account-form.tsx:43`
- Modify: `src/app/(app)/dashboard/page.tsx:139,899`
- Modify: `src/app/(app)/transactions/page.tsx:387-391`

- [ ] **Step 1: `accounts/[id]/page.tsx` — TYPE_LABEL map + pay button**

Find:

```tsx
const TYPE_LABEL: Record<string, string> = {
  CASH: "เงินสด", BANK_ACCOUNT: "บัญชีธนาคาร", SAVINGS: "ออมทรัพย์", E_WALLET: "E-Wallet", CREDIT_CARD: "บัตรเครดิต",
};
```

Replace with:

```tsx
const TYPE_LABEL: Record<string, string> = {
  CASH: "เงินสด", BANK_ACCOUNT: "บัญชีธนาคาร", SAVINGS: "ออมทรัพย์", E_WALLET: "E-Wallet", CREDIT_CARD: "บัตรเครดิต/สินเชื่อ",
};
```

Then find:

```tsx
        {isCreditCard ? "ชำระบัตรเครดิต" : "โอนออก"}
```

Replace with:

```tsx
        {isCreditCard ? "ชำระบัตรเครดิต/สินเชื่อ" : "โอนออก"}
```

- [ ] **Step 2: `account-form.tsx` — type picker label**

Find:

```tsx
  { value: "CREDIT_CARD",  label: "บัตรเครดิต", emoji: "💳" },
```

Replace with:

```tsx
  { value: "CREDIT_CARD",  label: "บัตรเครดิต/สินเชื่อ", emoji: "💳" },
```

- [ ] **Step 3: `dashboard/page.tsx` — outstanding-balance row + wallet-card header**

Find:

```tsx
            <span className="text-[12px] text-muted-foreground">ยอดบัตรเครดิตค้างจ่าย</span>
```

Replace with:

```tsx
            <span className="text-[12px] text-muted-foreground">ยอดบัตรเครดิต/สินเชื่อค้างจ่าย</span>
```

Then find:

```tsx
                <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต</span>
```

Replace with:

```tsx
                <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต/สินเชื่อ</span>
```

- [ ] **Step 4: `transactions/page.tsx` — transaction-row pill tag**

Find:

```tsx
                        {tx.account?.type === "CREDIT_CARD" && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FF3B30]/15 text-[#FF3B30]">
                            💳 บัตรเครดิต
                          </span>
                        )}
```

Replace with:

```tsx
                        {tx.account?.type === "CREDIT_CARD" && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FF3B30]/15 text-[#FF3B30]">
                            💳 บัตรเครดิต/สินเชื่อ
                          </span>
                        )}
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/accounts/[id]/page.tsx" src/components/forms/account-form.tsx "src/app/(app)/dashboard/page.tsx" "src/app/(app)/transactions/page.tsx"
git commit -m "feat(wallet): rename CREDIT_CARD label to บัตรเครดิต/สินเชื่อ"
```

---

### Task 8: Type-check

**Files:** none (verification only)

- [ ] **Step 1: Run the TypeScript compiler**

```bash
npx tsc --noEmit
```

Expected: no errors. If errors appear, they are most likely one of:
- `setValue`/`watch` typing on `accountId` in `debt-form.tsx` (Task 5) — `CreateDebtInput["accountId"]` is `string | null | undefined`.
- Missing `account` on the `Debt` interface in `debts/[id]/page.tsx` (Task 6) — must match the shape `{ id: string; name: string } | null`.

Fix inline if any appear, then re-run until clean.

---

### Task 9: End-to-end Playwright verification + cleanup

**Files:**
- Create: `/tmp/run-check/wallet-cc-phase2c1-check.mjs`

- [ ] **Step 1: Write the verification script**

Create `/tmp/run-check/wallet-cc-phase2c1-check.mjs`:

```js
// Wallet/CC Phase 2C-1: label rename + Debt.accountId link
// Expect ALL assertions PASS.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3001';
const OUT_DIR = '/tmp/run-check';
const ts = Date.now();
const U1 = { email: `phase2c1-a-${ts}@test.local`, password: 'Phase2c1Check123!', name: 'Phase2C1 User A' };
const U2 = { email: `phase2c1-b-${ts}@test.local`, password: 'Phase2c1Check123!', name: 'Phase2C1 User B' };

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });

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

function apiFor(p) {
  return async (method, path, body) => p.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }, { method, path, body });
}

// ---- User B setup (only need its CC account id for the cross-user 404 test) ----
const pageB = await (await browser.newContext()).newPage();
console.log('Registering user B...');
if (!(await register(pageB, U2))) throw new Error('register B failed');
const apiB = apiFor(pageB);
const accountsB = (await apiB('GET', '/api/v1/accounts')).json.data;
const ccB = accountsB.find((a) => a.type === 'CREDIT_CARD');
if (!ccB) throw new Error('user B missing CC account');
console.log('User B CC account:', ccB.id);

// ---- User A setup ----
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 } })).newPage();
console.log('Registering user A...');
if (!(await register(page, U1))) throw new Error('register A failed');
const api = apiFor(page);
const accountsA = (await api('GET', '/api/v1/accounts')).json.data;
const cashA = accountsA.find((a) => a.type === 'CASH');
const ccA = accountsA.find((a) => a.type === 'CREDIT_CARD');
if (!cashA || !ccA) throw new Error('user A starter accounts missing');
console.log('User A CASH:', cashA.id, '/ CC:', ccA.id, '(' + ccA.name + ')');

// [1] Create debt with accountId = own CC account -> 201, account in response
console.log('\n[1] Create debt linked to CREDIT_CARD account...');
const d1 = await api('POST', '/api/v1/debts', {
  name: 'ผ่อน iPhone', totalAmount: 12000, totalMonths: 12, startDate: '2026-06-01', accountId: ccA.id,
});
console.log('    [1a] status 201:', d1.status === 201 ? 'PASS' : `FAIL (${d1.status} ${JSON.stringify(d1.json)})`);
console.log('    [1b] response.account.id === ccA.id:', d1.json?.data?.account?.id === ccA.id ? 'PASS' : `FAIL (${JSON.stringify(d1.json?.data?.account)})`);

// [2] GET list includes account
console.log('\n[2] GET /api/v1/debts list includes account...');
const list = await api('GET', '/api/v1/debts');
const listed = list.json.data.find((d) => d.id === d1.json.data.id);
console.log('    [2] listed.account.id === ccA.id:', listed?.account?.id === ccA.id ? 'PASS' : `FAIL (${JSON.stringify(listed?.account)})`);

// [3] GET detail includes account
console.log('\n[3] GET /api/v1/debts/[id] includes account...');
const detail = await api('GET', `/api/v1/debts/${d1.json.data.id}`);
console.log('    [3] detail.account.id === ccA.id:', detail.json?.data?.account?.id === ccA.id ? 'PASS' : `FAIL (${JSON.stringify(detail.json?.data?.account)})`);

// [4] Create debt without accountId -> account: null
console.log('\n[4] Create debt without accountId...');
const d2 = await api('POST', '/api/v1/debts', {
  name: 'ยืมเพื่อน', totalAmount: 3000, totalMonths: 3, startDate: '2026-06-01',
});
console.log('    [4a] status 201:', d2.status === 201 ? 'PASS' : `FAIL (${d2.status} ${JSON.stringify(d2.json)})`);
console.log('    [4b] response.account === null:', d2.json?.data?.account === null ? 'PASS' : `FAIL (${JSON.stringify(d2.json?.data?.account)})`);

// [5] accountId pointing at a non-CC (CASH) account -> 404 NOT_FOUND
console.log('\n[5] accountId pointing at CASH account...');
const d3 = await api('POST', '/api/v1/debts', {
  name: 'ผ่อนของ', totalAmount: 1000, totalMonths: 2, startDate: '2026-06-01', accountId: cashA.id,
});
console.log('    [5] status 404 + NOT_FOUND:', d3.status === 404 && d3.json?.error?.code === 'NOT_FOUND' ? 'PASS' : `FAIL (${d3.status} ${JSON.stringify(d3.json)})`);

// [6] accountId pointing at another user's account -> 404 NOT_FOUND
console.log('\n[6] accountId pointing at user B account...');
const d4 = await api('POST', '/api/v1/debts', {
  name: 'ผ่อนของ', totalAmount: 1000, totalMonths: 2, startDate: '2026-06-01', accountId: ccB.id,
});
console.log('    [6] status 404 + NOT_FOUND:', d4.status === 404 && d4.json?.error?.code === 'NOT_FOUND' ? 'PASS' : `FAIL (${d4.status} ${JSON.stringify(d4.json)})`);

// [7] /debts/[id] shows "ผ่อนผ่าน" row + links to /accounts/[id]
console.log('\n[7] /debts/[id] shows ผ่อนผ่าน row + link...');
await page.goto(`${BASE}/debts/${d1.json.data.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT_DIR}/p2c1-7-debt-detail-linked.png`, fullPage: true });
let bodyText = await page.locator('body').innerText();
console.log(`    [7a] shows "ผ่อนผ่าน: 💳 ${ccA.name}":`, bodyText.includes(`ผ่อนผ่าน: 💳 ${ccA.name}`) ? 'PASS' : 'FAIL');
const link = page.locator(`a[href="/accounts/${ccA.id}"]`);
console.log('    [7b] link href present:', (await link.count()) > 0 ? 'PASS' : 'FAIL');

// [8] /debts/[id] (no account) shows no ผ่อนผ่าน row
console.log('\n[8] /debts/[id] (no account) shows no ผ่อนผ่าน row...');
await page.goto(`${BASE}/debts/${d2.json.data.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
bodyText = await page.locator('body').innerText();
console.log('    [8] no "ผ่อนผ่าน":', !bodyText.includes('ผ่อนผ่าน') ? 'PASS' : 'FAIL');

// [9] DebtForm: account picker shows CC account, create debt via UI
console.log('\n[9] DebtForm account picker (create via UI)...');
await page.goto(`${BASE}/debts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'เพิ่มรายการผ่อน' }).click();
await page.waitForTimeout(500);
bodyText = await page.locator('body').innerText();
console.log('    [9a] form shows "ผ่อนผ่านบัญชี (ถ้ามี)":', bodyText.includes('ผ่อนผ่านบัญชี (ถ้ามี)') ? 'PASS' : 'FAIL');

await page.fill('input[placeholder="0.00"]', '6000');
await page.fill('input[placeholder="เช่น ผ่อน iPhone, Shopee PayLater"]', 'ผ่อน UI Test');

const accountRow = page.locator('label:has-text("ผ่อนผ่านบัญชี (ถ้ามี)")').locator('..');
await accountRow.locator('[role="combobox"]').click();
await page.waitForTimeout(300);
await page.getByRole('option', { name: `💳 ${ccA.name}` }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT_DIR}/p2c1-9-form-account-picker.png`, fullPage: true });

await page.getByRole('button', { name: 'บันทึกหนี้สิน' }).click();
await page.waitForTimeout(1000);

const listAfter = await api('GET', '/api/v1/debts');
const created = listAfter.json.data.find((d) => d.name === 'ผ่อน UI Test');
console.log('    [9b] created via UI has account.id === ccA.id:', created?.account?.id === ccA.id ? 'PASS' : `FAIL (${JSON.stringify(created?.account)})`);

// [10] Label rename — /accounts/[id] (CC) at mobile width
console.log('\n[10] Label rename — /accounts/[id] (CC)...');
await page.goto(`${BASE}/accounts/${ccA.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT_DIR}/p2c1-10-account-detail.png`, fullPage: true });
bodyText = await page.locator('body').innerText();
console.log('    [10a] TYPE_LABEL "บัตรเครดิต/สินเชื่อ":', bodyText.includes('บัตรเครดิต/สินเชื่อ') ? 'PASS' : 'FAIL');
console.log('    [10b] pay button "ชำระบัตรเครดิต/สินเชื่อ":', bodyText.includes('ชำระบัตรเครดิต/สินเชื่อ') ? 'PASS' : 'FAIL');

// [11] Label rename — AccountForm type picker
console.log('\n[11] Label rename — AccountForm type picker...');
await page.goto(`${BASE}/accounts`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(800);
await page.click('button:has-text("เพิ่ม")');
await page.waitForTimeout(400);
bodyText = await page.locator('body').innerText();
console.log('    [11] type picker "บัตรเครดิต/สินเชื่อ":', bodyText.includes('บัตรเครดิต/สินเชื่อ') ? 'PASS' : 'FAIL');
await page.screenshot({ path: `${OUT_DIR}/p2c1-11-accountform-type.png`, fullPage: true });
await page.getByRole('button', { name: 'ยกเลิก' }).click();
await page.waitForTimeout(300);

// [12] Label rename — dashboard
console.log('\n[12] Label rename — dashboard...');
await page.goto(`${BASE}/dashboard`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT_DIR}/p2c1-12-dashboard.png`, fullPage: true });
bodyText = await page.locator('body').innerText();
console.log('    [12a] outstanding row "ยอดบัตรเครดิต/สินเชื่อค้างจ่าย":', bodyText.includes('ยอดบัตรเครดิต/สินเชื่อค้างจ่าย') ? 'PASS' : 'FAIL');
console.log('    [12b] wallet card "💳 บัตรเครดิต/สินเชื่อ":', bodyText.includes('💳 บัตรเครดิต/สินเชื่อ') ? 'PASS' : 'FAIL');

// [13] Label rename — transactions pill tag
console.log('\n[13] Label rename — transactions pill tag...');
const cats = await api('GET', '/api/v1/categories?type=EXPENSE');
const catId = cats.json.data[0].id;
const today = new Date().toISOString().slice(0, 10);
await api('POST', '/api/v1/transactions', {
  type: 'EXPENSE', amount: 99, date: today, categoryId: catId, accountId: ccA.id, description: 'p2c1 label check',
});
await page.goto(`${BASE}/transactions`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT_DIR}/p2c1-13-transactions.png`, fullPage: true });
bodyText = await page.locator('body').innerText();
console.log('    [13] pill "💳 บัตรเครดิต/สินเชื่อ" (check screenshot for clipping/wrapping):', bodyText.includes('💳 บัตรเครดิต/สินเชื่อ') ? 'PASS' : 'FAIL');

await browser.close();
console.log('\nDone. fixture emails (for cleanup):', U1.email, U2.email);
```

- [ ] **Step 2: Start the dev server on port 3001**

```bash
npm run dev -- -p 3001 > /tmp/run-check/dev-p2c1-3001.log 2>&1 &
```

Wait until ready:

```bash
until grep -q "Ready" /tmp/run-check/dev-p2c1-3001.log 2>/dev/null; do sleep 2; done
```

- [ ] **Step 3: Run the verification script**

```bash
node /tmp/run-check/wallet-cc-phase2c1-check.mjs
```

Expected: every line ends with `PASS`. If any line shows `FAIL`, fix the corresponding task's code and re-run from Step 3 (no need to restart the dev server — Next.js hot-reloads).

- [ ] **Step 4: Review label-rename screenshots for clipping/wrapping**

Read these files and visually confirm "บัตรเครดิต/สินเชื่อ" / "💳 บัตรเครดิต/สินเชื่อ" render on one line without being cut off at 430px width:
- `/tmp/run-check/p2c1-12-dashboard.png` (wallet-card header + outstanding row)
- `/tmp/run-check/p2c1-13-transactions.png` (pill tag)
- `/tmp/run-check/p2c1-10-account-detail.png` (TYPE_LABEL + pay button)
- `/tmp/run-check/p2c1-11-accountform-type.png` (type picker)

If the pill tag in `p2c1-13-transactions.png` wraps or clips, shorten that one site (`transactions/page.tsx`'s pill, from Task 7 Step 4) to `💳 สินเชื่อ` and re-run Step 3's screenshot check only.

- [ ] **Step 5: Stop the dev server and clean up fixtures**

```bash
kill %1 2>/dev/null || pkill -f "next dev.*3001"
node /tmp/run-check/cleanup-phase2a.mjs <U1.email> <U2.email>
rm /tmp/run-check/wallet-cc-phase2c1-check.mjs /tmp/run-check/p2c1-*.png /tmp/run-check/dev-p2c1-3001.log
```

Replace `<U1.email>` and `<U2.email>` with the two fixture emails printed by Step 3's final "Done." line. `cleanup-phase2a.mjs` already exists at `/tmp/run-check/cleanup-phase2a.mjs` and deletes each user by email (cascades to their accounts/debts via `onDelete: Cascade`).

---

## Self-Review Notes

- **Spec coverage:** Section A (6 label sites) → Task 7. Section B (schema) → Task 1. Section C (validation + API) → Tasks 2-4. Section D (UI) → Tasks 5-6. Testing plan → Tasks 8-9 (tsc + Playwright covering all listed cases including the two 404s and the screenshot/layout check).
- **Placeholder scan:** none found — every step has complete before/after code or exact commands.
- **Type consistency:** `accountId` is `string | null | undefined` consistently across `createDebtSchema` (Task 2), `DebtForm`'s `watch`/`setValue` (Task 5), and the create payload (Task 3). `Debt.account` is `{ id: string; name: string } | null` consistently across the GET includes (Task 4, both `select: { id: true, name: true }`) and the frontend `Debt` interface (Task 6).

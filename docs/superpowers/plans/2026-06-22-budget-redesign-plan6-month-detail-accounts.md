# Budget Redesign Plan 6/6 — Month-Detail Page: SAVING Wallet-Picker + LIABILITY via DebtForm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish spec Section 6 — on `/budget/[year]/[month]`'s "เพิ่มรายการงบ" form, swap the SAVING type's category dropdown for a "กระเป๋าออม" account picker (with inline "+ สร้างกระเป๋าออมใหม่"), and swap the LIABILITY type's bespoke inline fields for the same `DebtForm` used on `/debts`, creating a `PLANNED` debt instead of an `ACTIVE` one.

**Architecture:** The backend for PLANNED debts already exists end-to-end (`DebtStatus.PLANNED`, `createDebtSchema`'s `status` field, `POST /api/v1/debts`'s `createBudgetItemsForDebt` branch — all shipped in Plan 1). This plan's LIABILITY half is therefore UI-only: add a `forcePlanned` prop to `DebtForm` and swap it in for the old inline fields. The SAVING half needs one small additive schema change (`BudgetItem.accountId`, nullable FK to `Account`, mirroring how `BudgetItem.debtId`/`Transaction.accountId` already work) plus three API routes updated to read/write it, then the same account-picker UI pattern already used by `TransferForm`/`DebtForm` (`GET /api/v1/accounts`, filtered by type).

**Tech Stack:** Next.js 14 App Router (client components), Prisma ORM (additive migration, no backfill needed), existing `ios-card` design system, `_shared.tsx`'s `ItemForm`/`TYPE_CONFIG`, `src/components/forms/debt-form.tsx`.

---

## Part 1 — Summary (read this before touching code)

### What's being built

`/budget/[year]/[month]` is the only piece of spec Section 6 not yet shipped (Plans 1-5 covered everything else: PLANNED debt status/confirm flow, the rewritten comparison API, the 3-route restructure, and the new `/budget/plan` + `/budget/track` pages). Two changes to its "เพิ่มรายการงบ" (add budget item) form, both confirmed by re-reading `docs/superpowers/specs/2026-06-18-budget-page-redesign-design.md` Section 6 and `src/app/(app)/budget/_shared.tsx`'s `ItemForm`:

1. **เงินออม (SAVING):** today picking SAVING shows the same category `<select>` as INCOME/EXPENSE (existing pre-redesign behavior — categories aren't even filtered by type for SAVING, `filteredCategories` falls through to "show all"). Replace it with a picker over the user's CASH/SAVINGS-type `Account`s ("กระเป๋าออม"), with an inline "+ สร้างกระเป๋าออมใหม่" affordance that creates a new SAVINGS account without leaving the sheet. Per spec, this is forecast metadata only — it does not move money or create a `Transfer`.
2. **หนี้สิน (LIABILITY):** today this shows bespoke inline fields (`totalMonths`, `debtStartMonth`) and calls `handleCreateDebt`, which manually POSTs to `/api/v1/debts` with no `status` — meaning it silently creates an **ACTIVE** debt with a real payment schedule, not the PLANNED forecast the redesign calls for. Replace this entire inline block with the real `DebtForm` component (the same one `/debts` uses — full name/amount/months/interest-rate/billing-account fields), forced to submit with `status: "PLANNED"`.

### Why this closes a known gap, not just a UI polish

[[project_budget_redesign_plan1_planned_debt]] (memory, written after Plan 1 shipped) explicitly flagged: *"Plan 1 has ZERO UI entry point to actually create a PLANNED debt... The actual creation entry point... is Plan 6, not yet built. Until Plan 6 ships, the only way to create a PLANNED debt is direct API call."* This plan closes that gap — it's the only way a real user can ever create a PLANNED debt through the UI.

### Key design decisions

1. **LIABILITY swap is a full replacement, not a merge.** `ItemForm`'s current LIABILITY-new branch (`isNewLiability`) builds its own debt payload (`monthlyAmount`, `totalMonths`, `startDate`) and hands it to a parent-supplied `onSaveDebt` callback, which then POSTs to `/api/v1/debts` itself. `DebtForm` already owns its own POST-to-`/api/v1/debts` call internally (see `src/components/forms/debt-form.tsx`'s `onSubmit`). Bolting `DebtForm`'s richer fields onto the *existing* manual-POST plumbing would mean keeping two competing payload-building code paths in sync. Instead: when `isNewLiability`, `ItemForm` renders `<DebtForm forcePlanned ... />` directly (which does its own fetch+validation+error UI) and the parent's callback shrinks to "close sheet, refetch month" — no payload building in `ItemForm`/the page at all anymore. The old `DebtCreationInput` type and `onSaveDebt` prop are deleted, not deprecated-in-place (nothing else uses them).
2. **`forcePlanned` only changes the status sent, nothing else.** `DebtForm` already supports everything Section 6 asks for (interest rate with ต่อเดือน/ต่อปี toggle, optional billing account via `accountId` filtered to `CREDIT_CARD` accounts) — confirmed by reading the component. The family-debt toggle stays hidden automatically (it's gated by `inFamilyGroup`, which the budget page already doesn't pass), so no extra prop-threading needed there.
3. **SAVING account picker only offers CASH/SAVINGS account types**, not BANK_ACCOUNT/E_WALLET/CREDIT_CARD — matching the spec's "กระเป๋าออม" (savings wallet) framing, and mirroring `DebtForm`'s own pattern of filtering `GET /api/v1/accounts` client-side by `type` for a specific picker.
4. **Inline account creation is a 2-field mini-form (name only), not a nested `AccountForm` Sheet.** `AccountForm` is itself a `Sheet`, and nesting a Sheet inside the already-open "เพิ่มรายการงบ" Sheet is awkward UX and not what "inline... without leaving the sheet" implies. A new SAVINGS account only strictly needs a `name` (type is fixed, `initialBalance` defaults to 0) — `createAccountSchema` already defaults everything else. So: a single `Input` + small "เพิ่ม" button that POSTs `/api/v1/accounts` directly and selects the new account on success.
5. **`BudgetItem.accountId` is purely additive metadata** (spec Section 9: *"today it's planning metadata only"*) — no Transfer cross-check, no balance impact. It's stored and displayed exactly like `BudgetItem.categoryId`/`debtId` already are: included in the GET response, persisted in the PUT's full-item-replace, and carried through `copy-from`. The three comparison/aggregate routes (`comparison`, `yearly-comparison`, `yearly-items`) are **not** touched — they don't currently select `categoryId`/`debtId` either beyond what they already use, and the spec gives no requirement for SAVING-account info to appear there.
6. **Editing an existing LIABILITY budget item that has no `debtId`** (a legacy/manually-entered row from before this plan) keeps using the old generic category-dropdown edit path. This is an existing edge case the spec doesn't mention (Section 6 only discusses the "เพิ่มรายการงบ" *creation* flow), and every LIABILITY item created going forward will have a `debtId` and route through the page's existing "จัดการ" link instead of inline editing anyway (`src/app/(app)/budget/[year]/[month]/page.tsx:299-303`, unchanged by this plan).

### What's explicitly out of scope for this plan

- Any change to `/api/v1/budgets/comparison`, `/api/v1/budgets/yearly-comparison`, or `/api/v1/budgets/yearly-items` — SAVING's `accountId` is display/planning metadata only, per spec Section 9.
- Any change to the PLANNED→ACTIVE "ยืนยันเป็นหนี้จริง" confirm flow, the `/debts` "วางแผน" tab, or anything else already shipped in Plan 1.
- Cross-checking a SAVING item's picked account against real `Transfer`s into it — explicitly deferred in spec Section 9.
- The emoji→icon swap mentioned in the spec's deferred section.
- VPS deploy — held until this is the last of all 6 plans confirmed locally; deploying all 6 together is a separate, explicit step after this plan ships (per the Plan-2-established cadence).

---

## File Structure

- **Modify** `prisma/schema.prisma` — add nullable `accountId`/`account` to `BudgetItem`; add `budgetItems` back-relation to `Account`.
- **Modify** `src/lib/validations/budget.ts` — add optional nullable `accountId` to `budgetItemSchema`.
- **Modify** `src/app/api/v1/budgets/[year]/[month]/route.ts` — `GET` includes `account`; `PUT` persists `accountId`.
- **Modify** `src/app/api/v1/budgets/[year]/[month]/copy-from/[srcYear]/[srcMonth]/route.ts` — carries `accountId` through the copy; includes `account` in the response.
- **Modify** `src/components/forms/debt-form.tsx` — add `forcePlanned?: boolean` prop.
- **Modify** `src/app/(app)/budget/_shared.tsx` — `BudgetItem`/`ItemFormProps` types gain `accountId`/`account`/`AccountOption`, drop `DebtCreationInput`/`onSaveDebt`; `ItemForm` swaps SAVING's category picker for an account picker (+ inline create) and LIABILITY's inline fields for `<DebtForm forcePlanned>`.
- **Modify** `src/app/(app)/budget/[year]/[month]/page.tsx` — drop `handleCreateDebt`/`DebtCreationInput` import, add `handleLiabilityCreated`; display the picked savings account on SAVING list rows.
- No new files.

---

## Part 2 — Implementation Tasks

### Task 1: Schema — `BudgetItem.accountId`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `accountId`/`account` to the `BudgetItem` model**

Find the `BudgetItem` model (around line 394). Change:

```prisma
  categoryId String?        @map("category_id")
  category   Category?      @relation(fields: [categoryId], references: [id])
  notes      String?
```

To:

```prisma
  categoryId String?        @map("category_id")
  category   Category?      @relation(fields: [categoryId], references: [id])
  accountId  String?        @map("account_id")
  account    Account?       @relation(fields: [accountId], references: [id])
  notes      String?
```

And add an index — find `@@index([debtId])` in the same model and add directly below it:

```prisma
  @@index([debtId])
  @@index([accountId])
```

- [ ] **Step 2: Add the back-relation on `Account`**

Find the `Account` model's relation block (around line 196-200):

```prisma
  transactions  Transaction[]
  recurringTxns RecurringTransaction[]
  transfersFrom Transfer[]   @relation("TransferFrom")
  transfersTo   Transfer[]   @relation("TransferTo")
  debts         Debt[]
```

Add `budgetItems` after `debts`:

```prisma
  transactions  Transaction[]
  recurringTxns RecurringTransaction[]
  transfersFrom Transfer[]   @relation("TransferFrom")
  transfersTo   Transfer[]   @relation("TransferTo")
  debts         Debt[]
  budgetItems   BudgetItem[]
```

- [ ] **Step 3: Run the migration**

```bash
npx prisma migrate dev --name add_budget_item_account
```

Expected: a new purely-additive migration (`ALTER TABLE budget_items ADD COLUMN account_id ...` + FK + index), no manual SQL editing needed (nullable column, no existing rows to backfill). Expected final output: `✓ Generated Prisma Client`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add nullable BudgetItem.accountId for SAVING wallet picker"
```

---

### Task 2: Validation schema

**Files:**
- Modify: `src/lib/validations/budget.ts`

- [ ] **Step 1: Add `accountId` to `budgetItemSchema`**

Change:

```typescript
export const budgetItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "กรุณากรอกชื่อ"),
  type: z.enum(["INCOME", "EXPENSE", "LIABILITY", "SAVING"]),
  amount: z.coerce.number().min(0, "จำนวนเงินต้องไม่ติดลบ"),
  categoryId: z.string().optional().nullable(),
  debtId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});
```

To:

```typescript
export const budgetItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "กรุณากรอกชื่อ"),
  type: z.enum(["INCOME", "EXPENSE", "LIABILITY", "SAVING"]),
  amount: z.coerce.number().min(0, "จำนวนเงินต้องไม่ติดลบ"),
  categoryId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  debtId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/validations/budget.ts
git commit -m "feat(validation): accept accountId on budget items"
```

---

### Task 3: `/api/v1/budgets/[year]/[month]` — read/write `accountId`

**Files:**
- Modify: `src/app/api/v1/budgets/[year]/[month]/route.ts`

- [ ] **Step 1: Include `account` in `GET`'s query**

Find:

```typescript
  const budget = await prisma.budget.findUnique({
    where: { userId_year_month: { userId: session.user.id, year: y, month: m } },
    include: {
      items: {
        include: { category: true },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });
```

Change to:

```typescript
  const budget = await prisma.budget.findUnique({
    where: { userId_year_month: { userId: session.user.id, year: y, month: m } },
    include: {
      items: {
        include: {
          category: true,
          account: { select: { id: true, name: true, type: true } },
        },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });
```

- [ ] **Step 2: Persist `accountId` in `PUT`'s create-many mapping**

Find:

```typescript
  const items = parsed.data.items.map((item, idx) => ({
    budgetId: budget.id,
    debtId: item.debtId || null,
    name: item.name,
    type: item.type,
    amount: item.amount,
    categoryId: item.categoryId || null,
    notes: item.notes || null,
    sortOrder: item.sortOrder ?? idx,
  }));
```

Change to:

```typescript
  const items = parsed.data.items.map((item, idx) => ({
    budgetId: budget.id,
    debtId: item.debtId || null,
    name: item.name,
    type: item.type,
    amount: item.amount,
    categoryId: item.categoryId || null,
    accountId: item.accountId || null,
    notes: item.notes || null,
    sortOrder: item.sortOrder ?? idx,
  }));
```

- [ ] **Step 3: Include `account` in `PUT`'s response query**

Find:

```typescript
  const result = await prisma.budget.findUnique({
    where: { id: budget.id },
    include: { items: { include: { category: true }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }] } },
  });
```

Change to:

```typescript
  const result = await prisma.budget.findUnique({
    where: { id: budget.id },
    include: {
      items: {
        include: {
          category: true,
          account: { select: { id: true, name: true, type: true } },
        },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/v1/budgets/[year]/[month]/route.ts"
git commit -m "feat(api): read/write BudgetItem.accountId on month-detail GET/PUT"
```

---

### Task 4: `copy-from` route — carry `accountId` through

**Files:**
- Modify: `src/app/api/v1/budgets/[year]/[month]/copy-from/[srcYear]/[srcMonth]/route.ts`

- [ ] **Step 1: Add `accountId` to the create-many mapping**

Find:

```typescript
  await prisma.budgetItem.createMany({
    data: src.items.map(item => ({
      budgetId: dest.id,
      name: item.name,
      type: item.type,
      amount: item.amount,
      categoryId: item.categoryId,
      notes: item.notes,
      sortOrder: item.sortOrder,
    })),
  });
```

Change to:

```typescript
  await prisma.budgetItem.createMany({
    data: src.items.map(item => ({
      budgetId: dest.id,
      name: item.name,
      type: item.type,
      amount: item.amount,
      categoryId: item.categoryId,
      accountId: item.accountId,
      notes: item.notes,
      sortOrder: item.sortOrder,
    })),
  });
```

(`src.items` comes from `include: { items: true }` further up, which already returns the new `accountId` column automatically post-migration — no read-side change needed.)

- [ ] **Step 2: Include `account` in the response query**

Find:

```typescript
  const result = await prisma.budget.findUnique({
    where: { id: dest.id },
    include: { items: { include: { category: true }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }] } },
  });
```

Change to:

```typescript
  const result = await prisma.budget.findUnique({
    where: { id: dest.id },
    include: {
      items: {
        include: {
          category: true,
          account: { select: { id: true, name: true, type: true } },
        },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/v1/budgets/[year]/[month]/copy-from/"
git commit -m "feat(api): carry BudgetItem.accountId through copy-from"
```

---

### Task 5: `DebtForm` — `forcePlanned` prop

**Files:**
- Modify: `src/components/forms/debt-form.tsx`

- [ ] **Step 1: Add the prop**

Find:

```typescript
interface DebtFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  inFamilyGroup?: boolean;
  familyGroups?: FamilyGroup[];
}
```

Change to:

```typescript
interface DebtFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  inFamilyGroup?: boolean;
  familyGroups?: FamilyGroup[];
  forcePlanned?: boolean;
}
```

And:

```typescript
export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false, familyGroups = [] }: DebtFormProps) {
```

Change to:

```typescript
export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false, familyGroups = [], forcePlanned = false }: DebtFormProps) {
```

- [ ] **Step 2: Send `status: "PLANNED"` when set**

Find `onSubmit`'s payload construction:

```typescript
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        interestRate: monthlyRate > 0 ? monthlyRate : null,
        isFamily,
        familyGroupId: isFamily ? familyGroupId : null,
      };
```

Change to:

```typescript
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        interestRate: monthlyRate > 0 ? monthlyRate : null,
        isFamily,
        familyGroupId: isFamily ? familyGroupId : null,
        ...(forcePlanned ? { status: "PLANNED" as const } : {}),
      };
```

- [ ] **Step 3: Update the submit button label when planning (not committing real money yet)**

Find:

```typescript
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          บันทึกหนี้สิน
        </Button>
```

Change to:

```typescript
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {forcePlanned ? "สร้างหนี้สินวางแผน" : "บันทึกหนี้สิน"}
        </Button>
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/debt-form.tsx
git commit -m "feat(ui): add forcePlanned prop to DebtForm for PLANNED-debt creation"
```

---

### Task 6: `_shared.tsx` — SAVING account picker + LIABILITY via `DebtForm`

**Files:**
- Modify: `src/app/(app)/budget/_shared.tsx`

- [ ] **Step 1: Add `useEffect` import and the `DebtForm` import**

Find:

```typescript
import { useState } from "react";
import Link from "next/link";
```

Change to:

```typescript
import { useEffect, useState } from "react";
import Link from "next/link";
```

Find the imports block further down (after the recharts import, before the `Input`/`Button` imports — actually right next to `Button`/`Input`):

```typescript
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
```

Change to:

```typescript
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebtForm } from "@/components/forms/debt-form";
import { formatCurrency, cn } from "@/lib/utils";
```

- [ ] **Step 2: Add `accountId`/`account` to `BudgetItem`, add `AccountOption`**

Find:

```typescript
export interface BudgetItem {
  id?: string;
  name: string;
  type: ItemType;
  amount: number;
  categoryId?: string | null;
  debtId?: string | null;
  notes?: string | null;
  sortOrder: number;
  category?: { id: string; name: string; icon: string | null } | null;
}
```

Change to:

```typescript
export interface AccountOption {
  id: string;
  name: string;
  type: string;
}

export interface BudgetItem {
  id?: string;
  name: string;
  type: ItemType;
  amount: number;
  categoryId?: string | null;
  accountId?: string | null;
  debtId?: string | null;
  notes?: string | null;
  sortOrder: number;
  category?: { id: string; name: string; icon: string | null } | null;
  account?: { id: string; name: string; type: string } | null;
}
```

- [ ] **Step 3: Drop `DebtCreationInput`, update `ItemFormProps`**

Find:

```typescript
export interface DebtCreationInput {
  name: string;
  monthlyAmount: number;
  totalMonths: number;
  startDate: string;
  notes?: string;
}

export interface ItemFormProps {
  initial?: Partial<BudgetItem>;
  categories: Category[];
  isNew?: boolean;
  currentMonth: number;
  currentYear: number;
  onSave: (item: Omit<BudgetItem, "id">, months: number[]) => void;
  onSaveDebt?: (debt: DebtCreationInput) => void;
  onCancel: () => void;
}
```

Change to:

```typescript
export interface ItemFormProps {
  initial?: Partial<BudgetItem>;
  categories: Category[];
  isNew?: boolean;
  currentMonth: number;
  currentYear: number;
  onSave: (item: Omit<BudgetItem, "id">, months: number[]) => void;
  onLiabilityCreated?: () => void;
  onCancel: () => void;
}
```

- [ ] **Step 4: Replace the `ItemForm` function body**

Replace the entire `ItemForm` function (from `export function ItemForm({ initial, categories, isNew, currentMonth, currentYear, onSave, onSaveDebt, onCancel }: ItemFormProps) {` down to its closing `}`) with:

```typescript
export function ItemForm({ initial, categories, isNew, currentMonth, currentYear, onSave, onLiabilityCreated, onCancel }: ItemFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<ItemType>(initial?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [error, setError] = useState("");

  // Month selection (new non-LIABILITY items only)
  const [monthMode, setMonthMode] = useState<"single" | "all" | "custom">("single");
  const [customMonths, setCustomMonths] = useState<number[]>([currentMonth]);

  const isNewLiability = isNew && type === "LIABILITY";

  useEffect(() => {
    fetch("/api/v1/accounts").then(r => r.json()).then(d => { if (d.success) setAccounts(d.data); });
  }, []);

  const savingsAccounts = accounts.filter(a => a.type === "CASH" || a.type === "SAVINGS");

  const filteredCategories = categories.filter(c =>
    type === "INCOME" ? c.type === "INCOME" :
    type === "EXPENSE" ? c.type === "EXPENSE" : true
  );

  const selectedMonths =
    monthMode === "single" ? [currentMonth] :
    monthMode === "all"    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] :
    customMonths;

  function toggleCustomMonth(m: number) {
    setCustomMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }

  async function handleCreateAccount() {
    const trimmed = newAccountName.trim();
    if (!trimmed) return;
    setCreatingAccount(true);
    try {
      const res = await fetch("/api/v1/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, type: "SAVINGS", initialBalance: 0 }),
      });
      const json = await res.json();
      if (json.success) {
        const list = await fetch("/api/v1/accounts").then(r => r.json());
        if (list.success) {
          setAccounts(list.data);
          const created = (list.data as AccountOption[]).find(a => a.name === trimmed);
          if (created) setAccountId(created.id);
        }
        setNewAccountName("");
        setShowNewAccount(false);
      }
    } finally {
      setCreatingAccount(false);
    }
  }

  function handleSave() {
    if (!name.trim()) { setError("กรุณากรอกชื่อ"); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) { setError("จำนวนเงินต้องมากกว่า 0"); return; }
    if (monthMode === "custom" && isNew && customMonths.length === 0) { setError("กรุณาเลือกอย่างน้อย 1 เดือน"); return; }
    onSave(
      {
        name: name.trim(),
        type,
        amount: num,
        notes: notes || null,
        sortOrder: initial?.sortOrder ?? 0,
        categoryId: type === "SAVING" ? null : (categoryId || null),
        accountId: type === "SAVING" ? (accountId || null) : null,
      },
      selectedMonths,
    );
  }

  // New LIABILITY items use the full DebtForm (creates a PLANNED debt) instead
  // of the generic fields below — see Plan 6's design decision 1.
  if (isNewLiability) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(TYPE_CONFIG) as ItemType[]).map(t => (
            <button key={t} type="button"
              onClick={() => setType(t)}
              className={cn("py-1.5 rounded-xl text-[12px] font-semibold transition-all",
                type === t ? `${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}` : "bg-muted text-muted-foreground"
              )}>
              {TYPE_CONFIG[t].emoji} {TYPE_CONFIG[t].label}
            </button>
          ))}
        </div>
        <DebtForm forcePlanned onSuccess={() => onLiabilityCreated?.()} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Type */}
      <div className="grid grid-cols-4 gap-1">
        {(Object.keys(TYPE_CONFIG) as ItemType[]).map(t => (
          <button key={t} type="button"
            onClick={() => { setType(t); setCategoryId(""); setAccountId(""); setError(""); }}
            className={cn("py-1.5 rounded-xl text-[12px] font-semibold transition-all",
              type === t ? `${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}` : "bg-muted text-muted-foreground"
            )}>
            {TYPE_CONFIG[t].emoji} {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      {/* Name */}
      <Input
        placeholder="ชื่อรายการ เช่น เงินเดือน, ค่าเช่า"
        value={name} onChange={e => setName(e.target.value)}
        className="bg-input h-11 rounded-xl border-0" />

      {/* Amount */}
      <Input type="number" inputMode="decimal" step="0.01"
        placeholder="จำนวนเงินวางแผน (บาท)"
        value={amount} onChange={e => setAmount(e.target.value)}
        className={cn("bg-input h-11 rounded-xl border-0 text-[18px] font-bold", TYPE_CONFIG[type].color)} />

      {type === "SAVING" ? (
        <div className="space-y-2">
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className="w-full h-11 rounded-xl bg-input border-0 px-3 text-[14px] text-foreground appearance-none">
            <option value="">— เลือกกระเป๋าออม (ไม่บังคับ) —</option>
            {savingsAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.type === "CASH" ? "💵" : "💰"} {a.name}</option>
            ))}
          </select>
          {showNewAccount ? (
            <div className="flex gap-2">
              <Input placeholder="ชื่อกระเป๋าออมใหม่" value={newAccountName}
                onChange={e => setNewAccountName(e.target.value)}
                className="bg-input h-10 rounded-xl border-0 flex-1" />
              <Button type="button" size="sm" disabled={creatingAccount || !newAccountName.trim()} onClick={handleCreateAccount}>
                {creatingAccount ? "..." : "เพิ่ม"}
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowNewAccount(true)}
              className="text-[12px] font-medium text-primary">
              + สร้างกระเป๋าออมใหม่
            </button>
          )}
        </div>
      ) : (
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
          className="w-full h-11 rounded-xl bg-input border-0 px-3 text-[14px] text-foreground appearance-none">
          <option value="">— หมวดหมู่ (ไม่บังคับ) —</option>
          {filteredCategories.map(c => (
            <optgroup key={c.id} label={`${c.icon ?? ""} ${c.name}`}>
              <option value={c.id}>{c.icon ?? ""} {c.name} (ทั้งหมด)</option>
              {c.children.map(ch => (
                <option key={ch.id} value={ch.id}>　{ch.icon ?? ""} {ch.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      {/* Notes */}
      <Input placeholder="หมายเหตุ (ไม่บังคับ)" value={notes ?? ""}
        onChange={e => setNotes(e.target.value)} className="bg-input h-11 rounded-xl border-0" />

      {/* Month selector — new items only */}
      {isNew && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">ใช้กี่เดือน?</p>
          <div className="grid grid-cols-3 gap-1">
            {(["single", "all", "custom"] as const).map(mode => (
              <button key={mode} type="button"
                onClick={() => { setMonthMode(mode); if (mode === "custom") setCustomMonths([currentMonth]); }}
                className={cn("py-2 rounded-xl text-[12px] font-semibold transition-all",
                  monthMode === mode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                {mode === "single" ? "เดือนนี้" : mode === "all" ? "ทุก 12 เดือน" : "เลือกเอง"}
              </button>
            ))}
          </div>
          {monthMode === "custom" && (
            <div className="grid grid-cols-4 gap-1">
              {SHORT_MONTHS.map((label, i) => {
                const m = i + 1;
                const sel = customMonths.includes(m);
                return (
                  <button key={m} type="button" onClick={() => toggleCustomMonth(m)}
                    className={cn("py-1.5 rounded-lg text-[12px] font-medium transition-all",
                      sel ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {monthMode !== "single" && (
            <p className="text-[11px] text-muted-foreground text-center">
              รายการนี้จะถูกเพิ่มใน {selectedMonths.length} เดือน
            </p>
          )}
        </div>
      )}

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>ยกเลิก</Button>
        <Button className="flex-1" onClick={handleSave}>
          {isNew && monthMode !== "single" ? `บันทึก (${selectedMonths.length} เดือน)` : "บันทึก"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (confirms `page.tsx`'s now-stale `DebtCreationInput`/`onSaveDebt` references show up as compile errors — fixed in Task 7 next).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/budget/_shared.tsx"
git commit -m "feat(ui): SAVING items pick a wallet account; LIABILITY uses DebtForm (PLANNED)"
```

---

### Task 7: Wire up the month-detail page

**Files:**
- Modify: `src/app/(app)/budget/[year]/[month]/page.tsx`

- [ ] **Step 1: Drop the `DebtCreationInput` import**

Find:

```typescript
import {
  type ItemType, type Category, type Debt, type BudgetItem, type DebtCreationInput,
  TYPE_CONFIG, SHORT_MONTHS, Skeleton, debtMonthsForYear, ItemForm,
} from "../../_shared";
```

Change to:

```typescript
import {
  type ItemType, type Category, type Debt, type BudgetItem,
  TYPE_CONFIG, SHORT_MONTHS, Skeleton, debtMonthsForYear, ItemForm,
} from "../../_shared";
```

- [ ] **Step 2: Add an account-type emoji map next to the other module-level constants**

Find the `adjacentMonth` function (right before `export default function BudgetMonthPage()`), and add directly above it:

```typescript
const ACCOUNT_EMOJI: Record<string, string> = { CASH: "💵", SAVINGS: "💰" };

```

- [ ] **Step 3: Replace `handleCreateDebt` with `handleLiabilityCreated`**

Find:

```typescript
  async function handleCreateDebt(input: DebtCreationInput) {
    setSaving(true);
    setAddingItem(false);
    try {
      await fetch("/api/v1/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          totalAmount: input.monthlyAmount * input.totalMonths,
          totalMonths: input.totalMonths,
          monthlyAmount: input.monthlyAmount,
          startDate: input.startDate,
          notes: input.notes,
        }),
      });
      await fetchDetail();
    } finally { setSaving(false); }
  }
```

Change to:

```typescript
  async function handleLiabilityCreated() {
    setAddingItem(false);
    await fetchDetail();
  }
```

(`DebtForm` now does its own POST to `/api/v1/debts` with `status: "PLANNED"` — see Task 5/6 — so this just needs to close the sheet and refetch the month.)

- [ ] **Step 4: Wire the new prop into `ItemForm`**

Find:

```typescript
              onSave={addingItem ? handleAddItem : (updated) => editingIdx !== null && handleEditItem(editingIdx, updated)}
              onSaveDebt={addingItem ? handleCreateDebt : undefined}
              onCancel={() => { setAddingItem(false); setEditingIdx(null); }}
```

Change to:

```typescript
              onSave={addingItem ? handleAddItem : (updated) => editingIdx !== null && handleEditItem(editingIdx, updated)}
              onLiabilityCreated={addingItem ? handleLiabilityCreated : undefined}
              onCancel={() => { setAddingItem(false); setEditingIdx(null); }}
```

- [ ] **Step 5: Show the picked savings account on SAVING list rows**

Find:

```typescript
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {item.category?.icon && <span className="text-sm">{item.category.icon}</span>}
                        <p className="text-[14px] font-medium truncate">{item.name}</p>
                      </div>
                      {item.category && (
                        <p className="text-[11px] text-muted-foreground">{item.category.name}</p>
                      )}
                      {item.notes && !item.category && (
                        <p className="text-[11px] text-muted-foreground">{item.notes}</p>
                      )}
                    </div>
```

Change to:

```typescript
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {item.category?.icon && <span className="text-sm">{item.category.icon}</span>}
                        {item.account && <span className="text-sm">{ACCOUNT_EMOJI[item.account.type] ?? "💰"}</span>}
                        <p className="text-[14px] font-medium truncate">{item.name}</p>
                      </div>
                      {item.category && (
                        <p className="text-[11px] text-muted-foreground">{item.category.name}</p>
                      )}
                      {item.account && !item.category && (
                        <p className="text-[11px] text-muted-foreground">{item.account.name}</p>
                      )}
                      {item.notes && !item.category && !item.account && (
                        <p className="text-[11px] text-muted-foreground">{item.notes}</p>
                      )}
                    </div>
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/budget/[year]/[month]/page.tsx"
git commit -m "feat(ui): wire month-detail page to PLANNED-debt DebtForm + show savings account on rows"
```

---

### Task 8: Playwright e2e verification

**Files:** none modified — verification only.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev -- -p 3001
```

Wait for `Ready` in the output.

- [ ] **Step 2: Write the verification script**

Create a temporary file `/tmp/verify-plan6.mjs`:

```javascript
import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = `plan6-${Date.now()}@test.local`;
const PASSWORD = "TestPass123!";

const browser = await chromium.launch();
const page = await browser.newPage();
let pass = 0, fail = 0;

function check(label, condition) {
  if (condition) { console.log(`PASS: ${label}`); pass++; }
  else { console.log(`FAIL: ${label}`); fail++; }
}

// Register + login
await page.goto(`${BASE}/register`);
await page.fill('input[name="name"]', "Plan6 Tester");
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 });
check("registered + redirected to dashboard", page.url().includes("/dashboard"));

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

// --- SAVING: create new wallet inline, item should show it ---
await page.goto(`${BASE}/budget/${year}/${month}`);
await page.click("text=เพิ่มรายการงบ");
await page.click("text=ออม/ลงทุน");
await page.click("text=+ สร้างกระเป๋าออมใหม่");
await page.fill('input[placeholder="ชื่อกระเป๋าออมใหม่"]', "กองทุนฉุกเฉิน");
await page.click('button:has-text("เพิ่ม")');
await page.waitForTimeout(800);
const walletSelected = await page.locator("select").first().inputValue();
check("new savings account auto-selected after inline create", walletSelected.length > 0);

await page.fill('input[placeholder="ชื่อรายการ เช่น เงินเดือน, ค่าเช่า"]', "เก็บฉุกเฉิน");
await page.fill('input[placeholder="จำนวนเงินวางแผน (บาท)"]', "2000");
await page.click('button:has-text("บันทึก")');
await page.waitForTimeout(800);
check("SAVING item with account shows wallet name on the row", await page.locator("text=กองทุนฉุกเฉิน").count() >= 1);

// --- LIABILITY: full DebtForm creates a PLANNED debt ---
await page.click("text=เพิ่มรายการงบ");
await page.click("text=หนี้สิน");
check("DebtForm fields render for new LIABILITY (not the old totalMonths/start-month fields)",
  await page.locator('text=ยอดเงินทั้งหมด (บาท)').count() === 1);
await page.fill('input[placeholder="0.00"]', "12000");
await page.fill('input[placeholder="เช่น ผ่อน iPhone, Shopee PayLater"]', "วางแผนซื้อ iPad");
await page.fill('input[placeholder="12"]', "10");
await page.click('button:has-text("สร้างหนี้สินวางแผน")');
await page.waitForTimeout(1000);
check("PLANNED liability item appears in the month list", await page.locator("text=วางแผนซื้อ iPad").count() >= 1);

// Confirm it actually landed as a PLANNED debt with no payment schedule yet
await page.goto(`${BASE}/debts`);
await page.click("text=วางแผน");
check("new debt shows under the /debts วางแผน (PLANNED) tab", await page.locator("text=วางแผนซื้อ iPad").count() >= 1);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 3: Run it**

```bash
node /tmp/verify-plan6.mjs
```

Expected: all checks `PASS`, exit code 0. If any `FAIL`, fix the underlying code (not the script) unless the script's own selector is wrong, then re-run.

- [ ] **Step 4: Clean up the fixture user**

```bash
npx prisma studio
```

Open `http://localhost:5555`, find the `plan6-*@test.local` user in the `User` table, delete it (cascades to their accounts/budgets/debts). Close Prisma Studio (`Ctrl+C`).

- [ ] **Step 5: Stop the dev server and delete the temp script**

```bash
rm /tmp/verify-plan6.mjs
```

Stop the `npm run dev` process (`Ctrl+C` in its terminal, or kill the background job).

- [ ] **Step 6: Final whole-plan type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. This confirms Tasks 1-7 compose correctly end-to-end.

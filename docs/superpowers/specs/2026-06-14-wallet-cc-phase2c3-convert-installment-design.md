# Wallet/CC Phase 2C-3: Convert to Installment (แปลงเป็นยอดผ่อน) + Tier Gating

## Context

C-1 (label rename + `Debt.accountId` link) and C-2 (linked-debt remaining
subtracted from CC balance + reverse debt list on `/accounts/[id]`) are
shipped (`a28f78b`, live on prod).

This spec covers C-3: the real-world "แปลงยอดเป็นผ่อน" flow — a Thai
cardholder swipes a credit card a few times, then before the statement
cutoff calls the bank (or uses the app) to convert some of those swipes into
an installment plan. The converted amount stops being "this cycle's spend"
and instead becomes N monthly installments starting **next** cycle.

C-3 is also the first concrete use of a `User.tier` (FREE/PRO) concept.

**Supersedes C-2 spec's "Future Work" analysis** — that analysis assumed the
original transaction would be *deleted* at conversion time, causing a
retroactive-history problem. This spec instead **keeps the original
transaction(s)**, tags them via `convertedToDebtId`, and excludes them from
sum-aggregates. No retroactive history change; the converted amount
disappears from *this* cycle's totals (correct — it's being deferred to next
cycle) without altering *past* months.

## A. Schema Changes

```prisma
enum UserTier {
  FREE
  PRO
}

model User {
  // ...existing fields...
  tier UserTier @default(FREE)
}

model Transaction {
  // ...existing fields...
  convertedToDebtId String? @map("converted_to_debt_id")
  convertedToDebt   Debt?   @relation("DebtConvertedTransactions", fields: [convertedToDebtId], references: [id])

  @@index([convertedToDebtId])
}

model Debt {
  // ...existing fields, interestRate already present (Decimal? @db.Decimal(5,2))...
  convertedTransactions Transaction[] @relation("DebtConvertedTransactions")
}
```

`User.tier` has **no billing integration in C-3** — set directly via DB for
testing/QA. Subscription/payment flow is a separate future project (see
`public-launch-prep` memory).

`Debt.interestRate` already exists and is unused. C-3 gives it a concrete
semantic: **always stored as a monthly flat rate** (e.g. `1.50` = 1.5%/month).

## B. Tier-agnostic: Interest Rate on Manual Debt Form

`DebtForm` (`src/components/forms/debt-form.tsx`) gains an optional
**อัตราดอกเบี้ย** input with a ต่อเดือน/ต่อปี toggle. Annual input is
divided by 12 before submit — the API and DB only ever see a monthly rate.
Available to **all tiers** (FREE included).

**Important distinction (resolves a potential ambiguity):**

- **Manual entry (this section):** `interestRate` is **informational only**.
  It does NOT recompute `totalAmount`/`monthlyAmount` — those remain
  user-entered exactly as today (a long-term loan's monthly payment is a
  fixed number the bank already told the user). The rate is stored and
  displayed on `/debts/[id]` (e.g. "ดอกเบี้ย 1.5% ต่อเดือน") for reference.
- **Conversion flow (Section C):** `interestRate` **does** drive the
  calculation, because the user is converting raw purchase amounts
  (principal) and the app computes the resulting total — this is the actual
  PRO convenience.

`createDebtSchema`/`updateDebtSchema` (`src/lib/validations/debt.ts`) gain
optional `interestRate: z.number().min(0).max(99.99).nullable().optional()`.

## C. Convert-to-Installment Feature

### C.1 Entry Point

In the existing "แก้ไขรายการ" edit sheet (`TransactionForm`, opened from the
edit button on each `/transactions` row), show a new button **"แบ่งชำระราย
เดือน"** when all of:
- `tx.type === "EXPENSE"`
- `tx.isTransfer === false`
- `tx.account?.type === "CREDIT_CARD"`
- `tx.convertedToDebtId === null`

Tapping it opens a new `ConvertToInstallmentDialog` (separate dialog, stacked
over or replacing the edit sheet).

### C.2 FREE flow

Dialog shows:
- Read-only summary of the transaction (date, category, description, amount)
- Input **จำนวนเดือน** (`totalMonths`, integer 1-360 per existing
  `createDebtSchema` bounds)
- Live preview: **ยอดผ่อน/เดือน** = `amount / totalMonths`
- **ชื่อรายการหนี้** (`name`), prefilled e.g. `"ผ่อน: {description ||
  category.name}"`, editable, required (same validation as `DebtForm`)
- `interestRate` not shown (or shown disabled with a one-line "ใส่ดอกเบี้ย /
  รวมหลายรายการ → อัพเกรด Pro" note)

Submit → `POST /api/v1/debts/convert` with `{ transactionIds: [tx.id],
totalMonths, name }`.

### C.3 PRO flow

Same dialog, plus:
- Collapsible section **"+ เลือกรายการอื่นที่จะรวมผ่อนด้วย"** — on expand,
  fetches `GET /api/v1/debts/convertible-transactions?accountId=...&excludeId=tx.id`
  and renders each as a checkbox row (date/category/amount). Running total at
  top of the dialog updates live as items are checked.
- **อัตราดอกเบี้ย** input + ต่อเดือน/ต่อปี toggle (same component as Section
  B), optional, default 0.
- Live preview recalculates: `totalAmount = sum(selected amounts) × (1 +
  monthlyRate × totalMonths)`, `monthlyAmount = totalAmount / totalMonths`.

Submit → `POST /api/v1/debts/convert` with `{ transactionIds: [tx.id,
...selected], totalMonths, interestRate, name }`.

### C.4 `POST /api/v1/debts/convert`

New validation schema `convertToDebtSchema`:
```ts
{
  transactionIds: z.array(z.string().min(1)).min(1),
  totalMonths: z.number().int().min(1).max(360),
  interestRate: z.number().min(0).max(99.99).nullable().optional(),
  name: z.string().min(1).max(100),
}
```

Server logic (single `prisma.$transaction`):
1. Auth check (401 if no session).
2. Fetch transactions: `WHERE id IN transactionIds AND userId = session.user.id
   AND type = "EXPENSE" AND isTransfer = false AND convertedToDebtId = null`,
   include `account`. If the returned count ≠ `transactionIds.length` → 400
   (some id is invalid / not owned / already converted / wrong type).
3. All fetched transactions must share the same `accountId`, and that
   account's `type` must be `"CREDIT_CARD"` → 400 otherwise ("ต้องเป็นรายการ
   จากบัญชีบัตรเครดิต/สินเชื่อใบเดียวกัน").
4. **Tier checks** (403 "ฟีเจอร์นี้สำหรับ Pro" if violated):
   - `transactionIds.length > 1` → requires `user.tier === "PRO"`.
   - `interestRate` truthy (> 0) → requires `user.tier === "PRO"`.
5. Compute:
   - `principal = sum(tx.amount)`
   - `totalAmount = principal × (1 + (interestRate ?? 0) × totalMonths)`
   - `monthlyAmount = totalAmount / totalMonths`
   - `startDate = addMonths(today, 1)`, `endDate = addMonths(startDate,
     totalMonths - 1)`
6. Create `Debt` (`status: "ACTIVE"`, `accountId` = the shared account id,
   `interestRate`, computed amounts/dates).
7. Generate `DebtPayment`s (all `PENDING`) + LIABILITY `BudgetItem`s — reuse
   the existing generation loop from `POST /api/v1/debts`
   (`src/app/api/v1/debts/route.ts:133-173`), extracted into a shared helper
   `createDebtPaymentsAndBudgetItems(tx, debt, totalMonths, monthlyAmount,
   startDate)` called from both routes.
8. `updateMany` the selected transactions: `convertedToDebtId = debt.id`.
9. Return `{ debt: <enriched like GET /debts>, convertedTransactionIds }`.

### C.5 `GET /api/v1/debts/convertible-transactions`

Query params: `accountId` (required), `excludeId` (optional).

- 401 if no session; 404 if `accountId` doesn't belong to
  `session.user.id` or `account.type !== "CREDIT_CARD"`.
- Returns `Transaction[]` where `userId = session.user.id`, `accountId`,
  `type = "EXPENSE"`, `isTransfer = false`, `convertedToDebtId = null`, `id !=
  excludeId`, ordered by `date desc`, capped at 50.
- Each item: `{ id, date, description, amount, category: { id, name } }`.

## D. Balance / Aggregate Ripple

**Principle:** any query that *sums* `Transaction.amount` for P&L purposes
(income/expense totals, by-category, monthly comparisons, exports, budget
comparisons) currently filters `isTransfer: false` for these sums — it must
**also** filter `convertedToDebtId: null`. Plain *list/detail* views are
unaffected: a converted transaction still appears in `/transactions` (with a
badge, see Section G), just excluded from totals.

**Known case (fully specified):** `src/lib/account-balance.ts` — the
`income`/`expense` aggregates (lines 9-16) each get `convertedToDebtId: null`
added alongside `isTransfer: false`. The `linkedDebtRemaining` calc (C-2,
lines 38-44) is unaffected — it already represents the new Debt's obligation.

**Files to audit at planning time** (grep hit on `isTransfer: false`,
confirm each sum-context and add the same filter):
- `src/app/api/v1/dashboard/summary/route.ts`
- `src/app/api/v1/dashboard/by-category/route.ts`
- `src/app/api/v1/dashboard/category-trend/route.ts`
- `src/app/api/v1/transactions/summary/route.ts`
- `src/app/api/v1/transactions/route.ts` (list query unaffected; any embedded
  summary aggregate needs the filter)
- `src/app/api/v1/accounts/summary/route.ts`
- `src/app/api/v1/accounts/[id]/route.ts`
- `src/app/api/v1/budgets/comparison/route.ts`
- `src/app/api/v1/budgets/yearly-comparison/route.ts`
- `src/app/api/v1/family/summary/route.ts`
- export endpoint(s) (PDF/CSV) wherever they reuse these aggregates

## E. Traceability — `/debts/[id]` "แปลงมาจากรายการ"

`GET /api/v1/debts/[id]` (`src/app/api/v1/debts/[id]/route.ts`) adds
`convertedTransactions` to its `include`:
```ts
convertedTransactions: {
  select: { id: true, date: true, description: true, amount: true,
            category: { select: { id: true, name: true } } },
  orderBy: { date: "asc" },
}
```

On `/debts/[id]`, render a new section **"แปลงมาจากรายการ"** below the
existing payment-progress UI, shown only when `convertedTransactions.length >
0`. Each row: date, category name, description, amount — read-only, no link
back to `/transactions` needed (the originals aren't separately actionable).

Category-level budget linkage for converted debts (tying the LIABILITY
budget item back to the original categories for plan-vs-actual) is **out of
scope** — deferred to the upcoming budget-page overhaul, same as all other
debt-derived LIABILITY items today.

## F. Undo Conversion

New endpoint `POST /api/v1/debts/[id]/unconvert`.

**Allowed only when:**
- `debt.convertedTransactions.length > 0` (it was actually a conversion), AND
- `paidCount === 0` (no `DebtPayment` has `status === "PAID"`), AND
- `debt.status === "ACTIVE"`

Otherwise → 400 "ไม่สามารถยกเลิกการแปลงได้" (e.g. payments already made —
direct the user to the existing "ยกเลิกหนี้" → `CANCELLED` flow instead,
which does not restore the original transactions).

Server logic (single `$transaction`):
1. Verify conditions above (404 if debt not found/not owned, 400 otherwise).
2. `updateMany` the linked transactions: `convertedToDebtId = null`.
3. Delete the `Debt` — both `DebtPayment.debt` and `BudgetItem.debt` are
   `onDelete: Cascade`, so its `DebtPayment`s and LIABILITY `BudgetItem`s are
   removed automatically.

**UI:** on `/debts/[id]`, show button **"ยกเลิกการแปลง"** (with confirm
dialog) only when `convertedTransactions.length > 0 && paidCount === 0`. If
`paidCount > 0`, the button is omitted entirely (no disabled-with-tooltip —
keeps the page simple; the existing "ยกเลิกหนี้" action remains available
regardless).

## G. `/transactions` UI Changes

- Row: if `tx.convertedToDebtId` is set, render a muted badge **"ผ่อนแล้ว"**
  next to the amount, linking to `/debts/[id]`. Amount itself still displays
  normally (for record-keeping) — the badge communicates *why* it's excluded
  from period totals.
- Edit sheet (`TransactionForm`): when `convertedToDebtId` is set, the
  "แบ่งชำระรายเดือน" button (Section C.1) is replaced by a read-only info row
  linking to the debt — no further action from here (use `/debts/[id]` →
  "ยกเลิกการแปลง" if needed).

## Error Handling / Edge Cases

| Condition | Result |
|---|---|
| `transactionIds` contains an id not owned by user / already converted / wrong type | 400, whole request rejected (atomic — no partial conversion) |
| Selected transactions span >1 account | 400 "ต้องเป็นรายการจากบัญชีเดียวกัน" |
| FREE user submits `transactionIds.length > 1` | 403 |
| FREE user submits `interestRate > 0` | 403 |
| `accountId` not `CREDIT_CARD` type | 400 |
| Undo requested but `paidCount > 0` | 400, button not shown in UI |
| Undo requested on a debt with no `convertedTransactions` (manually created) | 400 / button not shown |
| `convertible-transactions` called with `accountId` not owned or not `CREDIT_CARD` | 404 |

## Testing / Verification Plan

1. `npx tsc --noEmit` clean.
2. Unit test: flat-rate helper — `principal=3000, months=3, rate=0` →
   `totalAmount=3000`; `rate=1.5` → `totalAmount=3000×(1+0.015×3)=3135`.
3. Integration `POST /api/v1/debts/convert`:
   - FREE, single tx, no interest → 201, Debt created, `startDate` = next
     month, tx's `convertedToDebtId` set.
   - FREE, `transactionIds.length=2` → 403.
   - FREE, `interestRate=1.5` → 403.
   - PRO, multi-tx + interest → 201, `totalAmount` matches formula, all N
     `DebtPayment`s `PENDING`.
   - Cross-account selection → 400.
   - Re-converting an already-converted tx → 400.
4. Integration `POST /api/v1/debts/[id]/unconvert`:
   - `paidCount===0` → 200, Debt/payments/budgetItems deleted,
     `convertedToDebtId` cleared on originals.
   - `paidCount>0` → 400.
5. `account-balance.ts`: after FREE conversion, account balance unchanged
   (principal moved from netActivity to linkedDebtRemaining, net zero). After
   PRO conversion with interest, balance decreases by the interest amount
   (new liability incurred).
6. Playwright e2e (430px viewport): convert a CC expense via the edit sheet
   (FREE path), verify "ผ่อนแล้ว" badge appears, verify `/debts/[id]` shows
   "แปลงมาจากรายการ" with the original transaction, verify next month's
   `DebtPayment` due date.
7. Clean up fixtures after.

## Out of Scope

- Subscription/billing integration for `User.tier` (separate project, see
  `public-launch-prep` memory) — tier set via DB for C-3.
- Bank-preset / minimum-amount / fixed-term configuration system — user
  enters `totalMonths`/`interestRate` manually per conversion every time.
- Category-level budget plan-vs-actual linkage for converted debts (Section
  E) — deferred to the budget-page overhaul.
- Statement-cycle / billing-date modeling — `convertible-transactions` shows
  *all* un-converted CC expenses for the account, no date-range restriction.
- Tier-display / upgrade-CTA UI — not needed since tier is DB-set for now.

# Wallet/CC Phase 2C-1: "บัตรเครดิต/สินเชื่อ" Label Rename + Debt↔Account Link

## Context

This is the first of (at least) two sub-specs for sub-project C
(see `project_state` memory). Sub-project C's overall goal is to let
installment debts (`Debt`) be converted from / linked to credit-card or
loan accounts, with a future tier-gated interest calculation. Before that
core conversion flow can be designed, two foundational pieces need to land:

1. The `AccountType.CREDIT_CARD` Thai label is currently "บัตรเครดิต"
   (literally "credit card"), but most installment debts in this app are
   actually paid via a credit card, a bank loan, or a third-party
   PayLater/BNPL provider — not just literal credit cards. The label needs
   broadening to "บัตรเครดิต/สินเชื่อ" so the type reads naturally as "the
   account I owe money on / pay installments through", covering all three
   cases.
2. `Debt` records have no way to reference which account (credit card or
   loan) they're billed through. Adding `Debt.accountId` lets a user
   optionally tag a manually-created debt (e.g. "ผ่อน iPhone ผ่านบัตร UOB")
   with the relevant account, and lays the FK groundwork that the later
   "convert CC expense → Debt" flow (sub-spec C2) will populate
   automatically.

This sub-spec covers ONLY the label rename + the `Debt.accountId` link
(read-only display, set at debt-creation time). It does NOT cover: the
expense→Debt conversion flow, tier gating / `User.tier`, a reverse
"debts linked to this account" list on the account detail page, the
deferred "ชำระยอดนี้" button on `/transactions`, or the "เปลี่ยนเป็นยอดผ่อน"
button on the CC detail page. All of those are explicitly deferred to C2/C3.

## A. Label Rename (6 strings)

Replace "บัตรเครดิต" → "บัตรเครดิต/สินเชื่อ" in exactly these 6 locations:

| File:Line | Current | New |
|---|---|---|
| `src/app/(app)/accounts/[id]/page.tsx:40` | `CREDIT_CARD: "บัตรเครดิต"` (TYPE_LABEL map) | `CREDIT_CARD: "บัตรเครดิต/สินเชื่อ"` |
| `src/components/forms/account-form.tsx:43` | `{ value: "CREDIT_CARD", label: "บัตรเครดิต", emoji: "💳" }` (type picker) | `label: "บัตรเครดิต/สินเชื่อ"` |
| `src/app/(app)/dashboard/page.tsx:139` | `"ยอดบัตรเครดิตค้างจ่าย"` (outstanding-balance row label) | `"ยอดบัตรเครดิต/สินเชื่อค้างจ่าย"` |
| `src/app/(app)/dashboard/page.tsx:899` | `"💳 บัตรเครดิต"` (wallet-card section header) | `"💳 บัตรเครดิต/สินเชื่อ"` |
| `src/app/(app)/transactions/page.tsx:389` | `"💳 บัตรเครดิต"` (transaction-row pill tag, shown when `tx.account?.type === "CREDIT_CARD"`) | `"💳 บัตรเครดิต/สินเชื่อ"` |
| `src/app/(app)/accounts/[id]/page.tsx:130` | `"ชำระบัตรเครดิต"` (pay button, shown for CC accounts) | `"ชำระบัตรเครดิต/สินเชื่อ"` |

Explicitly OUT of scope (leave as-is, different concepts):
- `src/lib/seed-defaults.ts:86` — `name: "บัตรเครดิต"` is the *default account
  name* given to new users (user-editable `Account.name`, not a type label).
- `src/components/forms/payment-method-form.tsx:30` —
  `CREDIT_CARD: "บัตรเครดิต"` belongs to the legacy `PaymentMethod.type` enum,
  a separate model from `Account.type`.
- The enum value `AccountType.CREDIT_CARD` itself is unchanged — this is a
  display-string-only change.

**Layout risk:** the transaction-row pill tag (`transactions/page.tsx:389`)
and the dashboard wallet-card header (`dashboard/page.tsx:899`) currently fit
"💳 บัตรเครดิต" on one line in a compact pill/row at mobile width (~430px).
"💳 บัตรเครดิต/สินเชื่อ" is ~4 characters longer. This must be checked visually
during verification (see Testing section) — if it wraps or gets clipped, the
fallback is to shorten to "💳 สินเชื่อ" for the pill tag only (still
unambiguous in context), decided during implementation if needed.

## B. Schema Changes

Add an optional `accountId` FK from `Debt` to `Account`, mirroring the
existing `Transaction.accountId` / `RecurringTransaction.accountId` pattern
(nullable, no special `onDelete` behavior — same as those two models). Also
add the back-relation array on `Account` so Prisma's client exposes
`account.debts` for sub-spec C2/C3 to query later (no UI consumes this yet).

```prisma
model Debt {
  // ...existing fields unchanged...
  accountId     String?      @map("account_id")
  account       Account?     @relation(fields: [accountId], references: [id])

  payments    DebtPayment[]
  budgetItems BudgetItem[]

  // ...existing timestamps...

  @@index([userId, status])
  @@index([familyGroupId])
  @@index([accountId])
}

model Account {
  // ...existing fields unchanged...

  transactions  Transaction[]
  recurringTxns RecurringTransaction[]
  transfersFrom Transfer[]   @relation("TransferFrom")
  transfersTo   Transfer[]   @relation("TransferTo")
  debts         Debt[]
}
```

One new migration (e.g. `add_debt_account_link`), no data backfill needed —
all existing `Debt` rows get `accountId = NULL`, which is a valid permanent
state (e.g. "ยืมเงินเพื่อน" has no linked account).

## C. Validation + API

**`src/lib/validations/debt.ts`** — `createDebtSchema` gains:
```ts
accountId: z.string().min(1).nullable().optional(),
```
(`updateDebtSchema` is NOT touched — see "Out of scope" below.)

**`POST /api/v1/debts`** (`src/app/api/v1/debts/route.ts`):
- Destructure `accountId` from `parsed.data` alongside the existing fields.
- If `accountId` is truthy, look it up with
  `prisma.account.findFirst({ where: { id: accountId, userId: session.user.id, type: "CREDIT_CARD" } })`.
  If not found, return `404 { code: "NOT_FOUND", message: "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ" }`
  — this single check covers "doesn't exist", "belongs to another user", and
  "isn't a บัตรเครดิต/สินเชื่อ account", matching the existing
  `accountId` ownership-check pattern used in `transactions/route.ts:157-163`.
- Pass `accountId: accountId ?? null` into `tx.debt.create({ data: {...} })`.

**`GET /api/v1/debts`** (list) and **`GET /api/v1/debts/[id]`** (detail):
- Add `account: { select: { id: true, name: true } }` to the existing
  `include` block on both queries. (`type` is not needed in the response —
  the link target is always a บัตรเครดิต/สินเชื่อ account by construction.)

**Out of scope:** `updateDebtSchema` and `PUT /api/v1/debts/[id]` are not
modified. `DebtForm` is create-only and the PUT route currently has no
frontend caller (verified via grep) — adding `accountId` to an unused update
path would be dead code. Existing debts can only get an `accountId` via a
future "link this debt" action (C2/C3), not via this sub-spec.

## D. UI

**`src/components/forms/debt-form.tsx`**:
- On mount, fetch `/api/v1/accounts`, filter client-side to
  `accounts.filter(a => a.type === "CREDIT_CARD")`.
- Add a new `FormRow label="ผ่อนผ่านบัญชี (ถ้ามี)"` after the existing
  "หมายเหตุ" row, containing a `Select`:
  - `value={watch("accountId") ?? "none"}`
  - `onValueChange`: `"none"` → `setValue("accountId", null, ...)`, else →
    `setValue("accountId", val, ...)`
  - Options: `<SelectItem value="none">ไม่ระบุ</SelectItem>` followed by one
    `<SelectItem value={acc.id}>💳 {acc.name}</SelectItem>` per filtered
    account.
  - If the filtered list is empty, the Select still renders with only
    "ไม่ระบุ" available (no special-case needed — same as other optional
    pickers in this codebase when a user has zero accounts of a type).

**`src/app/(app)/debts/[id]/page.tsx`**:
- After the GET response includes `debt.account` (`{id, name} | null`), add
  a row rendered only when `debt.account` is non-null:
  `"ผ่อนผ่าน: 💳 {debt.account.name}"`, wrapped in a `Link` to
  `/accounts/${debt.account.id}` (same visual pattern as other
  navigable summary rows on this page — exact placement/styling decided
  during implementation to match surrounding card layout).

## Error Handling Summary

| Condition | Result |
|---|---|
| `accountId` omitted or `null` | `debt.accountId = null`, no row shown on detail page |
| `accountId` references an account owned by another user | `404 NOT_FOUND "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ"` |
| `accountId` references an account that exists but is not `type: CREDIT_CARD` | same `404 NOT_FOUND "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ"` (indistinguishable by design — don't leak existence of accounts the user can't link) |

## Testing / Verification Plan

1. `npx tsc --noEmit` — must be clean.
2. Playwright e2e against a throwaway fixture account (`npm run dev -- -p 3001`,
   pattern from prior sub-specs), covering:
   - Create a debt with no account selected ("ไม่ระบุ") → list/detail show
     no "ผ่อนผ่าน" row, `accountId: null` in API response.
   - Create a debt with a CREDIT_CARD account selected → detail page shows
     "ผ่อนผ่าน: 💳 {name}", clicking navigates to `/accounts/[id]`.
   - POST `/api/v1/debts` with `accountId` pointing at a non-CC account (e.g.
     a CASH account) → `404 NOT_FOUND`.
   - POST with `accountId` pointing at another user's account → `404 NOT_FOUND`.
   - Screenshot check: `/accounts` list, `/accounts/[id]` (CC), `/dashboard`
     (wallet card + outstanding row), `/transactions` (💳 pill tag) all render
     "บัตรเครดิต/สินเชื่อ" without visual clipping/wrapping at mobile width.
3. Clean up fixture account + temporary scripts after.

## Future Work (sub-spec C2/C3, NOT this spec)

- "Convert CC expense → Debt" flow — new debts created this way get
  `accountId` pre-filled to the source CC account automatically.
- `User.tier` field + paid-tier interest calculation
  (`Debt.interestRate`, flat-rate per CLAUDE.md decision #6).
- Reverse "หนี้ที่ผูกกับบัญชีนี้" list on `/accounts/[id]`, using the
  `Account.debts` back-relation added in section B.
- Deferred-from-B items: per-transaction "ชำระยอดนี้" button on
  `/transactions` 💳 rows; "เปลี่ยนเป็นยอดผ่อน" button on CC detail page
  (2-button row alongside "ชำระบัตรเครดิต/สินเชื่อ").
- A path for retroactively setting `accountId` on debts created before this
  sub-spec (currently impossible — no debt-edit UI exists).

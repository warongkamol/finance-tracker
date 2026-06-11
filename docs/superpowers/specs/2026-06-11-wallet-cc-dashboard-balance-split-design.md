# Wallet/Credit Card Phase 2A — Dashboard Balance Split + Tx-List Credit-Card Tag

## Overview

After the Phase 1 Wallet/Credit Card system shipped (`8e7d697`), the dashboard's
"คงเหลือสุทธิ" (BalanceHero) headline still includes credit-card-paid expenses
in its calculation. When a user pays with a credit card, this number drops even
though no cash actually left their wallet — confusing, since a separate
"กระเป๋าเงิน" card lower on the page already shows the correct cash-only figure.

This is sub-project A of the "Wallet/CC Phase 2" decomposition (see project
memory `project_state.md`, "Wallet/Credit Card Phase 2 — Cash vs Credit
separation"). Two independent fixes, bundled because both touch the dashboard
and transaction list and are individually small:

1. Make "คงเหลือสุทธิ" reflect actual cash on hand, and surface a new "ยอดบัตร
   เครดิตค้างจ่าย" (credit card amount currently owed) figure right under it.
2. Add a 💳 "บัตรเครดิต" tag to transaction-list rows for expenses paid via a
   CREDIT_CARD account — same visual pattern as the existing 💳 "งวด N" (debt
   installment) and 👨‍👩‍👧 (family) tags.

## Design Decisions

### Item 1 — "คงเหลือสุทธิ" + "ยอดบัตรเครดิตค้างจ่าย"

**Confirmed semantics (user-verified worked example):**
- Cash wallet = ฿1,000. Spend ฿500 on credit card → "คงเหลือสุทธิ" stays
  ฿1,000 (cash untouched), "ยอดบัตรเครดิตค้างจ่าย" = ฿500.
- Then transfer/pay ฿300 from cash to that credit card (even mid-cycle,
  before the statement closes) → "คงเหลือสุทธิ" becomes ฿700, "ยอดบัตรเครดิต
  ค้างจ่าย" becomes ฿200.

**Key finding:** the existing `computeAccountBalance()` helper
(`src/app/api/v1/accounts/route.ts:7-36`, already used for the per-account
`balance` shown on `/accounts` and `/accounts/[id]`) already implements this
correctly:

```
balance = initialBalance + allTimeIncome - allTimeExpense - transferOut + transferIn
```

For a CREDIT_CARD account, `transferIn` already nets out any payment made via
the existing Account→Account `Transfer` flow, regardless of statement-cycle
boundaries. So:

- `liquidTotal` (already computed in `/api/v1/accounts/summary`, sum of
  `computeAccountBalance()` over non-CREDIT_CARD accounts) = the new
  "คงเหลือสุทธิ" headline value.
- `creditOutstanding = Σ max(0, -computeAccountBalance(acc))` over CREDIT_CARD
  accounts = the new "ยอดบัตรเครดิตค้างจ่าย" value. **No new running-balance
  bug-fix logic needed** — this is a straightforward aggregation reusing the
  existing correct formula.

**Explicitly NOT changed:**
- รายรับ/รายจ่ายเดือนนี้ stat boxes — stay fed by `/api/v1/dashboard/summary`'s
  `totalIncome`/`totalExpense` (all transactions including credit-card spend).
  This remains the "total spending this month" figure for budget tracking,
  intentionally a different concern from "cash on hand".
- The lower "กระเป๋าเงิน" wallet card's existing "ใช้ไป / limit" line
  (`creditUsed`/`creditLimit`, statement-cycle-scoped) — unrelated metric
  (credit-limit utilization vs. amount owed), still has the known cycle-bug
  (sub-project B), out of scope here.

### Item 2 — 💳 บัตรเครดิต tag on transaction rows

Same visual pattern as the existing `tx.debtPayment` ("💳 งวด N") and
`tx.isFamily` ("👨‍👩‍👧 ...") tags in the transaction list. Shown when
`tx.account?.type === "CREDIT_CARD"`.

## Implementation Plan (file-level)

### 1. Shared balance helper — extract, don't duplicate
- New file `src/lib/account-balance.ts` exporting `computeAccountBalance(accountId, initialBalance): Promise<number>`,
  moved verbatim from `src/app/api/v1/accounts/route.ts:7-36`.
- `src/app/api/v1/accounts/route.ts` imports it instead of defining it locally.

### 2. `/api/v1/accounts/summary/route.ts`
- Import `computeAccountBalance` from the new shared helper.
- For each CREDIT_CARD account (the existing `creditAccounts` array, already
  filtered at line 18), compute `Math.max(0, -(await computeAccountBalance(acc.id, Number(acc.initialBalance))))`
  and sum into `creditOutstanding`.
- Add `creditOutstanding: number` to the JSON response, alongside existing
  `liquidTotal`, `creditUsed`, `creditLimit`, `hasCreditCards`.
- Existing `creditUsed`/`creditLimit`/cycle logic (lines 52-63) stays
  unchanged.

### 3. `src/app/(app)/dashboard/page.tsx`
- Extend the `walletSummary` state type (line 636-641) with
  `creditOutstanding: number`.
- `BalanceHero` component (lines 110-145):
  - New props: `walletSummary: { liquidTotal: number; creditOutstanding: number; hasCreditCards: boolean } | null`,
    `walletLoading: boolean`.
  - Loading guard becomes `if (loading || !summary || walletLoading || !walletSummary)`.
  - "คงเหลือสุทธิ" value → `walletSummary.liquidTotal` (was `summary.balance`).
    `isPositive` check also switches to `walletSummary.liquidTotal >= 0`.
  - New conditional block directly under the headline, rendered only when
    `walletSummary.hasCreditCards`: small row showing "ยอดบัตรเครดิตค้างจ่าย"
    label + `formatCurrency(walletSummary.creditOutstanding)` (red/destructive
    tone, consistent with how negative amounts are styled elsewhere).
  - รายรับ/รายจ่าย boxes (lines 129-142) unchanged.
- Where `<BalanceHero summary={summary} loading={loadingMonth} />` is rendered
  (~line 895), pass `walletSummary={walletSummary} walletLoading={walletLoading}`.

### 4. `/api/v1/transactions/route.ts` (GET)
- Line 77: `account: { select: { id: true, name: true } }` →
  `account: { select: { id: true, name: true, type: true } }`.

### 5. `src/app/(app)/transactions/page.tsx`
- `Transaction.account` type (line 39): `{ id: string; name: string } | null`
  → `{ id: string; name: string; type: string } | null`.
- In the tag row (lines 375-387, alongside `tx.debtPayment` and `tx.isFamily`
  tags), add:
  ```tsx
  {tx.account?.type === "CREDIT_CARD" && (
    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FF3B30]/15 text-[#FF3B30]">
      💳 บัตรเครดิต
    </span>
  )}
  ```

## Out of Scope (deferred to later sessions)

- Sub-project B: fixing `creditUsed`/`cycleUsed` (statement-cycle scoped
  "ใช้ไป" not netting payments), dedicated "pay credit card" UI flow.
- Sub-project C: convert credit-card expense → Debt + interest, `user.tier`
  gating.
- Relabeling/redesigning the lower "กระเป๋าเงิน" card to avoid two
  superficially-similar credit-card numbers ("ใช้ไป/limit" vs "ค้างจ่าย") —
  noted as a possible future polish, not blocking.

## Verification Plan

- `tsc --noEmit` and `eslint` clean on all touched files.
- Playwright e2e against a fixture account (cleaned up after):
  1. Create CASH account, initialBalance ฿1,000.
  2. Create CREDIT_CARD account, creditLimit ฿10,000.
  3. Record EXPENSE ฿500 on the credit card → assert "คงเหลือสุทธิ" still
     shows ฿1,000, new "ยอดบัตรเครดิตค้างจ่าย" shows ฿500, and the transaction
     row shows the 💳 บัตรเครดิต tag.
  4. Transfer ฿300 from CASH → credit card → assert "คงเหลือสุทธิ" = ฿700,
     "ยอดบัตรเครดิตค้างจ่าย" = ฿200.
  5. Confirm รายรับ/รายจ่ายเดือนนี้ boxes still reflect total spend (unchanged
     behavior, includes the ฿500 credit-card expense).

# Wallet/Credit Card Phase 2B — Outstanding-Balance Display Fix + Pay-Credit-Card Flow

## Overview

Sub-project B of the "Wallet/CC Phase 2" decomposition (see project memory
`project_state.md`, "Wallet/Credit Card Phase 2 — Cash vs Credit separation").

Original framing assumed a "running balance that nets payments" needed to be
built from scratch. Investigation this session found that **it already
exists**: `computeAccountBalance()` (`src/lib/account-balance.ts`, used for
the per-account `balance` field and for `creditOutstanding` added in
sub-project A) is all-time and already does
`initialBalance + income - expense - transferOut + transferIn` — a payment
made via the existing Account→Account `Transfer` flow (cash → credit card)
already reduces it correctly, regardless of statement-cycle boundaries.
Worked example: spend ฿5,000 on CC → balance −5,000 → pay ฿5,000 via Transfer
→ balance 0. No new computation logic needed.

**The remaining real gap is display-only.** Two UI surfaces still show
`cycleUsed`/`creditUsed` (statement-cycle-scoped EXPENSE sum, does NOT net
payments) labeled "ใช้ไป" with a progress bar vs `creditLimit`:

1. `/accounts` list page — per-account CC row (`acc.cycleUsed`)
2. Dashboard's lower "กระเป๋าเงิน" card — aggregate (`walletSummary.creditUsed`)

Paying off the card does not move either number — this is the user-visible
bug. Meanwhile `balance` (per-account, all-time) and `creditOutstanding`
(aggregate, all-time, already added to `/api/v1/accounts/summary` in
sub-project A) sit unused in these two spots.

This sub-project: (1) replace both displays with the all-time outstanding
number, (2) add a dedicated "pay credit card" entry point reusing
`TransferForm`.

## Design Decisions

### Item 1 — Replace cycle-scoped "ใช้ไป" with all-time outstanding

**Confirmed (user, AskUserQuestion):** "แทนที่ด้วยยอดค้างชำระจริง" — replace
both displays with all-time outstanding everywhere; drop `cycleUsed`/
`creditUsed` entirely (no secondary "this cycle" line).

- `/accounts` list per-account "ใช้ไป" + progress bar →
  `Math.max(0, -acc.balance)` (uses the already-returned `balance` field).
- Dashboard lower wallet card "ใช้ไป" → `walletSummary.creditOutstanding`
  (already returned by `/api/v1/accounts/summary` since sub-project A).
- `cycleUsed` (per-account, `/api/v1/accounts` GET) and `creditUsed`
  (aggregate, `/api/v1/accounts/summary` GET) become dead fields — remove
  from both API responses and both frontend interfaces.
- `creditLimit` (aggregate, in `/api/v1/accounts/summary`) stays — but no
  longer needs a DB query; becomes a synchronous sum over `creditAccounts`
  once `creditUsed`'s per-account query loop is removed.
- `getCycleStart` (`src/lib/utils.ts`) becomes unused after this change in
  both routes — leave the util function itself in place (small, pure,
  plausibly useful for sub-project C's statement-cycle/interest logic), just
  remove the now-dead imports/calls in `accounts/route.ts` and
  `accounts/summary/route.ts`.

**Explicitly unaffected:** sub-project A's "ยอดบัตรเครดิตค้างจ่าย"
(`creditOutstanding` on dashboard `BalanceHero`) and "คงเหลือสุทธิ"
(`liquidTotal`) — both already correct, untouched by this change.

### Item 2 — Pay-credit-card button

**Confirmed (user):** Replace the existing "โอนออก" button on
`/accounts/[id]` for a CREDIT_CARD account with "ชำระบัตรเครดิต". One button,
not two — `TransferForm` already lets the user type any amount and pick the
source account, so it covers both month-end lump-sum and partial/weekly
payments without needing amount pre-fill.

- `TransferForm` (`src/components/forms/transfer-form.tsx`): add
  `defaultToAccountId?: string` prop, mirroring the existing
  `defaultFromAccountId`. Seeds the `toAccountId` default form value only —
  not locked, user can still change it via the existing `Select`.
- `/accounts/[id]` (`src/app/(app)/accounts/[id]/page.tsx`): when
  `isCreditCard`, render "ชำระบัตรเครดิต" instead of "โอนออก", passing
  `defaultToAccountId={account.id}` to `TransferForm` instead of
  `defaultFromAccountId={account.id}`. Non-credit-card accounts keep
  "โอนออก" with `defaultFromAccountId` unchanged.

**Forward-compat note for sub-project C:** C will add a "เปลี่ยนเป็นยอดผ่อน"
(convert-to-installment, paid-tier) button next to "ชำระบัตรเครดิต" on this
same card → becomes a 2-button row then. No layout change needed now (current
button is already full-width single); C's session restructures the
button row when it lands.

### Explicitly deferred / not built this round

- `/accounts` list quick-pay action per CC row — user confirmed not needed.
- `/transactions` per-tx "ชำระยอดนี้" prefill button on 💳 บัตรเครดิต-tagged
  rows — user-raised idea, but the system has no per-transaction
  payment-status concept (a payment only reduces the aggregate outstanding
  balance, doesn't mark a specific tx "paid"). This conceptually overlaps
  with sub-project C's "convert this expense → tracked Debt/installment",
  which DOES give real per-transaction tracking. Deferred to C's session —
  decide there whether/how a per-tx action belongs on `/transactions` rows.

## Implementation Plan (file-level)

### 1. `src/app/api/v1/accounts/route.ts`
- Remove `computeCycleUsed()` helper (lines 8-23) and `getCycleStart` import.
- In the `enriched` map, remove `cycleUsed` computation and drop `cycleUsed`
  from the returned object.

### 2. `src/app/api/v1/accounts/summary/route.ts`
- Remove `getCycleStart` import and the `creditResults`/`creditUsed` async
  loop (lines 53-64).
- Replace `creditLimit` with a synchronous sum:
  `creditAccounts.reduce((sum, acc) => sum + Number(acc.creditLimit ?? 0), 0)`.
- Remove `creditUsed` from the JSON response. Keep `liquidTotal`,
  `creditLimit`, `creditOutstanding`, `hasCreditCards`.

### 3. `src/app/(app)/accounts/page.tsx`
- Remove `cycleUsed: number | null` from the `Account` interface.
- In the CC row block (currently using `acc.cycleUsed ?? 0`), compute
  `const outstanding = Math.max(0, -acc.balance);` and use it for both the
  "ใช้ไป" value and the progress-bar width (`(outstanding / acc.creditLimit) * 100`).

### 4. `src/app/(app)/dashboard/page.tsx`
- Remove `creditUsed: number;` from the `walletSummary` state type
  (currently lines ~655-659).
- In the lower "กระเป๋าเงิน" card (~line 902), replace
  `formatCurrency(walletSummary.creditUsed)` with
  `formatCurrency(walletSummary.creditOutstanding)`.

### 5. `src/components/forms/transfer-form.tsx`
- Add `defaultToAccountId?: string` to `TransferFormProps`.
- In `useForm` `defaultValues`, set
  `toAccountId: defaultToAccountId ?? ""` (alongside the existing
  `fromAccountId: defaultFromAccountId ?? ""`).

### 6. `src/app/(app)/accounts/[id]/page.tsx`
- Where the "โอนออก" button is rendered (~lines 124-131): if
  `isCreditCard`, render label "ชำระบัตรเครดิต" and pass
  `defaultToAccountId={account.id}` to `TransferForm` (omit
  `defaultFromAccountId` in this branch); else keep current "โอนออก" +
  `defaultFromAccountId={account.id}`.

## Out of Scope (deferred to later sessions)

- Sub-project C: convert credit-card expense → Debt + interest, `user.tier`
  gating, per-tx "ชำระยอดนี้"/"เปลี่ยนเป็นยอดผ่อน" actions.
- `/accounts` list quick-pay action.

## Verification Plan

- `tsc --noEmit` and `eslint` clean on all touched files.
- Playwright e2e against a fixture account (cleaned up after):
  1. Create CASH account, initialBalance ฿1,000.
  2. Create CREDIT_CARD account, creditLimit ฿10,000, statementDay set.
  3. Record EXPENSE ฿500 on the credit card → assert `/accounts` list shows
     "ใช้ไป ฿500" for the CC row (progress bar ~5%).
  4. On `/accounts/[id]` for the CC, confirm button reads "ชำระบัตรเครดิต"
     (not "โอนออก"); open it → `TransferForm` opens with destination
     pre-selected to this CC.
  5. Submit a ฿300 payment from CASH → CC.
  6. Assert `/accounts` list CC row "ใช้ไป" now ฿200 (was ฿500 before payment
     — this is the core fix; previously this number would NOT have changed).
  7. Assert dashboard lower "กระเป๋าเงิน" card "ใช้ไป" also ฿200, consistent
     with `/accounts` list and with sub-project A's "ยอดบัตรเครดิตค้างจ่าย"
     (also ฿200).
  8. Confirm "คงเหลือสุทธิ" (฿700) and รายรับ/รายจ่ายเดือนนี้ unaffected
     (sub-project A behavior preserved).

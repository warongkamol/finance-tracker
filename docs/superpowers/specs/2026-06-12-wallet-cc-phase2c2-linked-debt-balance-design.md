# Wallet/CC Phase 2C-2: Linked-Debt Balance Inclusion + Reverse Debt List

## Context

C-1 (shipped, `69463be`) added `Debt.accountId` (optional FK to `Account`,
restricted to `CREDIT_CARD` accounts) and the `Account.debts` back-relation,
but neither is consumed yet for balance math or display — C-1 only added a
forward link/label on the debt side.

This sub-spec (C-2) closes that loop for the "billed-through" relationship:
a `Debt` linked to a credit-card/loan `Account` represents money the user
still owes *on that account*, so it must (1) count toward that account's
"ใช้ไป"/outstanding figure everywhere it's shown, and (2) be visible on the
account's own detail page.

Out of scope (deferred to C-3, separate session, per `project_state`
memory): converting a CC expense transaction into a `Debt`, `User.tier` +
interest calculation, tier gating. C-3's design will build directly on the
balance formula introduced here (see "Future Work" below).

## A. Balance Computation Change

`computeAccountBalance` (`src/lib/account-balance.ts`) is the single helper
used by `/api/v1/accounts` (list), `/api/v1/accounts/[id]` (detail), and
`/api/v1/accounts/summary` (dashboard). For `accountType === "CREDIT_CARD"`,
it currently returns:

```
balance = -initialBalance + netActivity   // netActivity from transactions/transfers
```

This sub-spec extends the CREDIT_CARD branch to also subtract each linked
debt's remaining balance:

```
balance = -initialBalance + netActivity - Σ remainingBalance(linkedActiveDebts)
```

Where `linkedActiveDebts` = `Debt` rows with `accountId = thisAccount.id AND
status = "ACTIVE"`, and `remainingBalance` per debt = `Σ DebtPayment.amount
WHERE status != "PAID"` — the same formula `GET /api/v1/debts` already uses
for its list enrichment.

Because all three API routes derive every "ใช้ไป" / `creditOutstanding` /
balance figure from this one function's return value, this single change
propagates automatically to:
- `/accounts` list — CC row "ใช้ไป {Math.max(0,-acc.balance)}" + progress bar
  vs `creditLimit`
- `/accounts/[id]` — balance card amount (more negative / "ติดลบ")
- Dashboard — "ยอดบัตรเครดิต/สินเชื่อค้างจ่าย" row and the lower "กระเป๋าเงิน"
  wallet card's `creditOutstanding`

`BalanceHero`'s "คงเหลือสุทธิ" (`liquidTotal`) is unaffected — it already
excludes CREDIT_CARD accounts entirely (sub-project A).

**Why this doesn't double-count (today):** creating a `Debt` never creates a
`Transaction`. Paying an installment (`POST .../payments/[paymentId]/pay`)
creates an `EXPENSE` transaction tagged with `paymentMethodId`, **not**
`accountId` — so a linked debt's principal/remaining has never contributed to
its account's `netActivity`. Adding it via `remainingBalance` is the first
and only representation of that debt on the card.

## B. Reverse Debt List on `/accounts/[id]`

New section **"หนี้ที่ผูกกับบัญชีนี้"**, positioned between the
transfer/ชำระ button and "รายการล่าสุด". Rendered only when
`account.type === "CREDIT_CARD"` and at least one linked debt qualifies.

**Query (new in `GET /api/v1/accounts/[id]`):** `Debt` rows where
`accountId = id AND status = "ACTIVE"`, each enriched with `remainingBalance`
and `paidCount` (same enrichment as `GET /api/v1/debts`), returned as
`linkedDebts: [{ id, name, totalMonths, paidCount, remainingBalance }]`.

Only `ACTIVE` debts are included — by construction every `ACTIVE` debt has
`remainingBalance > 0` (the pay-installment route flips status to
`COMPLETED` once all payments are `PAID`), so no extra `> 0` filter is
needed. `CANCELLED` debts are excluded from both this list and the balance
formula in section A.

**Row content** (mirrors `/debts` list row styling):
- Debt name
- Progress bar: `paidCount / totalMonths`
- "คงเหลือ ฿{remainingBalance}"
- Whole row is a `Link` to `/debts/[id]`

**Disappearing behavior:** once a debt's last installment is paid, its
status flips to `COMPLETED` server-side — on the next load of
`/accounts/[id]` it no longer matches the query and the row (or, if it was
the only one, the whole section) disappears. No client-side special-casing
needed.

## C. `/debts` List Page

No change. A debt linked to an account already appears in `/debts` exactly
as before (status tabs, progress bar, remaining balance) — this sub-spec
only adds a *second* place (the account) where the same debt is surfaced.

## Error Handling / Edge Cases

| Condition | Result |
|---|---|
| Account has no linked debts | Section omitted entirely |
| Account `type !== CREDIT_CARD` | Section omitted (query not even run) |
| `creditLimit` is `null` | Unaffected — progress-bar-vs-limit block stays gated on `creditLimit` truthy (existing behavior), only the raw "ใช้ไป" amount changes |
| Linked debt has `status = CANCELLED` | Excluded from both the balance subtraction (A) and the list (B) — written off, no longer owed |
| Linked debt's last installment gets paid | `status → COMPLETED` (existing pay-route behavior) → excluded from A and B on next load; account balance increases back by `remainingBalance` (now 0) |

## Testing / Verification Plan

1. `npx tsc --noEmit` — must be clean.
2. Playwright e2e against a throwaway fixture (`npm run dev -- -p 3001`,
   430px viewport), covering:
   - Create a CC account (`creditLimit` set), create a `Debt` linked to it
     (`totalMonths=4`, pay 1 installment so `paidCount=1`,
     `remainingBalance = 3 × monthlyAmount`).
   - `/accounts` list: CC row "ใช้ไป" includes the debt's remainingBalance;
     progress bar vs `creditLimit` reflects it.
   - `/accounts/[id]`: balance card amount reflects it; new "หนี้ที่ผูกกับ
     บัญชีนี้" section shows the debt with correct progress (1/4) and
     remaining amount; tapping the row navigates to `/debts/[id]`.
   - Dashboard: "ยอดบัตรเครดิต/สินเชื่อค้างจ่าย" row and wallet card's "ใช้ไป"
     both include the debt's remaining.
   - Pay the remaining 3 installments → debt `status = COMPLETED` → reload
     `/accounts/[id]`: section disappears, balance/outstanding drops back by
     the same amount (net zero vs. before the debt existed).
   - A debt with `status = CANCELLED` linked to the same account is excluded
     from both the balance figure and the section.
3. Clean up fixture account/debt + temporary scripts after.

## Future Work (C-3, NOT this spec)

**Convert CC-expense-transaction → Debt** (the core of C-3) must reuse the
formula from section A without double-counting. Analysis from this
session's brainstorm:

- If the original expense `Transaction` T (on account A, amount X) is left
  in place after conversion, and the new `Debt` D is created with
  `accountId = A` and `remainingBalance = X`, then A's outstanding becomes
  `T's X (still in netActivity) + D's remaining (X) = 2X` — double-counted.
- **Fix:** the conversion action must **delete T** and create D with
  `accountId = A`. Section A's formula then yields `netActivity(without T) -
  D.remainingBalance = X` immediately (unchanged from before conversion),
  and decreases by `monthlyAmount` each time an installment is paid (each
  payment creates its own dated `EXPENSE` transaction via the existing
  pay-installment route, recognized in that month's totals instead of all at
  once in T's original month).
- **Open question for C-3's design session:** deleting T retroactively
  changes the expense total for T's original month. Converting a
  *same-cycle* purchase is consistent with how 0%-installment spend should
  be recognized (spread monthly, not lump-sum), but converting an *old*
  transaction from a past month would silently change that month's recorded
  history. C-3 should decide whether to restrict conversion to the current
  billing cycle, warn the user, or accept the retroactive change.

Other C-3 items unchanged from `project_state`: `User.tier`, interest calc
on `Debt.interestRate` (flat-rate, PRO-gated).

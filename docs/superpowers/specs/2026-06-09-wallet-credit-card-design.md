# Wallet + Credit Card System — Design Spec

**Date:** 2026-06-09  
**Status:** Approved — ready for implementation planning

---

## Part 1 — Human-Readable Summary

### What We're Building and Why

The app currently uses a flat `PaymentMethod` model to tag transactions with
"what did you pay with." It stores no balance, tracks no spending per method,
and has no concept of money moving between wallets. Users like this app's
owner have multiple real financial containers — cash, savings, e-wallets,
and credit cards — and want to see how much is in each one and how much
they've spent on each card this billing cycle.

This feature replaces `PaymentMethod` with a richer `Account` model that
tracks balances and credit card cycle spending, adds inter-account transfers,
and surfaces a summary on the dashboard.

### Key Design Decisions

**Migration (Option C — auto-migrate, seamless):**
Existing `PaymentMethod` rows are converted 1-to-1 into `Account` rows during
the Prisma migration. Transaction foreign keys are repointed. The user sees
no disruption; their named payment methods just become named accounts. A
one-time onboarding wizard lets them set opening balances.

**Balance tracking — Hybrid (computed, not stored):**
`Account.initialBalance` is the only stored number. Current balance is always
computed: `initialBalance + Σ INCOME − Σ EXPENSE + Σ transfers in − Σ transfers out`.
No risk of balance drift from bugs; recomputable at any time.

**Credit card — Free tier tracks current billing cycle only:**
`cycleUsed` = sum of EXPENSE transactions since the last `statementDay`.
Shows progress against `creditLimit` as a progress bar. Multi-cycle rolling
balance (tracking unpaid amounts across cycles) is noted as a future Pro
feature pending user research.

**Transfers — standalone Sheet, not embedded in transaction form:**
A "โอนเงิน" Sheet (accessible from the `/accounts` list and pre-filled from
account detail pages) creates a `Transfer` record plus two linked transactions
atomically. Keeps the transaction form conceptually clean — transfers are not
income or expense.

**Navigation:**
The Notifications tab is removed from the bottom nav (the bell icon already
exists in the header). The freed slot becomes "กระเป๋า" (wallet icon) pointing
to `/accounts`. Notification page remains accessible via header bell.

**Dashboard:**
A new summary card is added above the debt banner showing two rows:
- 💰 เงินสด — sum of all non-credit accounts
- 💳 บัตรเครดิต — total cycle used / total credit limit (hidden if no credit cards)

**Onboarding:**
First time `/accounts` is opened after migration, a Sheet wizard lists all
accounts and asks for opening balances. User can skip; values default to 0.
Wizard dismissal is stored in `localStorage` (`wallet_onboarded=true`).

### Architecture Overview

```
Account (replaces PaymentMethod)
  ├── transactions[]        FK on Transaction.accountId
  ├── transfersFrom[]       FK on Transfer.fromAccountId
  └── transfersTo[]         FK on Transfer.toAccountId

Transfer (new)
  ├── fromAccount → Account
  ├── toAccount   → Account
  ├── fromTx      → Transaction (EXPENSE, auto-created)
  └── toTx        → Transaction (INCOME, auto-created)
```

Balance is read-only computed — never written after `initialBalance` is set.

### What Is Explicitly Out of Scope

- **Multi-cycle credit card rolling balance** (B option) — future Pro feature
- **Account sharing across family groups** — accounts are personal only
- **Import from bank statements** — manual entry only
- **Interest calculation** — no APR/interest tracking
- **Investment accounts** — no stock/fund tracking
- **Infrastructure scaling** — current VPS is fine; scale when users exist

---

## Part 2 — Implementation Plan

### Schema Changes

**Task S1 — Add Account model, Transfer model, migrate PaymentMethod**

File: `prisma/schema.prisma`

Add:
```prisma
enum AccountType {
  CASH
  BANK_ACCOUNT
  SAVINGS
  E_WALLET
  CREDIT_CARD
}

model Account {
  id             String      @id @default(cuid())
  userId         String      @map("user_id")
  user           User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  name           String
  type           AccountType
  initialBalance Decimal     @default(0) @map("initial_balance") @db.Decimal(12, 2)
  creditLimit    Decimal?    @map("credit_limit") @db.Decimal(12, 2)
  statementDay   Int?        @map("statement_day")
  paymentDueDay  Int?        @map("payment_due_day")
  isDefault      Boolean     @default(false) @map("is_default")
  isActive       Boolean     @default(true) @map("is_active")
  sortOrder      Int         @default(0) @map("sort_order")
  createdAt      DateTime    @default(now()) @map("created_at")
  updatedAt      DateTime    @updatedAt @map("updated_at")

  transactions   Transaction[]
  recurringTxns  RecurringTransaction[]
  transfersFrom  Transfer[] @relation("TransferFrom")
  transfersTo    Transfer[] @relation("TransferTo")

  @@index([userId])
  @@map("accounts")
}

model Transfer {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fromAccountId String   @map("from_account_id")
  fromAccount   Account  @relation("TransferFrom", fields: [fromAccountId], references: [id])
  toAccountId   String   @map("to_account_id")
  toAccount     Account  @relation("TransferTo", fields: [toAccountId], references: [id])
  amount        Decimal  @db.Decimal(12, 2)
  date          DateTime @db.Date
  note          String?
  fromTxId      String?  @unique @map("from_tx_id")
  toTxId        String?  @unique @map("to_tx_id")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("transfers")
}
```

On `Transaction`: add two fields:
- `accountId String? @map("account_id")` + relation (nullable during migration)
- `isTransfer Boolean @default(false) @map("is_transfer")` — marks auto-created transfer legs; excluded from all income/expense/dashboard summaries

Also change `categoryId` on Transaction to nullable (required for transfer legs):
```prisma
categoryId String? @map("category_id")
category   Category? @relation(...)
```

On `RecurringTransaction`: add nullable `accountId` (same as Transaction, no `isTransfer` needed here).  
On `User`: add `accounts Account[]` and `transfers Transfer[]`.

Migration SQL (inside Prisma migration file):
```sql
-- 1. Create accounts from payment_methods (type mapping)
INSERT INTO accounts (id, user_id, name, type, initial_balance, is_default, sort_order, created_at, updated_at)
SELECT
  id, user_id, name,
  CASE type
    WHEN 'CASH'          THEN 'CASH'
    WHEN 'QR_PAYMENT'    THEN 'E_WALLET'
    WHEN 'BANK_TRANSFER' THEN 'BANK_ACCOUNT'
    WHEN 'CREDIT_CARD'   THEN 'CREDIT_CARD'
    WHEN 'DEBIT_CARD'    THEN 'BANK_ACCOUNT'
    WHEN 'PAY_LATER'     THEN 'BANK_ACCOUNT'
    ELSE 'CASH'
  END,
  0, is_default, sort_order, created_at, NOW()
FROM payment_methods;

-- 2. Point transactions to accounts
UPDATE transactions SET account_id = payment_method_id WHERE payment_method_id IS NOT NULL;

-- 3. Point recurring_transactions to accounts
UPDATE recurring_transactions SET account_id = payment_method_id WHERE payment_method_id IS NOT NULL;
```

Keep `payment_methods` table and `payment_method_id` columns intact for now (drop in a separate follow-up migration after verification).

Acceptance: `npx prisma migrate dev` succeeds; existing transactions still queryable with `account_id` populated.

---

**Task S2 — Zod validation schemas**

File: `src/lib/validations/account.ts` (new)

```typescript
export const createAccountSchema = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['CASH', 'BANK_ACCOUNT', 'SAVINGS', 'E_WALLET', 'CREDIT_CARD']),
  initialBalance: z.number().default(0),
  creditLimit: z.number().positive().optional(),
  statementDay: z.number().int().min(1).max(28).optional(),
  paymentDueDay: z.number().int().min(1).max(28).optional(),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const updateAccountSchema = createAccountSchema.partial();

export const transferSchema = z.object({
  fromAccountId: z.string().cuid(),
  toAccountId: z.string().cuid(),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).optional(),
}).refine(d => d.fromAccountId !== d.toAccountId, {
  message: 'ต้นทางและปลายทางต้องต่างกัน',
});
```

---

### API Routes

**Task A1 — `GET /api/v1/accounts` and `POST /api/v1/accounts`**

File: `src/app/api/v1/accounts/route.ts` (new)

`GET`: fetch all accounts for `userId`, compute `balance` and `cycleUsed` per account.

Balance formula:
```typescript
async function computeBalance(accountId: string, prisma: PrismaClient) {
  const [income, expense] = await Promise.all([
    prisma.transaction.aggregate({ where: { accountId, type: 'INCOME' }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { accountId, type: 'EXPENSE' }, _sum: { amount: true } }),
  ]);
  const txBalance = (income._sum.amount ?? 0) - (expense._sum.amount ?? 0);
  // transfers handled separately via Transfer table
  const [tfOut, tfIn] = await Promise.all([
    prisma.transfer.aggregate({ where: { fromAccountId: accountId }, _sum: { amount: true } }),
    prisma.transfer.aggregate({ where: { toAccountId: accountId }, _sum: { amount: true } }),
  ]);
  return account.initialBalance + txBalance - (tfOut._sum.amount ?? 0) + (tfIn._sum.amount ?? 0);
}
```

Credit card cycle: find `statementDay`, compute start of current cycle, sum EXPENSE transactions since then.

`POST`: create account. If `isDefault: true`, unset `isDefault` on all other accounts for this user first.

Response shape:
```json
{ "success": true, "data": { "id": "...", "name": "...", "type": "SAVINGS", "balance": 45000, "cycleUsed": null, "creditLimit": null, ... } }
```

---

**Task A2 — `GET /api/v1/accounts/summary`**

File: `src/app/api/v1/accounts/summary/route.ts` (new)

Used by dashboard card. Returns:
```json
{
  "data": {
    "liquidTotal": 47500,
    "creditUsed": 8200,
    "creditLimit": 50000,
    "hasCreditCards": true
  }
}
```

`liquidTotal` = sum of `balance` for all non-CREDIT_CARD accounts.  
`creditUsed` / `creditLimit` = aggregated across all CREDIT_CARD accounts.

---

**Task A3 — `GET /api/v1/accounts/:id`, `PATCH /api/v1/accounts/:id`, `DELETE /api/v1/accounts/:id`**

File: `src/app/api/v1/accounts/[id]/route.ts` (new)

`GET`: account detail + computed balance + last 20 transactions with this accountId.  
`PATCH`: update name/type/initialBalance/creditLimit/statementDay/paymentDueDay/isDefault/sortOrder. If setting isDefault=true, clear others.  
`DELETE`: guard — if account has any transactions (including isTransfer=true legs) OR appears as fromAccount/toAccount on any Transfer → return `{ error: { code: 'HAS_TRANSACTIONS', message: 'ไม่สามารถลบได้ มีรายการที่เชื่อมอยู่' } }`. Otherwise delete.

---

**Task A4 — `POST /api/v1/accounts/transfer`**

File: `src/app/api/v1/accounts/transfer/route.ts` (new)

Atomic operation — all or nothing:
1. Validate both accounts belong to `userId`
2. Validate `fromAccountId !== toAccountId`
3. In a `prisma.$transaction([])`:
   a. Find a "Transfer" category (or use null categoryId — need a system transfer category)
   b. Create EXPENSE Transaction (accountId=from, amount, date, description=`โอน → ${toAccount.name}`)
   c. Create INCOME Transaction (accountId=to, amount, date, description=`โอน ← ${fromAccount.name}`)
   d. Create Transfer record linking both transactions

Transfer transaction legs set `isTransfer=true` and `categoryId=null` (categoryId is nullable per schema change in S1). No special system category needed.

---

**Task A5 — Update transaction API to accept `accountId`**

File: `src/app/api/v1/transactions/route.ts` (existing)

- Add `accountId` (optional string cuid) to `createTransactionSchema` and `updateTransactionSchema`
- Persist `accountId` when provided
- Keep `paymentMethodId` in schema for backwards compat during transition (both nullable)

---

**Task A6 — Update recurring transaction API similarly**

File: `src/app/api/v1/recurring/route.ts` (existing)  
Same as A5 — add `accountId` field alongside existing `paymentMethodId`.

---

### UI Components

**Task U1 — Account form component**

File: `src/components/forms/account-form.tsx` (new)

Sheet form (same pattern as DebtForm, CategoryForm).  
Fields: name, type (5-button grid with emoji icons), initialBalance, and conditional credit card fields (creditLimit, statementDay, paymentDueDay) that appear only when type=CREDIT_CARD.  
Controlled by `open/onClose/onSuccess` props.  
Calls POST or PATCH depending on whether `initialAccount` prop is provided.

---

**Task U2 — Transfer Sheet component**

File: `src/components/forms/transfer-form.tsx` (new)

Sheet form. Props: `open`, `onClose`, `onSuccess`, `defaultFromAccountId?` (pre-fill from account detail).  
Fields: fromAccount dropdown, toAccount dropdown, amount, date (default today), note.  
Validate fromAccount ≠ toAccount inline.  
On submit: POST `/api/v1/accounts/transfer`.

---

**Task U3 — `/accounts` page**

File: `src/app/(app)/accounts/page.tsx` (new)

- Header: "กระเป๋าเงิน" + [+ เพิ่ม] + [⇄ โอน] buttons
- Account cards list: ios-card style, show name + type icon + balance (or cycleUsed/limit bar for CREDIT_CARD)
- Footer: "รวมเงินสด: ฿X,XXX" — sum of non-credit balances
- FAB opens AccountForm Sheet (create mode)
- ⇄ opens TransferForm Sheet
- Tap card → navigate to `/accounts/:id`
- Onboarding wizard: if `!localStorage.getItem('wallet_onboarded')` and all initialBalances = 0 → show onboarding Sheet

Onboarding Sheet:
```
ตั้งยอดเริ่มต้น
กระเป๋าของคุณ
─────────────────
เงินสด    [฿ ___]
เงินออม   [฿ ___]
...
[ข้ามไปก่อน]  [บันทึก]
```
On save: PATCH each account with new initialBalance. Set `wallet_onboarded=true`.

---

**Task U4 — `/accounts/:id` page**

File: `src/app/(app)/accounts/[id]/page.tsx` (new)

- Back button → `/accounts`
- Account name + type icon in header + [แก้ไข] button
- Large balance display (negative = red for credit)
- For CREDIT_CARD: progress bar cycleUsed/creditLimit + statementDay/dueDay display
- [⇄ โอนออก] button → TransferForm pre-filled with this account as `fromAccountId`
- Recent transactions list (last 20, same row style as `/transactions`)
- [แก้ไข] → AccountForm Sheet (edit mode, pre-filled)
- Delete button (bottom, destructive) → confirm Dialog → DELETE API

---

**Task U5 — Dashboard wallet summary card**

File: `src/app/(app)/dashboard/page.tsx` (existing)

Add `WalletSummaryCard` component inline or extracted. Fetches `GET /api/v1/accounts/summary`.

Position: between the period navigator and DebtBanner.

```tsx
// Render:
<div className="ios-card mx-4 px-4 py-3">
  <div className="flex items-center justify-between mb-2">
    <p className="text-[13px] font-semibold text-foreground">กระเป๋าเงิน</p>
    <Link href="/accounts" className="text-[12px] text-primary">ดูทั้งหมด →</Link>
  </div>
  <div className="flex justify-between">
    <span className="text-[13px] text-muted-foreground">💰 เงินสด</span>
    <span className="text-[13px] font-semibold">{formatCurrency(summary.liquidTotal)}</span>
  </div>
  {summary.hasCreditCards && (
    <div className="flex justify-between mt-1">
      <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต</span>
      <span className="text-[13px] font-semibold text-[#FF3B30]">
        {formatCurrency(summary.creditUsed)} / {formatCurrency(summary.creditLimit)}
      </span>
    </div>
  )}
</div>
```

Loading skeleton: 2 rows of skeleton lines.

---

**Task U6 — Update transaction form: account picker replaces payment method picker**

File: `src/components/forms/transaction-form.tsx` (existing)

- Remove payment method dropdown
- Add account dropdown (fetched from `GET /api/v1/accounts`, default = account with `isDefault=true`)
- Submit body: include `accountId` (drop `paymentMethodId`)
- Display: account name + type icon in dropdown option

---

**Task U7 — Update recurring transaction form similarly**

File: `src/components/forms/recurring-form.tsx` (existing)  
Same as U6 — swap payment method picker for account picker.

---

**Task U8 — Bottom nav: replace Notifications tab with กระเป๋า**

File: `src/components/layout/bottom-nav.tsx` (confirmed path)

- Remove Notifications tab entry
- Add `{ href: '/accounts', label: 'กระเป๋า', icon: WalletCards }` (lucide-react `WalletCards` icon)
- Notifications page remains accessible via header bell only

---

### Verification

**Task V1 — End-to-end Playwright verification**

Script: `/tmp/run-check/wallet-e2e.mjs` (throwaway, delete after)

Verify:
1. Login as fixture account
2. `/accounts` loads — shows migrated accounts from PaymentMethod
3. Onboarding Sheet appears (initialBalance=0), fill ฿5000 for cash → save → balance shows ฿5000
4. Create new SAVINGS account → appears in list
5. Create CREDIT_CARD account with limit ฿30,000 → appears with progress bar
6. Create a transaction (EXPENSE ฿500) tagged to cash account → cash balance drops to ฿4,500
7. Transfer ฿1,000 cash → savings → cash ฿3,500, savings ฿1,000
8. Dashboard shows `liquidTotal` updated, no credit card row (add one → credit row appears)
9. Delete account with no transactions → succeeds; delete account with transactions → blocked with Thai error message

Clean up all fixture data after test.

---

### Notes and Cross-Cutting Concerns

- `isTransfer` flag on Transaction (recommended in A4): prevents transfer transactions from appearing in income/expense totals on dashboard and budget comparison. Filter `WHERE isTransfer = false` in all summary queries. **This is critical — forgetting it will inflate income/expense totals.**
- `payment_methods` table and `payment_method_id` columns: keep during this feature, remove in a follow-up cleanup migration once everything is verified in production.
- Credit card `cycleUsed` only counts `isTransfer=false` EXPENSE transactions within the current cycle.
- `GET /api/v1/accounts` balance computation runs N queries (one per account). For users with many accounts, consider a single aggregate query. Not a problem at current scale.
- RecurringTransaction: `paymentMethodId` rename to `accountId` — update the cron/reminders route that reads this field when creating the notification pre-fill URL.

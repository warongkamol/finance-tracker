-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK_ACCOUNT', 'SAVINGS', 'E_WALLET', 'CREDIT_CARD');

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_fkey";

-- AlterTable
ALTER TABLE "recurring_transactions" ADD COLUMN     "account_id" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "is_transfer" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "category_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "initial_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(12,2),
    "statement_day" INTEGER,
    "payment_due_day" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "from_tx_id" TEXT,
    "to_tx_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_from_tx_id_key" ON "transfers"("from_tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_to_tx_id_key" ON "transfers"("to_tx_id");

-- CreateIndex
CREATE INDEX "transfers_user_id_idx" ON "transfers"("user_id");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate payment_methods → accounts (type mapping). Idempotent: safe on fresh DBs (no-op).
INSERT INTO accounts (id, user_id, name, type, initial_balance, is_default, sort_order, created_at, updated_at)
SELECT
  id,
  user_id,
  name,
  CASE type::text
    WHEN 'CASH'          THEN 'CASH'
    WHEN 'QR_PAYMENT'    THEN 'E_WALLET'
    WHEN 'BANK_TRANSFER' THEN 'BANK_ACCOUNT'
    WHEN 'CREDIT_CARD'   THEN 'CREDIT_CARD'
    WHEN 'DEBIT_CARD'    THEN 'BANK_ACCOUNT'
    WHEN 'PAY_LATER'     THEN 'BANK_ACCOUNT'
    ELSE 'CASH'
  END::"AccountType",
  0,
  is_default,
  sort_order,
  created_at,
  NOW()
FROM payment_methods
ON CONFLICT (id) DO NOTHING;

-- Repoint transactions to accounts
UPDATE transactions SET account_id = payment_method_id WHERE payment_method_id IS NOT NULL AND account_id IS NULL;

-- Repoint recurring_transactions to accounts
UPDATE recurring_transactions SET account_id = payment_method_id WHERE payment_method_id IS NOT NULL AND account_id IS NULL;

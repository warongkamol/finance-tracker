-- AlterTable
ALTER TABLE "debts" ADD COLUMN     "account_id" TEXT;

-- CreateIndex
CREATE INDEX "debts_account_id_idx" ON "debts"("account_id");

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

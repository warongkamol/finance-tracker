-- AlterTable
ALTER TABLE "budget_items" ADD COLUMN     "account_id" TEXT;

-- CreateIndex
CREATE INDEX "budget_items_account_id_idx" ON "budget_items"("account_id");

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

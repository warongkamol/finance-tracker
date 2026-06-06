-- AlterTable
ALTER TABLE "budget_items" ADD COLUMN     "debt_id" TEXT;

-- CreateIndex
CREATE INDEX "budget_items_debt_id_idx" ON "budget_items"("debt_id");

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

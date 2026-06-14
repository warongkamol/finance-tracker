-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('FREE', 'PRO');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "converted_to_debt_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tier" "UserTier" NOT NULL DEFAULT 'FREE';

-- CreateIndex
CREATE INDEX "transactions_converted_to_debt_id_idx" ON "transactions"("converted_to_debt_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_converted_to_debt_id_fkey" FOREIGN KEY ("converted_to_debt_id") REFERENCES "debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

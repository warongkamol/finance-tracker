/*
  Warnings:

  - Added the required column `end_date` to the `recurring_transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start_date` to the `recurring_transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "recurring_transactions" ADD COLUMN     "end_date" DATE NOT NULL,
ADD COLUMN     "is_last_day_of_month" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "payment_method_id" TEXT,
ADD COLUMN     "start_date" DATE NOT NULL;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

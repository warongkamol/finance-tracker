import { Prisma } from "@/generated/prisma/client";
import { addMonths } from "@/lib/utils";

export async function createDebtPaymentsAndBudgetItems(
  tx: Prisma.TransactionClient,
  params: {
    debtId: string;
    debtName: string;
    totalMonths: number;
    monthlyAmount: number;
    startDate: Date;
    userId: string;
  }
) {
  const { debtId, debtName, totalMonths, monthlyAmount, startDate, userId } = params;

  const payments = Array.from({ length: totalMonths }, (_, i) => ({
    debtId,
    installmentNo: i + 1,
    dueDate: addMonths(startDate, i),
    amount: new Prisma.Decimal(monthlyAmount),
    status: "PENDING" as const,
  }));

  await tx.debtPayment.createMany({ data: payments });

  for (let i = 0; i < totalMonths; i++) {
    const dueDate = addMonths(startDate, i);
    const payYear = dueDate.getFullYear();
    const payMonth = dueDate.getMonth() + 1;

    const budget = await tx.budget.upsert({
      where: { userId_year_month: { userId, year: payYear, month: payMonth } },
      create: { userId, year: payYear, month: payMonth },
      update: {},
    });

    const maxOrder = await tx.budgetItem.aggregate({
      where: { budgetId: budget.id },
      _max: { sortOrder: true },
    });

    await tx.budgetItem.create({
      data: {
        budgetId: budget.id,
        debtId,
        name: debtName,
        type: "LIABILITY",
        amount: new Prisma.Decimal(monthlyAmount),
        notes: `งวดที่ ${i + 1}/${totalMonths}`,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });
  }
}

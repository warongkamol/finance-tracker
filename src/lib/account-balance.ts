import { prisma } from "@/lib/prisma";

export async function computeAccountBalance(
  accountId: string,
  initialBalance: number,
  accountType: string
): Promise<number> {
  const [income, expense, tfOut, tfIn] = await Promise.all([
    prisma.transaction.aggregate({
      where: { accountId, type: "INCOME", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId, type: "EXPENSE", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { fromAccountId: accountId },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { toAccountId: accountId },
      _sum: { amount: true },
    }),
  ]);
  const netActivity =
    Number(income._sum.amount ?? 0) -
    Number(expense._sum.amount ?? 0) -
    Number(tfOut._sum.amount ?? 0) +
    Number(tfIn._sum.amount ?? 0);

  if (accountType !== "CREDIT_CARD") {
    return initialBalance + netActivity;
  }

  // Debts linked to this card (accountId = this account, still ACTIVE) are money
  // already owed on it that hasn't appeared in netActivity as a transaction yet.
  const linkedDebtRemaining = await prisma.debtPayment.aggregate({
    where: {
      status: { not: "PAID" },
      debt: { accountId, status: "ACTIVE" },
    },
    _sum: { amount: true },
  });

  // CREDIT_CARD: initialBalance is entered as a positive "ใช้ไปแล้ว" (already-owed)
  // amount, so it subtracts from balance instead of adding.
  return (
    -initialBalance + netActivity - Number(linkedDebtRemaining._sum.amount ?? 0)
  );
}

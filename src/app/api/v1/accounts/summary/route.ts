import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getCycleStart(statementDay: number): Date {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (day >= statementDay) return new Date(Date.UTC(year, month, statementDay));
  return new Date(Date.UTC(year, month - 1, statementDay));
}

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }
    const accounts = await prisma.account.findMany({
      where: { userId: session.user.id, isActive: true },
    });
    const creditAccounts = accounts.filter((a) => a.type === "CREDIT_CARD");
    const liquidAccounts = accounts.filter((a) => a.type !== "CREDIT_CARD");

    const liquidBalances = await Promise.all(
      liquidAccounts.map(async (acc) => {
        const [income, expense, tfOut, tfIn] = await Promise.all([
          prisma.transaction.aggregate({
            where: { accountId: acc.id, type: "INCOME", isTransfer: false },
            _sum: { amount: true },
          }),
          prisma.transaction.aggregate({
            where: { accountId: acc.id, type: "EXPENSE", isTransfer: false },
            _sum: { amount: true },
          }),
          prisma.transfer.aggregate({
            where: { fromAccountId: acc.id },
            _sum: { amount: true },
          }),
          prisma.transfer.aggregate({
            where: { toAccountId: acc.id },
            _sum: { amount: true },
          }),
        ]);
        return (
          Number(acc.initialBalance) +
          Number(income._sum.amount ?? 0) -
          Number(expense._sum.amount ?? 0) -
          Number(tfOut._sum.amount ?? 0) +
          Number(tfIn._sum.amount ?? 0)
        );
      })
    );
    const liquidTotal = liquidBalances.reduce((sum, b) => sum + b, 0);

    let creditUsed = 0;
    let creditLimit = 0;
    for (const acc of creditAccounts) {
      creditLimit += Number(acc.creditLimit ?? 0);
      if (acc.statementDay) {
        const result = await prisma.transaction.aggregate({
          where: {
            accountId: acc.id,
            type: "EXPENSE",
            isTransfer: false,
            date: { gte: getCycleStart(acc.statementDay) },
          },
          _sum: { amount: true },
        });
        creditUsed += Number(result._sum.amount ?? 0);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        liquidTotal,
        creditUsed,
        creditLimit,
        hasCreditCards: creditAccounts.length > 0,
      },
    });
  } catch (err) {
    console.error("GET /api/v1/accounts/summary error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { searchParams } = req.nextUrl;
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const [txGroups, debts, overdueCount] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["type"],
        where: { userId: session.user.id, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
      }),
      prisma.debt.findMany({
        where: { userId: session.user.id, status: "ACTIVE" },
        include: {
          payments: {
            where: { status: { not: "PAID" } },
            select: { amount: true },
          },
        },
      }),
      prisma.debtPayment.count({
        where: {
          status: "OVERDUE",
          debt: { userId: session.user.id, status: "ACTIVE" },
        },
      }),
    ]);

    const totalIncome = Number(txGroups.find((g) => g.type === "INCOME")?._sum.amount ?? 0);
    const totalExpense = Number(txGroups.find((g) => g.type === "EXPENSE")?._sum.amount ?? 0);
    const balance = totalIncome - totalExpense;

    const totalRemainingDebt = debts.reduce(
      (sum, d) => sum + d.payments.reduce((s, p) => s + Number(p.amount), 0),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        balance,
        activeDebts: debts.length,
        totalRemainingDebt,
        overdueCount,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

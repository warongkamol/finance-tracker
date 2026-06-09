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
    const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(new Date().getMonth() + 1));

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const baseWhere = {
      userId: session.user.id,
      date: { gte: startDate, lt: endDate },
      isTransfer: false,
    };

    const [incomeResult, expenseResult] = await prisma.$transaction([
      prisma.transaction.aggregate({
        where: { ...baseWhere, type: "INCOME" },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.transaction.aggregate({
        where: { ...baseWhere, type: "EXPENSE" },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const totalIncome = incomeResult._sum.amount?.toNumber() ?? 0;
    const totalExpense = expenseResult._sum.amount?.toNumber() ?? 0;

    return NextResponse.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        incomeCount: incomeResult._count.id,
        expenseCount: expenseResult._count.id,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

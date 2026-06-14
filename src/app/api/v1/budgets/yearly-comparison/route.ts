import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// GET /api/v1/budgets/yearly-comparison?year=2026
// Returns planned vs actual income/expense per month for the whole year
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear()));

    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year + 1, 0, 1));

    const [budgets, transactions] = await Promise.all([
      prisma.budget.findMany({
        where: { userId: session.user.id, year },
        include: { items: { select: { type: true, amount: true } } },
      }),
      prisma.transaction.findMany({
        where: { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false, convertedToDebtId: null },
        select: { type: true, amount: true, date: true },
      }),
    ]);

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const items = budgets.find((b) => b.month === month)?.items ?? [];
      return {
        month,
        monthName: SHORT_MONTHS[i],
        plannedIncome: items.filter((it) => it.type === "INCOME").reduce((s, it) => s + Number(it.amount), 0),
        plannedExpense: items.filter((it) => it.type === "EXPENSE").reduce((s, it) => s + Number(it.amount), 0),
        actualIncome: 0,
        actualExpense: 0,
      };
    });

    for (const tx of transactions) {
      const m = new Date(tx.date).getUTCMonth(); // 0-indexed
      if (tx.type === "INCOME") monthly[m].actualIncome += Number(tx.amount);
      else monthly[m].actualExpense += Number(tx.amount);
    }

    return NextResponse.json({ success: true, data: monthly });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

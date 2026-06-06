import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/budgets?year=2026
// Returns 12-month overview: planned totals per month
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear()));

  const budgets = await prisma.budget.findMany({
    where: { userId: session.user.id, year },
    include: { items: true },
    orderBy: { month: "asc" },
  });

  // Build 12-month array (fill gaps with empty)
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const budget = budgets.find(b => b.month === month);
    const items = budget?.items ?? [];

    const totalIncome = items.filter(it => it.type === "INCOME").reduce((s, it) => s + Number(it.amount), 0);
    const totalExpense = items.filter(it => it.type === "EXPENSE").reduce((s, it) => s + Number(it.amount), 0);
    const totalLiability = items.filter(it => it.type === "LIABILITY").reduce((s, it) => s + Number(it.amount), 0);
    const totalSaving = items.filter(it => it.type === "SAVING").reduce((s, it) => s + Number(it.amount), 0);

    return {
      month,
      budgetId: budget?.id ?? null,
      hasData: items.length > 0,
      itemCount: items.length,
      totalIncome,
      totalExpense,
      totalLiability,
      totalSaving,
      netPlanned: totalIncome - totalExpense - totalLiability - totalSaving,
    };
  });

  return NextResponse.json({ success: true, data: { year, months } });
}

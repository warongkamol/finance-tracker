import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TOP_N = 6;
const FALLBACK_PALETTE = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"];

// GET /api/v1/budgets/category-breakdown?year=2026
// Returns actual EXPENSE totals per root category per month, restricted to the
// year's top-N categories by total spend (everything else bucketed into
// "other"). Powers the /budget overview page's category-by-month stacked bar.
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

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: session.user.id,
        type: "EXPENSE",
        isTransfer: false,
        convertedToDebtId: null,
        categoryId: { not: null },
        date: { gte: startDate, lt: endDate },
      },
      select: { amount: true, date: true, categoryId: true },
    });

    const emptyMonths = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, monthName: SHORT_MONTHS[i], totals: {} as Record<string, number>, otherTotal: 0,
    }));

    if (transactions.length === 0) {
      return NextResponse.json({ success: true, data: { categories: [], months: emptyMonths } });
    }

    const categoryIds = [...new Set(transactions.map((t) => t.categoryId as string))];
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, icon: true, color: true, parentId: true },
    });

    // Some parents may not be in the set above (no direct transactions) — fetch
    // them too so child-category spend can roll up correctly.
    const knownIds = new Set(categories.map((c) => c.id));
    const missingParentIds = [...new Set(
      categories.map((c) => c.parentId).filter((id): id is string => !!id && !knownIds.has(id))
    )];
    const parentCategories = missingParentIds.length
      ? await prisma.category.findMany({
          where: { id: { in: missingParentIds } },
          select: { id: true, name: true, icon: true, color: true, parentId: true },
        })
      : [];
    const catMap = new Map([...categories, ...parentCategories].map((c) => [c.id, c]));

    const monthRootTotals: Map<string, number>[] = Array.from({ length: 12 }, () => new Map());
    const yearRootTotals = new Map<string, number>();

    for (const tx of transactions) {
      const cat = catMap.get(tx.categoryId as string);
      if (!cat) continue;
      const rootId = cat.parentId ?? cat.id;
      const monthIdx = new Date(tx.date).getUTCMonth();
      const amount = Number(tx.amount);
      monthRootTotals[monthIdx].set(rootId, (monthRootTotals[monthIdx].get(rootId) ?? 0) + amount);
      yearRootTotals.set(rootId, (yearRootTotals.get(rootId) ?? 0) + amount);
    }

    const topRootIds = [...yearRootTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([id]) => id);
    const topSet = new Set(topRootIds);

    const responseCategories = topRootIds.map((id, i) => {
      const cat = catMap.get(id)!;
      return { id, name: cat.name, icon: cat.icon, color: cat.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] };
    });

    const months = Array.from({ length: 12 }, (_, i) => {
      const totals: Record<string, number> = {};
      let otherTotal = 0;
      for (const [rootId, amount] of monthRootTotals[i]) {
        if (topSet.has(rootId)) totals[rootId] = amount;
        else otherTotal += amount;
      }
      return { month: i + 1, monthName: SHORT_MONTHS[i], totals, otherTotal };
    });

    return NextResponse.json({ success: true, data: { categories: responseCategories, months } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

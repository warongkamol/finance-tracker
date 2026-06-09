import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addMonths } from "@/lib/utils";

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const CHART_COLORS = ["#f59e0b", "#3b82f6", "#22c55e", "#ef4444", "#8b5cf6"];

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
    const months = Math.min(parseInt(searchParams.get("months") ?? "6"), 12);

    // Build month range: last `months` months ending with the current month
    const now = new Date();
    const startMonth = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -(months - 1));
    const endDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
    const startDate = new Date(Date.UTC(startMonth.getFullYear(), startMonth.getMonth(), 1));

    // Find top 5 expense categories for this period
    const topCategories = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        userId: session.user.id,
        type: "EXPENSE",
        categoryId: { not: null },
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 5,
    });

    if (topCategories.length === 0) {
      return NextResponse.json({ success: true, data: { data: [], categories: [] } });
    }

    const categoryIds = topCategories
      .map((c) => c.categoryId)
      .filter((id): id is string => id !== null);

    const [categories, transactions] = await Promise.all([
      prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, color: true },
      }),
      prisma.transaction.findMany({
        where: {
          userId: session.user.id,
          type: "EXPENSE",
          categoryId: { in: categoryIds },
          date: { gte: startDate, lt: endDate },
        },
        select: { categoryId: true, amount: true, date: true },
      }),
    ]);

    const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

    // Build month buckets
    const monthBuckets = Array.from({ length: months }, (_, i) => {
      const d = addMonths(startMonth, i);
      return { year: d.getFullYear(), month: d.getMonth() }; // 0-indexed
    });

    // Aggregate per category per month
    const totals: Record<string, Record<string, number>> = {};
    for (const catId of categoryIds) {
      totals[catId] = {};
    }

    for (const tx of transactions) {
      if (tx.categoryId === null) continue;
      const d = new Date(tx.date);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (totals[tx.categoryId] !== undefined) {
        totals[tx.categoryId][key] = (totals[tx.categoryId][key] ?? 0) + Number(tx.amount);
      }
    }

    // Build flat data array for Recharts
    const data = monthBuckets.map(({ year, month }) => {
      const key = `${year}-${month}`;
      const row: Record<string, number | string> = { month: SHORT_MONTHS[month] };
      for (const catId of categoryIds) {
        const catName = catMap[catId]?.name ?? catId;
        row[catName] = totals[catId]?.[key] ?? 0;
      }
      return row;
    });

    const seriesCategories = categoryIds.map((catId, i) => ({
      name: catMap[catId]?.name ?? catId,
      color: catMap[catId]?.color ?? CHART_COLORS[i % CHART_COLORS.length],
    }));

    return NextResponse.json({ success: true, data: { data, categories: seriesCategories } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

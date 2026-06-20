import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type LineItemType = "EXPENSE" | "LIABILITY" | "SAVING";

// GET /api/v1/budgets/yearly-items?year=2026
// Groups EXPENSE/LIABILITY/SAVING budget items by name, summing `amount`
// across whichever months each name appears in this year. Powers the
// /budget/plan %-of-income expandable rows' line-item breakdown.
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

    const items = await prisma.budgetItem.findMany({
      where: {
        budget: { userId: session.user.id, year },
        type: { in: ["EXPENSE", "LIABILITY", "SAVING"] },
      },
      select: { name: true, type: true, amount: true },
    });

    const grouped: Record<LineItemType, Map<string, number>> = {
      EXPENSE: new Map(), LIABILITY: new Map(), SAVING: new Map(),
    };

    for (const item of items) {
      const type = item.type as LineItemType;
      const map = grouped[type];
      map.set(item.name, (map.get(item.name) ?? 0) + Number(item.amount));
    }

    const toSortedArray = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      success: true,
      data: {
        EXPENSE: toSortedArray(grouped.EXPENSE),
        LIABILITY: toSortedArray(grouped.LIABILITY),
        SAVING: toSortedArray(grouped.SAVING),
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

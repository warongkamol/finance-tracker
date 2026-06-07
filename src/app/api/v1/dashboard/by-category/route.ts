import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TransactionType } from "@/generated/prisma/client";
import { getFamilyMemberIds } from "@/lib/family";

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
    const typeParam = searchParams.get("type") ?? "EXPENSE";
    const type = (typeParam === "INCOME" ? "INCOME" : "EXPENSE") as TransactionType;
    const familyFilter = searchParams.get("familyFilter"); // "mine" | "family" | "all"

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    let txUserIds: string[] = [session.user.id];
    if (familyFilter === "family") {
      txUserIds = await getFamilyMemberIds(session.user.id);
    }

    const where =
      familyFilter === "family"
        ? { userId: { in: txUserIds }, type, isFamily: true, date: { gte: startDate, lt: endDate } }
        : familyFilter === "mine"
        ? { userId: session.user.id, type, isFamily: false, date: { gte: startDate, lt: endDate } }
        : { userId: session.user.id, type, date: { gte: startDate, lt: endDate } };

    const grouped = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    });

    if (grouped.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const categories = await prisma.category.findMany({
      where: { id: { in: grouped.map((g) => g.categoryId) } },
      select: { id: true, name: true, icon: true, color: true },
    });

    const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
    const total = grouped.reduce((sum, g) => sum + Number(g._sum.amount ?? 0), 0);

    const data = grouped.map((g) => ({
      categoryId: g.categoryId,
      name: catMap[g.categoryId]?.name ?? "ไม่ทราบ",
      icon: catMap[g.categoryId]?.icon ?? null,
      color: catMap[g.categoryId]?.color ?? null,
      total: Number(g._sum.amount ?? 0),
      percentage: total > 0 ? Math.round((Number(g._sum.amount ?? 0) / total) * 100) : 0,
    }));

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    const familyFilter = searchParams.get("familyFilter"); // "mine" | "family" | "all"

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    // Resolve user IDs for transaction query
    let txUserIds: string[] = [session.user.id];
    if (familyFilter === "family") {
      txUserIds = await getFamilyMemberIds(session.user.id);
    }

    const baseWhere =
      familyFilter === "family"
        ? { userId: { in: txUserIds }, isFamily: true, date: { gte: startDate, lt: endDate } }
        : familyFilter === "mine"
        ? { userId: session.user.id, isFamily: false, date: { gte: startDate, lt: endDate } }
        : { userId: session.user.id, date: { gte: startDate, lt: endDate } };

    // Get family member IDs for shared family debt view
    const familyMemberIds = await getFamilyMemberIds(session.user.id);

    const [txGroups, personalDebts, familyDebts, overdueCount] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["type"],
        where: baseWhere,
        _sum: { amount: true },
      }),
      // Personal debts: current user, isFamily=false
      prisma.debt.findMany({
        where: { userId: session.user.id, status: "ACTIVE", isFamily: false },
        include: {
          payments: { where: { status: { not: "PAID" } }, select: { amount: true } },
        },
      }),
      // Family debts: all group members (or just self if solo), isFamily=true
      prisma.debt.findMany({
        where: { userId: { in: familyMemberIds }, status: "ACTIVE", isFamily: true },
        include: {
          payments: { where: { status: { not: "PAID" } }, select: { amount: true } },
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

    const personalDebtRemaining = personalDebts.reduce(
      (sum, d) => sum + d.payments.reduce((s, p) => s + Number(p.amount), 0),
      0
    );
    const familyDebtRemaining = familyDebts.reduce(
      (sum, d) => sum + d.payments.reduce((s, p) => s + Number(p.amount), 0),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        balance,
        // Legacy totals (backward compat)
        activeDebts: personalDebts.length + familyDebts.length,
        totalRemainingDebt: personalDebtRemaining + familyDebtRemaining,
        overdueCount,
        // Split debt sections
        personalDebts: { count: personalDebts.length, totalRemaining: personalDebtRemaining },
        familyDebts: { count: familyDebts.length, totalRemaining: familyDebtRemaining },
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

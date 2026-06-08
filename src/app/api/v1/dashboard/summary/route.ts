import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserFamilyGroups } from "@/lib/family";

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

    // Resolve all the groups this user belongs to once — feeds both (a) the
    // family-filter scoping below and (b) the always-on family-debts banner,
    // which must show debts across every group the user is in, not just the
    // one currently selected in the dashboard's group-picker dropdown.
    const myGroups = await getUserFamilyGroups(session.user.id);
    const myGroupIds = myGroups.map((g) => g.id);

    // "family" now scopes by an explicit, authorized familyGroupId — never a
    // merge across the user's groups. With no group selected, fall back to
    // the pre-multi-group behavior: just the caller's own family-tagged rows.
    let baseWhere: { userId?: string | { in: string[] }; isFamily?: boolean; familyGroupId?: string; date: { gte: Date; lt: Date } };
    if (familyFilter === "family") {
      const familyGroupIdParam = searchParams.get("familyGroupId");
      if (familyGroupIdParam) {
        if (!myGroupIds.includes(familyGroupIdParam)) {
          return NextResponse.json(
            { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
            { status: 403 }
          );
        }
        baseWhere = { familyGroupId: familyGroupIdParam, date: { gte: startDate, lt: endDate } };
      } else {
        baseWhere = { userId: session.user.id, isFamily: true, date: { gte: startDate, lt: endDate } };
      }
    } else {
      // "mine" now reflects everything the user paid for (personal + family-tagged) — the
      // same underlying scope as "all" — the UI additionally shows a personal/family split.
      baseWhere = { userId: session.user.id, date: { gte: startDate, lt: endDate } };
    }

    const [txGroups, splitGroups, personalDebts, familyDebts, overdueCount] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["type"],
        where: baseWhere,
        _sum: { amount: true },
      }),
      // Personal vs family breakdown of the user's own transactions — only needed for "mine"
      familyFilter === "mine"
        ? prisma.transaction.groupBy({
            by: ["isFamily", "type"],
            where: { userId: session.user.id, date: { gte: startDate, lt: endDate } },
            _sum: { amount: true },
          })
        : Promise.resolve(null),
      // Personal debts: current user, isFamily=false
      prisma.debt.findMany({
        where: { userId: session.user.id, status: "ACTIVE", isFamily: false },
        include: {
          payments: { where: { status: { not: "PAID" } }, select: { amount: true } },
        },
      }),
      // Family debts banner: every ACTIVE debt tagged to ANY of the user's
      // groups (not just the one selected in the filter dropdown — this
      // banner is always-on regardless of which family-data tab is active).
      // Groupless users see nothing here (myGroupIds = []).
      prisma.debt.findMany({
        where: { familyGroupId: { in: myGroupIds }, status: "ACTIVE" },
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

    // Personal vs family breakdown — only present for familyFilter=mine
    let mineGroups: {
      personal: { income: number; expense: number; balance: number };
      family: { income: number; expense: number; balance: number };
    } | undefined;
    if (splitGroups) {
      const sumFor = (isFamily: boolean, type: "INCOME" | "EXPENSE") =>
        Number(splitGroups.find((g) => g.isFamily === isFamily && g.type === type)?._sum.amount ?? 0);
      const groupOf = (isFamily: boolean) => ({
        income: sumFor(isFamily, "INCOME"),
        expense: sumFor(isFamily, "EXPENSE"),
        balance: sumFor(isFamily, "INCOME") - sumFor(isFamily, "EXPENSE"),
      });
      mineGroups = { personal: groupOf(false), family: groupOf(true) };
    }

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
        // Personal/family breakdown of "mine" totals (familyFilter=mine only)
        ...(mineGroups ? { mineGroups } : {}),
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

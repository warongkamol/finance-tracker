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

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const familyMemberIds = await getFamilyMemberIds(session.user.id);

    // Fetch all family-tagged transactions for this period from all group members
    const txGroups = await prisma.transaction.groupBy({
      by: ["userId", "type"],
      where: {
        userId: { in: familyMemberIds },
        isFamily: true,
        date: { gte: startDate, lt: endDate },
      },
      _sum: { amount: true },
    });

    // Fetch member info (name + nickname)
    const memberUsers = await prisma.user.findMany({
      where: { id: { in: familyMemberIds } },
      select: { id: true, name: true, familyNickname: true },
    });

    const members = memberUsers.map((u) => {
      const income = Number(
        txGroups.find((g) => g.userId === u.id && g.type === "INCOME")?._sum.amount ?? 0
      );
      const expense = Number(
        txGroups.find((g) => g.userId === u.id && g.type === "EXPENSE")?._sum.amount ?? 0
      );
      return {
        userId: u.id,
        name: u.familyNickname ?? u.name,
        isMe: u.id === session.user.id,
        income,
        expense,
        balance: income - expense,
      };
    });

    const totals = members.reduce(
      (acc, m) => ({ income: acc.income + m.income, expense: acc.expense + m.expense }),
      { income: 0, expense: 0 }
    );

    return NextResponse.json({
      success: true,
      data: {
        year,
        month,
        members,
        totals: { ...totals, balance: totals.income - totals.expense },
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

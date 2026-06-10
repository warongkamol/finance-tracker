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
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    const groupId = searchParams.get("groupId");

    if (!groupId) {
      return NextResponse.json({ success: true, data: { year, month, members: [], totals: { income: 0, expense: 0, balance: 0 } } });
    }

    const membership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId } },
    });
    if (!membership) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
        { status: 403 }
      );
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    // Cross-user visibility now keys off familyGroupId directly (one specific
    // group, never a merge across groups) instead of isFamily + member-id list.
    const [txGroups, memberUsers, myAliases] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["userId", "type"],
        where: { familyGroupId: groupId, date: { gte: startDate, lt: endDate }, isTransfer: false },
        _sum: { amount: true },
      }),
      prisma.user.findMany({
        where: { familyGroups: { some: { groupId } } },
        select: { id: true, name: true },
      }),
      // Caller's private aliases — override the member's profile name, visible only to caller
      prisma.familyMemberAlias.findMany({
        where: { viewerId: session.user.id },
        select: { targetId: true, nickname: true },
      }),
    ]);
    const aliasByTarget = new Map(myAliases.map((a) => [a.targetId, a.nickname]));

    const members = memberUsers.map((u) => {
      const income = Number(
        txGroups.find((g) => g.userId === u.id && g.type === "INCOME")?._sum.amount ?? 0
      );
      const expense = Number(
        txGroups.find((g) => g.userId === u.id && g.type === "EXPENSE")?._sum.amount ?? 0
      );
      return {
        userId: u.id,
        name: aliasByTarget.get(u.id) ?? u.name,
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

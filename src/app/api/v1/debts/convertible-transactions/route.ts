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
    const accountId = searchParams.get("accountId");
    const excludeId = searchParams.get("excludeId");

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "ต้องระบุ accountId" } },
        { status: 400 }
      );
    }

    const account = await prisma.account.findFirst({
      where: { id: accountId, userId: session.user.id, type: "CREDIT_CARD" },
    });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ" } },
        { status: 404 }
      );
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: session.user.id,
        accountId,
        type: "EXPENSE",
        isTransfer: false,
        convertedToDebtId: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 50,
    });

    return NextResponse.json({ success: true, data: transactions });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

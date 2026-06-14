import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const debt = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
      include: {
        convertedTransactions: { select: { id: true } },
        payments: { select: { status: true } },
      },
    });

    if (!debt) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการหนี้สิน" } },
        { status: 404 }
      );
    }

    const paidCount = debt.payments.filter((p) => p.status === "PAID").length;
    if (debt.convertedTransactions.length === 0 || paidCount > 0 || debt.status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, error: { code: "CANNOT_UNCONVERT", message: "ไม่สามารถยกเลิกการแปลงได้" } },
        { status: 400 }
      );
    }

    const transactionIds = debt.convertedTransactions.map((t) => t.id);

    await prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: { id: { in: transactionIds } },
        data: { convertedToDebtId: null },
      });
      await tx.debt.delete({ where: { id } });
    });

    return NextResponse.json({ success: true, data: { unconverted: true } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

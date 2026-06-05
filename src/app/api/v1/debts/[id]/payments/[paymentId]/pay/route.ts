import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id: debtId, paymentId } = await params;

    const debtPayment = await prisma.debtPayment.findFirst({
      where: {
        id: paymentId,
        debtId,
        debt: { userId: session.user.id },
      },
      include: { debt: true },
    });

    if (!debtPayment) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการงวดชำระ" } },
        { status: 404 }
      );
    }

    if (debtPayment.status === "PAID") {
      return NextResponse.json(
        { success: false, error: { code: "ALREADY_PAID", message: "งวดนี้ชำระแล้ว" } },
        { status: 400 }
      );
    }

    // Parse optional body: paidDate, paymentMethodId
    let paidDate = new Date();
    let paymentMethodId: string | null = null;
    try {
      const body = await req.json();
      if (body.paidDate) paidDate = new Date(body.paidDate);
      if (body.paymentMethodId) paymentMethodId = body.paymentMethodId;
    } catch {
      // body is optional
    }

    // Find "ผ่อนชำระ/หนี้สิน" EXPENSE category for this user
    const debtCategory = await prisma.category.findFirst({
      where: {
        userId: session.user.id,
        type: "EXPENSE",
        OR: [
          { name: { contains: "ผ่อน", mode: "insensitive" } },
          { name: { contains: "หนี้", mode: "insensitive" } },
        ],
      },
      orderBy: { isDefault: "desc" },
    });

    // Fall back to first EXPENSE category if not found
    const category = debtCategory ?? await prisma.category.findFirst({
      where: { userId: session.user.id, type: "EXPENSE" },
      orderBy: { sortOrder: "asc" },
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่รายจ่าย กรุณาตั้งค่าหมวดหมู่ก่อน" } },
        { status: 404 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create transaction
      const transaction = await tx.transaction.create({
        data: {
          type: "EXPENSE",
          amount: debtPayment.amount,
          description: `ผ่อนชำระ: ${debtPayment.debt.name} งวดที่ ${debtPayment.installmentNo}`,
          date: paidDate,
          categoryId: category.id,
          paymentMethodId,
          userId: session.user.id,
          debtPaymentId: paymentId,
        },
      });

      // 2. Update payment status
      await tx.debtPayment.update({
        where: { id: paymentId },
        data: {
          status: "PAID",
          paidDate,
        },
      });

      // 3. Check if all payments are done → complete the debt
      const remainingPayments = await tx.debtPayment.count({
        where: { debtId, status: { not: "PAID" } },
      });

      if (remainingPayments === 0) {
        await tx.debt.update({
          where: { id: debtId },
          data: { status: "COMPLETED" },
        });
      }

      return transaction;
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateTransactionSchema } from "@/lib/validations/transaction";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId: session.user.id },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        paymentMethod: { select: { id: true, name: true } },
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการ" } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: transaction });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const existing = await prisma.transaction.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการ" } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = updateTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { type, amount, description, date, categoryId, paymentMethodId, isFamily, familyMemberId, familyGroupId, accountId } = parsed.data;

    // familyGroupId controls cross-user visibility — verify membership before
    // trusting a client-supplied value (mirrors the POST route's check).
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }
    const effectiveType = type ?? existing.type;

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, userId: session.user.id },
      });
      if (!category) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่" } },
          { status: 404 }
        );
      }
      if (category.type !== effectiveType) {
        return NextResponse.json(
          { success: false, error: { code: "TYPE_MISMATCH", message: "ประเภทหมวดหมู่ไม่ตรงกับประเภทรายการ" } },
          { status: 400 }
        );
      }
    }

    if (paymentMethodId) {
      const pm = await prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, userId: session.user.id },
      });
      if (!pm) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "ไม่พบช่องทางการชำระเงิน" } },
          { status: 404 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (type !== undefined) updateData.type = type;
    if (amount !== undefined) updateData.amount = amount;
    if (description !== undefined) updateData.description = description;
    if (date !== undefined) updateData.date = new Date(date);
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (paymentMethodId !== undefined) updateData.paymentMethodId = paymentMethodId;
    if (isFamily !== undefined) {
      updateData.isFamily = isFamily;
      updateData.familyMemberId = isFamily ? (familyMemberId ?? null) : null;
      updateData.familyGroupId = isFamily ? (familyGroupId ?? null) : null;
    }
    if (accountId !== undefined) updateData.accountId = accountId;

    const transaction = await prisma.transaction.update({
      where: { id },
      data: updateData,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        paymentMethod: { select: { id: true, name: true } },
        familyMember: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, data: transaction });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const existing = await prisma.transaction.findFirst({
      where: { id, userId: session.user.id },
      include: { debtPayment: { include: { debt: true } } },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการ" } },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      // Delete the transaction first (breaks the unique FK constraint)
      await tx.transaction.delete({ where: { id } });

      // If this transaction was a debt payment, revert the installment to PENDING
      if (existing.debtPaymentId) {
        await tx.debtPayment.update({
          where: { id: existing.debtPaymentId },
          data: { status: "PENDING", paidDate: null },
        });

        // If the debt was COMPLETED, revert it back to ACTIVE
        if (existing.debtPayment?.debt.status === "COMPLETED") {
          await tx.debt.update({
            where: { id: existing.debtPayment.debt.id },
            data: { status: "ACTIVE" },
          });
        }
      }
    });

    return NextResponse.json({
      success: true,
      data: { revertedDebtPayment: !!existing.debtPaymentId },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

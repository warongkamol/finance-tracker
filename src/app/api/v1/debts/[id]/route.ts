import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateDebtSchema } from "@/lib/validations/debt";

export async function GET(
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
        account: { select: { id: true, name: true } },
        payments: {
          include: { transaction: { select: { id: true } } },
          orderBy: { installmentNo: "asc" },
        },
        convertedTransactions: {
          select: {
            id: true,
            date: true,
            description: true,
            amount: true,
            category: { select: { id: true, name: true } },
          },
          orderBy: { date: "asc" },
        },
      },
    });

    if (!debt) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการหนี้สิน" } },
        { status: 404 }
      );
    }

    // Auto-mark overdue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueIds = debt.payments
      .filter((p) => p.status === "PENDING" && new Date(p.dueDate) < today)
      .map((p) => p.id);

    if (overdueIds.length > 0) {
      await prisma.debtPayment.updateMany({
        where: { id: { in: overdueIds } },
        data: { status: "OVERDUE" },
      });
      // Refresh
      for (const p of debt.payments) {
        if (overdueIds.includes(p.id)) p.status = "OVERDUE";
      }
    }

    const paidCount = debt.payments.filter((p) => p.status === "PAID").length;
    const remainingBalance = debt.payments
      .filter((p) => p.status !== "PAID")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    return NextResponse.json({
      success: true,
      data: { ...debt, paidCount, remainingBalance },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
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
    const existing = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการหนี้สิน" } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = updateDebtSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { name, notes, status } = parsed.data;

    const debt = await prisma.debt.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(notes !== undefined && { notes }),
        ...(status !== undefined && { status }),
      },
    });

    return NextResponse.json({ success: true, data: debt });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
    const existing = await prisma.debt.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบรายการหนี้สิน" } },
        { status: 404 }
      );
    }

    // Cancel instead of hard delete if there are PAID payments
    const hasPaid = await prisma.debtPayment.findFirst({
      where: { debtId: id, status: "PAID" },
    });

    if (hasPaid) {
      // Soft cancel: remove only future budget items linked to this debt
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const futureBudgets = await prisma.budget.findMany({
        where: {
          userId: session.user.id,
          OR: [
            { year: { gt: currentYear } },
            { year: currentYear, month: { gte: currentMonth } },
          ],
        },
        select: { id: true },
      });
      await prisma.budgetItem.deleteMany({
        where: { debtId: id, budgetId: { in: futureBudgets.map(b => b.id) } },
      });

      await prisma.debt.update({ where: { id }, data: { status: "CANCELLED" } });
      return NextResponse.json({ success: true, data: { cancelled: true } });
    }

    // Hard delete: onDelete:Cascade on budgetItems removes linked budget items automatically
    await prisma.debt.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}


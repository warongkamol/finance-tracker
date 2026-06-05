import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDebtSchema } from "@/lib/validations/debt";
import { DebtStatus, Prisma } from "@/generated/prisma/client";
import { addMonths } from "@/lib/utils";

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
    const statusParam = searchParams.get("status");

    const where: Prisma.DebtWhereInput = { userId: session.user.id };
    if (statusParam === "ACTIVE" || statusParam === "COMPLETED" || statusParam === "CANCELLED") {
      where.status = statusParam as DebtStatus;
    }

    const debts = await prisma.debt.findMany({
      where,
      include: {
        payments: {
          select: { id: true, status: true, amount: true, dueDate: true, installmentNo: true },
          orderBy: { installmentNo: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Compute remaining balance per debt
    const now = new Date();
    const enriched = debts.map((debt) => {
      const unpaidPayments = debt.payments.filter((p) => p.status !== "PAID");
      const remainingBalance = unpaidPayments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const paidCount = debt.payments.filter((p) => p.status === "PAID").length;
      const overdueCount = debt.payments.filter(
        (p) => p.status === "PENDING" && new Date(p.dueDate) < now
      ).length;
      return { ...debt, remainingBalance, paidCount, overdueCount };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = createDebtSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes } = parsed.data;

    const effectiveMonthly = monthlyAmount ?? totalAmount / totalMonths;
    const start = new Date(startDate);
    // endDate = last installment month (startDate + totalMonths - 1)
    const end = addMonths(start, totalMonths - 1);

    const debt = await prisma.$transaction(async (tx) => {
      const created = await tx.debt.create({
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount: effectiveMonthly,
          startDate: start,
          endDate: end,
          notes: notes ?? null,
          userId: session.user.id,
          status: "ACTIVE",
        },
      });

      // Auto-generate payment records
      const payments = Array.from({ length: totalMonths }, (_, i) => ({
        debtId: created.id,
        installmentNo: i + 1,
        dueDate: addMonths(start, i),
        amount: new Prisma.Decimal(effectiveMonthly),
        status: "PENDING" as const,
      }));

      await tx.debtPayment.createMany({ data: payments });

      return tx.debt.findUnique({
        where: { id: created.id },
        include: {
          payments: { orderBy: { installmentNo: "asc" } },
        },
      });
    });

    return NextResponse.json({ success: true, data: debt }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

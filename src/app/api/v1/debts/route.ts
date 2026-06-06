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
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const enriched = debts.map((debt) => {
      const unpaidPayments = debt.payments.filter((p) => p.status !== "PAID");
      const remainingBalance = unpaidPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const paidCount = debt.payments.filter((p) => p.status === "PAID").length;
      const overdueCount = debt.payments.filter(
        (p) => p.status === "PENDING" && new Date(p.dueDate) < now
      ).length;
      return { ...debt, remainingBalance, paidCount, overdueCount };
    });

    // Planned future liabilities from budget (not linked to any existing debt)
    const futureBudgets = await prisma.budget.findMany({
      where: {
        userId: session.user.id,
        OR: [
          { year: { gt: currentYear } },
          { year: currentYear, month: { gte: currentMonth } },
        ],
      },
      include: {
        items: {
          where: { type: "LIABILITY", debtId: null },
          select: { id: true, name: true, amount: true, notes: true },
        },
      },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });

    const plannedLiabilities = futureBudgets
      .filter(b => b.items.length > 0)
      .map(b => ({
        year: b.year,
        month: b.month,
        items: b.items.map(item => ({
          id: item.id,
          name: item.name,
          amount: Number(item.amount),
          notes: item.notes,
        })),
      }));

    return NextResponse.json({ success: true, data: enriched, plannedLiabilities });
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

      // Auto-create budget LIABILITY items for each payment month
      for (let i = 0; i < totalMonths; i++) {
        const dueDate = addMonths(start, i);
        const payYear = dueDate.getFullYear();
        const payMonth = dueDate.getMonth() + 1;

        const budget = await tx.budget.upsert({
          where: { userId_year_month: { userId: session.user.id, year: payYear, month: payMonth } },
          create: { userId: session.user.id, year: payYear, month: payMonth },
          update: {},
        });

        // Find max sortOrder for this budget
        const maxOrder = await tx.budgetItem.aggregate({
          where: { budgetId: budget.id },
          _max: { sortOrder: true },
        });

        await tx.budgetItem.create({
          data: {
            budgetId: budget.id,
            debtId: created.id,
            name: created.name,
            type: "LIABILITY",
            amount: new Prisma.Decimal(effectiveMonthly),
            notes: `งวดที่ ${i + 1}/${totalMonths}`,
            sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
          },
        });
      }

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

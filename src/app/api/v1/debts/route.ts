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
        account: { select: { id: true, name: true } },
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
      const remainingBalance = unpaidPayments.reduce((sum, p) => sum + Number(p.amount), 0);
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

    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId, accountId } = parsed.data;
    const isFamily = typeof body.isFamily === "boolean" ? body.isFamily : false;

    // familyGroupId controls cross-user visibility — verify membership before
    // trusting a client-supplied value (mirrors the transactions routes' check).
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

    // accountId must reference a CREDIT_CARD/loan account owned by this user —
    // one check covers "doesn't exist", "belongs to another user", and "wrong type"
    if (accountId) {
      const acc = await prisma.account.findFirst({
        where: { id: accountId, userId: session.user.id, type: "CREDIT_CARD" },
      });
      if (!acc) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชีบัตรเครดิต/สินเชื่อ" } },
          { status: 404 }
        );
      }
    }

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
          isFamily: isFamily ?? false,
          familyGroupId: isFamily ? (familyGroupId ?? null) : null,
          accountId: accountId ?? null,
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

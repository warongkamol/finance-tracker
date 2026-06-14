import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { convertToDebtSchema } from "@/lib/validations/debt";
import { addMonths } from "@/lib/utils";
import { createDebtPaymentsAndBudgetItems } from "@/lib/debt-helpers";

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
    const parsed = convertToDebtSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { transactionIds, totalMonths, interestRate, name } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { tier: true },
    });
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: transactionIds },
        userId: session.user.id,
        type: "EXPENSE",
        isTransfer: false,
        convertedToDebtId: null,
      },
      include: { account: { select: { id: true, type: true } } },
    });

    if (transactions.length !== transactionIds.length) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_TRANSACTIONS", message: "รายการที่เลือกไม่ถูกต้องหรือถูกแปลงไปแล้ว" },
        },
        { status: 400 }
      );
    }

    const accountId = transactions[0].accountId;
    const sameAccount = transactions.every((t) => t.accountId === accountId);
    if (!accountId || !sameAccount || transactions[0].account?.type !== "CREDIT_CARD") {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_ACCOUNT", message: "ต้องเป็นรายการจากบัญชีบัตรเครดิต/สินเชื่อใบเดียวกัน" },
        },
        { status: 400 }
      );
    }

    if (transactionIds.length > 1 && user.tier !== "PRO") {
      return NextResponse.json(
        { success: false, error: { code: "TIER_RESTRICTED", message: "ฟีเจอร์นี้สำหรับ Pro" } },
        { status: 403 }
      );
    }
    if ((interestRate ?? 0) > 0 && user.tier !== "PRO") {
      return NextResponse.json(
        { success: false, error: { code: "TIER_RESTRICTED", message: "ฟีเจอร์นี้สำหรับ Pro" } },
        { status: 403 }
      );
    }

    const principal = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const monthlyRate = (interestRate ?? 0) / 100;
    const totalAmount = principal * (1 + monthlyRate * totalMonths);
    const monthlyAmount = totalAmount / totalMonths;

    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const startDate = addMonths(today, 1);
    const endDate = addMonths(startDate, totalMonths - 1);

    const debt = await prisma.$transaction(async (tx) => {
      const created = await tx.debt.create({
        data: {
          name,
          totalAmount,
          totalMonths,
          monthlyAmount,
          interestRate: interestRate ?? null,
          startDate,
          endDate,
          accountId,
          userId: session.user.id,
          status: "ACTIVE",
        },
      });

      await createDebtPaymentsAndBudgetItems(tx, {
        debtId: created.id,
        debtName: created.name,
        totalMonths,
        monthlyAmount,
        startDate,
        userId: session.user.id,
      });

      await tx.transaction.updateMany({
        where: { id: { in: transactionIds } },
        data: { convertedToDebtId: created.id },
      });

      return tx.debt.findUnique({
        where: { id: created.id },
        include: {
          account: { select: { id: true, name: true } },
          payments: { orderBy: { installmentNo: "asc" } },
        },
      });
    });

    return NextResponse.json(
      { success: true, data: { debt, convertedTransactionIds: transactionIds } },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

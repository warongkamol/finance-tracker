import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAccountSchema } from "@/lib/validations/account";
import { getCycleStart } from "@/lib/utils";

async function computeAccountBalance(
  accountId: string,
  initialBalance: number
): Promise<number> {
  const [income, expense, tfOut, tfIn] = await Promise.all([
    prisma.transaction.aggregate({
      where: { accountId, type: "INCOME", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId, type: "EXPENSE", isTransfer: false },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { fromAccountId: accountId },
      _sum: { amount: true },
    }),
    prisma.transfer.aggregate({
      where: { toAccountId: accountId },
      _sum: { amount: true },
    }),
  ]);
  return (
    initialBalance +
    Number(income._sum.amount ?? 0) -
    Number(expense._sum.amount ?? 0) -
    Number(tfOut._sum.amount ?? 0) +
    Number(tfIn._sum.amount ?? 0)
  );
}

async function computeCycleUsed(
  accountId: string,
  statementDay: number
): Promise<number> {
  const cycleStart = getCycleStart(statementDay);
  const result = await prisma.transaction.aggregate({
    where: {
      accountId,
      type: "EXPENSE",
      isTransfer: false,
      date: { gte: cycleStart },
    },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }
    const accounts = await prisma.account.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const enriched = await Promise.all(
      accounts.map(async (acc) => {
        const balance = await computeAccountBalance(
          acc.id,
          Number(acc.initialBalance)
        );
        const cycleUsed =
          acc.type === "CREDIT_CARD" && acc.statementDay
            ? await computeCycleUsed(acc.id, acc.statementDay)
            : null;
        return {
          id: acc.id,
          name: acc.name,
          type: acc.type,
          balance,
          initialBalance: Number(acc.initialBalance),
          creditLimit: acc.creditLimit ? Number(acc.creditLimit) : null,
          cycleUsed,
          statementDay: acc.statementDay,
          paymentDueDay: acc.paymentDueDay,
          isDefault: acc.isDefault,
          isActive: acc.isActive,
          sortOrder: acc.sortOrder,
          createdAt: acc.createdAt,
        };
      })
    );
    return NextResponse.json({ success: true, data: enriched });
  } catch (err) {
    console.error("GET /api/v1/accounts error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
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
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
          },
        },
        { status: 400 }
      );
    }
    const data = parsed.data;
    const account = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.account.updateMany({
          where: { userId: session.user.id },
          data: { isDefault: false },
        });
      }
      return tx.account.create({
        data: {
          userId: session.user.id,
          name: data.name,
          type: data.type,
          initialBalance: data.initialBalance ?? 0,
          creditLimit: data.creditLimit ?? null,
          statementDay: data.statementDay ?? null,
          paymentDueDay: data.paymentDueDay ?? null,
          isDefault: data.isDefault ?? false,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    });
    return NextResponse.json(
      { success: true, data: { id: account.id } },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/v1/accounts error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

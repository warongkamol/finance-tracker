import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateAccountSchema } from "@/lib/validations/account";
import { computeAccountBalance } from "@/lib/account-balance";

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
    const account = await prisma.account.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชี" } },
        { status: 404 }
      );
    }

    const balance = await computeAccountBalance(
      id,
      Number(account.initialBalance),
      account.type
    );

    const recentTransactions = await prisma.transaction.findMany({
      where: { accountId: id, isTransfer: false },
      orderBy: { date: "desc" },
      take: 20,
      include: {
        category: { select: { name: true, icon: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: account.id,
        name: account.name,
        type: account.type,
        balance,
        initialBalance: Number(account.initialBalance),
        creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
        statementDay: account.statementDay,
        paymentDueDay: account.paymentDueDay,
        isDefault: account.isDefault,
        sortOrder: account.sortOrder,
        recentTransactions: recentTransactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description,
          date: t.date,
          categoryName: t.category?.name ?? null,
          categoryIcon: t.category?.icon ?? null,
        })),
      },
    });
  } catch (err) {
    console.error("GET /api/v1/accounts/[id] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const account = await prisma.account.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชี" } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = updateAccountSchema.safeParse(body);
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
    await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.account.updateMany({
          where: { userId: session.user.id, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.account.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.initialBalance !== undefined && {
            initialBalance: data.initialBalance,
          }),
          ...(data.creditLimit !== undefined && {
            creditLimit: data.creditLimit,
          }),
          ...(data.statementDay !== undefined && {
            statementDay: data.statementDay,
          }),
          ...(data.paymentDueDay !== undefined && {
            paymentDueDay: data.paymentDueDay,
          }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        },
      });
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/v1/accounts/[id] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
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
    const account = await prisma.account.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชี" } },
        { status: 404 }
      );
    }

    const [txCount, tfCount] = await Promise.all([
      prisma.transaction.count({ where: { accountId: id } }),
      prisma.transfer.count({
        where: { OR: [{ fromAccountId: id }, { toAccountId: id }] },
      }),
    ]);
    if (txCount > 0 || tfCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "HAS_TRANSACTIONS",
            message: "ไม่สามารถลบได้ มีรายการที่เชื่อมอยู่",
          },
        },
        { status: 409 }
      );
    }
    await prisma.account.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/v1/accounts/[id] error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transferSchema } from "@/lib/validations/account";

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
    const parsed = transferSchema.safeParse(body);
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

    const { fromAccountId, toAccountId, amount, date, note } = parsed.data;
    const [fromAcc, toAcc] = await Promise.all([
      prisma.account.findFirst({
        where: { id: fromAccountId, userId: session.user.id },
      }),
      prisma.account.findFirst({
        where: { id: toAccountId, userId: session.user.id },
      }),
    ]);
    if (!fromAcc || !toAcc) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบบัญชีที่ระบุ" } },
        { status: 404 }
      );
    }

    const txDate = new Date(date + "T00:00:00.000Z");

    const transfer = await prisma.$transaction(async (tx) => {
      const fromTx = await tx.transaction.create({
        data: {
          userId: session.user.id,
          type: "EXPENSE",
          amount,
          date: txDate,
          description: `โอน → ${toAcc.name}${note ? ` (${note})` : ""}`,
          accountId: fromAccountId,
          isTransfer: true,
          categoryId: null,
        },
      });
      const toTx = await tx.transaction.create({
        data: {
          userId: session.user.id,
          type: "INCOME",
          amount,
          date: txDate,
          description: `โอน ← ${fromAcc.name}${note ? ` (${note})` : ""}`,
          accountId: toAccountId,
          isTransfer: true,
          categoryId: null,
        },
      });
      return tx.transfer.create({
        data: {
          userId: session.user.id,
          fromAccountId,
          toAccountId,
          amount,
          date: txDate,
          note: note ?? null,
          fromTxId: fromTx.id,
          toTxId: toTx.id,
        },
      });
    });

    return NextResponse.json(
      { success: true, data: { id: transfer.id } },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/v1/accounts/transfer error:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

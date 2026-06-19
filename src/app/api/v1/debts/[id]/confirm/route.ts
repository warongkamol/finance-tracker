import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { confirmPlannedDebtSchema } from "@/lib/validations/debt";
import { addMonths } from "@/lib/utils";
import { createDebtPaymentsAndBudgetItems } from "@/lib/debt-helpers";

export async function POST(
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

    if (existing.status !== "PLANNED") {
      return NextResponse.json(
        { success: false, error: { code: "NOT_PLANNED", message: "รายการนี้ไม่ใช่แผนการเงินที่รอยืนยัน" } },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = confirmPlannedDebtSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const totalAmount = parsed.data.totalAmount ?? Number(existing.totalAmount);
    const totalMonths = parsed.data.totalMonths ?? existing.totalMonths;
    const monthlyAmount = totalAmount / totalMonths;
    const startDate = existing.startDate;
    const endDate = addMonths(startDate, totalMonths - 1);

    const debt = await prisma.$transaction(async (tx) => {
      // Conditional update guards against a concurrent double-submit: only
      // one transaction can flip status PLANNED -> ACTIVE, so a racing
      // second request sees count 0 and aborts before touching payments.
      const { count } = await tx.debt.updateMany({
        where: { id, status: "PLANNED" },
        data: { totalAmount, totalMonths, monthlyAmount, endDate, status: "ACTIVE" },
      });
      if (count === 0) {
        throw new Error("NOT_PLANNED");
      }

      // PLANNED creation already made budget-item lines for the ORIGINAL
      // totalMonths span. totalAmount/totalMonths may have just changed (the
      // original entry was an estimate), so wipe them and let
      // createDebtPaymentsAndBudgetItems below recreate the correct set —
      // simpler and less error-prone than diffing old vs new month spans.
      await tx.budgetItem.deleteMany({ where: { debtId: id } });

      const updated = await tx.debt.findUniqueOrThrow({ where: { id } });

      await createDebtPaymentsAndBudgetItems(tx, {
        debtId: id,
        debtName: updated.name,
        totalMonths,
        monthlyAmount,
        startDate,
        userId: session.user.id,
      });

      return tx.debt.findUnique({
        where: { id },
        include: {
          account: { select: { id: true, name: true } },
          payments: { orderBy: { installmentNo: "asc" } },
        },
      });
    });

    return NextResponse.json({ success: true, data: debt });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_PLANNED") {
      return NextResponse.json(
        { success: false, error: { code: "NOT_PLANNED", message: "รายการนี้ไม่ใช่แผนการเงินที่รอยืนยัน" } },
        { status: 400 }
      );
    }
    console.error("POST /api/v1/debts/[id]/confirm failed:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

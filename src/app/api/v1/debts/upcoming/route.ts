import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");

    const now = new Date();
    const year = yearParam ? parseInt(yearParam) : now.getFullYear();
    const month = monthParam ? parseInt(monthParam) : now.getMonth() + 1;

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const payments = await prisma.debtPayment.findMany({
      where: {
        dueDate: { gte: startDate, lt: endDate },
        debt: { userId: session.user.id, status: "ACTIVE" },
      },
      include: {
        debt: { select: { id: true, name: true } },
        transaction: { select: { id: true } },
      },
      orderBy: [{ dueDate: "asc" }, { installmentNo: "asc" }],
    });

    // Mark overdue (PENDING past due date)
    const today = new Date();
    const enriched = payments.map((p) => ({
      ...p,
      isOverdue: p.status === "PENDING" && new Date(p.dueDate) < today,
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

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
    const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));

    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year + 1, 0, 1));

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: session.user.id,
        date: { gte: startDate, lt: endDate },
      },
      select: { type: true, amount: true, date: true },
    });

    // Aggregate by month
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthName: SHORT_MONTHS[i],
      income: 0,
      expense: 0,
    }));

    for (const tx of transactions) {
      const m = new Date(tx.date).getUTCMonth(); // 0-indexed
      if (tx.type === "INCOME") {
        monthly[m].income += Number(tx.amount);
      } else {
        monthly[m].expense += Number(tx.amount);
      }
    }

    return NextResponse.json({ success: true, data: monthly });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

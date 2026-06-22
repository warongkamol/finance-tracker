import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ year: string; month: string; srcYear: string; srcMonth: string }> };

// POST /api/v1/budgets/:year/:month/copy-from/:srcYear/:srcMonth
export async function POST(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { year, month, srcYear, srcMonth } = await params;
  const y = parseInt(year), m = parseInt(month);
  const sy = parseInt(srcYear), sm = parseInt(srcMonth);

  const src = await prisma.budget.findUnique({
    where: { userId_year_month: { userId: session.user.id, year: sy, month: sm } },
    include: { items: true },
  });

  if (!src || src.items.length === 0) {
    return NextResponse.json({ success: false, error: "ไม่มีข้อมูลงบในเดือนต้นทาง" }, { status: 404 });
  }

  const dest = await prisma.budget.upsert({
    where: { userId_year_month: { userId: session.user.id, year: y, month: m } },
    create: { userId: session.user.id, year: y, month: m },
    update: {},
  });

  await prisma.budgetItem.deleteMany({ where: { budgetId: dest.id } });
  await prisma.budgetItem.createMany({
    data: src.items.map(item => ({
      budgetId: dest.id,
      name: item.name,
      type: item.type,
      amount: item.amount,
      categoryId: item.categoryId,
      accountId: item.accountId,
      notes: item.notes,
      sortOrder: item.sortOrder,
    })),
  });

  const result = await prisma.budget.findUnique({
    where: { id: dest.id },
    include: {
      items: {
        include: {
          category: true,
          account: { select: { id: true, name: true, type: true } },
        },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });

  // Prisma Decimal serializes via JSON.stringify without a guaranteed decimal
  // point — convert to a real number so the client's `+` sums don't silently
  // string-concatenate (see [[debug_known_issues]]).
  return NextResponse.json({
    success: true,
    data: result && { ...result, items: result.items.map(item => ({ ...item, amount: Number(item.amount) })) },
  });
}

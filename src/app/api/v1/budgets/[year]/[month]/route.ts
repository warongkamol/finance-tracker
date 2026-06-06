import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { upsertBudgetSchema } from "@/lib/validations/budget";

type Params = { params: Promise<{ year: string; month: string }> };

// GET /api/v1/budgets/:year/:month
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { year, month } = await params;
  const y = parseInt(year), m = parseInt(month);

  const budget = await prisma.budget.findUnique({
    where: { userId_year_month: { userId: session.user.id, year: y, month: m } },
    include: {
      items: {
        include: { category: true },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });

  return NextResponse.json({ success: true, data: budget ?? { year: y, month: m, items: [] } });
}

// PUT /api/v1/budgets/:year/:month — upsert all items for the month
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { year, month } = await params;
  const y = parseInt(year), m = parseInt(month);

  const body = await req.json();
  const parsed = upsertBudgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 });
  }

  // Upsert budget record
  const budget = await prisma.budget.upsert({
    where: { userId_year_month: { userId: session.user.id, year: y, month: m } },
    create: { userId: session.user.id, year: y, month: m },
    update: {},
  });

  // Replace all items: delete existing then create new
  await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });

  const items = parsed.data.items.map((item, idx) => ({
    budgetId: budget.id,
    debtId: item.debtId || null,
    name: item.name,
    type: item.type,
    amount: item.amount,
    categoryId: item.categoryId || null,
    notes: item.notes || null,
    sortOrder: item.sortOrder ?? idx,
  }));

  if (items.length > 0) {
    await prisma.budgetItem.createMany({ data: items });
  }

  const result = await prisma.budget.findUnique({
    where: { id: budget.id },
    include: { items: { include: { category: true }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }] } },
  });

  return NextResponse.json({ success: true, data: result });
}

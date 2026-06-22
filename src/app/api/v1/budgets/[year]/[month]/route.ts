import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { upsertBudgetSchema } from "@/lib/validations/budget";

type Params = { params: Promise<{ year: string; month: string }> };

// Prisma returns BudgetItem.amount as a Decimal — JSON.stringify serializes it
// to a string (no guaranteed decimal point for whole numbers), and the client
// sums items with `+` expecting a number. Convert here so the wire contract
// matches the client's `amount: number` type.
function serializeBudget<T extends { items: { amount: unknown }[] } | null>(budget: T): T {
  if (!budget) return budget;
  return {
    ...budget,
    items: budget.items.map(item => ({ ...item, amount: Number(item.amount) })),
  };
}

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
        include: {
          category: true,
          account: { select: { id: true, name: true, type: true } },
        },
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      },
    },
  });

  return NextResponse.json({ success: true, data: budget ? serializeBudget(budget) : { year: y, month: m, items: [] } });
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
    accountId: item.accountId || null,
    notes: item.notes || null,
    sortOrder: item.sortOrder ?? idx,
  }));

  if (items.length > 0) {
    await prisma.budgetItem.createMany({ data: items });
  }

  const result = await prisma.budget.findUnique({
    where: { id: budget.id },
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

  return NextResponse.json({ success: true, data: serializeBudget(result) });
}

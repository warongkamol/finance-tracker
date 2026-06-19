import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/budgets/comparison?year=2026&month=6
// Returns plan vs actual for a given month
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(now.getFullYear()));
  const month = parseInt(req.nextUrl.searchParams.get("month") ?? String(now.getMonth() + 1));

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // last day of month

  const [budget, transactions, transfers] = await Promise.all([
    prisma.budget.findUnique({
      where: { userId_year_month: { userId: session.user.id, year, month } },
      include: { items: { include: { category: true }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }] } },
    }),
    prisma.transaction.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate }, isTransfer: false, convertedToDebtId: null },
      include: { category: true, debtPayment: { select: { debtId: true } } },
    }),
    prisma.transfer.findMany({
      where: { userId: session.user.id, date: { gte: startDate, lte: endDate } },
      include: { toAccount: { select: { type: true } } },
    }),
  ]);

  // Debt-installment payments are tagged with debtPaymentId and belong to the
  // LIABILITY bucket below, not the generic EXPENSE bucket — exclude them here
  // so they aren't double-counted once also summed under their LIABILITY item.
  const nonDebtTransactions = transactions.filter(t => !t.debtPaymentId);
  const debtPaymentTransactions = transactions.filter(t => t.debtPaymentId);

  const actualIncome = nonDebtTransactions.filter(t => t.type === "INCOME").reduce((s, t) => s + Number(t.amount), 0);
  const actualExpense = nonDebtTransactions.filter(t => t.type === "EXPENSE").reduce((s, t) => s + Number(t.amount), 0);

  // A debt paid down via a credit-card-account Transfer (e.g. the "ชำระบัตรเครดิต"
  // flow) never creates a debtPaymentId-tagged transaction, so it's invisible to
  // the calc above — count any Transfer landing in a CREDIT_CARD account as a
  // real liability outflow. Same idea for SAVINGS accounts.
  const actualLiabilityTransferOutflow = transfers
    .filter(tr => tr.toAccount.type === "CREDIT_CARD")
    .reduce((s, tr) => s + Number(tr.amount), 0);
  const actualSavingTransferOutflow = transfers
    .filter(tr => tr.toAccount.type === "SAVINGS")
    .reduce((s, tr) => s + Number(tr.amount), 0);

  // A budget item pinned to a root category should roll up its children's
  // actuals too — matches how the dashboard's by-category breakdown sums
  // (transactions are tagged to leaf categories, but plans are usually made
  // against the main category).
  const matchesCategory = (t: (typeof nonDebtTransactions)[number], categoryId: string, isRoot: boolean) =>
    t.categoryId === categoryId || (isRoot && t.category?.parentId === categoryId);

  const items = (budget?.items ?? []).map(item => {
    let actual = 0;
    if (item.type === "INCOME" && item.categoryId) {
      const isRoot = item.category?.parentId == null;
      actual = nonDebtTransactions.filter(t => t.type === "INCOME" && matchesCategory(t, item.categoryId!, isRoot)).reduce((s, t) => s + Number(t.amount), 0);
    } else if (item.type === "EXPENSE" && item.categoryId) {
      const isRoot = item.category?.parentId == null;
      actual = nonDebtTransactions.filter(t => t.type === "EXPENSE" && matchesCategory(t, item.categoryId!, isRoot)).reduce((s, t) => s + Number(t.amount), 0);
    } else if (item.type === "INCOME") {
      actual = actualIncome;
    } else if (item.type === "EXPENSE") {
      actual = actualExpense;
    } else if (item.type === "LIABILITY" && item.debtId) {
      actual = debtPaymentTransactions.filter(t => t.debtPayment?.debtId === item.debtId).reduce((s, t) => s + Number(t.amount), 0);
    }
    // SAVING items have no real-money link yet (no accountId/debtId on
    // BudgetItem for SAVING) — actual stays 0 per-item; the aggregate
    // actualSaving total below still reflects real SAVINGS-account Transfers.

    const planned = Number(item.amount);
    const diff = item.type === "INCOME" ? actual - planned : planned - actual;
    const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      planned,
      actual,
      diff,
      pct,
      isOver: item.type !== "INCOME" && actual > planned,
      category: item.category ? { id: item.category.id, name: item.category.name, icon: item.category.icon } : null,
    };
  });

  const plannedIncome = items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.planned, 0);
  const plannedExpense = items.filter(i => i.type === "EXPENSE").reduce((s, i) => s + i.planned, 0);
  const plannedLiability = items.filter(i => i.type === "LIABILITY").reduce((s, i) => s + i.planned, 0);
  const plannedSaving = items.filter(i => i.type === "SAVING").reduce((s, i) => s + i.planned, 0);

  const actualLiability = items.filter(i => i.type === "LIABILITY").reduce((s, i) => s + i.actual, 0) + actualLiabilityTransferOutflow;
  const actualSaving = items.filter(i => i.type === "SAVING").reduce((s, i) => s + i.actual, 0) + actualSavingTransferOutflow;

  // --- Unmatched-category detection ---
  // A budget item with no categoryId is a catch-all that already absorbs
  // every transaction of its type into its own "actual" figure above — once
  // that catch-all exists, nothing of that type can be "outside the plan".
  const incomeItems = (budget?.items ?? []).filter(i => i.type === "INCOME");
  const expenseItems = (budget?.items ?? []).filter(i => i.type === "EXPENSE");
  const hasIncomeCatchAll = incomeItems.some(i => !i.categoryId);
  const hasExpenseCatchAll = expenseItems.some(i => !i.categoryId);

  const isCategoryMatched = (t: (typeof nonDebtTransactions)[number], typeItems: typeof incomeItems) =>
    typeItems.some(item => {
      if (!item.categoryId) return true;
      const isRoot = item.category?.parentId == null;
      return matchesCategory(t, item.categoryId, isRoot);
    });

  type UnmatchedRow = { categoryId: string | null; categoryName: string; categoryIcon: string | null; total: number };
  const aggregateByCategory = (txs: typeof nonDebtTransactions): UnmatchedRow[] => {
    const map = new Map<string, UnmatchedRow>();
    for (const t of txs) {
      const key = t.categoryId ?? "uncategorized";
      const amount = Number(t.amount);
      const existing = map.get(key);
      if (existing) {
        existing.total += amount;
      } else {
        map.set(key, {
          categoryId: t.categoryId ?? null,
          categoryName: t.category?.name ?? "ไม่ระบุหมวดหมู่",
          categoryIcon: t.category?.icon ?? null,
          total: amount,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  };

  const unmatchedIncome = hasIncomeCatchAll
    ? []
    : aggregateByCategory(nonDebtTransactions.filter(t => t.type === "INCOME" && !isCategoryMatched(t, incomeItems)));
  const unmatchedExpense = hasExpenseCatchAll
    ? []
    : aggregateByCategory(nonDebtTransactions.filter(t => t.type === "EXPENSE" && !isCategoryMatched(t, expenseItems)));

  return NextResponse.json({
    success: true,
    data: {
      year, month,
      hasBudget: !!budget,
      summary: {
        plannedIncome, plannedExpense, plannedLiability, plannedSaving,
        actualIncome, actualExpense, actualLiability, actualSaving,
        plannedNet: plannedIncome - plannedExpense - plannedLiability - plannedSaving,
        actualNet: actualIncome - actualExpense - actualLiability - actualSaving,
      },
      items,
      unmatched: {
        income: unmatchedIncome,
        expense: unmatchedExpense,
      },
    },
  });
}

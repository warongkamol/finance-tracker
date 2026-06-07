import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/push";

function formatCurrencyTH(amount: number): string {
  return `฿${amount.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * After an EXPENSE transaction is created, check if any budget EXPENSE item
 * for the same category+month is now exceeded. Creates an in-app notification
 * and sends a web push if so (deduplicated per budget item per month).
 *
 * Call fire-and-forget: checkBudgetAlert(...).catch(console.error)
 */
export async function checkBudgetAlert(opts: {
  userId: string;
  categoryId: string;
  txDate: Date;
}): Promise<void> {
  const { userId, categoryId, txDate } = opts;
  const year = txDate.getFullYear();
  const month = txDate.getMonth() + 1;

  // Find EXPENSE budget items for this month that match the category
  const budget = await prisma.budget.findUnique({
    where: { userId_year_month: { userId, year, month } },
    include: {
      items: {
        where: { type: "EXPENSE", categoryId },
      },
    },
  });

  if (!budget || budget.items.length === 0) return;

  // Total actual EXPENSE for this category this month
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  const agg = await prisma.transaction.aggregate({
    where: { userId, categoryId, type: "EXPENSE", date: { gte: startDate, lt: endDate } },
    _sum: { amount: true },
  });
  const actual = Number(agg._sum.amount ?? 0);

  for (const item of budget.items) {
    const planned = Number(item.amount);
    if (planned <= 0 || actual <= planned) continue;

    // Dedup: skip if we already sent a BUDGET_ALERT for this item this month
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: "BUDGET_ALERT",
        referenceId: item.id,
        referenceType: "budget_item",
        createdAt: { gte: monthStart, lt: monthEnd },
      },
    });
    if (existing) continue;

    const overBy = actual - planned;
    const title = `⚠️ งบเกินแผน: ${item.name}`;
    const message = `ใช้จริง ${formatCurrencyTH(actual)} / งบ ${formatCurrencyTH(planned)} (เกิน ${formatCurrencyTH(overBy)})`;

    // Create in-app notification
    await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type: "BUDGET_ALERT",
        referenceId: item.id,
        referenceType: "budget_item",
      },
    });

    // Send web push to all subscriptions
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    for (const sub of subs) {
      const result = await sendPushNotification(sub, {
        title,
        body: message,
        data: { url: `/budget`, tag: `budget-alert-${item.id}` },
      });
      if (result.expired) {
        await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } });
      }
    }
  }
}

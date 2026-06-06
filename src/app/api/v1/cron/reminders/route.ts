import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/push";

function formatAmount(amount: { toString(): string } | number | string) {
  return Number(amount.toString()).toLocaleString("th-TH");
}

function isReminderDay(reminderDay: number, isLastDayOfMonth: boolean, today: Date): boolean {
  if (isLastDayOfMonth) {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return today.getDate() === lastDay;
  }
  return today.getDate() === reminderDay;
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all active recurring transactions that are within their date range and match today's reminder day
  const recurring = await prisma.recurringTransaction.findMany({
    where: {
      isActive: true,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    include: {
      category: true,
      user: {
        include: { pushSubs: true },
      },
    },
  });

  let sent = 0;
  let created = 0;

  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  for (const item of recurring) {
    if (!isReminderDay(item.reminderDay, item.isLastDayOfMonth, today)) continue;

    // Skip if already notified today
    const alreadySent = await prisma.notification.findFirst({
      where: {
        userId: item.userId,
        referenceId: item.id,
        referenceType: "recurring_transaction",
        createdAt: { gte: today, lte: todayEnd },
      },
    });
    if (alreadySent) continue;

    const typeLabel = item.type === "INCOME" ? "รายรับ" : "รายจ่าย";
    const amountStr = `฿${formatAmount(item.amount)}`;
    const title = `${item.type === "INCOME" ? "💰" : "💸"} ครบกำหนดบันทึก: ${item.name}`;
    const body = `${amountStr} · ${typeLabel} · ${item.category.name}`;

    // Create in-app notification
    await prisma.notification.create({
      data: {
        userId: item.userId,
        title,
        message: body,
        type: "RECURRING_REMINDER",
        referenceId: item.id,
        referenceType: "recurring_transaction",
      },
    });
    created++;

    // Send push to all subscriptions
    for (const sub of item.user.pushSubs) {
      const result = await sendPushNotification(sub, {
        title,
        body,
        data: {
          recurringId: item.id,
          url: `/transactions/new?recurringId=${item.id}`,
          tag: `recurring-${item.id}`,
          actions: [
            { action: "record", title: "บันทึกเลย" },
            { action: "dismiss", title: "ข้ามไป" },
          ],
        },
      });

      if (result.expired) {
        await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } });
      } else if (result.success) {
        sent++;
      }
    }
  }

  return NextResponse.json({ success: true, data: { notificationsCreated: created, pushSent: sent } });
}

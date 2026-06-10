import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recurringSchema } from "@/lib/validations/recurring";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const items = await prisma.recurringTransaction.findMany({
    where: { userId: session.user.id },
    include: { category: true, paymentMethod: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: items });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = recurringSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 });
  }

  const { startDate, endDate, paymentMethodId, accountId, ...rest } = parsed.data;

  if (accountId) {
    const account = await prisma.account.findFirst({
      where: { id: accountId, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "ไม่พบกระเป๋าเงิน" } }, { status: 404 });
    }
  }

  const item = await prisma.recurringTransaction.create({
    data: {
      ...rest,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      paymentMethodId: paymentMethodId || null,
      accountId: accountId ?? null,
      userId: session.user.id,
    },
    include: { category: true, paymentMethod: true },
  });

  return NextResponse.json({ success: true, data: item }, { status: 201 });
}

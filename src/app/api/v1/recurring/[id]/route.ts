import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recurringSchema } from "@/lib/validations/recurring";

async function getOwned(id: string, userId: string) {
  return prisma.recurringTransaction.findFirst({ where: { id, userId } });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const item = await prisma.recurringTransaction.findFirst({
    where: { id, userId: session.user.id },
    include: { category: true, paymentMethod: true },
  });
  if (!item) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ success: true, data: item });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await getOwned(id, session.user.id);
  if (!existing) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

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

  const item = await prisma.recurringTransaction.update({
    where: { id },
    data: {
      ...rest,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      paymentMethodId: paymentMethodId || null,
      accountId: accountId ?? null,
    },
    include: { category: true, paymentMethod: true },
  });

  return NextResponse.json({ success: true, data: item });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await getOwned(id, session.user.id);
  if (!existing) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  await prisma.recurringTransaction.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

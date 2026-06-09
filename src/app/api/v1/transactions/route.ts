import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTransactionSchema } from "@/lib/validations/transaction";
import { TransactionType, Prisma } from "@/generated/prisma/client";
import { checkBudgetAlert } from "@/lib/budget-alert";

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
    const typeParam = searchParams.get("type");
    const categoryIdParam = searchParams.get("categoryId");
    const searchQuery = searchParams.get("search");
    const familyFilter = searchParams.get("familyFilter"); // "mine" | "family" | "all"

    const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
    const month = monthParam ? parseInt(monthParam) : new Date().getMonth() + 1;

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    // "family" now scopes by an explicit, authorized familyGroupId — never a
    // merge across the user's groups (per spec: switcher, not merge). With no
    // group selected (groupless user, or before the dropdown picks one), fall
    // back to the pre-multi-group behavior: just the caller's own family-tagged rows.
    let where: Prisma.TransactionWhereInput;
    if (familyFilter === "family") {
      const familyGroupIdParam = searchParams.get("familyGroupId");
      if (familyGroupIdParam) {
        const membership = await prisma.userFamilyGroup.findUnique({
          where: { userId_groupId: { userId: session.user.id, groupId: familyGroupIdParam } },
        });
        if (!membership) {
          return NextResponse.json(
            { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
            { status: 403 }
          );
        }
        where = { familyGroupId: familyGroupIdParam, date: { gte: startDate, lt: endDate }, isTransfer: false };
      } else {
        where = { userId: session.user.id, isFamily: true, date: { gte: startDate, lt: endDate }, isTransfer: false };
      }
    } else if (familyFilter === "mine") {
      where = { userId: session.user.id, isFamily: false, date: { gte: startDate, lt: endDate }, isTransfer: false };
    } else {
      where = { userId: session.user.id, date: { gte: startDate, lt: endDate }, isTransfer: false };
    }

    if (typeParam === "INCOME" || typeParam === "EXPENSE") {
      where.type = typeParam as TransactionType;
    }
    if (categoryIdParam) {
      where.categoryId = categoryIdParam;
    }
    if (searchQuery) {
      where.OR = [
        { description: { contains: searchQuery, mode: "insensitive" } },
        { category: { name: { contains: searchQuery, mode: "insensitive" } } },
      ];
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        paymentMethod: { select: { id: true, name: true } },
        debtPayment: { select: { id: true, installmentNo: true, debt: { select: { id: true, name: true } } } },
        familyMember: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ success: true, data: transactions });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = createTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { type, amount, description, date, categoryId, paymentMethodId, isFamily, familyMemberId, familyGroupId, accountId } = parsed.data;

    // familyGroupId controls cross-user visibility — verify membership before
    // trusting a client-supplied value.
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }

    const category = await prisma.category.findFirst({
      where: { id: categoryId, userId: session.user.id },
    });
    if (!category) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่" } },
        { status: 404 }
      );
    }
    if (category.type !== type) {
      return NextResponse.json(
        { success: false, error: { code: "TYPE_MISMATCH", message: "ประเภทหมวดหมู่ไม่ตรงกับประเภทรายการ" } },
        { status: 400 }
      );
    }

    if (paymentMethodId) {
      const pm = await prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, userId: session.user.id },
      });
      if (!pm) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "ไม่พบช่องทางการชำระเงิน" } },
          { status: 404 }
        );
      }
    }

    const transaction = await prisma.transaction.create({
      data: {
        type,
        amount,
        description: description ?? null,
        date: new Date(date),
        categoryId,
        paymentMethodId: paymentMethodId ?? null,
        userId: session.user.id,
        isFamily: isFamily ?? false,
        familyMemberId: isFamily ? (familyMemberId ?? null) : null,
        familyGroupId: isFamily ? (familyGroupId ?? null) : null,
        accountId: accountId ?? null,
      },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        paymentMethod: { select: { id: true, name: true } },
        familyMember: { select: { id: true, name: true } },
      },
    });

    // Fire-and-forget budget alert check for EXPENSE transactions
    if (type === "EXPENSE") {
      checkBudgetAlert({
        userId: session.user.id,
        categoryId,
        txDate: new Date(date),
      }).catch(console.error);
    }

    return NextResponse.json({ success: true, data: transaction }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

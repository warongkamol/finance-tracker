import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateCategorySchema } from "@/lib/validations/category";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const category = await prisma.category.findFirst({
      where: { id, userId: session.user.id },
      include: { children: { select: { id: true } } },
    });
    if (!category) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่" } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = updateCategorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { parentId, ...rest } = parsed.data;

    if (parentId !== undefined) {
      if (category.children.length > 0) {
        return NextResponse.json(
          { success: false, error: { code: "HAS_CHILDREN", message: "หมวดหมู่ที่มีหมวดย่อยไม่สามารถย้ายไปอยู่ใต้หมวดอื่นได้" } },
          { status: 400 }
        );
      }
      if (parentId !== null) {
        const parent = await prisma.category.findFirst({
          where: { id: parentId, userId: session.user.id },
        });
        if (!parent) {
          return NextResponse.json(
            { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่หลัก" } },
            { status: 404 }
          );
        }
        if (parent.parentId !== null) {
          return NextResponse.json(
            { success: false, error: { code: "MAX_DEPTH", message: "ไม่สามารถสร้างหมวดหมู่ซ้อนเกิน 2 ชั้น" } },
            { status: 400 }
          );
        }
      }
    }

    const updated = await prisma.category.update({
      where: { id },
      data: { ...rest, ...(parentId !== undefined ? { parentId } : {}) },
      include: { children: { orderBy: { sortOrder: "asc" } } },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { id } = await params;
    const category = await prisma.category.findFirst({
      where: { id, userId: session.user.id },
      include: {
        children: { select: { id: true, _count: { select: { transactions: true } } } },
        _count: { select: { transactions: true } },
      },
    });
    if (!category) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่" } },
        { status: 404 }
      );
    }

    const hasTransactions =
      category._count.transactions > 0 ||
      category.children.some((c) => c._count.transactions > 0);

    if (hasTransactions) {
      return NextResponse.json(
        { success: false, error: { code: "HAS_TRANSACTIONS", message: "ไม่สามารถลบหมวดหมู่ที่มีรายการบันทึกอยู่" } },
        { status: 400 }
      );
    }

    await prisma.category.delete({ where: { id } });

    return NextResponse.json({ success: true, data: null });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createCategorySchema } from "@/lib/validations/category";
import { CategoryType } from "@/generated/prisma/client";

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
    const typeParam = searchParams.get("type");

    const typeFilter =
      typeParam === "INCOME" || typeParam === "EXPENSE"
        ? { type: typeParam as CategoryType }
        : {};

    const categories = await prisma.category.findMany({
      where: { userId: session.user.id, parentId: null, ...typeFilter },
      include: {
        children: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ success: true, data: categories });
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
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { name, type, icon, color, parentId, sortOrder } = parsed.data;

    if (parentId) {
      const parent = await prisma.category.findFirst({
        where: { id: parentId, userId: session.user.id },
      });
      if (!parent) {
        return NextResponse.json(
          { success: false, error: { code: "NOT_FOUND", message: "ไม่พบหมวดหมู่หลัก" } },
          { status: 404 }
        );
      }
      if (parent.type !== type) {
        return NextResponse.json(
          { success: false, error: { code: "TYPE_MISMATCH", message: "ประเภทต้องตรงกับหมวดหมู่หลัก" } },
          { status: 400 }
        );
      }
      if (parent.parentId !== null) {
        return NextResponse.json(
          { success: false, error: { code: "MAX_DEPTH", message: "ไม่สามารถสร้างหมวดหมู่ซ้อนเกิน 2 ชั้น" } },
          { status: 400 }
        );
      }
    }

    const category = await prisma.category.create({
      data: {
        name,
        type,
        icon,
        color,
        parentId: parentId ?? null,
        sortOrder: sortOrder ?? 0,
        userId: session.user.id,
      },
      include: { children: true },
    });

    return NextResponse.json({ success: true, data: category }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

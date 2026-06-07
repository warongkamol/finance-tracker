import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  userId: z.string().min(1).optional(),
  nickname: z.string().max(50, "ชื่อเล่นยาวเกินไป").nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const targetId = parsed.data.userId ?? session.user.id;

    // Any member can rename any other member, but only within their own family group
    if (targetId !== session.user.id) {
      const [me, target] = await Promise.all([
        prisma.user.findUnique({ where: { id: session.user.id }, select: { familyGroupId: true } }),
        prisma.user.findUnique({ where: { id: targetId }, select: { familyGroupId: true } }),
      ]);
      if (!me?.familyGroupId || me.familyGroupId !== target?.familyGroupId) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "ไม่สามารถแก้ไขชื่อเล่นของสมาชิกนี้ได้" } },
          { status: 403 }
        );
      }
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: { familyNickname: parsed.data.nickname || null },
      select: { id: true, name: true, familyNickname: true },
    });

    return NextResponse.json({ success: true, data: user });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

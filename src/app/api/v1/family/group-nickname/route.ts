import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  groupId: z.string().min(1),
  nickname: z.string().max(50, "ชื่อเล่นยาวเกินไป").nullable(),
});

// Sets a PRIVATE nickname the caller uses to refer to one of their family
// groups — visible only to the caller. Mirrors alias/route.ts: it never
// changes the group's default name shown to other members.
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

    const { groupId, nickname } = parsed.data;
    const viewerId = session.user.id;

    const membership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: viewerId, groupId } },
    });
    if (!membership) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "ไม่สามารถตั้งชื่อกลุ่มนี้ได้" } },
        { status: 403 }
      );
    }

    const trimmed = nickname?.trim() || null;

    if (trimmed === null) {
      await prisma.familyGroupAlias.deleteMany({ where: { viewerId, groupId } });
      return NextResponse.json({ success: true, data: { groupId, nickname: null } });
    }

    const alias = await prisma.familyGroupAlias.upsert({
      where: { viewerId_groupId: { viewerId, groupId } },
      update: { nickname: trimmed },
      create: { viewerId, groupId, nickname: trimmed },
      select: { groupId: true, nickname: true },
    });

    return NextResponse.json({ success: true, data: { groupId: alias.groupId, nickname: alias.nickname } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  targetUserId: z.string().min(1),
  nickname: z.string().max(50, "ชื่อเล่นยาวเกินไป").nullable(),
});

// Sets a PRIVATE alias the caller uses to refer to another family-group
// member — visible only to the caller, like a contact alias in a messaging
// app. It never changes what anyone else (including the target) sees.
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

    const { targetUserId, nickname } = parsed.data;
    const viewerId = session.user.id;

    if (targetUserId === viewerId) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "ไม่สามารถตั้งชื่อเรียกตัวเองได้" } },
        { status: 400 }
      );
    }

    const [me, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: viewerId }, select: { familyGroupId: true } }),
      prisma.user.findUnique({ where: { id: targetUserId }, select: { familyGroupId: true } }),
    ]);
    if (!me?.familyGroupId || me.familyGroupId !== target?.familyGroupId) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "ไม่สามารถตั้งชื่อเรียกสมาชิกนี้ได้" } },
        { status: 403 }
      );
    }

    const trimmed = nickname?.trim() || null;

    if (trimmed === null) {
      await prisma.familyMemberAlias.deleteMany({ where: { viewerId, targetId: targetUserId } });
      return NextResponse.json({ success: true, data: { targetUserId, nickname: null } });
    }

    const alias = await prisma.familyMemberAlias.upsert({
      where: { viewerId_targetId: { viewerId, targetId: targetUserId } },
      update: { nickname: trimmed },
      create: { viewerId, targetId: targetUserId, nickname: trimmed },
      select: { targetId: true, nickname: true },
    });

    return NextResponse.json({ success: true, data: { targetUserId: alias.targetId, nickname: alias.nickname } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

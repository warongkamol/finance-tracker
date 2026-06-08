import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const leaveSchema = z.object({ groupId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = leaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "ข้อมูลไม่ถูกต้อง" } },
        { status: 400 }
      );
    }
    const { groupId } = parsed.data;

    const membership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId } },
    });
    if (!membership) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_IN_GROUP", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
        { status: 400 }
      );
    }

    await prisma.userFamilyGroup.delete({ where: { id: membership.id } });

    // Delete group if no remaining members
    const remaining = await prisma.userFamilyGroup.count({ where: { groupId } });
    if (remaining === 0) {
      await prisma.familyGroup.delete({ where: { id: groupId } });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

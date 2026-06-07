import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { familyGroupId: true },
    });

    if (!user?.familyGroupId) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_IN_GROUP", message: "คุณยังไม่ได้อยู่ในกลุ่มครอบครัว" } },
        { status: 400 }
      );
    }

    const groupId = user.familyGroupId;

    await prisma.user.update({
      where: { id: session.user.id },
      data: { familyGroupId: null },
    });

    // Delete group if no remaining members
    const remaining = await prisma.user.count({ where: { familyGroupId: groupId } });
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

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/family";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    // Check if already in a group
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { familyGroupId: true },
    });
    if (user?.familyGroupId) {
      return NextResponse.json(
        { success: false, error: { code: "ALREADY_IN_GROUP", message: "คุณอยู่ในกลุ่มครอบครัวแล้ว" } },
        { status: 400 }
      );
    }

    // Generate unique invite code
    let inviteCode = generateInviteCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.familyGroup.findUnique({ where: { inviteCode } });
      if (!existing) break;
      inviteCode = generateInviteCode();
      attempts++;
    }

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.familyGroup.create({ data: { inviteCode } });
      await tx.user.update({
        where: { id: session.user.id },
        data: { familyGroupId: created.id },
      });
      return created;
    });

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: group.id,
          inviteCode: group.inviteCode,
          members: [{ id: session.user.id, name: session.user.name, email: session.user.email, isMe: true }],
        },
      },
    }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

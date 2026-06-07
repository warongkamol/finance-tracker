import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
      select: {
        familyGroupId: true,
        familyGroup: {
          select: {
            id: true,
            inviteCode: true,
            name: true,
            members: { select: { id: true, name: true, email: true, familyNickname: true } },
          },
        },
      },
    });

    if (!user?.familyGroup) {
      return NextResponse.json({ success: true, data: { group: null } });
    }

    const group = {
      ...user.familyGroup,
      members: user.familyGroup.members.map((m) => ({
        ...m,
        displayName: m.familyNickname ?? m.name,
        isMe: m.id === session.user.id,
      })),
    };

    return NextResponse.json({ success: true, data: { group } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

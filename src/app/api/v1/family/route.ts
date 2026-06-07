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
            members: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!user?.familyGroup) {
      return NextResponse.json({ success: true, data: { group: null } });
    }

    // Private aliases the caller has set for other members — only the caller
    // can see/edit these; they override the target's profile name, but only
    // in the caller's own view.
    const myAliases = await prisma.familyMemberAlias.findMany({
      where: { viewerId: session.user.id },
      select: { targetId: true, nickname: true },
    });
    const aliasByTarget = new Map(myAliases.map((a) => [a.targetId, a.nickname]));

    const group = {
      ...user.familyGroup,
      members: user.familyGroup.members.map((m) => {
        const myAlias = aliasByTarget.get(m.id) ?? null;
        return {
          ...m,
          myAlias,
          displayName: myAlias ?? m.name,
          isMe: m.id === session.user.id,
        };
      }),
    };

    return NextResponse.json({ success: true, data: { group } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

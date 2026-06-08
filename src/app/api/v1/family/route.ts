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

    const memberships = await prisma.userFamilyGroup.findMany({
      where: { userId: session.user.id },
      select: {
        group: {
          select: {
            id: true,
            inviteCode: true,
            name: true,
            memberships: {
              select: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    if (memberships.length === 0) {
      return NextResponse.json({ success: true, data: { groups: [] } });
    }

    // Two independent private-alias resolutions for this viewer:
    // - group nicknames (FamilyGroupAlias) -> each group's displayName
    // - member nicknames (FamilyMemberAlias) -> each member's displayName
    // Neither affects what anyone else sees; both are scoped to this viewer only.
    const groupIds = memberships.map((m) => m.group.id);
    const [myGroupAliases, myMemberAliases] = await Promise.all([
      prisma.familyGroupAlias.findMany({
        where: { viewerId: session.user.id, groupId: { in: groupIds } },
        select: { groupId: true, nickname: true },
      }),
      prisma.familyMemberAlias.findMany({
        where: { viewerId: session.user.id },
        select: { targetId: true, nickname: true },
      }),
    ]);
    const groupAliasByGroup = new Map(myGroupAliases.map((a) => [a.groupId, a.nickname]));
    const memberAliasByTarget = new Map(myMemberAliases.map((a) => [a.targetId, a.nickname]));

    const groups = memberships.map(({ group }) => ({
      id: group.id,
      inviteCode: group.inviteCode,
      name: group.name,
      displayName: groupAliasByGroup.get(group.id) ?? group.name,
      members: group.memberships.map(({ user: m }) => {
        const myAlias = memberAliasByTarget.get(m.id) ?? null;
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          myAlias,
          displayName: myAlias ?? m.name,
          isMe: m.id === session.user.id,
        };
      }),
    }));

    return NextResponse.json({ success: true, data: { groups } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

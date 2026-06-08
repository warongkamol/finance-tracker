import { prisma } from "@/lib/prisma";

export interface UserFamilyGroupSummary {
  id: string;
  name: string;
  displayName: string;
}

// Returns every group the user belongs to, each resolved to the display name
// THIS viewer should see: their private group-nickname if set, else the
// group's shared default name. Ordered by joinedAt so dropdowns can default
// to "first group joined" deterministically. Feeds the three independent
// group-picker dropdowns (settings, dashboard/transactions filter, entry forms).
export async function getUserFamilyGroups(userId: string): Promise<UserFamilyGroupSummary[]> {
  const memberships = await prisma.userFamilyGroup.findMany({
    where: { userId },
    select: { group: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  if (memberships.length === 0) return [];

  const groupIds = memberships.map((m) => m.group.id);
  const myAliases = await prisma.familyGroupAlias.findMany({
    where: { viewerId: userId, groupId: { in: groupIds } },
    select: { groupId: true, nickname: true },
  });
  const aliasByGroup = new Map(myAliases.map((a) => [a.groupId, a.nickname]));

  return memberships.map(({ group }) => ({
    id: group.id,
    name: group.name,
    displayName: aliasByGroup.get(group.id) ?? group.name,
  }));
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

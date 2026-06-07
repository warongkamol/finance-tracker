import { prisma } from "@/lib/prisma";

export async function getFamilyMemberIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { familyGroupId: true },
  });
  if (!user?.familyGroupId) return [userId];
  const members = await prisma.user.findMany({
    where: { familyGroupId: user.familyGroupId },
    select: { id: true },
  });
  return members.map((m) => m.id);
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

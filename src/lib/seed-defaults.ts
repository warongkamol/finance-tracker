import { prisma } from "@/lib/prisma";

const SEED_USER_ID = "seed-default-user";

/**
 * Clone default categories and payment methods from the seed user to a newly registered user.
 * Preserves parent-child relationships by remapping parent IDs.
 */
export async function cloneDefaultsForUser(userId: string) {
  const [seedCategories, seedPaymentMethods] = await Promise.all([
    prisma.category.findMany({
      where: { userId: SEED_USER_ID, isDefault: true },
      orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.paymentMethod.findMany({
      where: { userId: SEED_USER_ID, isDefault: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  // Clone categories — parents first, then children with remapped parent IDs
  const idMap = new Map<string, string>();

  const parents = seedCategories.filter((c) => !c.parentId);
  const children = seedCategories.filter((c) => !!c.parentId);

  for (const parent of parents) {
    const created = await prisma.category.create({
      data: {
        name: parent.name,
        type: parent.type,
        icon: parent.icon,
        color: parent.color,
        sortOrder: parent.sortOrder,
        isDefault: true,
        userId,
      },
    });
    idMap.set(parent.id, created.id);
  }

  for (const child of children) {
    const newParentId = idMap.get(child.parentId!);
    if (!newParentId) continue;
    const created = await prisma.category.create({
      data: {
        name: child.name,
        type: child.type,
        icon: child.icon,
        color: child.color,
        sortOrder: child.sortOrder,
        parentId: newParentId,
        isDefault: true,
        userId,
      },
    });
    idMap.set(child.id, created.id);
  }

  // Clone payment methods
  for (const pm of seedPaymentMethods) {
    await prisma.paymentMethod.create({
      data: {
        name: pm.name,
        type: pm.type,
        isDefault: true,
        sortOrder: pm.sortOrder,
        userId,
      },
    });
  }
}

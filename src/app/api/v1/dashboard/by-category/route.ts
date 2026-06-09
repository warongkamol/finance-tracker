import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma, TransactionType } from "@/generated/prisma/client";
import { getUserFamilyGroups } from "@/lib/family";

interface CategoryChildData {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  percentage: number; // relative to parent's total
}

interface CategoryData extends CategoryChildData {
  // percentage here is relative to the grand total
  children: CategoryChildData[];
}

// Groups transactions by category, rolling child categories up into their parent
// (root) category, with a `children` breakdown for drill-down display.
async function aggregateByCategory(where: Prisma.TransactionWhereInput): Promise<CategoryData[]> {
  const grouped = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { ...where, categoryId: { not: null } },
    _sum: { amount: true },
  });
  if (grouped.length === 0) return [];

  const categoryIds = grouped
    .map((g) => g.categoryId)
    .filter((id): id is string => id !== null);
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, icon: true, color: true, parentId: true },
  });

  // Some parents may not have direct transactions — fetch them too so we can group under them
  const knownIds = new Set(categories.map((c) => c.id));
  const missingParentIds = categories
    .map((c) => c.parentId)
    .filter((id): id is string => !!id && !knownIds.has(id));
  const parentCategories = missingParentIds.length
    ? await prisma.category.findMany({
        where: { id: { in: missingParentIds } },
        select: { id: true, name: true, icon: true, color: true, parentId: true },
      })
    : [];
  const catMap = new Map([...categories, ...parentCategories].map((c) => [c.id, c]));

  interface RootAgg {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    total: number;
    children: Map<string, { id: string; name: string; icon: string | null; color: string | null; total: number }>;
  }
  const roots = new Map<string, RootAgg>();

  for (const g of grouped) {
    if (g.categoryId === null) continue;
    const amount = Number(g._sum.amount ?? 0);
    const cat = catMap.get(g.categoryId);
    if (!cat) continue;
    const rootCat = cat.parentId ? catMap.get(cat.parentId) ?? cat : cat;

    let root = roots.get(rootCat.id);
    if (!root) {
      root = { id: rootCat.id, name: rootCat.name, icon: rootCat.icon, color: rootCat.color, total: 0, children: new Map() };
      roots.set(rootCat.id, root);
    }
    root.total += amount;

    if (cat.parentId) {
      const child = root.children.get(cat.id);
      if (child) child.total += amount;
      else root.children.set(cat.id, { id: cat.id, name: cat.name, icon: cat.icon, color: cat.color, total: amount });
    }
  }

  const grandTotal = Array.from(roots.values()).reduce((sum, r) => sum + r.total, 0);

  return Array.from(roots.values())
    .sort((a, b) => b.total - a.total)
    .map((r) => ({
      categoryId: r.id,
      name: r.name,
      icon: r.icon,
      color: r.color,
      total: r.total,
      percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0,
      children: Array.from(r.children.values())
        .sort((a, b) => b.total - a.total)
        .map((c) => ({
          categoryId: c.id,
          name: c.name,
          icon: c.icon,
          color: c.color,
          total: c.total,
          percentage: r.total > 0 ? Math.round((c.total / r.total) * 100) : 0,
        })),
    }));
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { searchParams } = req.nextUrl;
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    const typeParam = searchParams.get("type") ?? "EXPENSE";
    const type = (typeParam === "INCOME" ? "INCOME" : "EXPENSE") as TransactionType;
    const familyFilter = searchParams.get("familyFilter"); // "mine" | "family" | "all"

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));
    const dateRange = { gte: startDate, lt: endDate };

    // "mine" now covers everything the user paid for (personal + family-tagged),
    // split into two groups so each can be reviewed separately.
    if (familyFilter === "mine") {
      const [personal, family] = await Promise.all([
        aggregateByCategory({ userId: session.user.id, type, isFamily: false, date: dateRange, isTransfer: false }),
        aggregateByCategory({ userId: session.user.id, type, isFamily: true, date: dateRange, isTransfer: false }),
      ]);
      return NextResponse.json({ success: true, data: { personal, family } });
    }

    let where: Prisma.TransactionWhereInput;
    if (familyFilter === "family") {
      const familyGroupIdParam = searchParams.get("familyGroupId");
      if (familyGroupIdParam) {
        const myGroups = await getUserFamilyGroups(session.user.id);
        if (!myGroups.some((g) => g.id === familyGroupIdParam)) {
          return NextResponse.json(
            { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
            { status: 403 }
          );
        }
        where = { familyGroupId: familyGroupIdParam, type, date: dateRange, isTransfer: false };
      } else {
        where = { userId: session.user.id, type, isFamily: true, date: dateRange, isTransfer: false };
      }
    } else {
      where = { userId: session.user.id, type, date: dateRange, isTransfer: false };
    }

    const data = await aggregateByCategory(where);
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}

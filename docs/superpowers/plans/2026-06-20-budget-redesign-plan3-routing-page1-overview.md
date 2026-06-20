# Budget Redesign Plan 3/6 — Routing Restructure + Page 1 Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic tabbed `/budget` page into 3 real routes (`/budget`, `/budget/plan`, `/budget/track`) with a shared segmented nav, and rebuild `/budget` itself as the "ภาพรวม" (yearly overview) page per spec Sections 2+3 — restyled plan-vs-actual chart, unchanged allocation donut, and a brand-new category-by-month stacked chart with drill-down.

**Architecture:** `_shared.tsx` gains two new exports (`BudgetTopNav`, `PlanVsActualChart`) so the chart is reused verbatim across `/budget` and `/budget/plan`, matching spec Section 4's requirement. A new API route (`/api/v1/budgets/category-breakdown`) aggregates actual EXPENSE transactions by root category per month, capped to the year's top-6 categories (rest bucketed as "อื่นๆ"). `/budget/plan` is created now (not just stubbed) because the spec requires removing the 12-month grid from `/budget` immediately — moving it verbatim into `/budget/plan` avoids a feature regression while the rest of Page 2 (Section 4's %-of-income rows) waits for Plan 4. `/budget/track` is a real route with a placeholder body only (its content is Plan 5, which depends on Plan 2's already-shipped comparison-API rewrite).

**Tech Stack:** Next.js 14 App Router (client components), Recharts 3.8, Prisma, existing `ios-card` design system.

---

## Part 1 — Summary (read this before touching code)

### What's being built

This is Plan 3 of the 6-plan budget-page redesign (Plans 1 and 2 already shipped — `PLANNED` debt status and the comparison-API rewrite). Plan 3 covers spec Sections 2 and 3 of `docs/superpowers/specs/2026-06-18-budget-page-redesign-design.md`: turning today's single `/budget` page (which crams a 3-tab dashboard — ภาพรวม/แผนเทียบจริง/สัดส่วน — plus a 12-month grid into one screen) into three purpose-built routes, and fully building out the first one.

After this plan ships:
- `/budget` (ภาพรวม) shows, always visible (no more internal tabs): a year-totals summary card, the restyled plan-vs-actual chart, the allocation donut (unchanged), and a new category-by-month stacked bar chart that opens a per-month breakdown sheet on tap.
- `/budget/plan` (วางแผนงบรายเดือน) shows the same shared plan-vs-actual chart plus the 12-month grid, moved verbatim from today's `/budget`. (The %-of-income expandable rows from spec Section 4 are Plan 4's job, not this plan's — `/budget/plan` ships today without them and gets them added on top later.)
- `/budget/track` (ติดตามสถานะใช้จ่าย) is a real route reachable from the segmented nav, but its body is just a "coming soon" placeholder — its actual content (spec Section 5) is Plan 5's job.
- All three pages share a `BudgetTopNav` segmented control at the top, which is real `<Link>` navigation (not local tab state) and preserves the selected year across navigation via `?year=`.

### Key design decisions

**Why move the grid into `/budget/plan` now instead of leaving it on `/budget` until Plan 4 ships:** the spec is explicit that the grid is "removed from this page" (Section 3) — leaving it in place would contradict the spec, but deleting it with nowhere to go would regress the only entry point into the month-detail page. Moving it now, verbatim, costs nothing (it's the same code, same API, same route target) and means `/budget/plan` already matches spec Section 4 minus the one feature (%-of-income rows) that Plan 4 owns. This was confirmed with the user before writing this plan (see chat).

**Why `/budget/track` is stubbed rather than left out of the nav entirely:** spec Section 2 says all three routes share one segmented control. If `/budget/track` didn't exist yet, the nav would either omit the third tab (visually inconsistent with the final design testers will eventually see) or link to a 404. A placeholder page costs one small file and keeps the nav truthful to the final shape without pulling Plan 5's actual content (which depends on a fuller design pass over spec Section 5) into this plan.

**Why a new `category-breakdown` API endpoint instead of reusing `dashboard/by-category`:** the existing `/api/v1/dashboard/by-category` endpoint aggregates one type/month/family-filter combination at a time — exactly right for the drill-down sheet (reused as-is, no changes), but it has no concept of "give me all 12 months at once, with a consistent top-N category set so a stacked bar's segments and colors don't shuffle from month to month." The new endpoint picks the year's top-6 EXPENSE root categories by total spend once, then buckets every month's spend into those 6 plus a catch-all "อื่นๆ" — that's what a legible stacked bar needs. Drilling into a specific month's full detail still goes through the existing endpoint, so there's no duplicate aggregation logic for that part.

**Why "over budget" coloring is uniform across the รายรับ and รายจ่าย charts:** spec Section 3 describes the over-plan warning color once, generically, and says the chart component is reused verbatim on both this page and `/budget/plan`. Building an asymmetric rule (e.g., "over-plan is good for income, bad for expense") isn't in the spec and isn't needed for Plan 3 — the chart just signals "actual surpassed the planned figure" the same way in both places.

### What's explicitly out of scope for this plan

- Spec Section 4's %-of-income expandable rows — Plan 4.
- Spec Section 5's real `/budget/track` content (two side-by-side cards, the "งบประมาณ" list, the "รายรับรายจ่ายนอกแผน" unmatched-category card) — Plan 5. Plan 2's comparison-API rewrite already shipped the data this page will need.
- Spec Section 6's month-detail page changes (removing "เทียบจริง" button, DebtForm-based LIABILITY field, SAVING wallet picker) — Plan 6. The "เทียบจริง" Sheet stays on `/budget/[year]/[month]` for now; only its back-link target changes in this plan (see Task 6).
- Any schema/migration work — none needed, this plan is API + UI only.
- Automated unit tests — this repo's established pattern for the budget-redesign plans (Plans 1 and 2, both user-confirmed) is `tsc --noEmit` clean per task plus one manual Playwright e2e script at the end, not a unit-test suite. Plan 3 follows the same pattern.

---

## Part 2 — Implementation Tasks

### Task 1: Category-breakdown API endpoint

**Files:**
- Create: `src/app/api/v1/budgets/category-breakdown/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TOP_N = 6;
const FALLBACK_PALETTE = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"];

// GET /api/v1/budgets/category-breakdown?year=2026
// Returns actual EXPENSE totals per root category per month, restricted to the
// year's top-N categories by total spend (everything else bucketed into
// "other"). Powers the /budget overview page's category-by-month stacked bar.
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear()));
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year + 1, 0, 1));

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: session.user.id,
        type: "EXPENSE",
        isTransfer: false,
        convertedToDebtId: null,
        categoryId: { not: null },
        date: { gte: startDate, lt: endDate },
      },
      select: { amount: true, date: true, categoryId: true },
    });

    const emptyMonths = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, monthName: SHORT_MONTHS[i], totals: {} as Record<string, number>, otherTotal: 0,
    }));

    if (transactions.length === 0) {
      return NextResponse.json({ success: true, data: { categories: [], months: emptyMonths } });
    }

    const categoryIds = [...new Set(transactions.map((t) => t.categoryId as string))];
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, icon: true, color: true, parentId: true },
    });

    // Some parents may not be in the set above (no direct transactions) — fetch
    // them too so child-category spend can roll up correctly.
    const knownIds = new Set(categories.map((c) => c.id));
    const missingParentIds = [...new Set(
      categories.map((c) => c.parentId).filter((id): id is string => !!id && !knownIds.has(id))
    )];
    const parentCategories = missingParentIds.length
      ? await prisma.category.findMany({
          where: { id: { in: missingParentIds } },
          select: { id: true, name: true, icon: true, color: true, parentId: true },
        })
      : [];
    const catMap = new Map([...categories, ...parentCategories].map((c) => [c.id, c]));

    const monthRootTotals: Map<string, number>[] = Array.from({ length: 12 }, () => new Map());
    const yearRootTotals = new Map<string, number>();

    for (const tx of transactions) {
      const cat = catMap.get(tx.categoryId as string);
      if (!cat) continue;
      const rootId = cat.parentId ?? cat.id;
      const monthIdx = new Date(tx.date).getUTCMonth();
      const amount = Number(tx.amount);
      monthRootTotals[monthIdx].set(rootId, (monthRootTotals[monthIdx].get(rootId) ?? 0) + amount);
      yearRootTotals.set(rootId, (yearRootTotals.get(rootId) ?? 0) + amount);
    }

    const topRootIds = [...yearRootTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([id]) => id);
    const topSet = new Set(topRootIds);

    const responseCategories = topRootIds.map((id, i) => {
      const cat = catMap.get(id)!;
      return { id, name: cat.name, icon: cat.icon, color: cat.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] };
    });

    const months = Array.from({ length: 12 }, (_, i) => {
      const totals: Record<string, number> = {};
      let otherTotal = 0;
      for (const [rootId, amount] of monthRootTotals[i]) {
        if (topSet.has(rootId)) totals[rootId] = amount;
        else otherTotal += amount;
      }
      return { month: i + 1, monthName: SHORT_MONTHS[i], totals, otherTotal };
    });

    return NextResponse.json({ success: true, data: { categories: responseCategories, months } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด กรุณาลองใหม่" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/budgets/category-breakdown/route.ts
git commit -m "feat(budgets): add category-breakdown API for overview page chart"
```

---

### Task 2: Shared segmented nav + restyled plan-vs-actual chart

**Files:**
- Modify: `src/app/(app)/budget/_shared.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/app/(app)/budget/_shared.tsx`, change:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
```

to:

```typescript
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
```

- [ ] **Step 2: Add `BudgetTopNav` and `PlanVsActualChart` after the existing `Skeleton` export**

Insert this new section directly after the `Skeleton` function (which currently ends the "Constants" section, right before `// ─── Item Form ─────`):

```typescript
// ─── Top-level route nav (shared across /budget, /budget/plan, /budget/track) ─

const BUDGET_TOP_TABS = [
  { href: "/budget", label: "ภาพรวม" },
  { href: "/budget/plan", label: "วางแผน" },
  { href: "/budget/track", label: "ติดตาม" },
] as const;

export function BudgetTopNav({ year }: { year: number }) {
  const pathname = usePathname();
  return (
    <div className="ios-card p-1 grid grid-cols-3 gap-1">
      {BUDGET_TOP_TABS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link key={href} href={`${href}?year=${year}`}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold text-center transition-all",
              active ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

// ─── Plan vs Actual chart (shared by /budget and /budget/plan) ────────────────

export const OVER_BUDGET_COLOR = "#D70015";

// Generic over T (not a fixed index-signature type) so callers can pass their
// own named interface (e.g. YearlyComparisonMonth) directly — TS would reject
// assigning a plain interface to a `[key: string]: ...` index-signature type.
export function PlanVsActualChart<T extends { monthName: string }>({
  data, plannedKey, actualKey, label, color,
}: {
  data: T[];
  plannedKey: keyof T;
  actualKey: keyof T;
  label: string;
  color: string;
}) {
  const hasData = data.some(d => Number(d[plannedKey]) > 0 || Number(d[actualKey]) > 0);
  const chartData = data.map(d => ({
    ...d,
    remainder: Math.max(0, Number(d[plannedKey]) - Number(d[actualKey])),
  }));
  const hasOverBudget = chartData.some(d => Number(d[actualKey]) > Number(d[plannedKey]));

  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground mb-1">{label}</p>
      {!hasData ? (
        <p className="text-center py-6 text-[13px] text-muted-foreground">ยังไม่มีข้อมูล</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="monthName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={Y_TICK_FORMATTER} />
              <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
              <Bar dataKey={actualKey} stackId="a" radius={[3, 3, 0, 0]} maxBarSize={16}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={Number(d[actualKey]) > Number(d[plannedKey]) ? OVER_BUDGET_COLOR : color} />
                ))}
              </Bar>
              <Bar dataKey="remainder" stackId="a" fill={`${color}33`} radius={[3, 3, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-3 pt-1">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} /> จริง
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: `${color}33` }} /> คงเหลือถึงแผน
            </span>
            {hasOverBudget && (
              <span className="flex items-center gap-1 text-[11px] text-destructive">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: OVER_BUDGET_COLOR }} /> เกินแผน
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

Note: `AXIS_TICK`, `Y_TICK_FORMATTER`, and `CHART_TOOLTIP_STYLE` are already defined earlier in this same file (lines 106-108 as of Plan 2) — no new constant needed for those, just use them directly since `PlanVsActualChart` lives in the same module.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`page.tsx` still has its own old copy of `PlanVsActualChart` at this point — that's fine, it'll be deleted in Task 5. Two same-named local functions in different files don't conflict.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/budget/_shared.tsx"
git commit -m "feat(budgets): add shared BudgetTopNav and restyled PlanVsActualChart"
```

---

### Task 3: `/budget/plan` route (12-month grid moved here + shared chart)

**Files:**
- Create: `src/app/(app)/budget/plan/page.tsx`

- [ ] **Step 1: Write the route**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { BudgetTopNav, SHORT_MONTHS, Skeleton, PlanVsActualChart } from "../_shared";

interface MonthOverview {
  month: number;
  hasData: boolean;
  itemCount: number;
  totalIncome: number;
  totalExpense: number;
  totalLiability: number;
  totalSaving: number;
  netPlanned: number;
}

interface YearlyComparisonMonth {
  month: number;
  monthName: string;
  plannedIncome: number;
  plannedExpense: number;
  actualIncome: number;
  actualExpense: number;
}

export default function BudgetPlanPage() {
  const now = new Date();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(() => {
    const fromUrl = parseInt(searchParams.get("year") ?? "");
    return Number.isFinite(fromUrl) && fromUrl > 1900 && fromUrl < 3000 ? fromUrl : now.getFullYear();
  });
  const [overview, setOverview] = useState<MonthOverview[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [comparison, setComparison] = useState<YearlyComparisonMonth[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch(`/api/v1/budgets?year=${year}`);
      const d = await res.json();
      if (d.success) setOverview(d.data.months);
    } finally { setLoadingOverview(false); }
  }, [year]);
  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const fetchComparison = useCallback(async () => {
    setLoadingComparison(true);
    try {
      const res = await fetch(`/api/v1/budgets/yearly-comparison?year=${year}`);
      const d = await res.json();
      if (d.success) setComparison(d.data);
    } finally { setLoadingComparison(false); }
  }, [year]);
  useEffect(() => { fetchComparison(); }, [fetchComparison]);

  return (
    <div className="py-5 space-y-5">
      {/* Year navigator */}
      <div className="flex items-center justify-between">
        <button onClick={() => setYear(y => y - 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[20px] font-bold">งบการเงิน {year + 543}</h1>
        <button onClick={() => setYear(y => y + 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <BudgetTopNav year={year} />

      {/* Shared plan-vs-actual chart — same component used on /budget */}
      {loadingComparison ? <Skeleton className="h-64" /> : (
        <div className="ios-card px-4 py-4 space-y-4">
          <p className="text-[13px] font-semibold text-muted-foreground">แผนเทียบจริงรายเดือน</p>
          <PlanVsActualChart data={comparison} plannedKey="plannedIncome" actualKey="actualIncome" label="รายรับ" color="#34C759" />
          <PlanVsActualChart data={comparison} plannedKey="plannedExpense" actualKey="actualExpense" label="รายจ่าย" color="#FF3B30" />
        </div>
      )}

      {/* 12-month grid — moved here verbatim from /budget (Plan 3) */}
      {loadingOverview ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {overview.map(m => {
            const isCurrentMonth = m.month === now.getMonth() + 1 && year === now.getFullYear();
            return (
              <Link key={m.month} href={`/budget/${year}/${m.month}`}
                className={cn(
                  "ios-card p-3 text-left transition-all active:scale-[0.97] block",
                  isCurrentMonth && "ring-1 ring-primary/40"
                )}>
                <div className="flex items-center justify-between mb-1">
                  <span className={cn("text-[13px] font-semibold", isCurrentMonth && "text-primary")}>
                    {SHORT_MONTHS[m.month - 1]}
                  </span>
                  {m.hasData && <CheckCircle2 className="h-3.5 w-3.5 text-[#34C759]" />}
                </div>
                {m.hasData ? (
                  <>
                    <p className="text-[11px] text-[#34C759] font-medium">+{formatCurrency(m.totalIncome)}</p>
                    <p className="text-[11px] text-[#FF3B30] font-medium">
                      -{formatCurrency(m.totalExpense + m.totalLiability + m.totalSaving)}
                    </p>
                    <p className={cn("text-[12px] font-bold mt-0.5", m.netPlanned >= 0 ? "text-primary" : "text-destructive")}>
                      {m.netPlanned >= 0 ? "+" : ""}{formatCurrency(m.netPlanned)}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">ยังไม่มีงบ</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/budget/plan/page.tsx"
git commit -m "feat(budgets): add /budget/plan route with 12-month grid moved from overview"
```

---

### Task 4: `/budget/track` stub route

**Files:**
- Create: `src/app/(app)/budget/track/page.tsx`

- [ ] **Step 1: Write the route**

```typescript
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BudgetTopNav } from "../_shared";

export default function BudgetTrackPage() {
  const now = new Date();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(() => {
    const fromUrl = parseInt(searchParams.get("year") ?? "");
    return Number.isFinite(fromUrl) && fromUrl > 1900 && fromUrl < 3000 ? fromUrl : now.getFullYear();
  });

  return (
    <div className="py-5 space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={() => setYear(y => y - 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[20px] font-bold">งบการเงิน {year + 543}</h1>
        <button onClick={() => setYear(y => y + 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <BudgetTopNav year={year} />

      <div className="ios-card px-4 py-12 text-center">
        <p className="text-3xl mb-2">🚧</p>
        <p className="text-[14px] font-medium">ติดตามสถานะใช้จ่าย</p>
        <p className="text-[12px] text-muted-foreground mt-1">หน้านี้กำลังพัฒนา เร็วๆนี้</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/budget/track/page.tsx"
git commit -m "feat(budgets): add /budget/track stub route"
```

---

### Task 5: Rewrite `/budget` as Page 1 (ภาพรวม)

**Files:**
- Modify: `src/app/(app)/budget/page.tsx` (full rewrite — replace entire file contents)

- [ ] **Step 1: Replace the whole file**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatCurrency, cn } from "@/lib/utils";
import {
  type ItemType, TYPE_CONFIG, SHORT_MONTHS, Skeleton,
  CHART_TOOLTIP_STYLE, AXIS_TICK, Y_TICK_FORMATTER, BudgetTopNav, PlanVsActualChart,
} from "./_shared";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthOverview {
  month: number;
  hasData: boolean;
  itemCount: number;
  totalIncome: number;
  totalExpense: number;
  totalLiability: number;
  totalSaving: number;
  netPlanned: number;
}

interface YearlyComparisonMonth {
  month: number;
  monthName: string;
  plannedIncome: number;
  plannedExpense: number;
  actualIncome: number;
  actualExpense: number;
}

interface CategoryBreakdownCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string;
}

interface CategoryBreakdownMonth {
  month: number;
  monthName: string;
  totals: Record<string, number>;
  otherTotal: number;
}

interface CategoryBreakdownData {
  categories: CategoryBreakdownCategory[];
  months: CategoryBreakdownMonth[];
}

interface CategoryDetailRow {
  categoryId: string;
  name: string;
  icon: string | null;
  total: number;
  percentage: number;
}

const OTHER_COLOR = "#8E8E93";

// ─── Summary card (year totals, always visible) ───────────────────────────────

function SummaryCard({ overview }: { overview: MonthOverview[] }) {
  const totals = overview.reduce((acc, m) => ({
    income: acc.income + m.totalIncome,
    expense: acc.expense + m.totalExpense,
    liability: acc.liability + m.totalLiability,
    saving: acc.saving + m.totalSaving,
  }), { income: 0, expense: 0, liability: 0, saving: 0 });
  // Flat sum across the year's months — not a carried-over balance
  const net = totals.income - totals.expense - totals.liability - totals.saving;
  const totalsByType: Record<ItemType, number> = {
    INCOME: totals.income, EXPENSE: totals.expense, LIABILITY: totals.liability, SAVING: totals.saving,
  };

  return (
    <div className="ios-card px-4 py-3 space-y-1.5">
      {(["INCOME", "EXPENSE", "LIABILITY", "SAVING"] as ItemType[]).map(type => {
        const value = totalsByType[type];
        if (value === 0) return null;
        return (
          <div key={type} className="flex justify-between text-[13px]">
            <span className={TYPE_CONFIG[type].color}>{TYPE_CONFIG[type].emoji} {TYPE_CONFIG[type].label}</span>
            <span className={cn("font-semibold tabular-nums", TYPE_CONFIG[type].color)}>
              {type === "INCOME" ? "+" : "-"}{formatCurrency(value)}
            </span>
          </div>
        );
      })}
      <div className="border-t border-border/50 pt-1.5 flex justify-between text-[14px] font-bold">
        <span>คงเหลือสุทธิ (วางแผนทั้งปี)</span>
        <span className={cn("tabular-nums", net >= 0 ? "text-primary" : "text-destructive")}>
          {net >= 0 ? "+" : ""}{formatCurrency(net)}
        </span>
      </div>
    </div>
  );
}

// ─── Allocation donut (unchanged from today's "allocation" tab) ──────────────

function AllocationDonut({ overview }: { overview: MonthOverview[] }) {
  const totals = overview.reduce((acc, m) => ({
    expense: acc.expense + m.totalExpense,
    liability: acc.liability + m.totalLiability,
    saving: acc.saving + m.totalSaving,
  }), { expense: 0, liability: 0, saving: 0 });

  const typeSlices = (
    [
      { key: "EXPENSE" as const, value: totals.expense, color: "#FF3B30" },
      { key: "LIABILITY" as const, value: totals.liability, color: "#FF9500" },
      { key: "SAVING" as const, value: totals.saving, color: "#007AFF" },
    ]
  ).filter(s => s.value > 0);
  const outflowTotal = typeSlices.reduce((s, t) => s + t.value, 0);

  if (typeSlices.length === 0) {
    return (
      <div className="ios-card px-4 py-10 text-center">
        <p className="text-[13px] text-muted-foreground">ยังไม่มีรายจ่าย/หนี้สิน/เงินออมที่วางแผนไว้</p>
      </div>
    );
  }

  return (
    <div className="ios-card overflow-hidden">
      <p className="text-[13px] font-semibold text-muted-foreground px-4 pt-4 pb-1">สัดส่วนงบที่วางแผนไว้ (ตามประเภท)</p>
      <div className="px-4 pt-2">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={typeSlices} dataKey="value" nameKey="key" cx="50%" cy="50%"
                 innerRadius={48} outerRadius={72} paddingAngle={2} strokeWidth={0}>
              {typeSlices.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="divide-y divide-border">
        {typeSlices.map((s) => {
          const pct = outflowTotal > 0 ? Math.round((s.value / outflowTotal) * 100) : 0;
          return (
            <div key={s.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-base shrink-0">{TYPE_CONFIG[s.key].emoji}</span>
              <p className="text-[13px] flex-1">{TYPE_CONFIG[s.key].label}</p>
              <p className="text-[13px] font-semibold tabular-nums">{formatCurrency(s.value)}</p>
              <p className="text-[11px] text-muted-foreground w-9 text-right">{pct}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Category-by-month stacked bar (new) — taps drill into a per-month sheet ─

function CategoryByMonthChart({
  data, onMonthClick,
}: {
  data: CategoryBreakdownData;
  onMonthClick: (month: number) => void;
}) {
  const hasData = data.months.some(m => Object.keys(m.totals).length > 0 || m.otherTotal > 0);

  if (!hasData) {
    return (
      <div className="ios-card px-4 py-10 text-center">
        <p className="text-[13px] text-muted-foreground">ยังไม่มีรายจ่ายในปีนี้</p>
      </div>
    );
  }

  const chartData = data.months.map(m => ({
    monthName: m.monthName, month: m.month, other: m.otherTotal, ...m.totals,
  }));

  return (
    <div className="ios-card px-4 py-4 space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground">รายจ่ายตามหมวดหมู่รายเดือน</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="monthName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={Y_TICK_FORMATTER} />
          <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
          {data.categories.map(cat => (
            <Bar key={cat.id} dataKey={cat.id} stackId="cat" fill={cat.color} maxBarSize={16}
              onClick={(_, index) => onMonthClick(data.months[index].month)} />
          ))}
          <Bar dataKey="other" stackId="cat" fill={OTHER_COLOR} radius={[3, 3, 0, 0]} maxBarSize={16}
            onClick={(_, index) => onMonthClick(data.months[index].month)} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
        {data.categories.map(cat => (
          <span key={cat.id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
            {cat.icon} {cat.name}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: OTHER_COLOR }} />
          อื่นๆ
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground text-center pt-1">แตะแถบเพื่อดูรายละเอียดรายเดือน</p>
    </div>
  );
}

function MonthCategorySheet({
  year, month, onClose,
}: { year: number; month: number | null; onClose: () => void }) {
  const [rows, setRows] = useState<CategoryDetailRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (month === null) return;
    setLoading(true);
    fetch(`/api/v1/dashboard/by-category?year=${year}&month=${month}&type=EXPENSE`)
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.data); })
      .finally(() => setLoading(false));
  }, [year, month]);

  return (
    <Sheet open={month !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent title={month !== null ? `รายจ่ายตามหมวดหมู่ — ${SHORT_MONTHS[month - 1]} ${year + 543}` : ""}>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-center py-10 text-[13px] text-muted-foreground">ไม่มีรายจ่ายเดือนนี้</p>
        ) : (
          <div className="ios-card overflow-hidden divide-y divide-border">
            {rows.map(r => (
              <div key={r.categoryId} className="flex items-center gap-3 px-4 py-3">
                <span className="text-base shrink-0">{r.icon ?? "📁"}</span>
                <p className="text-[14px] flex-1 truncate">{r.name}</p>
                <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(r.total)}</p>
                <p className="text-[11px] text-muted-foreground w-9 text-right">{r.percentage}%</p>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const now = new Date();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(() => {
    const fromUrl = parseInt(searchParams.get("year") ?? "");
    return Number.isFinite(fromUrl) && fromUrl > 1900 && fromUrl < 3000 ? fromUrl : now.getFullYear();
  });
  const [overview, setOverview] = useState<MonthOverview[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [yearlyComparison, setYearlyComparison] = useState<YearlyComparisonMonth[]>([]);
  const [loadingYearlyComparison, setLoadingYearlyComparison] = useState(true);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownData>({ categories: [], months: [] });
  const [loadingCategoryBreakdown, setLoadingCategoryBreakdown] = useState(true);
  const [drilldownMonth, setDrilldownMonth] = useState<number | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch(`/api/v1/budgets?year=${year}`);
      const d = await res.json();
      if (d.success) setOverview(d.data.months);
    } finally { setLoadingOverview(false); }
  }, [year]);
  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const fetchYearlyComparison = useCallback(async () => {
    setLoadingYearlyComparison(true);
    try {
      const res = await fetch(`/api/v1/budgets/yearly-comparison?year=${year}`);
      const d = await res.json();
      if (d.success) setYearlyComparison(d.data);
    } finally { setLoadingYearlyComparison(false); }
  }, [year]);
  useEffect(() => { fetchYearlyComparison(); }, [fetchYearlyComparison]);

  const fetchCategoryBreakdown = useCallback(async () => {
    setLoadingCategoryBreakdown(true);
    try {
      const res = await fetch(`/api/v1/budgets/category-breakdown?year=${year}`);
      const d = await res.json();
      if (d.success) setCategoryBreakdown(d.data);
    } finally { setLoadingCategoryBreakdown(false); }
  }, [year]);
  useEffect(() => { fetchCategoryBreakdown(); }, [fetchCategoryBreakdown]);

  const hasAnyBudget = overview.some(m => m.hasData);

  return (
    <div className="py-5 space-y-5">
      {/* Year navigator */}
      <div className="flex items-center justify-between">
        <button onClick={() => setYear(y => y - 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[20px] font-bold">งบการเงิน {year + 543}</h1>
        <button onClick={() => setYear(y => y + 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <BudgetTopNav year={year} />

      {loadingOverview ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : !hasAnyBudget ? (
        <div className="ios-card px-4 py-10 text-center">
          <p className="text-[13px] text-muted-foreground">ยังไม่มีข้อมูลงบการเงินปีนี้</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
            ภาพรวมงบทั้งปี {year + 543}
          </p>

          <SummaryCard overview={overview} />

          {loadingYearlyComparison ? <Skeleton className="h-64" /> : (
            <div className="ios-card px-4 py-4 space-y-4">
              <p className="text-[13px] font-semibold text-muted-foreground">แผนเทียบจริงรายเดือน</p>
              <PlanVsActualChart data={yearlyComparison} plannedKey="plannedIncome" actualKey="actualIncome" label="รายรับ" color="#34C759" />
              <PlanVsActualChart data={yearlyComparison} plannedKey="plannedExpense" actualKey="actualExpense" label="รายจ่าย" color="#FF3B30" />
            </div>
          )}

          <AllocationDonut overview={overview} />

          {loadingCategoryBreakdown ? <Skeleton className="h-64" /> : (
            <CategoryByMonthChart data={categoryBreakdown} onMonthClick={setDrilldownMonth} />
          )}
        </div>
      )}

      <MonthCategorySheet year={year} month={drilldownMonth} onClose={() => setDrilldownMonth(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/budget/page.tsx"
git commit -m "feat(budgets): rebuild /budget as Page 1 overview (segmented nav, restyled chart, category-by-month chart)"
```

---

### Task 6: Fix month-detail page's back-link target

**Files:**
- Modify: `src/app/(app)/budget/[year]/[month]/page.tsx:250`

The 12-month grid (the only way users used to navigate into this page) now lives on `/budget/plan`, not `/budget`. The back arrow must return there.

- [ ] **Step 1: Edit the back link**

Change:

```typescript
        <Link href={`/budget?year=${year}`}
```

to:

```typescript
        <Link href={`/budget/plan?year=${year}`}
```

(This is the only line that changes in this file — everything else, including the "เทียบจริง" Sheet, stays as-is; removing that button is Plan 6's job per spec Section 6.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/budget/[year]/[month]/page.tsx"
git commit -m "fix(budgets): point month-detail back-link at /budget/plan (grid moved there)"
```

---

### Task 7: Playwright e2e verification

**Files:**
- Create (temporary, deleted at the end): `tmp-e2e-budget-plan3.mjs` (project root — Playwright's `node_modules` resolution requires this, per the established gotcha from Plan 2)

This repo's established pattern (Plans 1 and 2, both user-confirmed) is a manual Playwright script run against a local dev server, not a unit-test suite. Follow the same shape.

- [ ] **Step 1: Start the dev server**

Run (background): `NEXTAUTH_URL=http://localhost:3001 npm run dev -- -p 3001`

Wait for "Ready" in the output before continuing.

- [ ] **Step 2: Write the verification script**

```javascript
import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = `plan3check-${Date.now()}@test.local`;
const PASSWORD = "TestPass123!";
let passCount = 0, failCount = 0;

function check(label, cond) {
  if (cond) { console.log(`PASS: ${label}`); passCount++; }
  else { console.log(`FAIL: ${label}`); failCount++; }
}

// 1. Register fixture user via API (no NextAuth/CSRF involved here)
const registerRes = await fetch(`${BASE}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Plan3 Check" }),
});
const registerJson = await registerRes.json();
check("register fixture user", registerRes.status === 201 && registerJson.success);

const browser = await chromium.launch();
const page = await browser.newPage();

// 2. Log in via the real UI (NextAuth credentials flow needs the actual form/CSRF)
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/dashboard`, { timeout: 10000 });
check("login redirects to dashboard", page.url() === `${BASE}/dashboard`);

const cookies = await page.context().cookies();
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");
const YEAR = new Date().getFullYear();

async function apiCall(path, init = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader, ...(init.headers ?? {}) },
  });
}

// 3. Seed budget items for month 1 of this year: INCOME + EXPENSE
const putRes = await apiCall(`/api/v1/budgets/${YEAR}/1`, {
  method: "PUT",
  body: JSON.stringify({
    items: [
      { name: "เงินเดือน", type: "INCOME", amount: 30000, sortOrder: 0 },
      { name: "อาหาร", type: "EXPENSE", amount: 5000, sortOrder: 1 },
    ],
  }),
});
check("seed budget items for month 1", putRes.ok);

// 4. Fetch categories to tag transactions with a real EXPENSE category
const catRes = await apiCall("/api/v1/categories");
const catJson = await catRes.json();
const expenseCat = catJson.data.find(c => c.type === "EXPENSE");
check("found an EXPENSE category to tag transactions with", !!expenseCat);

// 5. Create a transaction that exceeds month 1's planned EXPENSE (5000) to trigger the over-budget color path
const txRes = await apiCall("/api/v1/transactions", {
  method: "POST",
  body: JSON.stringify({
    type: "EXPENSE", amount: 8000, date: `${YEAR}-01-15`,
    categoryId: expenseCat.id, description: "ทดสอบเกินงบ",
  }),
});
check("create over-budget transaction", txRes.ok || txRes.status === 201);

// 6. category-breakdown API shape + math
const cbRes = await apiCall(`/api/v1/budgets/category-breakdown?year=${YEAR}`);
const cbJson = await cbRes.json();
check("category-breakdown API succeeds", cbJson.success);
check("category-breakdown has <=6 top categories", cbJson.data.categories.length <= 6);
check("category-breakdown has 12 months", cbJson.data.months.length === 12);
const month1 = cbJson.data.months.find(m => m.month === 1);
const month1Total = Object.values(month1.totals).reduce((s, v) => s + v, 0) + month1.otherTotal;
check("category-breakdown month 1 total reflects the 8000 expense", Math.abs(month1Total - 8000) < 0.01);

// 7. /budget renders Page 1 sections, no grid, segmented nav present
await page.goto(`${BASE}/budget?year=${YEAR}`);
await page.waitForSelector("text=ภาพรวมงบทั้งปี");
check("/budget shows summary section", await page.locator("text=คงเหลือสุทธิ").count() > 0);
check("/budget has no 12-month grid link", await page.locator(`a[href="/budget/${YEAR}/2"]`).count() === 0);
check("/budget shows segmented nav", await page.locator("text=วางแผน").count() > 0 && await page.locator("text=ติดตาม").count() > 0);

// 8. Category chart drill-down opens a sheet
const barRects = page.locator("svg .recharts-bar-rectangle");
const barCount = await barRects.count();
check("category-by-month chart rendered bars", barCount > 0);
if (barCount > 0) {
  await barRects.first().click({ force: true });
  await page.waitForSelector("text=รายจ่ายตามหมวดหมู่ —", { timeout: 5000 }).catch(() => null);
  check("drill-down sheet opened", await page.locator("text=รายจ่ายตามหมวดหมู่ —").count() > 0);
}

// 9. Segmented nav navigates to /budget/plan, grid appears there, year preserved
await page.goto(`${BASE}/budget/plan?year=${YEAR}`);
check("/budget/plan shows the 12-month grid", await page.locator(`a[href="/budget/${YEAR}/1"]`).count() > 0);
check("/budget/plan shows year in header", await page.locator(`text=${YEAR + 543}`).count() > 0);

// 10. /budget/track is reachable and shows the placeholder
await page.goto(`${BASE}/budget/track?year=${YEAR}`);
check("/budget/track shows placeholder text", await page.locator("text=หน้านี้กำลังพัฒนา").count() > 0);

// 11. Month-detail back-link points at /budget/plan
await page.goto(`${BASE}/budget/${YEAR}/1`);
const backHref = await page.locator('a:has(svg)').first().getAttribute("href");
check("month-detail back-link targets /budget/plan", backHref === `/budget/plan?year=${YEAR}`);

await browser.close();

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
```

- [ ] **Step 3: Run it**

```bash
cp /tmp/run-check/tmp-e2e-budget-plan3.mjs ./tmp-e2e-budget-plan3.mjs 2>/dev/null; node tmp-e2e-budget-plan3.mjs
```

(If the file was written directly to the project root in Step 2, just run `node tmp-e2e-budget-plan3.mjs`.)

Expected: all `PASS:` lines, `0 failed`, exit code 0. If `category-by-month chart rendered bars` or `drill-down sheet opened` fail, check the chart's `<Bar>` `onClick` wiring before assuming the test is wrong — Recharts' DOM structure for bar rectangles can shift between minor versions, so inspect the rendered SVG with `page.screenshot()` if this step fails.

- [ ] **Step 4: Clean up the fixture user via direct DB delete**

```bash
docker exec finance-db psql -U finance -d finance_tracker -c "DELETE FROM users WHERE email LIKE 'plan3check-%@test.local';"
```

(Matches the cascade-delete pattern used in prior sessions — `users` table cascades to budgets/transactions/categories clones.)

- [ ] **Step 5: Stop the dev server and delete the temp script**

```bash
rm -f tmp-e2e-budget-plan3.mjs
```

Stop the background dev server process started in Step 1.

- [ ] **Step 6: Final whole-plan type-check**

Run: `npx tsc --noEmit`
Expected: no errors, confirming nothing regressed across all 6 prior tasks.

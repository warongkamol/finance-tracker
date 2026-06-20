# Budget Redesign Plan 4/6 — Page 2 %-of-Income Expandable Rows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the expandable รายจ่าย/หนี้สิน/เงินออม %-of-planned-yearly-income rows to `/budget/plan`, per spec Section 4 (the only piece of Page 2 not already shipped by Plan 3 — the chart and 12-month grid are already live there).

**Architecture:** One new API endpoint (`/api/v1/budgets/yearly-items`) groups `BudgetItem` rows by `(type, name)` and sums `amount` across the whole year, giving each named line item (e.g. a recurring "ค่าเช่า" or a one-off PLANNED-debt forecast like "ไอแพดโปร 2026") a single annual total. The page computes each type's yearly total from data it already fetches (`overview`), divides by yearly income for the %, and renders 3 tap-to-expand rows showing that breakdown.

**Tech Stack:** Next.js 14 App Router (client components), Prisma, existing `ios-card` design system, `_shared.tsx`'s `TYPE_CONFIG`.

---

## Part 1 — Summary (read this before touching code)

### What's being built

Plan 3 already shipped `/budget/plan` with the shared plan-vs-actual chart and the 12-month grid (moved there from the old `/budget`). This plan adds the one remaining piece of spec Section 4: three tappable rows — รายจ่าย, หนี้สิน, เงินออม — each showing what percentage of the year's planned income that type consumes. Tapping a row expands it in place to show the type's total planned amount plus a list of its named line items (e.g. tapping "หนี้สิน 10%" reveals "ไอแพดโปร 2026 — 2,000"). Any number of rows can be open at once — it's an independent per-row toggle, not an accordion.

### Key design decision: how line items are aggregated

The spec's example shows one named item per row ("ไอแพดโปร 2026 — 2,000") but doesn't say how to handle a recurring item that appears in multiple months (e.g. monthly rent, added to all 12 months with the same name and amount). Two readings were possible: list every individual month's occurrence (12 near-identical rows for one rent line — noisy, defeats the point of a percentage *summary*), or group by name and sum each item's contribution across however many months it appears in that year (one row per distinct named item, annual total). The second reading was chosen: it's the only one where the line items under a row actually sum to that row's header total (a basic correctness/trust property for a breakdown UI), and it matches how recurring items are already created in this app (the existing "ทุก 12 เดือน" / "เลือกเอง" month-picker on the item-add form duplicates the same name+amount across months — those duplicates represent one recurring budget line, not 12 distinct ones). Grouping key is `(type, name)` only, no category/debt disambiguation — within one type and one year, two items sharing a name are overwhelmingly likely to be the same recurring line the user is tracking, matching the simplest interpretation and avoiding speculative complexity the spec doesn't ask for.

### Why a new endpoint instead of reusing an existing one

`/api/v1/budgets?year=` (used for the 12-month grid) only returns aggregated totals per month — no item names. `/api/v1/budgets/:year/:month` returns named items but for one month only; calling it 12 times per page load to build a yearly item list would be wasteful and is exactly the kind of N+1-by-other-means pattern worth avoiding. A single new endpoint that groups server-side in one query is the simplest correct option, following the same shape as Plan 3's `category-breakdown` endpoint (group BudgetItem-derived data for the whole year in one pass).

### What's explicitly out of scope for this plan

- INCOME doesn't get its own %-row (it's the denominator, per spec — "% of planned yearly income" only applies to EXPENSE/LIABILITY/SAVING).
- No drill-down navigation from a line item to its source month or debt detail page — the spec's example is plain text (`name — amount`), no mention of tapping further. Don't add it speculatively.
- No changes to the chart or grid (Plan 3's territory, already shipped and verified).
- No schema changes — this plan is API + UI only, reading existing `BudgetItem` rows.

---

## Part 2 — Implementation Tasks

### Task 1: Yearly-items API endpoint

**Files:**
- Create: `src/app/api/v1/budgets/yearly-items/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type LineItemType = "EXPENSE" | "LIABILITY" | "SAVING";

// GET /api/v1/budgets/yearly-items?year=2026
// Groups EXPENSE/LIABILITY/SAVING budget items by name, summing `amount`
// across whichever months each name appears in this year. Powers the
// /budget/plan %-of-income expandable rows' line-item breakdown.
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

    const items = await prisma.budgetItem.findMany({
      where: {
        budget: { userId: session.user.id, year },
        type: { in: ["EXPENSE", "LIABILITY", "SAVING"] },
      },
      select: { name: true, type: true, amount: true },
    });

    const grouped: Record<LineItemType, Map<string, number>> = {
      EXPENSE: new Map(), LIABILITY: new Map(), SAVING: new Map(),
    };

    for (const item of items) {
      const type = item.type as LineItemType;
      const map = grouped[type];
      map.set(item.name, (map.get(item.name) ?? 0) + Number(item.amount));
    }

    const toSortedArray = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      success: true,
      data: {
        EXPENSE: toSortedArray(grouped.EXPENSE),
        LIABILITY: toSortedArray(grouped.LIABILITY),
        SAVING: toSortedArray(grouped.SAVING),
      },
    });
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
git add src/app/api/v1/budgets/yearly-items/route.ts
git commit -m "feat(budgets): add yearly-items API for /budget/plan income-percent rows"
```

---

### Task 2: Expandable %-of-income rows on `/budget/plan`

**Files:**
- Modify: `src/app/(app)/budget/plan/page.tsx`

The current file (as of Plan 3) is reproduced in full below with the changes needed. Replace the entire file with this content:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { type ItemType, TYPE_CONFIG, BudgetTopNav, SHORT_MONTHS, Skeleton, PlanVsActualChart } from "../_shared";

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

interface YearlyItemRow {
  name: string;
  amount: number;
}

interface YearlyItemsData {
  EXPENSE: YearlyItemRow[];
  LIABILITY: YearlyItemRow[];
  SAVING: YearlyItemRow[];
}

const PERCENT_ROW_TYPES = ["EXPENSE", "LIABILITY", "SAVING"] as const;

// ─── %-of-income expandable rows (new in Plan 4) ──────────────────────────────

function IncomePercentRows({
  overview, items, loading,
}: { overview: MonthOverview[]; items: YearlyItemsData; loading: boolean }) {
  const [expanded, setExpanded] = useState<Set<ItemType>>(new Set());

  if (loading) return <Skeleton className="h-40" />;

  const totals = overview.reduce((acc, m) => ({
    income: acc.income + m.totalIncome,
    expense: acc.expense + m.totalExpense,
    liability: acc.liability + m.totalLiability,
    saving: acc.saving + m.totalSaving,
  }), { income: 0, expense: 0, liability: 0, saving: 0 });

  const totalsByType: Record<typeof PERCENT_ROW_TYPES[number], number> = {
    EXPENSE: totals.expense, LIABILITY: totals.liability, SAVING: totals.saving,
  };

  function toggle(type: ItemType) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  return (
    <div className="ios-card overflow-hidden divide-y divide-border">
      {PERCENT_ROW_TYPES.map(type => {
        const total = totalsByType[type];
        const pct = totals.income > 0 ? Math.round((total / totals.income) * 100) : 0;
        const isOpen = expanded.has(type);
        const lineItems = items[type];
        return (
          <div key={type}>
            <button onClick={() => toggle(type)}
              className="w-full flex items-center justify-between px-4 py-3 text-left">
              <span className={cn("text-[14px] font-medium", TYPE_CONFIG[type].color)}>
                {TYPE_CONFIG[type].emoji} {TYPE_CONFIG[type].label}
              </span>
              <span className={cn("text-[15px] font-bold tabular-nums", TYPE_CONFIG[type].color)}>{pct}%</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-3 space-y-1.5 bg-muted/30">
                <div className="flex justify-between text-[12px] text-muted-foreground pt-1">
                  <span>ยอดรวมวางแผนทั้งปี</span>
                  <span className="font-semibold">{formatCurrency(total)}</span>
                </div>
                {lineItems.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground py-1">ไม่มีรายการ</p>
                ) : (
                  lineItems.map((it, i) => (
                    <div key={i} className="flex justify-between text-[13px]">
                      <span className="truncate">{it.name}</span>
                      <span className="tabular-nums shrink-0 ml-2">{formatCurrency(it.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
  const [yearlyItems, setYearlyItems] = useState<YearlyItemsData>({ EXPENSE: [], LIABILITY: [], SAVING: [] });
  const [loadingYearlyItems, setLoadingYearlyItems] = useState(true);

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

  const fetchYearlyItems = useCallback(async () => {
    setLoadingYearlyItems(true);
    try {
      const res = await fetch(`/api/v1/budgets/yearly-items?year=${year}`);
      const d = await res.json();
      if (d.success) setYearlyItems(d.data);
    } finally { setLoadingYearlyItems(false); }
  }, [year]);
  useEffect(() => { fetchYearlyItems(); }, [fetchYearlyItems]);

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

      {/* %-of-income expandable rows (new in Plan 4) */}
      <IncomePercentRows overview={overview} items={yearlyItems} loading={loadingOverview || loadingYearlyItems} />

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

Note: `IncomePercentRows` renders unconditionally (not gated behind a "hasAnyBudget" check) — if there's no budget data for the year, `overview` totals are all 0, `pct` evaluates to `0` for every row (the `totals.income > 0` guard prevents a divide-by-zero), and each row's expanded line-item list is empty ("ไม่มีรายการ"). This matches the existing pages' general pattern of showing zeroed structure rather than hiding sections entirely when a few totals are 0 — `/budget/plan`'s chart and grid already render in a "no data yet" state without disappearing, so this stays consistent.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/budget/plan/page.tsx"
git commit -m "feat(budgets): add %-of-income expandable rows to /budget/plan"
```

---

### Task 3: Playwright e2e verification

**Files:**
- Create (temporary, deleted at the end): `tmp-e2e-budget-plan4.mjs` (project root — Playwright's `node_modules` resolution requires this)

Same established pattern as Plans 1-3: manual Playwright script against a local dev server, not a unit-test suite.

- [ ] **Step 1: Start the dev server**

Run (background): `NEXTAUTH_URL=http://localhost:3001 npm run dev -- -p 3001`

Wait for "Ready" before continuing.

- [ ] **Step 2: Write the verification script**

```javascript
import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = `plan4check-${Date.now()}@test.local`;
const PASSWORD = "TestPass123!";
let passCount = 0, failCount = 0;

function check(label, cond) {
  if (cond) { console.log(`PASS: ${label}`); passCount++; }
  else { console.log(`FAIL: ${label}`); failCount++; }
}

const registerRes = await fetch(`${BASE}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Plan4 Check" }),
});
check("register fixture user", registerRes.status === 201 && (await registerRes.json()).success);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 1600 } });

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

// Seed: income 30000/mo for 2 months, a recurring rent EXPENSE in 2 months
// (same name+amount — should sum to one yearly-items row), a one-off
// LIABILITY forecast item in 1 month (the PLANNED-debt forecast shape).
const seedMonths = [
  { month: 1, items: [
    { name: "เงินเดือน", type: "INCOME", amount: 30000, sortOrder: 0 },
    { name: "ค่าเช่า", type: "EXPENSE", amount: 5000, sortOrder: 1 },
    { name: "ไอแพดโปร 2026", type: "LIABILITY", amount: 2000, sortOrder: 2 },
  ] },
  { month: 2, items: [
    { name: "เงินเดือน", type: "INCOME", amount: 30000, sortOrder: 0 },
    { name: "ค่าเช่า", type: "EXPENSE", amount: 5000, sortOrder: 1 },
  ] },
];
for (const { month, items } of seedMonths) {
  const res = await apiCall(`/api/v1/budgets/${YEAR}/${month}`, { method: "PUT", body: JSON.stringify({ items }) });
  check(`seed budget items for month ${month}`, res.ok);
}

// yearly-items API: rent (5000+5000=10000) and the one-off liability (2000)
const yiRes = await apiCall(`/api/v1/budgets/yearly-items?year=${YEAR}`);
const yiJson = await yiRes.json();
check("yearly-items API succeeds", yiJson.success);
const rentRow = yiJson.data.EXPENSE.find(r => r.name === "ค่าเช่า");
check("yearly-items sums รายจ่าย across 2 months (10000)", rentRow && Math.abs(rentRow.amount - 10000) < 0.01);
const liabilityRow = yiJson.data.LIABILITY.find(r => r.name === "ไอแพดโปร 2026");
check("yearly-items has the one-off LIABILITY row (2000)", liabilityRow && Math.abs(liabilityRow.amount - 2000) < 0.01);

// /budget/plan: percent rows present, expand รายจ่าย, see line items
// NOTE: the shared chart above also has a plain "รายจ่าย" text label — the
// percent-row buttons render "{emoji} {label}" (e.g. "💸 รายจ่าย"), so click
// targets use the compound emoji+text string to avoid hitting the chart label.
await page.goto(`${BASE}/budget/plan?year=${YEAR}`);
await page.waitForSelector("text=💸 รายจ่าย", { timeout: 5000 });
// Income=60000, EXPENSE total=10000 -> 17% (rounded)
check("รายจ่าย row shows 17%", await page.locator("text=17%").count() > 0);
await page.locator("text=💸 รายจ่าย").click();
await page.waitForSelector("text=ยอดรวมวางแผนทั้งปี", { timeout: 5000 });
check("expanded รายจ่าย row shows the ค่าเช่า line item", await page.locator("text=ค่าเช่า").count() > 0);
check("expanded รายจ่าย row total reads 10,000.00", await page.locator("text=10,000.00").count() > 0);

// LIABILITY=2000 -> 2000/60000 = 3% (rounded)
check("หนี้สิน row shows 3%", await page.locator("text=3%").count() > 0);
await page.locator("text=💳 หนี้สิน").click();
check("expanded หนี้สิน row shows the iPad forecast line item", await page.locator("text=ไอแพดโปร 2026").count() > 0);

// Both rows independently expanded at once (no accordion behavior)
check("both รายจ่าย and หนี้สิน sections are simultaneously expanded", await page.locator("text=ยอดรวมวางแผนทั้งปี").count() === 2);

// Collapse รายจ่าย, confirm หนี้สิน stays open
await page.locator("text=💸 รายจ่าย").click();
check("collapsing รายจ่าย leaves หนี้สิน expanded", await page.locator("text=ยอดรวมวางแผนทั้งปี").count() === 1);

// 12-month grid + chart from Plan 3 still present (no regression)
check("/budget/plan still shows the 12-month grid", await page.locator(`a[href="/budget/${YEAR}/1"]`).count() > 0);

await browser.close();

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
```

- [ ] **Step 3: Run it**

```bash
node tmp-e2e-budget-plan4.mjs
```

Expected: all `PASS:` lines, `0 failed`, exit code 0. If a percentage check fails, recompute by hand first (`income=60000`, check rounding with `Math.round`) before assuming the UI is wrong — rounding edge cases are the most likely false-positive source here.

- [ ] **Step 4: Clean up the fixture user**

```bash
docker exec finance-db psql -U finance -d finance_tracker -c "DELETE FROM users WHERE email LIKE 'plan4check-%@test.local';"
```

- [ ] **Step 5: Stop the dev server and delete the temp script**

```bash
rm -f tmp-e2e-budget-plan4.mjs
```

Stop the background dev server process started in Step 1.

- [ ] **Step 6: Final whole-plan type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

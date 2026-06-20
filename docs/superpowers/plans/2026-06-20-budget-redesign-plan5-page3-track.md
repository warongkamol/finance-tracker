# Budget Redesign Plan 5/6 — Page 3 `/budget/track` Real Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/budget/track` placeholder ("หน้านี้กำลังพัฒนา") with the real Page 3 content from spec Section 5 — a month-chip picker, two plan/actual summary cards, the renamed งบประมาณ comparison list, and a new รายรับรายจ่ายนอกแผน (unmatched-category) card — and retire the old "เทียบจริง" Sheet on the month-detail page that this replaces.

**Architecture:** No backend changes. The `/api/v1/budgets/comparison` endpoint already returns everything the spec asks for (`summary.actualNet` already accounts for Transfer-based liability/saving outflows per commit `282e266`, and `data.unmatched.{income,expense}` already exists per commit `485fef4` — both landed before this plan, evidently during earlier comparison-API work). This plan is UI-only: build `/budget/track` as a new client page consuming that existing endpoint, then delete the now-redundant comparison Sheet/button from `/budget/[year]/[month]`.

**Tech Stack:** Next.js 14 App Router (client components), existing `ios-card` design system, `_shared.tsx`'s `TYPE_CONFIG`/`Comparison` type/`BudgetTopNav`/`SHORT_MONTHS`.

---

## Part 1 — Summary (read this before touching code)

### What's being built

`/budget/track` is currently a stub (`src/app/(app)/budget/track/page.tsx`) showing a "🚧 กำลังพัฒนา" placeholder. This plan fills it in per spec Section 5: a horizontal row of 12 month chips (replacing the old per-month "เทียบจริง" button that opened a Sheet from the month-detail page), two side-by-side cards showing แผน (planned) vs ยอดใช้จริง (actual) totals for the selected month, the existing per-item plan-vs-actual list (renamed งบประมาณ, carried over verbatim from the old Sheet), and a brand-new card listing transactions whose category has no matching budget item that month (รายรับรายจ่ายนอกแผน).

### Why no backend work is needed

Spec Section 5a calls for two comparison-API fixes: the `actualNet` Transfer-outflow bug and unmatched-category detection. Both are already live in `src/app/api/v1/budgets/comparison/route.ts` — `git log` shows they shipped in commits `282e266` and `485fef4`, separately from the Plan 1-4 work, evidently as part of earlier mid-design bug-fixing (the spec's own Section 3 mentions a different, already-fixed money bug from this same period — these two are siblings to that, not yet reflected as "done" in plan-tracking memory). Re-verify this is still true at Task 1 Step 1 before writing any UI against it, but do not re-implement it.

### Key design decisions

1. **"รายจ่าย" in the two summary cards means EXPENSE+LIABILITY+SAVING combined**, not EXPENSE alone. The spec lists exactly three rows per card (รายรับ/รายจ่าย/คงเหลือ), and คงเหลือ must equal รายรับ minus รายจ่าย for the numbers to be internally consistent — the API's `plannedNet`/`actualNet` already subtract all three outflow types, so the รายจ่าย row has to be their sum to match. This mirrors the existing `/budget/plan` 12-month grid, which already combines `totalExpense + totalLiability + totalSaving` into one red number for the same reason (`src/app/(app)/budget/plan/page.tsx`, the grid card's expense line). Per-type breakdown is still available below in the งบประมาณ list, which keeps planned/actual per item including LIABILITY/SAVING individually — nothing is lost, just summarized at the top.

2. **No URL sync for the selected month.** Every existing budget page (`/budget/plan`, the old `/budget/track` stub) reads `year` from `searchParams` once on mount but never calls `router.replace` when the user changes it via the chevrons — state lives in React only. The month chip follows the same convention for consistency: local `useState`, no URL writes. (Year *is* read from the URL on mount, same as today, since `BudgetTopNav` already links between tabs with `?year=`.)

3. **No blocking "no budget" empty state for the whole page.** The old Sheet returned early with a centered "ยังไม่ได้ตั้งงบเดือนนี้" message and hid everything else when `!comparison.hasBudget`. That doesn't fit here: actual transactions and the unmatched-category card are meaningful even with zero budget items (in fact, with literally no budget items every actual transaction is "outside the plan", which is correct and worth showing, not hiding). Instead, show a single non-blocking hint line under the month chips when `!hasBudget`, and let every card render its real (possibly all-zero/all-unmatched) data underneath.

4. **Unmatched card groups by income-then-expense within one card** (matching the spec's explicit instruction), with a subheading per non-empty group rather than always showing both subheadings — avoids printing an empty "รายรับนอกแผน" label with nothing under it on the common case where only one direction has unmatched items.

### What's explicitly out of scope for this plan

- Any change to `/api/v1/budgets/comparison` — already correct (see above).
- Any change to `/budget/plan` or `/budget` (Plans 3-4's territory, already shipped).
- The emoji→icon swap mentioned in the spec's deferred section — not part of this plan, no icons introduced here beyond what `TYPE_CONFIG` already provides.
- Drill-down from an unmatched category row to its transactions — the spec's example is a plain category+total line, nothing more.
- Per-month URL persistence (decision 2 above) — would be a separate, deliberate UX change, not asked for here.

---

## File Structure

- **Modify** `src/app/(app)/budget/track/page.tsx` — full rewrite, stub → real page (month chips, two summary cards, งบประมาณ list, unmatched card).
- **Modify** `src/app/(app)/budget/[year]/[month]/page.tsx` — remove the "เทียบจริง" toolbar button, its Sheet, and the now-dead `showComparison`/`comparison`/`loadingComparison` state + `fetchComparison` function + unused `Comparison` type import. The item-add/edit `Sheet` in the same file stays untouched (different Sheet instance, still in use).
- No new files. No schema/API changes.

---

## Part 2 — Implementation Tasks

### Task 1: Verify the comparison API already covers spec Section 5a

**Files:** none modified — read-only verification.

- [ ] **Step 1: Confirm `actualNet` already accounts for Transfer outflows and unmatched detection already exists**

```bash
grep -n "actualNet\|unmatched" "src/app/api/v1/budgets/comparison/route.ts"
```

Expected: a line computing `actualNet: actualIncome - actualExpense - actualLiability - actualSaving` where `actualLiability`/`actualSaving` already include `actualLiabilityTransferOutflow`/`actualSavingTransferOutflow` (Transfer-derived), plus an `unmatched: { income: unmatchedIncome, expense: unmatchedExpense }` block in the returned JSON. If either is missing, stop — the scope of this plan changes (Section 5a would need real implementation work first); do not proceed with Task 2/3 until that's resolved.

- [ ] **Step 2: Confirm the `Comparison` shared type already matches the API shape**

```bash
grep -n "interface Comparison\|UnmatchedCategoryRow" "src/app/(app)/budget/_shared.tsx"
```

Expected: `export interface Comparison` with a `summary` block (`plannedIncome`, `plannedExpense`, `plannedLiability`, `plannedSaving`, `actualIncome`, `actualExpense`, `actualLiability`, `actualSaving`, `plannedNet`, `actualNet`), an `items: ComparisonItem[]`, and `unmatched: { income: UnmatchedCategoryRow[]; expense: UnmatchedCategoryRow[] }`. This type already exists — Task 2 imports it as-is, no edits to `_shared.tsx` in this plan.

---

### Task 2: Build the real `/budget/track` page

**Files:**
- Modify: `src/app/(app)/budget/track/page.tsx` (full replacement)

- [ ] **Step 1: Replace the file**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { type Comparison, TYPE_CONFIG, BudgetTopNav, SHORT_MONTHS, Skeleton } from "../_shared";

// ─── Plan vs actual summary card (top, one per side) ───────────────────────────

function MonthSummaryCard({
  title, income, expense, net,
}: { title: string; income: number; expense: number; net: number }) {
  return (
    <div className="ios-card px-4 py-3 space-y-2.5">
      <p className="text-[13px] font-semibold text-muted-foreground">{title}</p>
      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <span className="text-[12px] text-muted-foreground">รายรับ</span>
          <span className="text-[14px] font-bold tabular-nums text-[#34C759]">{formatCurrency(income)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-[12px] text-muted-foreground">รายจ่าย</span>
          <span className="text-[14px] font-bold tabular-nums text-[#FF3B30]">{formatCurrency(expense)}</span>
        </div>
        <div className="flex justify-between items-baseline pt-1.5 border-t border-border/60">
          <span className="text-[12px] font-medium">คงเหลือ</span>
          <span className={cn("text-[15px] font-bold tabular-nums", net >= 0 ? "text-primary" : "text-destructive")}>
            {formatCurrency(net)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── งบประมาณ card — per-item plan-vs-actual list (carried over from the old
// "เทียบจริง" Sheet on the month-detail page, which this page now replaces) ────

function BudgetItemsCard({ items }: { items: Comparison["items"] }) {
  if (items.length === 0) {
    return (
      <div className="ios-card px-4 py-8 text-center">
        <p className="text-[13px] text-muted-foreground">ยังไม่มีรายการงบเดือนนี้</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-medium text-muted-foreground px-1">งบประมาณ</p>
      <div className="ios-card overflow-hidden divide-y divide-border">
        {items.map(item => (
          <div key={item.id} className={cn("px-4 py-3", item.isOver && "bg-destructive/5")}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-base shrink-0">{TYPE_CONFIG[item.type].emoji}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium truncate">{item.name}</p>
                  {item.category && (
                    <p className="text-[11px] text-muted-foreground">{item.category.icon} {item.category.name}</p>
                  )}
                </div>
                {item.isOver && <span className="text-[11px] text-destructive font-bold shrink-0">เกิน!</span>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[12px] text-muted-foreground">
                  {formatCurrency(item.actual)} / {formatCurrency(item.planned)}
                </p>
                {item.pct !== null && (
                  <p className={cn("text-[12px] font-semibold", item.isOver ? "text-destructive" : "text-[#34C759]")}>
                    {item.pct}%
                  </p>
                )}
              </div>
            </div>
            {item.planned > 0 && (
              <div className="w-full bg-border/50 rounded-full h-1.5 mt-2">
                <div className={cn("h-1.5 rounded-full transition-all",
                  item.isOver ? "bg-destructive" :
                  item.type === "INCOME" ? "bg-[#34C759]" :
                  item.type === "LIABILITY" ? "bg-[#FF9500]" :
                  item.type === "SAVING" ? "bg-[#007AFF]" : "bg-[#FF3B30]"
                )} style={{ width: `${Math.min(item.pct ?? 0, 100)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── รายรับรายจ่ายนอกแผน card — new, lists actual transactions whose category
// has no matching budget item this month (income group first, then expense) ──

function UnmatchedRow({ row, color, sign }: { row: Comparison["unmatched"]["income"][number]; color: string; sign: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5">
      <span className="text-[13px] truncate">{row.categoryIcon} {row.categoryName}</span>
      <span className={cn("text-[13px] font-semibold tabular-nums shrink-0", color)}>{sign}{formatCurrency(row.total)}</span>
    </div>
  );
}

function UnmatchedCard({ unmatched }: { unmatched: Comparison["unmatched"] }) {
  const isEmpty = unmatched.income.length === 0 && unmatched.expense.length === 0;
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-medium text-muted-foreground px-1">รายรับรายจ่ายนอกแผน</p>
      <div className="ios-card overflow-hidden">
        {isEmpty ? (
          <p className="text-[13px] text-muted-foreground text-center py-8">ไม่มีรายการนอกแผน</p>
        ) : (
          <div className="divide-y divide-border">
            {unmatched.income.length > 0 && (
              <div className="py-1">
                <p className="text-[11px] text-muted-foreground px-4 pt-1.5 pb-0.5">รายรับนอกแผน</p>
                {unmatched.income.map((row, i) => <UnmatchedRow key={i} row={row} color="text-[#34C759]" sign="+" />)}
              </div>
            )}
            {unmatched.expense.length > 0 && (
              <div className="py-1">
                <p className="text-[11px] text-muted-foreground px-4 pt-1.5 pb-0.5">รายจ่ายนอกแผน</p>
                {unmatched.expense.map((row, i) => <UnmatchedRow key={i} row={row} color="text-[#FF3B30]" sign="-" />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BudgetTrackPage() {
  const now = new Date();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(() => {
    const fromUrl = parseInt(searchParams.get("year") ?? "");
    return Number.isFinite(fromUrl) && fromUrl > 1900 && fromUrl < 3000 ? fromUrl : now.getFullYear();
  });
  const [month, setMonth] = useState(() =>
    year === now.getFullYear() ? now.getMonth() + 1 : 1
  );
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchComparison = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/budgets/comparison?year=${year}&month=${month}`);
      const d = await res.json();
      if (d.success) setComparison(d.data);
    } finally { setLoading(false); }
  }, [year, month]);
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

      {/* Month-chip picker — replaces the old per-month "เทียบจริง" button;
          this page IS that feature now, always visible. */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {SHORT_MONTHS.map((label, i) => {
          const m = i + 1;
          const isSelected = m === month;
          const isCurrent = m === now.getMonth() + 1 && year === now.getFullYear();
          return (
            <button key={m} onClick={() => setMonth(m)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all",
                isSelected ? "bg-primary text-white shadow-sm" : "bg-muted text-muted-foreground",
                !isSelected && isCurrent && "ring-1 ring-primary/40"
              )}>
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
        </>
      ) : !comparison ? null : (
        <>
          {!comparison.hasBudget && (
            <p className="text-[12px] text-muted-foreground text-center -mt-1">ยังไม่ได้ตั้งงบเดือนนี้</p>
          )}

          {/* Two side-by-side cards: แผน | ยอดใช้จริง */}
          <div className="grid grid-cols-2 gap-3">
            <MonthSummaryCard title="แผน"
              income={comparison.summary.plannedIncome}
              expense={comparison.summary.plannedExpense + comparison.summary.plannedLiability + comparison.summary.plannedSaving}
              net={comparison.summary.plannedNet} />
            <MonthSummaryCard title="ยอดใช้จริง"
              income={comparison.summary.actualIncome}
              expense={comparison.summary.actualExpense + comparison.summary.actualLiability + comparison.summary.actualSaving}
              net={comparison.summary.actualNet} />
          </div>

          <BudgetItemsCard items={comparison.items} />
          <UnmatchedCard unmatched={comparison.unmatched} />
        </>
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
git add "src/app/(app)/budget/track/page.tsx"
git commit -m "feat(budgets): build real /budget/track page (plan vs actual, unmatched categories)"
```

---

### Task 3: Retire the old "เทียบจริง" Sheet on the month-detail page

**Files:**
- Modify: `src/app/(app)/budget/[year]/[month]/page.tsx`

- [ ] **Step 1: Remove the now-unused `Comparison` type import**

In the import block near the top of the file:

```typescript
import {
  type ItemType, type Category, type Debt, type BudgetItem, type Comparison, type DebtCreationInput,
  TYPE_CONFIG, SHORT_MONTHS, Skeleton, debtMonthsForYear, ItemForm,
} from "../../_shared";
```

Change to:

```typescript
import {
  type ItemType, type Category, type Debt, type BudgetItem, type DebtCreationInput,
  TYPE_CONFIG, SHORT_MONTHS, Skeleton, debtMonthsForYear, ItemForm,
} from "../../_shared";
```

- [ ] **Step 2: Remove the comparison-sheet state**

Find:

```typescript
  // Comparison sheet
  const [showComparison, setShowComparison] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
```

Delete this block entirely (including the `// Comparison sheet` comment).

- [ ] **Step 3: Remove the `fetchComparison` function**

Find:

```typescript
  async function fetchComparison() {
    setShowComparison(true);
    setLoadingComparison(true);
    try {
      const res = await fetch(`/api/v1/budgets/comparison?year=${year}&month=${month}`);
      const d = await res.json();
      if (d.success) setComparison(d.data);
    } finally { setLoadingComparison(false); }
  }
```

Delete this function entirely.

- [ ] **Step 4: Shrink the action toolbar from 3 buttons to 2**

Find:

```typescript
      {/* Action toolbar */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setShowCopyDialog(true)}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors">
          <Copy className="h-4 w-4" /> คัดลอก
        </button>
        <button onClick={fetchComparison}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors">
          <span className="text-base leading-none">📊</span> เทียบจริง
        </button>
        <button onClick={openDebtImport}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-[#FF9500] transition-colors">
          <CreditCard className="h-4 w-4" /> นำเข้าหนี้
        </button>
      </div>
```

Replace with:

```typescript
      {/* Action toolbar */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setShowCopyDialog(true)}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors">
          <Copy className="h-4 w-4" /> คัดลอก
        </button>
        <button onClick={openDebtImport}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-[#FF9500] transition-colors">
          <CreditCard className="h-4 w-4" /> นำเข้าหนี้
        </button>
      </div>
```

- [ ] **Step 5: Delete the comparison Sheet block**

Find the entire block (it appears right after the debt-import `Dialog`'s closing tag, right before the `{saving && (...)}` toast block):

```typescript
      {/* Budget vs Actual sheet */}
      <Sheet open={showComparison} onOpenChange={setShowComparison}>
        <SheetContent title={`เปรียบเทียบงบ vs จริง — ${getMonthName(month)} ${year + 543}`}>
          {loadingComparison ? (
            <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14" />)}</div>
          ) : !comparison ? null : !comparison.hasBudget ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-[15px] font-medium">ยังไม่ได้ตั้งงบเดือนนี้</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "วางแผนรายรับ",  value: comparison.summary.plannedIncome,  color: "text-[#34C759]" },
                  { label: "รายรับจริง",      value: comparison.summary.actualIncome,   color: "text-[#34C759]" },
                  { label: "วางแผนรายจ่าย", value: comparison.summary.plannedExpense, color: "text-[#FF3B30]" },
                  { label: "รายจ่ายจริง",    value: comparison.summary.actualExpense,  color: "text-[#FF3B30]" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="ios-card px-3 py-3">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className={cn("text-[16px] font-bold tabular-nums mt-0.5", color)}>{formatCurrency(value)}</p>
                  </div>
                ))}
              </div>

              <div className="ios-card px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-[12px] text-muted-foreground">คงเหลือวางแผน</p>
                  <p className={cn("text-[17px] font-bold tabular-nums",
                    comparison.summary.plannedNet >= 0 ? "text-primary" : "text-destructive")}>
                    {formatCurrency(comparison.summary.plannedNet)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-muted-foreground">คงเหลือจริง</p>
                  <p className={cn("text-[17px] font-bold tabular-nums",
                    comparison.summary.actualNet >= 0 ? "text-primary" : "text-destructive")}>
                    {formatCurrency(comparison.summary.actualNet)}
                  </p>
                </div>
              </div>

              {comparison.items.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[13px] font-medium text-muted-foreground px-1">รายละเอียดแต่ละรายการ</p>
                  <div className="ios-card overflow-hidden divide-y divide-border">
                    {comparison.items.map(item => (
                      <div key={item.id} className={cn("px-4 py-3", item.isOver && "bg-destructive/5")}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-base shrink-0">{TYPE_CONFIG[item.type].emoji}</span>
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium truncate">{item.name}</p>
                              {item.category && (
                                <p className="text-[11px] text-muted-foreground">{item.category.icon} {item.category.name}</p>
                              )}
                            </div>
                            {item.isOver && <span className="text-[11px] text-destructive font-bold shrink-0">เกิน!</span>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[12px] text-muted-foreground">
                              {formatCurrency(item.actual)} / {formatCurrency(item.planned)}
                            </p>
                            {item.pct !== null && (
                              <p className={cn("text-[12px] font-semibold", item.isOver ? "text-destructive" : "text-[#34C759]")}>
                                {item.pct}%
                              </p>
                            )}
                          </div>
                        </div>
                        {item.planned > 0 && (
                          <div className="w-full bg-border/50 rounded-full h-1.5 mt-2">
                            <div className={cn("h-1.5 rounded-full transition-all",
                              item.isOver ? "bg-destructive" :
                              item.type === "INCOME" ? "bg-[#34C759]" :
                              item.type === "LIABILITY" ? "bg-[#FF9500]" :
                              item.type === "SAVING" ? "bg-[#007AFF]" : "bg-[#FF3B30]"
                            )} style={{ width: `${Math.min(item.pct ?? 0, 100)}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
```

Delete this entire block. The file should go directly from the debt-import `Dialog`'s closing `</Dialog>` to the `{saving && (...)}` toast block.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If TypeScript flags `getMonthName` or `Sheet`/`SheetContent` as unused, that means they're used elsewhere in the file already — check with `grep -n "getMonthName\|<Sheet\b\|SheetContent" "src/app/(app)/budget/[year]/[month]/page.tsx"` before removing any import; the header month label and the item-add/edit Sheet both still use them.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/budget/[year]/[month]/page.tsx"
git commit -m "refactor(budgets): remove old เทียบจริง sheet, superseded by /budget/track"
```

---

### Task 4: Playwright e2e verification

**Files:**
- Create (temporary, deleted at the end): `tmp-e2e-budget-plan5.mjs` (project root)

Same established pattern as Plans 1-4: manual Playwright script against a local dev server.

- [ ] **Step 1: Start the dev server**

Run (background): `NEXTAUTH_URL=http://localhost:3001 npm run dev -- -p 3001`

Wait for "Ready" before continuing.

- [ ] **Step 2: Write the verification script**

```javascript
import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = `plan5check-${Date.now()}@test.local`;
const PASSWORD = "TestPass123!";
let passCount = 0, failCount = 0;

function check(label, cond) {
  if (cond) { console.log(`PASS: ${label}`); passCount++; }
  else { console.log(`FAIL: ${label}`); failCount++; }
}

const registerRes = await fetch(`${BASE}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Plan5 Check" }),
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
const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;
const EMPTY_MONTH = MONTH === 1 ? 2 : 1;

async function apiCall(path, init = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader, ...(init.headers ?? {}) },
  });
}

// Fetch default-seeded categories to get real IDs
const catRes = await apiCall("/api/v1/categories");
const cats = (await catRes.json()).data;
const findCat = (name) => cats.find(c => c.name === name);
const salaryCat = findCat("เงินเดือน");           // INCOME, will be budgeted
const otherIncomeCat = findCat("ขายของ");          // INCOME, left unbudgeted -> unmatched income
const foodCat = findCat("อาหารและเครื่องดื่ม");     // EXPENSE, will be budgeted (and overspent)
const healthCat = findCat("สุขภาพ/การแพทย์");       // EXPENSE, left unbudgeted -> unmatched expense
check("found all 4 fixture categories", !!salaryCat && !!otherIncomeCat && !!foodCat && !!healthCat);

// Seed budget: 30000 income (เงินเดือน), 5000 expense (อาหารและเครื่องดื่ม) for MONTH
const budgetRes = await apiCall(`/api/v1/budgets/${YEAR}/${MONTH}`, {
  method: "PUT",
  body: JSON.stringify({ items: [
    { name: "เงินเดือน", type: "INCOME", amount: 30000, categoryId: salaryCat.id, sortOrder: 0 },
    { name: "อาหารและเครื่องดื่ม", type: "EXPENSE", amount: 5000, categoryId: foodCat.id, sortOrder: 1 },
  ] }),
});
check("seed budget items", budgetRes.ok);

// Seed actual transactions for MONTH:
// - 30000 income matching the budgeted category (exact match)
// - 1500 income in an unbudgeted category -> unmatched income
// - 6000 expense matching the budgeted category but OVER the 5000 plan -> isOver
// - 800 expense in an unbudgeted category -> unmatched expense
const dateStr = `${YEAR}-${String(MONTH).padStart(2, "0")}-15`;
const txns = [
  { type: "INCOME", amount: 30000, categoryId: salaryCat.id, date: dateStr, description: "เงินเดือน" },
  { type: "INCOME", amount: 1500, categoryId: otherIncomeCat.id, date: dateStr, description: "ขายของเก่า" },
  { type: "EXPENSE", amount: 6000, categoryId: foodCat.id, date: dateStr, description: "ค่าอาหาร" },
  { type: "EXPENSE", amount: 800, categoryId: healthCat.id, date: dateStr, description: "หาหมอ" },
];
for (const txn of txns) {
  const res = await apiCall("/api/v1/transactions", { method: "POST", body: JSON.stringify(txn) });
  check(`seed transaction: ${txn.description}`, res.ok);
}

// --- /budget/track ---
await page.goto(`${BASE}/budget/track?year=${YEAR}`);
await page.waitForSelector("text=งบประมาณ", { timeout: 5000 });

// Summary cards: planned net = 30000-5000=25000, actual net = 31500-6800=24700
check("แผน card shows planned net 25,000.00", await page.locator("text=25,000.00").count() > 0);
check("ยอดใช้จริง card shows actual net 24,700.00", await page.locator("text=24,700.00").count() > 0);

// งบประมาณ list: over-budget item flagged
check("งบประมาณ list shows อาหารและเครื่องดื่ม", await page.locator("text=อาหารและเครื่องดื่ม").count() > 0);
check("over-budget item shows เกิน! badge", await page.locator("text=เกิน!").count() > 0);

// Unmatched card: both directions present with correct categories+amounts
check("unmatched card title present", await page.locator("text=รายรับรายจ่ายนอกแผน").count() > 0);
check("unmatched income shows ขายของ (1,500.00)", await page.locator("text=ขายของ").count() > 0 && await page.locator("text=+1,500.00").count() > 0);
check("unmatched expense shows สุขภาพ/การแพทย์ (800.00)", await page.locator("text=สุขภาพ/การแพทย์").count() > 0 && await page.locator("text=-800.00").count() > 0);

// Switch to an empty month via the chip picker -> no-budget hint + zeroed cards
await page.locator(`button:text-is("${["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][EMPTY_MONTH - 1]}")`).click();
await page.waitForSelector("text=ยังไม่ได้ตั้งงบเดือนนี้", { timeout: 5000 });
check("empty month shows no-budget hint", await page.locator("text=ยังไม่ได้ตั้งงบเดือนนี้").count() > 0);
check("empty month unmatched card shows empty state", await page.locator("text=ไม่มีรายการนอกแผน").count() > 0);

// Switch back to MONTH -> data reappears (chip state, not just initial load)
await page.locator(`button:text-is("${["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][MONTH - 1]}")`).click();
await page.waitForSelector("text=25,000.00", { timeout: 5000 });
check("switching back to MONTH restores data", await page.locator("text=25,000.00").count() > 0);

// --- Regression: month-detail page no longer has the old เทียบจริง button/sheet ---
await page.goto(`${BASE}/budget/${YEAR}/${MONTH}`);
await page.waitForSelector("text=คัดลอก", { timeout: 5000 });
check("เทียบจริง button removed from month-detail toolbar", await page.locator("text=เทียบจริง").count() === 0);
check("คัดลอก button still present", await page.locator("text=คัดลอก").count() > 0);
check("นำเข้าหนี้ button still present", await page.locator("text=นำเข้าหนี้").count() > 0);

await browser.close();

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
```

- [ ] **Step 3: Run it**

```bash
node tmp-e2e-budget-plan5.mjs
```

Expected: all `PASS:` lines, `0 failed`, exit code 0.

- [ ] **Step 4: Clean up the fixture user**

```bash
docker exec finance-db psql -U finance -d finance_tracker -c "DELETE FROM users WHERE email LIKE 'plan5check-%@test.local';"
```

- [ ] **Step 5: Stop the dev server and delete the temp script**

```bash
rm -f tmp-e2e-budget-plan5.mjs
```

Stop the background dev server process started in Step 1.

- [ ] **Step 6: Final whole-plan type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

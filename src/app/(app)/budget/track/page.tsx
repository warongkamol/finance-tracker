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

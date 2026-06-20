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

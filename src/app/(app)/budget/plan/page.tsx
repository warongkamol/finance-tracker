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

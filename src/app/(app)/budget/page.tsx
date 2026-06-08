"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { formatCurrency, cn } from "@/lib/utils";
import {
  type ItemType, TYPE_CONFIG, SHORT_MONTHS, Skeleton,
  CHART_TOOLTIP_STYLE, AXIS_TICK, Y_TICK_FORMATTER,
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

type DashboardTab = "overview" | "comparison" | "allocation";

const DASHBOARD_TABS: { key: DashboardTab; label: string }[] = [
  { key: "overview", label: "ภาพรวม" },
  { key: "comparison", label: "แผนเทียบจริง" },
  { key: "allocation", label: "สัดส่วน" },
];

// ─── Year Dashboard ───────────────────────────────────────────────────────────

function PlanVsActualChart({
  data, plannedKey, actualKey, label, color,
}: {
  data: YearlyComparisonMonth[];
  plannedKey: "plannedIncome" | "plannedExpense";
  actualKey: "actualIncome" | "actualExpense";
  label: string;
  color: string;
}) {
  const hasData = data.some(d => d[plannedKey] > 0 || d[actualKey] > 0);

  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground mb-1">{label}</p>
      {!hasData ? (
        <p className="text-center py-6 text-[13px] text-muted-foreground">ยังไม่มีข้อมูล</p>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="monthName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={Y_TICK_FORMATTER} />
            <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v) => (v === plannedKey ? "แผน" : "จริง")} />
            <Bar dataKey={plannedKey} fill={`${color}55`} radius={[3, 3, 0, 0]} maxBarSize={12} />
            <Bar dataKey={actualKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function BudgetDashboardSection({
  overview, comparison, loading, year,
}: {
  overview: MonthOverview[];
  comparison: YearlyComparisonMonth[];
  loading: boolean;
  year: number;
}) {
  const [tab, setTab] = useState<DashboardTab>("overview");

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const hasAnyBudget = overview.some(m => m.hasData);
  if (!hasAnyBudget) return null;

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

  // Where the planned money goes — income isn't part of the "allocation"
  const typeSlices = (
    [
      { key: "EXPENSE" as const, value: totals.expense, color: "#FF3B30" },
      { key: "LIABILITY" as const, value: totals.liability, color: "#FF9500" },
      { key: "SAVING" as const, value: totals.saving, color: "#007AFF" },
    ]
  ).filter(s => s.value > 0);
  const outflowTotal = typeSlices.reduce((s, t) => s + t.value, 0);

  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        ภาพรวมงบทั้งปี {year + 543}
      </p>

      {/* Segmented tab control */}
      <div className="ios-card p-1 grid grid-cols-3 gap-1">
        {DASHBOARD_TABS.map(({ key, label }) => (
          <button key={key}
            onClick={() => setTab(key)}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold transition-all",
              tab === key ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
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
      )}

      {tab === "comparison" && (
        <div className="ios-card px-4 py-4 space-y-4">
          <p className="text-[13px] font-semibold text-muted-foreground">แผนเทียบจริงรายเดือน</p>
          <PlanVsActualChart data={comparison} plannedKey="plannedIncome" actualKey="actualIncome" label="รายรับ" color="#34C759" />
          <PlanVsActualChart data={comparison} plannedKey="plannedExpense" actualKey="actualExpense" label="รายจ่าย" color="#FF3B30" />
        </div>
      )}

      {tab === "allocation" && (
        typeSlices.length === 0 ? (
          <div className="ios-card px-4 py-10 text-center">
            <p className="text-[13px] text-muted-foreground">ยังไม่มีรายจ่าย/หนี้สิน/เงินออมที่วางแผนไว้</p>
          </div>
        ) : (
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
        )
      )}
    </div>
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

      {/* Yearly dashboard */}
      <BudgetDashboardSection
        overview={overview}
        comparison={yearlyComparison}
        loading={loadingOverview || loadingYearlyComparison}
        year={year}
      />

      {/* 12-month grid — tap a month to open its dedicated page */}
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

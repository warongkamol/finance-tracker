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
              onClick={(d) => onMonthClick(d.payload.month)} />
          ))}
          <Bar dataKey="other" stackId="cat" fill={OTHER_COLOR} radius={[3, 3, 0, 0]} maxBarSize={16}
            onClick={(d) => onMonthClick(d.payload.month)} />
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

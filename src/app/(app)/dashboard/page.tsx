"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, ChevronRight as ArrowRight, AlertCircle, Clock } from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { formatCurrency, getMonthName, getCurrentMonth, cn } from "@/lib/utils";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  activeDebts: number;
  totalRemainingDebt: number;
  overdueCount: number;
}

interface CategoryData {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  percentage: number;
}

interface MonthlyData {
  month: number;
  monthName: string;
  income: number;
  expense: number;
}

interface TrendData {
  data: Record<string, number | string>[];
  categories: { name: string; color: string }[];
}

interface UpcomingPayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amount: string;
  status: "PENDING" | "PAID" | "OVERDUE";
  isOverdue: boolean;
  debt: { id: string; name: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#007AFF", "#34C759", "#FF9500", "#FF3B30", "#AF52DE", "#00C7BE", "#FF6B00", "#FF2D55"];

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

// ─── Balance Hero ─────────────────────────────────────────────────────────────

function BalanceHero({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (loading || !summary) {
    return <Skeleton className="h-36" />;
  }

  const isPositive = summary.balance >= 0;

  return (
    <div className="ios-card px-5 py-5 space-y-4">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">คงเหลือสุทธิ</p>
        <p className={cn(
          "text-[36px] font-bold tracking-tight tabular-nums mt-0.5",
          isPositive ? "text-primary" : "text-destructive"
        )}>
          {formatCurrency(summary.balance)}
        </p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 bg-[#F2F2F7] dark:bg-muted rounded-xl px-3 py-2.5">
          <p className="text-[11px] font-medium text-[#34C759] uppercase tracking-wide mb-0.5">รายรับ</p>
          <p className="text-[15px] font-semibold tabular-nums text-foreground">
            {formatCurrency(summary.totalIncome)}
          </p>
        </div>
        <div className="flex-1 bg-[#F2F2F7] dark:bg-muted rounded-xl px-3 py-2.5">
          <p className="text-[11px] font-medium text-[#FF3B30] uppercase tracking-wide mb-0.5">รายจ่าย</p>
          <p className="text-[15px] font-semibold tabular-nums text-foreground">
            {formatCurrency(summary.totalExpense)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Debt Banner ──────────────────────────────────────────────────────────────

function DebtBanner({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (loading || !summary || summary.activeDebts === 0) return null;

  return (
    <Link href="/debts">
      <div className="ios-card px-4 py-3.5 flex items-center justify-between active:opacity-70 transition-opacity">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-[#FF9500]/12 flex items-center justify-center shrink-0">
            <span className="text-base">💳</span>
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">
              หนี้สินคงค้าง · {summary.activeDebts} รายการ
            </p>
            <p className="text-[16px] font-bold text-[#FF9500] tabular-nums">
              {formatCurrency(summary.totalRemainingDebt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {summary.overdueCount > 0 && (
            <span className="text-[11px] font-semibold text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
              เลยกำหนด {summary.overdueCount}
            </span>
          )}
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}

// ─── Upcoming Payments ────────────────────────────────────────────────────────

function UpcomingSection({ payments, loading }: { payments: UpcomingPayment[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-20" />;

  const pending = payments.filter((p) => p.status !== "PAID");
  if (pending.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">
          รายการผ่อนเดือนนี้
        </p>
        <Link href="/debts" className="text-[13px] text-primary font-medium">ดูทั้งหมด</Link>
      </div>

      <div className="ios-card overflow-hidden divide-y divide-border/50">
        {pending.slice(0, 3).map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3">
            {p.isOverdue ? (
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            ) : (
              <Clock className="h-4 w-4 text-[#FF9500] shrink-0" />
            )}
            <p className="text-[14px] flex-1 truncate">{p.debt.name} งวดที่ {p.installmentNo}</p>
            <p className={cn("text-[14px] font-semibold tabular-nums shrink-0", p.isOverdue ? "text-destructive" : "text-foreground")}>
              {formatCurrency(Number(p.amount))}
            </p>
          </div>
        ))}
        {pending.length > 3 && (
          <div className="px-4 py-2.5">
            <p className="text-[13px] text-muted-foreground text-center">+{pending.length - 3} รายการอื่น</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Category Breakdown ───────────────────────────────────────────────────────

function CategorySection({ data, loading }: { data: CategoryData[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        รายจ่ายตามหมวดหมู่
      </p>

      {data.length === 0 ? (
        <div className="ios-card px-4 py-8 text-center">
          <p className="text-[15px] text-muted-foreground">ยังไม่มีรายจ่ายในเดือนนี้</p>
        </div>
      ) : (
        <div className="ios-card overflow-hidden">
          {/* Pie chart */}
          <div className="px-4 pt-3">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={data.map((d, i) => ({ ...d, fill: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }))}
                  dataKey="total"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), ""]}
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* List */}
          <div className="divide-y divide-border/50">
            {data.map((item, i) => (
              <div key={item.categoryId} className="flex items-center gap-3 px-4 py-3">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[15px] shrink-0"
                  style={{ backgroundColor: `${item.color ?? CHART_COLORS[i % CHART_COLORS.length]}18` }}
                >
                  {item.icon ?? "📌"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate">{item.name}</p>
                  <div className="mt-1 h-1 bg-border/60 rounded-full overflow-hidden">
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{
                        width: `${item.percentage}%`,
                        backgroundColor: item.color ?? CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(item.total)}</p>
                  <p className="text-[11px] text-muted-foreground">{item.percentage}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Monthly Chart ────────────────────────────────────────────────────────────

function MonthlyChart({ data, loading }: { data: MonthlyData[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-64" />;

  const hasData = data.some((d) => d.income > 0 || d.expense > 0);

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        รายรับ-รายจ่ายรายเดือน
      </p>
      <div className="ios-card px-4 py-4">
        {!hasData ? (
          <p className="text-center py-8 text-[15px] text-muted-foreground">ยังไม่มีข้อมูลในปีนี้</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="monthName" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "income" ? "รายรับ" : "รายจ่าย"} />
              <Bar dataKey="income" fill="#34C759" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="expense" fill="#FF3B30" radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Category Trend ───────────────────────────────────────────────────────────

function TrendChart({ trend, loading }: { trend: TrendData | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-64" />;
  if (!trend || trend.categories.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">แนวโน้มรายจ่าย</p>
        <div className="ios-card px-4 py-8 text-center">
          <p className="text-[15px] text-muted-foreground">ยังไม่มีข้อมูล</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        แนวโน้มรายจ่าย (6 เดือน)
      </p>
      <div className="ios-card px-4 py-4">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trend.data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {trend.categories.map((cat) => (
              <Line key={cat.name} type="monotone" dataKey={cat.name} stroke={cat.color} strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = "month" | "year";

export default function DashboardPage() {
  const { data: session } = useSession();
  const now = getCurrentMonth();

  const [mode, setMode] = useState<ViewMode>("month");
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingPayment[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [trendData, setTrendData] = useState<TrendData | null>(null);

  const [loadingMonth, setLoadingMonth] = useState(true);
  const [loadingYear, setLoadingYear] = useState(true);

  const fetchMonthData = useCallback(async () => {
    setLoadingMonth(true);
    try {
      const [sumRes, catRes, upRes] = await Promise.all([
        fetch(`/api/v1/dashboard/summary?year=${year}&month=${month}`),
        fetch(`/api/v1/dashboard/by-category?year=${year}&month=${month}&type=EXPENSE`),
        fetch(`/api/v1/debts/upcoming?year=${year}&month=${month}`),
      ]);
      const [sumData, catData, upData] = await Promise.all([sumRes.json(), catRes.json(), upRes.json()]);
      if (sumData.success) setSummary(sumData.data);
      if (catData.success) setCategoryData(catData.data);
      if (upData.success) setUpcoming(upData.data);
    } finally {
      setLoadingMonth(false);
    }
  }, [year, month]);

  const fetchYearData = useCallback(async () => {
    setLoadingYear(true);
    try {
      const [monthlyRes, trendRes] = await Promise.all([
        fetch(`/api/v1/dashboard/monthly-comparison?year=${year}`),
        fetch(`/api/v1/dashboard/category-trend?months=6`),
      ]);
      const [monthlyJson, trendJson] = await Promise.all([monthlyRes.json(), trendRes.json()]);
      if (monthlyJson.success) setMonthlyData(monthlyJson.data);
      if (trendJson.success) setTrendData(trendJson.data);
    } finally {
      setLoadingYear(false);
    }
  }, [year]);

  useEffect(() => { fetchMonthData(); }, [fetchMonthData]);
  useEffect(() => { if (mode === "year") fetchYearData(); }, [mode, fetchYearData]);

  function prevPeriod() {
    if (mode === "month") {
      if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1);
    } else {
      setYear((y) => y - 1);
    }
  }

  function nextPeriod() {
    if (mode === "month") {
      if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1);
    } else {
      setYear((y) => y + 1);
    }
  }

  const periodLabel = mode === "month" ? `${getMonthName(month)} ${year}` : `ปี ${year}`;

  return (
    <div className="py-5 space-y-5">
      {/* Greeting */}
      <div className="px-1">
        <p className="text-[13px] text-muted-foreground">สวัสดี</p>
        <h1 className="text-[22px] font-bold tracking-tight">{session?.user?.name ?? "..."}</h1>
      </div>

      {/* Mode toggle */}
      <div className="ios-card p-1 grid grid-cols-2 gap-1">
        {(["month", "year"] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "py-2 rounded-xl text-[14px] font-semibold transition-all",
              mode === m ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}
          >
            {m === "month" ? "รายเดือน" : "รายปี"}
          </button>
        ))}
      </div>

      {/* Period navigator */}
      <div className="flex items-center justify-between px-1">
        <button onClick={prevPeriod} className="h-8 w-8 rounded-full hover:bg-card flex items-center justify-center transition-colors active:scale-90">
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <span className="text-[16px] font-semibold">{periodLabel}</span>
        <button onClick={nextPeriod} className="h-8 w-8 rounded-full hover:bg-card flex items-center justify-center transition-colors active:scale-90">
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* Month view */}
      {mode === "month" && (
        <>
          <BalanceHero summary={summary} loading={loadingMonth} />
          <DebtBanner summary={summary} loading={loadingMonth} />
          <UpcomingSection payments={upcoming} loading={loadingMonth} />
          <CategorySection data={categoryData} loading={loadingMonth} />
        </>
      )}

      {/* Year view */}
      {mode === "year" && (
        <>
          <MonthlyChart data={monthlyData} loading={loadingYear} />
          <TrendChart trend={trendData} loading={loadingYear} />
        </>
      )}
    </div>
  );
}

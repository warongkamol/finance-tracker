"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, ChevronRight as ArrowRight, ChevronDown, AlertCircle, Clock, Download, Image as ImageIcon, FileText, Loader2 } from "lucide-react";
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
import { buildFilename, captureAsImage, captureAsPDF } from "@/lib/export";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FamilyFilterType = "all" | "mine" | "family";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  activeDebts: number;
  totalRemainingDebt: number;
  overdueCount: number;
  personalDebts: { count: number; totalRemaining: number };
  familyDebts: { count: number; totalRemaining: number };
  mineGroups?: {
    personal: { income: number; expense: number; balance: number };
    family: { income: number; expense: number; balance: number };
  };
}

interface CategoryChildData {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  percentage: number; // relative to the parent category's total
}

interface CategoryData extends CategoryChildData {
  // percentage here is relative to the grand total
  children: CategoryChildData[];
}

interface CategorySplit {
  personal: CategoryData[];
  family: CategoryData[];
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

interface MemberSummary {
  userId: string;
  name: string;
  isMe: boolean;
  income: number;
  expense: number;
  balance: number;
}

interface FamilySummary {
  members: MemberSummary[];
  totals: { income: number; expense: number; balance: number };
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

function BalanceHero({
  summary,
  loading,
  walletSummary,
  walletLoading,
}: {
  summary: Summary | null;
  loading: boolean;
  walletSummary: { liquidTotal: number; creditOutstanding: number; hasCreditCards: boolean } | null;
  walletLoading: boolean;
}) {
  if (loading || !summary || walletLoading || !walletSummary) {
    return <Skeleton className="h-36" />;
  }

  const isPositive = walletSummary.liquidTotal >= 0;

  return (
    <div className="ios-card px-5 py-5 space-y-4">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">คงเหลือสุทธิ</p>
        <p className={cn(
          "text-[36px] font-bold tracking-tight tabular-nums mt-0.5",
          isPositive ? "text-primary" : "text-destructive"
        )}>
          {formatCurrency(walletSummary.liquidTotal)}
        </p>
        {walletSummary.hasCreditCards && (
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[12px] text-muted-foreground">ยอดบัตรเครดิต/สินเชื่อค้างจ่าย</span>
            <span className="text-[14px] font-semibold tabular-nums text-destructive">
              {formatCurrency(walletSummary.creditOutstanding)}
            </span>
          </div>
        )}
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

// ─── Mine: Personal vs Family Breakdown ──────────────────────────────────────

function MineGroupSection({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-32" />;
  if (!summary?.mineGroups) return null;

  const groups = [
    { key: "personal", label: "ส่วนตัว", emoji: "👤", data: summary.mineGroups.personal },
    { key: "family", label: "ครอบครัว", emoji: "👨‍👩‍👧", data: summary.mineGroups.family },
  ] as const;

  // Hide a group with no activity (e.g. user has no family group / nothing tagged that way)
  const visible = groups.filter((g) => g.data.income > 0 || g.data.expense > 0);
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        แยกตามกลุ่ม
      </p>
      <div className="ios-card overflow-hidden divide-y divide-border">
        {visible.map((g) => {
          const balPos = g.data.balance >= 0;
          return (
            <div key={g.key} className="px-4 py-3.5">
              <div className="flex items-center gap-3 mb-2.5">
                <div className="h-8 w-8 rounded-full bg-[#AF52DE]/10 flex items-center justify-center shrink-0 text-[14px]">
                  {g.emoji}
                </div>
                <span className="text-[14px] font-semibold flex-1">{g.label}</span>
                <p className={cn("text-[14px] font-bold tabular-nums", balPos ? "text-[#34C759]" : "text-[#FF3B30]")}>
                  {balPos ? "+" : ""}{formatCurrency(g.data.balance)}
                </p>
              </div>
              <div className={cn("grid gap-2", g.data.income > 0 && g.data.expense > 0 ? "grid-cols-2" : "grid-cols-1")}>
                {g.data.income > 0 && (
                  <div className="rounded-lg bg-[#34C759]/8 px-3 py-1.5">
                    <p className="text-[10px] text-[#34C759] font-medium">รายรับ</p>
                    <p className="text-[13px] font-semibold text-[#34C759] tabular-nums">{formatCurrency(g.data.income)}</p>
                  </div>
                )}
                {g.data.expense > 0 && (
                  <div className="rounded-lg bg-[#FF3B30]/8 px-3 py-1.5">
                    <p className="text-[10px] text-[#FF3B30] font-medium">รายจ่าย</p>
                    <p className="text-[13px] font-semibold text-[#FF3B30] tabular-nums">{formatCurrency(g.data.expense)}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Debt Banner ──────────────────────────────────────────────────────────────

function FamilyDebtRow({ summary }: { summary: Summary }) {
  return (
    <Link href="/debts">
      <div className="px-4 py-3.5 flex items-center justify-between active:opacity-70 transition-opacity">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-[#AF52DE]/12 flex items-center justify-center shrink-0">
            <span className="text-base">👨‍👩‍👧</span>
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">
              หนี้สินครอบครัว · {summary.familyDebts.count} รายการ
            </p>
            <p className="text-[16px] font-bold text-[#AF52DE] tabular-nums">
              {formatCurrency(summary.familyDebts.totalRemaining)}
            </p>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

function DebtBanner({ summary, loading, familyFilter }: { summary: Summary | null; loading: boolean; familyFilter: FamilyFilterType }) {
  if (loading || !summary) return null;

  const hasPersonal = summary.personalDebts?.count > 0;
  const hasFamily = summary.familyDebts?.count > 0;

  // Family tab — only family debts matter here; hide the section entirely if there are none
  if (familyFilter === "family") {
    if (!hasFamily) return null;
    return (
      <div className="ios-card overflow-hidden">
        <FamilyDebtRow summary={summary} />
        {summary.overdueCount > 0 && (
          <div className="px-4 py-2 bg-destructive/5 text-center border-t border-border/50">
            <span className="text-[12px] font-semibold text-destructive">⚠️ เลยกำหนด {summary.overdueCount} รายการ</span>
          </div>
        )}
      </div>
    );
  }

  if (summary.activeDebts === 0) return null;

  // No family debts — single row
  if (!hasFamily) {
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

  // Split view: personal + family rows
  return (
    <div className="ios-card overflow-hidden">
      {hasPersonal && (
        <Link href="/debts">
          <div className="px-4 py-3.5 flex items-center justify-between active:opacity-70 transition-opacity border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-[#FF9500]/12 flex items-center justify-center shrink-0">
                <span className="text-base">💳</span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-muted-foreground">
                  หนี้สินส่วนตัว · {summary.personalDebts.count} รายการ
                </p>
                <p className="text-[16px] font-bold text-[#FF9500] tabular-nums">
                  {formatCurrency(summary.personalDebts.totalRemaining)}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Link>
      )}
      <FamilyDebtRow summary={summary} />
      {summary.overdueCount > 0 && (
        <div className="px-4 py-2 bg-destructive/5 text-center border-t border-border/50">
          <span className="text-[12px] font-semibold text-destructive">⚠️ เลยกำหนด {summary.overdueCount} รายการ</span>
        </div>
      )}
    </div>
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

      <div className="ios-card overflow-hidden divide-y divide-border">
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

function CategorySection({ title, data, loading }: { title: string; data: CategoryData[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        {title}
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

          {/* List — parent categories, tap to drill into subcategories */}
          <div className="divide-y divide-border">
            {data.map((item, i) => {
              const fill = item.color ?? CHART_COLORS[i % CHART_COLORS.length];
              const hasChildren = item.children.length > 0;
              const expanded = expandedId === item.categoryId;

              return (
                <div key={item.categoryId}>
                  <button
                    type="button"
                    onClick={() => hasChildren && setExpandedId(expanded ? null : item.categoryId)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                      hasChildren && "active:bg-muted/40"
                    )}
                  >
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center text-[15px] shrink-0"
                      style={{ backgroundColor: `${fill}18` }}
                    >
                      {item.icon ?? "📌"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium truncate">{item.name}</p>
                      <div className="mt-1 h-1 bg-border/60 rounded-full overflow-hidden">
                        <div
                          className="h-1 rounded-full transition-all"
                          style={{ width: `${item.percentage}%`, backgroundColor: fill }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(item.total)}</p>
                      <p className="text-[11px] text-muted-foreground">{item.percentage}%</p>
                    </div>
                    {hasChildren && (
                      <ChevronDown
                        className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", expanded && "rotate-180")}
                      />
                    )}
                  </button>

                  {/* Subcategory drill-down */}
                  {expanded && hasChildren && (
                    <div className="bg-muted/30 divide-y divide-border">
                      {item.children.map((child) => (
                        <div key={child.categoryId} className="flex items-center gap-2.5 pl-12 pr-4 py-2.5">
                          <div
                            className="h-6 w-6 rounded-full flex items-center justify-center text-[12px] shrink-0"
                            style={{ backgroundColor: `${child.color ?? fill}18` }}
                          >
                            {child.icon ?? "📌"}
                          </div>
                          <p className="text-[13px] flex-1 truncate text-muted-foreground">{child.name}</p>
                          <p className="text-[13px] font-medium tabular-nums shrink-0">{formatCurrency(child.total)}</p>
                          <p className="text-[11px] text-muted-foreground shrink-0 w-9 text-right">{child.percentage}%</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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

// ─── Family Member Section ────────────────────────────────────────────────────

function FamilyMemberSection({ data, loading }: { data: FamilySummary | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-40" />;
  if (!data || data.members.length === 0) return null;

  const totalExpense = data.totals.expense;

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        สรุปตามสมาชิก
      </p>
      <div className="ios-card overflow-hidden divide-y divide-border">
        {data.members.map((m) => {
          const pct = totalExpense > 0 ? Math.round((m.expense / totalExpense) * 100) : 0;
          const balPos = m.balance >= 0;
          return (
            <div key={m.userId} className="px-4 py-3.5">
              <div className="flex items-center gap-3 mb-2.5">
                <div className="h-8 w-8 rounded-full bg-[#AF52DE]/10 flex items-center justify-center shrink-0 text-[14px]">
                  {m.isMe ? "👤" : "👥"}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-semibold">{m.name}</span>
                  {m.isMe && <span className="ml-1.5 text-[11px] text-muted-foreground">(คุณ)</span>}
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("text-[14px] font-bold tabular-nums", balPos ? "text-[#34C759]" : "text-[#FF3B30]")}>
                    {balPos ? "+" : ""}{formatCurrency(m.balance)}
                  </p>
                </div>
              </div>

              {(m.income > 0 || m.expense > 0) && (
                <div className={cn("grid gap-2 mb-2", m.income > 0 && m.expense > 0 ? "grid-cols-2" : "grid-cols-1")}>
                  {m.income > 0 && (
                    <div className="rounded-lg bg-[#34C759]/8 px-3 py-1.5">
                      <p className="text-[10px] text-[#34C759] font-medium">รายรับ</p>
                      <p className="text-[13px] font-semibold text-[#34C759] tabular-nums">{formatCurrency(m.income)}</p>
                    </div>
                  )}
                  {m.expense > 0 && (
                    <div className="rounded-lg bg-[#FF3B30]/8 px-3 py-1.5">
                      <p className="text-[10px] text-[#FF3B30] font-medium">รายจ่าย {pct > 0 && `· ${pct}%`}</p>
                      <p className="text-[13px] font-semibold text-[#FF3B30] tabular-nums">{formatCurrency(m.expense)}</p>
                    </div>
                  )}
                </div>
              )}

              {totalExpense > 0 && (
                <div className="h-1 bg-border/50 rounded-full overflow-hidden">
                  <div className="h-full bg-[#AF52DE] rounded-full" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
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
  const [familyFilter, setFamilyFilter] = useState<FamilyFilterType>("all");
  const [familyGroups, setFamilyGroups] = useState<{ id: string; name: string; displayName: string }[]>([]);
  const [selectedFamilyGroupId, setSelectedFamilyGroupId] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);
  const [categorySplit, setCategorySplit] = useState<CategorySplit | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingPayment[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [familySummary, setFamilySummary] = useState<FamilySummary | null>(null);
  const [loadingFamily, setLoadingFamily] = useState(false);

  const [walletSummary, setWalletSummary] = useState<{
    liquidTotal: number;
    creditLimit: number;
    creditOutstanding: number;
    hasCreditCards: boolean;
  } | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  const [loadingMonth, setLoadingMonth] = useState(true);
  const [loadingYear, setLoadingYear] = useState(true);

  const fetchMonthData = useCallback(async () => {
    setLoadingMonth(true);
    const groupQs = familyFilter === "family" && selectedFamilyGroupId ? `&familyGroupId=${selectedFamilyGroupId}` : "";
    const ff = familyFilter !== "all" ? `&familyFilter=${familyFilter}${groupQs}` : "";
    try {
      const [sumRes, catRes, upRes] = await Promise.all([
        fetch(`/api/v1/dashboard/summary?year=${year}&month=${month}${ff}`),
        fetch(`/api/v1/dashboard/by-category?year=${year}&month=${month}&type=EXPENSE${ff}`),
        fetch(`/api/v1/debts/upcoming?year=${year}&month=${month}`),
      ]);
      const [sumData, catData, upData] = await Promise.all([sumRes.json(), catRes.json(), upRes.json()]);
      if (sumData.success) setSummary(sumData.data);
      if (catData.success) {
        if (familyFilter === "mine") {
          setCategorySplit(catData.data);
          setCategoryData([]);
        } else {
          setCategoryData(catData.data);
          setCategorySplit(null);
        }
      }
      if (upData.success) setUpcoming(upData.data);
    } finally {
      setLoadingMonth(false);
    }
  }, [year, month, familyFilter, selectedFamilyGroupId]);

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

  useEffect(() => {
    fetch("/api/v1/family")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const groups = d.data.groups as { id: string; name: string; displayName: string }[];
          setFamilyGroups(groups);
          setSelectedFamilyGroupId((prev) => prev ?? groups[0]?.id ?? null);
        }
      });
  }, []);

  useEffect(() => { fetchMonthData(); }, [fetchMonthData]);
  useEffect(() => { if (mode === "year") fetchYearData(); }, [mode, fetchYearData]);

  useEffect(() => {
    fetch("/api/v1/accounts/summary")
      .then((r) => r.json())
      .then((d) => { if (d.success) setWalletSummary(d.data); })
      .catch(() => {})
      .finally(() => setWalletLoading(false));
  }, []);

  useEffect(() => {
    if (familyFilter !== "family" || !selectedFamilyGroupId) { setFamilySummary(null); return; }
    setLoadingFamily(true);
    fetch(`/api/v1/family/summary?year=${year}&month=${month}&groupId=${selectedFamilyGroupId}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setFamilySummary(d.data); })
      .finally(() => setLoadingFamily(false));
  }, [familyFilter, selectedFamilyGroupId, year, month]);

  async function handleExport(format: "image" | "pdf") {
    if (!contentRef.current || isExporting) return;
    setExportMenuOpen(false);
    setIsExporting(true);
    try {
      const filename = buildFilename("dashboard", year, mode === "month" ? month : undefined);
      if (format === "image") await captureAsImage(contentRef.current, filename);
      else await captureAsPDF(contentRef.current, filename);
    } finally {
      setIsExporting(false);
    }
  }

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
      {/* Greeting + Export */}
      <div className="px-1 flex items-start justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground">สวัสดี</p>
          <h1 className="text-[22px] font-bold tracking-tight">{session?.user?.name ?? "..."}</h1>
        </div>

        {/* Export dropdown */}
        <div className="relative">
          <button
            onClick={() => setExportMenuOpen((o) => !o)}
            disabled={isExporting}
            className="h-9 w-9 rounded-full bg-card flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors active:scale-90 disabled:opacity-50 shadow-sm"
            aria-label="Export"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>

          {exportMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
              <div className="absolute right-0 top-11 z-20 ios-card shadow-lg overflow-hidden min-w-[160px]">
                <button
                  onClick={() => handleExport("image")}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-[14px] hover:bg-muted/50 transition-colors text-left"
                >
                  <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                  บันทึกรูปภาพ
                </button>
                <div className="h-px bg-border/50 mx-4" />
                <button
                  onClick={() => handleExport("pdf")}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-[14px] hover:bg-muted/50 transition-colors text-left"
                >
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  บันทึก PDF
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Captured content */}
      <div ref={contentRef} className="space-y-5">
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

        {/* Family filter */}
        <div className="ios-card p-1 grid grid-cols-3 gap-1">
          {([
            { key: "all", label: "ทุกรายการ" },
            { key: "mine", label: "ของฉัน" },
            { key: "family", label: "ครอบครัว" },
          ] as { key: FamilyFilterType; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFamilyFilter(key)}
              className={cn(
                "py-1.5 rounded-xl text-[13px] font-semibold transition-all",
                familyFilter === key ? "bg-[#AF52DE] text-white shadow-sm" : "text-muted-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Group picker — which group's shared DATA to view. Independent of
            the settings-page picker and the entry-form picker (no sync). */}
        {familyFilter === "family" && familyGroups.length > 0 && (
          <Select value={selectedFamilyGroupId ?? undefined} onValueChange={setSelectedFamilyGroupId}>
            <SelectTrigger className="h-10 bg-input border-0 rounded-xl text-[13px]">
              <SelectValue placeholder="เลือกกลุ่ม" />
            </SelectTrigger>
            <SelectContent>
              {familyGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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

        {/* Wallet summary card */}
        {walletLoading ? (
          <div className="ios-card mx-0 px-4 py-3 space-y-2">
            <div className="h-3.5 w-20 bg-muted rounded animate-pulse" />
            <div className="h-3.5 w-32 bg-muted rounded animate-pulse" />
          </div>
        ) : walletSummary ? (
          <div className="ios-card px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-semibold text-foreground">กระเป๋าเงิน</p>
              <Link href="/accounts" className="text-[12px] text-primary">ดูทั้งหมด →</Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">💰 เงินสด</span>
              <span className="text-[13px] font-semibold tabular-nums">
                {formatCurrency(walletSummary.liquidTotal)}
              </span>
            </div>
            {walletSummary.hasCreditCards && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[13px] text-muted-foreground">💳 บัตรเครดิต/สินเชื่อ</span>
                <span className="text-[13px] font-semibold tabular-nums text-[#FF3B30]">
                  {formatCurrency(walletSummary.creditOutstanding)}
                  {walletSummary.creditLimit > 0 && (
                    <> / {formatCurrency(walletSummary.creditLimit)}</>
                  )}
                </span>
              </div>
            )}
          </div>
        ) : null}

        {/* Month view */}
        {mode === "month" && (
          <>
            <BalanceHero
              summary={summary}
              loading={loadingMonth}
              walletSummary={walletSummary}
              walletLoading={walletLoading}
            />
            {familyFilter === "mine" && (
              <MineGroupSection summary={summary} loading={loadingMonth} />
            )}
            <DebtBanner summary={summary} loading={loadingMonth} familyFilter={familyFilter} />
            {familyFilter === "family" && (
              <FamilyMemberSection data={familySummary} loading={loadingFamily} />
            )}
            <UpcomingSection payments={upcoming} loading={loadingMonth} />
            {familyFilter === "mine" ? (
              <>
                <CategorySection title="รายจ่ายตามหมวดหมู่ · ส่วนตัว" data={categorySplit?.personal ?? []} loading={loadingMonth} />
                {!loadingMonth && (categorySplit?.family.length ?? 0) > 0 && (
                  <CategorySection title="รายจ่ายตามหมวดหมู่ · ครอบครัว" data={categorySplit?.family ?? []} loading={false} />
                )}
              </>
            ) : (
              <CategorySection title="รายจ่ายตามหมวดหมู่" data={categoryData} loading={loadingMonth} />
            )}
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
    </div>
  );
}

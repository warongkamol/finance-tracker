"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Copy, Pencil, Trash2, CheckCircle2, CreditCard, Lock } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatCurrency, getMonthName, cn } from "@/lib/utils";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemType = "INCOME" | "EXPENSE" | "LIABILITY" | "SAVING";

interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  type: "INCOME" | "EXPENSE";
  children: Category[];
}

interface DebtPayment {
  id: string;
  amount: string | number;
  status: string;
  dueDate: string;
  installmentNo: number;
}

interface Debt {
  id: string;
  name: string;
  totalAmount: number;
  remainingBalance: number;
  status: string;
  payments: DebtPayment[];
}

// Returns pending payment months for a given year
function debtMonthsForYear(debt: Debt, year: number): { month: number; amount: number }[] {
  return debt.payments
    .filter(p => {
      const d = new Date(p.dueDate);
      return d.getFullYear() === year && p.status !== "PAID";
    })
    .map(p => ({
      month: new Date(p.dueDate).getMonth() + 1,
      amount: Number(p.amount),
    }))
    .sort((a, b) => a.month - b.month);
}

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

interface BudgetItem {
  id?: string;
  name: string;
  type: ItemType;
  amount: number;
  categoryId?: string | null;
  debtId?: string | null;
  notes?: string | null;
  sortOrder: number;
  category?: { id: string; name: string; icon: string | null } | null;
}

interface MonthDetail {
  year: number;
  month: number;
  items: BudgetItem[];
}

interface ComparisonItem {
  id: string;
  name: string;
  type: ItemType;
  planned: number;
  actual: number;
  diff: number;
  pct: number | null;
  isOver: boolean;
  category: { id: string; name: string; icon: string | null } | null;
}

interface Comparison {
  hasBudget: boolean;
  summary: {
    plannedIncome: number; plannedExpense: number; plannedLiability: number; plannedSaving: number;
    actualIncome: number; actualExpense: number;
    plannedNet: number; actualNet: number;
  };
  items: ComparisonItem[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ItemType, { label: string; color: string; bg: string; emoji: string }> = {
  INCOME:    { label: "รายรับ",    color: "text-[#34C759]", bg: "bg-[#34C759]/10", emoji: "💰" },
  EXPENSE:   { label: "รายจ่าย",   color: "text-[#FF3B30]", bg: "bg-[#FF3B30]/10", emoji: "💸" },
  LIABILITY: { label: "หนี้สิน",   color: "text-[#FF9500]", bg: "bg-[#FF9500]/10", emoji: "💳" },
  SAVING:    { label: "ออม/ลงทุน", color: "text-[#007AFF]", bg: "bg-[#007AFF]/10", emoji: "🏦" },
};

const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                      "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-border/50", className)} />;
}

// ─── Year Dashboard ───────────────────────────────────────────────────────────

const CHART_TOOLTIP_STYLE = { fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" };
const AXIS_TICK = { fontSize: 9, fill: "var(--muted-foreground)" } as const;
const Y_TICK_FORMATTER = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

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
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
        <Skeleton className="h-56" />
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
    <div className="space-y-4">
      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
        ภาพรวมงบทั้งปี {year + 543}
      </p>

      {/* Yearly planned totals */}
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

      {/* Plan vs actual */}
      <div className="ios-card px-4 py-4 space-y-4">
        <p className="text-[13px] font-semibold text-muted-foreground">แผนเทียบจริงรายเดือน</p>
        <PlanVsActualChart data={comparison} plannedKey="plannedIncome" actualKey="actualIncome" label="รายรับ" color="#34C759" />
        <PlanVsActualChart data={comparison} plannedKey="plannedExpense" actualKey="actualExpense" label="รายจ่าย" color="#FF3B30" />
      </div>

      {/* Proportion of planned outflow by type */}
      {typeSlices.length > 0 && (
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
          <div className="divide-y divide-border/50">
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
      )}
    </div>
  );
}

// ─── Item Form ─────────────────────────────────────────────────────────────────

interface DebtCreationInput {
  name: string;
  monthlyAmount: number;
  totalMonths: number;
  startDate: string;
  notes?: string;
}

interface ItemFormProps {
  initial?: Partial<BudgetItem>;
  categories: Category[];
  isNew?: boolean;
  currentMonth: number;
  currentYear: number;
  onSave: (item: Omit<BudgetItem, "id">, months: number[]) => void;
  onSaveDebt?: (debt: DebtCreationInput) => void;
  onCancel: () => void;
}

function ItemForm({ initial, categories, isNew, currentMonth, currentYear, onSave, onSaveDebt, onCancel }: ItemFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<ItemType>(initial?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [error, setError] = useState("");

  // Month selection (new non-LIABILITY items only)
  const [monthMode, setMonthMode] = useState<"single" | "all" | "custom">("single");
  const [customMonths, setCustomMonths] = useState<number[]>([currentMonth]);

  // Debt-specific fields (new LIABILITY items)
  const [totalMonths, setTotalMonths] = useState(12);
  const [debtStartMonth, setDebtStartMonth] = useState(currentMonth);

  const isNewLiability = isNew && type === "LIABILITY";

  const filteredCategories = categories.filter(c =>
    type === "INCOME" ? c.type === "INCOME" :
    type === "EXPENSE" ? c.type === "EXPENSE" : true
  );

  const selectedMonths =
    monthMode === "single" ? [currentMonth] :
    monthMode === "all"    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] :
    customMonths;

  function toggleCustomMonth(m: number) {
    setCustomMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }

  // Compute debt end month label
  const endMonthIdx = ((debtStartMonth - 1 + totalMonths - 1) % 12);
  const endYearOffset = Math.floor((debtStartMonth - 1 + totalMonths - 1) / 12);
  const endLabel = `${SHORT_MONTHS[endMonthIdx]} ${currentYear + endYearOffset + 543}`;

  function handleSave() {
    if (!name.trim()) { setError("กรุณากรอกชื่อ"); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) { setError("จำนวนเงินต้องมากกว่า 0"); return; }

    if (isNewLiability) {
      // Create actual debt record
      if (totalMonths < 1 || totalMonths > 360) { setError("จำนวนงวดต้อง 1-360 เดือน"); return; }
      const mm = String(debtStartMonth).padStart(2, "0");
      onSaveDebt?.({
        name: name.trim(),
        monthlyAmount: num,
        totalMonths,
        startDate: `${currentYear}-${mm}-01`,
        notes: notes || undefined,
      });
    } else {
      if (monthMode === "custom" && customMonths.length === 0) { setError("กรุณาเลือกอย่างน้อย 1 เดือน"); return; }
      onSave(
        { name: name.trim(), type, amount: num, notes: notes || null, sortOrder: initial?.sortOrder ?? 0, categoryId: categoryId || null },
        selectedMonths,
      );
    }
  }

  return (
    <div className="ios-card px-4 py-4 space-y-3">
      {/* Type */}
      <div className="grid grid-cols-4 gap-1">
        {(Object.keys(TYPE_CONFIG) as ItemType[]).map(t => (
          <button key={t} type="button"
            onClick={() => { setType(t); setCategoryId(""); setError(""); }}
            className={cn("py-1.5 rounded-xl text-[12px] font-semibold transition-all",
              type === t ? `${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}` : "bg-muted text-muted-foreground"
            )}>
            {TYPE_CONFIG[t].emoji} {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      {/* Name */}
      <Input
        placeholder={isNewLiability ? "ชื่อหนี้สิน เช่น ผ่อนรถ, สินเชื่อบ้าน" : "ชื่อรายการ เช่น เงินเดือน, ค่าเช่า"}
        value={name} onChange={e => setName(e.target.value)}
        className="bg-input h-11 rounded-xl border-0" />

      {/* Amount */}
      <Input type="number" inputMode="decimal" step="0.01"
        placeholder={isNewLiability ? "ยอดผ่อนต่อเดือน (บาท)" : "จำนวนเงินวางแผน (บาท)"}
        value={amount} onChange={e => setAmount(e.target.value)}
        className={cn("bg-input h-11 rounded-xl border-0 text-[18px] font-bold", TYPE_CONFIG[type].color)} />

      {/* Debt-specific fields */}
      {isNewLiability ? (
        <div className="space-y-3 pt-1 border-t border-border/40">
          <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
            รายละเอียดหนี้สิน
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">จำนวนงวด (เดือน)</p>
              <Input type="number" inputMode="numeric" min={1} max={360}
                value={totalMonths} onChange={e => setTotalMonths(parseInt(e.target.value) || 1)}
                className="bg-input h-10 rounded-xl border-0" />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">เริ่มงวดแรก</p>
              <select value={debtStartMonth} onChange={e => setDebtStartMonth(parseInt(e.target.value))}
                className="w-full h-10 rounded-xl bg-input border-0 px-3 text-[14px] appearance-none">
                {SHORT_MONTHS.map((label, i) => (
                  <option key={i + 1} value={i + 1}>{label} {currentYear + 543}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Summary */}
          {parseFloat(amount) > 0 && totalMonths > 0 && (
            <div className="rounded-xl bg-[#FF9500]/10 px-3 py-2.5 space-y-0.5">
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">ยอดรวมทั้งหมด</span>
                <span className="font-bold text-[#FF9500]">{formatCurrency(parseFloat(amount) * totalMonths)}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-muted-foreground">ชำระครบ</span>
                <span className="font-medium">{endLabel}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Category (non-liability) */}
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
            className="w-full h-11 rounded-xl bg-input border-0 px-3 text-[14px] text-foreground appearance-none">
            <option value="">— หมวดหมู่ (ไม่บังคับ) —</option>
            {filteredCategories.map(c => (
              <optgroup key={c.id} label={`${c.icon ?? ""} ${c.name}`}>
                <option value={c.id}>{c.icon ?? ""} {c.name} (ทั้งหมด)</option>
                {c.children.map(ch => (
                  <option key={ch.id} value={ch.id}>　{ch.icon ?? ""} {ch.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Notes */}
          <Input placeholder="หมายเหตุ (ไม่บังคับ)" value={notes ?? ""}
            onChange={e => setNotes(e.target.value)} className="bg-input h-11 rounded-xl border-0" />

          {/* Month selector — new non-LIABILITY items only */}
          {isNew && (
            <div className="space-y-2 pt-1 border-t border-border/40">
              <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">ใช้กี่เดือน?</p>
              <div className="grid grid-cols-3 gap-1">
                {(["single", "all", "custom"] as const).map(mode => (
                  <button key={mode} type="button"
                    onClick={() => { setMonthMode(mode); if (mode === "custom") setCustomMonths([currentMonth]); }}
                    className={cn("py-2 rounded-xl text-[12px] font-semibold transition-all",
                      monthMode === mode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>
                    {mode === "single" ? "เดือนนี้" : mode === "all" ? "ทุก 12 เดือน" : "เลือกเอง"}
                  </button>
                ))}
              </div>
              {monthMode === "custom" && (
                <div className="grid grid-cols-4 gap-1">
                  {SHORT_MONTHS.map((label, i) => {
                    const m = i + 1;
                    const sel = customMonths.includes(m);
                    return (
                      <button key={m} type="button" onClick={() => toggleCustomMonth(m)}
                        className={cn("py-1.5 rounded-lg text-[12px] font-medium transition-all",
                          sel ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {monthMode !== "single" && (
                <p className="text-[11px] text-muted-foreground text-center">
                  รายการนี้จะถูกเพิ่มใน {selectedMonths.length} เดือน
                </p>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>ยกเลิก</Button>
        <Button className="flex-1" onClick={handleSave}
          style={isNewLiability ? { backgroundColor: "#FF9500" } : {}}>
          {isNewLiability ? "สร้างหนี้สิน" :
           isNew && monthMode !== "single" ? `บันทึก (${selectedMonths.length} เดือน)` : "บันทึก"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [overview, setOverview] = useState<MonthOverview[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [yearlyComparison, setYearlyComparison] = useState<YearlyComparisonMonth[]>([]);
  const [loadingYearlyComparison, setLoadingYearlyComparison] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);

  // Month detail
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [detail, setDetail] = useState<MonthDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);

  // Item edit state
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  // Copy from month dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copySrcMonth, setCopySrcMonth] = useState(1);

  // Debt import dialog
  const [showDebtImport, setShowDebtImport] = useState(false);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loadingDebts, setLoadingDebts] = useState(false);
  const [selectedDebtIds, setSelectedDebtIds] = useState<string[]>([]);
  const [debtImporting, setDebtImporting] = useState(false);

  // Comparison sheet
  const [showComparison, setShowComparison] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Fetch categories once on mount
  useEffect(() => {
    fetch("/api/v1/categories")
      .then(r => r.json())
      .then(d => { if (d.success) setCategories(d.data); });
  }, []);

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

  async function fetchDetail(month: number) {
    setLoadingDetail(true);
    setSelectedMonth(month);
    setAddingItem(false);
    setEditingIdx(null);
    try {
      const res = await fetch(`/api/v1/budgets/${year}/${month}`);
      const d = await res.json();
      if (d.success) setDetail({ year, month, items: d.data.items ?? [] });
    } finally { setLoadingDetail(false); }
  }

  async function saveItemsForMonth(month: number, items: BudgetItem[]) {
    await fetch(`/api/v1/budgets/${year}/${month}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  }

  // Add new item — supports multi-month by fetching each month's current items in parallel
  async function handleAddItem(item: Omit<BudgetItem, "id">, months: number[]) {
    if (!selectedMonth) return;
    setSaving(true);
    setAddingItem(false);
    try {
      const states = await Promise.all(
        months.map(m => fetch(`/api/v1/budgets/${year}/${m}`).then(r => r.json()))
      );
      await Promise.all(
        months.map((m, i) => {
          const current: BudgetItem[] = states[i].success ? (states[i].data.items ?? []) : [];
          return saveItemsForMonth(m, [...current, { ...item, sortOrder: current.length }]);
        })
      );
      // Refresh current month
      const detailRes = await fetch(`/api/v1/budgets/${year}/${selectedMonth}`);
      const detailD = await detailRes.json();
      if (detailD.success) setDetail({ year, month: selectedMonth, items: detailD.data.items ?? [] });
      fetchOverview();
    } finally { setSaving(false); }
  }

  function handleEditItem(idx: number, item: Omit<BudgetItem, "id">, _months: number[]) {
    if (!detail) return;
    const newItems = detail.items.map((it, i) => i === idx ? { ...it, ...item } : it);
    setDetail({ ...detail, items: newItems });
    setEditingIdx(null);
    setSaving(true);
    saveItemsForMonth(detail.month, newItems).then(() => { fetchOverview(); setSaving(false); });
  }

  function handleDeleteItem(idx: number) {
    if (!detail) return;
    const newItems = detail.items.filter((_, i) => i !== idx);
    setDetail({ ...detail, items: newItems });
    setSaving(true);
    saveItemsForMonth(detail.month, newItems).then(() => { fetchOverview(); setSaving(false); });
  }

  async function handleCopyFrom() {
    if (!selectedMonth) return;
    setCopyLoading(true);
    try {
      const res = await fetch(`/api/v1/budgets/${year}/${selectedMonth}/copy-from/${year}/${copySrcMonth}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const d = await res.json();
      if (d.success) {
        setDetail({ year, month: selectedMonth, items: d.data.items ?? [] });
        setShowCopyDialog(false);
        fetchOverview();
      }
    } finally { setCopyLoading(false); }
  }

  async function openDebtImport() {
    setShowDebtImport(true);
    setSelectedDebtIds([]);
    setLoadingDebts(true);
    try {
      const res = await fetch("/api/v1/debts?status=ACTIVE");
      const d = await res.json();
      if (d.success) setDebts(d.data);
    } finally { setLoadingDebts(false); }
  }

  function toggleDebt(id: string) {
    setSelectedDebtIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleDebtImport() {
    if (!selectedMonth || selectedDebtIds.length === 0) return;
    setDebtImporting(true);
    try {
      const chosen = debts.filter(d => selectedDebtIds.includes(d.id));

      // Collect all unique months that need updating
      const monthSet = new Set<number>();
      for (const debt of chosen) {
        debtMonthsForYear(debt, year).forEach(({ month }) => monthSet.add(month));
      }
      const months = Array.from(monthSet).sort((a, b) => a - b);

      // Fetch current budget items for all affected months in parallel
      const states = await Promise.all(
        months.map(m => fetch(`/api/v1/budgets/${year}/${m}`).then(r => r.json()))
      );

      // Build updated items per month and PUT in parallel
      await Promise.all(
        months.map((m, i) => {
          const current: BudgetItem[] = states[i].success ? (states[i].data.items ?? []) : [];
          const toAdd: BudgetItem[] = chosen
            .map(debt => {
              const p = debtMonthsForYear(debt, year).find(x => x.month === m);
              if (!p) return null;
              return {
                name: debt.name,
                type: "LIABILITY" as ItemType,
                amount: p.amount,
                categoryId: null,
                debtId: debt.id,
                notes: `ยอดคงเหลือ ${formatCurrency(debt.remainingBalance)}`,
                sortOrder: current.length,
              };
            })
            .filter(Boolean) as BudgetItem[];

          return saveItemsForMonth(m, [...current, ...toAdd]);
        })
      );

      // Refresh current month detail
      const detailRes = await fetch(`/api/v1/budgets/${year}/${selectedMonth}`);
      const detailD = await detailRes.json();
      if (detailD.success) setDetail({ year, month: selectedMonth, items: detailD.data.items ?? [] });

      setShowDebtImport(false);
      fetchOverview();
    } finally { setDebtImporting(false); }
  }

  async function handleCreateDebt(input: DebtCreationInput) {
    if (!selectedMonth) return;
    setSaving(true);
    setAddingItem(false);
    try {
      await fetch("/api/v1/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          totalAmount: input.monthlyAmount * input.totalMonths,
          totalMonths: input.totalMonths,
          monthlyAmount: input.monthlyAmount,
          startDate: input.startDate,
          notes: input.notes,
        }),
      });
      // Refresh current month (debt creation auto-creates budget items)
      const detailRes = await fetch(`/api/v1/budgets/${year}/${selectedMonth}`);
      const detailD = await detailRes.json();
      if (detailD.success) setDetail({ year, month: selectedMonth, items: detailD.data.items ?? [] });
      fetchOverview();
    } finally { setSaving(false); }
  }

  async function fetchComparison(month: number) {
    setShowComparison(true);
    setLoadingComparison(true);
    try {
      const res = await fetch(`/api/v1/budgets/comparison?year=${year}&month=${month}`);
      const d = await res.json();
      if (d.success) setComparison(d.data);
    } finally { setLoadingComparison(false); }
  }

  const itemsByType = detail
    ? (Object.keys(TYPE_CONFIG) as ItemType[]).map(type => ({
        type,
        items: detail.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.type === type),
      })).filter(g => g.items.length > 0)
    : [];

  const netPlanned = detail
    ? detail.items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.amount, 0) -
      detail.items.filter(i => i.type !== "INCOME").reduce((s, i) => s + i.amount, 0)
    : 0;

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

      {/* 12-month grid */}
      {loadingOverview ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {overview.map(m => {
            const isCurrentMonth = m.month === now.getMonth() + 1 && year === now.getFullYear();
            const isSelected = selectedMonth === m.month;
            return (
              <button key={m.month} onClick={() => fetchDetail(m.month)}
                className={cn(
                  "ios-card p-3 text-left transition-all active:scale-[0.97]",
                  isSelected && "ring-2 ring-primary",
                  isCurrentMonth && !isSelected && "ring-1 ring-primary/40"
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
              </button>
            );
          })}
        </div>
      )}

      {/* Month detail */}
      {selectedMonth && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold">{getMonthName(selectedMonth)} {year + 543}</h2>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm"
                onClick={() => { setShowCopyDialog(true); setCopySrcMonth(selectedMonth > 1 ? selectedMonth - 1 : 12); }}>
                <Copy className="h-3.5 w-3.5 mr-1" /> คัดลอก
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fetchComparison(selectedMonth)}>
                📊 เทียบจริง
              </Button>
            </div>
          </div>

          {loadingDetail ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <>
              {/* Items grouped by type */}
              {itemsByType.map(({ type, items }) => (
                <div key={type} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1">
                    <span className="text-base">{TYPE_CONFIG[type].emoji}</span>
                    <span className={cn("text-[13px] font-semibold", TYPE_CONFIG[type].color)}>
                      {TYPE_CONFIG[type].label}
                    </span>
                    <span className="text-[12px] text-muted-foreground ml-auto">
                      รวม {formatCurrency(items.reduce((s, { item }) => s + item.amount, 0))}
                    </span>
                  </div>
                  <div className="ios-card overflow-hidden divide-y divide-border/50">
                    {items.map(({ item, idx }) => (
                      editingIdx === idx ? (
                        <div key={idx} className="p-2">
                          <ItemForm
                            initial={item}
                            categories={categories}
                            currentMonth={selectedMonth}
                            currentYear={year}
                            onSave={(updated, months) => handleEditItem(idx, updated, months)}
                            onCancel={() => setEditingIdx(null)}
                          />
                        </div>
                      ) : (
                        <div key={idx} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {item.category?.icon && <span className="text-sm">{item.category.icon}</span>}
                              <p className="text-[14px] font-medium truncate">{item.name}</p>
                            </div>
                            {item.category && (
                              <p className="text-[11px] text-muted-foreground">{item.category.name}</p>
                            )}
                            {item.notes && !item.category && (
                              <p className="text-[11px] text-muted-foreground">{item.notes}</p>
                            )}
                          </div>
                          <p className={cn("text-[15px] font-bold tabular-nums shrink-0", TYPE_CONFIG[type].color)}>
                            {formatCurrency(item.amount)}
                          </p>
                          {item.debtId ? (
                            <Link href={`/debts/${item.debtId}`}
                              className="flex items-center gap-1 h-7 px-2 rounded-lg bg-[#FF9500]/10 text-[#FF9500] hover:bg-[#FF9500]/20 transition-colors text-[11px] font-medium shrink-0">
                              <Lock className="h-3 w-3" /> จัดการ
                            </Link>
                          ) : (
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => { setEditingIdx(idx); setAddingItem(false); }}
                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDeleteItem(idx)}
                                className="h-7 w-7 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    ))}
                  </div>
                </div>
              ))}

              {/* Empty state */}
              {detail?.items.length === 0 && !addingItem && (
                <div className="text-center py-8">
                  <p className="text-3xl mb-2">📋</p>
                  <p className="text-[15px] font-medium">ยังไม่มีรายการงบ</p>
                  <p className="text-[13px] text-muted-foreground mt-1">กด + เพื่อเพิ่มรายการแรก</p>
                </div>
              )}

              {/* Add item form */}
              {addingItem && (
                <ItemForm
                  isNew
                  categories={categories}
                  currentMonth={selectedMonth}
                  currentYear={year}
                  onSave={handleAddItem}
                  onSaveDebt={handleCreateDebt}
                  onCancel={() => setAddingItem(false)}
                />
              )}

              {/* Summary bar */}
              {detail && detail.items.length > 0 && !addingItem && editingIdx === null && (
                <div className="ios-card px-4 py-3 space-y-1.5">
                  {(["INCOME", "EXPENSE", "LIABILITY", "SAVING"] as ItemType[]).map(type => {
                    const total = detail.items.filter(i => i.type === type).reduce((s, i) => s + i.amount, 0);
                    if (total === 0) return null;
                    return (
                      <div key={type} className="flex justify-between text-[13px]">
                        <span className={TYPE_CONFIG[type].color}>{TYPE_CONFIG[type].emoji} {TYPE_CONFIG[type].label}</span>
                        <span className={cn("font-semibold tabular-nums", TYPE_CONFIG[type].color)}>
                          {type === "INCOME" ? "+" : "-"}{formatCurrency(total)}
                        </span>
                      </div>
                    );
                  })}
                  <div className="border-t border-border/50 pt-1.5 flex justify-between text-[14px] font-bold">
                    <span>คงเหลือสุทธิ (วางแผน)</span>
                    <span className={cn("tabular-nums", netPlanned >= 0 ? "text-primary" : "text-destructive")}>
                      {netPlanned >= 0 ? "+" : ""}{formatCurrency(netPlanned)}
                    </span>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {!addingItem && editingIdx === null && (
                <div className="flex gap-2">
                  <button onClick={() => { setAddingItem(true); setEditingIdx(null); }}
                    className="flex-1 h-12 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2 text-[14px] font-medium text-muted-foreground">
                    <Plus className="h-4 w-4" /> เพิ่มรายการงบ
                  </button>
                  <button onClick={openDebtImport}
                    className="h-12 px-4 rounded-2xl border-2 border-dashed border-[#FF9500]/50 hover:border-[#FF9500] hover:text-[#FF9500] transition-colors flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground whitespace-nowrap">
                    <CreditCard className="h-4 w-4" /> นำเข้าหนี้สิน
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Copy from dialog */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>คัดลอกงบจากเดือนอื่น</DialogTitle>
            <DialogDescription>จะแทนที่รายการงบทั้งหมดในเดือนนี้</DialogDescription>
          </DialogHeader>
          <div className="mt-3 space-y-2">
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">เลือกเดือนต้นทาง</label>
            <select value={copySrcMonth} onChange={e => setCopySrcMonth(parseInt(e.target.value))}
              className="w-full h-11 rounded-xl bg-input border-0 px-3 text-[15px]">
              {Array.from({ length: 12 }, (_, i) => i + 1).filter(m => m !== selectedMonth).map(m => (
                <option key={m} value={m}>{getMonthName(m)} {year + 543}</option>
              ))}
            </select>
          </div>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setShowCopyDialog(false)} disabled={copyLoading}>ยกเลิก</Button>
            <Button onClick={handleCopyFrom} disabled={copyLoading}>
              {copyLoading ? "กำลังคัดลอก..." : "คัดลอก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Debt import dialog */}
      <Dialog open={showDebtImport} onOpenChange={setShowDebtImport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>💳 นำเข้าจากหนี้สิน</DialogTitle>
            <DialogDescription>
              เลือกหนี้สินที่ต้องการวางแผนชำระ — จะถูกเพิ่มเป็นรายการหนี้สินในงบเดือนนี้
            </DialogDescription>
          </DialogHeader>

          {loadingDebts ? (
            <div className="space-y-2 mt-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
          ) : debts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">💳</p>
              <p className="text-[14px] text-muted-foreground">ไม่มีหนี้สินที่กำลังชำระอยู่</p>
            </div>
          ) : (
            <div className="mt-2 space-y-2 max-h-60 overflow-y-auto pr-1">
              {debts.map(debt => {
                const yearMonths = debtMonthsForYear(debt, year);
                const sel = selectedDebtIds.includes(debt.id);
                const hasMonthsThisYear = yearMonths.length > 0;
                const monthLabels = yearMonths.map(({ month }) => SHORT_MONTHS[month - 1]).join(", ");
                const avgAmount = yearMonths.length > 0
                  ? yearMonths.reduce((s, p) => s + p.amount, 0) / yearMonths.length
                  : Number(debt.payments[0]?.amount ?? 0);

                return (
                  <button key={debt.id} type="button"
                    onClick={() => hasMonthsThisYear && toggleDebt(debt.id)}
                    disabled={!hasMonthsThisYear}
                    className={cn(
                      "w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left",
                      !hasMonthsThisYear && "opacity-40 cursor-not-allowed",
                      sel ? "border-[#FF9500] bg-[#FF9500]/5" : "border-border bg-muted/30"
                    )}>
                    <div className={cn(
                      "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all mt-0.5",
                      sel ? "border-[#FF9500] bg-[#FF9500]" : "border-muted-foreground"
                    )}>
                      {sel && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate">{debt.name}</p>
                      {hasMonthsThisYear ? (
                        <p className="text-[11px] text-[#FF9500] font-medium mt-0.5">
                          📅 {yearMonths.length} เดือน: {monthLabels}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          ไม่มีงวดในปี {year + 543}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        คงเหลือ {formatCurrency(debt.remainingBalance)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold text-[#FF9500]">{formatCurrency(avgAmount)}</p>
                      <p className="text-[11px] text-muted-foreground">ต่อเดือน</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setShowDebtImport(false)} disabled={debtImporting}>
              ยกเลิก
            </Button>
            <Button onClick={handleDebtImport}
              disabled={debtImporting || selectedDebtIds.length === 0}
              className="bg-[#FF9500] hover:bg-[#FF9500]/90 text-white">
              {debtImporting ? "กำลังนำเข้า..." : `นำเข้า${selectedDebtIds.length > 0 ? ` (${selectedDebtIds.length} รายการ)` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget vs Actual sheet */}
      <Sheet open={showComparison} onOpenChange={setShowComparison}>
        <SheetContent title={`เปรียบเทียบงบ vs จริง — ${selectedMonth ? getMonthName(selectedMonth) : ""} ${year + 543}`}>
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
                  <div className="ios-card overflow-hidden divide-y divide-border/50">
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

      {saving && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-foreground text-background text-[13px] font-medium px-4 py-2 rounded-full shadow-lg z-50">
          กำลังบันทึก...
        </div>
      )}
    </div>
  );
}

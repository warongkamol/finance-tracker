"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ItemType = "INCOME" | "EXPENSE" | "LIABILITY" | "SAVING";

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  type: "INCOME" | "EXPENSE";
  children: Category[];
}

export interface DebtPayment {
  id: string;
  amount: string | number;
  status: string;
  dueDate: string;
  installmentNo: number;
}

export interface Debt {
  id: string;
  name: string;
  totalAmount: number;
  remainingBalance: number;
  status: string;
  payments: DebtPayment[];
}

// Returns pending payment months for a given year
export function debtMonthsForYear(debt: Debt, year: number): { month: number; amount: number }[] {
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

export interface BudgetItem {
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

export interface ComparisonItem {
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

export interface UnmatchedCategoryRow {
  categoryId: string | null;
  categoryName: string;
  categoryIcon: string | null;
  total: number;
}

export interface Comparison {
  hasBudget: boolean;
  summary: {
    plannedIncome: number; plannedExpense: number; plannedLiability: number; plannedSaving: number;
    actualIncome: number; actualExpense: number; actualLiability: number; actualSaving: number;
    plannedNet: number; actualNet: number;
  };
  items: ComparisonItem[];
  unmatched: { income: UnmatchedCategoryRow[]; expense: UnmatchedCategoryRow[] };
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const TYPE_CONFIG: Record<ItemType, { label: string; color: string; bg: string; emoji: string }> = {
  INCOME:    { label: "รายรับ",    color: "text-[#34C759]", bg: "bg-[#34C759]/10", emoji: "💰" },
  EXPENSE:   { label: "รายจ่าย",   color: "text-[#FF3B30]", bg: "bg-[#FF3B30]/10", emoji: "💸" },
  LIABILITY: { label: "หนี้สิน",   color: "text-[#FF9500]", bg: "bg-[#FF9500]/10", emoji: "💳" },
  SAVING:    { label: "ออม/ลงทุน", color: "text-[#007AFF]", bg: "bg-[#007AFF]/10", emoji: "🏦" },
};

export const SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                             "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export const CHART_TOOLTIP_STYLE = { fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" };
export const AXIS_TICK = { fontSize: 9, fill: "var(--muted-foreground)" } as const;
export const Y_TICK_FORMATTER = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-border/50", className)} />;
}

// ─── Top-level route nav (shared across /budget, /budget/plan, /budget/track) ─

const BUDGET_TOP_TABS = [
  { href: "/budget", label: "ภาพรวม" },
  { href: "/budget/plan", label: "วางแผน" },
  { href: "/budget/track", label: "ติดตาม" },
] as const;

export function BudgetTopNav({ year }: { year: number }) {
  const pathname = usePathname();
  return (
    <div className="ios-card p-1 grid grid-cols-3 gap-1">
      {BUDGET_TOP_TABS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link key={href} href={`${href}?year=${year}`}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold text-center transition-all",
              active ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

// ─── Plan vs Actual chart (shared by /budget and /budget/plan) ────────────────

export const OVER_BUDGET_COLOR = "#D70015";

// Generic over T (not a fixed index-signature type) so callers can pass their
// own named interface (e.g. YearlyComparisonMonth) directly — TS would reject
// assigning a plain interface to a `[key: string]: ...` index-signature type.
export function PlanVsActualChart<T extends { monthName: string }>({
  data, plannedKey, actualKey, label, color,
}: {
  data: T[];
  plannedKey: keyof T;
  actualKey: keyof T;
  label: string;
  color: string;
}) {
  const hasData = data.some(d => Number(d[plannedKey]) > 0 || Number(d[actualKey]) > 0);
  const chartData = data.map(d => ({
    ...d,
    remainder: Math.max(0, Number(d[plannedKey]) - Number(d[actualKey])),
  }));
  const hasOverBudget = chartData.some(d => Number(d[actualKey]) > Number(d[plannedKey]));

  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground mb-1">{label}</p>
      {!hasData ? (
        <p className="text-center py-6 text-[13px] text-muted-foreground">ยังไม่มีข้อมูล</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="monthName" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={Y_TICK_FORMATTER} />
              <Tooltip formatter={(value) => [formatCurrency(Number(value)), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
              <Bar dataKey={actualKey as string} stackId="a" radius={[3, 3, 0, 0]} maxBarSize={16}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={Number(d[actualKey]) > Number(d[plannedKey]) ? OVER_BUDGET_COLOR : color} />
                ))}
              </Bar>
              <Bar dataKey="remainder" stackId="a" fill={`${color}33`} radius={[3, 3, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-3 pt-1">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} /> จริง
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: `${color}33` }} /> คงเหลือถึงแผน
            </span>
            {hasOverBudget && (
              <span className="flex items-center gap-1 text-[11px] text-destructive">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: OVER_BUDGET_COLOR }} /> เกินแผน
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Item Form ─────────────────────────────────────────────────────────────────

export interface DebtCreationInput {
  name: string;
  monthlyAmount: number;
  totalMonths: number;
  startDate: string;
  notes?: string;
}

export interface ItemFormProps {
  initial?: Partial<BudgetItem>;
  categories: Category[];
  isNew?: boolean;
  currentMonth: number;
  currentYear: number;
  onSave: (item: Omit<BudgetItem, "id">, months: number[]) => void;
  onSaveDebt?: (debt: DebtCreationInput) => void;
  onCancel: () => void;
}

export function ItemForm({ initial, categories, isNew, currentMonth, currentYear, onSave, onSaveDebt, onCancel }: ItemFormProps) {
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
    <div className="space-y-3">
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

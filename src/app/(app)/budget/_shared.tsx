"use client";

import { useState } from "react";
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

export interface Comparison {
  hasBudget: boolean;
  summary: {
    plannedIncome: number; plannedExpense: number; plannedLiability: number; plannedSaving: number;
    actualIncome: number; actualExpense: number;
    plannedNet: number; actualNet: number;
  };
  items: ComparisonItem[];
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

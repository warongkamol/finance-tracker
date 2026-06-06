"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Copy, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatCurrency, getMonthName, cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemType = "INCOME" | "EXPENSE" | "LIABILITY" | "SAVING";

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

interface BudgetItem {
  id?: string;
  name: string;
  type: ItemType;
  amount: number;
  categoryId?: string | null;
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

// ─── Item Form (inline) ───────────────────────────────────────────────────────

interface ItemFormProps {
  initial?: Partial<BudgetItem>;
  onSave: (item: Omit<BudgetItem, "id">) => void;
  onCancel: () => void;
}

function ItemForm({ initial, onSave, onCancel }: ItemFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<ItemType>(initial?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");

  function handleSave() {
    if (!name.trim()) { setError("กรุณากรอกชื่อ"); return; }
    const num = parseFloat(amount);
    if (isNaN(num) || num < 0) { setError("จำนวนเงินไม่ถูกต้อง"); return; }
    onSave({ name: name.trim(), type, amount: num, notes: notes || null, sortOrder: initial?.sortOrder ?? 0, categoryId: initial?.categoryId ?? null });
  }

  return (
    <div className="ios-card px-4 py-4 space-y-3">
      {/* Type selector */}
      <div className="grid grid-cols-4 gap-1">
        {(Object.keys(TYPE_CONFIG) as ItemType[]).map(t => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={cn("py-1.5 rounded-xl text-[12px] font-semibold transition-all",
              type === t ? `${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}` : "bg-muted text-muted-foreground"
            )}>
            {TYPE_CONFIG[t].emoji} {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      {/* Name */}
      <Input placeholder="ชื่อรายการ เช่น ค่าไฟ, เงินเดือน" value={name}
        onChange={e => setName(e.target.value)} className="bg-input h-11 rounded-xl border-0" />

      {/* Amount */}
      <Input type="number" inputMode="decimal" step="0.01" placeholder="จำนวนเงิน (บาท)"
        value={amount} onChange={e => setAmount(e.target.value)}
        className={cn("bg-input h-11 rounded-xl border-0 text-[18px] font-bold",
          type === "INCOME" ? "text-[#34C759]" : type === "EXPENSE" ? "text-[#FF3B30]" : type === "LIABILITY" ? "text-[#FF9500]" : "text-[#007AFF]"
        )} />

      {/* Notes */}
      <Input placeholder="หมายเหตุ (ไม่บังคับ)" value={notes ?? ""}
        onChange={e => setNotes(e.target.value)} className="bg-input h-11 rounded-xl border-0" />

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>ยกเลิก</Button>
        <Button className="flex-1" onClick={handleSave}>บันทึก</Button>
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

  // Month detail panel
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

  // Comparison sheet
  const [showComparison, setShowComparison] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  const fetchOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch(`/api/v1/budgets?year=${year}`);
      const d = await res.json();
      if (d.success) setOverview(d.data.months);
    } finally { setLoadingOverview(false); }
  }, [year]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

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

  async function saveDetail(items: BudgetItem[]) {
    if (!selectedMonth) return;
    setSaving(true);
    try {
      await fetch(`/api/v1/budgets/${year}/${selectedMonth}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      fetchOverview();
    } finally { setSaving(false); }
  }

  function handleAddItem(item: Omit<BudgetItem, "id">) {
    if (!detail) return;
    const newItems = [...detail.items, { ...item, sortOrder: detail.items.length }];
    setDetail({ ...detail, items: newItems });
    setAddingItem(false);
    saveDetail(newItems);
  }

  function handleEditItem(idx: number, item: Omit<BudgetItem, "id">) {
    if (!detail) return;
    const newItems = detail.items.map((it, i) => i === idx ? { ...it, ...item } : it);
    setDetail({ ...detail, items: newItems });
    setEditingIdx(null);
    saveDetail(newItems);
  }

  function handleDeleteItem(idx: number) {
    if (!detail) return;
    const newItems = detail.items.filter((_, i) => i !== idx);
    setDetail({ ...detail, items: newItems });
    saveDetail(newItems);
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

  async function fetchComparison(month: number) {
    setShowComparison(true);
    setLoadingComparison(true);
    try {
      const res = await fetch(`/api/v1/budgets/comparison?year=${year}&month=${month}`);
      const d = await res.json();
      if (d.success) setComparison(d.data);
    } finally { setLoadingComparison(false); }
  }

  // Group detail items by type
  const itemsByType = detail ? (Object.keys(TYPE_CONFIG) as ItemType[]).map(type => ({
    type,
    items: detail.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.type === type),
  })).filter(g => g.items.length > 0) : [];

  return (
    <div className="py-5 space-y-5">
      {/* Year navigator */}
      <div className="flex items-center justify-between">
        <button onClick={() => setYear(y => y - 1)} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[20px] font-bold">งบการเงิน {year + 543}</h1>
        <button onClick={() => setYear(y => y + 1)} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

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
                    <p className="text-[11px] text-[#FF3B30] font-medium">-{formatCurrency(m.totalExpense + m.totalLiability + m.totalSaving)}</p>
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
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowCopyDialog(true); setCopySrcMonth(selectedMonth > 1 ? selectedMonth - 1 : 12); }}>
                <Copy className="h-4 w-4 mr-1" /> คัดลอก
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
                  <div className={cn("flex items-center gap-1.5 px-1")}>
                    <span className="text-base">{TYPE_CONFIG[type].emoji}</span>
                    <span className={cn("text-[13px] font-semibold", TYPE_CONFIG[type].color)}>
                      {TYPE_CONFIG[type].label}
                    </span>
                    <span className="text-[12px] text-muted-foreground ml-auto">
                      {formatCurrency(items.reduce((s, { item }) => s + item.amount, 0))}
                    </span>
                  </div>
                  <div className="ios-card overflow-hidden divide-y divide-border/50">
                    {items.map(({ item, idx }) => (
                      editingIdx === idx ? (
                        <div key={idx} className="p-2">
                          <ItemForm
                            initial={item}
                            onSave={(updated) => handleEditItem(idx, updated)}
                            onCancel={() => setEditingIdx(null)}
                          />
                        </div>
                      ) : (
                        <div key={idx} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium">{item.name}</p>
                            {item.notes && <p className="text-[12px] text-muted-foreground">{item.notes}</p>}
                          </div>
                          <p className={cn("text-[15px] font-bold tabular-nums shrink-0", TYPE_CONFIG[type].color)}>
                            {formatCurrency(item.amount)}
                          </p>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => setEditingIdx(idx)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteItem(idx)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
                  onSave={handleAddItem}
                  onCancel={() => setAddingItem(false)}
                />
              )}

              {/* Summary bar */}
              {detail && detail.items.length > 0 && (
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
                    <span className={cn(
                      "tabular-nums",
                      (detail.items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.amount, 0) -
                       detail.items.filter(i => i.type !== "INCOME").reduce((s, i) => s + i.amount, 0)) >= 0
                        ? "text-primary" : "text-destructive"
                    )}>
                      {formatCurrency(
                        detail.items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.amount, 0) -
                        detail.items.filter(i => i.type !== "INCOME").reduce((s, i) => s + i.amount, 0)
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Add button */}
              {!addingItem && (
                <button onClick={() => { setAddingItem(true); setEditingIdx(null); }}
                  className="w-full h-12 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2 text-[14px] font-medium text-muted-foreground">
                  <Plus className="h-4 w-4" /> เพิ่มรายการงบ
                </button>
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
            <select
              value={copySrcMonth}
              onChange={e => setCopySrcMonth(parseInt(e.target.value))}
              className="w-full h-11 rounded-xl bg-input border-0 px-3 text-[15px]"
            >
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

      {/* Budget vs Actual comparison sheet */}
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
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "วางแผนรายรับ", value: comparison.summary.plannedIncome, color: "text-[#34C759]" },
                  { label: "รายรับจริง", value: comparison.summary.actualIncome, color: "text-[#34C759]" },
                  { label: "วางแผนรายจ่าย", value: comparison.summary.plannedExpense, color: "text-[#FF3B30]" },
                  { label: "รายจ่ายจริง", value: comparison.summary.actualExpense, color: "text-[#FF3B30]" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="ios-card px-3 py-3">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className={cn("text-[16px] font-bold tabular-nums mt-0.5", color)}>{formatCurrency(value)}</p>
                  </div>
                ))}
              </div>

              {/* Net comparison */}
              <div className="ios-card px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-[12px] text-muted-foreground">คงเหลือวางแผน</p>
                  <p className={cn("text-[17px] font-bold tabular-nums", comparison.summary.plannedNet >= 0 ? "text-primary" : "text-destructive")}>
                    {formatCurrency(comparison.summary.plannedNet)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-muted-foreground">คงเหลือจริง</p>
                  <p className={cn("text-[17px] font-bold tabular-nums", comparison.summary.actualNet >= 0 ? "text-primary" : "text-destructive")}>
                    {formatCurrency(comparison.summary.actualNet)}
                  </p>
                </div>
              </div>

              {/* Items breakdown */}
              {comparison.items.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[13px] font-medium text-muted-foreground px-1">รายละเอียดแต่ละรายการ</p>
                  <div className="ios-card overflow-hidden divide-y divide-border/50">
                    {comparison.items.map(item => (
                      <div key={item.id} className={cn("px-4 py-3", item.isOver && "bg-destructive/5")}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-base shrink-0">{TYPE_CONFIG[item.type].emoji}</span>
                            <p className="text-[13px] font-medium truncate">{item.name}</p>
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
                        {/* Progress bar */}
                        {item.planned > 0 && (
                          <div className="w-full bg-border/50 rounded-full h-1.5 mt-2">
                            <div className={cn("h-1.5 rounded-full transition-all",
                              item.isOver ? "bg-destructive" : TYPE_CONFIG[item.type].color.replace("text-", "bg-").replace("[", "[").replace("]", "]")
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

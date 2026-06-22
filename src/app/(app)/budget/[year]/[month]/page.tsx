"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Copy, Pencil, Trash2, CheckCircle2, CreditCard, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatCurrency, getMonthName, cn } from "@/lib/utils";
import {
  type ItemType, type Category, type Debt, type BudgetItem,
  TYPE_CONFIG, SHORT_MONTHS, Skeleton, debtMonthsForYear, ItemForm,
} from "../../_shared";

interface MonthDetail {
  year: number;
  month: number;
  items: BudgetItem[];
}

const ACCOUNT_EMOJI: Record<string, string> = { CASH: "💵", SAVINGS: "💰" };

// Adjacent month, wrapping across year boundaries (Dec ↔ Jan)
function adjacentMonth(year: number, month: number, delta: 1 | -1): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  if (m > 12) { m = 1; y += 1; }
  if (m < 1) { m = 12; y -= 1; }
  return { year: y, month: m };
}

export default function BudgetMonthPage() {
  const params = useParams<{ year: string; month: string }>();
  const year = parseInt(params.year);
  const month = parseInt(params.month);

  const [detail, setDetail] = useState<MonthDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  // Item add/edit (sheet-driven)
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const itemSheetOpen = addingItem || editingIdx !== null;

  // Copy-from dialog
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copySrcMonth, setCopySrcMonth] = useState(month > 1 ? month - 1 : 12);

  // Debt-import dialog
  const [showDebtImport, setShowDebtImport] = useState(false);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loadingDebts, setLoadingDebts] = useState(false);
  const [selectedDebtIds, setSelectedDebtIds] = useState<string[]>([]);
  const [debtImporting, setDebtImporting] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/v1/budgets/${year}/${month}`);
      const d = await res.json();
      if (d.success) setDetail({ year, month, items: d.data.items ?? [] });
    } finally { setLoadingDetail(false); }
  }, [year, month]);

  useEffect(() => {
    fetchDetail();
    setAddingItem(false);
    setEditingIdx(null);
    setCopySrcMonth(month > 1 ? month - 1 : 12);
  }, [fetchDetail, month]);

  useEffect(() => {
    fetch("/api/v1/categories").then(r => r.json()).then(d => { if (d.success) setCategories(d.data); });
  }, []);

  async function saveItemsForMonth(targetYear: number, targetMonth: number, items: BudgetItem[]) {
    await fetch(`/api/v1/budgets/${targetYear}/${targetMonth}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  }

  async function handleAddItem(item: Omit<BudgetItem, "id">, months: number[]) {
    setSaving(true);
    setAddingItem(false);
    try {
      const states = await Promise.all(
        months.map(m => fetch(`/api/v1/budgets/${year}/${m}`).then(r => r.json()))
      );
      await Promise.all(
        months.map((m, i) => {
          const current: BudgetItem[] = states[i].success ? (states[i].data.items ?? []) : [];
          return saveItemsForMonth(year, m, [...current, { ...item, sortOrder: current.length }]);
        })
      );
      await fetchDetail();
    } finally { setSaving(false); }
  }

  function handleEditItem(idx: number, item: Omit<BudgetItem, "id">) {
    if (!detail) return;
    const newItems = detail.items.map((it, i) => i === idx ? { ...it, ...item } : it);
    setDetail({ ...detail, items: newItems });
    setEditingIdx(null);
    setSaving(true);
    saveItemsForMonth(year, month, newItems).then(() => setSaving(false));
  }

  function handleDeleteItem(idx: number) {
    if (!detail) return;
    const newItems = detail.items.filter((_, i) => i !== idx);
    setDetail({ ...detail, items: newItems });
    setSaving(true);
    saveItemsForMonth(year, month, newItems).then(() => setSaving(false));
  }

  async function handleCopyFrom() {
    setCopyLoading(true);
    try {
      const res = await fetch(`/api/v1/budgets/${year}/${month}/copy-from/${year}/${copySrcMonth}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const d = await res.json();
      if (d.success) {
        setDetail({ year, month, items: d.data.items ?? [] });
        setShowCopyDialog(false);
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
    if (selectedDebtIds.length === 0) return;
    setDebtImporting(true);
    try {
      const chosen = debts.filter(d => selectedDebtIds.includes(d.id));

      // Collect all unique months that need updating
      const monthSet = new Set<number>();
      for (const debt of chosen) {
        debtMonthsForYear(debt, year).forEach(({ month: m }) => monthSet.add(m));
      }
      const months = Array.from(monthSet).sort((a, b) => a - b);

      const states = await Promise.all(
        months.map(m => fetch(`/api/v1/budgets/${year}/${m}`).then(r => r.json()))
      );

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

          return saveItemsForMonth(year, m, [...current, ...toAdd]);
        })
      );

      await fetchDetail();
      setShowDebtImport(false);
    } finally { setDebtImporting(false); }
  }

  async function handleLiabilityCreated() {
    setAddingItem(false);
    await fetchDetail();
  }

  const itemsByType = detail
    ? (Object.keys(TYPE_CONFIG) as ItemType[]).map(type => ({
        type,
        items: detail.items.map((item, idx) => ({ item, idx })).filter(({ item }) => item.type === type),
      })).filter(g => g.items.length > 0)
    : [];

  // Flat per-period sum — NOT carried over from other months (matches yearly dashboard total)
  const netPlanned = detail
    ? detail.items.filter(i => i.type === "INCOME").reduce((s, i) => s + i.amount, 0) -
      detail.items.filter(i => i.type !== "INCOME").reduce((s, i) => s + i.amount, 0)
    : 0;

  const prev = adjacentMonth(year, month, -1);
  const next = adjacentMonth(year, month, 1);

  return (
    <div className="py-5 space-y-5">
      {/* Header: back + month nav */}
      <div className="flex items-center justify-between">
        <Link href={`/budget/plan?year=${year}`}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-1">
          <Link href={`/budget/${prev.year}/${prev.month}`}
            className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-[18px] font-bold w-[150px] text-center">{getMonthName(month)} {year + 543}</h1>
          <Link href={`/budget/${next.year}/${next.month}`}
            className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="w-9 shrink-0" />
      </div>

      {/* Action toolbar */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setShowCopyDialog(true)}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors">
          <Copy className="h-4 w-4" /> คัดลอก
        </button>
        <button onClick={openDebtImport}
          className="ios-card py-2.5 flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-[#FF9500] transition-colors">
          <CreditCard className="h-4 w-4" /> นำเข้าหนี้
        </button>
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
              <div className="ios-card overflow-hidden divide-y divide-border">
                {items.map(({ item, idx }) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {item.category?.icon && <span className="text-sm">{item.category.icon}</span>}
                        {item.account && <span className="text-sm">{ACCOUNT_EMOJI[item.account.type] ?? "💰"}</span>}
                        <p className="text-[14px] font-medium truncate">{item.name}</p>
                      </div>
                      {item.category && (
                        <p className="text-[11px] text-muted-foreground">{item.category.name}</p>
                      )}
                      {item.account && !item.category && (
                        <p className="text-[11px] text-muted-foreground">{item.account.name}</p>
                      )}
                      {item.notes && !item.category && !item.account && (
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
                ))}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {detail?.items.length === 0 && (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-[15px] font-medium">ยังไม่มีรายการงบ</p>
              <p className="text-[13px] text-muted-foreground mt-1">กด + เพื่อเพิ่มรายการแรก</p>
            </div>
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
                <span className={cn("tabular-nums", netPlanned >= 0 ? "text-primary" : "text-destructive")}>
                  {netPlanned >= 0 ? "+" : ""}{formatCurrency(netPlanned)}
                </span>
              </div>
            </div>
          )}

          {/* Add item */}
          <button onClick={() => { setAddingItem(true); setEditingIdx(null); }}
            className="w-full h-12 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2 text-[14px] font-medium text-muted-foreground">
            <Plus className="h-4 w-4" /> เพิ่มรายการงบ
          </button>
        </>
      )}

      {/* Add/Edit item sheet — overlay instead of inline (avoids list reflow) */}
      <Sheet open={itemSheetOpen} onOpenChange={(open) => { if (!open) { setAddingItem(false); setEditingIdx(null); } }}>
        <SheetContent title={addingItem ? "เพิ่มรายการงบ" : "แก้ไขรายการงบ"}>
          {itemSheetOpen && (
            <ItemForm
              key={addingItem ? "new" : `edit-${editingIdx}`}
              initial={editingIdx !== null ? detail?.items[editingIdx] : undefined}
              isNew={addingItem}
              categories={categories}
              currentMonth={month}
              currentYear={year}
              onSave={addingItem ? handleAddItem : (updated) => editingIdx !== null && handleEditItem(editingIdx, updated)}
              onLiabilityCreated={addingItem ? handleLiabilityCreated : undefined}
              onCancel={() => { setAddingItem(false); setEditingIdx(null); }}
            />
          )}
        </SheetContent>
      </Sheet>

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
              {Array.from({ length: 12 }, (_, i) => i + 1).filter(m => m !== month).map(m => (
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
                const monthLabels = yearMonths.map(({ month: m }) => SHORT_MONTHS[m - 1]).join(", ");
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

      {saving && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-foreground text-background text-[13px] font-medium px-4 py-2 rounded-full shadow-lg z-50">
          กำลังบันทึก...
        </div>
      )}
    </div>
  );
}

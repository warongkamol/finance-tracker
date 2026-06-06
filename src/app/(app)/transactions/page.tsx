"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Search, Trash2, Pencil, AlertCircle, Clock, Loader2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionForm } from "@/components/forms/transaction-form";
import { formatCurrency, formatShortDate, getMonthName, getCurrentMonth, cn } from "@/lib/utils";
import Link from "next/link";

interface UpcomingPayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amount: string;
  status: "PENDING" | "PAID" | "OVERDUE";
  isOverdue: boolean;
  debt: { id: string; name: string };
  transaction: { id: string } | null;
}

interface Transaction {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: string;
  description: string | null;
  date: string;
  categoryId: string;
  category: { id: string; name: string; icon: string | null; color: string | null };
  paymentMethodId: string | null;
  paymentMethod: { id: string; name: string } | null;
  debtPaymentId: string | null;
  debtPayment: { id: string; installmentNo: number; debt: { id: string; name: string } } | null;
}

interface Summary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

type FilterType = "ALL" | "INCOME" | "EXPENSE";

function groupByDate(transactions: Transaction[]): Record<string, Transaction[]> {
  return transactions.reduce<Record<string, Transaction[]>>((acc, tx) => {
    const key = tx.date.slice(0, 10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(tx);
    return acc;
  }, {});
}

function TransactionSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="ios-card p-4 animate-pulse">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-full bg-border/50 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-border/50 rounded-full w-28" />
              <div className="h-3 bg-border/50 rounded-full w-20" />
            </div>
            <div className="h-4 bg-border/50 rounded-full w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TransactionsPage() {
  const now = getCurrentMonth();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [upcomingPayments, setUpcomingPayments] = useState<UpcomingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        year: String(year),
        month: String(month),
        ...(filter !== "ALL" && { type: filter }),
        ...(debouncedSearch && { search: debouncedSearch }),
      });

      const [txRes, sumRes, upRes] = await Promise.all([
        fetch(`/api/v1/transactions?${qs}`),
        fetch(`/api/v1/transactions/summary?year=${year}&month=${month}`),
        fetch(`/api/v1/debts/upcoming?year=${year}&month=${month}`),
      ]);

      const [txData, sumData, upData] = await Promise.all([txRes.json(), sumRes.json(), upRes.json()]);
      if (txData.success) setTransactions(txData.data);
      if (sumData.success) setSummary(sumData.data);
      if (upData.success) setUpcomingPayments(upData.data);
    } finally {
      setLoading(false);
    }
  }, [year, month, filter, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1);
  }

  async function handleDelete() {
    if (!deletingTx) return;
    setDeleteLoading(true);
    try {
      await fetch(`/api/v1/transactions/${deletingTx.id}`, { method: "DELETE" });
      setDeletingTx(null);
      fetchData();
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handlePayInstallment(payment: UpcomingPayment) {
    setPayingId(payment.id);
    try {
      const res = await fetch(`/api/v1/debts/${payment.debt.id}/payments/${payment.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if ((await res.json()).success) fetchData();
    } finally {
      setPayingId(null);
    }
  }

  const pendingPayments = upcomingPayments.filter((p) => p.status !== "PAID");
  const grouped = groupByDate(transactions);
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="py-5 space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between px-1">
        <button onClick={prevMonth} className="h-8 w-8 rounded-full hover:bg-card flex items-center justify-center active:scale-90 transition-all">
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <span className="text-[16px] font-semibold">{getMonthName(month)} {year}</span>
        <button onClick={nextMonth} className="h-8 w-8 rounded-full hover:bg-card flex items-center justify-center active:scale-90 transition-all">
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="ios-card p-1 grid grid-cols-3 gap-1">
          {[
            { label: "รายรับ", value: summary.totalIncome, color: "#34C759" },
            { label: "รายจ่าย", value: summary.totalExpense, color: "#FF3B30" },
            { label: "คงเหลือ", value: summary.balance, color: summary.balance >= 0 ? "#007AFF" : "#FF9500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl py-2.5 px-2 text-center">
              <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{label}</p>
              <p className="text-[13px] font-bold tabular-nums truncate" style={{ color }}>{formatCurrency(value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-10 rounded-xl"
          placeholder="ค้นหารายการ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter */}
      <div className="ios-card p-1 grid grid-cols-3 gap-1">
        {(["ALL", "EXPENSE", "INCOME"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold transition-all",
              filter === f ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}
          >
            {f === "ALL" ? "ทั้งหมด" : f === "INCOME" ? "รายรับ" : "รายจ่าย"}
          </button>
        ))}
      </div>

      {/* Pending installments */}
      {pendingPayments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">รายการผ่อนเดือนนี้</p>
            <Link href="/debts" className="text-[13px] text-primary font-medium">ดูทั้งหมด</Link>
          </div>
          <div className="ios-card overflow-hidden divide-y divide-border/50">
            {pendingPayments.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                {p.isOverdue
                  ? <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  : <Clock className="h-4 w-4 text-[#FF9500] shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate">{p.debt.name}</p>
                  <p className="text-[12px] text-muted-foreground">งวดที่ {p.installmentNo} · ครบ {formatShortDate(p.dueDate)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(Number(p.amount))}</p>
                  <button
                    className={cn(
                      "text-[12px] font-semibold px-3 py-1 rounded-full transition-all active:scale-95",
                      p.isOverdue ? "bg-destructive text-white" : "bg-primary text-white"
                    )}
                    disabled={payingId === p.id}
                    onClick={() => handlePayInstallment(p)}
                  >
                    {payingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "จ่าย"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction list */}
      {loading ? (
        <TransactionSkeleton />
      ) : transactions.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-[16px] font-medium text-foreground">ยังไม่มีรายการ</p>
          <p className="text-[14px] text-muted-foreground mt-1">กด + เพื่อบันทึกรายการแรก</p>
        </div>
      ) : (
        <div className="space-y-5">
          {sortedDates.map((date) => (
            <div key={date}>
              <p className="text-[13px] font-semibold text-muted-foreground px-1 mb-2">{formatShortDate(date)}</p>
              <div className="ios-card overflow-hidden divide-y divide-border/50">
                {grouped[date].map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                    {/* Icon */}
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center text-[18px] shrink-0"
                      style={{ backgroundColor: tx.category.color ? `${tx.category.color}18` : "var(--muted)" }}
                    >
                      {tx.category.icon ?? (tx.type === "INCOME" ? "💰" : "💸")}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[14px] font-medium truncate">{tx.category.name}</p>
                        {tx.debtPayment && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FF9500]/15 text-[#FF9500]">
                            💳 งวด {tx.debtPayment.installmentNo}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground truncate">
                        {tx.debtPayment ? tx.debtPayment.debt.name : (tx.description ?? tx.paymentMethod?.name ?? "")}
                      </p>
                    </div>

                    {/* Amount */}
                    <p className={cn(
                      "text-[15px] font-semibold tabular-nums shrink-0",
                      tx.type === "INCOME" ? "text-[#34C759]" : "text-foreground"
                    )}>
                      {tx.type === "INCOME" ? "+" : "−"}{formatCurrency(parseFloat(tx.amount))}
                    </p>

                    {/* Actions */}
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        onClick={() => { setEditingTx(tx); setSheetOpen(true); }}
                        className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingTx(tx)}
                        className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => { setEditingTx(null); setSheetOpen(true); }}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="บันทึกรายการใหม่"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* Form sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent title={editingTx ? "แก้ไขรายการ" : "บันทึกรายการ"}>
          <TransactionForm
            defaultValues={editingTx ?? undefined}
            onSuccess={() => { setSheetOpen(false); fetchData(); }}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete dialog */}
      <Dialog open={!!deletingTx} onOpenChange={(open) => { if (!open) setDeletingTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบรายการ</DialogTitle>
            <DialogDescription>
              ยืนยันการลบ &quot;{deletingTx?.category.name}&quot; {formatCurrency(parseFloat(deletingTx?.amount ?? "0"))}?
            </DialogDescription>
          </DialogHeader>

          {/* Warning if linked to debt payment */}
          {deletingTx?.debtPayment && (
            <div className="flex gap-2.5 rounded-xl bg-[#FF9500]/10 border border-[#FF9500]/30 px-4 py-3">
              <AlertCircle className="h-4 w-4 text-[#FF9500] shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] font-semibold text-[#FF9500]">รายการนี้เชื่อมกับหนี้สิน</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  ลบแล้ว งวดที่ {deletingTx.debtPayment.installmentNo} ของ &quot;{deletingTx.debtPayment.debt.name}&quot; จะกลับเป็น <strong>ยังไม่ได้จ่าย</strong> โดยอัตโนมัติ
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setDeletingTx(null)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "กำลังลบ..." : "ลบรายการ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

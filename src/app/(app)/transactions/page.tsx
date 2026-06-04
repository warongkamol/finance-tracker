"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Search, Trash2, Pencil } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TransactionForm } from "@/components/forms/transaction-form";
import { formatCurrency, formatShortDate, getMonthName, getCurrentMonth } from "@/lib/utils";
import { cn } from "@/lib/utils";

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
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-background animate-pulse">
          <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-muted rounded w-24" />
            <div className="h-3 bg-muted rounded w-16" />
          </div>
          <div className="h-4 bg-muted rounded w-20" />
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
  const [loading, setLoading] = useState(true);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  // Delete confirmation
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Debounce search
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

      const [txRes, sumRes] = await Promise.all([
        fetch(`/api/v1/transactions?${qs}`),
        fetch(`/api/v1/transactions/summary?year=${year}&month=${month}`),
      ]);

      const txData = await txRes.json();
      const sumData = await sumRes.json();

      if (txData.success) setTransactions(txData.data);
      if (sumData.success) setSummary(sumData.data);
    } finally {
      setLoading(false);
    }
  }, [year, month, filter, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function openCreate() {
    setEditingTx(null);
    setSheetOpen(true);
  }

  function openEdit(tx: Transaction) {
    setEditingTx(tx);
    setSheetOpen(true);
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

  const grouped = groupByDate(transactions);
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="py-4 space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-2 rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-semibold text-base">
          {getMonthName(month)} {year}
        </span>
        <button onClick={nextMonth} className="p-2 rounded-full hover:bg-muted transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-green-50 dark:bg-green-950/30 rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">รายรับ</p>
            <p className="text-sm font-bold text-green-600 truncate">{formatCurrency(summary.totalIncome)}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">รายจ่าย</p>
            <p className="text-sm font-bold text-red-500 truncate">{formatCurrency(summary.totalExpense)}</p>
          </div>
          <div className={cn(
            "rounded-xl p-3 text-center",
            summary.balance >= 0 ? "bg-blue-50 dark:bg-blue-950/30" : "bg-orange-50 dark:bg-orange-950/30"
          )}>
            <p className="text-xs text-muted-foreground mb-1">คงเหลือ</p>
            <p className={cn(
              "text-sm font-bold truncate",
              summary.balance >= 0 ? "text-blue-600" : "text-orange-500"
            )}>
              {formatCurrency(summary.balance)}
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="ค้นหารายการ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5">
        {(["ALL", "EXPENSE", "INCOME"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border",
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "ALL" ? "ทั้งหมด" : f === "INCOME" ? "รายรับ" : "รายจ่าย"}
          </button>
        ))}
      </div>

      {/* Transaction list */}
      {loading ? (
        <TransactionSkeleton />
      ) : transactions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-3xl mb-3">📭</p>
          <p className="text-sm">ยังไม่มีรายการในเดือนนี้</p>
          <p className="text-xs mt-1">กด + เพื่อบันทึกรายการแรก</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((date) => (
            <div key={date}>
              <p className="text-xs font-medium text-muted-foreground mb-2 sticky top-14 bg-muted/20 py-1">
                {formatShortDate(date)}
              </p>
              <div className="space-y-2">
                {grouped[date].map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/50"
                  >
                    {/* Category icon */}
                    <div
                      className="h-9 w-9 rounded-full flex items-center justify-center text-base shrink-0"
                      style={{ backgroundColor: tx.category.color ? `${tx.category.color}20` : undefined }}
                    >
                      {tx.category.icon ?? (tx.type === "INCOME" ? "💰" : "💸")}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.category.name}</p>
                      {tx.description && (
                        <p className="text-xs text-muted-foreground truncate">{tx.description}</p>
                      )}
                      {tx.paymentMethod && (
                        <p className="text-xs text-muted-foreground truncate">
                          {tx.paymentMethod.name}
                        </p>
                      )}
                    </div>

                    {/* Amount */}
                    <div className="text-right shrink-0">
                      <p className={cn(
                        "text-sm font-semibold",
                        tx.type === "INCOME" ? "text-green-600" : "text-red-500"
                      )}>
                        {tx.type === "INCOME" ? "+" : "-"}{formatCurrency(parseFloat(tx.amount))}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(tx)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingTx(tx)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
        onClick={openCreate}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="บันทึกรายการใหม่"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Transaction form sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent title={editingTx ? "แก้ไขรายการ" : "บันทึกรายการ"}>
          <TransactionForm
            defaultValues={editingTx ?? undefined}
            onSuccess={() => {
              setSheetOpen(false);
              fetchData();
            }}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletingTx} onOpenChange={(open) => { if (!open) setDeletingTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบรายการ</DialogTitle>
            <DialogDescription>
              ยืนยันการลบ &quot;{deletingTx?.category.name}&quot; {formatCurrency(parseFloat(deletingTx?.amount ?? "0"))}?
              การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeletingTx(null)} disabled={deleteLoading}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "กำลังลบ..." : "ลบรายการ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

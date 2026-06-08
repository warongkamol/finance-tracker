"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ChevronRight, AlertCircle } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DebtForm } from "@/components/forms/debt-form";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import Link from "next/link";

interface DebtPaymentSummary {
  id: string;
  status: "PENDING" | "PAID" | "OVERDUE";
  amount: string;
  dueDate: string;
  installmentNo: number;
}

interface Debt {
  id: string;
  name: string;
  totalAmount: string;
  monthlyAmount: string;
  totalMonths: number;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  payments: DebtPaymentSummary[];
  remainingBalance: number;
  paidCount: number;
  overdueCount: number;
}

interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}

type TabType = "ACTIVE" | "COMPLETED" | "CANCELLED";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

function DebtSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}

function ProgressBar({ paid, total }: { paid: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((paid / total) * 100);
  return (
    <div className="w-full bg-border/60 rounded-full h-1.5 mt-2">
      <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function DebtsPage() {
  const [tab, setTab] = useState<TabType>("ACTIVE");
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deletingDebt, setDeletingDebt] = useState<Debt | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [inFamilyGroup, setInFamilyGroup] = useState(false);
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([]);

  const fetchDebts = useCallback(async () => {
    setLoading(true);
    try {
      const [debtRes, familyRes] = await Promise.all([
        fetch(`/api/v1/debts?status=${tab}`),
        fetch("/api/v1/family"),
      ]);
      const [debtData, familyData] = await Promise.all([debtRes.json(), familyRes.json()]);
      if (debtData.success) setDebts(debtData.data);
      if (familyData.success) {
        setFamilyGroups(familyData.data.groups);
        setInFamilyGroup(familyData.data.groups.length > 0);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchDebts(); }, [fetchDebts]);

  async function handleDelete() {
    if (!deletingDebt) return;
    setDeleteLoading(true);
    try {
      await fetch(`/api/v1/debts/${deletingDebt.id}`, { method: "DELETE" });
      setDeletingDebt(null);
      fetchDebts();
    } finally {
      setDeleteLoading(false);
    }
  }

  const activeDebts = debts.filter((d) => d.status === "ACTIVE");
  const totalRemaining = activeDebts.reduce((sum, d) => sum + d.remainingBalance, 0);

  return (
    <div className="py-5 space-y-5">
      {/* Hero balance */}
      {tab === "ACTIVE" && (
        <div className="ios-card px-5 py-5">
          <p className="text-[13px] font-medium text-muted-foreground">ยอดหนี้คงค้างทั้งหมด</p>
          <p className="text-[36px] font-bold text-[#FF9500] tabular-nums tracking-tight mt-0.5">
            {formatCurrency(totalRemaining)}
          </p>
          <p className="text-[13px] text-muted-foreground mt-1">{activeDebts.length} รายการที่กำลังผ่อน</p>
        </div>
      )}

      {/* Tabs */}
      <div className="ios-card p-1 grid grid-cols-3 gap-1">
        {(["ACTIVE", "COMPLETED", "CANCELLED"] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "py-1.5 rounded-xl text-[13px] font-semibold transition-all",
              tab === t ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
            )}
          >
            {t === "ACTIVE" ? "กำลังผ่อน" : t === "COMPLETED" ? "ชำระครบ" : "ยกเลิก"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <DebtSkeleton />
      ) : debts.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">💳</p>
          <p className="text-[16px] font-medium">
            {tab === "ACTIVE" ? "ยังไม่มีรายการผ่อนชำระ" : "ไม่มีรายการในหมวดนี้"}
          </p>
          {tab === "ACTIVE" && <p className="text-[14px] text-muted-foreground mt-1">กด + เพื่อเพิ่มรายการผ่อน</p>}
        </div>
      ) : (
        <div className="ios-card overflow-hidden divide-y divide-border/50">
          {debts.map((debt) => (
            <Link key={debt.id} href={`/debts/${debt.id}`}>
              <div className="px-4 py-4 active:bg-muted/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-[15px] font-semibold truncate">{debt.name}</p>
                      {debt.overdueCount > 0 && (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      )}
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      {formatCurrency(Number(debt.monthlyAmount))} / เดือน · {debt.paidCount}/{debt.totalMonths} งวด
                    </p>
                    <ProgressBar paid={debt.paidCount} total={debt.totalMonths} />
                  </div>

                  <div className="text-right shrink-0 flex items-center gap-1">
                    <div>
                      <p className="text-[15px] font-bold text-[#FF9500] tabular-nums">
                        {formatCurrency(debt.remainingBalance)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">คงเหลือ</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
                  </div>
                </div>

                <div className="flex justify-between mt-2">
                  <p className="text-[12px] text-muted-foreground">เริ่ม {formatDate(debt.startDate)}</p>
                  <p className="text-[12px] text-muted-foreground">ครบ {formatDate(debt.endDate)}</p>
                </div>

                {debt.overdueCount > 0 && (
                  <p className="text-[12px] text-destructive font-medium mt-1.5">เลยกำหนด {debt.overdueCount} งวด</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* FAB */}
      {tab === "ACTIVE" && (
        <button
          onClick={() => setSheetOpen(true)}
          className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
          aria-label="เพิ่มรายการผ่อน"
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent title="เพิ่มรายการผ่อนชำระ">
          <DebtForm
            onSuccess={() => { setSheetOpen(false); fetchDebts(); }}
            onCancel={() => setSheetOpen(false)}
            inFamilyGroup={inFamilyGroup}
            familyGroups={familyGroups}
          />
        </SheetContent>
      </Sheet>

      <Dialog open={!!deletingDebt} onOpenChange={(open) => { if (!open) setDeletingDebt(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบรายการผ่อน</DialogTitle>
            <DialogDescription>
              ยืนยันการลบ &quot;{deletingDebt?.name}&quot;?
              หากมีงวดที่ชำระแล้ว รายการจะถูกยกเลิกแทน
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setDeletingDebt(null)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "กำลังดำเนินการ..." : "ยืนยัน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

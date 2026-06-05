"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency, formatDate, formatShortDate, cn } from "@/lib/utils";

interface DebtPayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amount: string;
  status: "PENDING" | "PAID" | "OVERDUE";
  paidDate: string | null;
  transaction: { id: string } | null;
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
  payments: DebtPayment[];
  paidCount: number;
  remainingBalance: number;
}

export default function DebtDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [debt, setDebt] = useState<Debt | null>(null);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [confirmPay, setConfirmPay] = useState<DebtPayment | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchDebt = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/debts/${id}`);
      const data = await res.json();
      if (data.success) setDebt(data.data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDebt(); }, [fetchDebt]);

  async function handlePay(payment: DebtPayment) {
    setPayingId(payment.id);
    setConfirmPay(null);
    try {
      const res = await fetch(`/api/v1/debts/${id}/payments/${payment.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if ((await res.json()).success) await fetchDebt();
    } finally {
      setPayingId(null);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/v1/debts/${id}`, { method: "DELETE" });
      if ((await res.json()).success) router.push("/debts");
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!debt) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-3">❌</p>
        <p className="text-[15px] text-muted-foreground">ไม่พบรายการหนี้สิน</p>
        <Button variant="ghost" className="mt-4 text-primary" onClick={() => router.push("/debts")}>กลับ</Button>
      </div>
    );
  }

  const pct = debt.totalMonths > 0 ? Math.round((debt.paidCount / debt.totalMonths) * 100) : 0;

  return (
    <div className="py-5 space-y-5">
      {/* Back + title */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/debts")}
          className="h-9 w-9 rounded-full bg-card flex items-center justify-center active:scale-90 transition-all shadow-sm"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <div className="flex-1 min-w-0 ml-1">
          <h1 className="text-[18px] font-bold truncate leading-tight">{debt.name}</h1>
          <p className="text-[13px] text-muted-foreground">
            {debt.status === "ACTIVE" ? "กำลังผ่อน" : debt.status === "COMPLETED" ? "ชำระครบแล้ว ✓" : "ยกเลิก"}
          </p>
        </div>
        <button
          onClick={() => setDeleteDialogOpen(true)}
          className="h-9 w-9 rounded-full bg-card flex items-center justify-center text-muted-foreground hover:text-destructive active:scale-90 transition-all shadow-sm"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Summary card */}
      <div className="ios-card px-5 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[12px] text-muted-foreground mb-0.5">ยอดทั้งหมด</p>
            <p className="text-[17px] font-bold tabular-nums">{formatCurrency(Number(debt.totalAmount))}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground mb-0.5">ยอดคงค้าง</p>
            <p className="text-[17px] font-bold text-[#FF9500] tabular-nums">{formatCurrency(debt.remainingBalance)}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground mb-0.5">งวดละ</p>
            <p className="text-[17px] font-bold tabular-nums">{formatCurrency(Number(debt.monthlyAmount))}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground mb-0.5">ความคืบหน้า</p>
            <p className="text-[17px] font-bold">{debt.paidCount}/{debt.totalMonths} งวด</p>
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-[12px] text-muted-foreground">{pct}% ชำระแล้ว</span>
            <span className="text-[12px] text-muted-foreground">{debt.totalMonths - debt.paidCount} งวดเหลือ</span>
          </div>
          <div className="w-full bg-border/60 rounded-full h-2">
            <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex justify-between text-[12px] text-muted-foreground pt-1 border-t border-border/50">
          <span>เริ่ม {formatDate(debt.startDate)}</span>
          <span>ครบ {formatDate(debt.endDate)}</span>
        </div>

        {debt.notes && (
          <p className="text-[13px] text-muted-foreground">{debt.notes}</p>
        )}
      </div>

      {/* Payment schedule */}
      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-1">ตารางผ่อนชำระ</p>

        <div className="ios-card overflow-hidden divide-y divide-border/50">
          {debt.payments.map((payment) => (
            <div
              key={payment.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5",
                payment.status === "PAID" && "opacity-60"
              )}
            >
              {/* Status icon */}
              <div className="shrink-0">
                {payment.status === "PAID" ? (
                  <CheckCircle2 className="h-5 w-5 text-[#34C759]" />
                ) : payment.status === "OVERDUE" ? (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <Clock className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium">งวดที่ {payment.installmentNo}</p>
                <p className="text-[12px] text-muted-foreground">
                  {payment.status === "PAID" && payment.paidDate
                    ? `ชำระ ${formatShortDate(payment.paidDate)}`
                    : `ครบกำหนด ${formatShortDate(payment.dueDate)}`}
                </p>
              </div>

              {/* Amount + action */}
              <div className="flex items-center gap-2 shrink-0">
                <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(Number(payment.amount))}</p>
                {payment.status !== "PAID" && debt.status === "ACTIVE" && (
                  <button
                    className={cn(
                      "text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all active:scale-95",
                      payment.status === "OVERDUE" ? "bg-destructive text-white" : "bg-primary text-white"
                    )}
                    disabled={payingId === payment.id}
                    onClick={() => setConfirmPay(payment)}
                  >
                    {payingId === payment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "จ่าย"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm pay */}
      <Dialog open={!!confirmPay} onOpenChange={(open) => { if (!open) setConfirmPay(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการชำระงวด</DialogTitle>
            <DialogDescription>
              บันทึกการชำระงวดที่ {confirmPay?.installmentNo} จำนวน{" "}
              {formatCurrency(Number(confirmPay?.amount))}?{"\n"}
              ระบบจะสร้างรายการรายจ่ายให้อัตโนมัติ
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setConfirmPay(null)}>ยกเลิก</Button>
            <Button onClick={() => confirmPay && handlePay(confirmPay)} disabled={!!payingId}>
              {payingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยันชำระ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบรายการผ่อน</DialogTitle>
            <DialogDescription>
              ยืนยันการลบ &quot;{debt.name}&quot;?
              หากมีงวดที่ชำระแล้ว รายการจะถูกยกเลิกแทน
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "กำลังดำเนินการ..." : "ยืนยัน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

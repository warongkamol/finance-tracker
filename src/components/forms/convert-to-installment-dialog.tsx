"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check } from "lucide-react";
import { cn, formatCurrency, formatShortDate } from "@/lib/utils";

interface ConvertibleTransaction {
  id: string;
  date: string;
  description: string | null;
  amount: string;
  category: { id: string; name: string } | null;
}

interface ConvertToInstallmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    date: string;
    description: string | null;
    amount: number;
    accountId: string;
    categoryName: string;
  };
  tier: "FREE" | "PRO";
  onConverted: () => void;
}

export function ConvertToInstallmentDialog({
  open,
  onOpenChange,
  transaction,
  tier,
  onConverted,
}: ConvertToInstallmentDialogProps) {
  const [totalMonths, setTotalMonths] = useState("3");
  const [name, setName] = useState("");
  const [rateValue, setRateValue] = useState("0");
  const [rateUnit, setRateUnit] = useState<"month" | "year">("month");
  const [showMore, setShowMore] = useState(false);
  const [convertible, setConvertible] = useState<ConvertibleTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTotalMonths("3");
      setRateValue("0");
      setRateUnit("month");
      setShowMore(false);
      setSelectedIds([]);
      setError("");
      setName(`ผ่อน: ${transaction.description || transaction.categoryName}`);
    }
  }, [open, transaction]);

  async function loadConvertible() {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/debts/convertible-transactions?accountId=${transaction.accountId}&excludeId=${transaction.id}`
      );
      const json = await res.json();
      if (json.success) setConvertible(json.data);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleShowMore() {
    const next = !showMore;
    setShowMore(next);
    if (next && convertible.length === 0) loadConvertible();
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const totalMonthsNum = parseInt(totalMonths, 10) || 0;
  const rateValueNum = parseFloat(rateValue) || 0;
  const monthlyRatePercent = tier === "PRO" ? (rateUnit === "year" ? rateValueNum / 12 : rateValueNum) : 0;

  const principal =
    transaction.amount +
    convertible
      .filter((t) => selectedIds.includes(t.id))
      .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalAmount = totalMonthsNum > 0 ? principal * (1 + (monthlyRatePercent / 100) * totalMonthsNum) : 0;
  const monthlyAmount = totalMonthsNum > 0 ? totalAmount / totalMonthsNum : 0;

  async function handleSubmit() {
    setError("");
    if (totalMonthsNum < 1 || totalMonthsNum > 360) {
      setError("จำนวนเดือนต้องอยู่ระหว่าง 1-360");
      return;
    }
    if (!name.trim()) {
      setError("กรุณาใส่ชื่อรายการ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/debts/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds: [transaction.id, ...selectedIds],
          totalMonths: totalMonthsNum,
          interestRate: monthlyRatePercent > 0 ? monthlyRatePercent : null,
          name: name.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "เกิดข้อผิดพลาด");
        return;
      }
      onConverted();
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แบ่งชำระรายเดือน</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="ios-card px-4 py-3 text-[13px]">
            <div className="flex justify-between text-muted-foreground">
              <span>{formatShortDate(transaction.date)}</span>
              <span>{transaction.categoryName}</span>
            </div>
            <div className="mt-1 text-[16px] font-semibold">{formatCurrency(transaction.amount)}</div>
            {transaction.description && (
              <div className="text-muted-foreground">{transaction.description}</div>
            )}
          </div>

          <div>
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">จำนวนเดือน</label>
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              max="360"
              className="mt-1 bg-input h-11 rounded-xl border-0"
              value={totalMonths}
              onChange={(e) => setTotalMonths(e.target.value)}
            />
          </div>

          {tier === "PRO" ? (
            <div>
              <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">อัตราดอกเบี้ย (ไม่บังคับ)</label>
              <div className="mt-1 flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="bg-input h-11 rounded-xl border-0 flex-1"
                  value={rateValue}
                  onChange={(e) => setRateValue(e.target.value)}
                />
                <div className="ios-card p-1 grid grid-cols-2 gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRateUnit("month")}
                    className={cn("px-3 h-9 rounded-lg text-[13px] font-medium", rateUnit === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    ต่อเดือน
                  </button>
                  <button
                    type="button"
                    onClick={() => setRateUnit("year")}
                    className={cn("px-3 h-9 rounded-lg text-[13px] font-medium", rateUnit === "year" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                  >
                    ต่อปี
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              ใส่ดอกเบี้ย / รวมหลายรายการ → อัพเกรด Pro
            </p>
          )}

          {tier === "PRO" && (
            <div>
              <button type="button" onClick={toggleShowMore} className="text-[13px] font-medium text-primary">
                {showMore ? "− ซ่อนรายการอื่น" : "+ เลือกรายการอื่นที่จะรวมผ่อนด้วย"}
              </button>

              {showMore && (
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {loadingMore ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : convertible.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground py-2">ไม่มีรายการอื่นในบัญชีนี้</p>
                  ) : (
                    convertible.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleSelected(t.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-input text-left"
                      >
                        <div
                          className={cn(
                            "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0",
                            selectedIds.includes(t.id) ? "bg-primary border-primary" : "border-muted-foreground/40"
                          )}
                        >
                          {selectedIds.includes(t.id) && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{t.description || t.category?.name || "อื่นๆ"}</div>
                          <div className="text-[12px] text-muted-foreground">{formatShortDate(t.date)}</div>
                        </div>
                        <div className="text-[13px] font-semibold">{formatCurrency(Number(t.amount))}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">ชื่อรายการหนี้</label>
            <Input
              className="mt-1 bg-input h-11 rounded-xl border-0"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="ios-card px-4 py-3 space-y-1 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ยอดรวม</span>
              <span className="font-semibold">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ยอดผ่อน/เดือน</span>
              <span className="font-semibold">{formatCurrency(monthlyAmount)}</span>
            </div>
          </div>

          {error && <p className="text-[13px] text-destructive text-center">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
            ยกเลิก
          </Button>
          <Button type="button" className="flex-1" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            ยืนยัน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

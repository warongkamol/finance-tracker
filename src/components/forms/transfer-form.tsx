"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { transferSchema } from "@/lib/validations/account";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

// Use output type so RHF generic is fully resolved
type TransferFormValues = z.output<typeof transferSchema>;

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
}

interface TransferFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultFromAccountId?: string;
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function FormRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

export function TransferForm({ open, onClose, onSuccess, defaultFromAccountId }: TransferFormProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: defaultFromAccountId ?? "",
      toAccountId: "",
      amount: undefined,
      date: todayString(),
      note: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then((d) => { if (d.success) setAccounts(d.data); });
  }, [open]);

  async function onSubmit(data: TransferFormValues) {
    setServerError("");
    try {
      const res = await fetch("/api/v1/accounts/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) { setServerError(json.error?.message ?? "เกิดข้อผิดพลาด"); return; }
      onSuccess();
      onClose();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  const watchedFrom = watch("fromAccountId");
  const watchedTo = watch("toAccountId");
  const fromBalance = accounts.find((a) => a.id === watchedFrom)?.balance;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title="โอนเงินระหว่างกระเป๋า">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <FormRow label="จากบัญชี" error={errors.fromAccountId?.message}>
            <Select value={watchedFrom} onValueChange={(v) => setValue("fromAccountId", v)}>
              <SelectTrigger className="ios-card">
                <SelectValue placeholder="เลือกบัญชีต้นทาง" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.id === watchedTo}>
                    {TYPE_EMOJI[a.type] ?? "💰"} {a.name}
                    {a.id === watchedFrom && fromBalance !== undefined
                      ? ` (฿${fromBalance.toLocaleString("th-TH", { minimumFractionDigits: 2 })})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label="ไปยังบัญชี" error={errors.toAccountId?.message}>
            <Select value={watchedTo} onValueChange={(v) => setValue("toAccountId", v)}>
              <SelectTrigger className="ios-card">
                <SelectValue placeholder="เลือกบัญชีปลายทาง" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.id === watchedFrom}>
                    {TYPE_EMOJI[a.type] ?? "💰"} {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label="จำนวนเงิน (฿)" error={errors.amount?.message}>
            <Input
              {...register("amount", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              className="ios-card"
            />
          </FormRow>

          <FormRow label="วันที่" error={errors.date?.message}>
            <Input {...register("date")} type="date" className="ios-card" />
          </FormRow>

          <FormRow label="หมายเหตุ (ไม่บังคับ)">
            <Input {...register("note")} placeholder="เช่น เก็บเงินเที่ยว" className="ios-card" />
          </FormRow>

          {serverError && <p className="text-[13px] text-destructive text-center">{serverError}</p>}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยันโอน"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

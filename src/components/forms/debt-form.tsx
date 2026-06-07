"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createDebtSchema, type CreateDebtInput } from "@/lib/validations/debt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface DebtFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  inFamilyGroup?: boolean;
}

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

const fieldClass = "bg-input h-11 rounded-xl border-0";

export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false }: DebtFormProps) {
  const [serverError, setServerError] = useState("");
  const [useCustomMonthly, setUseCustomMonthly] = useState(false);
  const [isFamily, setIsFamily] = useState(false);

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CreateDebtInput>({
    resolver: zodResolver(createDebtSchema),
    defaultValues: { startDate: todayString(), totalMonths: 12 },
  });

  const totalAmount = watch("totalAmount");
  const totalMonths = watch("totalMonths");
  const autoMonthly = totalAmount && totalMonths && totalMonths > 0
    ? (totalAmount / totalMonths).toFixed(2)
    : null;

  async function onSubmit(data: CreateDebtInput) {
    setServerError("");
    try {
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        isFamily,
      };
      const res = await fetch("/api/v1/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) { setServerError(json.error?.message ?? "เกิดข้อผิดพลาด"); return; }
      onSuccess();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Amount hero */}
      <div className="ios-card px-5 py-4">
        <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">ยอดเงินทั้งหมด (บาท)</label>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          className={cn("mt-1 bg-transparent px-0 h-12 text-[28px] font-bold focus-visible:ring-0 border-0 rounded-none text-[#FF9500]", errors.totalAmount && "text-destructive")}
          {...register("totalAmount", { valueAsNumber: true })}
        />
        {errors.totalAmount && <p className="text-[12px] text-destructive">{errors.totalAmount.message}</p>}
      </div>

      <div className="ios-card px-5 py-4 space-y-4">
        <FormRow label="ชื่อรายการ" error={errors.name?.message}>
          <Input placeholder="เช่น ผ่อน iPhone, Shopee PayLater" className={cn(fieldClass, errors.name && "ring-2 ring-destructive")} {...register("name")} />
        </FormRow>

        <FormRow label="จำนวนงวด (เดือน)" error={errors.totalMonths?.message}>
          <Input type="number" inputMode="numeric" min="1" max="360" placeholder="12" className={cn(fieldClass, errors.totalMonths && "ring-2 ring-destructive")} {...register("totalMonths", { valueAsNumber: true })} />
          {autoMonthly && !useCustomMonthly && (
            <p className="text-[12px] text-muted-foreground mt-1">ยอดต่องวดโดยประมาณ: ฿{autoMonthly}</p>
          )}
        </FormRow>

        {/* Custom monthly toggle */}
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <div
              className={cn("w-11 h-6 rounded-full transition-colors relative", useCustomMonthly ? "bg-primary" : "bg-border")}
              onClick={() => setUseCustomMonthly((v) => !v)}
            >
              <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", useCustomMonthly ? "translate-x-5.5" : "translate-x-0.5")} />
            </div>
            <span className="text-[14px] font-medium">กำหนดยอดต่องวดเอง</span>
          </label>

          {useCustomMonthly && (
            <FormRow label="ยอดต่องวด (บาท)" error={errors.monthlyAmount?.message}>
              <Input type="number" inputMode="decimal" step="0.01" min="0.01" placeholder="0.00" className={cn(fieldClass, errors.monthlyAmount && "ring-2 ring-destructive")} {...register("monthlyAmount", { valueAsNumber: true })} />
            </FormRow>
          )}
        </div>

        <FormRow label="วันที่เริ่มต้นจ่าย" error={errors.startDate?.message}>
          <Input type="date" className={cn(fieldClass, errors.startDate && "ring-2 ring-destructive")} {...register("startDate")} />
        </FormRow>

        <FormRow label="หมายเหตุ">
          <Input placeholder="เช่น บัตรกรุงไทย 0% ดอกเบี้ย" className={fieldClass} {...register("notes")} />
        </FormRow>

        {/* Family toggle — only shown when in a family group */}
        {inFamilyGroup && (
          <div className="pt-1 border-t border-border/40">
            <label className="flex items-center justify-between cursor-pointer select-none">
              <div>
                <p className="text-[14px] font-medium">หนี้สินครอบครัว</p>
                <p className="text-[12px] text-muted-foreground">แสดงในหน้าสรุปของทุกคนในกลุ่ม</p>
              </div>
              <button
                type="button"
                onClick={() => setIsFamily((v) => !v)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
                  isFamily ? "bg-[#AF52DE]" : "bg-border"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  isFamily ? "translate-x-5.5" : "translate-x-0.5"
                )} />
              </button>
            </label>
          </div>
        )}
      </div>

      {serverError && <p className="text-[14px] text-destructive text-center">{serverError}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          บันทึกหนี้สิน
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { recurringSchema, type RecurringInput } from "@/lib/validations/recurring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Category { id: string; name: string; type: string; icon?: string | null }
interface PaymentMethod { id: string; name: string }

interface RecurringFormProps {
  initial?: Partial<RecurringInput & { id: string }>;
  onSuccess: () => void;
  onCancel: () => void;
}

function todayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function addMonthsString(dateStr: string, months: number) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
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

export function RecurringForm({ initial, onSuccess, onCancel }: RecurringFormProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [serverError, setServerError] = useState("");
  const isEdit = !!initial?.id;

  const today = todayString();

  const { register, handleSubmit, watch, control, setValue, formState: { errors, isSubmitting } } = useForm<RecurringInput>({
    resolver: zodResolver(recurringSchema),
    defaultValues: {
      name: initial?.name ?? "",
      type: initial?.type ?? "EXPENSE",
      amount: initial?.amount ?? undefined,
      categoryId: initial?.categoryId ?? "",
      paymentMethodId: initial?.paymentMethodId ?? null,
      frequency: initial?.frequency ?? "MONTHLY",
      reminderDay: initial?.reminderDay ?? 1,
      isLastDayOfMonth: initial?.isLastDayOfMonth ?? false,
      startDate: initial?.startDate ?? today,
      endDate: initial?.endDate ?? addMonthsString(today, 12),
      notes: initial?.notes ?? "",
    },
  });

  const txType = watch("type");
  const isLastDay = watch("isLastDayOfMonth");
  const startDate = watch("startDate");

  useEffect(() => {
    fetch("/api/v1/categories").then(r => r.json()).then(d => {
      if (d.success) setCategories(d.data);
    });
    fetch("/api/v1/payment-methods").then(r => r.json()).then(d => {
      if (d.success) setPaymentMethods(d.data);
    });
  }, []);

  // reset categoryId when type changes
  useEffect(() => {
    if (!initial?.categoryId) setValue("categoryId", "");
  }, [txType, setValue, initial?.categoryId]);

  const filteredCats = categories.filter(c => c.type === txType);

  async function onSubmit(data: RecurringInput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/recurring/${initial!.id}` : "/api/v1/recurring";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) { setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่"); return; }
      onSuccess();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Amount hero */}
      <div className="ios-card px-5 py-4">
        <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">จำนวนเงิน (บาท)</label>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          className={cn("mt-1 bg-transparent px-0 h-12 text-[28px] font-bold focus-visible:ring-0 border-0 rounded-none",
            txType === "INCOME" ? "text-[#34C759]" : "text-[#FF3B30]",
            errors.amount && "text-destructive")}
          {...register("amount", { valueAsNumber: true })}
        />
        {errors.amount && <p className="text-[12px] text-destructive">{errors.amount.message}</p>}

        {/* Type toggle */}
        <div className="flex gap-2 mt-3">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <button key={t} type="button"
              onClick={() => setValue("type", t)}
              className={cn(
                "flex-1 py-1.5 rounded-xl text-[13px] font-semibold transition-all",
                txType === t
                  ? t === "INCOME" ? "bg-[#34C759] text-white" : "bg-[#FF3B30] text-white"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {t === "INCOME" ? "รายรับ" : "รายจ่าย"}
            </button>
          ))}
        </div>
      </div>

      <div className="ios-card px-5 py-4 space-y-4">
        <FormRow label="ชื่อรายการ" error={errors.name?.message}>
          <Input placeholder="เช่น เงินเดือน, ค่าเช่า, Netflix" className={cn(fieldClass, errors.name && "ring-2 ring-destructive")} {...register("name")} />
        </FormRow>

        <FormRow label="หมวดหมู่" error={errors.categoryId?.message}>
          <Controller name="categoryId" control={control} render={({ field }) => (
            <select {...field} className={cn(fieldClass, "w-full px-3 text-[15px]", errors.categoryId && "ring-2 ring-destructive")}>
              <option value="">-- เลือกหมวดหมู่ --</option>
              {filteredCats.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          )} />
        </FormRow>

        <FormRow label="ช่องทางชำระเงิน">
          <Controller name="paymentMethodId" control={control} render={({ field }) => (
            <select {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value || null)} className={cn(fieldClass, "w-full px-3 text-[15px]")}>
              <option value="">-- ไม่ระบุ --</option>
              {paymentMethods.map(pm => (
                <option key={pm.id} value={pm.id}>{pm.name}</option>
              ))}
            </select>
          )} />
        </FormRow>

        <FormRow label="ความถี่">
          <Controller name="frequency" control={control} render={({ field }) => (
            <div className="flex gap-2">
              {(["MONTHLY", "YEARLY"] as const).map((f) => (
                <button key={f} type="button"
                  onClick={() => field.onChange(f)}
                  className={cn(
                    "flex-1 h-11 rounded-xl text-[14px] font-medium transition-all",
                    field.value === f ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                  )}
                >
                  {f === "MONTHLY" ? "รายเดือน" : "รายปี"}
                </button>
              ))}
            </div>
          )} />
        </FormRow>

        {/* Reminder day */}
        <div className="space-y-2">
          <Controller name="isLastDayOfMonth" control={control} render={({ field }) => (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                className={cn("w-11 h-6 rounded-full transition-colors relative", field.value ? "bg-primary" : "bg-border")}
                onClick={() => field.onChange(!field.value)}
              >
                <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", field.value ? "translate-x-5.5" : "translate-x-0.5")} />
              </div>
              <span className="text-[14px] font-medium">แจ้งเตือนวันสุดท้ายของเดือน</span>
            </label>
          )} />

          {!isLastDay && (
            <FormRow label="วันที่แจ้งเตือนในเดือน (1–28)" error={errors.reminderDay?.message}>
              <Input type="number" inputMode="numeric" min="1" max="28" className={cn(fieldClass, errors.reminderDay && "ring-2 ring-destructive")} {...register("reminderDay", { valueAsNumber: true })} />
            </FormRow>
          )}
        </div>

        {/* Date range */}
        <FormRow label="วันที่เริ่มต้น" error={errors.startDate?.message}>
          <Input type="date" className={cn(fieldClass, errors.startDate && "ring-2 ring-destructive")} {...register("startDate")} />
        </FormRow>

        <FormRow label="วันที่สิ้นสุด (สูงสุด 12 เดือน)" error={errors.endDate?.message}>
          <Input type="date" min={startDate} max={addMonthsString(startDate || today, 12)} className={cn(fieldClass, errors.endDate && "ring-2 ring-destructive")} {...register("endDate")} />
        </FormRow>

        <FormRow label="หมายเหตุ">
          <Input placeholder="หมายเหตุเพิ่มเติม" className={fieldClass} {...register("notes")} />
        </FormRow>
      </div>

      {serverError && <p className="text-[14px] text-destructive text-center">{serverError}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "บันทึกการแก้ไข" : "เพิ่มแจ้งเตือน"}
        </Button>
      </div>
    </form>
  );
}

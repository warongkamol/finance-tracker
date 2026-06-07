"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createPaymentMethodSchema, type CreatePaymentMethodInput } from "@/lib/validations/payment-method";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type PaymentMethodType = CreatePaymentMethodInput["type"];

interface PaymentMethodFormInitial {
  id: string;
  name: string;
  type: PaymentMethodType;
}

interface PaymentMethodFormProps {
  initial?: PaymentMethodFormInitial;
  onSuccess: () => void;
  onCancel: () => void;
}

export const TYPE_LABELS: Record<PaymentMethodType, string> = {
  CASH: "เงินสด",
  QR_PAYMENT: "QR / พร้อมเพย์",
  BANK_TRANSFER: "โอนธนาคาร",
  CREDIT_CARD: "บัตรเครดิต",
  DEBIT_CARD: "บัตรเดบิต",
  PAY_LATER: "ผ่อนทีหลัง",
  OTHER: "อื่นๆ",
};

export const TYPE_ICONS: Record<PaymentMethodType, string> = {
  CASH: "💵",
  QR_PAYMENT: "📱",
  BANK_TRANSFER: "🏦",
  CREDIT_CARD: "💳",
  DEBIT_CARD: "💳",
  PAY_LATER: "🕒",
  OTHER: "📌",
};

const TYPE_ORDER: PaymentMethodType[] = ["CASH", "QR_PAYMENT", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "PAY_LATER", "OTHER"];

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

export function PaymentMethodForm({ initial, onSuccess, onCancel }: PaymentMethodFormProps) {
  const [serverError, setServerError] = useState("");
  const isEdit = !!initial?.id;

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<CreatePaymentMethodInput>({
    resolver: zodResolver(createPaymentMethodSchema),
    defaultValues: {
      name: initial?.name ?? "",
      type: initial?.type ?? "CASH",
    },
  });

  async function onSubmit(data: CreatePaymentMethodInput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/payment-methods/${initial!.id}` : "/api/v1/payment-methods";
      const body = { name: data.name, type: data.type };
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setServerError(json.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
        return;
      }
      onSuccess();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="ios-card px-5 py-4 space-y-4">
        <FormRow label="ชื่อช่องทางชำระเงิน" error={errors.name?.message}>
          <Input placeholder="เช่น บัญชีออมทรัพย์ SCB, บัตร The 1 Card" className={cn(fieldClass, errors.name && "ring-2 ring-destructive")} {...register("name")} />
        </FormRow>

        <FormRow label="ประเภท" error={errors.type?.message}>
          <Controller name="type" control={control} render={({ field }) => (
            <div className="grid grid-cols-2 gap-2">
              {TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => field.onChange(t)}
                  className={cn(
                    "flex items-center gap-2 h-11 px-3 rounded-xl text-[13px] font-medium transition-all text-left",
                    field.value === t ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                  )}
                >
                  <span className="text-[15px]">{TYPE_ICONS[t]}</span>
                  <span className="truncate">{TYPE_LABELS[t]}</span>
                </button>
              ))}
            </div>
          )} />
        </FormRow>
      </div>

      {serverError && <p className="text-[14px] text-destructive text-center">{serverError}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "บันทึกการแก้ไข" : "เพิ่มช่องทางชำระเงิน"}
        </Button>
      </div>
    </form>
  );
}

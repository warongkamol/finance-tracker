"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createAccountSchema } from "@/lib/validations/account";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

// Input type = what the form fields contain (before Zod defaults are applied)
type AccountFormInput = z.input<typeof createAccountSchema>;
// Output type = what Zod returns after parsing (with defaults filled in)
type AccountFormOutput = z.output<typeof createAccountSchema>;

interface ExistingAccount {
  id: string;
  name: string;
  type: string;
  initialBalance: number;
  creditLimit: number | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isDefault: boolean;
  sortOrder: number;
}

interface AccountFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialAccount?: ExistingAccount;
}

const ACCOUNT_TYPES = [
  { value: "CASH",         label: "เงินสด",    emoji: "💵" },
  { value: "BANK_ACCOUNT", label: "ธนาคาร",    emoji: "🏦" },
  { value: "SAVINGS",      label: "ออมทรัพย์",  emoji: "💰" },
  { value: "E_WALLET",     label: "E-Wallet",   emoji: "📱" },
  { value: "CREDIT_CARD",  label: "บัตรเครดิต", emoji: "💳" },
] as const;

function FormRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

export function AccountForm({ open, onClose, onSuccess, initialAccount }: AccountFormProps) {
  const isEdit = !!initialAccount;
  const [accountType, setAccountType] = useState<string>(initialAccount?.type ?? "CASH");
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<AccountFormInput, unknown, AccountFormOutput>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      name: initialAccount?.name ?? "",
      type: (initialAccount?.type as AccountFormInput["type"]) ?? "CASH",
      initialBalance: initialAccount?.initialBalance ?? 0,
      creditLimit: initialAccount?.creditLimit ?? undefined,
      statementDay: initialAccount?.statementDay ?? undefined,
      paymentDueDay: initialAccount?.paymentDueDay ?? undefined,
      isDefault: initialAccount?.isDefault ?? false,
      sortOrder: initialAccount?.sortOrder ?? 0,
    },
  });

  function handleTypeSelect(type: string) {
    setAccountType(type);
    setValue("type", type as AccountFormInput["type"]);
  }

  async function onSubmit(data: AccountFormOutput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/accounts/${initialAccount!.id}` : "/api/v1/accounts";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
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

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title={isEdit ? "แก้ไขบัญชี" : "เพิ่มบัญชีใหม่"}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <FormRow label="ประเภท">
            <div className="grid grid-cols-5 gap-1.5">
              {ACCOUNT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeSelect(t.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 rounded-xl text-center transition-all border",
                    accountType === t.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-transparent"
                  )}
                >
                  <span className="text-[18px]">{t.emoji}</span>
                  <span className="text-[10px] font-medium leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          </FormRow>

          <FormRow label="ชื่อบัญชี" error={errors.name?.message}>
            <Input {...register("name")} placeholder="เช่น เงินออม, UOB Preferred" className="ios-card" />
          </FormRow>

          <FormRow label="ยอดเริ่มต้น (฿)" error={errors.initialBalance?.message}>
            <Input
              {...register("initialBalance", { valueAsNumber: true })}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0"
              className="ios-card"
            />
          </FormRow>

          {accountType === "CREDIT_CARD" && (
            <>
              <FormRow label="วงเงินสินเชื่อ (฿)" error={errors.creditLimit?.message}>
                <Input
                  {...register("creditLimit", { valueAsNumber: true })}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  placeholder="50000"
                  className="ios-card"
                />
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="รอบบิลปิดวันที่" error={errors.statementDay?.message}>
                  <Input
                    {...register("statementDay", { valueAsNumber: true })}
                    type="number"
                    inputMode="numeric"
                    min={1} max={28}
                    placeholder="15"
                    className="ios-card"
                  />
                </FormRow>
                <FormRow label="ครบกำหนดชำระวันที่" error={errors.paymentDueDay?.message}>
                  <Input
                    {...register("paymentDueDay", { valueAsNumber: true })}
                    type="number"
                    inputMode="numeric"
                    min={1} max={28}
                    placeholder="5"
                    className="ios-card"
                  />
                </FormRow>
              </div>
            </>
          )}

          {serverError && <p className="text-[13px] text-destructive text-center">{serverError}</p>}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? "บันทึก" : "เพิ่ม"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createTransactionSchema, type CreateTransactionInput } from "@/lib/validations/transaction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Users } from "lucide-react";

interface Category {
  id: string;
  name: string;
  icon: string | null;
  type: "INCOME" | "EXPENSE";
  children: { id: string; name: string; icon: string | null }[];
}

interface PaymentMethod {
  id: string;
  name: string;
}

interface FamilyMember {
  id: string;
  name: string;
}

interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}

interface PrefillValues {
  type?: "INCOME" | "EXPENSE";
  amount?: number;
  categoryId?: string;
  paymentMethodId?: string | null;
  description?: string;
}

interface TransactionFormProps {
  defaultValues?: {
    id: string;
    type: "INCOME" | "EXPENSE";
    amount: string;
    description: string | null;
    date: string;
    categoryId: string;
    paymentMethodId: string | null;
    isFamily?: boolean;
    familyMemberId?: string | null;
    familyMember?: { id: string; name: string } | null;
    familyGroupId?: string | null;
  };
  prefill?: PrefillValues;
  onSuccess: () => void;
  onCancel: () => void;
}

function toDateInputValue(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
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

export function TransactionForm({ defaultValues, prefill, onSuccess, onCancel }: TransactionFormProps) {
  const isEdit = !!defaultValues;
  const [txType, setTxType] = useState<"INCOME" | "EXPENSE">(defaultValues?.type ?? prefill?.type ?? "EXPENSE");
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isFamily, setIsFamily] = useState(defaultValues?.isFamily ?? false);
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(defaultValues?.familyMemberId ?? null);
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([]);
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(defaultValues?.familyGroupId ?? null);
  const [loadingData, setLoadingData] = useState(true);
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<CreateTransactionInput>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: defaultValues?.type ?? prefill?.type ?? "EXPENSE",
      amount: defaultValues?.amount ? parseFloat(defaultValues.amount) : prefill?.amount ?? undefined,
      description: defaultValues?.description ?? prefill?.description ?? "",
      date: defaultValues?.date ? toDateInputValue(defaultValues.date) : todayString(),
      categoryId: defaultValues?.categoryId ?? prefill?.categoryId ?? "",
      paymentMethodId: defaultValues?.paymentMethodId ?? prefill?.paymentMethodId ?? null,
    },
  });

  const watchedCategoryId = watch("categoryId");

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, pmRes, fmRes, fgRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/payment-methods"),
          fetch("/api/v1/family-members"),
          fetch("/api/v1/family"),
        ]);
        const catData = await catRes.json();
        const pmData = await pmRes.json();
        const fmData = await fmRes.json();
        const fgData = await fgRes.json();
        if (catData.success) setCategories(catData.data);
        if (pmData.success) setPaymentMethods(pmData.data);
        if (fmData.success) setFamilyMembers(fmData.data);
        if (fgData.success) setFamilyGroups(fgData.data.groups);
      } finally {
        setLoadingData(false);
      }
    }
    loadData();
  }, []);

  const filteredCategories = categories.filter((c) => c.type === txType);

  function handleTypeChange(type: "INCOME" | "EXPENSE") {
    setTxType(type);
    setValue("type", type);
    setValue("categoryId", "");
  }

  async function onSubmit(data: CreateTransactionInput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/transactions/${defaultValues!.id}` : "/api/v1/transactions";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          isFamily,
          familyMemberId: isFamily ? familyMemberId : null,
          familyGroupId: isFamily ? familyGroupId : null,
        }),
      });
      const json = await res.json();
      if (!json.success) { setServerError(json.error?.message ?? "เกิดข้อผิดพลาด"); return; }
      onSuccess();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Type toggle — iOS segmented control */}
      <div className="ios-card p-1 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => handleTypeChange("EXPENSE")}
          className={cn(
            "py-2.5 rounded-xl text-[14px] font-semibold transition-all",
            txType === "EXPENSE" ? "bg-[#FF3B30] text-white shadow-sm" : "text-muted-foreground"
          )}
        >
          รายจ่าย
        </button>
        <button
          type="button"
          onClick={() => handleTypeChange("INCOME")}
          className={cn(
            "py-2.5 rounded-xl text-[14px] font-semibold transition-all",
            txType === "INCOME" ? "bg-[#34C759] text-white shadow-sm" : "text-muted-foreground"
          )}
        >
          รายรับ
        </button>
      </div>

      {/* Amount — large, prominent */}
      <div className="ios-card px-5 py-4">
        <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">จำนวนเงิน (บาท)</label>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          className={cn(
            "mt-1 bg-transparent px-0 h-12 text-[28px] font-bold focus-visible:ring-0 border-0 rounded-none",
            errors.amount ? "text-destructive" : txType === "INCOME" ? "text-[#34C759]" : "text-foreground"
          )}
          {...register("amount", { valueAsNumber: true })}
        />
        {errors.amount && <p className="text-[12px] text-destructive">{errors.amount.message}</p>}
      </div>

      {/* Other fields */}
      <div className="ios-card px-5 py-4 space-y-4">
        <FormRow label="หมวดหมู่" error={errors.categoryId?.message}>
          <Select value={watchedCategoryId} onValueChange={(val) => setValue("categoryId", val, { shouldValidate: true })}>
            <SelectTrigger className={cn("bg-input h-11 rounded-xl border-0", errors.categoryId && "ring-2 ring-destructive")}>
              <SelectValue placeholder="เลือกหมวดหมู่" />
            </SelectTrigger>
            <SelectContent>
              {filteredCategories.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">ไม่มีหมวดหมู่</div>
              ) : (
                filteredCategories.map((cat) =>
                  cat.children.length > 0 ? (
                    <SelectGroup key={cat.id}>
                      <SelectLabel>{cat.icon ? `${cat.icon} ${cat.name}` : cat.name}</SelectLabel>
                      {cat.children.map((child) => (
                        <SelectItem key={child.id} value={child.id}>
                          {child.icon ? `${child.icon} ${child.name}` : child.name}
                        </SelectItem>
                      ))}
                      <SelectSeparator />
                    </SelectGroup>
                  ) : (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
                    </SelectItem>
                  )
                )
              )}
            </SelectContent>
          </Select>
        </FormRow>

        <FormRow label="วันที่" error={errors.date?.message}>
          <Input type="date" className={cn("bg-input h-11 rounded-xl border-0", errors.date && "ring-2 ring-destructive")} {...register("date")} />
        </FormRow>

        <FormRow label="ช่องทางการชำระ">
          <Select value={watch("paymentMethodId") ?? "none"} onValueChange={(val) => setValue("paymentMethodId", val === "none" ? null : val)}>
            <SelectTrigger className="bg-input h-11 rounded-xl border-0">
              <SelectValue placeholder="ไม่ระบุ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุ</SelectItem>
              {paymentMethods.map((pm) => (
                <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>

        <FormRow label="หมายเหตุ">
          <Input placeholder="เช่น ค่าข้าวกลางวัน" className="bg-input h-11 rounded-xl border-0" {...register("description")} />
        </FormRow>

        {/* Family toggle */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] font-medium text-muted-foreground">รายการครอบครัว</span>
          </div>
          <button
            type="button"
            onClick={() => { setIsFamily((v) => !v); if (isFamily) { setFamilyMemberId(null); setFamilyGroupId(null); } }}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              isFamily ? "bg-primary" : "bg-input"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform",
              isFamily ? "translate-x-5" : "translate-x-0"
            )} />
          </button>
        </div>

        {isFamily && familyMembers.length > 0 && (
          <Select
            value={familyMemberId ?? "none"}
            onValueChange={(val) => setFamilyMemberId(val === "none" ? null : val)}
          >
            <SelectTrigger className="bg-input h-11 rounded-xl border-0">
              <SelectValue placeholder="เลือกสมาชิก (ไม่บังคับ)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุสมาชิก</SelectItem>
              {familyMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isFamily && familyGroups.length > 0 && (
          <Select
            value={familyGroupId ?? "none"}
            onValueChange={(val) => setFamilyGroupId(val === "none" ? null : val)}
          >
            <SelectTrigger className="bg-input h-11 rounded-xl border-0">
              <SelectValue placeholder="บันทึกเข้ากลุ่มครอบครัวไหน" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุ</SelectItem>
              {familyGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {serverError && <p className="text-[14px] text-destructive text-center">{serverError}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "บันทึก" : txType === "INCOME" ? "บันทึกรายรับ" : "บันทึกรายจ่าย"}
        </Button>
      </div>
    </form>
  );
}

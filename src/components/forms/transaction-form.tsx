"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createTransactionSchema, type CreateTransactionInput } from "@/lib/validations/transaction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectSeparator } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Users, CreditCard } from "lucide-react";
import Link from "next/link";
import { ConvertToInstallmentDialog } from "@/components/forms/convert-to-installment-dialog";

interface Category {
  id: string;
  name: string;
  icon: string | null;
  type: "INCOME" | "EXPENSE";
  children: { id: string; name: string; icon: string | null }[];
}

interface Account {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};

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
  accountId?: string | null;
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
    accountId?: string | null;
    isFamily?: boolean;
    familyMemberId?: string | null;
    familyMember?: { id: string; name: string } | null;
    familyGroupId?: string | null;
    isTransfer?: boolean;
    convertedToDebtId?: string | null;
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

function findCategoryName(categories: Category[], categoryId: string): string | null {
  for (const cat of categories) {
    if (cat.id === categoryId) return cat.name;
    const child = cat.children.find((c) => c.id === categoryId);
    if (child) return child.name;
  }
  return null;
}

export function TransactionForm({ defaultValues, prefill, onSuccess, onCancel }: TransactionFormProps) {
  const isEdit = !!defaultValues;
  const [txType, setTxType] = useState<"INCOME" | "EXPENSE">(defaultValues?.type ?? prefill?.type ?? "EXPENSE");
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isFamily, setIsFamily] = useState(defaultValues?.isFamily ?? false);
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(defaultValues?.familyMemberId ?? null);
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([]);
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(defaultValues?.familyGroupId ?? null);
  const [loadingData, setLoadingData] = useState(true);
  const [serverError, setServerError] = useState("");
  const [tier, setTier] = useState<"FREE" | "PRO">("FREE");
  const [convertOpen, setConvertOpen] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<CreateTransactionInput>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: defaultValues?.type ?? prefill?.type ?? "EXPENSE",
      amount: defaultValues?.amount ? parseFloat(defaultValues.amount) : prefill?.amount ?? undefined,
      description: defaultValues?.description ?? prefill?.description ?? "",
      date: defaultValues?.date ? toDateInputValue(defaultValues.date) : todayString(),
      categoryId: defaultValues?.categoryId ?? prefill?.categoryId ?? "",
      paymentMethodId: defaultValues?.paymentMethodId ?? prefill?.paymentMethodId ?? null,
      accountId: defaultValues?.accountId ?? prefill?.accountId ?? null,
    },
  });

  const watchedCategoryId = watch("categoryId");

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, accRes, fmRes, fgRes, meRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/accounts"),
          fetch("/api/v1/family-members"),
          fetch("/api/v1/family"),
          fetch("/api/v1/auth/me"),
        ]);
        const catData = await catRes.json();
        const accData = await accRes.json();
        const fmData = await fmRes.json();
        const fgData = await fgRes.json();
        const meData = await meRes.json();
        if (catData.success) setCategories(catData.data);
        if (accData.success) {
          setAccounts(accData.data);
          const defaultAccount = accData.data?.find((a: Account) => a.isDefault) ?? accData.data?.[0];
          if (defaultAccount && !isEdit && !prefill?.accountId) {
            setValue("accountId", defaultAccount.id);
          }
        }
        if (fmData.success) setFamilyMembers(fmData.data);
        if (fgData.success) setFamilyGroups(fgData.data.groups);
        if (meData.success) setTier(meData.data.tier);
      } finally {
        setLoadingData(false);
      }
    }
    loadData();
  }, []);

  const filteredCategories = categories.filter((c) => c.type === txType);

  const editingAccount = accounts.find((a) => a.id === defaultValues?.accountId);
  const canConvert =
    isEdit &&
    defaultValues?.type === "EXPENSE" &&
    defaultValues?.isTransfer === false &&
    !defaultValues?.convertedToDebtId &&
    editingAccount?.type === "CREDIT_CARD";

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
    <>
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
                      <SelectItem value={cat.id} className="font-semibold">
                        {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
                      </SelectItem>
                      {cat.children.map((child) => (
                        <SelectItem key={child.id} value={child.id} className="pl-10">
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

        <FormRow label="ชำระด้วย" error={errors.accountId?.message}>
          <Select
            value={watch("accountId") ?? "none"}
            onValueChange={(val) => setValue("accountId", val === "none" ? null : val, { shouldValidate: true })}
          >
            <SelectTrigger className={cn("bg-input h-11 rounded-xl border-0", errors.accountId && "ring-2 ring-destructive")}>
              <SelectValue placeholder="เลือกกระเป๋าเงิน" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุ</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {TYPE_EMOJI[a.type] ?? "💰"} {a.name}
                </SelectItem>
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

      {canConvert && (
        <button
          type="button"
          onClick={() => setConvertOpen(true)}
          className="ios-card w-full flex items-center justify-center gap-2 px-5 py-3 text-[14px] font-medium text-primary"
        >
          <CreditCard className="h-4 w-4" />
          แบ่งชำระรายเดือน
        </button>
      )}

      {isEdit && defaultValues?.convertedToDebtId && (
        <div className="ios-card px-5 py-4 space-y-1">
          <p className="text-[13px] text-muted-foreground">รายการนี้ถูกแปลงเป็นยอดผ่อนแล้ว</p>
          <Link href={`/debts/${defaultValues.convertedToDebtId}`} className="text-[14px] font-medium text-primary">
            ดูรายการหนี้ →
          </Link>
        </div>
      )}

      {serverError && <p className="text-[14px] text-destructive text-center">{serverError}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "บันทึก" : txType === "INCOME" ? "บันทึกรายรับ" : "บันทึกรายจ่าย"}
        </Button>
      </div>
    </form>

    {canConvert && defaultValues && (
      <ConvertToInstallmentDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        transaction={{
          id: defaultValues.id,
          date: defaultValues.date,
          description: defaultValues.description,
          amount: parseFloat(defaultValues.amount),
          accountId: defaultValues.accountId ?? "",
          categoryName: findCategoryName(categories, defaultValues.categoryId) ?? "อื่นๆ",
        }}
        tier={tier}
        onConverted={() => { setConvertOpen(false); onSuccess(); }}
      />
    )}
    </>
  );
}

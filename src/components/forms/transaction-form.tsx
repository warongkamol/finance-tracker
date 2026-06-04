"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createTransactionSchema, type CreateTransactionInput } from "@/lib/validations/transaction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

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

interface TransactionFormProps {
  defaultValues?: {
    id: string;
    type: "INCOME" | "EXPENSE";
    amount: string;
    description: string | null;
    date: string;
    categoryId: string;
    paymentMethodId: string | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

function toDateInputValue(isoOrDate: string): string {
  // Takes a full ISO string or YYYY-MM-DD and returns YYYY-MM-DD
  return isoOrDate.slice(0, 10);
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TransactionForm({ defaultValues, onSuccess, onCancel }: TransactionFormProps) {
  const isEdit = !!defaultValues;
  const [txType, setTxType] = useState<"INCOME" | "EXPENSE">(defaultValues?.type ?? "EXPENSE");
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [serverError, setServerError] = useState("");

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<CreateTransactionInput>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: defaultValues?.type ?? "EXPENSE",
      amount: defaultValues?.amount ? parseFloat(defaultValues.amount) : undefined,
      description: defaultValues?.description ?? "",
      date: defaultValues?.date ? toDateInputValue(defaultValues.date) : todayString(),
      categoryId: defaultValues?.categoryId ?? "",
      paymentMethodId: defaultValues?.paymentMethodId ?? null,
    },
  });

  const watchedCategoryId = watch("categoryId");

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, pmRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/payment-methods"),
        ]);
        const catData = await catRes.json();
        const pmData = await pmRes.json();
        if (catData.success) setCategories(catData.data);
        if (pmData.success) setPaymentMethods(pmData.data);
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
    // Reset category when type changes
    setValue("categoryId", "");
  }

  async function onSubmit(data: CreateTransactionInput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/transactions/${defaultValues!.id}` : "/api/v1/transactions";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) {
        setServerError(json.error?.message ?? "เกิดข้อผิดพลาด");
        return;
      }
      onSuccess();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Type toggle */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
        <button
          type="button"
          onClick={() => handleTypeChange("EXPENSE")}
          className={cn(
            "py-2 rounded-lg text-sm font-medium transition-all",
            txType === "EXPENSE"
              ? "bg-background shadow text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          รายจ่าย
        </button>
        <button
          type="button"
          onClick={() => handleTypeChange("INCOME")}
          className={cn(
            "py-2 rounded-lg text-sm font-medium transition-all",
            txType === "INCOME"
              ? "bg-background shadow text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          รายรับ
        </button>
      </div>

      {/* Amount */}
      <div className="space-y-1.5">
        <Label htmlFor="amount">จำนวนเงิน (บาท)</Label>
        <Input
          id="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          className={cn("text-lg", errors.amount && "border-destructive")}
          {...register("amount", { valueAsNumber: true })}
        />
        {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <Label>หมวดหมู่</Label>
        <Select
          value={watchedCategoryId}
          onValueChange={(val) => setValue("categoryId", val, { shouldValidate: true })}
        >
          <SelectTrigger className={cn(errors.categoryId && "border-destructive")}>
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
        {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label htmlFor="date">วันที่</Label>
        <Input
          id="date"
          type="date"
          className={cn(errors.date && "border-destructive")}
          {...register("date")}
        />
        {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
      </div>

      {/* Payment method */}
      <div className="space-y-1.5">
        <Label>ช่องทางการชำระเงิน (ไม่บังคับ)</Label>
        <Select
          value={watch("paymentMethodId") ?? "none"}
          onValueChange={(val) => setValue("paymentMethodId", val === "none" ? null : val)}
        >
          <SelectTrigger>
            <SelectValue placeholder="ไม่ระบุ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">ไม่ระบุ</SelectItem>
            {paymentMethods.map((pm) => (
              <SelectItem key={pm.id} value={pm.id}>
                {pm.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="description">หมายเหตุ (ไม่บังคับ)</Label>
        <Input
          id="description"
          placeholder="เช่น ค่าข้าวกลางวัน"
          {...register("description")}
        />
      </div>

      {serverError && (
        <p className="text-sm text-destructive text-center">{serverError}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={isSubmitting}>
          ยกเลิก
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "บันทึกการแก้ไข" : txType === "INCOME" ? "บันทึกรายรับ" : "บันทึกรายจ่าย"}
        </Button>
      </div>
    </form>
  );
}

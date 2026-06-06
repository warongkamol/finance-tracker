"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { TransactionForm } from "@/components/forms/transaction-form";

interface RecurringData {
  type: "INCOME" | "EXPENSE";
  amount: string;
  categoryId: string;
  paymentMethodId: string | null;
  name: string;
}

export default function NewTransactionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const recurringId = params.get("recurringId");

  const [prefill, setPrefill] = useState<RecurringData | null>(null);
  const [loading, setLoading] = useState(!!recurringId);

  useEffect(() => {
    if (!recurringId) return;
    fetch(`/api/v1/recurring/${recurringId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const { type, amount, categoryId, paymentMethodId, name } = d.data;
          setPrefill({ type, amount, categoryId, paymentMethodId, name });
        }
      })
      .finally(() => setLoading(false));
  }, [recurringId]);

  if (loading) {
    return (
      <div className="py-5 flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-muted-foreground text-[15px]">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="py-5 space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-[18px] font-bold leading-tight">บันทึกรายการ</h1>
          {prefill && <p className="text-[13px] text-muted-foreground">{prefill.name}</p>}
        </div>
      </div>

      <TransactionForm
        prefill={prefill ? {
          type: prefill.type,
          amount: Number(prefill.amount),
          categoryId: prefill.categoryId,
          paymentMethodId: prefill.paymentMethodId,
        } : undefined}
        onSuccess={() => router.push("/transactions")}
        onCancel={() => router.back()}
      />
    </div>
  );
}

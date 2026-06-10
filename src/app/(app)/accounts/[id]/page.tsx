"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft, ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AccountForm } from "@/components/forms/account-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { cn, formatCurrency, formatShortDate } from "@/lib/utils";

interface AccountDetail {
  id: string;
  name: string;
  type: string;
  balance: number;
  initialBalance: number;
  creditLimit: number | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isDefault: boolean;
  sortOrder: number;
  recentTransactions: {
    id: string;
    type: "INCOME" | "EXPENSE";
    amount: number;
    description: string | null;
    date: string;
    categoryName: string | null;
    categoryIcon: string | null;
  }[];
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};
const TYPE_LABEL: Record<string, string> = {
  CASH: "เงินสด", BANK_ACCOUNT: "บัญชีธนาคาร", SAVINGS: "ออมทรัพย์", E_WALLET: "E-Wallet", CREDIT_CARD: "บัตรเครดิต",
};

export default function AccountDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function load() {
    try {
      const res = await fetch(`/api/v1/accounts/${params.id}`);
      const json = await res.json();
      if (json.success) setAccount(json.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [params.id]);

  async function handleDelete() {
    setDeleteLoading(true);
    setDeleteError("");
    const res = await fetch(`/api/v1/accounts/${params.id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) { router.push("/accounts"); return; }
    setDeleteError(json.error?.message ?? "เกิดข้อผิดพลาด");
    setDeleteLoading(false);
  }

  if (loading || !account) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const isCreditCard = account.type === "CREDIT_CARD";

  return (
    <div className="pt-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/accounts")} className="flex items-center gap-1 text-primary">
          <ChevronLeft className="h-5 w-5" />
          <span className="text-[15px]">กระเป๋า</span>
        </button>
        <Button variant="ghost" size="sm" className="text-primary" onClick={() => setEditOpen(true)}>
          แก้ไข
        </Button>
      </div>

      {/* Balance card */}
      <div className="ios-card px-5 py-5 text-center space-y-1">
        <p className="text-[13px] text-muted-foreground">{TYPE_EMOJI[account.type]} {account.name}</p>
        <p className="text-[11px] text-muted-foreground">{TYPE_LABEL[account.type] ?? account.type}</p>
        <p className={cn("text-[36px] font-bold tabular-nums mt-2", account.balance < 0 ? "text-[#FF3B30]" : "text-foreground")}>
          {formatCurrency(Math.abs(account.balance))}
          {account.balance < 0 && <span className="text-[20px]"> (ติดลบ)</span>}
        </p>
        {isCreditCard && account.creditLimit && (
          <div className="mt-3 space-y-1.5">
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-[#FF3B30] rounded-full"
                style={{ width: `${Math.min(100, (Math.abs(account.balance) / account.creditLimit) * 100)}%` }}
              />
            </div>
            <p className="text-[12px] text-muted-foreground">
              วงเงิน {formatCurrency(account.creditLimit)} · ครบกำหนดชำระวันที่ {account.paymentDueDay ?? "-"}
            </p>
          </div>
        )}
      </div>

      {/* Transfer button */}
      <Button
        variant="secondary"
        className="w-full gap-2"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-4 w-4" />
        โอนออก
      </Button>

      {/* Recent transactions */}
      <div>
        <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">รายการล่าสุด</p>
        {account.recentTransactions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-6">ยังไม่มีรายการ</p>
        ) : (
          <div className="ios-card divide-y divide-border/50">
            {account.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-[18px]">{tx.categoryIcon ?? "📝"}</span>
                  <div>
                    <p className="text-[14px] font-medium">{tx.categoryName ?? tx.description ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{formatShortDate(tx.date)}</p>
                  </div>
                </div>
                <p className={cn("text-[14px] font-semibold tabular-nums", tx.type === "INCOME" ? "text-[#34C759]" : "text-[#FF3B30]")}>
                  {tx.type === "INCOME" ? "+" : "−"}{formatCurrency(tx.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="pt-4 pb-2">
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => { setDeleteError(""); setDeleteDialog(true); }}
        >
          ลบบัญชีนี้
        </Button>
      </div>

      <AccountForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={() => { setEditOpen(false); load(); }}
        initialAccount={account}
      />
      <TransferForm
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={load}
        defaultFromAccountId={account.id}
      />

      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบบัญชี</DialogTitle>
            <DialogDescription>
              ลบ &ldquo;{account.name}&rdquo;? การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-[13px] text-destructive text-center">{deleteError}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteDialog(false)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "ลบ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

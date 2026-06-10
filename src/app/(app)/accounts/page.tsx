"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountForm } from "@/components/forms/account-form";
import { TransferForm } from "@/components/forms/transfer-form";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  initialBalance: number;
  creditLimit: number | null;
  cycleUsed: number | null;
  statementDay: number | null;
  isDefault: boolean;
}

const TYPE_EMOJI: Record<string, string> = {
  CASH: "💵", BANK_ACCOUNT: "🏦", SAVINGS: "💰", E_WALLET: "📱", CREDIT_CARD: "💳",
};

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardBalances, setOnboardBalances] = useState<Record<string, string>>({});

  async function load() {
    try {
      const res = await fetch("/api/v1/accounts");
      const json = await res.json();
      if (json.success) {
        setAccounts(json.data);
        // Show onboarding if never dismissed and all initialBalances are 0
        const neverOnboarded = !localStorage.getItem("wallet_onboarded");
        const allZero = json.data.length > 0 && json.data.every((a: Account) => a.initialBalance === 0);
        if (neverOnboarded && allZero) {
          const initial: Record<string, string> = {};
          json.data.forEach((a: Account) => { initial[a.id] = ""; });
          setOnboardBalances(initial);
          setOnboardOpen(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleOnboardSave() {
    await Promise.all(
      Object.entries(onboardBalances)
        .filter(([, v]) => v !== "" && !isNaN(parseFloat(v)))
        .map(([id, v]) =>
          fetch(`/api/v1/accounts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initialBalance: parseFloat(v) }),
          })
        )
    );
    localStorage.setItem("wallet_onboarded", "true");
    setOnboardOpen(false);
    load();
  }

  const liquidTotal = accounts
    .filter((a) => a.type !== "CREDIT_CARD")
    .reduce((sum, a) => sum + a.balance, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold">กระเป๋าเงิน</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setTransferOpen(true)}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            โอน
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            เพิ่ม
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => router.push(`/accounts/${acc.id}`)}
            className="ios-card w-full px-4 py-3.5 text-left active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[22px]">{TYPE_EMOJI[acc.type] ?? "💰"}</span>
                <div>
                  <p className="text-[15px] font-semibold">{acc.name}</p>
                  {acc.type === "CREDIT_CARD" && acc.statementDay && (
                    <p className="text-[11px] text-muted-foreground">รอบบิลวันที่ {acc.statementDay}</p>
                  )}
                </div>
              </div>
              {acc.type === "CREDIT_CARD" && acc.creditLimit ? (
                <div className="text-right">
                  <p className="text-[13px] text-muted-foreground">
                    ใช้ไป{" "}
                    <span className="text-[#FF3B30] font-semibold">
                      {formatCurrency(acc.cycleUsed ?? 0)}
                    </span>
                  </p>
                  <div className="mt-1 w-28 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#FF3B30] rounded-full"
                      style={{ width: `${Math.min(100, ((acc.cycleUsed ?? 0) / acc.creditLimit) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    วงเงิน {formatCurrency(acc.creditLimit)}
                  </p>
                </div>
              ) : (
                <p className={cn("text-[17px] font-bold tabular-nums", acc.balance < 0 ? "text-[#FF3B30]" : "text-foreground")}>
                  {formatCurrency(acc.balance)}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      {accounts.length > 0 && (
        <div className="ios-card px-4 py-3 flex justify-between items-center">
          <p className="text-[13px] text-muted-foreground">รวมเงินสด</p>
          <p className="text-[15px] font-bold tabular-nums">{formatCurrency(liquidTotal)}</p>
        </div>
      )}

      <AccountForm open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={load} />
      <TransferForm open={transferOpen} onClose={() => setTransferOpen(false)} onSuccess={load} />

      {/* Onboarding wizard */}
      <Sheet open={onboardOpen} onOpenChange={(o) => { if (!o) { localStorage.setItem("wallet_onboarded", "true"); setOnboardOpen(false); } }}>
        <SheetContent title="ตั้งยอดเริ่มต้น">
          <p className="text-[13px] text-muted-foreground pb-2">กรอกยอดเงินปัจจุบันในแต่ละกระเป๋า เพื่อให้ยอดคงเหลือถูกต้อง</p>
          <div className="space-y-3 py-4">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center gap-3">
                <span className="text-[20px]">{TYPE_EMOJI[acc.type] ?? "💰"}</span>
                <p className="text-[14px] font-medium flex-1">{acc.name}</p>
                <div className="w-36">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={onboardBalances[acc.id] ?? ""}
                    onChange={(e) => setOnboardBalances((p) => ({ ...p, [acc.id]: e.target.value }))}
                    className="ios-card text-right"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pb-8">
            <Button
              variant="secondary"
              onClick={() => { localStorage.setItem("wallet_onboarded", "true"); setOnboardOpen(false); }}
            >
              ข้ามไปก่อน
            </Button>
            <Button onClick={handleOnboardSave}>บันทึก</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

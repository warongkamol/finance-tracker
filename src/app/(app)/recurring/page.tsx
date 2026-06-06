"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, BellRing, BellOff } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RecurringForm } from "@/components/forms/recurring-form";
import { formatCurrency, cn } from "@/lib/utils";

interface RecurringItem {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  amount: string;
  frequency: "MONTHLY" | "YEARLY";
  reminderDay: number;
  isLastDayOfMonth: boolean;
  startDate: string;
  endDate: string;
  isActive: boolean;
  notes: string | null;
  category: { id: string; name: string; icon: string | null };
  paymentMethod: { id: string; name: string } | null;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

function reminderDayLabel(item: RecurringItem) {
  if (item.isLastDayOfMonth) return "วันสุดท้ายของเดือน";
  return `วันที่ ${item.reminderDay} ของเดือน`;
}

function isExpired(endDate: string) {
  return new Date(endDate) < new Date(new Date().toDateString());
}

export default function RecurringPage() {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringItem | null>(null);
  const [deleting, setDeleting] = useState<RecurringItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/recurring");
      const data = await res.json();
      if (data.success) setItems(data.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function openAdd() { setEditing(null); setSheetOpen(true); }
  function openEdit(item: RecurringItem) { setEditing(item); setSheetOpen(true); }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await fetch(`/api/v1/recurring/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      fetchItems();
    } finally {
      setDeleteLoading(false);
    }
  }

  const active = items.filter(i => i.isActive && !isExpired(i.endDate));
  const inactive = items.filter(i => !i.isActive || isExpired(i.endDate));

  return (
    <div className="py-5 space-y-5">
      {/* Hero */}
      <div className="ios-card px-5 py-5">
        <p className="text-[13px] font-medium text-muted-foreground">รายการแจ้งเตือนที่ใช้งานอยู่</p>
        <p className="text-[36px] font-bold text-primary tabular-nums tracking-tight mt-0.5">{active.length}</p>
        <p className="text-[13px] text-muted-foreground mt-1">รายการ · สูงสุด 12 เดือนต่อรอบ</p>
      </div>

      {/* Active list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : active.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-[16px] font-medium">ยังไม่มีรายการแจ้งเตือน</p>
          <p className="text-[14px] text-muted-foreground mt-1">กด + เพื่อตั้งแจ้งเตือนรายรับ-รายจ่ายประจำ</p>
        </div>
      ) : (
        <div className="ios-card overflow-hidden divide-y divide-border/50">
          {active.map(item => (
            <RecurringCard key={item.id} item={item} onEdit={() => openEdit(item)} onDelete={() => setDeleting(item)} />
          ))}
        </div>
      )}

      {/* Expired / inactive */}
      {inactive.length > 0 && (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-muted-foreground px-1">หมดอายุ / ปิดใช้งาน</p>
          <div className="ios-card overflow-hidden divide-y divide-border/50 opacity-60">
            {inactive.map(item => (
              <RecurringCard key={item.id} item={item} onEdit={() => openEdit(item)} onDelete={() => setDeleting(item)} />
            ))}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="เพิ่มแจ้งเตือน"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent title={editing ? "แก้ไขแจ้งเตือน" : "เพิ่มแจ้งเตือน"}>
          <RecurringForm
            initial={editing ? {
              id: editing.id,
              name: editing.name,
              type: editing.type,
              amount: Number(editing.amount),
              categoryId: editing.category.id,
              paymentMethodId: editing.paymentMethod?.id ?? null,
              frequency: editing.frequency,
              reminderDay: editing.reminderDay,
              isLastDayOfMonth: editing.isLastDayOfMonth,
              startDate: editing.startDate.slice(0, 10),
              endDate: editing.endDate.slice(0, 10),
              notes: editing.notes ?? "",
            } : undefined}
            onSuccess={() => { setSheetOpen(false); fetchItems(); }}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบรายการแจ้งเตือน</DialogTitle>
            <DialogDescription>ยืนยันการลบ &quot;{deleting?.name}&quot;? จะไม่ได้รับการแจ้งเตือนนี้อีก</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "กำลังลบ..." : "ลบ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecurringCard({ item, onEdit, onDelete }: { item: RecurringItem; onEdit: () => void; onDelete: () => void }) {
  const expired = isExpired(item.endDate);
  const isIncome = item.type === "INCOME";

  return (
    <div className="px-4 py-4">
      <div className="flex items-start gap-3">
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white",
          !item.isActive || expired ? "bg-muted-foreground" : isIncome ? "bg-[#34C759]" : "bg-[#FF3B30]"
        )}>
          {!item.isActive || expired ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold truncate">{item.name}</p>
            <p className={cn("text-[15px] font-bold tabular-nums shrink-0", isIncome ? "text-[#34C759]" : "text-[#FF3B30]")}>
              {isIncome ? "+" : "-"}{formatCurrency(Number(item.amount))}
            </p>
          </div>

          <p className="text-[13px] text-muted-foreground mt-0.5">
            {item.category.icon} {item.category.name} · {item.frequency === "MONTHLY" ? "รายเดือน" : "รายปี"}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            🔔 {reminderDayLabel(item)} · ถึง {new Date(item.endDate).toLocaleDateString("th-TH", { month: "short", year: "numeric" })}
          </p>
          {expired && <p className="text-[12px] text-destructive font-medium mt-1">หมดอายุแล้ว</p>}
        </div>
      </div>

      <div className="flex gap-2 mt-3 ml-12">
        <button onClick={onEdit} className="flex items-center gap-1.5 text-[13px] text-primary font-medium px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors">
          <Pencil className="h-3.5 w-3.5" /> แก้ไข
        </button>
        <button onClick={onDelete} className="flex items-center gap-1.5 text-[13px] text-destructive font-medium px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 transition-colors">
          <Trash2 className="h-3.5 w-3.5" /> ลบ
        </button>
      </div>
    </div>
  );
}

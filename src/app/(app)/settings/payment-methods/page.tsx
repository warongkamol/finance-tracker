"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Trash2, Plus } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PaymentMethodForm, TYPE_LABELS, TYPE_ICONS } from "@/components/forms/payment-method-form";
import { cn } from "@/lib/utils";

interface PaymentMethodItem {
  id: string;
  name: string;
  type: keyof typeof TYPE_LABELS;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

export default function PaymentMethodsSettingsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethodItem | null>(null);

  const [deleting, setDeleting] = useState<PaymentMethodItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/payment-methods");
      const data = await res.json();
      if (data.success) setItems(data.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function openAdd() { setEditing(null); setSheetOpen(true); }
  function openEdit(item: PaymentMethodItem) { setEditing(item); setSheetOpen(true); }
  function openDelete(item: PaymentMethodItem) { setDeleteError(""); setDeleting(item); }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/v1/payment-methods/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        setDeleteError(data.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
        return;
      }
      setDeleting(null);
      fetchItems();
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="py-5 space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[18px] font-bold leading-tight">ช่องทางชำระเงิน</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">💳</p>
          <p className="text-[16px] font-medium">ยังไม่มีช่องทางชำระเงิน</p>
          <p className="text-[14px] text-muted-foreground mt-1">กด + เพื่อเพิ่มช่องทางชำระเงิน</p>
        </div>
      ) : (
        <div className="ios-card overflow-hidden divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-[15px]">{TYPE_ICONS[item.type]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">{item.name}</p>
                <p className="text-[12px] text-muted-foreground truncate">{TYPE_LABELS[item.type]}</p>
              </div>
              <button
                onClick={() => openEdit(item)}
                className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center shrink-0"
                aria-label={`แก้ไข ${item.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => openDelete(item)}
                className="h-8 w-8 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center shrink-0"
                aria-label={`ลบ ${item.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="เพิ่มช่องทางชำระเงิน"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* Add / edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent title={editing ? "แก้ไขช่องทางชำระเงิน" : "เพิ่มช่องทางชำระเงิน"}>
          <PaymentMethodForm
            initial={editing ? { id: editing.id, name: editing.name, type: editing.type } : undefined}
            onSuccess={() => { setSheetOpen(false); fetchItems(); }}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบช่องทางชำระเงิน</DialogTitle>
            <DialogDescription>ยืนยันการลบ &quot;{deleting?.name}&quot;?</DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-[13px] text-destructive">{deleteError}</p>}
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

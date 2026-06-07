"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Trash2, Plus } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CategoryForm } from "@/components/forms/category-form";
import { cn } from "@/lib/utils";

interface CategoryItem {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  icon: string | null;
  color: string | null;
  parentId: string | null;
  children: CategoryItem[];
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

function CategoryRow({
  cat,
  isChild,
  onEdit,
  onDelete,
}: {
  cat: CategoryItem;
  isChild?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2.5 pr-2", isChild ? "pl-14" : "px-4")}>
      <div
        className="h-9 w-9 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${cat.color ?? "#B2BEC3"}20` }}
      >
        <span className="text-[15px]">{cat.icon || "📌"}</span>
      </div>
      <p className="flex-1 text-[14px] font-medium truncate">{cat.name}</p>
      <button
        onClick={onEdit}
        className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center shrink-0"
        aria-label={`แก้ไข ${cat.name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="h-8 w-8 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center shrink-0"
        aria-label={`ลบ ${cat.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function CategoriesSettingsPage() {
  const router = useRouter();
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [editingParentId, setEditingParentId] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<CategoryItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/categories?type=${type}`);
      const data = await res.json();
      if (data.success) setCategories(data.data);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  function openAdd() {
    setEditing(null);
    setEditingParentId(null);
    setSheetOpen(true);
  }
  function openEditParent(cat: CategoryItem) {
    setEditing(cat);
    setEditingParentId(null);
    setSheetOpen(true);
  }
  function openEditChild(cat: CategoryItem, parentId: string) {
    setEditing(cat);
    setEditingParentId(parentId);
    setSheetOpen(true);
  }

  function openDelete(cat: CategoryItem) {
    setDeleteError("");
    setDeleting(cat);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/v1/categories/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        setDeleteError(data.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
        return;
      }
      setDeleting(null);
      fetchCategories();
    } finally {
      setDeleteLoading(false);
    }
  }

  // Top-level categories of the same type, excluding the one being edited —
  // candidates for "หมวดหมู่หลัก" (max nesting depth is 2, so only top-level
  // categories can be parents).
  const parentOptions = categories
    .filter((c) => c.id !== editing?.id)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon }));

  return (
    <div className="py-5 space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[18px] font-bold leading-tight">จัดการหมวดหมู่</h1>
      </div>

      {/* Type toggle */}
      <div className="flex gap-2">
        {(["EXPENSE", "INCOME"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-[14px] font-semibold transition-all",
              type === t
                ? t === "INCOME" ? "bg-[#34C759] text-white" : "bg-[#FF3B30] text-white"
                : "bg-muted text-muted-foreground"
            )}
          >
            {t === "INCOME" ? "รายรับ" : "รายจ่าย"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : categories.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📂</p>
          <p className="text-[16px] font-medium">ยังไม่มีหมวดหมู่</p>
          <p className="text-[14px] text-muted-foreground mt-1">กด + เพื่อเพิ่มหมวดหมู่{type === "INCOME" ? "รายรับ" : "รายจ่าย"}</p>
        </div>
      ) : (
        <div className="ios-card overflow-hidden divide-y divide-border/50">
          {categories.map((cat) => (
            <div key={cat.id}>
              <CategoryRow cat={cat} onEdit={() => openEditParent(cat)} onDelete={() => openDelete(cat)} />
              {cat.children.map((child) => (
                <div key={child.id} className="border-t border-border/30">
                  <CategoryRow cat={child} isChild onEdit={() => openEditChild(child, cat.id)} onDelete={() => openDelete(child)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="เพิ่มหมวดหมู่"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      {/* Add / edit sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent title={editing ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่"}>
          <CategoryForm
            initial={editing ? {
              id: editing.id,
              name: editing.name,
              type: editing.type,
              icon: editing.icon,
              color: editing.color,
              parentId: editingParentId,
              hasChildren: editing.children.length > 0,
            } : undefined}
            defaultType={type}
            parentOptions={parentOptions}
            onSuccess={() => { setSheetOpen(false); fetchCategories(); }}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบหมวดหมู่</DialogTitle>
            <DialogDescription>
              ยืนยันการลบ &quot;{deleting?.name}&quot;
              {deleting?.children?.length ? ` พร้อมหมวดย่อยอีก ${deleting.children.length} รายการ` : ""}?
            </DialogDescription>
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

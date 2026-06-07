"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCategorySchema, type CreateCategoryInput } from "@/lib/validations/category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";

interface ParentOption {
  id: string;
  name: string;
  icon: string | null;
}

interface CategoryFormInitial {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  icon: string | null;
  color: string | null;
  parentId: string | null;
  hasChildren: boolean;
}

interface CategoryFormProps {
  initial?: CategoryFormInitial;
  defaultType: "INCOME" | "EXPENSE";
  parentOptions: ParentOption[];
  onSuccess: () => void;
  onCancel: () => void;
}

const ICON_OPTIONS = [
  "🍽️", "🚗", "🏠", "⚡", "🏥", "📚", "🎬", "🛒",
  "💳", "🛡️", "💰", "📌", "💼", "💻", "🏷️", "📈",
  "🔄", "🎁", "✈️", "🐾", "👕", "📱", "🎓", "☕",
];

const COLOR_OPTIONS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD",
  "#F0A500", "#6C5CE7", "#E17055", "#00B894", "#FDCB6E", "#B2BEC3",
];

function FormRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

const fieldClass = "bg-input h-11 rounded-xl border-0";

export function CategoryForm({ initial, defaultType, parentOptions, onSuccess, onCancel }: CategoryFormProps) {
  const [serverError, setServerError] = useState("");
  const isEdit = !!initial?.id;

  const { register, handleSubmit, watch, control, setValue, formState: { errors, isSubmitting } } = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: initial?.name ?? "",
      type: initial?.type ?? defaultType,
      icon: initial?.icon ?? "📌",
      color: initial?.color ?? COLOR_OPTIONS[0],
      parentId: initial?.parentId ?? null,
    },
  });

  const icon = watch("icon");
  const color = watch("color");
  const parentId = watch("parentId");

  // type is fixed once created — the API doesn't allow changing it on update
  useEffect(() => {
    if (!isEdit) setValue("type", defaultType);
  }, [defaultType, isEdit, setValue]);

  async function onSubmit(data: CreateCategoryInput) {
    setServerError("");
    try {
      const url = isEdit ? `/api/v1/categories/${initial!.id}` : "/api/v1/categories";
      // Omit parentId entirely when the category has children — the API treats
      // any parentId key (even unchanged) as a reparent attempt and rejects it
      // with HAS_CHILDREN, so we must not send the key at all in that case.
      const body = isEdit
        ? { name: data.name, icon: data.icon, color: data.color, ...(initial?.hasChildren ? {} : { parentId: data.parentId }) }
        : data;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setServerError(json.error?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
        return;
      }
      onSuccess();
    } catch {
      setServerError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Type toggle — locked after creation */}
      <div className="ios-card px-5 py-4">
        <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">ประเภท</label>
        <div className="flex gap-2 mt-1.5">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <button key={t} type="button"
              disabled={isEdit}
              onClick={() => setValue("type", t)}
              className={cn(
                "flex-1 py-2 rounded-xl text-[13px] font-semibold transition-all",
                watch("type") === t
                  ? t === "INCOME" ? "bg-[#34C759] text-white" : "bg-[#FF3B30] text-white"
                  : "bg-muted text-muted-foreground",
                isEdit && "opacity-60"
              )}
            >
              {t === "INCOME" ? "รายรับ" : "รายจ่าย"}
            </button>
          ))}
        </div>
        {isEdit && <p className="text-[11px] text-muted-foreground mt-1.5">ไม่สามารถเปลี่ยนประเภทของหมวดหมู่ที่สร้างแล้วได้</p>}
      </div>

      <div className="ios-card px-5 py-4 space-y-4">
        <FormRow label="ชื่อหมวดหมู่" error={errors.name?.message}>
          <Input placeholder="เช่น อาหารและเครื่องดื่ม" className={cn(fieldClass, errors.name && "ring-2 ring-destructive")} {...register("name")} />
        </FormRow>

        {/* Icon picker */}
        <FormRow label="ไอคอน" error={errors.icon?.message}>
          <div className="flex items-center gap-2">
            <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center text-[20px] shrink-0">
              {icon || "📌"}
            </div>
            <Input
              placeholder="พิมพ์อีโมจิ หรือเลือกด้านล่าง"
              maxLength={10}
              className={cn(fieldClass, "flex-1")}
              {...register("icon")}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {ICON_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setValue("icon", opt)}
                className={cn(
                  "h-9 w-9 rounded-lg flex items-center justify-center text-[16px] transition-all",
                  icon === opt ? "bg-primary/15 ring-2 ring-primary" : "bg-muted hover:bg-muted/70"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </FormRow>

        {/* Color picker */}
        <FormRow label="สี" error={errors.color?.message}>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setValue("color", opt)}
                className="h-9 w-9 rounded-full flex items-center justify-center transition-transform active:scale-95"
                style={{ backgroundColor: opt }}
              >
                {color === opt && <Check className="h-4 w-4 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </FormRow>

        {/* Parent category */}
        {initial?.hasChildren ? (
          <p className="text-[12px] text-muted-foreground">
            หมวดหมู่นี้มีหมวดย่อยอยู่ จึงไม่สามารถย้ายไปอยู่ใต้หมวดอื่นได้
          </p>
        ) : (
          <FormRow label="หมวดหมู่หลัก (ถ้ามี)" error={errors.parentId?.message}>
            <Controller name="parentId" control={control} render={({ field }) => (
              <select
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value || null)}
                className={cn(fieldClass, "w-full px-3 text-[15px]")}
              >
                <option value="">-- ไม่มี (หมวดหมู่หลัก) --</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                ))}
              </select>
            )} />
          </FormRow>
        )}
      </div>

      {serverError && <p className="text-[14px] text-destructive text-center">{serverError}</p>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "บันทึกการแก้ไข" : "เพิ่มหมวดหมู่"}
        </Button>
      </div>
    </form>
  );
}

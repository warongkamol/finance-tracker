"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { registerSchema } from "@/lib/validations/auth";
import { cn } from "@/lib/utils";

const schema = registerSchema.extend({
  confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่าน"),
}).refine((d) => d.password === d.confirmPassword, {
  path: ["confirmPassword"],
  message: "รหัสผ่านไม่ตรงกัน",
});

type RegisterFormInput = z.infer<typeof schema>;

function FieldRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-1">
      <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
      {error && <p className="text-[12px] text-destructive pb-1">{error}</p>}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormInput>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: RegisterFormInput) {
    const res = await fetch("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.name, email: data.email, password: data.password }),
    });

    const json = await res.json();

    if (!json.success) {
      toast({ variant: "destructive", title: "สมัครสมาชิกไม่สำเร็จ", description: json.error?.message });
      return;
    }

    await signIn("credentials", { email: data.email, password: data.password, redirect: false });
    router.push("/dashboard");
    router.refresh();
  }

  const inputClass = "bg-transparent px-0 h-10 text-[16px] focus-visible:ring-0 rounded-none";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="ios-card overflow-hidden divide-y divide-border/60">
        <FieldRow label="ชื่อ" error={errors.name?.message}>
          <Input placeholder="ชื่อของคุณ" autoComplete="name" className={inputClass} {...register("name")} />
        </FieldRow>

        <FieldRow label="อีเมล" error={errors.email?.message}>
          <Input type="email" placeholder="email@example.com" autoComplete="email" className={inputClass} {...register("email")} />
        </FieldRow>

        <FieldRow label="รหัสผ่าน" error={errors.password?.message}>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="อย่างน้อย 8 ตัวอักษร"
              autoComplete="new-password"
              className={cn(inputClass, "pr-10")}
              {...register("password")}
            />
            <button
              type="button"
              className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-muted-foreground"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FieldRow>

        <FieldRow label="ยืนยันรหัสผ่าน" error={errors.confirmPassword?.message}>
          <Input type="password" placeholder="ยืนยันรหัสผ่าน" autoComplete="new-password" className={inputClass} {...register("confirmPassword")} />
        </FieldRow>
      </div>

      <Button type="submit" className="w-full h-12 text-[17px] rounded-2xl" disabled={isSubmitting}>
        {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />กำลังสมัครสมาชิก...</> : "สมัครสมาชิก"}
      </Button>

      <p className="text-center text-[14px] text-muted-foreground pt-2">
        มีบัญชีอยู่แล้ว?{" "}
        <Link href="/login" className="text-primary font-semibold">
          เข้าสู่ระบบ
        </Link>
      </p>
    </form>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { cn } from "@/lib/utils";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(data: LoginInput) {
    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    if (result?.error) {
      toast({ variant: "destructive", title: "เข้าสู่ระบบไม่สำเร็จ", description: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      {/* Fields card */}
      <div className="ios-card overflow-hidden divide-y divide-border">
        {/* Email */}
        <div className="px-4 py-1">
          <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">อีเมล</label>
          <Input
            type="email"
            placeholder="email@example.com"
            autoComplete="email"
            className={cn("bg-transparent px-0 h-10 text-[16px] focus-visible:ring-0 rounded-none", errors.email && "text-destructive")}
            {...register("email")}
          />
          {errors.email && <p className="text-[12px] text-destructive pb-1">{errors.email.message}</p>}
        </div>

        {/* Password */}
        <div className="px-4 py-1">
          <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wide">รหัสผ่าน</label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="รหัสผ่าน"
              autoComplete="current-password"
              className={cn("bg-transparent px-0 h-10 text-[16px] focus-visible:ring-0 rounded-none pr-10", errors.password && "text-destructive")}
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
          {errors.password && <p className="text-[12px] text-destructive pb-1">{errors.password.message}</p>}
        </div>
      </div>

      {/* Forgot password */}
      <div className="flex justify-end px-1">
        <Link href="/forgot-password" className="text-[14px] text-primary font-medium">
          ลืมรหัสผ่าน?
        </Link>
      </div>

      {/* Submit */}
      <Button type="submit" className="w-full h-12 text-[17px] rounded-2xl" disabled={isSubmitting}>
        {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />กำลังเข้าสู่ระบบ...</> : "เข้าสู่ระบบ"}
      </Button>

      {/* Register link */}
      <p className="text-center text-[14px] text-muted-foreground pt-2">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="text-primary font-semibold">
          สมัครสมาชิก
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

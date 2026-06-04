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
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { registerSchema } from "@/lib/validations/auth";

const schema = registerSchema.extend({
  confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่าน"),
}).refine((d) => d.password === d.confirmPassword, {
  path: ["confirmPassword"],
  message: "รหัสผ่านไม่ตรงกัน",
});

type RegisterFormInput = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<RegisterFormInput>({
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

    // Auto sign in after register
    await signIn("credentials", { email: data.email, password: data.password, redirect: false });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-lg font-semibold mb-4 text-center">สมัครสมาชิก</h2>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ชื่อ</FormLabel>
                  <FormControl>
                    <Input placeholder="ชื่อของคุณ" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>อีเมล</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="email@example.com" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>รหัสผ่าน</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="อย่างน้อย 8 ตัวอักษร"
                        autoComplete="new-password"
                        {...field}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ยืนยันรหัสผ่าน</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="ยืนยันรหัสผ่าน" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />กำลังสมัครสมาชิก...</>
              ) : "สมัครสมาชิก"}
            </Button>
          </form>
        </Form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          มีบัญชีอยู่แล้ว?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            เข้าสู่ระบบ
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

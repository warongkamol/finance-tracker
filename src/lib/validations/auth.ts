import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อ").max(100),
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร").max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

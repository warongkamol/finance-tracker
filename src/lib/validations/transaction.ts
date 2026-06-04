import { z } from "zod";

export const createTransactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z
    .number()
    .positive("จำนวนเงินต้องมากกว่า 0")
    .max(999999999.99, "จำนวนเงินเกินขีดจำกัด"),
  description: z.string().max(200, "คำอธิบายยาวเกินไป").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  paymentMethodId: z.string().min(1).nullable().optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

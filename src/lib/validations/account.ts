import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().min(1, "กรุณาใส่ชื่อ").max(50, "ชื่อยาวเกินไป"),
  type: z.enum(["CASH", "BANK_ACCOUNT", "SAVINGS", "E_WALLET", "CREDIT_CARD"]),
  initialBalance: z.number().default(0),
  creditLimit: z.number().positive("วงเงินต้องมากกว่า 0").optional(),
  statementDay: z.number().int().min(1).max(28).optional(),
  paymentDueDay: z.number().int().min(1).max(28).optional(),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const updateAccountSchema = createAccountSchema.partial();

export const transferSchema = z
  .object({
    fromAccountId: z.string().cuid("รูปแบบ ID ไม่ถูกต้อง"),
    toAccountId: z.string().cuid("รูปแบบ ID ไม่ถูกต้อง"),
    amount: z.number().positive("จำนวนเงินต้องมากกว่า 0").max(999999999.99),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
    note: z.string().max(200).optional(),
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "ต้นทางและปลายทางต้องต่างกัน",
    path: ["toAccountId"],
  });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type TransferInput = z.infer<typeof transferSchema>;

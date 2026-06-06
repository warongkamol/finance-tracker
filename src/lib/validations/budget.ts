import { z } from "zod";

export const budgetItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "กรุณากรอกชื่อ"),
  type: z.enum(["INCOME", "EXPENSE", "LIABILITY", "SAVING"]),
  amount: z.coerce.number().min(0, "จำนวนเงินต้องไม่ติดลบ"),
  categoryId: z.string().optional().nullable(),
  debtId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});

export const upsertBudgetSchema = z.object({
  items: z.array(budgetItemSchema),
});

export type BudgetItemInput = z.infer<typeof budgetItemSchema>;
export type UpsertBudgetInput = z.infer<typeof upsertBudgetSchema>;

import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(50, "ชื่อยาวเกินไป"),
  type: z.enum(["INCOME", "EXPENSE"]),
  icon: z.string().max(10).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "รูปแบบสีไม่ถูกต้อง").optional(),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(50).optional(),
  icon: z.string().max(10).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "รูปแบบสีไม่ถูกต้อง").nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

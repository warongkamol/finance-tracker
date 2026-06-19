import { z } from "zod";

export const createDebtSchema = z.object({
  name: z.string().min(1, "กรุณาใส่ชื่อรายการ").max(100, "ชื่อยาวเกินไป"),
  totalAmount: z
    .number()
    .positive("จำนวนเงินต้องมากกว่า 0")
    .max(999999999.99, "จำนวนเงินเกินขีดจำกัด"),
  totalMonths: z
    .number()
    .int("จำนวนงวดต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวนงวดต้องมากกว่า 0")
    .max(360, "จำนวนงวดเกินขีดจำกัด"),
  monthlyAmount: z
    .number()
    .positive("จำนวนเงินต่องวดต้องมากกว่า 0")
    .max(999999999.99)
    .nullable()
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
  notes: z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
  interestRate: z
    .number()
    .min(0, "อัตราดอกเบี้ยต้องไม่ติดลบ")
    .max(99.99, "อัตราดอกเบี้ยเกินขีดจำกัด")
    .nullable()
    .optional(),
  status: z.literal("PLANNED").optional(),
});

export const updateDebtSchema = createDebtSchema
  .omit({ status: true })
  .partial()
  .extend({
    status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  });

export type CreateDebtInput = z.infer<typeof createDebtSchema>;
export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;

export const confirmPlannedDebtSchema = z.object({
  totalAmount: z
    .number()
    .positive("จำนวนเงินต้องมากกว่า 0")
    .max(999999999.99, "จำนวนเงินเกินขีดจำกัด")
    .optional(),
  totalMonths: z
    .number()
    .int("จำนวนงวดต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวนงวดต้องมากกว่า 0")
    .max(360, "จำนวนงวดเกินขีดจำกัด")
    .optional(),
});

export type ConfirmPlannedDebtInput = z.infer<typeof confirmPlannedDebtSchema>;

export const convertToDebtSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1, "กรุณาเลือกรายการ"),
  totalMonths: z
    .number()
    .int("จำนวนงวดต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวนงวดต้องมากกว่า 0")
    .max(360, "จำนวนงวดเกินขีดจำกัด"),
  interestRate: z.number().min(0).max(99.99).nullable().optional(),
  name: z.string().min(1, "กรุณาใส่ชื่อรายการ").max(100, "ชื่อยาวเกินไป"),
});

export type ConvertToDebtInput = z.infer<typeof convertToDebtSchema>;

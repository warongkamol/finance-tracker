import { z } from "zod";

export const recurringSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อ"),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().positive("จำนวนเงินต้องมากกว่า 0"),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  paymentMethodId: z.string().optional().nullable(),
  frequency: z.enum(["MONTHLY", "YEARLY"]),
  reminderDay: z.number().int().min(1).max(28),
  isLastDayOfMonth: z.boolean(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง"),
  notes: z.string().optional().nullable(),
}).refine(
  (data) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const maxEnd = new Date(start);
    maxEnd.setMonth(maxEnd.getMonth() + 12);
    return end > start && end <= maxEnd;
  },
  { message: "วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น และไม่เกิน 12 เดือน", path: ["endDate"] }
);

export type RecurringInput = z.infer<typeof recurringSchema>;

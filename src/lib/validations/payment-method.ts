import { z } from "zod";

const PAYMENT_METHOD_TYPES = ["CASH", "QR_PAYMENT", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "PAY_LATER", "OTHER"] as const;

export const createPaymentMethodSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อช่องทางชำระเงิน").max(50, "ชื่อยาวเกินไป"),
  type: z.enum(PAYMENT_METHOD_TYPES),
  sortOrder: z.number().int().min(0).optional(),
});

export const updatePaymentMethodSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อช่องทางชำระเงิน").max(50).optional(),
  type: z.enum(PAYMENT_METHOD_TYPES).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

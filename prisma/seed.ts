import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, CategoryType, PaymentMethodType } from "../src/generated/prisma/client";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // Create a system seed user so categories can be linked as defaults
  // In production, categories are cloned per user on register
  // This seed creates a template user for reference
  const seedUserId = "seed-default-user";

  let seedUser = await prisma.user.findUnique({ where: { id: seedUserId } });
  if (!seedUser) {
    seedUser = await prisma.user.create({
      data: {
        id: seedUserId,
        email: "seed@internal.local",
        passwordHash: "not-a-real-hash",
        name: "Seed User",
      },
    });
  }

  // -----------------------------------------------------------------------
  // EXPENSE CATEGORIES
  // -----------------------------------------------------------------------
  const expenseParents = [
    { name: "อาหารและเครื่องดื่ม", icon: "🍽️", color: "#FF6B6B", sortOrder: 1 },
    { name: "เดินทาง/ค่ารถ", icon: "🚗", color: "#4ECDC4", sortOrder: 2 },
    { name: "ที่พักอาศัย", icon: "🏠", color: "#45B7D1", sortOrder: 3 },
    { name: "สาธารณูปโภค", icon: "⚡", color: "#96CEB4", sortOrder: 4 },
    { name: "สุขภาพ/การแพทย์", icon: "🏥", color: "#FFEAA7", sortOrder: 5 },
    { name: "การศึกษา", icon: "📚", color: "#DDA0DD", sortOrder: 6 },
    { name: "บันเทิง", icon: "🎬", color: "#F0A500", sortOrder: 7 },
    { name: "ช้อปปิ้ง", icon: "🛒", color: "#6C5CE7", sortOrder: 8 },
    { name: "ผ่อนชำระ/หนี้สิน", icon: "💳", color: "#E17055", sortOrder: 9 },
    { name: "ประกัน", icon: "🛡️", color: "#00B894", sortOrder: 10 },
    { name: "ออม/ลงทุน", icon: "💰", color: "#FDCB6E", sortOrder: 11 },
    { name: "อื่นๆ", icon: "📌", color: "#B2BEC3", sortOrder: 12 },
  ] as const;

  const expenseSubMap: Record<string, string[]> = {
    "อาหารและเครื่องดื่ม": ["อาหารเช้า", "อาหารเที่ยง", "อาหารเย็น", "กาแฟ/ชา", "ของกินเล่น"],
    "เดินทาง/ค่ารถ": ["น้ำมัน", "ค่าทางด่วน", "ขนส่งสาธารณะ", "Grab/Bolt", "ซ่อมบำรุง"],
    "ที่พักอาศัย": ["ค่าเช่า", "ค่าส่วนกลาง", "ซ่อมแซม"],
    "สาธารณูปโภค": ["ค่าไฟ", "ค่าน้ำ", "ค่าเน็ต/โทรศัพท์"],
    "สุขภาพ/การแพทย์": ["ค่ายา", "ค่าหมอ", "ค่าประกันสุขภาพ"],
    "การศึกษา": ["ค่าเรียน", "หนังสือ/คอร์ส"],
    "บันเทิง": ["หนัง/ซีรีส์", "เกม", "ท่องเที่ยว", "สมาชิกรายเดือน"],
    "ช้อปปิ้ง": ["เสื้อผ้า", "อุปกรณ์ IT", "ของใช้ในบ้าน"],
  };

  for (const parent of expenseParents) {
    const existing = await prisma.category.findFirst({
      where: { userId: seedUserId, name: parent.name, type: CategoryType.EXPENSE, parentId: null },
    });

    const parentRecord = existing
      ? existing
      : await prisma.category.create({
          data: {
            name: parent.name,
            type: CategoryType.EXPENSE,
            icon: parent.icon,
            color: parent.color,
            sortOrder: parent.sortOrder,
            isDefault: true,
            userId: seedUserId,
          },
        });

    const subNames = expenseSubMap[parent.name] ?? [];
    for (let i = 0; i < subNames.length; i++) {
      const subName = subNames[i];
      const existingSub = await prisma.category.findFirst({
        where: { userId: seedUserId, name: subName, parentId: parentRecord.id },
      });
      if (!existingSub) {
        await prisma.category.create({
          data: {
            name: subName,
            type: CategoryType.EXPENSE,
            parentId: parentRecord.id,
            sortOrder: i + 1,
            isDefault: true,
            userId: seedUserId,
          },
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // INCOME CATEGORIES
  // -----------------------------------------------------------------------
  const incomeParents = [
    { name: "เงินเดือน", icon: "💼", color: "#00B894", sortOrder: 1 },
    { name: "รายได้เสริม/ฟรีแลนซ์", icon: "💻", color: "#00CEC9", sortOrder: 2 },
    { name: "ขายของ", icon: "🏷️", color: "#6C5CE7", sortOrder: 3 },
    { name: "ดอกเบี้ย/เงินปันผล", icon: "📈", color: "#FDCB6E", sortOrder: 4 },
    { name: "เงินคืน/Refund", icon: "🔄", color: "#A29BFE", sortOrder: 5 },
    { name: "อื่นๆ", icon: "📌", color: "#B2BEC3", sortOrder: 6 },
  ] as const;

  for (const parent of incomeParents) {
    const existing = await prisma.category.findFirst({
      where: { userId: seedUserId, name: parent.name, type: CategoryType.INCOME, parentId: null },
    });
    if (!existing) {
      await prisma.category.create({
        data: {
          name: parent.name,
          type: CategoryType.INCOME,
          icon: parent.icon,
          color: parent.color,
          sortOrder: parent.sortOrder,
          isDefault: true,
          userId: seedUserId,
        },
      });
    }
  }

  // -----------------------------------------------------------------------
  // DEFAULT PAYMENT METHODS
  // -----------------------------------------------------------------------
  const paymentMethods = [
    { name: "เงินสด", type: PaymentMethodType.CASH, isDefault: true, sortOrder: 1 },
    { name: "QR Payment / PromptPay", type: PaymentMethodType.QR_PAYMENT, isDefault: true, sortOrder: 2 },
    { name: "โอนธนาคาร", type: PaymentMethodType.BANK_TRANSFER, isDefault: true, sortOrder: 3 },
    { name: "บัตรเครดิต", type: PaymentMethodType.CREDIT_CARD, isDefault: true, sortOrder: 4 },
    { name: "บัตรเดบิต", type: PaymentMethodType.DEBIT_CARD, isDefault: true, sortOrder: 5 },
    { name: "อื่นๆ", type: PaymentMethodType.OTHER, isDefault: true, sortOrder: 6 },
  ] as const;

  for (const pm of paymentMethods) {
    const existing = await prisma.paymentMethod.findFirst({
      where: { userId: seedUserId, name: pm.name },
    });
    if (!existing) {
      await prisma.paymentMethod.create({
        data: { ...pm, userId: seedUserId },
      });
    }
  }

  console.log("✅ Seed completed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

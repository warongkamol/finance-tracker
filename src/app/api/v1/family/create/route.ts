import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/family";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "กรุณาตั้งชื่อกลุ่ม").max(50, "ชื่อกลุ่มยาวเกินไป"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "กรุณาตั้งชื่อกลุ่ม" } },
        { status: 400 }
      );
    }

    // Generate unique invite code
    let inviteCode = generateInviteCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.familyGroup.findUnique({ where: { inviteCode } });
      if (!existing) break;
      inviteCode = generateInviteCode();
      attempts++;
    }

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.familyGroup.create({ data: { inviteCode, name: parsed.data.name } });
      await tx.userFamilyGroup.create({
        data: { userId: session.user.id, groupId: created.id },
      });
      return created;
    });

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: group.id,
          inviteCode: group.inviteCode,
          name: group.name,
          displayName: group.name,
          members: [{ id: session.user.id, name: session.user.name, email: session.user.email, isMe: true }],
        },
      },
    }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

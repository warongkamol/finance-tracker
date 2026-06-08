import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const joinSchema = z.object({ code: z.string().min(1).max(20) });

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
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "รหัสไม่ถูกต้อง" } },
        { status: 400 }
      );
    }

    const group = await prisma.familyGroup.findUnique({
      where: { inviteCode: parsed.data.code.toUpperCase() },
      include: { memberships: { select: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (!group) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบกลุ่มครอบครัว รหัสอาจไม่ถูกต้อง" } },
        { status: 404 }
      );
    }

    const existingMembership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId: group.id } },
    });
    if (existingMembership) {
      return NextResponse.json(
        { success: false, error: { code: "ALREADY_MEMBER", message: "คุณอยู่ในกลุ่มนี้แล้ว" } },
        { status: 400 }
      );
    }

    await prisma.userFamilyGroup.create({
      data: { userId: session.user.id, groupId: group.id },
    });

    const updatedMembers = [
      ...group.memberships.map(({ user: m }) => ({ ...m, isMe: m.id === session.user.id })),
      { id: session.user.id, name: session.user.name, email: session.user.email, isMe: true },
    ];

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: group.id,
          inviteCode: group.inviteCode,
          name: group.name,
          displayName: group.name,
          members: updatedMembers,
        },
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}

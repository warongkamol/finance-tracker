import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "ไม่พบผู้ใช้" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: user });
}

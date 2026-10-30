import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";

export async function requireRole(userId: string, allowedRoles: UserRole[]) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user || !allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: "Không có quyền thực hiện thao tác này" },
      { status: 403 }
    );
  }

  return null;
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const type = request.nextUrl.searchParams.get("type");

  const reports = await prisma.report.findMany({
    where: {
      userId: session!.user.id,
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({ reports });
}

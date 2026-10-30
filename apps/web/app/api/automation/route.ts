import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { automationRuleSchema } from "@/lib/validations/schemas";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rules = await prisma.automationRule.findMany({
    where: { userId: session!.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = automationRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rule = await prisma.automationRule.create({
    data: {
      userId: session!.user.id,
      name: parsed.data.name,
      conditionJson: parsed.data.conditionJson as Prisma.InputJsonValue,
      actionJson: parsed.data.actionJson as Prisma.InputJsonValue,
      isActive: parsed.data.isActive,
      isAutoPilot: parsed.data.isAutoPilot,
      maxBudget: parsed.data.maxBudget,
    },
  });

  return NextResponse.json({ rule }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id, ...data } = await request.json();

  await prisma.automationRule.updateMany({
    where: { id, userId: session!.user.id },
    data,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.automationRule.deleteMany({
    where: { id, userId: session!.user.id },
  });

  return NextResponse.json({ success: true });
}

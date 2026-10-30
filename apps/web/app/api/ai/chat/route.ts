import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { chatMessageSchema } from "@/lib/validations/schemas";
import { buildAIContext } from "@/lib/ai/build-context";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = chatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const context =
    (await buildAIContext({
      userId: session!.user.id,
      campaignIds: parsed.data.campaignIds,
      adIds: parsed.data.adIds,
      insightsDays: 7,
    })) || {};

  await prisma.aIChatMessage.create({
    data: {
      userId: session!.user.id,
      model: parsed.data.model,
      role: "user",
      content: parsed.data.message,
      contextSnapshot: context,
    },
  });

  try {
    const response = await fetch(`${AI_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: parsed.data.message,
        model: parsed.data.model,
        context,
        language: "vi",
        history: await prisma.aIChatMessage.findMany({
          where: { userId: session!.user.id },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { role: true, content: true },
        }),
      }),
    });

    const data = await response.json();

    await prisma.aIChatMessage.create({
      data: {
        userId: session!.user.id,
        model: data.model || parsed.data.model,
        role: "assistant",
        content: data.response,
      },
    });

    return NextResponse.json({ response: data.response, model: data.model });
  } catch {
    return NextResponse.json(
      { error: "AI service không khả dụng. Kiểm tra docker-compose." },
      { status: 503 }
    );
  }
}

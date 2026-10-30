import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getSelectedAdAccount } from "@/lib/auth";
import { buildAnalyzePayload } from "@/lib/ai/build-context";
import { analyzeRequestSchema } from "@/lib/validations/schemas";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const status = request.nextUrl.searchParams.get("status");
  const recommendations = await prisma.aIRecommendation.findMany({
    where: {
      userId: session!.user.id,
      ...(status ? { status: status as "PENDING" | "APPLIED" | "REJECTED" } : {}),
    },
    include: { campaign: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ recommendations });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await request.json();
  const parsed = analyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { type, campaignIds, adIds } = parsed.data;
  const adAccount = await getSelectedAdAccount(session!.user.id);

  if (!adAccount) {
    return NextResponse.json({ error: "Chưa chọn Ad Account" }, { status: 400 });
  }

  const payload = await buildAnalyzePayload(
    session!.user.id,
    type,
    campaignIds,
    adIds
  );

  if (!payload) {
    return NextResponse.json({ error: "Không tải được dữ liệu" }, { status: 400 });
  }

  try {
    const response = await fetch(`${AI_SERVICE_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        campaigns: payload.campaigns,
        accountInsights: payload.accountInsights,
        ads: payload.ads,
        selection: payload.selection,
        language: "vi",
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const result = await response.json();
    const saved = [];

    for (const rec of result.recommendations || []) {
      const savedRec = await prisma.aIRecommendation.create({
        data: {
          userId: session!.user.id,
          campaignId: rec.campaignId || null,
          type: rec.type,
          confidence: rec.confidence,
          reasoningVi: rec.reasoningVi,
          suggestedAction: rec.suggestedAction,
          modelSource: result.model || "gemini",
          consensusData: result.consensusData || null,
        },
        include: { campaign: { select: { name: true } } },
      });
      saved.push(savedRec);
    }

    return NextResponse.json({ recommendations: saved, analysis: result.analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

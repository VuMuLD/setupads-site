import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getFacebookAccessToken, getSelectedAdAccount } from "@/lib/auth";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import { createAuditLog } from "@/lib/security/audit-log";
import { getClientIp } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { recommendationId } = await request.json();

  const recommendation = await prisma.aIRecommendation.findFirst({
    where: { id: recommendationId, userId: session!.user.id },
    include: { campaign: true },
  });

  if (!recommendation) {
    return NextResponse.json({ error: "Đề xuất không tồn tại" }, { status: 404 });
  }

  if (recommendation.status !== "PENDING") {
    return NextResponse.json({ error: "Đề xuất đã được xử lý" }, { status: 400 });
  }

  const accessToken = await getFacebookAccessToken(session!.user.id);
  const adAccount = await getSelectedAdAccount(session!.user.id);

  if (!accessToken || !adAccount || !recommendation.campaign) {
    return NextResponse.json({ error: "Không thể thực thi" }, { status: 400 });
  }

  const client = new FacebookGraphClient(accessToken);
  const action = recommendation.suggestedAction as Record<string, unknown>;

  try {
    if (recommendation.type === "PAUSE_CAMPAIGN") {
      await client.pauseCampaign(recommendation.campaign.fbCampaignId, adAccount.fbAdAccountId);
      await prisma.campaign.update({
        where: { id: recommendation.campaign.id },
        data: { status: "PAUSED" },
      });
    } else if (recommendation.type === "RESUME_CAMPAIGN") {
      await client.resumeCampaign(recommendation.campaign.fbCampaignId, adAccount.fbAdAccountId);
      await prisma.campaign.update({
        where: { id: recommendation.campaign.id },
        data: { status: "ACTIVE" },
      });
    } else if (
      recommendation.type === "INCREASE_BUDGET" ||
      recommendation.type === "DECREASE_BUDGET"
    ) {
      const newBudget = action.newBudget as number;
      if (newBudget) {
        await client.updateCampaign(
          recommendation.campaign.fbCampaignId,
          adAccount.fbAdAccountId,
          { daily_budget: newBudget * 100 }
        );
        await prisma.campaign.update({
          where: { id: recommendation.campaign.id },
          data: { dailyBudget: newBudget },
        });
      }
    }

    await prisma.aIRecommendation.update({
      where: { id: recommendationId },
      data: { status: "APPLIED", appliedAt: new Date() },
    });

    await createAuditLog({
      userId: session!.user.id,
      action: "APPLY_AI_RECOMMENDATION",
      entityType: "AIRecommendation",
      entityId: recommendationId,
      afterData: { type: recommendation.type, action },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { recommendationId, status } = await request.json();

  await prisma.aIRecommendation.updateMany({
    where: { id: recommendationId, userId: session!.user.id },
    data: { status },
  });

  return NextResponse.json({ success: true });
}

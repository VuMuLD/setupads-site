import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getSelectedAdAccount } from "@/lib/auth";
import { analyzeCampaign } from "@/lib/analysis/campaign-analysis";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const adAccount = await getSelectedAdAccount(session!.user.id);
  if (!adAccount) {
    return NextResponse.json({ error: "Chưa chọn Ad Account" }, { status: 400 });
  }

  const campaign = await prisma.campaign.findFirst({
    where: {
      id: params.id,
      adAccountId: adAccount.id,
      deletedAt: null,
    },
    include: {
      insights: { orderBy: { date: "desc" }, take: 30 },
      adSets: {
        where: { deletedAt: null },
        include: {
          ads: { where: { deletedAt: null }, select: { id: true, name: true, status: true, creative: true } },
        },
      },
      adAccount: { select: { name: true, currency: true } },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign không tồn tại" }, { status: 404 });
  }

  const analysis = analyzeCampaign(campaign);

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      lastSyncedAt: campaign.lastSyncedAt,
      adAccount: campaign.adAccount,
    },
    insights: campaign.insights,
    adSets: campaign.adSets,
    analysis,
  });
}

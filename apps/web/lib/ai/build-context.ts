import { getFacebookAccessToken, getSelectedAdAccount } from "@/lib/auth";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import {
  calcRoas,
  extractConversions,
  extractRevenue,
} from "@/lib/facebook/insights-utils";
import { prisma } from "@/lib/prisma";

export interface AIContextOptions {
  userId: string;
  campaignIds?: string[];
  adIds?: string[];
  insightsDays?: number;
}

function summarizeCreative(creative: unknown) {
  if (!creative || typeof creative !== "object") return {};
  const c = creative as Record<string, unknown>;
  const body = typeof c.body === "string" ? c.body : "";
  return {
    title: typeof c.title === "string" ? c.title : undefined,
    body: body ? body.slice(0, 120) : undefined,
    thumbnailUrl: typeof c.thumbnail_url === "string" ? c.thumbnail_url : undefined,
    cta: typeof c.call_to_action_type === "string" ? c.call_to_action_type : undefined,
  };
}

function parseFbInsightRow(row?: {
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}) {
  if (!row) {
    return {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      roas: 0,
      cpc: 0,
      ctr: 0,
    };
  }
  const spend = parseFloat(row.spend || "0");
  const revenue = extractRevenue(row.action_values);
  const conversions = extractConversions(row.actions);
  return {
    spend: Math.round(spend),
    impressions: parseInt(row.impressions || "0", 10),
    clicks: parseInt(row.clicks || "0", 10),
    conversions,
    roas: Math.round(calcRoas(revenue, spend) * 100) / 100,
    cpc: Math.round(parseFloat(row.cpc || "0")),
    ctr: Math.round(parseFloat(row.ctr || "0") * 100) / 100,
  };
}

export async function buildAIContext(options: AIContextOptions) {
  const adAccount = await getSelectedAdAccount(options.userId);
  if (!adAccount) return null;

  const hasSelection =
    (options.campaignIds?.length ?? 0) > 0 || (options.adIds?.length ?? 0) > 0;
  const datePreset =
    options.insightsDays && options.insightsDays <= 7 ? "last_7d" : "last_30d";
  const insightTake = options.insightsDays && options.insightsDays <= 7 ? 7 : 30;

  const campaignWhere = {
    adAccountId: adAccount.id,
    deletedAt: null,
    ...(options.campaignIds?.length ? { id: { in: options.campaignIds } } : {}),
  };

  const campaigns = await prisma.campaign.findMany({
    where: campaignWhere,
    include: {
      insights: { orderBy: { date: "desc" as const }, take: insightTake },
      _count: { select: { adSets: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: hasSelection && options.campaignIds?.length ? undefined : 20,
  });

  const adWhere = {
    deletedAt: null,
    adSet: {
      campaign: {
        adAccountId: adAccount.id,
        deletedAt: null,
        ...(options.campaignIds?.length ? { id: { in: options.campaignIds } } : {}),
      },
      deletedAt: null,
    },
    ...(options.adIds?.length ? { id: { in: options.adIds } } : {}),
    ...(!options.adIds?.length && hasSelection ? {} : {}),
  };

  const shouldLoadAds = hasSelection || options.adIds?.length;
  let ads = shouldLoadAds
    ? await prisma.ad.findMany({
        where: adWhere,
        include: {
          adSet: {
            select: {
              id: true,
              name: true,
              status: true,
              campaign: { select: { id: true, name: true, status: true } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      })
    : await prisma.ad.findMany({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          adSet: {
            campaign: { adAccountId: adAccount.id, deletedAt: null },
            deletedAt: null,
          },
        },
        include: {
          adSet: {
            select: {
              id: true,
              name: true,
              status: true,
              campaign: { select: { id: true, name: true, status: true } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 15,
      });

  const accessToken = await getFacebookAccessToken(options.userId);
  const adMetrics = new Map<string, ReturnType<typeof parseFbInsightRow>>();

  if (accessToken && ads.length) {
    const client = new FacebookGraphClient(accessToken);
    const toFetch = ads.slice(0, 25);
    await Promise.all(
      toFetch.map(async (ad) => {
        try {
          const res = await client.getAdInsights(
            ad.fbAdId,
            adAccount.fbAdAccountId,
            datePreset
          );
          adMetrics.set(ad.id, parseFbInsightRow(res.data[0]));
        } catch {
          adMetrics.set(ad.id, parseFbInsightRow());
        }
      })
    );
  }

  let totalSpend = 0;
  let totalClicks = 0;
  let roasSum = 0;
  let roasN = 0;

  const campaignSummaries = campaigns.map((c) => {
    const spend = c.insights.reduce((s, i) => s + i.spend, 0);
    const clicks = c.insights.reduce((s, i) => s + i.clicks, 0);
    const conversions = c.insights.reduce((s, i) => s + i.conversions, 0);
    const avgRoas = c.insights.length
      ? c.insights.reduce((s, i) => s + i.roas, 0) / c.insights.length
      : 0;
    const avgCtr = c.insights.length
      ? c.insights.reduce((s, i) => s + i.ctr, 0) / c.insights.length
      : 0;
    totalSpend += spend;
    totalClicks += clicks;
    if (avgRoas) {
      roasSum += avgRoas;
      roasN++;
    }
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      dailyBudget: c.dailyBudget,
      adSets: c._count.adSets,
      spend7d: Math.round(spend),
      clicks7d: clicks,
      conversions7d: conversions,
      roas: Math.round(avgRoas * 100) / 100,
      ctr: Math.round(avgCtr * 10000) / 100,
    };
  });

  const adSummaries = ads.map((ad) => {
    const metrics = adMetrics.get(ad.id) || parseFbInsightRow();
    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      campaignId: ad.adSet.campaign.id,
      campaignName: ad.adSet.campaign.name,
      adSetId: ad.adSet.id,
      adSetName: ad.adSet.name,
      creative: summarizeCreative(ad.creative),
      metrics,
    };
  });

  const selectedAdSpend = adSummaries.reduce((s, a) => s + a.metrics.spend, 0);

  return {
    adAccount: adAccount.name,
    currency: adAccount.currency,
    selection: {
      campaignIds: options.campaignIds || [],
      adIds: options.adIds || [],
      focused: hasSelection,
    },
    summary: {
      campaigns: campaigns.length,
      ads: adSummaries.length,
      spend7d: Math.round(totalSpend),
      selectedAdSpend,
      avgRoas: roasN ? Math.round((roasSum / roasN) * 100) / 100 : 0,
      avgCpc: totalClicks > 0 ? Math.round(totalSpend / totalClicks) : 0,
    },
    campaigns: campaignSummaries,
    ads: adSummaries,
  };
}

export async function buildAnalyzePayload(
  userId: string,
  type: "daily" | "weekly",
  campaignIds?: string[],
  adIds?: string[]
) {
  const adAccount = await getSelectedAdAccount(userId);
  if (!adAccount) return null;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const hasSelection =
    (campaignIds?.length ?? 0) > 0 || (adIds?.length ?? 0) > 0;

  const campaigns = await prisma.campaign.findMany({
    where: {
      adAccountId: adAccount.id,
      deletedAt: null,
      ...(campaignIds?.length ? { id: { in: campaignIds } } : {}),
    },
    include: {
      insights: {
        where: { date: { gte: thirtyDaysAgo } },
        orderBy: { date: "asc" },
      },
    },
    take: hasSelection && campaignIds?.length ? undefined : 50,
  });

  const dailyInsights = await prisma.dailyInsight.findMany({
    where: { adAccountId: adAccount.id, date: { gte: thirtyDaysAgo } },
    orderBy: { date: "asc" },
  });

  const context = await buildAIContext({
    userId,
    campaignIds,
    adIds,
    insightsDays: type === "daily" ? 7 : 30,
  });

  return {
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      dailyBudget: c.dailyBudget,
      insights: c.insights,
    })),
    accountInsights: dailyInsights,
    ads: context?.ads || [],
    selection: context?.selection,
  };
}

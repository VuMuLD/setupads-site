import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import {
  calcRoas,
  centsToCurrency,
  extractConversions,
  extractRevenue,
} from "@/lib/facebook/insights-utils";
import { prisma } from "@/lib/prisma";
import type { CampaignStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";

function mapStatus(fbStatus: string): CampaignStatus {
  if (fbStatus === "ACTIVE") return "ACTIVE";
  if (fbStatus === "PAUSED") return "PAUSED";
  if (fbStatus === "ARCHIVED") return "ARCHIVED";
  return "PAUSED";
}

export async function syncAllAdAccountsForUser(userId: string, accessToken: string) {
  const adAccounts = await prisma.adAccount.findMany({
    where: {
      isActive: true,
      facebookAccount: { userId, isActive: true },
    },
  });

  if (!adAccounts.length) {
    throw new Error("Chưa có tài khoản quảng cáo. Hãy kết nối Facebook trong Cài đặt.");
  }

  let campaignsSynced = 0;
  let insightsSynced = 0;
  let adSetsSynced = 0;
  let adsSynced = 0;

  for (const adAccount of adAccounts) {
    const result = await syncAdAccountData(adAccount.id, accessToken);
    campaignsSynced += result.campaignsSynced;
    insightsSynced += result.insightsSynced;
    adSetsSynced += result.adSetsSynced;
    adsSynced += result.adsSynced;
  }

  return {
    accountsSynced: adAccounts.length,
    campaignsSynced,
    insightsSynced,
    adSetsSynced,
    adsSynced,
  };
}

export async function syncAdAccountData(adAccountId: string, accessToken: string) {
  const adAccount = await prisma.adAccount.findUnique({
    where: { id: adAccountId },
  });
  if (!adAccount) throw new Error("Ad Account not found");

  const client = new FacebookGraphClient(accessToken);
  let campaignsSynced = 0;
  let insightsSynced = 0;
  let adSetsSynced = 0;
  let adsSynced = 0;

  const fbCampaigns = await client.getCampaigns(adAccount.fbAdAccountId);

  for (const fbCampaign of fbCampaigns.data) {
    const setupConfig = {
      buyingType: fbCampaign.buying_type,
      bidStrategy: fbCampaign.bid_strategy,
      specialAdCategories: fbCampaign.special_ad_categories,
    };

    const campaign = await prisma.campaign.upsert({
      where: {
        adAccountId_fbCampaignId: {
          adAccountId: adAccount.id,
          fbCampaignId: fbCampaign.id,
        },
      },
      create: {
        adAccountId: adAccount.id,
        fbCampaignId: fbCampaign.id,
        name: fbCampaign.name,
        status: mapStatus(fbCampaign.status),
        objective: fbCampaign.objective,
        dailyBudget: centsToCurrency(fbCampaign.daily_budget),
        lifetimeBudget: centsToCurrency(fbCampaign.lifetime_budget),
        startTime: fbCampaign.start_time ? new Date(fbCampaign.start_time) : null,
        stopTime: fbCampaign.stop_time ? new Date(fbCampaign.stop_time) : null,
        buyingType: fbCampaign.buying_type ?? null,
        bidStrategy: fbCampaign.bid_strategy ?? null,
        setupConfig: setupConfig as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
      update: {
        name: fbCampaign.name,
        status: mapStatus(fbCampaign.status),
        objective: fbCampaign.objective,
        dailyBudget: centsToCurrency(fbCampaign.daily_budget),
        lifetimeBudget: centsToCurrency(fbCampaign.lifetime_budget),
        buyingType: fbCampaign.buying_type ?? null,
        bidStrategy: fbCampaign.bid_strategy ?? null,
        setupConfig: setupConfig as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
    });

    campaignsSynced++;

    const insights = await client.getCampaignInsights(
      fbCampaign.id,
      adAccount.fbAdAccountId,
      "last_30d"
    );

    for (const insight of insights.data) {
      const conversions = extractConversions(insight.actions);
      const revenue = extractRevenue(insight.action_values);
      const spend = parseFloat(insight.spend || "0");

      await prisma.campaignInsight.upsert({
        where: {
          campaignId_date: {
            campaignId: campaign.id,
            date: new Date(insight.date_start),
          },
        },
        create: {
          campaignId: campaign.id,
          date: new Date(insight.date_start),
          spend,
          impressions: parseInt(insight.impressions || "0"),
          clicks: parseInt(insight.clicks || "0"),
          conversions,
          cpc: parseFloat(insight.cpc || "0"),
          cpm: parseFloat(insight.cpm || "0"),
          ctr: parseFloat(insight.ctr || "0") / 100,
          roas: calcRoas(revenue, spend),
          reach: parseInt(insight.reach || "0"),
        },
        update: {
          spend,
          impressions: parseInt(insight.impressions || "0"),
          clicks: parseInt(insight.clicks || "0"),
          conversions,
          cpc: parseFloat(insight.cpc || "0"),
          cpm: parseFloat(insight.cpm || "0"),
          ctr: parseFloat(insight.ctr || "0") / 100,
          roas: calcRoas(revenue, spend),
        },
      });
      insightsSynced++;
    }

    const fbAdSets = await client.getAdSets(fbCampaign.id, adAccount.fbAdAccountId);
    for (const fbAdSet of fbAdSets.data) {
      const adSetSetup = {
        optimizationGoal: fbAdSet.optimization_goal,
        billingEvent: fbAdSet.billing_event,
        promotedObject: fbAdSet.promoted_object,
        destinationType: fbAdSet.destination_type,
        startTime: fbAdSet.start_time,
        endTime: fbAdSet.end_time,
        targetingSummary: summarizeTargeting(fbAdSet.targeting),
      };

      const adSet = await prisma.adSet.upsert({
        where: {
          campaignId_fbAdSetId: {
            campaignId: campaign.id,
            fbAdSetId: fbAdSet.id,
          },
        },
        create: {
          campaignId: campaign.id,
          fbAdSetId: fbAdSet.id,
          name: fbAdSet.name,
          status: mapStatus(fbAdSet.status),
          dailyBudget: centsToCurrency(fbAdSet.daily_budget),
          lifetimeBudget: centsToCurrency(fbAdSet.lifetime_budget),
          bidAmount: centsToCurrency(fbAdSet.bid_amount),
          bidStrategy: fbAdSet.bid_strategy ?? null,
          billingEvent: fbAdSet.billing_event ?? null,
          optimizationGoal: fbAdSet.optimization_goal ?? null,
          targeting: (fbAdSet.targeting ?? undefined) as Prisma.InputJsonValue | undefined,
          setupConfig: adSetSetup as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
        update: {
          name: fbAdSet.name,
          status: mapStatus(fbAdSet.status),
          dailyBudget: centsToCurrency(fbAdSet.daily_budget),
          lifetimeBudget: centsToCurrency(fbAdSet.lifetime_budget),
          bidAmount: centsToCurrency(fbAdSet.bid_amount),
          bidStrategy: fbAdSet.bid_strategy ?? null,
          billingEvent: fbAdSet.billing_event ?? null,
          optimizationGoal: fbAdSet.optimization_goal ?? null,
          targeting: (fbAdSet.targeting ?? undefined) as Prisma.InputJsonValue | undefined,
          setupConfig: adSetSetup as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });
      adSetsSynced++;

      const fbAds = await client.getAds(fbAdSet.id, adAccount.fbAdAccountId);
      for (const fbAd of fbAds.data) {
        await prisma.ad.upsert({
          where: {
            adSetId_fbAdId: {
              adSetId: adSet.id,
              fbAdId: fbAd.id,
            },
          },
          create: {
            adSetId: adSet.id,
            fbAdId: fbAd.id,
            name: fbAd.name,
            status: mapStatus(fbAd.status),
            creative: (fbAd.creative ?? undefined) as Prisma.InputJsonValue | undefined,
            lastSyncedAt: new Date(),
          },
          update: {
            name: fbAd.name,
            status: mapStatus(fbAd.status),
            creative: (fbAd.creative ?? undefined) as Prisma.InputJsonValue | undefined,
            lastSyncedAt: new Date(),
          },
        });
        adsSynced++;
      }
    }
  }

  const accountInsights = await client.getAccountInsights(adAccount.fbAdAccountId, "last_30d");
  for (const insight of accountInsights.data) {
    const spend = parseFloat(insight.spend || "0");
    const revenue = extractRevenue(insight.action_values);
    const conversions = extractConversions(insight.actions);

    await prisma.dailyInsight.upsert({
      where: {
        adAccountId_date: {
          adAccountId: adAccount.id,
          date: new Date(insight.date_start),
        },
      },
      create: {
        adAccountId: adAccount.id,
        date: new Date(insight.date_start),
        spend,
        impressions: parseInt(insight.impressions || "0"),
        clicks: parseInt(insight.clicks || "0"),
        conversions,
        cpc: parseFloat(insight.cpc || "0"),
        cpm: parseFloat(insight.cpm || "0"),
        ctr: parseFloat(insight.ctr || "0") / 100,
        roas: calcRoas(revenue, spend),
      },
      update: {
        spend,
        impressions: parseInt(insight.impressions || "0"),
        clicks: parseInt(insight.clicks || "0"),
        conversions,
        roas: calcRoas(revenue, spend),
      },
    });
  }

  return { campaignsSynced, insightsSynced, adSetsSynced, adsSynced };
}

function summarizeTargeting(targeting?: Record<string, unknown>): Record<string, unknown> {
  if (!targeting) return {};
  const geo = targeting.geo_locations as { countries?: string[]; cities?: unknown[] } | undefined;
  const ageMin = targeting.age_min;
  const ageMax = targeting.age_max;
  const genders = targeting.genders;
  const interests = targeting.flexible_spec as unknown[] | undefined;

  return {
    countries: geo?.countries,
    ageRange: ageMin || ageMax ? `${ageMin ?? "?"}-${ageMax ?? "?"}` : null,
    genders,
    interestGroups: interests?.length ?? 0,
  };
}

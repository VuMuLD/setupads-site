import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardOverview } from "@/components/dashboard/overview";
import { prisma } from "@/lib/prisma";
import { getSelectedAdAccount } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const adAccount = await getSelectedAdAccount(session.user.id);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let metrics = {
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    roas: 0,
    cpc: 0,
    ctr: 0,
    cpm: 0,
  };

  let chartData: Array<{ date: string; spend: number; roas: number }> = [];
  let recentRecommendations: Awaited<ReturnType<typeof prisma.aIRecommendation.findMany>> = [];

  if (adAccount) {
    const insights = await prisma.dailyInsight.findMany({
      where: {
        adAccountId: adAccount.id,
        date: { gte: thirtyDaysAgo },
      },
      orderBy: { date: "asc" },
    });

    for (const insight of insights) {
      metrics.spend += insight.spend;
      metrics.impressions += insight.impressions;
      metrics.clicks += insight.clicks;
      metrics.conversions += insight.conversions;
      chartData.push({
        date: insight.date.toISOString().split("T")[0],
        spend: insight.spend,
        roas: insight.roas,
      });
    }

    if (metrics.clicks > 0) {
      metrics.cpc = metrics.spend / metrics.clicks;
      metrics.ctr = metrics.clicks / metrics.impressions;
    }
    if (metrics.impressions > 0) {
      metrics.cpm = (metrics.spend / metrics.impressions) * 1000;
    }

    recentRecommendations = await prisma.aIRecommendation.findMany({
      where: { userId: session.user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { campaign: true },
    });
  }

  const campaignCount = adAccount
    ? await prisma.campaign.count({
        where: { adAccountId: adAccount.id, deletedAt: null },
      })
    : 0;

  return (
    <DashboardLayout>
      <DashboardOverview
        metrics={metrics}
        chartData={chartData}
        campaignCount={campaignCount}
        adAccountName={adAccount?.name}
        recommendations={recentRecommendations}
      />
    </DashboardLayout>
  );
}

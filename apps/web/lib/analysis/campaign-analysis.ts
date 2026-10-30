export interface OptimizationTip {
  id: string;
  severity: "info" | "warning" | "success" | "critical";
  category: "budget" | "bid" | "creative" | "targeting" | "setup";
  title: string;
  description: string;
  suggestedAction?: string;
}

export interface CampaignAnalysis {
  summary: {
    totalSpend: number;
    totalClicks: number;
    totalImpressions: number;
    totalConversions: number;
    avgCtr: number;
    avgCpc: number;
    avgRoas: number;
    daysWithData: number;
  };
  setup: {
    objective: string | null;
    buyingType: string | null;
    bidStrategy: string | null;
    dailyBudget: number | null;
    lifetimeBudget: number | null;
    startTime: string | null;
    stopTime: string | null;
    adSetsCount: number;
    adsCount: number;
    adSetDetails: Array<{
      id: string;
      name: string;
      status: string;
      dailyBudget: number | null;
      bidAmount: number | null;
      bidStrategy: string | null;
      optimizationGoal: string | null;
      billingEvent: string | null;
      targetingSummary: Record<string, unknown>;
    }>;
  };
  optimizationTips: OptimizationTip[];
}

interface InsightRow {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  cpc: number;
  roas: number;
}

interface AdSetRow {
  id: string;
  name: string;
  status: string;
  dailyBudget: number | null;
  bidAmount: number | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  setupConfig: unknown;
  ads: { id: string }[];
}

interface CampaignRow {
  objective: string | null;
  buyingType: string | null;
  bidStrategy: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: Date | null;
  stopTime: Date | null;
  insights: InsightRow[];
  adSets: AdSetRow[];
}

export function analyzeCampaign(campaign: CampaignRow): CampaignAnalysis {
  const insights = campaign.insights;
  const totalSpend = insights.reduce((s, i) => s + i.spend, 0);
  const totalClicks = insights.reduce((s, i) => s + i.clicks, 0);
  const totalImpressions = insights.reduce((s, i) => s + i.impressions, 0);
  const totalConversions = insights.reduce((s, i) => s + i.conversions, 0);
  const avgCtr = insights.length
    ? insights.reduce((s, i) => s + i.ctr, 0) / insights.length
    : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const avgRoas = insights.length
    ? insights.reduce((s, i) => s + i.roas, 0) / insights.length
    : 0;

  const adsCount = campaign.adSets.reduce((s, a) => s + a.ads.length, 0);
  const tips: OptimizationTip[] = [];

  if (totalSpend > 0 && totalConversions === 0) {
    tips.push({
      id: "no-conversions",
      severity: "critical",
      category: "setup",
      title: "Chi tiêu nhưng chưa có chuyển đổi",
      description:
        "Campaign đã chi tiêu trong 30 ngày nhưng chưa ghi nhận conversion. Kiểm tra pixel, mục tiêu tối ưu và landing page.",
      suggestedAction: "Xem lại optimization goal và pixel trong phần Setup bên dưới.",
    });
  }

  if (avgCtr > 0 && avgCtr < 0.008) {
    tips.push({
      id: "low-ctr",
      severity: "warning",
      category: "creative",
      title: "CTR thấp",
      description: `CTR trung bình ${(avgCtr * 100).toFixed(2)}% — thử đổi creative, headline hoặc CTA.`,
      suggestedAction: "Tối ưu hình ảnh/video và copy quảng cáo.",
    });
  }

  if (avgCpc > 5000 && totalClicks > 20) {
    tips.push({
      id: "high-cpc",
      severity: "warning",
      category: "bid",
      title: "CPC cao",
      description: `CPC trung bình ${Math.round(avgCpc).toLocaleString("vi-VN")} VND. Cân nhắc giảm bid hoặc thu hẹp targeting.`,
      suggestedAction: "Giảm bid amount trên ad set hoặc tạm pause ad set kém hiệu quả.",
    });
  }

  if (avgRoas >= 2 && totalSpend > 100000) {
    tips.push({
      id: "scale-roas",
      severity: "success",
      category: "budget",
      title: "ROAS tốt — có thể tăng ngân sách",
      description: `ROAS trung bình ${avgRoas.toFixed(2)}x. Campaign đang sinh lời, cân nhắc tăng budget 10–20%.`,
      suggestedAction: "Tăng daily budget campaign hoặc ad set top performer.",
    });
  }

  if (avgRoas > 0 && avgRoas < 1 && totalSpend > 200000) {
    tips.push({
      id: "low-roas",
      severity: "critical",
      category: "budget",
      title: "ROAS dưới 1x",
      description: "Chi phí cao hơn doanh thu ước tính. Nên giảm budget hoặc pause để tránh lỗ.",
      suggestedAction: "Giảm ngân sách hoặc tạm dừng campaign.",
    });
  }

  for (const adSet of campaign.adSets) {
    const setup = (adSet.setupConfig ?? {}) as Record<string, unknown>;
    if (!adSet.optimizationGoal) {
      tips.push({
        id: `setup-goal-${adSet.id}`,
        severity: "info",
        category: "setup",
        title: `Ad set "${adSet.name}" thiếu mục tiêu tối ưu rõ ràng`,
        description: "Chưa có optimization goal — kiểm tra cấu hình trên Facebook Ads Manager.",
      });
    }
    if (adSet.bidAmount && adSet.bidAmount > 50000) {
      tips.push({
        id: `bid-${adSet.id}`,
        severity: "info",
        category: "bid",
        title: `Bid cao trên ad set "${adSet.name}"`,
        description: `Bid ${adSet.bidAmount.toLocaleString("vi-VN")} VND — theo dõi CPA thực tế.`,
        suggestedAction: "So sánh cost per result với mục tiêu kinh doanh.",
      });
    }
    const ts = setup.targetingSummary as { interestGroups?: number } | undefined;
    if (ts && ts.interestGroups === 0) {
      tips.push({
        id: `targeting-${adSet.id}`,
        severity: "info",
        category: "targeting",
        title: `Targeting rộng trên "${adSet.name}"`,
        description: "Ít nhóm sở thích — có thể thử thu hẹp audience để giảm CPC.",
      });
    }
  }

  if (!campaign.dailyBudget && !campaign.lifetimeBudget) {
    tips.push({
      id: "no-budget",
      severity: "info",
      category: "setup",
      title: "Budget ở cấp ad set",
      description:
        "Campaign dùng budget ad set (CBO tắt). Kiểm tra ngân sách từng ad set trong Setup.",
    });
  }

  return {
    summary: {
      totalSpend,
      totalClicks,
      totalImpressions,
      totalConversions,
      avgCtr,
      avgCpc,
      avgRoas,
      daysWithData: insights.length,
    },
    setup: {
      objective: campaign.objective,
      buyingType: campaign.buyingType,
      bidStrategy: campaign.bidStrategy,
      dailyBudget: campaign.dailyBudget,
      lifetimeBudget: campaign.lifetimeBudget,
      startTime: campaign.startTime?.toISOString() ?? null,
      stopTime: campaign.stopTime?.toISOString() ?? null,
      adSetsCount: campaign.adSets.length,
      adsCount,
      adSetDetails: campaign.adSets.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        dailyBudget: a.dailyBudget,
        bidAmount: a.bidAmount,
        bidStrategy: a.bidStrategy,
        optimizationGoal: a.optimizationGoal,
        billingEvent: a.billingEvent,
        targetingSummary:
          ((a.setupConfig as Record<string, unknown>)?.targetingSummary as Record<string, unknown>) ??
          {},
      })),
    },
    optimizationTips: tips,
  };
}

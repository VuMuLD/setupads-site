"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { ArrowLeft, BarChart3, Settings2, Sparkles, Loader2 } from "lucide-react";
import type { CampaignAnalysis, OptimizationTip } from "@/lib/analysis/campaign-analysis";

const severityStyles: Record<OptimizationTip["severity"], string> = {
  critical: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  success: "border-green-200 bg-green-50 text-green-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
};

export default function CampaignDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    campaign: { id: string; name: string; status: string; objective: string | null; lastSyncedAt: string | null };
    analysis: CampaignAnalysis;
    adSets: Array<{ id: string; name: string; status: string; ads: Array<{ id: string; name: string; status: string }> }>;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!data?.campaign) {
    return (
      <DashboardLayout>
        <p className="p-8 text-center text-muted-foreground">Không tìm thấy campaign.</p>
      </DashboardLayout>
    );
  }

  const { campaign, analysis, adSets } = data;
  const { summary, setup, optimizationTips } = analysis;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/campaigns" className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="mr-1 h-4 w-4" /> Campaigns
            </Link>
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <p className="text-muted-foreground">
              {campaign.objective ?? "—"} · {campaign.status}
              {campaign.lastSyncedAt && ` · Đồng bộ ${formatDate(campaign.lastSyncedAt)}`}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Chi tiêu 30 ngày</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{formatCurrency(summary.totalSpend)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Chuyển đổi</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{summary.totalConversions.toFixed(0)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">CTR / CPC</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">
              {formatPercent(summary.avgCtr)} · {formatCurrency(summary.avgCpc)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">ROAS</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{summary.avgRoas.toFixed(2)}x</CardContent>
          </Card>
        </div>

        <Tabs defaultValue="analysis">
          <TabsList>
            <TabsTrigger value="analysis" className="gap-1"><BarChart3 className="h-4 w-4" /> Phân tích</TabsTrigger>
            <TabsTrigger value="optimize" className="gap-1"><Sparkles className="h-4 w-4" /> Tối ưu giá</TabsTrigger>
            <TabsTrigger value="setup" className="gap-1"><Settings2 className="h-4 w-4" /> Setup khi chạy</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Phân tích hiệu suất</CardTitle>
                <CardDescription>Dữ liệu {summary.daysWithData} ngày từ Facebook (sau đồng bộ)</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
                <p>Lượt hiển thị: <strong>{summary.totalImpressions.toLocaleString("vi-VN")}</strong></p>
                <p>Lượt click: <strong>{summary.totalClicks.toLocaleString("vi-VN")}</strong></p>
                <p>Ad sets: <strong>{setup.adSetsCount}</strong></p>
                <p>Ads: <strong>{setup.adsCount}</strong></p>
              </CardContent>
            </Card>

            {adSets.map((adSet) => (
              <Card key={adSet.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{adSet.name}</CardTitle>
                  <CardDescription>{adSet.status} · {adSet.ads.length} ads</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {adSet.ads.map((ad) => (
                      <li key={ad.id} className="flex justify-between border-b py-1 last:border-0">
                        <span>{ad.name}</span>
                        <span className="text-muted-foreground">{ad.status}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="optimize" className="space-y-3">
            {optimizationTips.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Chưa đủ dữ liệu để gợi ý. Hãy đồng bộ campaign trước.
                </CardContent>
              </Card>
            ) : (
              optimizationTips.map((tip) => (
                <Card key={tip.id} className={severityStyles[tip.severity]}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{tip.title}</CardTitle>
                    <CardDescription className="text-inherit opacity-90">{tip.description}</CardDescription>
                  </CardHeader>
                  {tip.suggestedAction && (
                    <CardContent className="pt-0 text-sm font-medium">{tip.suggestedAction}</CardContent>
                  )}
                </Card>
              ))
            )}
            <p className="text-sm text-muted-foreground">
              Gợi ý chi tiết hơn: mở <Link href="/ai-advisor" className="underline">AI Advisor</Link> sau khi đồng bộ.
            </p>
          </TabsContent>

          <TabsContent value="setup" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Cấu hình Campaign</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                <p>Mục tiêu: <strong>{setup.objective ?? "—"}</strong></p>
                <p>Buying type: <strong>{setup.buyingType ?? "—"}</strong></p>
                <p>Bid strategy: <strong>{setup.bidStrategy ?? "—"}</strong></p>
                <p>Budget/ngày: <strong>{setup.dailyBudget ? formatCurrency(setup.dailyBudget) : "—"}</strong></p>
                <p>Budget lifetime: <strong>{setup.lifetimeBudget ? formatCurrency(setup.lifetimeBudget) : "—"}</strong></p>
                <p>Thời gian: <strong>
                  {setup.startTime ? formatDate(setup.startTime) : "—"}
                  {setup.stopTime ? ` → ${formatDate(setup.stopTime)}` : ""}
                </strong></p>
              </CardContent>
            </Card>

            {setup.adSetDetails.map((adSet) => (
              <Card key={adSet.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ad set: {adSet.name}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                  <p>Optimization: <strong>{adSet.optimizationGoal ?? "—"}</strong></p>
                  <p>Billing: <strong>{adSet.billingEvent ?? "—"}</strong></p>
                  <p>Bid: <strong>{adSet.bidAmount ? formatCurrency(adSet.bidAmount) : "—"}</strong></p>
                  <p>Bid strategy: <strong>{adSet.bidStrategy ?? "—"}</strong></p>
                  <p>Budget/ngày: <strong>{adSet.dailyBudget ? formatCurrency(adSet.dailyBudget) : "—"}</strong></p>
                  <p>Targeting: <strong>{JSON.stringify(adSet.targetingSummary)}</strong></p>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

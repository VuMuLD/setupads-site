"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, Eye, MousePointer, Target } from "lucide-react";

interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number;
  cpc: number;
  ctr: number;
  cpm: number;
}

interface Recommendation {
  id: string;
  type: string;
  confidence: number;
  reasoningVi: string;
  campaign?: { name: string } | null;
}

interface Props {
  metrics: Metrics;
  chartData: Array<{ date: string; spend: number; roas: number }>;
  campaignCount: number;
  adAccountName?: string;
  recommendations: Recommendation[];
}

export function DashboardOverview({
  metrics,
  chartData,
  campaignCount,
  adAccountName,
  recommendations,
}: Props) {
  const statCards = [
    { label: "Chi tiêu", value: formatCurrency(metrics.spend), icon: DollarSign, color: "text-blue-600" },
    { label: "Impressions", value: formatNumber(metrics.impressions), icon: Eye, color: "text-purple-600" },
    { label: "Clicks", value: formatNumber(metrics.clicks), icon: MousePointer, color: "text-green-600" },
    { label: "Conversions", value: formatNumber(metrics.conversions), icon: Target, color: "text-orange-600" },
    { label: "CPC", value: formatCurrency(metrics.cpc), icon: TrendingDown, color: "text-red-600" },
    { label: "CTR", value: formatPercent(metrics.ctr), icon: TrendingUp, color: "text-indigo-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Tổng quan</h1>
        <p className="text-muted-foreground">
          {adAccountName ? `Ad Account: ${adAccountName}` : "Chưa chọn Ad Account"} · {campaignCount} campaigns
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-bold">{stat.value}</p>
                </div>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chi tiêu theo ngày</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="spend" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ROAS theo ngày</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="roas" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Đề xuất AI mới nhất</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((rec) => (
              <div key={rec.id} className="flex items-start justify-between rounded-lg border p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {rec.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Độ tin cậy: {(rec.confidence * 100).toFixed(0)}%
                    </span>
                    {rec.campaign && (
                      <span className="text-xs text-muted-foreground">· {rec.campaign.name}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm">{rec.reasoningVi}</p>
                </div>
                <Button size="sm" className="ml-4 shrink-0">
                  Áp dụng
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

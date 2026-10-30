"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate } from "@/lib/utils";
import { FileText, Download, Sparkles } from "lucide-react";

interface Recommendation {
  id: string;
  type: string;
  confidence: number;
  reasoningVi: string;
  status: string;
  createdAt: string;
  campaign?: { name: string } | null;
}

export default function ReportsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [generating, setGenerating] = useState(false);

  const fetchRecommendations = async () => {
    const res = await fetch("/api/ai/recommendations");
    const data = await res.json();
    setRecommendations(data.recommendations || []);
  };

  useEffect(() => { fetchRecommendations(); }, []);

  const generateReport = async (type: "daily" | "weekly") => {
    setGenerating(true);
    await fetch("/api/ai/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    await fetchRecommendations();
    setGenerating(false);
  };

  const applyRecommendation = async (id: string) => {
    await fetch("/api/ai/recommendations/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId: id }),
    });
    fetchRecommendations();
  };

  const exportCSV = () => {
    const headers = ["Ngày", "Loại", "Campaign", "Độ tin cậy", "Lý do", "Trạng thái"];
    const rows = recommendations.map((r) => [
      formatDate(r.createdAt),
      r.type,
      r.campaign?.name || "",
      `${(r.confidence * 100).toFixed(0)}%`,
      r.reasoningVi,
      r.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fb-ads-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const pending = recommendations.filter((r) => r.status === "PENDING");
  const applied = recommendations.filter((r) => r.status === "APPLIED");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Báo cáo & Đề xuất</h1>
            <p className="text-muted-foreground">Phân tích AI hàng ngày và hàng tuần</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => generateReport("daily")} disabled={generating}>
              <Sparkles className="mr-2 h-4 w-4" />
              Báo cáo ngày
            </Button>
            <Button variant="outline" onClick={() => generateReport("weekly")} disabled={generating}>
              <FileText className="mr-2 h-4 w-4" />
              Báo cáo tuần
            </Button>
            <Button variant="outline" onClick={exportCSV}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Chờ xử lý ({pending.length})</TabsTrigger>
            <TabsTrigger value="applied">Đã áp dụng ({applied.length})</TabsTrigger>
            <TabsTrigger value="all">Tất cả ({recommendations.length})</TabsTrigger>
          </TabsList>

          {["pending", "applied", "all"].map((tab) => (
            <TabsContent key={tab} value={tab} className="space-y-3">
              {(tab === "pending" ? pending : tab === "applied" ? applied : recommendations).map((rec) => (
                <Card key={rec.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {rec.type.replace(/_/g, " ")}
                        {rec.campaign && ` · ${rec.campaign.name}`}
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(rec.createdAt)} · {(rec.confidence * 100).toFixed(0)}% tin cậy
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{rec.reasoningVi}</p>
                    {rec.status === "PENDING" && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => applyRecommendation(rec.id)}>
                          Áp dụng
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await fetch("/api/ai/recommendations/apply", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ recommendationId: rec.id, status: "REJECTED" }),
                            });
                            fetchRecommendations();
                          }}
                        >
                          Bỏ qua
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

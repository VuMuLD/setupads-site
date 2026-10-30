"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  Send,
  Sparkles,
  TrendingUp,
  Lightbulb,
  MessageSquare,
  Loader2,
  ChevronRight,
  ChevronDown,
  BarChart3,
  Zap,
  Megaphone,
  Check,
} from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  getRecommendationColor,
  getRecommendationLabel,
  parseAnalysisSections,
} from "@/lib/ai/format-response";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  recommendations?: Recommendation[];
  sections?: { title: string; body: string }[];
}

interface Recommendation {
  id?: string;
  type: string;
  confidence: number;
  reasoningVi: string;
  campaign?: { name: string } | null;
  suggestedAction?: Record<string, unknown>;
}

interface AccountStats {
  campaigns: number;
  spend: number;
  roas: number;
  adAccountName: string;
  totalAds?: number;
}

interface AdTreeItem {
  id: string;
  name: string;
  status: string;
  spend7d?: number;
  adCount?: number;
  thumbnailUrl?: string | null;
  adSets?: Array<{
    id: string;
    name: string;
    status: string;
    ads: Array<{
      id: string;
      name: string;
      status: string;
      thumbnailUrl?: string | null;
    }>;
  }>;
}

const QUICK_PROMPTS = [
  "Campaign nào đang lãng phí budget nhất?",
  "Nên tăng hay giảm ngân sách tuần này?",
  "CTR thấp — tôi nên làm gì?",
  "So sánh ROAS các campaign đang chạy",
  "Checklist tối ưu trước khi scale ads",
];

const MODEL_LABELS: Record<string, string> = {
  gemini: "Gemini 2.5 Flash",
  gpt4o: "GPT-4o",
  claude: "Claude 3.5",
  consensus: "Consensus (3 AI)",
};

export default function AIAdvisorPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "",
      sections: [
        {
          title: "Chào bạn!",
          body: "Tôi là AI Advisor — phân tích campaigns và quảng cáo Facebook của bạn dựa trên dữ liệu thật sau khi đồng bộ.\n\n• Chọn campaign/quảng cáo ở sidebar bên trái\n• Hỏi chiến lược budget, creative, targeting\n• Bấm **Phân tích ngày/tuần** để nhận đề xuất có thể áp dụng",
        },
      ],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("gemini");
  const [analyzing, setAnalyzing] = useState(false);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [pendingRecs, setPendingRecs] = useState<Recommendation[]>([]);
  const [adTree, setAdTree] = useState<AdTreeItem[]>([]);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set());
  const [adsLoading, setAdsLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectionPayload = useCallback(
    () => ({
      campaignIds: selectedCampaignIds.size ? Array.from(selectedCampaignIds) : undefined,
      adIds: selectedAdIds.size ? Array.from(selectedAdIds) : undefined,
    }),
    [selectedCampaignIds, selectedAdIds]
  );

  const loadAdTree = useCallback(async () => {
    setAdsLoading(true);
    try {
      const res = await fetch("/api/ads?status=ACTIVE");
      const data = await res.json();
      setAdTree(data.campaigns || []);
      if (data.totalAds !== undefined) {
        setStats((prev) =>
          prev ? { ...prev, totalAds: data.totalAds, adAccountName: data.adAccountName || prev.adAccountName } : prev
        );
      }
    } catch {
      setAdTree([]);
    }
    setAdsLoading(false);
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const [campRes, recRes] = await Promise.all([
        fetch("/api/campaigns"),
        fetch("/api/ai/recommendations?status=PENDING"),
      ]);
      const campData = await campRes.json();
      const recData = await recRes.json();
      const campaigns = campData.campaigns || [];
      let totalSpend = 0;
      let roasSum = 0;
      let roasCount = 0;
      for (const c of campaigns) {
        for (const i of c.insights || []) {
          totalSpend += i.spend || 0;
          if (i.roas) {
            roasSum += i.roas;
            roasCount++;
          }
        }
      }
      setStats({
        campaigns: campaigns.length,
        spend: totalSpend,
        roas: roasCount ? roasSum / roasCount : 0,
        adAccountName: campaigns.length ? "Ad Account đã chọn" : "Chưa có dữ liệu",
      });
      setPendingRecs(recData.recommendations?.slice(0, 5) || []);
      void loadAdTree();
    } catch {
      setStats(null);
    }
  }, [loadAdTree]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const toggleCampaignExpand = (id: string) => {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getCampaignAdIds = (campaign: AdTreeItem) =>
    campaign.adSets?.flatMap((as) => as.ads.map((a) => a.id)) || [];

  const toggleCampaign = (campaign: AdTreeItem) => {
    const adIds = getCampaignAdIds(campaign);
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaign.id)) next.delete(campaign.id);
      else next.add(campaign.id);
      return next;
    });
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      const allSelected = adIds.length > 0 && adIds.every((id) => next.has(id));
      if (allSelected) adIds.forEach((id) => next.delete(id));
      else adIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleAd = (adId: string, campaignId: string) => {
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);

      const campaign = adTree.find((c) => c.id === campaignId);
      if (campaign) {
        const adIds = getCampaignAdIds(campaign);
        setSelectedCampaignIds((campPrev) => {
          const campNext = new Set(campPrev);
          const allNowSelected = adIds.every((id) => next.has(id));
          if (allNowSelected && adIds.length > 0) campNext.add(campaignId);
          else campNext.delete(campaignId);
          return campNext;
        });
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedCampaignIds(new Set());
    setSelectedAdIds(new Set());
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text?: string) => {
    const userMessage = (text ?? input).trim();
    if (!userMessage || loading) return;

    setInput("");
    const userId = `u-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userId, role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, model, ...selectionPayload() }),
      });
      const data = await res.json();
      const content = data.response || data.error || "Không có phản hồi.";
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content,
          model: data.model,
          sections: parseAnalysisSections(content),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: "Lỗi kết nối AI service. Vui lòng thử lại.",
        },
      ]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const runAnalysis = async (type: "daily" | "weekly") => {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...selectionPayload() }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: data.error,
          },
        ]);
        return;
      }
      const recs = data.recommendations || [];
      const analysisText = data.analysis || "";
      setMessages((prev) => [
        ...prev,
        {
          id: `analysis-${Date.now()}`,
          role: "assistant",
          content: analysisText,
          model,
          sections: parseAnalysisSections(analysisText),
          recommendations: recs,
        },
      ]);
      setPendingRecs(recs);
      void loadContext();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Phân tích thất bại. Kiểm tra đã đồng bộ campaigns và Gemini API key.",
        },
      ]);
    }
    setAnalyzing(false);
  };

  const applyRecommendation = async (id: string) => {
    await fetch("/api/ai/recommendations/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId: id }),
    });
    setPendingRecs((prev) => prev.filter((r) => r.id !== id));
    void loadContext();
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
        {/* Header */}
        <div className="rounded-xl border bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 p-5 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2 text-sm font-medium text-white/80">
                <Sparkles className="h-4 w-4" />
                AI Advisor
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Tư vấn tối ưu quảng cáo</h1>
              <p className="mt-1 text-sm text-white/85">
                Phân tích dữ liệu thật · Đề xuất có thể áp dụng trực tiếp
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/15 text-white hover:bg-white/25 border-0"
                onClick={() => runAnalysis("daily")}
                disabled={analyzing}
              >
                {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                Phân tích ngày
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/15 text-white hover:bg-white/25 border-0"
                onClick={() => runAnalysis("weekly")}
                disabled={analyzing}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                Phân tích tuần
              </Button>
              <Button variant="secondary" size="sm" className="bg-white text-indigo-700 hover:bg-white/90" asChild>
                <Link href="/reports">Xem tất cả đề xuất</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[300px_1fr]">
          {/* Sidebar */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Tài khoản</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {stats ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Campaigns</span>
                      <span className="font-semibold">{stats.campaigns}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Chi tiêu (7 ngày)</span>
                      <span className="font-semibold">{formatCurrency(stats.spend)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Quảng cáo đang chạy</span>
                      <span className="font-semibold">{stats.totalAds ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ROAS TB</span>
                      <span className="font-semibold">{stats.roas.toFixed(2)}x</span>
                    </div>
                    {(selectedAdIds.size > 0 || selectedCampaignIds.size > 0) && (
                      <div className="rounded-lg bg-indigo-50 px-2 py-1.5 text-xs text-indigo-800">
                        Đã chọn {selectedAdIds.size} quảng cáo
                        {selectedCampaignIds.size > 0 && ` · ${selectedCampaignIds.size} campaign`}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    <Link href="/campaigns" className="text-primary underline">
                      Đồng bộ campaigns
                    </Link>{" "}
                    để AI có dữ liệu.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-indigo-100">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                    <Megaphone className="h-4 w-4 text-indigo-500" />
                    Chọn quảng cáo
                  </CardTitle>
                  {(selectedAdIds.size > 0 || selectedCampaignIds.size > 0) && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Bỏ chọn
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Quảng cáo đang chạy · Phân tích theo từng ad
                </p>
              </CardHeader>
              <CardContent className="max-h-[280px] space-y-1 overflow-y-auto p-2 pt-0">
                {adsLoading ? (
                  <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Đang tải quảng cáo...
                  </div>
                ) : adTree.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Chưa có quảng cáo.{" "}
                    <Link href="/campaigns" className="text-primary underline">
                      Đồng bộ
                    </Link>
                  </p>
                ) : (
                  adTree.map((campaign) => {
                    const isExpanded = expandedCampaigns.has(campaign.id);
                    const campaignAdIds = getCampaignAdIds(campaign);
                    const selectedCount = campaignAdIds.filter((id) =>
                      selectedAdIds.has(id)
                    ).length;
                    const allAdsSelected =
                      campaignAdIds.length > 0 &&
                      selectedCount === campaignAdIds.length;

                    return (
                      <div key={campaign.id} className="rounded-lg border bg-background">
                        <div className="flex items-center gap-1 p-1.5">
                          <button
                            type="button"
                            onClick={() => toggleCampaignExpand(campaign.id)}
                            className="rounded p-0.5 hover:bg-muted"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCampaign(campaign)}
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              allAdsSelected || selectedCampaignIds.has(campaign.id)
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : selectedCount > 0
                                  ? "border-indigo-400 bg-indigo-100"
                                  : "border-muted-foreground/30"
                            }`}
                          >
                            {(allAdsSelected || selectedCampaignIds.has(campaign.id)) && (
                              <Check className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCampaignExpand(campaign.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-xs font-medium">{campaign.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {campaign.adCount ?? campaignAdIds.length} ads
                              {campaign.spend7d ? ` · ${formatCurrency(campaign.spend7d)}` : ""}
                            </p>
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="border-t bg-muted/20 px-2 pb-2">
                            {campaign.adSets?.map((adSet) =>
                              adSet.ads.map((ad) => (
                                <label
                                  key={ad.id}
                                  className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedAdIds.has(ad.id)}
                                    onChange={() => toggleAd(ad.id, campaign.id)}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  {ad.thumbnailUrl ? (
                                    <img
                                      src={ad.thumbnailUrl}
                                      alt=""
                                      className="h-8 w-8 shrink-0 rounded object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                                      Ad
                                    </div>
                                  )}
                                  <span className="min-w-0 flex-1 truncate text-[11px] leading-tight">
                                    {ad.name}
                                  </span>
                                </label>
                              ))
                            )}
                            {campaignAdIds.length === 0 && (
                              <p className="py-2 text-center text-[10px] text-muted-foreground">
                                Không có ad đang chạy
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1 text-sm font-medium">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Gợi ý câu hỏi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 p-3 pt-0">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    disabled={loading}
                    className="flex w-full items-start gap-1 rounded-lg border bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {q}
                  </button>
                ))}
              </CardContent>
            </Card>

            {pendingRecs.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-amber-900">
                    Đề xuất chờ ({pendingRecs.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-3 pt-0">
                  {pendingRecs.map((rec) => (
                    <div key={rec.id} className="rounded-lg border bg-white p-2 text-xs">
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${getRecommendationColor(rec.type)}`}
                      >
                        {getRecommendationLabel(rec.type)}
                      </span>
                      <p className="mt-1 line-clamp-2 text-muted-foreground">{rec.reasoningVi}</p>
                      {rec.id && (
                        <Button
                          size="sm"
                          className="mt-2 h-7 w-full text-xs"
                          onClick={() => applyRecommendation(rec.id!)}
                        >
                          Áp dụng
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Chat */}
          <Card className="flex min-h-0 flex-col overflow-hidden shadow-sm">
            <div className="border-b px-4 py-3">
              <Tabs value={model} onValueChange={setModel}>
                <TabsList className="h-9">
                  <TabsTrigger value="gemini" className="text-xs sm:text-sm">
                    Gemini 2.5
                  </TabsTrigger>
                  <TabsTrigger value="gpt4o" className="text-xs sm:text-sm">
                    GPT-4o
                  </TabsTrigger>
                  <TabsTrigger value="claude" className="text-xs sm:text-sm">
                    Claude
                  </TabsTrigger>
                  <TabsTrigger value="consensus" className="text-xs sm:text-sm">
                    Consensus
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow">
                        <Bot className="h-5 w-5" />
                      </div>
                    )}
                    {msg.role === "user" && (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <MessageSquare className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] space-y-2 ${
                        msg.role === "user" ? "items-end" : ""
                      }`}
                    >
                      {msg.role === "assistant" && msg.model && (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {MODEL_LABELS[msg.model] || msg.model}
                        </span>
                      )}

                      {msg.role === "user" ? (
                        <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
                          {msg.content}
                        </div>
                      ) : msg.sections && msg.sections.length > 0 ? (
                        msg.sections.map((sec, idx) => (
                          <div
                            key={idx}
                            className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3 shadow-sm"
                          >
                            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                              <TrendingUp className="h-3.5 w-3.5 text-indigo-500" />
                              {sec.title}
                            </h3>
                            <div
                              className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
                              dangerouslySetInnerHTML={{
                                __html: sec.body
                                  .replace(/\*\*(.+?)\*\*/g, "<strong class='text-foreground'>$1</strong>")
                                  .replace(/^- (.+)$/gm, "<span class='block pl-2 before:content-[\"•\"] before:mr-2'>$1</span>"),
                              }}
                            />
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl rounded-tl-sm border bg-muted/60 px-4 py-3 text-sm whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      )}

                      {msg.recommendations && msg.recommendations.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <p className="text-xs font-semibold text-foreground">
                            Đề xuất có thể áp dụng ({msg.recommendations.length})
                          </p>
                          {msg.recommendations.map((rec, idx) => (
                            <div
                              key={rec.id || idx}
                              className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRecommendationColor(rec.type)}`}
                                >
                                  {getRecommendationLabel(rec.type)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Tin cậy {(rec.confidence * 100).toFixed(0)}%
                                </span>
                                {rec.campaign?.name && (
                                  <span className="text-xs font-medium">{rec.campaign.name}</span>
                                )}
                              </div>
                              <p className="mt-2 text-sm leading-relaxed">{rec.reasoningVi}</p>
                              {rec.id && (
                                <div className="mt-3 flex gap-2">
                                  <Button size="sm" onClick={() => applyRecommendation(rec.id!)}>
                                    Áp dụng ngay
                                  </Button>
                                  <Button size="sm" variant="outline" asChild>
                                    <Link href="/reports">Chi tiết</Link>
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                    <div className="rounded-2xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                      Đang phân tích dữ liệu của bạn...
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t bg-muted/20 p-4">
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    rows={2}
                    placeholder="Hỏi về budget, ROAS, creative, targeting..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={loading}
                    className="flex-1 resize-none rounded-xl border bg-background px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <Button
                    size="lg"
                    className="h-auto rounded-xl px-5"
                    onClick={() => void sendMessage()}
                    disabled={loading || !input.trim()}
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </div>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  Enter gửi · Shift+Enter xuống dòng
                  {selectedAdIds.size > 0
                    ? ` · Phân tích ${selectedAdIds.size} quảng cáo đã chọn`
                    : " · Chọn quảng cáo sidebar để phân tích chi tiết"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

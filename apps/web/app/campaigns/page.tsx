"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { RefreshCw, Plus, Pause, Play, Trash2 } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  dailyBudget: number | null;
  insights: Array<{ spend: number; clicks: number; ctr: number; roas: number }>;
  _count: { adSets: number };
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: "", objective: "OUTCOME_TRAFFIC", dailyBudget: "" });

  const fetchCampaigns = async () => {
    setLoading(true);
    const res = await fetch("/api/campaigns");
    const data = await res.json();
    setCampaigns(data.campaigns || []);
    setLoading(false);
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handleSync = async (scope: "selected" | "all" = "selected") => {
    setSyncing(true);
    setSyncMessage("");
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const data = await res.json();
    if (data.success) {
      setSyncMessage(
        scope === "all"
          ? `Đã đồng bộ ${data.accountsSynced} tài khoản QC, ${data.campaignsSynced} campaigns, ${data.adSetsSynced ?? 0} ad sets, ${data.adsSynced ?? 0} ads.`
          : `Đã đồng bộ ${data.campaignsSynced} campaigns.`
      );
    } else {
      setSyncMessage(data.error || "Đồng bộ thất bại");
    }
    await fetchCampaigns();
    setSyncing(false);
  };

  const handleBulkAction = async (action: "pause" | "resume" | "delete") => {
    if (!selected.length) return;
    await fetch("/api/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignIds: selected, action }),
    });
    setSelected([]);
    fetchCampaigns();
  };

  const handleCreate = async () => {
    await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newCampaign.name,
        objective: newCampaign.objective,
        dailyBudget: newCampaign.dailyBudget ? parseFloat(newCampaign.dailyBudget) : undefined,
        status: "PAUSED",
      }),
    });
    setShowCreate(false);
    setNewCampaign({ name: "", objective: "OUTCOME_TRAFFIC", dailyBudget: "" });
    fetchCampaigns();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Campaigns</h1>
            <p className="text-muted-foreground">{campaigns.length} campaigns</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleSync("selected")} disabled={syncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              Đồng bộ
            </Button>
            <Button variant="secondary" onClick={() => handleSync("all")} disabled={syncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              Đồng bộ tất cả
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Tạo Campaign
            </Button>
          </div>
        </div>

        {syncMessage && (
          <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">{syncMessage}</p>
        )}

        {selected.length > 0 && (
          <div className="flex gap-2 rounded-lg border bg-muted p-3">
            <span className="text-sm">{selected.length} đã chọn</span>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("pause")}>
              <Pause className="mr-1 h-3 w-3" /> Pause
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("resume")}>
              <Play className="mr-1 h-3 w-3" /> Resume
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleBulkAction("delete")}>
              <Trash2 className="mr-1 h-3 w-3" /> Xóa
            </Button>
          </div>
        )}

        {showCreate && (
          <Card>
            <CardHeader><CardTitle className="text-base">Tạo Campaign mới</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Tên campaign"
                value={newCampaign.name}
                onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
              />
              <Input
                placeholder="Ngân sách hàng ngày (VND)"
                type="number"
                value={newCampaign.dailyBudget}
                onChange={(e) => setNewCampaign({ ...newCampaign, dailyBudget: e.target.value })}
              />
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={!newCampaign.name}>Tạo</Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Hủy</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 w-8"></th>
                  <th className="p-4">Tên</th>
                  <th className="p-4">Trạng thái</th>
                  <th className="p-4">Chi tiêu</th>
                  <th className="p-4">CTR</th>
                  <th className="p-4">ROAS</th>
                  <th className="p-4">Budget/ngày</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Đang tải...</td></tr>
                ) : campaigns.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Chưa có campaign. Nhấn Đồng bộ để lấy từ Facebook.
                  </td></tr>
                ) : (
                  campaigns.map((campaign) => {
                    const totalSpend = campaign.insights.reduce((s, i) => s + i.spend, 0);
                    const avgCtr = campaign.insights.length
                      ? campaign.insights.reduce((s, i) => s + i.ctr, 0) / campaign.insights.length
                      : 0;
                    const avgRoas = campaign.insights.length
                      ? campaign.insights.reduce((s, i) => s + i.roas, 0) / campaign.insights.length
                      : 0;

                    return (
                      <tr key={campaign.id} className="border-b hover:bg-muted/50">
                        <td className="p-4">
                          <input
                            type="checkbox"
                            checked={selected.includes(campaign.id)}
                            onChange={() => toggleSelect(campaign.id)}
                          />
                        </td>
                        <td className="p-4 font-medium">
                          <a href={`/campaigns/${campaign.id}`} className="text-primary hover:underline">
                            {campaign.name}
                          </a>
                        </td>
                        <td className="p-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            campaign.status === "ACTIVE"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
                          }`}>
                            {campaign.status}
                          </span>
                        </td>
                        <td className="p-4">{formatCurrency(totalSpend)}</td>
                        <td className="p-4">{formatPercent(avgCtr)}</td>
                        <td className="p-4">{avgRoas.toFixed(2)}x</td>
                        <td className="p-4">
                          {campaign.dailyBudget ? formatCurrency(campaign.dailyBudget) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

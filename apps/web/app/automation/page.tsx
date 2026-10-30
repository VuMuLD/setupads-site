"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Plus, Trash2 } from "lucide-react";

interface Rule {
  id: string;
  name: string;
  conditionJson: { metric: string; operator: string; value: number; period: string };
  actionJson: { type: string };
  isActive: boolean;
  isAutoPilot: boolean;
  maxBudget: number | null;
}

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRule, setNewRule] = useState({
    name: "",
    metric: "roas",
    operator: "lt",
    value: "1",
    action: "pause",
    isAutoPilot: false,
    maxBudget: "",
  });

  const fetchRules = async () => {
    const res = await fetch("/api/automation");
    const data = await res.json();
    setRules(data.rules || []);
  };

  useEffect(() => { fetchRules(); }, []);

  const createRule = async () => {
    await fetch("/api/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newRule.name,
        conditionJson: {
          metric: newRule.metric,
          operator: newRule.operator,
          value: parseFloat(newRule.value),
          period: "today",
        },
        actionJson: { type: newRule.action },
        isActive: true,
        isAutoPilot: newRule.isAutoPilot,
        maxBudget: newRule.maxBudget ? parseFloat(newRule.maxBudget) : undefined,
      }),
    });
    setShowCreate(false);
    fetchRules();
  };

  const deleteRule = async (id: string) => {
    await fetch(`/api/automation?id=${id}`, { method: "DELETE" });
    fetchRules();
  };

  const toggleRule = async (id: string, isActive: boolean) => {
    await fetch("/api/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive }),
    });
    fetchRules();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Tự động hóa</h1>
            <p className="text-muted-foreground">Rules engine & Auto-pilot mode</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Tạo Rule
          </Button>
        </div>

        {showCreate && (
          <Card>
            <CardHeader><CardTitle className="text-base">Tạo Automation Rule</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Tên rule</Label>
                <Input value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Metric</Label>
                  <select
                    className="w-full rounded-md border p-2 text-sm"
                    value={newRule.metric}
                    onChange={(e) => setNewRule({ ...newRule, metric: e.target.value })}
                  >
                    <option value="spend">Chi tiêu</option>
                    <option value="roas">ROAS</option>
                    <option value="cpc">CPC</option>
                    <option value="ctr">CTR</option>
                    <option value="conversions">Conversions</option>
                  </select>
                </div>
                <div>
                  <Label>Điều kiện</Label>
                  <select
                    className="w-full rounded-md border p-2 text-sm"
                    value={newRule.operator}
                    onChange={(e) => setNewRule({ ...newRule, operator: e.target.value })}
                  >
                    <option value="gt">Lớn hơn</option>
                    <option value="lt">Nhỏ hơn</option>
                    <option value="gte">Lớn hơn hoặc bằng</option>
                    <option value="lte">Nhỏ hơn hoặc bằng</option>
                  </select>
                </div>
                <div>
                  <Label>Giá trị</Label>
                  <Input type="number" value={newRule.value} onChange={(e) => setNewRule({ ...newRule, value: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Hành động</Label>
                <select
                  className="w-full rounded-md border p-2 text-sm"
                  value={newRule.action}
                  onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                >
                  <option value="pause">Pause campaign</option>
                  <option value="resume">Resume campaign</option>
                  <option value="notify">Gửi thông báo</option>
                  <option value="adjust_budget">Điều chỉnh budget</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autopilot"
                  checked={newRule.isAutoPilot}
                  onChange={(e) => setNewRule({ ...newRule, isAutoPilot: e.target.checked })}
                />
                <Label htmlFor="autopilot">Auto-pilot (tự động thực thi)</Label>
              </div>
              <div className="flex gap-2">
                <Button onClick={createRule} disabled={!newRule.name}>Tạo</Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Hủy</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {rules.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Zap className="mx-auto mb-3 h-8 w-8 opacity-50" />
                Chưa có rule nào. Tạo rule để tự động hóa quản lý quảng cáo.
              </CardContent>
            </Card>
          ) : (
            rules.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{rule.name}</span>
                      {rule.isAutoPilot && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                          Auto-pilot
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        rule.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        {rule.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      IF {rule.conditionJson.metric} {rule.conditionJson.operator} {rule.conditionJson.value}
                      THEN {rule.actionJson.type}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleRule(rule.id, !rule.isActive)}
                    >
                      {rule.isActive ? "Tắt" : "Bật"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteRule(rule.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

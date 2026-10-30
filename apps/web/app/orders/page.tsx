"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Calendar,
  ChevronRight,
  Loader2,
  MessageCircle,
  Package,
  Phone,
  MapPin,
  RefreshCw,
  Truck,
  Banknote,
} from "lucide-react";
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  type OrderStatus,
} from "@/lib/messages/order-status";

interface PageInfo {
  id: string;
  name: string;
  isSelected: boolean;
}

interface OrderItem {
  id: string;
  orderCode: string | null;
  participantName: string | null;
  phone: string | null;
  address: string | null;
  productSummary: string | null;
  size: string | null;
  quantity: number | null;
  amount: number | null;
  shippingFee: number | null;
  grandTotal: number;
  status: OrderStatus;
  confirmationSentAt: string | null;
  confirmedAt: string;
  conversationId: string | null;
}

interface PeriodGroup {
  key: string;
  label: string;
  isCurrent: boolean;
  orderCount: number;
  totalAmount: number;
  totalShippingFee: number;
  grandTotal: number;
  byStatus: Record<OrderStatus, number>;
  orders: OrderItem[];
}

interface Summary {
  orderCount: number;
  totalAmount: number;
  totalShippingFee: number;
  grandTotal: number;
  byStatus: Record<OrderStatus, number>;
}

type GroupBy = "day" | "week" | "month";

const GROUP_TABS: { id: GroupBy; label: string }[] = [
  { id: "day", label: "Theo ngày" },
  { id: "week", label: "Theo tuần" },
  { id: "month", label: "Theo tháng" },
];

function formatMoney(n: number) {
  return n.toLocaleString("vi-VN") + "đ";
}

export default function OrdersPage() {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [groups, setGroups] = useState<PeriodGroup[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pageName, setPageName] = useState("");
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    const res = await fetch("/api/pages");
    const data = await res.json();
    const list = data.pages || [];
    setPages(list);
    const selected = list.find((p: PageInfo) => p.isSelected) || list[0];
    if (selected) setSelectedPageId(selected.id);
  }, []);

  const loadOrders = useCallback(async () => {
    if (!selectedPageId) return;
    setLoading(true);
    const res = await fetch(
      `/api/pages/orders?pageId=${selectedPageId}&days=${days}&groupBy=${groupBy}`
    );
    const data = await res.json();
    if (res.ok) {
      setGroups(data.groups || []);
      setSummary(data.summary || null);
      setPageName(data.pageName || "");
    }
    setLoading(false);
  }, [selectedPageId, days, groupBy]);

  const updateOrder = async (
    orderId: string,
    patch: { status?: OrderStatus; shippingFee?: number | null }
  ) => {
    setSavingId(orderId);
    try {
      const res = await fetch(`/api/pages/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) await loadOrders();
    } finally {
      setSavingId(null);
    }
  };

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  useEffect(() => {
    if (selectedPageId) void loadOrders();
  }, [selectedPageId, loadOrders]);

  const periodLabel =
    groupBy === "day" ? "ngày" : groupBy === "week" ? "tuần" : "tháng";

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Package className="h-7 w-7 text-indigo-600" />
              Đơn hàng
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Quản lý trạng thái & phí ship · tổng hợp theo {periodLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>7 ngày</option>
              <option value={14}>14 ngày</option>
              <option value={30}>30 ngày</option>
              <option value={90}>90 ngày</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => void loadOrders()}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Làm mới
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {GROUP_TABS.map((tab) => (
            <Button
              key={tab.id}
              variant={groupBy === tab.id ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupBy(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {pages.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {pages.map((p) => (
              <Button
                key={p.id}
                variant={selectedPageId === p.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedPageId(p.id)}
              >
                {p.name}
              </Button>
            ))}
          </div>
        )}

        {summary && summary.orderCount > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Tổng đơn</p>
                <p className="text-2xl font-bold">{summary.orderCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Tiền hàng</p>
                <p className="text-2xl font-bold text-indigo-700">
                  {formatMoney(summary.totalAmount)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Phí ship</p>
                <p className="text-2xl font-bold text-amber-700">
                  {formatMoney(summary.totalShippingFee)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Tổng thu</p>
                <p className="text-2xl font-bold text-emerald-700">
                  {formatMoney(summary.grandTotal)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {summary && summary.orderCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map((st) =>
              summary.byStatus[st] > 0 ? (
                <span
                  key={st}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${ORDER_STATUS_META[st].className}`}
                >
                  {ORDER_STATUS_META[st].label}: {summary.byStatus[st]}
                </span>
              ) : null
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Package className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p>Chưa có đơn hàng trong {days} ngày qua.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <Card key={group.key}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    {group.isCurrent
                      ? groupBy === "day"
                        ? "Hôm nay"
                        : groupBy === "week"
                          ? "Tuần này"
                          : "Tháng này"
                      : group.label}
                    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
                      {group.orderCount} đơn
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      · Hàng {formatMoney(group.totalAmount)}
                      {group.totalShippingFee > 0 && (
                        <> · Ship {formatMoney(group.totalShippingFee)}</>
                      )}
                      {" · "}
                      <strong className="text-emerald-700">
                        {formatMoney(group.grandTotal)}
                      </strong>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.orders.map((order) => (
                    <div
                      key={order.id}
                      className="rounded-xl border bg-card p-4 transition hover:border-indigo-200"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-indigo-700">
                              #{order.orderCode || order.id.slice(-6)}
                            </span>
                            <span className="font-medium">
                              {order.participantName || "Khách"}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ORDER_STATUS_META[order.status].className}`}
                            >
                              {ORDER_STATUS_META[order.status].label}
                            </span>
                          </div>
                          {order.productSummary && (
                            <p className="mt-1.5 text-sm">{order.productSummary}</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {order.size && <span>Size: {order.size}</span>}
                            {order.quantity && <span>SL: {order.quantity}</span>}
                            {order.amount != null && order.amount > 0 && (
                              <span>Hàng: {formatMoney(order.amount)}</span>
                            )}
                            {order.shippingFee != null && order.shippingFee > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Truck className="h-3 w-3" />
                                Ship: {formatMoney(order.shippingFee)}
                              </span>
                            )}
                            <span className="font-semibold text-emerald-700">
                              Tổng: {formatMoney(order.grandTotal)}
                            </span>
                          </div>
                          {order.phone && (
                            <p className="mt-1 flex items-center gap-1 text-xs">
                              <Phone className="h-3 w-3" />
                              {order.phone}
                            </p>
                          )}
                          {order.address && (
                            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="line-clamp-2">{order.address}</span>
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 sm:w-48">
                          <select
                            className="rounded-lg border bg-background px-2 py-1.5 text-xs"
                            value={order.status}
                            disabled={savingId === order.id}
                            onChange={(e) =>
                              void updateOrder(order.id, {
                                status: e.target.value as OrderStatus,
                              })
                            }
                          >
                            {ORDER_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {ORDER_STATUS_META[st].label}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1">
                            <Banknote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Input
                              type="number"
                              min={0}
                              placeholder="Phí ship"
                              className="h-8 text-xs"
                              defaultValue={order.shippingFee ?? ""}
                              disabled={savingId === order.id}
                              onBlur={(e) => {
                                const v = e.target.value;
                                const num = v === "" ? null : Number(v);
                                if (num !== order.shippingFee) {
                                  void updateOrder(order.id, { shippingFee: num });
                                }
                              }}
                            />
                          </div>
                          {order.conversationId && (
                            <Link href={`/messages?conv=${order.conversationId}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-full text-xs"
                              >
                                <MessageCircle className="mr-1 h-3.5 w-3.5" />
                                Chat
                                <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

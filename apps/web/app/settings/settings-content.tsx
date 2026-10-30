"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Facebook, Link2, Unplug } from "lucide-react";

interface AdAccount {
  id: string;
  name: string;
  currency: string;
  isSelected: boolean;
}

interface PageInfo {
  id: string;
  name: string;
  category: string | null;
  isSelected?: boolean;
  autoAiEnabled?: boolean;
  aiTone?: string | null;
}

interface MessagingStatus {
  granted: boolean;
  status: string;
  missing: string[];
  reconnectUrl: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
}

const FACEBOOK_ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "Bạn đã từ chối cấp quyền Facebook. Vui lòng thử lại và chấp nhận tất cả quyền.",
  app_not_active:
    "Ứng dụng Facebook chưa hoạt động với tài khoản này. App đang ở chế độ Development — chỉ tài khoản được thêm vào App Roles (Developer/Tester/Admin) trên Meta Developer mới dùng được.",
  invalid_scope:
    "Quyền OAuth không hợp lệ. Vào Meta Developer → Facebook Login → Configuration (ID 2452312638513541) và thêm đủ quyền ads, pages, messaging.",
  connect_failed:
    "Kết nối thất bại sau khi cấp quyền. Thử «Kết nối lại» hoặc «Cấp quyền Messenger».",
  rate_limit:
    "Facebook tạm giới hạn số request của app (#4). Đợi 20–30 phút rồi thử lại — không bấm đồng bộ/kết nối liên tục.",
  invalid_state: "Phiên OAuth hết hạn. Vui lòng thử kết nối lại.",
  missing_code: "Facebook không trả về mã xác thực. Kiểm tra Redirect URI trên Meta Developer.",
};

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [messagingStatus, setMessagingStatus] = useState<MessagingStatus | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ad-accounts");
      const data = await response.json();
      setAdAccounts(data.adAccounts || []);
      setPages(data.pages || []);
      setIsConnected(Boolean(data.adAccounts?.length || data.pages?.length));
      const msgRes = await fetch("/api/pages/messaging-status");
      if (msgRes.ok) {
        setMessagingStatus(await msgRes.json());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      setMessage("Đã kết nối tài khoản Facebook Ads thành công!");
      void loadAccounts();
    } else if (searchParams.get("error")) {
      const err = searchParams.get("error") || "";
      const desc = searchParams.get("error_description");
      const base =
        FACEBOOK_ERROR_MESSAGES[err] ||
        "Không thể kết nối Facebook. Nếu thấy lỗi «Ứng dụng không hoạt động», hãy kiểm tra: (1) Tài khoản Facebook đăng nhập phải là Admin/Developer của app trên Meta Developer, (2) App đang ở chế độ Development — chỉ tài khoản được thêm vào App Roles mới dùng được, (3) Đã thêm product Marketing API và Facebook Login, (4) Đã thêm Redirect URI: https://setupads.site/api/facebook/callback";
      setMessage(desc ? `${base}\n\nChi tiết: ${desc}` : base);
    }
  }, [searchParams]);

  const selectAdAccount = async (id: string) => {
    await fetch("/api/ad-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adAccountId: id }),
    });
    setAdAccounts((prev) =>
      prev.map((a) => ({ ...a, isSelected: a.id === id }))
    );
  };

  const selectPage = async (id: string) => {
    await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: id, action: "select" }),
    });
    setPages((prev) => prev.map((p) => ({ ...p, isSelected: p.id === id })));
  };

  const togglePageAutoAi = async (id: string, enabled: boolean) => {
    await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: id, action: "toggleAutoAi", autoAiEnabled: !enabled }),
    });
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, autoAiEnabled: !enabled } : p))
    );
  };

  const syncMessages = async () => {
    setMessage("Đang đồng bộ tin nhắn Page...");
    const res = await fetch("/api/pages/sync-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(
        `Đồng bộ tin nhắn: ${data.messagesSynced ?? 0} tin, ${data.aiSuggestions ?? 0} gợi ý AI`
      );
    } else {
      setMessage(data.error || "Đồng bộ tin nhắn thất bại");
    }
  };

  const connectFacebook = () => {
    window.location.href = "/api/facebook/connect";
  };

  const syncAll = async () => {
    setMessage("Đang đồng bộ tất cả tài khoản quảng cáo...");
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage(
        `Đồng bộ xong: ${data.accountsSynced} tài khoản, ${data.campaignsSynced} campaigns, ${data.adSetsSynced ?? 0} ad sets.`
      );
      void loadAccounts();
    } else {
      setMessage(data.error || "Đồng bộ thất bại");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Cài đặt</h1>
          <p className="text-muted-foreground">
            Kết nối tài khoản Facebook Ads để quản lý quảng cáo
          </p>
        </div>

        {message && (
          <p className="whitespace-pre-line rounded-md bg-blue-50 p-3 text-sm text-blue-800">{message}</p>
        )}

        {messagingStatus?.rateLimited && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-medium">Facebook đang giới hạn request</p>
            <p className="mt-1">
              App tạm bị chặn gọi API (#4). Đợi khoảng{" "}
              {Math.max(1, Math.ceil((messagingStatus.retryAfterMs || 0) / 60000))} phút rồi thử
              lại. Trong lúc chờ, không bấm đồng bộ hay kết nối lại liên tục.
            </p>
          </div>
        )}

        {messagingStatus && isConnected && !messagingStatus.granted && !messagingStatus.rateLimited && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Thiếu quyền Messenger</p>
            <p className="mt-1">
              Chưa có: {messagingStatus.missing.join(", ")}. Cần cấp lại quyền để đồng bộ tin nhắn.
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-xs">
              <li>Bấm nút bên dưới → đăng nhập Facebook → chấp nhận <strong>tất cả</strong> quyền Page</li>
              <li>Trên Meta Developer: App → App Review → thêm <code>pages_messaging</code> (nếu chưa có)</li>
              <li>Bạn phải là Admin/Editor của Page trên Facebook</li>
            </ol>
            <Button asChild className="mt-3 bg-[#1877F2] hover:bg-[#166FE5]">
              <a href="/api/facebook/connect?for=messages">Cấp quyền Messenger ngay</a>
            </Button>
          </div>
        )}

        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-900">Cấu hình Meta Developer (nếu lỗi redirect URI)</CardTitle>
            <CardDescription className="text-amber-800">
              Vào Facebook Login → Settings → Valid OAuth Redirect URIs, thêm chính xác 2 dòng sau:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs text-amber-900">
            <p className="rounded bg-white p-2">https://setupads.site/api/auth/callback/facebook</p>
            <p className="rounded bg-white p-2">https://setupads.site/api/facebook/callback</p>
            <p className="pt-1 text-sm font-sans text-amber-800">
              Miền JSSDK: <strong>setupads.site</strong> — Xóa URL cũ <code>https://setupads.site/</code> nếu còn.
              {" "}
              <a href="/oauth-check" className="underline">Kiểm tra OAuth chi tiết →</a>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Facebook className="h-5 w-5 text-[#1877F2]" />
              Kết nối Facebook Ads
            </CardTitle>
            <CardDescription>
              Liên kết tài khoản Facebook có quyền quản lý quảng cáo, pages và ad accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {isConnected ? (
                  <Link2 className="h-5 w-5 text-green-600" />
                ) : (
                  <Unplug className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium">
                    {isConnected ? "Đã kết nối Facebook Ads" : "Chưa kết nối Facebook Ads"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isConnected
                      ? "Bạn có thể đồng bộ campaigns và quản lý quảng cáo."
                      : "Nhấn nút bên dưới để cấp quyền ads_management, pages_show_list, ads_read."}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {isConnected && (
                  <Button variant="outline" onClick={() => void syncAll()}>
                    Đồng bộ tất cả
                  </Button>
                )}
                <Button onClick={connectFacebook} className="bg-[#1877F2] hover:bg-[#166FE5]">
                  {isConnected ? "Kết nối lại" : "Kết nối Facebook"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Facebook className="h-5 w-5 text-[#1877F2]" />
              Ad Accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Đang tải...</p>
            ) : adAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có Ad Account. Hãy kết nối Facebook Ads ở trên.
              </p>
            ) : (
              adAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`flex items-center justify-between rounded-lg border p-3 ${
                    account.isSelected ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{account.currency}</p>
                  </div>
                  {account.isSelected ? (
                    <span className="text-xs font-medium text-primary">Đang dùng</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => selectAdAccount(account.id)}>
                      Chọn
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="h-5 w-5" />
              Facebook Pages & Tin nhắn
            </CardTitle>
            <CardDescription>
              Chọn Page để đồng bộ Messenger. Bật AI tự động để Gemini gợi ý trả lời khi có tin mới.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Đang tải...</p>
            ) : pages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có Page nào được kết nối.</p>
            ) : (
              <>
                {pages.map((page) => (
                  <div
                    key={page.id}
                    className={`rounded-lg border p-3 ${
                      page.isSelected ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{page.name}</p>
                        {page.category && (
                          <p className="text-xs text-muted-foreground">{page.category}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {page.isSelected ? (
                          <span className="text-xs font-medium text-primary">Page chính</span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => void selectPage(page.id)}>
                            Chọn
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={page.autoAiEnabled ? "default" : "outline"}
                          onClick={() => void togglePageAutoAi(page.id, !!page.autoAiEnabled)}
                        >
                          AI {page.autoAiEnabled ? "ON" : "OFF"}
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <a href={`/pages/${page.id}/products`}>Sản phẩm</a>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  variant={messagingStatus && !messagingStatus.granted ? "default" : "outline"}
                  className={
                    messagingStatus && !messagingStatus.granted
                      ? "mt-2 w-full bg-[#1877F2] hover:bg-[#166FE5]"
                      : "mt-2 w-full"
                  }
                  asChild
                >
                  <a href="/api/facebook/connect?for=messages">Cấp quyền Messenger</a>
                </Button>
                <Button variant="outline" className="mt-2 w-full" onClick={() => void syncMessages()}>
                  Đồng bộ tin nhắn tất cả Pages
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

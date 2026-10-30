"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";

interface DiagnosticData {
  status: string;
  checks: Record<string, { ok: boolean; message: string }>;
  redirectUris: { login: string; connectAds: string };
  metaConsoleInstructions: {
    validOAuthRedirectUris: string[];
    jsSdkDomain: string;
    loginConfigPermissions: string[];
    note: string;
  };
  testUrls: { oauthLogin: string; oauthConnect: string };
}

export default function OAuthCheckPage() {
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/facebook/diagnostic")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Không thể tải dữ liệu kiểm tra"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Kiểm tra cấu hình Facebook OAuth</h1>
          <p className="text-muted-foreground">setupads.site — App 1647962259738868</p>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <p className="rounded-md bg-red-50 p-4 text-red-700">{error}</p>
        )}

        {data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {data.status === "ok" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-amber-600" />
                  )}
                  Kết quả kiểm tra server
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(data.checks).map(([key, check]) => (
                  <div key={key} className="flex items-start gap-2 text-sm">
                    {check.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    )}
                    <span>{check.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Redirect URI cần thêm vào Meta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 font-mono text-sm">
                {data.metaConsoleInstructions.validOAuthRedirectUris.map((uri) => (
                  <p key={uri} className="rounded border bg-white p-3">{uri}</p>
                ))}
                <p className="text-sm font-sans text-muted-foreground pt-2">
                  Miền JSSDK: <strong>{data.metaConsoleInstructions.jsSdkDomain}</strong>
                </p>
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="text-amber-900">Sửa lỗi &quot;Invalid Scopes: email&quot;</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-amber-900">
                <p>{data.metaConsoleInstructions.note}</p>
                <p>Trong <strong>Login Configuration</strong> (ID: 2452312638513541) → <strong>Quyền</strong>, thêm:</p>
                <ul className="list-inside list-disc space-y-1">
                  {data.metaConsoleInstructions.loginConfigPermissions.map((p) => (
                    <li key={p}><code>{p}</code></li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-900">Chrome báo &quot;Trang web lừa đảo&quot;?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-red-900">
                <p>
                  Google Safe Browsing đôi khi gắn nhầm site mới có đăng nhập Facebook. Đây là
                  cảnh báo của Chrome, không phải lỗi Facebook OAuth.
                </p>
                <p>
                  Báo nhầm tại{" "}
                  <a
                    href="https://safebrowsing.google.com/safebrowsing/report_error/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Google Safe Browsing
                  </a>
                  . Thêm trang{" "}
                  <a href="/privacy" className="underline">
                    Chính sách bảo mật
                  </a>{" "}
                  vào Meta App giúp tăng độ tin cậy.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3">
                <Button asChild className="w-full bg-[#1877F2] hover:bg-[#166FE5]">
                  <a href={data.testUrls.oauthLogin} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Test đăng nhập Facebook
                  </a>
                </Button>
                <p className="text-xs text-muted-foreground break-all">{data.testUrls.oauthLogin}</p>
              </CardContent>
            </Card>

            <div className="text-center">
              <Link href="/login" className="text-primary underline">
                ← Quay lại trang đăng nhập
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

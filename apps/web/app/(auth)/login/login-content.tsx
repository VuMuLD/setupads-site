"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Megaphone, Bot, BarChart3, Zap, Loader2 } from "lucide-react";

const META_REDIRECT_URIS = [
  "https://setupads.site/api/auth/callback/facebook",
  "https://setupads.site/api/facebook/callback",
];

export default function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status: sessionStatus } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirm, setRegisterConfirm] = useState("");

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      router.replace("/dashboard");
    }
  }, [router, sessionStatus]);

  useEffect(() => {
    const authError = searchParams.get("error");
    if (!authError) return;

    if (authError === "Configuration") {
      setError(
        "Facebook chưa cấu hình đúng trên Meta Developer. Hãy thêm 2 Redirect URI bên dưới, đảm bảo tài khoản Facebook của bạn là Admin/Developer của app, và app không bị tắt."
      );
      return;
    }

    if (authError === "AccessDenied") {
      setError("Bạn đã từ chối đăng nhập Facebook.");
      return;
    }

    if (authError === "OAuthAccountNotLinked") {
      setError(
        "Email Facebook này đã liên kết tài khoản khác. Hãy đăng nhập bằng email/mật khẩu hoặc dùng Facebook khác."
      );
      return;
    }

    setError(
      "Không thể đăng nhập Facebook với tài khoản này. App Meta đang ở chế độ Development — chỉ nick Admin/Developer/Tester của app mới đăng nhập FB được. Người dùng khác hãy Đăng ký bằng email."
    );
  }, [searchParams]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email: loginEmail,
        password: loginPassword,
        redirect: false,
      });

      if (result?.error) {
        setError("Email hoặc mật khẩu không đúng");
        return;
      }

      router.push("/dashboard");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (registerPassword !== registerConfirm) {
      setError("Mật khẩu xác nhận không khớp");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: registerName,
          email: registerEmail,
          password: registerPassword,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Không thể đăng ký");
        return;
      }

      setSuccess("Đăng ký thành công! Đang đăng nhập...");
      const result = await signIn("credentials", {
        email: registerEmail,
        password: registerPassword,
        redirect: false,
      });

      if (result?.error) {
        setSuccess("Đăng ký thành công. Vui lòng đăng nhập.");
        return;
      }

      router.push("/dashboard");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFacebookAuth = useCallback(() => {
    setError("");
    setIsLoading(true);
    void signIn("facebook", { callbackUrl: "/dashboard" });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-3">
            <Megaphone className="h-10 w-10 text-primary" />
            <h1 className="text-4xl font-bold text-gray-900">FB Ads Manager</h1>
          </div>
          <p className="text-lg text-gray-600">
            Quản lý quảng cáo Facebook với AI tư vấn tối ưu chi phí
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icon: BarChart3, title: "Quản lý Campaigns", desc: "CRUD campaigns, ad sets, ads" },
            { icon: Bot, title: "AI Tư vấn", desc: "Gemini + GPT + Claude consensus" },
            { icon: Zap, title: "Tự động hóa", desc: "Rules engine & auto-pilot" },
          ].map((feature) => (
            <Card key={feature.title} className="text-center">
              <CardContent className="pt-6">
                <feature.icon className="mx-auto mb-3 h-8 w-8 text-primary" />
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mx-auto max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Chào mừng</CardTitle>
            <CardDescription>
              Đăng ký hoặc đăng nhập để bắt đầu. Kết nối Facebook Ads sau trong phần Cài đặt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                <p>{error}</p>
                {searchParams.get("error") === "Configuration" && (
                  <div className="space-y-1 font-mono text-xs">
                    {META_REDIRECT_URIS.map((uri) => (
                      <p key={uri} className="rounded bg-white p-2 text-red-900">{uri}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {success && (
              <p className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</p>
            )}

            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Đăng nhập</TabsTrigger>
                <TabsTrigger value="register">Đăng ký</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4 pt-4">
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="email@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Mật khẩu</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Đăng nhập"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register" className="space-y-4 pt-4">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-name">Họ tên</Label>
                    <Input
                      id="register-name"
                      placeholder="Nguyễn Văn A"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
                      type="email"
                      placeholder="email@example.com"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Mật khẩu</Label>
                    <Input
                      id="register-password"
                      type="password"
                      placeholder="Ít nhất 6 ký tự"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-confirm">Xác nhận mật khẩu</Label>
                    <Input
                      id="register-confirm"
                      type="password"
                      placeholder="Nhập lại mật khẩu"
                      value={registerConfirm}
                      onChange={(e) => setRegisterConfirm(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Đăng ký"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Hoặc</span>
              </div>
            </div>

            <Button
              type="button"
              className="w-full gap-2 bg-[#1877F2] hover:bg-[#166FE5]"
              size="lg"
              disabled={isLoading || sessionStatus === "loading"}
              onClick={handleFacebookAuth}
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              )}
              Tiếp tục với Facebook
            </Button>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Đăng nhập Facebook chỉ dùng để tạo tài khoản nhanh. Sau khi vào hệ thống, vào mục
              Cài đặt để kết nối tài khoản quảng cáo Facebook.{" "}
              <a href="/privacy" className="underline hover:text-foreground">
                Chính sách bảo mật
              </a>
            </p>

            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Lưu ý:</strong> App Facebook «Audo Chat» đang ở chế độ <strong>Development</strong>.
              Chỉ tài khoản được thêm <strong>Tester</strong> trên Meta Developer mới đăng nhập bằng Facebook.
              Mọi người dùng khác vui lòng <strong>Đăng ký email</strong> ở tab trên.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

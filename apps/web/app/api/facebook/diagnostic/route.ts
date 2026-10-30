import { NextResponse } from "next/server";
import { FB_ADS_SCOPES, FB_API_VERSION } from "@fb-ads/shared";
import {
  getFacebookRateLimitRetryAfterMs,
  isFacebookAppRateLimited,
} from "@/lib/facebook/rate-limit";

export async function GET() {
  const appId = process.env.FACEBOOK_CLIENT_ID || "";
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET || "";
  const baseUrl = process.env.NEXTAUTH_URL || "https://setupads.site";
  const configId = process.env.NEXT_PUBLIC_FACEBOOK_CONFIG_ID || "";

  const redirectUris = {
    login: `${baseUrl}/api/auth/callback/facebook`,
    connectAds: `${baseUrl}/api/facebook/callback`,
  };

  const checks: Record<string, { ok: boolean; message: string }> = {};

  checks.env_app_id = {
    ok: Boolean(appId),
    message: appId ? `App ID: ${appId}` : "Thiếu FACEBOOK_CLIENT_ID",
  };

  checks.env_secret = {
    ok: Boolean(appSecret),
    message: appSecret ? "App Secret: đã cấu hình" : "Thiếu FACEBOOK_CLIENT_SECRET",
  };

  checks.env_config_id = {
    ok: Boolean(configId),
    message: configId
      ? `Login Config ID: ${configId}`
      : "Thiếu NEXT_PUBLIC_FACEBOOK_CONFIG_ID",
  };

  checks.nextauth_url = {
    ok: baseUrl.startsWith("https://"),
    message: `NEXTAUTH_URL: ${baseUrl}`,
  };

  if (isFacebookAppRateLimited()) {
    checks.facebook_app = {
      ok: false,
      message: `Đang cooldown rate limit — thử lại sau ${Math.ceil(getFacebookRateLimitRetryAfterMs() / 60000)} phút`,
    };
  } else if (appId && appSecret) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/${appId}?fields=name,app_domains,link&access_token=${appId}|${appSecret}`
      );
      const data = await res.json();
      if (data.error) {
        checks.facebook_app = {
          ok: false,
          message: `Facebook API: ${data.error.message}`,
        };
      } else {
        checks.facebook_app = {
          ok: true,
          message: `App "${data.name}" — domains: ${(data.app_domains || []).join(", ") || "chưa có"}`,
        };
      }
    } catch {
      checks.facebook_app = {
        ok: false,
        message: "Không thể kết nối Facebook Graph API",
      };
    }
  }

  const oauthLoginUrl = configId
    ? `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUris.login)}&response_type=code&config_id=${configId}&scope=public_profile`
    : `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUris.login)}&response_type=code&scope=public_profile`;

  const oauthConnectUrl = configId
    ? `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUris.connectAds)}&response_type=code&config_id=${configId}`
    : `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUris.connectAds)}&response_type=code&scope=${encodeURIComponent(FB_ADS_SCOPES)}`;

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({
    status: allOk ? "ok" : "issues_found",
    checks,
    redirectUris,
    metaConsoleInstructions: {
      validOAuthRedirectUris: [redirectUris.login, redirectUris.connectAds],
      jsSdkDomain: "setupads.site",
      loginConfigPermissions: [
        "public_profile",
        "email",
        "business_management",
        "pages_show_list",
        "ads_management",
        "ads_read",
        "pages_read_engagement",
        "pages_manage_metadata",
        "pages_messaging",
      ],
      note: "Đồng bộ tin nhắn cần pages_messaging. Kết nối lại qua /api/facebook/connect?for=messages. Thêm quyền trong Meta Developer → App Review → Permissions.",
    },
    testUrls: {
      oauthLogin: oauthLoginUrl,
      oauthConnect: oauthConnectUrl,
    },
  });
}

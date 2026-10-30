import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  buildFacebookOAuthUrl,
  createOAuthState,
  FB_ADS_SCOPES,
  FB_MESSAGING_SCOPES,
} from "@/lib/facebook/sync-account";
import { getAppBaseUrl } from "@/lib/site-url";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  if (!process.env.FACEBOOK_CLIENT_ID || !process.env.FACEBOOK_CLIENT_SECRET) {
    return NextResponse.json({ error: "Facebook chưa được cấu hình" }, { status: 500 });
  }

  const forMessages = request.nextUrl.searchParams.get("for") === "messages";
  const redirectUri = `${getAppBaseUrl()}/api/facebook/callback`;
  const state = createOAuthState(session!.user.id);
  // Không dùng config_id — Login Configuration chỉ có quyền đăng nhập.
  // Kết nối Ads/Messenger cần scope rõ ràng.
  const scopes = forMessages ? FB_MESSAGING_SCOPES : FB_ADS_SCOPES;
  const url = buildFacebookOAuthUrl(redirectUri, state, scopes, {
    authType: forMessages ? "rerequest" : undefined,
  });

  return NextResponse.redirect(url);
}

import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  syncFacebookAdsAccount,
  verifyOAuthState,
} from "@/lib/facebook/sync-account";
import { clearMessagingPermissionCache } from "@/lib/facebook/messaging-access";
import {
  FACEBOOK_RATE_LIMIT_MESSAGE,
  isFacebookRateLimitError,
  noteFacebookRateLimitFromError,
} from "@/lib/facebook/rate-limit";
import { syncAllAdAccountsForUser } from "@/lib/jobs/sync-data";
import { appUrl, getAppBaseUrl } from "@/lib/site-url";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (oauthError) {
    const params = new URLSearchParams({ error: oauthError });
    if (errorDescription) params.set("error_description", errorDescription);
    return NextResponse.redirect(appUrl(`/settings?${params.toString()}`, request));
  }

  if (!code || !state) {
    return NextResponse.redirect(appUrl("/settings?error=missing_code", request));
  }

  const userId = verifyOAuthState(state);
  if (!userId) {
    return NextResponse.redirect(appUrl("/settings?error=invalid_state", request));
  }

  try {
    const redirectUri = `${getAppBaseUrl(request)}/api/facebook/callback`;
    const accessToken = await exchangeCodeForToken(code, redirectUri);
    await syncFacebookAdsAccount(userId, accessToken);
    clearMessagingPermissionCache(userId);
    try {
      await syncAllAdAccountsForUser(userId, accessToken);
    } catch {
      // Initial full sync optional — user can sync from Campaigns
    }

    return NextResponse.redirect(appUrl("/settings?connected=1", request));
  } catch (err) {
    console.error("[facebook/callback] connect failed:", err);
    noteFacebookRateLimitFromError(err);
    const detail = isFacebookRateLimitError(err)
      ? FACEBOOK_RATE_LIMIT_MESSAGE
      : err instanceof Error
        ? err.message
        : "connect_failed";
    const errorCode = isFacebookRateLimitError(err) ? "rate_limit" : "connect_failed";
    return NextResponse.redirect(
      appUrl(
        `/settings?error=${errorCode}&error_description=${encodeURIComponent(detail)}`,
        request
      )
    );
  }
}

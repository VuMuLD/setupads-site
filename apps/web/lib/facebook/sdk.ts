import { FB_AUTH_SCOPES } from "@fb-ads/shared";
import type { FacebookLoginStatusResponse } from "@/types/facebook-sdk";

export const FB_API_VERSION = "v21.0";
export const FB_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

export function getFacebookAppId(): string {
  return process.env.NEXT_PUBLIC_FACEBOOK_CLIENT_ID || "";
}

export function getFacebookConfigId(): string {
  return process.env.NEXT_PUBLIC_FACEBOOK_CONFIG_ID || "";
}

export function isFacebookSdkConfigured(): boolean {
  return Boolean(getFacebookAppId());
}

export function getFacebookLoginScopes(): string {
  return FB_AUTH_SCOPES;
}

export function describeFacebookStatus(
  response: FacebookLoginStatusResponse
): string {
  switch (response.status) {
    case "connected":
      return "Đã kết nối Facebook";
    case "not_authorized":
      return "Đã đăng nhập Facebook nhưng chưa cấp quyền cho ứng dụng";
    default:
      return "Chưa đăng nhập Facebook";
  }
}

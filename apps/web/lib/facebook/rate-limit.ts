import { FacebookAPIError } from "@/lib/facebook/graph-client";

const DEFAULT_COOLDOWN_MS = 20 * 60 * 1000;

let appBlockedUntil = 0;

export function isFacebookAppRateLimited(): boolean {
  return Date.now() < appBlockedUntil;
}

export function markFacebookAppRateLimited(cooldownMs = DEFAULT_COOLDOWN_MS): void {
  appBlockedUntil = Date.now() + cooldownMs;
}

export function getFacebookRateLimitRetryAfterMs(): number {
  return Math.max(0, appBlockedUntil - Date.now());
}

export function isFacebookRateLimitError(err: unknown): boolean {
  if (!(err instanceof FacebookAPIError)) return false;
  const code = err.fbError?.code;
  return code === 4 || code === 17 || code === 32 || err.statusCode === 429;
}

export const FACEBOOK_RATE_LIMIT_MESSAGE =
  "Facebook tạm giới hạn số request của app (#4). Đợi 20–30 phút rồi thử lại — tránh bấm đồng bộ/kết nối liên tục.";

export function noteFacebookRateLimitFromError(err: unknown): void {
  if (isFacebookRateLimitError(err)) {
    markFacebookAppRateLimited();
  }
}

import { getFacebookAccessToken } from "@/lib/auth";
import { decrypt } from "@/lib/crypto/token-encryption";
import { encrypt } from "@/lib/crypto/token-encryption";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import {
  FACEBOOK_RATE_LIMIT_MESSAGE,
  getFacebookRateLimitRetryAfterMs,
  isFacebookAppRateLimited,
  isFacebookRateLimitError,
  noteFacebookRateLimitFromError,
} from "@/lib/facebook/rate-limit";
import { prisma } from "@/lib/prisma";

export class MessagingPermissionError extends Error {
  code = "MESSAGING_PERMISSION" as const;

  constructor(message: string) {
    super(message);
    this.name = "MessagingPermissionError";
  }
}

const REQUIRED_MESSAGING_PERMISSIONS = [
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_show_list",
] as const;

const PERM_CACHE_TTL_MS = 10 * 60 * 1000;
const permCache = new Map<
  string,
  { result: Awaited<ReturnType<typeof checkUserMessagingPermission>>; expiresAt: number }
>();

export function clearMessagingPermissionCache(userId?: string): void {
  if (userId) permCache.delete(userId);
  else permCache.clear();
}

export async function refreshPageTokens(userId: string): Promise<number> {
  const userToken = await getFacebookAccessToken(userId);
  if (!userToken) {
    throw new MessagingPermissionError(
      "Token Facebook hết hạn. Vào Cài đặt → Kết nối lại Facebook."
    );
  }

  const fbAccount = await prisma.facebookAccount.findFirst({
    where: { userId, isActive: true },
  });
  if (!fbAccount) {
    throw new MessagingPermissionError("Chưa kết nối Facebook.");
  }

  const client = new FacebookGraphClient(userToken);
  const { data: fbPages } = await client.getPages();
  let updated = 0;

  for (const fbPage of fbPages) {
    await prisma.page.upsert({
      where: {
        facebookAccountId_fbPageId: {
          facebookAccountId: fbAccount.id,
          fbPageId: fbPage.id,
        },
      },
      create: {
        facebookAccountId: fbAccount.id,
        fbPageId: fbPage.id,
        name: fbPage.name,
        accessTokenEncrypted: encrypt(fbPage.access_token),
        category: fbPage.category,
      },
      update: {
        name: fbPage.name,
        accessTokenEncrypted: encrypt(fbPage.access_token),
        category: fbPage.category,
        isActive: true,
      },
    });
    updated++;
  }

  clearMessagingPermissionCache(userId);
  return updated;
}

export async function checkUserMessagingPermission(userId: string): Promise<{
  granted: boolean;
  status: string;
  missing: string[];
  rateLimited?: boolean;
  retryAfterMs?: number;
}> {
  const cached = permCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  if (isFacebookAppRateLimited()) {
    const retryAfterMs = getFacebookRateLimitRetryAfterMs();
    return {
      granted: false,
      status: "rate_limited",
      missing: [...REQUIRED_MESSAGING_PERMISSIONS],
      rateLimited: true,
      retryAfterMs,
    };
  }

  const userToken = await getFacebookAccessToken(userId);
  if (!userToken) {
    return {
      granted: false,
      status: "no_token",
      missing: ["pages_messaging"],
    };
  }

  const client = new FacebookGraphClient(userToken);

  try {
    const { data } = await client.getPermissions();
    const granted = new Set(
      data.filter((p) => p.status === "granted").map((p) => p.permission)
    );
    const missing = REQUIRED_MESSAGING_PERMISSIONS.filter((p) => !granted.has(p));
    const result =
      missing.length === 0
        ? { granted: true, status: "granted", missing: [] as string[] }
        : { granted: false, status: "missing", missing: [...missing] };

    permCache.set(userId, { result, expiresAt: Date.now() + PERM_CACHE_TTL_MS });
    return result;
  } catch (err) {
    noteFacebookRateLimitFromError(err);
    if (isFacebookRateLimitError(err)) {
      return {
        granted: false,
        status: "rate_limited",
        missing: [...REQUIRED_MESSAGING_PERMISSIONS],
        rateLimited: true,
        retryAfterMs: getFacebookRateLimitRetryAfterMs(),
      };
    }
    return { granted: false, status: "unknown", missing: [...REQUIRED_MESSAGING_PERMISSIONS] };
  }
}

export function formatMessagingError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("Application request limit") || msg.includes("#4")) {
    return FACEBOOK_RATE_LIMIT_MESSAGE;
  }

  if (msg.includes("pages_messaging") || msg.includes("appropriate role")) {
    return [
      "Thiếu quyền Messenger (pages_messaging) hoặc tài khoản Facebook không phải Admin/Editor của Page.",
      "",
      "Cách xử lý:",
      "1. Vào Cài đặt → bấm «Cấp quyền Messenger» (kết nối lại Facebook)",
      "2. Chấp nhận TẤT CẢ quyền, đặc biệt pages_messaging",
      "3. Trên Meta Developer: App → Use cases → thêm quyền pages_messaging",
      "4. Đảm bảo bạn là Admin/Editor của Page trên Facebook",
    ].join("\n");
  }

  if (err instanceof MessagingPermissionError) return err.message;
  return msg;
}

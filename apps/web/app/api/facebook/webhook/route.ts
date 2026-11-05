import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncPageMessages } from "@/lib/jobs/sync-page-messages";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";

/**
 * Facebook Page Webhook — "chuông cửa" cho hệ thống tin nhắn.
 *
 * Facebook đẩy sự kiện tin nhắn mới về đây gần như tức thì. Route này chỉ
 * xác thực + kích hoạt lại đúng luồng đồng bộ/trả lời AI sẵn có
 * (syncPageMessages -> autoReplyToInbound), nên hành vi trả lời không đổi,
 * chỉ nhanh hơn nhiều so với quét định kỳ 5 phút (cron vẫn chạy làm lưới an toàn).
 *
 * Bảo mật: GET bắt tay bằng FACEBOOK_WEBHOOK_VERIFY_TOKEN,
 * POST bắt buộc đúng chữ ký X-Hub-Signature-256 (HMAC bằng FACEBOOK_CLIENT_SECRET).
 * Route này nằm trong publicPaths của middleware vì Facebook không có session.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MessagingEvent {
  message?: { mid?: string; text?: string; is_echo?: boolean };
}

interface WebhookEntry {
  id?: string;
  messaging?: MessagingEvent[];
}

/** GET: Facebook verify handshake (và ping kiểm tra sống khi mở trực tiếp). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && challenge) {
    if (verifyToken && token === verifyToken) {
      return new NextResponse(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.json({ ok: true, service: "facebook-webhook" });
}

function isValidSignature(
  rawBody: string,
  header: string | null,
  secret: string
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const given = header.slice("sha256=".length);
  if (!/^[0-9a-f]+$/i.test(given)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Hàng đợi đồng bộ theo từng Page: nếu khách nhắn dồn dập, các sự kiện được
 * gộp lại — tối đa 1 lần đồng bộ đang chạy + 1 lần chạy nối tiếp cho mỗi Page,
 * tránh spam Graph API và tránh trả lời trùng (autoReplyToInbound cũng đã có
 * chốt chặn: bỏ qua nếu đã có tin trả lời sau tin khách).
 */
const pageJobs = new Map<string, { running: boolean; queued: boolean }>();

async function runPageSync(pageId: string, userId: string) {
  const job = pageJobs.get(pageId) ?? { running: false, queued: false };
  pageJobs.set(pageId, job);
  if (job.running) {
    job.queued = true;
    return;
  }
  job.running = true;
  try {
    do {
      job.queued = false;
      if (isFacebookAppRateLimited()) {
        console.warn(
          `[fb-webhook] Bỏ qua đồng bộ page ${pageId}: đang cooldown rate limit Facebook`
        );
        break;
      }
      try {
        const result = await syncPageMessages(pageId, userId, {
          conversationLimit: 10,
          messageLimit: 20,
        });
        console.log(
          `[fb-webhook] Page ${pageId}: đồng bộ ${result.messagesSynced} tin, AI đã trả lời ${result.aiSuggestions}`
        );
      } catch (err) {
        console.error(`[fb-webhook] Đồng bộ page ${pageId} thất bại:`, err);
      }
    } while (job.queued);
  } finally {
    job.running = false;
  }
}

async function processPages(fbPageIds: string[]) {
  for (const fbPageId of fbPageIds) {
    const pages = await prisma.page.findMany({
      where: { fbPageId, isActive: true },
      include: {
        facebookAccount: { select: { userId: true, isActive: true } },
      },
    });
    if (pages.length === 0) {
      console.warn(`[fb-webhook] Page ${fbPageId} chưa được kết nối, bỏ qua`);
      continue;
    }
    for (const page of pages) {
      if (!page.facebookAccount?.isActive) continue;
      void runPageSync(page.id, page.facebookAccount.userId);
    }
  }
}

/** POST: nhận sự kiện từ Facebook. Trả 200 ngay, xử lý nền trong tiến trình Node (PM2). */
export async function POST(request: NextRequest) {
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET;
  if (!appSecret) {
    return NextResponse.json(
      { error: "Facebook app not configured" },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  if (
    !isValidSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      appSecret
    )
  ) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: { object?: string; entry?: WebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (body.object !== "page") {
    return NextResponse.json({ received: true, ignored: true });
  }

  const fbPageIds = new Set<string>();
  for (const entry of body.entry ?? []) {
    const fbPageId = entry?.id ? String(entry.id) : "";
    if (!fbPageId) continue;
    let hasCustomerMessage = false;
    for (const event of entry.messaging ?? []) {
      const msg = event?.message;
      // Bỏ qua: sự kiện không phải tin nhắn (đã gửi/đã đọc/postback)
      // và tin echo (chính Page gửi ra — tránh vòng lặp tự kích hoạt).
      if (!msg || msg.is_echo) continue;
      hasCustomerMessage = true;
    }
    if (hasCustomerMessage) fbPageIds.add(fbPageId);
  }

  if (fbPageIds.size > 0) {
    void processPages(Array.from(fbPageIds)).catch((err) =>
      console.error("[fb-webhook] Xử lý sự kiện thất bại:", err)
    );
  }

  return NextResponse.json({ received: true });
}

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { generateMessageAdvice } from "@/lib/ai/message-advisor";
import { sendConversationReply } from "@/lib/messages/send-page-reply";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";

/**
 * Vòng mời lại 21:00 hằng ngày (chủ shop chốt 8/11): cào khách CỦA NGÀY HÔM
 * ĐÓ (giờ Sài Gòn) mà CHƯA MUA, gửi 1 tin mời chào mua lại theo góc
 * follow_up_offer (giá + freeship + kiểm tra hàng trước khi nhận).
 *
 * Chống giẫm chuỗi chăm sóc 4 bước (follow-up-nudge.ts):
 * - Chỉ khách bot đang phụ trách (tin khách gần nhất do AI trả lời, tin cuối
 *   là của shop/bot, khách đã im lặng >= 1h) — chat nhân viên đang cầm thì
 *   không chen vào.
 * - Hội thoại đã nhận bước 3 (chính là tin mời mua) hoặc bước 4 cho lượt im
 *   lặng này -> bỏ qua, không mời trùng.
 * - Đã có tin chăm sóc trong 3h gần nhất -> bỏ qua, tránh dồn dập.
 * - Đã có đơn (chưa huỷ) trên hội thoại -> bỏ qua tuyệt đối (luật im lặng
 *   sau chốt đơn). Khách opt-out trong page_potential_leads -> bỏ qua.
 * - Khách từ chối rõ trong tin gần nhất (không mua / đừng nhắn...) -> bỏ qua.
 * Gửi xong ghi vào page_conversation_nudges với step=3 để chuỗi 4 bước hiểu
 * là lượt này đã nhận tin mời mua (bước tiếp theo nếu có chỉ còn bước cuối).
 */
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 23 * HOUR_MS;
const MAX_PER_PAGE = 30;

const REFUSAL_PATTERNS = [
  "khong mua",
  "ko mua",
  "dung nhan",
  "dung gui",
  "spam",
  "khong can",
  "ko can",
  "thoi khoi",
  "khong dat",
  "ko dat",
];

function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function saigonParts(now: Date): { hourFloat: number; dayStartUtc: Date } {
  // Asia/Saigon = UTC+7 cố định: dịch +7h rồi đọc theo UTC cho chắc chắn
  const shifted = new Date(now.getTime() + 7 * HOUR_MS);
  const hourFloat = shifted.getUTCHours() + shifted.getUTCMinutes() / 60;
  const dayStartUtc = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      0,
      0,
      0
    ) -
      7 * HOUR_MS
  );
  return { hourFloat, dayStartUtc };
}

export interface RepitchCandidate {
  conversationId: string;
  participantName: string | null;
  lastInboundAt: string;
  stepsSent: number[];
}

export interface RepitchPageResult {
  pageId: string;
  pageName: string;
  eligible: RepitchCandidate[];
  sent: number;
  skipped: Record<string, number>;
}

async function collectPage(
  page: { id: string; name: string },
  now: Date,
  dayStartUtc: Date
): Promise<{ eligible: RepitchCandidate[]; skipped: Record<string, number> }> {
  const skipped: Record<string, number> = {};
  const bump = (k: string) => {
    skipped[k] = (skipped[k] || 0) + 1;
  };
  const eligible: RepitchCandidate[] = [];

  const conversations = await prisma.pageConversation.findMany({
    where: {
      pageId: page.id,
      lastMessageAt: {
        gte: dayStartUtc,
        lte: new Date(now.getTime() - 1 * HOUR_MS),
      },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 120,
  });

  for (const conv of conversations) {
    const messages = await prisma.pageMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { sentAt: "desc" },
      take: 12,
    });
    if (messages.length === 0) {
      bump("no_messages");
      continue;
    }
    const last = messages[0];
    if (last.direction !== "OUTBOUND") {
      bump("waiting_reply");
      continue;
    }
    if (now.getTime() - last.sentAt.getTime() < 1 * HOUR_MS) {
      bump("too_recent");
      continue;
    }
    const lastInbound = messages.find((m) => m.direction === "INBOUND");
    if (!lastInbound) {
      bump("no_inbound");
      continue;
    }
    if (lastInbound.sentAt.getTime() < dayStartUtc.getTime()) {
      bump("not_today");
      continue;
    }
    if (now.getTime() - lastInbound.sentAt.getTime() > WINDOW_MS) {
      bump("outside_24h");
      continue;
    }
    if (!lastInbound.aiSuggestedReply || !lastInbound.aiReplyAt) {
      bump("staff_handled");
      continue;
    }

    // Tin shop cuối phải do bot gửi (sát lúc AI trả lời hoặc sát tin chăm sóc trước)
    const nudges = await prisma.$queryRawUnsafe<
      Array<{ step: number; nudged_at: Date }>
    >(
      "SELECT step, nudged_at FROM page_conversation_nudges WHERE conversation_id = ? AND anchor_message_id = ? ORDER BY step ASC",
      conv.id,
      lastInbound.id
    );
    const deltaAi = last.sentAt.getTime() - lastInbound.aiReplyAt.getTime();
    let botSent = deltaAi >= -15_000 && deltaAi <= 5 * 60 * 1000;
    if (!botSent) {
      for (const n of nudges) {
        const d = last.sentAt.getTime() - new Date(n.nudged_at).getTime();
        if (d >= -5 * 60 * 1000 && d <= 60_000) {
          botSent = true;
          break;
        }
      }
    }
    if (!botSent) {
      bump("staff_last_outbound");
      continue;
    }

    const stepsSent = nudges.map((n) => Number(n.step));
    if (stepsSent.length && Math.max(...stepsSent) >= 3) {
      bump("already_offered");
      continue;
    }
    if (
      nudges.length &&
      now.getTime() -
        Math.max(...nudges.map((n) => new Date(n.nudged_at).getTime())) <
        3 * HOUR_MS
    ) {
      bump("nudged_recently");
      continue;
    }

    const refusal = stripDiacritics(lastInbound.text || "");
    if (REFUSAL_PATTERNS.some((p) => refusal.includes(p))) {
      bump("refused");
      continue;
    }

    const order = await prisma.pageCustomerOrder.findFirst({
      where: { conversationId: conv.id, status: { not: "cancelled" } },
      select: { id: true },
    });
    if (order) {
      bump("has_order");
      continue;
    }

    const optOut = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      "SELECT COUNT(*) AS c FROM page_potential_leads WHERE conversation_id = ? AND status = 'opt_out'",
      conv.id
    );
    if (Number(optOut[0]?.c ?? 0) > 0) {
      bump("opt_out");
      continue;
    }

    eligible.push({
      conversationId: conv.id,
      participantName: conv.participantName,
      lastInboundAt: lastInbound.sentAt.toISOString(),
      stepsSent,
    });
  }

  return { eligible, skipped };
}

export async function runDailyRepitch(options: {
  dryRun: boolean;
  force?: boolean;
}): Promise<{ pages: RepitchPageResult[]; dryRun: boolean }> {
  const now = new Date();
  const { hourFloat, dayStartUtc } = saigonParts(now);

  if (!options.dryRun && !options.force) {
    if (hourFloat < 20.9 || hourFloat >= 21.5) {
      throw new Error(
        `Ngoài khung giờ gửi 21:00-21:30 (giờ Sài Gòn hiện ${hourFloat.toFixed(2)}) — huỷ lượt gửi thật`
      );
    }
  }
  if (!options.dryRun && isFacebookAppRateLimited()) {
    throw new Error("Facebook app đang bị giới hạn — huỷ lượt gửi thật");
  }

  const pages = await prisma.page.findMany({
    where: { isActive: true, autoAiEnabled: true },
    include: { facebookAccount: true },
  });

  const results: RepitchPageResult[] = [];
  for (const page of pages) {
    const { eligible, skipped } = await collectPage(
      { id: page.id, name: page.name },
      now,
      dayStartUtc
    );
    let sent = 0;
    if (!options.dryRun) {
      for (const cand of eligible.slice(0, MAX_PER_PAGE)) {
        // Dừng gửi khi chạm 21:30 giờ Sài Gòn
        if (saigonParts(new Date()).hourFloat >= 21.5) break;
        try {
          const messages = await prisma.pageMessage.findMany({
            where: { conversationId: cand.conversationId },
            orderBy: { sentAt: "desc" },
            take: 4,
          });
          const lastInbound = messages.find((m) => m.direction === "INBOUND");
          const lastOutbound = messages.find((m) => m.direction === "OUTBOUND");
          if (!lastInbound) continue;
          const advice = await generateMessageAdvice({
            userId: page.facebookAccount.userId,
            pageId: page.id,
            messageId: lastInbound.id,
            stageOverride: "follow_up_offer",
          });
          const text = (advice.reply || "").trim();
          if (!text) continue;
          if (
            lastOutbound &&
            normalizeText(text) === normalizeText(lastOutbound.text)
          ) {
            continue;
          }
          await sendConversationReply({
            conversationId: cand.conversationId,
            userId: page.facebookAccount.userId,
            text,
            stripCustomerName: true,
          });
          await prisma.$executeRawUnsafe(
            "INSERT INTO page_conversation_nudges (id, conversation_id, anchor_message_id, step) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
            randomUUID(),
            cand.conversationId,
            lastInbound.id,
            3
          );
          sent++;
        } catch (err) {
          console.error(
            `[repitch-21h] Lỗi gửi hội thoại ${cand.conversationId}:`,
            err
          );
        }
      }
    }
    results.push({
      pageId: page.id,
      pageName: page.name,
      eligible,
      sent,
      skipped,
    });
  }
  return { pages: results, dryRun: options.dryRun };
}

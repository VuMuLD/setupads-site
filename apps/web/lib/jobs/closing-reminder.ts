import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendConversationReply } from "@/lib/messages/send-page-reply";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";

/**
 * Nhắc chốt đơn 3 khung/ngày (chủ shop chốt 16/11): 9h, 16h, 21h giờ Sài
 * Gòn, gửi đúng câu chốt nguyên văn cho khách nhắn trong ngày mà chưa lên
 * đơn. Mỗi khách tối đa 2 lần câu này mỗi ngày — đếm trên tin OUTBOUND thực
 * tế trong ngày, gồm cả câu bot gửi lúc chat trực tiếp và câu của hệ thống
 * canned: đủ 2 lần thì thôi, dưới 2 lần thì gửi lại.
 *
 * Điều kiện an toàn (mượn từ daily-repitch.ts):
 * - Chỉ khách nhắn trong ngày (giờ Sài Gòn), chưa có đơn chưa huỷ, bot đang
 *   phụ trách (tin khách gần nhất do AI trả lời, tin cuối là của bot), khách
 *   đã im lặng >= 1h, trong cửa sổ 24h của Facebook.
 * - Đã có tin chăm sóc trong 3h gần nhất -> bỏ qua, tránh dồn dập.
 * - Đã nhận bước 4 (tin cuối của chuỗi chăm sóc) -> bỏ qua.
 * - Khách từ chối rõ / opt-out -> bỏ qua.
 * - Tin cuối vừa là câu chốt -> bỏ qua lượt này (tránh gửi trùng liền).
 * Gửi xong ghi vào page_conversation_nudges với step=3 để chuỗi 4 bước hiểu
 * là lượt này đã nhận tin mời mua (bước tiếp theo nếu có chỉ còn bước cuối).
 */
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 23 * HOUR_MS;
const MAX_PER_PAGE = 30;
const MAX_CLOSING_PER_DAY = 2;

export const CLOSING_LINE =
  "👉 Anh/Chị cho em xin Tên + SĐT + Địa chỉ, em lên đơn cho mình ạ";
const CLOSING_CORE = "cho em xin Tên + SĐT + Địa chỉ";

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

export interface ClosingCandidate {
  conversationId: string;
  participantName: string | null;
  lastInboundAt: string;
  closingSentToday: number;
  stepsSent: number[];
}

// Khách đủ điều kiện lúc quét nhưng bị bỏ qua ngay trước khi gửi (kiểm tra
// lại): ghi rõ lý do + tên để báo cáo nêu được, thay vì phải đoán như vụ
// Long Phi tối 15/11 (đủ điều kiện, không nhận được tin, log không có lỗi).
export interface ClosingSendSkip {
  conversationId: string;
  participantName: string | null;
  reason: "no_inbound" | "just_sent" | "closing_cap";
}

export interface ClosingPageResult {
  pageId: string;
  pageName: string;
  eligible: ClosingCandidate[];
  sent: number;
  skipped: Record<string, number>;
  sendSkipped: ClosingSendSkip[];
}

async function countClosingToday(
  conversationId: string,
  dayStartUtc: Date
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
    "SELECT COUNT(*) AS c FROM page_messages WHERE conversation_id = ? AND direction = 'OUTBOUND' AND sent_at >= ? AND text LIKE ?",
    conversationId,
    dayStartUtc,
    `%${CLOSING_CORE}%`
  );
  return Number(rows[0]?.c ?? 0);
}

async function collectPage(
  page: { id: string; name: string },
  now: Date,
  dayStartUtc: Date
): Promise<{ eligible: ClosingCandidate[]; skipped: Record<string, number> }> {
  const skipped: Record<string, number> = {};
  const bump = (k: string) => {
    skipped[k] = (skipped[k] || 0) + 1;
  };
  const eligible: ClosingCandidate[] = [];

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
    if (stepsSent.length && Math.max(...stepsSent) >= 4) {
      bump("already_final");
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
      where: {
        conversationId: conv.id,
        status: { not: "cancelled" },
        phone: { not: null },
        address: { not: null },
      },
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

    // Cap 2 lần câu chốt/ngày: đếm tin OUTBOUND chứa câu chốt trong ngày
    const closingSentToday = await countClosingToday(conv.id, dayStartUtc);
    if (closingSentToday >= MAX_CLOSING_PER_DAY) {
      bump("closing_cap");
      continue;
    }
    // Tin cuối vừa là câu chốt -> bỏ qua lượt này, để lượt sau
    if ((last.text || "").includes(CLOSING_CORE)) {
      bump("just_sent");
      continue;
    }

    eligible.push({
      conversationId: conv.id,
      participantName: conv.participantName,
      lastInboundAt: lastInbound.sentAt.toISOString(),
      closingSentToday,
      stepsSent,
    });
  }

  return { eligible, skipped };
}

export async function runClosingReminder(options: {
  dryRun: boolean;
  slot: number;
  force?: boolean;
}): Promise<{ pages: ClosingPageResult[]; dryRun: boolean; slot: number }> {
  const now = new Date();
  const { hourFloat, dayStartUtc } = saigonParts(now);
  const slot = options.slot;

  if (!options.dryRun && !options.force) {
    if (hourFloat < slot - 0.1 || hourFloat >= slot + 0.5) {
      throw new Error(
        `Ngoài khung giờ gửi ${slot}:00-${slot}:30 (giờ Sài Gòn hiện ${hourFloat.toFixed(2)}) — huỷ lượt gửi thật`
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

  const results: ClosingPageResult[] = [];
  for (const page of pages) {
    const { eligible, skipped } = await collectPage(
      { id: page.id, name: page.name },
      now,
      dayStartUtc
    );
    let sent = 0;
    // Chỉ ghi log: 3 chỗ bỏ qua lặng trong vòng gửi (trước đây `continue`
    // không ghi gì nên eligible > sent mà báo cáo không nêu được lý do).
    // Không đổi luật gửi, không đổi điều kiện.
    const sendSkipped: ClosingSendSkip[] = [];
    const bumpSend = (k: string) => {
      skipped[k] = (skipped[k] || 0) + 1;
    };
    if (!options.dryRun) {
      for (const cand of eligible.slice(0, MAX_PER_PAGE)) {
        // Dừng gửi khi chạm cuối khung giờ của slot
        if (saigonParts(new Date()).hourFloat >= slot + 0.5) break;
        try {
          const messages = await prisma.pageMessage.findMany({
            where: { conversationId: cand.conversationId },
            orderBy: { sentAt: "desc" },
            take: 4,
          });
          const lastInbound = messages.find((m) => m.direction === "INBOUND");
          const lastOutbound = messages.find((m) => m.direction === "OUTBOUND");
          if (!lastInbound) {
            bumpSend("send_no_inbound");
            sendSkipped.push({
              conversationId: cand.conversationId,
              participantName: cand.participantName,
              reason: "no_inbound",
            });
            continue;
          }
          // Kiểm tra lại cap + tin cuối ngay trước khi gửi (khách có thể
          // vừa nhận câu chốt từ bot trực tiếp sau lúc quét)
          if (lastOutbound && (lastOutbound.text || "").includes(CLOSING_CORE)) {
            bumpSend("send_just_sent");
            sendSkipped.push({
              conversationId: cand.conversationId,
              participantName: cand.participantName,
              reason: "just_sent",
            });
            continue;
          }
          if ((await countClosingToday(cand.conversationId, dayStartUtc)) >= MAX_CLOSING_PER_DAY) {
            bumpSend("send_closing_cap");
            sendSkipped.push({
              conversationId: cand.conversationId,
              participantName: cand.participantName,
              reason: "closing_cap",
            });
            continue;
          }
          await sendConversationReply({
            conversationId: cand.conversationId,
            userId: page.facebookAccount.userId,
            text: CLOSING_LINE,
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
            `[closing-reminder] Lỗi gửi hội thoại ${cand.conversationId}:`,
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
      sendSkipped,
    });
  }
  return { pages: results, dryRun: options.dryRun, slot };
}

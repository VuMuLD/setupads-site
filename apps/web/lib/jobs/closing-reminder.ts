import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendConversationReply } from "@/lib/messages/send-page-reply";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";

/**
 * Nhắc chốt đơn 3 khung/ngày (chủ shop chốt 16/11): 9h, 16h, 21h giờ Sài
 * Gòn, gửi đúng câu chốt nguyên văn cho khách chưa lên đơn. Mỗi khách tối
 * đa 2 lần câu này mỗi ngày — đếm trên tin OUTBOUND thực tế trong ngày,
 * gồm cả câu bot gửi lúc chat trực tiếp và câu của hệ thống canned: đủ 2
 * lần thì thôi, dưới 2 lần thì gửi lại.
 *
 * Luật chọn khách (nới 16/11, user: "chỉ bỏ qua người đã mua còn lại gửi
 * hết"): gửi hết mọi hội thoại có tin khách trong cửa sổ 24h, KHÔNG phân
 * biệt bot hay nhân viên đang cầm, không yêu cầu nhắn trong ngày hay im
 * lặng. Chỉ bỏ qua:
 * - Đã có đơn chưa huỷ đủ SĐT + địa chỉ (người đã mua).
 * - Ngoài cửa sổ 24h của Facebook (giới hạn kỹ thuật: API từ chối gửi).
 * - Khách từ chối rõ / opt-out (chống spam, bảo vệ Page).
 * - Đã đủ 2 lần câu chốt trong ngày, hoặc tin shop cuối vừa là câu chốt.
 * Gửi xong ghi vào page_conversation_nudges với step=3 để chuỗi 4 bước hiểu
 * là lượt này đã nhận tin mời mua (bước tiếp theo nếu có chỉ còn bước cuối).
 */
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 23 * HOUR_MS;
const MAX_PER_PAGE = 100;
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

  // Luật nới 16/11: quét mọi hội thoại có tin trong 24h qua, không phân
  // biệt bot hay nhân viên đang cầm, không yêu cầu nhắn trong ngày hay
  // im lặng — chỉ các bộ lọc ở dưới mới loại khách ra.
  const conversations = await prisma.pageConversation.findMany({
    where: {
      pageId: page.id,
      lastMessageAt: {
        gte: new Date(now.getTime() - WINDOW_MS),
      },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
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
    const lastInbound = messages.find((m) => m.direction === "INBOUND");
    if (!lastInbound) {
      bump("no_inbound");
      continue;
    }
    // Cửa sổ 24h của Facebook: ngoài cửa sổ API từ chối gửi — giữ lại vì
    // là giới hạn kỹ thuật, không phải luật chọn khách.
    if (now.getTime() - lastInbound.sentAt.getTime() > WINDOW_MS) {
      bump("outside_24h");
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

    // Cap 2 lần câu chốt/ngày (luật user chốt sáng 16/11 — giữ nguyên):
    // đếm tin OUTBOUND chứa câu chốt trong ngày.
    const closingSentToday = await countClosingToday(conv.id, dayStartUtc);
    if (closingSentToday >= MAX_CLOSING_PER_DAY) {
      bump("closing_cap");
      continue;
    }
    // Tin shop cuối vừa là câu chốt -> bỏ qua lượt này, tránh gửi trùng liền.
    const lastOutbound = messages.find((m) => m.direction === "OUTBOUND");
    if (lastOutbound && (lastOutbound.text || "").includes(CLOSING_CORE)) {
      bump("just_sent");
      continue;
    }

    eligible.push({
      conversationId: conv.id,
      participantName: conv.participantName,
      lastInboundAt: lastInbound.sentAt.toISOString(),
      closingSentToday,
      stepsSent: [],
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

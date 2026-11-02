import { prisma } from "@/lib/prisma";
import {
  analyzeLostConversation,
  learnFromConversation,
} from "@/lib/ai/customer-learning";
import { shouldLearnFromConversation } from "@/lib/messages/customer-memory";
import { detectCustomerPurchaseCommitment } from "@/lib/messages/purchase-detection";
import { getManualLabelsFromDb } from "@/lib/messages/conversation-status";

const DAY_MS = 24 * 60 * 60 * 1000;

interface HarvestOptions {
  windowMs: number;
  maxWin: number;
  maxLost: number;
  maxScan: number;
  /** Bỏ qua hội thoại đã học trong khoảng này (Infinity = đã học bao giờ cũng bỏ qua) */
  skipLearnedWithinMs: number;
}

async function harvestPage(
  page: { id: string; name: string },
  opts: HarvestOptions
): Promise<{ learned: number; lostAnalyzed: number }> {
  const conversations = await prisma.pageConversation.findMany({
    where: {
      pageId: page.id,
      lastMessageAt: { gte: new Date(Date.now() - opts.windowMs) },
    },
    orderBy: { lastMessageAt: "desc" },
    take: opts.maxScan,
    include: {
      messages: { orderBy: { sentAt: "asc" }, take: 50 },
    },
  });

  let learned = 0;
  let lost = 0;

  for (const conversation of conversations) {
    if (learned >= opts.maxWin && lost >= opts.maxLost) break;
    if (conversation.messages.length < 4) continue;

    const alreadyLearned = await prisma.pageCustomerLearning.findFirst({
      where: {
        conversationId: conversation.id,
        ...(Number.isFinite(opts.skipLearnedWithinMs)
          ? {
              createdAt: {
                gt: new Date(Date.now() - opts.skipLearnedWithinMs),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    if (alreadyLearned) continue;

    const flowMessages = conversation.messages.map((m) => ({
      direction: m.direction as "INBOUND" | "OUTBOUND",
      text: m.text,
      sentAt: m.sentAt,
    }));
    const purchasedLabel = getManualLabelsFromDb(
      conversation.manualLabels
    ).includes("purchased");
    const purchased = shouldLearnFromConversation(flowMessages, purchasedLabel);

    if (purchased && learned < opts.maxWin) {
      try {
        const result = await learnFromConversation(conversation.id, {
          force: true,
        });
        if (result.learned) learned++;
      } catch (err) {
        console.error("[learning-harvest] learn failed:", err);
      }
      continue;
    }

    // Hội thoại mất khách: tin cuối do Page gửi, đã im ≥3h, không có dấu hiệu chốt
    if (lost >= opts.maxLost) continue;
    if (conversation.messages.length < 6) continue;
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (lastMessage.direction !== "OUTBOUND") continue;
    if (lastMessage.sentAt > new Date(Date.now() - 3 * 60 * 60 * 1000)) {
      continue;
    }
    if (detectCustomerPurchaseCommitment(flowMessages)) continue;
    const orderCount = await prisma.pageCustomerOrder.count({
      where: { conversationId: conversation.id },
    });
    if (orderCount > 0) continue;

    try {
      const ok = await analyzeLostConversation(conversation.id);
      if (ok) lost++;
    } catch (err) {
      console.error("[learning-harvest] analyze lost failed:", err);
    }
  }

  if (learned > 0 || lost > 0) {
    console.log(
      `[learning-harvest] Page ${page.name}: học ${learned} hội thoại chốt, phân tích ${lost} hội thoại mất khách`
    );
  }
  return { learned, lostAnalyzed: lost };
}

/**
 * Thu hoạch học tập mỗi tối:
 * - Hội thoại CHỐT ĐƠN trong 24h qua (cả AI lẫn nhân viên trả lời) → rút mẫu trả lời hiệu quả.
 * - Hội thoại MẤT KHÁCH (Page đã trả lời, khách im lặng ≥3h, không chốt) → phân tích điểm yếu để tránh lặp lại.
 * Bỏ qua hội thoại đã học trong 7 ngày gần nhất.
 */
export async function runLearningHarvest(): Promise<{
  pages: number;
  learned: number;
  lostAnalyzed: number;
}> {
  const pages = await prisma.page.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  let totalLearned = 0;
  let totalLost = 0;
  for (const page of pages) {
    const r = await harvestPage(page, {
      windowMs: DAY_MS,
      maxWin: 8,
      maxLost: 4,
      maxScan: 40,
      skipLearnedWithinMs: 7 * DAY_MS,
    });
    totalLearned += r.learned;
    totalLost += r.lostAnalyzed;
  }
  return { pages: pages.length, learned: totalLearned, lostAnalyzed: totalLost };
}

/**
 * Học ngược từ lịch sử tin nhắn cũ của MỘT Page (dùng khi mới bật tự chat cho
 * Page đã có sẵn khách): quét hội thoại trong `days` ngày, học cả hội thoại
 * chốt đơn lẫn mất khách, bỏ qua mọi hội thoại đã từng học.
 */
export async function runLearningBackfill(
  pageId: string,
  days = 90
): Promise<{
  page: string;
  learned: number;
  lostAnalyzed: number;
}> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, name: true },
  });
  if (!page) throw new Error("Page không tồn tại");
  const r = await harvestPage(page, {
    windowMs: days * DAY_MS,
    maxWin: 15,
    maxLost: 10,
    maxScan: 300,
    skipLearnedWithinMs: Number.POSITIVE_INFINITY,
  });
  return { page: page.name, learned: r.learned, lostAnalyzed: r.lostAnalyzed };
}

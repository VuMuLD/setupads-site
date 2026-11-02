import { prisma } from "@/lib/prisma";
import {
  analyzeLostConversation,
  learnFromConversation,
} from "@/lib/ai/customer-learning";
import { shouldLearnFromConversation } from "@/lib/messages/customer-memory";
import { detectCustomerPurchaseCommitment } from "@/lib/messages/purchase-detection";
import { getManualLabelsFromDb } from "@/lib/messages/conversation-status";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WIN_PER_PAGE = 8;
const MAX_LOST_PER_PAGE = 4;
const MAX_SCAN_PER_PAGE = 40;

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
    const conversations = await prisma.pageConversation.findMany({
      where: {
        pageId: page.id,
        lastMessageAt: { gte: new Date(Date.now() - DAY_MS) },
      },
      orderBy: { lastMessageAt: "desc" },
      take: MAX_SCAN_PER_PAGE,
      include: {
        messages: { orderBy: { sentAt: "asc" }, take: 50 },
      },
    });

    let learned = 0;
    let lost = 0;

    for (const conversation of conversations) {
      if (learned >= MAX_WIN_PER_PAGE && lost >= MAX_LOST_PER_PAGE) break;
      if (conversation.messages.length < 4) continue;

      const alreadyLearned = await prisma.pageCustomerLearning.findFirst({
        where: {
          conversationId: conversation.id,
          createdAt: { gt: new Date(Date.now() - 7 * DAY_MS) },
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
      const purchased = shouldLearnFromConversation(
        flowMessages,
        purchasedLabel
      );

      if (purchased && learned < MAX_WIN_PER_PAGE) {
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
      if (lost >= MAX_LOST_PER_PAGE) continue;
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
    totalLearned += learned;
    totalLost += lost;
  }

  return { pages: pages.length, learned: totalLearned, lostAnalyzed: totalLost };
}

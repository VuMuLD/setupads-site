import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { generateMessageAdvice } from "@/lib/ai/message-advisor";
import { sendConversationReply } from "@/lib/messages/send-page-reply";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";

const SILENCE_MS = 60 * 60 * 1000; // khách im lặng >= 1 giờ mới nhắc
const WINDOW_MS = 23 * 60 * 60 * 1000; // chỉ nhắc trong cửa sổ 24h của Facebook
const MAX_PER_PAGE_PER_RUN = 5;

let tableReady = false;

async function ensureNudgeTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS page_conversation_nudges (
       id VARCHAR(191) NOT NULL,
       conversation_id VARCHAR(191) NOT NULL,
       anchor_message_id VARCHAR(191) NOT NULL,
       nudged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_nudge_episode (conversation_id, anchor_message_id),
       KEY idx_nudge_conversation (conversation_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  tableReady = true;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function runFollowUpNudges() {
  if (isFacebookAppRateLimited()) {
    console.log("[follow-up] Bỏ qua lượt quét — Facebook app đang bị giới hạn");
    return;
  }
  try {
    await ensureNudgeTable();
  } catch (err) {
    console.error("[follow-up] Không khởi tạo được bảng nudge:", err);
    return;
  }

  const pages = await prisma.page.findMany({
    where: { isActive: true, autoAiEnabled: true },
    include: { facebookAccount: true },
  });

  for (const page of pages) {
    try {
      await processPage(page);
    } catch (err) {
      console.error(`[follow-up] Lỗi xử lý page ${page.id}:`, err);
    }
  }
}

async function processPage(page: {
  id: string;
  facebookAccount: { userId: string };
}) {
  const now = Date.now();
  const conversations = await prisma.pageConversation.findMany({
    where: {
      pageId: page.id,
      lastMessageAt: {
        lte: new Date(now - SILENCE_MS),
        gte: new Date(now - WINDOW_MS),
      },
    },
    orderBy: { lastMessageAt: "asc" },
    take: 50,
  });

  let sent = 0;
  for (const conv of conversations) {
    if (sent >= MAX_PER_PAGE_PER_RUN) break;
    try {
      if (await maybeNudge(page, conv)) sent++;
    } catch (err) {
      console.error(`[follow-up] Lỗi hội thoại ${conv.id}:`, err);
    }
  }
  if (sent > 0) {
    console.log(`[follow-up] Page ${page.id}: đã nhắc ${sent} khách`);
  }
}

async function maybeNudge(
  page: { id: string; facebookAccount: { userId: string } },
  conv: { id: string; participantName: string | null }
): Promise<boolean> {
  const messages = await prisma.pageMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { sentAt: "desc" },
    take: 12,
  });
  if (messages.length === 0) return false;

  // Tin cuối cùng phải là tin shop gửi (đang chờ khách trả lời)
  const last = messages[0];
  if (last.direction !== "OUTBOUND") return false;

  // Tin khách gần nhất phải là tin AI đã trả lời (khách chưa gửi gì mới sau đó)
  const lastInbound = messages.find((m) => m.direction === "INBOUND");
  if (!lastInbound || !lastInbound.aiSuggestedReply || !lastInbound.aiReplyAt) {
    return false;
  }

  // Tin shop cuối phải do chính bot gửi (sát thời điểm AI trả lời),
  // nếu nhân viên đã chat tay sau đó thì không chen vào.
  const delta = last.sentAt.getTime() - lastInbound.aiReplyAt.getTime();
  if (delta < -15_000 || delta > 5 * 60 * 1000) return false;

  // Đã chốt đơn từ hội thoại này thì không nhắc nữa
  const order = await prisma.pageCustomerOrder.findFirst({
    where: { conversationId: conv.id },
    select: { id: true },
  });
  if (order) return false;

  // Mỗi lượt im lặng chỉ nhắc 1 lần (neo theo tin khách gần nhất)
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT id FROM page_conversation_nudges WHERE conversation_id = ? AND anchor_message_id = ? LIMIT 1",
    conv.id,
    lastInbound.id
  );
  if (existing.length > 0) return false;

  // Soạn tin nhắc bằng chính bộ não tư vấn, ép stage follow_up (nhắc nhẹ, không ép)
  const advice = await generateMessageAdvice({
    userId: page.facebookAccount.userId,
    pageId: page.id,
    messageId: lastInbound.id,
    stageOverride: "follow_up",
  });
  const text = (advice.reply || "").trim();
  if (!text) return false;

  // Chống lặp: tin nhắc trùng y hệt tin bot vừa gửi thì bỏ qua
  if (normalizeText(text) === normalizeText(last.text)) return false;

  await sendConversationReply({
    conversationId: conv.id,
    userId: page.facebookAccount.userId,
    text,
  });

  await prisma.$executeRawUnsafe(
    "INSERT INTO page_conversation_nudges (id, conversation_id, anchor_message_id) VALUES (?, ?, ?)",
    randomUUID(),
    conv.id,
    lastInbound.id
  );

  console.log(
    `[follow-up] Đã nhắc khách ${conv.participantName || conv.id} (page ${page.id})`
  );
  return true;
}

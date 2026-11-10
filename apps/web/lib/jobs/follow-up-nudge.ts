import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { generateMessageAdvice } from "@/lib/ai/message-advisor";
import { sendConversationReply } from "@/lib/messages/send-page-reply";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";
import type { ConsultingStage } from "@/lib/messages/consulting-flow";

/**
 * Chuỗi chăm sóc khách im lặng chuẩn sale chuyên nghiệp — 4 chạm trong cửa sổ
 * 24h của Messenger (tính từ tin khách gần nhất):
 *   Bước 1 (+1h im lặng): nhắc nhẹ, không ép
 *   Bước 2 (+3h sau bước 1): tặng thêm 1 thông tin giá trị về sản phẩm
 *   Bước 3 (+6h sau bước 2): chốt mềm — giá + freeship + COD kiểm tra hàng
 *   Bước 4 (+10h sau bước 3): tin cuối lịch sự, để cửa mở, không ép nữa
 * Khách trả lời là chuỗi dừng ngay (neo theo tin khách mới). Giờ yên tĩnh theo
 * giờ Sài Gòn: bước 1 chỉ gửi 08:00–22:30, các bước sau 08:00–21:30.
 */
const WINDOW_MS = 23 * 60 * 60 * 1000; // cửa sổ nhắn tin 24h của Facebook
const MAX_PER_PAGE_PER_RUN = 5;
const HOUR_MS = 60 * 60 * 1000;

const STEPS: Array<{
  step: number;
  minSilenceMs: number;
  stage: ConsultingStage;
  quietStart: number; // giờ Sài Gòn được phép bắt đầu gửi
  quietEnd: number; // giờ Sài Gòn phải dừng gửi
}> = [
  { step: 1, minSilenceMs: 1 * HOUR_MS, stage: "follow_up", quietStart: 8, quietEnd: 22.5 },
  { step: 2, minSilenceMs: 3 * HOUR_MS, stage: "follow_up_value", quietStart: 8, quietEnd: 21.5 },
  { step: 3, minSilenceMs: 6 * HOUR_MS, stage: "follow_up_offer", quietStart: 8, quietEnd: 21.5 },
  { step: 4, minSilenceMs: 10 * HOUR_MS, stage: "follow_up_final", quietStart: 8, quietEnd: 21.5 },
];

let tableReady = false;

async function ensureNudgeTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS page_conversation_nudges (
       id VARCHAR(191) NOT NULL,
       conversation_id VARCHAR(191) NOT NULL,
       anchor_message_id VARCHAR(191) NOT NULL,
       step INT NOT NULL DEFAULT 1,
       nudged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_nudge_episode (conversation_id, anchor_message_id, step),
       KEY idx_nudge_conversation (conversation_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  // Bảng cũ (bản 1 chạm) chưa có cột step → bổ sung + nới unique key theo step
  const cols = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'page_conversation_nudges' AND COLUMN_NAME = 'step'`
  );
  if (Number(cols[0]?.c ?? 0) === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE page_conversation_nudges
         ADD COLUMN step INT NOT NULL DEFAULT 1,
         DROP INDEX uq_nudge_episode,
         ADD UNIQUE KEY uq_nudge_episode (conversation_id, anchor_message_id, step)`
    );
  }
  tableReady = true;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function saigonHourFloat(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Saigon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h + m / 60;
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
        lte: new Date(now - 1 * HOUR_MS),
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
    console.log(`[follow-up] Page ${page.id}: đã chăm sóc ${sent} khách`);
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

  const now = Date.now();

  // Mọi chạm phải nằm trong cửa sổ 24h tính từ tin khách gần nhất
  if (now - lastInbound.sentAt.getTime() > WINDOW_MS) return false;

  // Các bước đã gửi cho lượt im lặng này (neo theo tin khách gần nhất)
  const sentSteps = await prisma.$queryRawUnsafe<
    Array<{ step: number; nudged_at: Date }>
  >(
    "SELECT step, nudged_at FROM page_conversation_nudges WHERE conversation_id = ? AND anchor_message_id = ? ORDER BY step ASC",
    conv.id,
    lastInbound.id
  );
  const nextStep = (sentSteps.length ? Math.max(...sentSteps.map((r) => Number(r.step))) : 0) + 1;
  const stepCfg = STEPS.find((s) => s.step === nextStep);
  if (!stepCfg) return false; // đã đủ 4 chạm

  // Đủ thời gian im lặng kể từ tin shop cuối chưa
  if (now - last.sentAt.getTime() < stepCfg.minSilenceMs) return false;

  // Tin shop cuối phải do chính bot gửi:
  // - bước 1: sát thời điểm AI trả lời tin khách
  // - bước sau: sát thời điểm tin chăm sóc trước (nếu nhân viên đã chat tay thì không chen vào)
  if (nextStep === 1) {
    const delta = last.sentAt.getTime() - lastInbound.aiReplyAt.getTime();
    if (delta < -15_000 || delta > 5 * 60 * 1000) return false;
  } else {
    const prev = sentSteps[sentSteps.length - 1];
    const prevAt = new Date(prev.nudged_at).getTime();
    const delta = last.sentAt.getTime() - prevAt;
    if (delta < -5 * 60 * 1000 || delta > 60_000) return false;
  }

  // Giờ yên tĩnh (giờ Sài Gòn)
  const hour = saigonHourFloat(new Date(now));
  if (hour < stepCfg.quietStart || hour >= stepCfg.quietEnd) return false;

  // Đã chốt đơn từ hội thoại này thì không chăm sóc nữa
  const order = await prisma.pageCustomerOrder.findFirst({
    where: {
      conversationId: conv.id,
      status: { not: "cancelled" },
      phone: { not: null },
      address: { not: null },
    },
    select: { id: true },
  });
  if (order) return false;

  // Soạn tin bằng chính bộ não tư vấn, theo góc của từng bước
  const advice = await generateMessageAdvice({
    userId: page.facebookAccount.userId,
    pageId: page.id,
    messageId: lastInbound.id,
    stageOverride: stepCfg.stage,
  });
  const text = (advice.reply || "").trim();
  if (!text) return false;

  // Chống lặp: tin chăm sóc trùng y hệt tin shop vừa gửi thì bỏ qua
  if (normalizeText(text) === normalizeText(last.text)) return false;

  await sendConversationReply({
    conversationId: conv.id,
    userId: page.facebookAccount.userId,
    text,
    stripCustomerName: true,
  });

  await prisma.$executeRawUnsafe(
    "INSERT INTO page_conversation_nudges (id, conversation_id, anchor_message_id, step) VALUES (?, ?, ?, ?)",
    randomUUID(),
    conv.id,
    lastInbound.id,
    nextStep
  );

  console.log(
    `[follow-up] Đã chăm sóc bước ${nextStep}/4 khách ${conv.participantName || conv.id} (page ${page.id})`
  );
  return true;
}

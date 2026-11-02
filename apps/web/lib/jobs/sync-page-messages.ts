import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import {
  checkUserMessagingPermission,
  formatMessagingError,
  MessagingPermissionError,
  refreshPageTokens,
} from "@/lib/facebook/messaging-access";
import {
  FACEBOOK_RATE_LIMIT_MESSAGE,
  isFacebookRateLimitError,
} from "@/lib/facebook/rate-limit";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/token-encryption";
import { generateMessageAdvice } from "@/lib/ai/message-advisor";
import { learnAfterAiReply } from "@/lib/ai/customer-learning";
import { captureOrderFromConversation } from "@/lib/messages/orders";
import {
  resolveCustomerPhotoUrls,
  resolveProductImageUrls,
  sendConversationReply,
} from "@/lib/messages/send-page-reply";
import type { MessageDirection } from "@prisma/client";

const DEFAULT_CONVERSATION_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 20;
export const SYNC_RECENT_CONVERSATIONS = 20;
export const SYNC_RECENT_MESSAGES_PER_CONV = 20;
export const SYNC_FULL_MAX_MESSAGES = 400;
export const SYNC_FULL_CONV_BATCH = 25;
export const SYNC_FULL_MESSAGES_PER_CONV = 30;

// --- Rate limit theo tung Page: cooldown luu DB + backoff tang dan ---
// Khi 1 Page bi Facebook (hoac bo gioi han noi bo cua graph-client) chan
// do rate limit, ghi nhan de cac vong dong bo sau bo qua Page do cho den
// khi het cooldown, thay vi cu 5 phut lai goi va loi lai nhu cu.
const RATE_LIMIT_BASE_MINUTES = 30;
const RATE_LIMIT_MAX_MINUTES = 240;

function isRateLimitError(err: unknown): boolean {
  return (
    isFacebookRateLimitError(err) ||
    (err instanceof Error && /rate limit/i.test(err.message))
  );
}

async function recordPageRateLimit(
  pageId: string,
  currentStrikes: number
): Promise<number> {
  const strikes = currentStrikes + 1;
  const minutes = Math.min(
    RATE_LIMIT_BASE_MINUTES * 2 ** (strikes - 1),
    RATE_LIMIT_MAX_MINUTES
  );
  await prisma.page
    .update({
      where: { id: pageId },
      data: {
        rateLimitStrikes: strikes,
        rateLimitUntil: new Date(Date.now() + minutes * 60 * 1000),
      },
    })
    .catch(() => undefined);
  return minutes;
}

async function autoReplyToInbound(
  page: { id: string; autoAiEnabled: boolean },
  conversationId: string,
  message: { id: string; text: string; sentAt: Date },
  userId: string
): Promise<boolean> {
  if (!page.autoAiEnabled) return false;

  const alreadyReplied = await prisma.pageMessage.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      sentAt: { gt: message.sentAt },
    },
  });
  if (alreadyReplied) return false;

  // Chặn trả lời trùng: khách gửi lại đúng nội dung vừa được AI trả lời trong vòng
  // 3 phút (chạm đúp, bấm lại nút đặt mua từ quảng cáo) thì bỏ qua, tránh bot lặp y hệt.
  const normalizedText = message.text.trim().toLowerCase();
  if (normalizedText && normalizedText !== "[đính kèm]") {
    const windowStart = new Date(message.sentAt.getTime() - 3 * 60 * 1000);
    const windowEnd = new Date(message.sentAt.getTime() + 3 * 60 * 1000);
    const answeredSiblings = await prisma.pageMessage.findMany({
      where: {
        conversationId,
        direction: "INBOUND",
        id: { not: message.id },
        sentAt: { gte: windowStart, lte: windowEnd },
        aiSuggestedReply: { not: null },
      },
      select: { text: true },
    });
    if (
      answeredSiblings.some(
        (sibling) => sibling.text.trim().toLowerCase() === normalizedText
      )
    ) {
      console.info(
        `[syncPageMessages] Bỏ qua tin trùng nội dung đã trả lời cho page ${page.id}`
      );
      return false;
    }
  }

  const advice = await generateMessageAdvice({
    userId,
    pageId: page.id,
    messageId: message.id,
  });

  if (!advice.reply) return false;

  await prisma.pageMessage.update({
    where: { id: message.id },
    data: {
      aiSuggestedReply: advice.reply,
      aiReplyAt: new Date(),
      aiModel: advice.model || "gemini",
      recommendedProducts: advice.recommendedProducts || undefined,
    },
  });

  // Gioi han gui anh: toi da 2 luot moi hoi thoai (chu shop yeu cau - kem anh
  // vao moi tin tra loi lam phien khach). Moi luot gui gom nhieu anh lien tiep,
  // duoc luu thanh cac tin "[Hinh anh]" co sentAt sat nhau, nen gom nhom
  // 10 giay duoc tinh la 1 luot.
  const MAX_IMAGE_ROUNDS_PER_CONVERSATION = 2;
  const sentImageMessages = await prisma.pageMessage.findMany({
    where: { conversationId, direction: "OUTBOUND", text: "[Hình ảnh]" },
    select: { sentAt: true },
  });
  const imageRoundsSent = new Set(
    sentImageMessages.map((m) => Math.floor(m.sentAt.getTime() / 10000))
  ).size;
  const maySendImages = imageRoundsSent < MAX_IMAGE_ROUNDS_PER_CONVERSATION;

  let imageProductIds =
    advice.sendImages?.length > 0
      ? advice.sendImages
      : advice.recommendedProducts?.map((p) => p.id) || [];

  // Khi bat dau hoi thoai (chua tung gui anh), luon kem anh cua san pham chinh
  // dang ban de khach thay ngay san pham (chu shop yeu cau: tin san pham khi
  // bat dau phai kem 1-2 anh). AI chua chon SP nao thi lay SP dang ban dau tien.
  if (imageRoundsSent === 0 && imageProductIds.length === 0) {
    const primaryProduct = await prisma.pageProduct.findFirst({
      where: { pageId: page.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (primaryProduct) imageProductIds = [primaryProduct.id];
  }
  let productUrls: string[] = [];
  let customerUrls: string[] = [];
  if (maySendImages) {
    [productUrls, customerUrls] = await Promise.all([
      resolveProductImageUrls(page.id, imageProductIds, { maxPerProduct: 2 }),
      resolveCustomerPhotoUrls(page.id, advice.sendCustomerPhotos || []),
    ]);
  } else if (
    imageProductIds.length > 0 ||
    (advice.sendCustomerPhotos || []).length > 0
  ) {
    console.info(
      "[syncPageMessages] Hoi thoai " + conversationId + " da du " +
        MAX_IMAGE_ROUNDS_PER_CONVERSATION + " luot gui anh - chi gui text"
    );
  }

  await sendConversationReply({
    conversationId,
    userId,
    text: advice.reply,
    imageUrls: [...productUrls, ...customerUrls],
  });

  void learnAfterAiReply(conversationId, advice.nextStage || advice.consultingStage || "");

  return true;
}

export interface SyncPageMessagesOptions {
  conversationLimit?: number;
  messageLimit?: number;
  conversationsAfter?: string;
  conversationId?: string;
  messagesBefore?: string;
  /** Dừng khi đã đồng bộ đủ số tin (dùng cho đồng bộ tất cả) */
  maxMessagesToSync?: number;
}

async function getPageWithToken(pageId: string, userId: string) {
  await refreshPageTokens(userId);

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      isActive: true,
      facebookAccount: { userId, isActive: true },
    },
    include: { facebookAccount: true },
  });

  if (!page?.accessTokenEncrypted) {
    throw new Error("Page chưa có token. Hãy kết nối lại Facebook.");
  }

  const pageToken = decrypt(page.accessTokenEncrypted);
  const client = new FacebookGraphClient(pageToken);
  return { page, client };
}

async function upsertConversation(
  page: { id: string; fbPageId: string },
  fbConv: {
    id: string;
    updated_time?: string;
    snippet?: string;
    unread_count?: number;
    participants?: { data?: Array<{ id: string; name?: string }> };
  }
) {
  const participants = fbConv.participants?.data || [];
  const customer = participants.find((p) => p.id !== page.fbPageId);

  return prisma.pageConversation.upsert({
    where: {
      pageId_fbConversationId: {
        pageId: page.id,
        fbConversationId: fbConv.id,
      },
    },
    create: {
      pageId: page.id,
      fbConversationId: fbConv.id,
      participantName: customer?.name || "Khách hàng",
      participantFbId: customer?.id,
      snippet: fbConv.snippet || null,
      unreadCount: fbConv.unread_count || 0,
      lastMessageAt: fbConv.updated_time ? new Date(fbConv.updated_time) : null,
    },
    update: {
      participantName: customer?.name || undefined,
      participantFbId: customer?.id || undefined,
      snippet: fbConv.snippet || null,
      unreadCount: fbConv.unread_count || 0,
      lastMessageAt: fbConv.updated_time ? new Date(fbConv.updated_time) : null,
    },
  });
}

async function syncMessagesForConversation(
  page: { id: string; fbPageId: string; autoAiEnabled: boolean },
  conversationId: string,
  fbMessages: Array<{
    id: string;
    message?: string;
    from?: { id: string; name?: string };
    created_time?: string;
    attachments?: { data?: Array<Record<string, unknown>> };
  }>,
  userId: string
) {
  let messagesSynced = 0;
  let aiSuggestions = 0;

  for (const fbMsg of fbMessages) {
    const fromId = fbMsg.from?.id;
    const direction: MessageDirection =
      fromId === page.fbPageId ? "OUTBOUND" : "INBOUND";
    const text = fbMsg.message?.trim() || "[Đính kèm]";
    const sentAt = fbMsg.created_time ? new Date(fbMsg.created_time) : new Date();

    const existing = await prisma.pageMessage.findUnique({
      where: {
        conversationId_fbMessageId: {
          conversationId,
          fbMessageId: fbMsg.id,
        },
      },
    });

    if (existing) continue;

    const message = await prisma.pageMessage.create({
      data: {
        conversationId,
        fbMessageId: fbMsg.id,
        direction,
        text,
        attachments: fbMsg.attachments?.data
          ? (fbMsg.attachments.data as object)
          : undefined,
        sentAt,
      },
    });
    messagesSynced++;

    if (direction === "INBOUND") {
      try {
        await captureOrderFromConversation(conversationId, userId);
      } catch (err) {
        console.error("[syncPageMessages] order capture failed:", err);
      }
    }

    if (direction === "INBOUND" && page.autoAiEnabled) {
      try {
        const sent = await autoReplyToInbound(page, conversationId, message, userId);
        if (sent) aiSuggestions++;
      } catch (err) {
        console.error("[syncPageMessages] AI advice failed:", err);
      }
    }
  }

  return { messagesSynced, aiSuggestions };
}

export async function syncPageMessages(
  pageId: string,
  userId: string,
  options: SyncPageMessagesOptions = {}
) {
  const pageRateLimit = await prisma.page.findUnique({
    where: { id: pageId },
    select: { rateLimitUntil: true, rateLimitStrikes: true },
  });
  if (
    pageRateLimit?.rateLimitUntil &&
    pageRateLimit.rateLimitUntil > new Date()
  ) {
    console.info(
      "[syncPageMessages] Bo qua Page " +
        pageId +
        " - dang cooldown rate limit den " +
        pageRateLimit.rateLimitUntil.toISOString()
    );
    return {
      conversationsSynced: 0,
      messagesSynced: 0,
      aiSuggestions: 0,
      conversationsNextCursor: undefined,
      hasMoreConversations: false,
      messageLimitReached: false,
    };
  }
  const rateLimitStrikes = pageRateLimit?.rateLimitStrikes ?? 0;

  const permCheck = await checkUserMessagingPermission(userId);
  if (permCheck.rateLimited) {
    await recordPageRateLimit(pageId, rateLimitStrikes);
    throw new MessagingPermissionError(FACEBOOK_RATE_LIMIT_MESSAGE);
  }
  if (!permCheck.granted) {
    throw new MessagingPermissionError(
      `Thiếu quyền: ${permCheck.missing.join(", ")}. ` +
        "Bấm «Cấp quyền Messenger» trong Cài đặt hoặc Tin nhắn Page để kết nối lại Facebook."
    );
  }

  const conversationLimit = options.conversationLimit ?? DEFAULT_CONVERSATION_LIMIT;
  const messageLimit = options.messageLimit ?? DEFAULT_MESSAGE_LIMIT;

  const { page, client } = await getPageWithToken(pageId, userId);

  let conversationsSynced = 0;
  let messagesSynced = 0;
  let aiSuggestions = 0;
  let conversationsNextCursor: string | undefined;

  if (options.conversationId) {
    const conversation = await prisma.pageConversation.findFirst({
      where: { id: options.conversationId, pageId: page.id },
    });
    if (!conversation) {
      throw new Error("Hội thoại không tồn tại");
    }

    let messagesBefore = options.messagesBefore;
    if (!messagesBefore) {
      const oldest = await prisma.pageMessage.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { sentAt: "asc" },
        select: { fbMessageId: true },
      });
      messagesBefore = oldest?.fbMessageId;
    }

    let fbMessages: Awaited<
      ReturnType<typeof client.getConversationMessages>
    >;
    try {
      fbMessages = await client.getConversationMessages(
        conversation.fbConversationId,
        page.id,
        { limit: messageLimit, before: messagesBefore }
      );
    } catch (err) {
      if (isRateLimitError(err)) {
        await recordPageRateLimit(pageId, rateLimitStrikes);
      }
      throw err;
    }

    const result = await syncMessagesForConversation(
      page,
      conversation.id,
      fbMessages.data,
      userId
    );
    messagesSynced += result.messagesSynced;
    aiSuggestions += result.aiSuggestions;

    await prisma.page.update({
      where: { id: page.id },
      data: {
        lastMessageSyncAt: new Date(),
        rateLimitUntil: null,
        rateLimitStrikes: 0,
      },
    });

    return {
      conversationsSynced: 0,
      messagesSynced,
      aiSuggestions,
      hasMoreMessages: Boolean(fbMessages.paging?.next),
    };
  }

  let fbConversations;
  try {
    fbConversations = await client.getPageConversations(page.fbPageId, page.id, {
      limit: conversationLimit,
      after: options.conversationsAfter,
    });
  } catch (err) {
    if (isRateLimitError(err)) {
      const minutes = await recordPageRateLimit(pageId, rateLimitStrikes);
      console.error(
        "[syncPageMessages] Page " +
          pageId +
          " bi rate limit - nghi " +
          minutes +
          " phut"
      );
    }
    throw new MessagingPermissionError(formatMessagingError(err));
  }

  conversationsNextCursor = fbConversations.paging?.cursors?.after;

  for (const fbConv of fbConversations.data) {
    if (options.maxMessagesToSync && messagesSynced >= options.maxMessagesToSync) {
      break;
    }

    const existingConv = await prisma.pageConversation.findUnique({
      where: {
        pageId_fbConversationId: {
          pageId: page.id,
          fbConversationId: fbConv.id,
        },
      },
      select: { lastMessageAt: true },
    });

    const conversation = await upsertConversation(page, fbConv);
    conversationsSynced++;

    // Bo qua hoi thoai khong co tin moi ke tu lan dong bo truoc:
    // moi hoi thoai la 1 request Graph, day la noi ton request nhat.
    const fbUpdatedAt = fbConv.updated_time
      ? new Date(fbConv.updated_time)
      : null;
    if (
      existingConv?.lastMessageAt &&
      fbUpdatedAt &&
      existingConv.lastMessageAt >= fbUpdatedAt
    ) {
      continue;
    }

    let fbMessages: Awaited<
      ReturnType<typeof client.getConversationMessages>
    >;
    try {
      fbMessages = await client.getConversationMessages(fbConv.id, page.id, {
        limit: messageLimit,
      });
    } catch (err) {
      if (isRateLimitError(err)) {
        const minutes = await recordPageRateLimit(pageId, rateLimitStrikes);
        console.error(
          "[syncPageMessages] Page " +
            pageId +
            " bi rate limit - nghi " +
            minutes +
            " phut"
        );
      }
      throw err;
    }

    const result = await syncMessagesForConversation(
      page,
      conversation.id,
      fbMessages.data,
      userId
    );
    messagesSynced += result.messagesSynced;
    aiSuggestions += result.aiSuggestions;
  }

  await prisma.page.update({
    where: { id: page.id },
    data: {
      lastMessageSyncAt: new Date(),
      rateLimitUntil: null,
      rateLimitStrikes: 0,
    },
  });

  return {
    conversationsSynced,
    messagesSynced,
    aiSuggestions,
    conversationsNextCursor,
    hasMoreConversations: Boolean(fbConversations.paging?.next),
    messageLimitReached: Boolean(
      options.maxMessagesToSync && messagesSynced >= options.maxMessagesToSync
    ),
  };
}

/** Đồng bộ nhiều hội thoại cho đến khi đạt ~400 tin (giới hạn 300–500) */
export async function syncPageMessagesFull(
  pageId: string,
  userId: string,
  maxMessages = SYNC_FULL_MAX_MESSAGES
) {
  let conversationsAfter: string | undefined;
  let conversationsSynced = 0;
  let messagesSynced = 0;
  let aiSuggestions = 0;
  let hasMoreConversations = true;

  while (messagesSynced < maxMessages && hasMoreConversations) {
    const remaining = maxMessages - messagesSynced;
    const batch = await syncPageMessages(pageId, userId, {
      conversationLimit: SYNC_FULL_CONV_BATCH,
      messageLimit: SYNC_FULL_MESSAGES_PER_CONV,
      conversationsAfter,
      maxMessagesToSync: remaining,
    });

    conversationsSynced += batch.conversationsSynced;
    messagesSynced += batch.messagesSynced;
    aiSuggestions += batch.aiSuggestions;
    hasMoreConversations = Boolean(batch.hasMoreConversations);
    conversationsAfter = batch.conversationsNextCursor;

    if (batch.conversationsSynced === 0) break;
  }

  return {
    conversationsSynced,
    messagesSynced,
    aiSuggestions,
    syncMode: "full" as const,
    maxMessages,
    hasMoreConversations,
  };
}

export async function syncAllPagesForUser(userId: string) {
  const pages = await prisma.page.findMany({
    where: {
      isActive: true,
      facebookAccount: { userId, isActive: true },
    },
  });

  let totalConversations = 0;
  let totalMessages = 0;
  let totalAi = 0;

  for (const page of pages) {
    try {
      const result = await syncPageMessages(page.id, userId);
      totalConversations += result.conversationsSynced;
      totalMessages += result.messagesSynced;
      totalAi += result.aiSuggestions;
    } catch (err) {
      console.error(`[syncAllPages] page ${page.id}:`, err);
    }
  }

  return {
    pagesSynced: pages.length,
    conversationsSynced: totalConversations,
    messagesSynced: totalMessages,
    aiSuggestions: totalAi,
  };
}

import { FacebookGraphClient, FacebookAPIError } from "@/lib/facebook/graph-client";
import { getPageAccessToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getProductAllImages,
  MAX_ATTACH_IMAGES,
  toAbsoluteImageUrl,
} from "@/lib/messages/product-images";
import type { MessageDirection } from "@prisma/client";
import { stripCustomerName } from "@/lib/messages/strip-customer-name";

export interface SendReplyOptions {
  conversationId: string;
  userId: string;
  text: string;
  imageUrls?: string[];
  // Tin AI soạn: gọt tên khách khỏi câu trả lời trước khi gửi
  // (luật xưng hô 2026-11-08). Phiếu xác nhận/tin nhân viên: để false.
  stripCustomerName?: boolean;
  messagingType?: "RESPONSE" | "MESSAGE_TAG";
  tag?: "POST_PURCHASE_UPDATE" | "CONFIRMED_EVENT_UPDATE" | "ACCOUNT_UPDATE";
}

export interface SendReplyResult {
  sent: boolean;
  messageIds: string[];
  fbMessageIds: string[];
}

function normalizeUrls(urls: string[]): string[] {
  const absolute = urls
    .map((u) => toAbsoluteImageUrl(u))
    .filter((u): u is string => Boolean(u));
  return Array.from(new Set(absolute)).slice(0, MAX_ATTACH_IMAGES);
}

export function formatMessengerSendError(err: unknown): string {
  if (err instanceof FacebookAPIError) {
    const msg = err.message.toLowerCase();
    const code = err.fbError?.code;
    if (
      code === 551 ||
      code === 10 ||
      msg.includes("24") ||
      msg.includes("không có mặt") ||
      msg.includes("not available")
    ) {
      return "Ngoài cửa sổ 24h — khách chưa nhắn Page trong 24 giờ qua";
    }
    if (err.statusCode === 429 || msg.includes("rate limit")) {
      return "Gửi quá nhanh — hệ thống sẽ tự chậm lại, thử lại sau";
    }
    if (msg.includes("invalid parameter")) {
      return "Facebook từ chối tin này (có thể khách ngoài 24h hoặc nội dung không hợp lệ)";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Gửi thất bại";
}

export async function sendConversationReply(
  options: SendReplyOptions
): Promise<SendReplyResult> {
  let text = options.text.trim();
  // Luật của chủ Page (2026-11-03): mỗi lượt gửi tối đa 2 ảnh — không gửi nhiều hơn.
  const imageUrls = normalizeUrls(options.imageUrls || []).slice(0, 2);

  if (!text && imageUrls.length === 0) {
    throw new Error("Nội dung tin nhắn trống");
  }

  const conversation = await prisma.pageConversation.findFirst({
    where: {
      id: options.conversationId,
      page: { facebookAccount: { userId: options.userId } },
    },
    include: { page: true },
  });

  if (!conversation?.participantFbId) {
    throw new Error("Không tìm thấy khách hàng để gửi tin");
  }

  if (options.stripCustomerName && conversation.participantName) {
    text = stripCustomerName(text, conversation.participantName);
  }

  const pageToken = await getPageAccessToken(options.userId, conversation.pageId);
  if (!pageToken) {
    throw new Error("Page chưa có token. Hãy kết nối lại Facebook.");
  }

  const client = new FacebookGraphClient(pageToken);
  const fbMessageIds: string[] = [];
  const messageIds: string[] = [];
  const now = new Date();

  const messagingType = options.messagingType || "RESPONSE";
  const tag = options.tag;

  // Thứ tự gửi theo yêu cầu của chủ Page (2026-11-03): ẢNH TRƯỚC, chữ SAU,
  // để khách thấy ảnh sản phẩm trước rồi mới đọc phần chữ ngay dưới ảnh.
  // Ảnh nào gửi lỗi thì bỏ qua ảnh đó — vẫn gửi các ảnh còn lại và tin chữ.
  let seq = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      const result = await client.sendPageMessage(
        conversation.page.fbPageId,
        conversation.pageId,
        conversation.participantFbId,
        { imageUrl },
        { messagingType, tag }
      );
      const fbId = result.message_id || `local-${Date.now()}-img-${i}`;
      fbMessageIds.push(fbId);

      const saved = await prisma.pageMessage.create({
        data: {
          conversationId: conversation.id,
          fbMessageId: fbId,
          direction: "OUTBOUND" as MessageDirection,
          text: "[Hình ảnh]",
          attachments: { type: "image", url: imageUrl } as object,
          sentAt: new Date(now.getTime() + seq++),
        },
      });
      messageIds.push(saved.id);
    } catch (imgErr) {
      console.error(
        "[sendConversationReply] Gửi ảnh lỗi, bỏ qua ảnh này:",
        imgErr
      );
    }
  }

  if (text) {
    const result = await client.sendPageMessage(
      conversation.page.fbPageId,
      conversation.pageId,
      conversation.participantFbId,
      { text },
      { messagingType, tag }
    );
    const fbId = result.message_id || `local-${Date.now()}-text`;
    fbMessageIds.push(fbId);

    const saved = await prisma.pageMessage.create({
      data: {
        conversationId: conversation.id,
        fbMessageId: fbId,
        direction: "OUTBOUND" as MessageDirection,
        text,
        sentAt: new Date(now.getTime() + seq++),
      },
    });
    messageIds.push(saved.id);
  }

  await prisma.pageConversation.update({
    where: { id: conversation.id },
    data: {
      snippet: text || `[${imageUrls.length} hình ảnh]`,
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
  });

  return { sent: true, messageIds, fbMessageIds };
}

export async function resolveProductImageUrls(
  pageId: string,
  productIds: string[],
  options?: { maxPerProduct?: number }
): Promise<string[]> {
  if (productIds.length === 0) return [];

  const maxPerProduct = options?.maxPerProduct ?? 3;
  const products = await prisma.pageProduct.findMany({
    where: { pageId, id: { in: productIds }, isActive: true },
  });

  const urls: string[] = [];
  for (const product of products) {
    urls.push(...getProductAllImages(product).slice(0, maxPerProduct));
  }

  return normalizeUrls(urls);
}

export async function resolveCustomerPhotoUrls(
  pageId: string,
  photoIds: string[]
): Promise<string[]> {
  if (photoIds.length === 0) return [];

  const photos = await prisma.pageCustomerPhoto.findMany({
    where: { pageId, id: { in: photoIds }, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return normalizeUrls(photos.map((p) => p.imageUrl));
}

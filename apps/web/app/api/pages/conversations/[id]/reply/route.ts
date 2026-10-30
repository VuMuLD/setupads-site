import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { generateMessageAdvice } from "@/lib/ai/message-advisor";
import {
  resolveCustomerPhotoUrls,
  resolveProductImageUrls,
  sendConversationReply,
} from "@/lib/messages/send-page-reply";
import { toAbsoluteImageUrl } from "@/lib/messages/product-images";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: conversationId } = await params;
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const imageProductIds = (body.imageProductIds as string[] | undefined) || [];
  const customerPhotoIds = (body.customerPhotoIds as string[] | undefined) || [];
  const extraImageUrls = (body.imageUrls as string[] | undefined) || [];
  const useAi = Boolean(body.useAi);

  const conversation = await prisma.pageConversation.findFirst({
    where: {
      id: conversationId,
      page: { facebookAccount: { userId: session!.user.id } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Hội thoại không tồn tại" }, { status: 404 });
  }

  let replyText = text;
  let productIds = imageProductIds;
  let photoIds = customerPhotoIds;

  if (useAi) {
    const lastInbound = await prisma.pageMessage.findFirst({
      where: { conversationId, direction: "INBOUND" },
      orderBy: { sentAt: "desc" },
    });

    if (!lastInbound) {
      return NextResponse.json({ error: "Chưa có tin nhắn từ khách" }, { status: 400 });
    }

    const advice = await generateMessageAdvice({
      userId: session!.user.id,
      pageId: conversation.pageId,
      messageId: lastInbound.id,
    });

    replyText = text || advice.reply;
    productIds =
      imageProductIds.length > 0
        ? imageProductIds
        : advice.sendImages?.length
          ? advice.sendImages
          : advice.recommendedProducts?.map((p) => p.id) || [];
    photoIds =
      customerPhotoIds.length > 0 ? customerPhotoIds : advice.sendCustomerPhotos || [];

    await prisma.pageMessage.update({
      where: { id: lastInbound.id },
      data: {
        aiSuggestedReply: advice.reply,
        aiReplyAt: new Date(),
        aiModel: advice.model || "gemini",
        recommendedProducts: advice.recommendedProducts || undefined,
      },
    });
  }

  if (!replyText) {
    return NextResponse.json({ error: "Vui lòng nhập nội dung tin nhắn" }, { status: 400 });
  }

  const [productUrls, customerUrls] = await Promise.all([
    resolveProductImageUrls(conversation.pageId, productIds, { maxPerProduct: 5 }),
    resolveCustomerPhotoUrls(conversation.pageId, photoIds),
  ]);
  const directUrls = extraImageUrls
    .map((u) => toAbsoluteImageUrl(u))
    .filter((u): u is string => Boolean(u));

  const imageUrls = [...productUrls, ...customerUrls, ...directUrls];

  const result = await sendConversationReply({
    conversationId,
    userId: session!.user.id,
    text: replyText,
    imageUrls,
  });

  return NextResponse.json({
    success: true,
    sent: result.sent,
    messageIds: result.messageIds,
    imageCount: imageUrls.length,
  });
}

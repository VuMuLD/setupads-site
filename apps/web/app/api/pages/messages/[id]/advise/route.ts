import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { generateMessageAdvice } from "@/lib/ai/message-advisor";
import {
  resolveCustomerPhotoUrls,
  resolveProductImageUrls,
  sendConversationReply,
} from "@/lib/messages/send-page-reply";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: messageId } = await params;
  const body = await request.json().catch(() => ({}));
  const sendReply = Boolean(body.send);
  const customText = typeof body.text === "string" ? body.text.trim() : "";

  const message = await prisma.pageMessage.findFirst({
    where: {
      id: messageId,
      conversation: { page: { facebookAccount: { userId: session!.user.id } } },
    },
    include: {
      conversation: { include: { page: true } },
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Tin nhắn không tồn tại" }, { status: 404 });
  }

  const advice = await generateMessageAdvice({
    userId: session!.user.id,
    pageId: message.conversation.pageId,
    messageId,
  });

  const replyText = customText || advice.reply;
  const imageProductIds =
    (body.imageProductIds as string[] | undefined) ||
    advice.sendImages ||
    advice.recommendedProducts?.map((p) => p.id) ||
    [];
  const customerPhotoIds =
    (body.customerPhotoIds as string[] | undefined) || advice.sendCustomerPhotos || [];

  const updated = await prisma.pageMessage.update({
    where: { id: messageId },
    data: {
      aiSuggestedReply: advice.reply,
      aiReplyAt: new Date(),
      aiModel: advice.model || "gemini",
      recommendedProducts: advice.recommendedProducts || undefined,
    },
  });

  let sent = false;
  if (sendReply && replyText && message.conversation.participantFbId) {
    const [productUrls, customerUrls] = await Promise.all([
      resolveProductImageUrls(message.conversation.pageId, imageProductIds, {
        maxPerProduct: 5,
      }),
      resolveCustomerPhotoUrls(message.conversation.pageId, customerPhotoIds),
    ]);
    await sendConversationReply({
      conversationId: message.conversation.id,
      userId: session!.user.id,
      text: replyText,
      imageUrls: [...productUrls, ...customerUrls],
    });
    sent = true;
  }

  return NextResponse.json({
    message: updated,
    reply: advice.reply,
    consultingStage: advice.consultingStage,
    consultingStageLabel: advice.consultingStageLabel,
    nextStage: advice.nextStage,
    recommendedProducts: advice.recommendedProducts,
    sendImages: advice.sendImages,
    sendCustomerPhotos: advice.sendCustomerPhotos,
    sent,
  });
}

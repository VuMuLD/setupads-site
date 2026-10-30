import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { resolveConversationLabels, getManualLabelsFromDb } from "@/lib/messages/conversation-status";
import { buildConsultingContext } from "@/lib/messages/consulting-flow";
import {
  buildCustomerAiContext,
  buildOrderCollectionStatus,
  extractCustomerInfoFromMessages,
} from "@/lib/messages/customer-memory";
import { parseImageUrls } from "@/lib/messages/product-images";

const DEFAULT_LIMIT = 20;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    50
  );
  const before = request.nextUrl.searchParams.get("before");

  const conversation = await prisma.pageConversation.findFirst({
    where: {
      id,
      page: { facebookAccount: { userId: session!.user.id } },
    },
    include: {
      page: { select: { id: true, name: true, fbPageId: true, autoAiEnabled: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Hội thoại không tồn tại" }, { status: 404 });
  }

  const messages = await prisma.pageMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { sentAt: "desc" },
    take: limit + 1,
    ...(before
      ? {
          cursor: { id: before },
          skip: 1,
        }
      : {}),
  });

  const hasMore = messages.length > limit;
  const items = (hasMore ? messages.slice(0, limit) : messages).reverse();

  const totalCount = await prisma.pageMessage.count({
    where: { conversationId: conversation.id },
  });

  const statusMessages = await prisma.pageMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { sentAt: "desc" },
    take: 15,
    select: {
      direction: true,
      text: true,
      aiSuggestedReply: true,
      sentAt: true,
    },
  });

  const labels = resolveConversationLabels({
    unreadCount: conversation.unreadCount,
    messages: statusMessages,
    manualLabels: conversation.manualLabels,
  });

  const consulting = buildConsultingContext(
    statusMessages.map((m) => ({
      direction: m.direction,
      text: m.text,
      sentAt: m.sentAt,
    }))
  );

  const customerMemory = await buildCustomerAiContext({
    pageId: conversation.pageId,
    participantFbId: conversation.participantFbId,
    participantName: conversation.participantName,
    messages: statusMessages.map((m) => ({
      direction: m.direction,
      text: m.text,
      sentAt: m.sentAt,
    })),
    consultingStage: consulting.stage,
  });

  const products = await prisma.pageProduct.findMany({
    where: { pageId: conversation.pageId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const customerPhotos = await prisma.pageCustomerPhoto.findMany({
    where: { pageId: conversation.pageId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { product: { select: { id: true, name: true } } },
  });

  const extractSource = await prisma.pageMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { sentAt: "asc" },
    take: 60,
    select: { direction: true, text: true, sentAt: true },
  });

  const productNames = products.map((p) => p.name);
  const orderExtracted = extractCustomerInfoFromMessages(
    extractSource.map((m) => ({
      direction: m.direction as "INBOUND" | "OUTBOUND",
      text: m.text,
      sentAt: m.sentAt,
    })),
    productNames
  );
  const orderCollection = buildOrderCollectionStatus(orderExtracted);

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      participantName: conversation.participantName,
      participantFbId: conversation.participantFbId,
      unreadCount: conversation.unreadCount,
      labels,
      manualLabels: getManualLabelsFromDb(conversation.manualLabels),
      consultingStage: consulting.stage,
      consultingStageLabel: consulting.stageLabel,
      customerMemory,
      orderCollection,
      page: conversation.page,
    },
    messages: items,
    products: products.map((p) => ({
      ...p,
      imageUrls: parseImageUrls(p.imageUrls),
    })),
    customerPhotos,
    hasMore,
    totalCount,
    oldestMessageId: items[0]?.id ?? null,
  });
}

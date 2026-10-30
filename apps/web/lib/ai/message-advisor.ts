import { prisma } from "@/lib/prisma";
import { getProductAllImages } from "@/lib/messages/product-images";
import { buildConsultingContext } from "@/lib/messages/consulting-flow";
import {
  buildCustomerAiContext,
  getOrCreatePageCustomer,
  linkConversationToCustomer,
  syncCustomerProfileFromMessages,
} from "@/lib/messages/customer-memory";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

const TONE_LABELS: Record<string, string> = {
  friendly: "thân thiện, gần gũi như nhân viên tư vấn",
  professional: "chuyên nghiệp, lịch sự",
  casual: "tự nhiên, thoải mái như chat bạn bè",
};

export async function generateMessageAdvice(options: {
  userId: string;
  pageId: string;
  messageId: string;
}) {
  const message = await prisma.pageMessage.findFirst({
    where: {
      id: options.messageId,
      conversation: {
        pageId: options.pageId,
        page: { facebookAccount: { userId: options.userId } },
      },
    },
    include: {
      conversation: {
        include: {
          page: true,
          messages: { orderBy: { sentAt: "asc" }, take: 20 },
        },
      },
    },
  });

  if (!message) {
    throw new Error("Tin nhắn không tồn tại");
  }

  const page = message.conversation.page;
  const [products, customerPhotos] = await Promise.all([
    prisma.pageProduct.findMany({
      where: { pageId: page.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 20,
    }),
    prisma.pageCustomerPhoto.findMany({
      where: { pageId: page.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 15,
      include: { product: { select: { name: true } } },
    }),
  ]);

  const history = message.conversation.messages.map((m) => ({
    role: m.direction === "INBOUND" ? "customer" : "page",
    text: m.text,
    sentAt: m.sentAt.toISOString(),
  }));

  const flowMessages = message.conversation.messages.map((m) => ({
    direction: m.direction,
    text: m.text,
    sentAt: m.sentAt,
  }));
  const consulting = buildConsultingContext(flowMessages);

  const conv = message.conversation;
  if (conv.participantFbId) {
    const customer = await getOrCreatePageCustomer(
      page.id,
      conv.participantFbId,
      conv.participantName
    );
    if (!conv.customerId) {
      await linkConversationToCustomer(conv.id, customer.id);
    }
    await syncCustomerProfileFromMessages(customer.id, flowMessages);
  }

  const customerContext = await buildCustomerAiContext({
    pageId: page.id,
    participantFbId: conv.participantFbId,
    participantName: conv.participantName,
    messages: flowMessages,
    consultingStage: consulting.stage,
  });

  const response = await fetch(`${AI_SERVICE_URL}/message-advice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageName: page.name,
      tone: TONE_LABELS[page.aiTone || "friendly"] || TONE_LABELS.friendly,
      customerMessage: message.text,
      conversationHistory: history,
      consultingStage: consulting.stage,
      stageGuidance: consulting.guidance,
      consultingPlan: consulting.plan,
      customerProfile: {
        name: customerContext.participantName,
        phone: customerContext.phone,
        address: customerContext.address,
        preferences: customerContext.preferences,
        memorySummary: customerContext.memorySummary,
        isReturning: customerContext.isReturning,
        totalOrders: customerContext.totalOrders,
      },
      customerOrders: customerContext.pastOrders,
      pageLearnings: customerContext.pageLearnings,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: p.currency,
        imageUrl: p.imageUrl,
        imageUrls: getProductAllImages(p),
        tags: p.tags,
      })),
      customerPhotos: customerPhotos.map((ph) => ({
        id: ph.id,
        customerName: ph.customerName,
        caption: ph.caption,
        imageUrl: ph.imageUrl,
        productName: ph.product?.name,
      })),
      language: "vi",
    }),
  });

  if (!response.ok) {
    throw new Error(`AI service error: ${response.status}`);
  }

  const data = await response.json();
  return {
    reply: data.reply as string,
    nextStage: (data.nextStage as string) || consulting.stage,
    consultingStage: consulting.stage,
    consultingStageLabel: consulting.stageLabel,
    customerContext,
    recommendedProducts: data.recommendedProducts as
      | Array<{ id: string; reason: string }>
      | undefined,
    sendImages: (data.sendImages as string[] | undefined) || [],
    sendCustomerPhotos: (data.sendCustomerPhotos as string[] | undefined) || [],
    model: data.model as string | undefined,
  };
}

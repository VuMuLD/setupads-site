import { prisma } from "@/lib/prisma";
import {
  buildCustomerAiContext,
  extractCustomerInfoFromMessages,
  getOrCreatePageCustomer,
  linkConversationToCustomer,
  recordCustomerOrder,
  shouldLearnFromConversation,
  syncCustomerProfileFromMessages,
  type CustomerPreferences,
} from "@/lib/messages/customer-memory";
import { detectCustomerPurchaseCommitment } from "@/lib/messages/purchase-detection";
import { buildConsultingContext } from "@/lib/messages/consulting-flow";
import { getManualLabelsFromDb } from "@/lib/messages/conversation-status";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

const LEARN_COOLDOWN_MS = 5 * 60 * 1000;

export async function ensureCustomerForConversation(conversationId: string) {
  const conversation = await prisma.pageConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { sentAt: "asc" }, take: 50 },
    },
  });
  if (!conversation?.participantFbId) return null;

  const customer = await getOrCreatePageCustomer(
    conversation.pageId,
    conversation.participantFbId,
    conversation.participantName
  );

  if (!conversation.customerId) {
    await linkConversationToCustomer(conversation.id, customer.id);
  }

  const flowMessages = conversation.messages.map((m) => ({
    direction: m.direction as "INBOUND" | "OUTBOUND",
    text: m.text,
    sentAt: m.sentAt,
  }));

  await syncCustomerProfileFromMessages(customer.id, flowMessages);

  await prisma.pageCustomer.update({
    where: { id: customer.id },
    data: {
      conversationCount: { increment: 0 },
      lastContactAt: new Date(),
    },
  });

  return { conversation, customer, flowMessages };
}

export async function learnFromConversation(
  conversationId: string,
  options?: { force?: boolean }
): Promise<{ learned: boolean; reason?: string }> {
  const data = await ensureCustomerForConversation(conversationId);
  if (!data) return { learned: false, reason: "no_participant" };

  const { conversation, customer, flowMessages } = data;
  const manualLabels = getManualLabelsFromDb(conversation.manualLabels);
  const manualPurchased = manualLabels.includes("purchased");
  const purchased = shouldLearnFromConversation(flowMessages, manualPurchased);

  if (!purchased && !options?.force) {
    return { learned: false, reason: "skip" };
  }

  if (
    !options?.force &&
    conversationId
  ) {
    const recentLearn = await prisma.pageCustomerLearning.findFirst({
      where: {
        conversationId,
        createdAt: { gt: new Date(Date.now() - LEARN_COOLDOWN_MS) },
      },
    });
    if (recentLearn) return { learned: false, reason: "cooldown" };
  }

  const extracted = extractCustomerInfoFromMessages(flowMessages);
  const consulting = buildConsultingContext(flowMessages);

  const lastInbound = [...flowMessages]
    .reverse()
    .find((m) => m.direction === "INBOUND");
  const lastOutbound = [...flowMessages]
    .reverse()
    .find((m) => m.direction === "OUTBOUND");

  if (detectCustomerPurchaseCommitment(flowMessages) || manualPurchased) {
    const lastInboundMsg = conversation.messages
      .filter((m) => m.direction === "INBOUND")
      .pop();
    await recordCustomerOrder(
      conversation.pageId,
      customer.id,
      conversation.id,
      extracted,
      lastInboundMsg?.id
    );
  }

  const history = conversation.messages.map((m) => ({
    role: m.direction === "INBOUND" ? "customer" : "page",
    text: m.text,
    aiSuggested: Boolean(m.aiSuggestedReply),
  }));

  let aiResult: {
    customerSummary?: string;
    insights?: Array<{
      category: string;
      insight: string;
      effectiveReply?: string;
      stage?: string;
      outcome?: string;
    }>;
    pageTips?: Array<{ stage?: string; tip: string }>;
    preferences?: CustomerPreferences;
  } = {};

  try {
    const res = await fetch(`${AI_SERVICE_URL}/learn-from-conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageName: (
          await prisma.page.findUnique({
            where: { id: conversation.pageId },
            select: { name: true },
          })
        )?.name,
        participantName: customer.participantName,
        outcome: purchased ? "closed" : consulting.stage,
        consultingStage: consulting.stage,
        conversationHistory: history,
        extractedOrder: extracted,
        pastOrderCount: customer.totalOrders,
        language: "vi",
      }),
    });
    if (res.ok) {
      aiResult = await res.json();
    }
  } catch (err) {
    console.error("[learnFromConversation] AI call failed:", err);
  }

  const prevPrefs = (customer.preferences as CustomerPreferences) || {};
  const mergedPrefs = {
    ...prevPrefs,
    ...(aiResult.preferences || {}),
    ...extracted.preferences,
  };

  await prisma.pageCustomer.update({
    where: { id: customer.id },
    data: {
      aiMemorySummary: aiResult.customerSummary || customer.aiMemorySummary,
      preferences: mergedPrefs as object,
      phone: extracted.phone || customer.phone,
      address: extracted.address || customer.address,
      isReturning: customer.totalOrders > 0,
    },
  });

  if (aiResult.insights?.length) {
    for (const ins of aiResult.insights.slice(0, 5)) {
      await prisma.pageCustomerLearning.create({
        data: {
          pageId: conversation.pageId,
          customerId: customer.id,
          conversationId: conversation.id,
          category: ins.category || "success_pattern",
          insight: ins.insight,
          effectiveReply: ins.effectiveReply || lastOutbound?.text || null,
          stage: ins.stage || consulting.stage,
          outcome: ins.outcome || (purchased ? "closed" : "progressed"),
        },
      });
    }
  } else {
    await prisma.pageCustomerLearning.create({
      data: {
        pageId: conversation.pageId,
        customerId: customer.id,
        conversationId: conversation.id,
        category: purchased ? "success_pattern" : consulting.stage,
        insight: purchased
          ? `Khách ${customer.participantName || "này"} chốt đơn ở giai đoạn ${consulting.stageLabel}. ${extracted.productSummary || "Cần hỏi size/màu rõ trước khi chốt."}`
          : `Hội thoại giai đoạn ${consulting.stageLabel}: "${lastInbound?.text?.slice(0, 80) || ""}"`,
        effectiveReply: lastOutbound?.text?.slice(0, 500) || null,
        stage: consulting.stage,
        outcome: purchased ? "closed" : "progressed",
      },
    });
  }

  if (aiResult.pageTips?.length) {
    const page = await prisma.page.findUnique({
      where: { id: conversation.pageId },
      select: { aiConsultingInsights: true },
    });
    const existing = Array.isArray(page?.aiConsultingInsights)
      ? (page!.aiConsultingInsights as Array<{ stage?: string; tip: string }>)
      : [];
    const merged = [...aiResult.pageTips, ...existing]
      .filter((t, i, arr) => arr.findIndex((x) => x.tip === t.tip) === i)
      .slice(0, 20);
    await prisma.page.update({
      where: { id: conversation.pageId },
      data: { aiConsultingInsights: merged },
    });
  }

  return { learned: true };
}

/** Đồng bộ hồ sơ khách sau mỗi tương tác AI */
export async function touchCustomerFromConversation(conversationId: string) {
  try {
    await ensureCustomerForConversation(conversationId);
  } catch (err) {
    console.error("[touchCustomer]", err);
  }
}

/** Học sâu khi chốt đơn hoặc giai đoạn closing */
export async function learnAfterAiReply(
  conversationId: string,
  stage: string
) {
  try {
    await touchCustomerFromConversation(conversationId);
    const data = await ensureCustomerForConversation(conversationId);
    if (!data) return;
    const purchased = shouldLearnFromConversation(
      data.flowMessages,
      getManualLabelsFromDb(data.conversation.manualLabels).includes("purchased")
    );
    if (purchased || stage === "purchased" || stage === "closing") {
      await learnFromConversation(conversationId, {
        force: stage === "closing" || stage === "purchased",
      });
    }
  } catch (err) {
    console.error("[learnAfterAiReply]", err);
  }
}

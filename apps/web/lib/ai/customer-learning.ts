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

/** LUẬT HỌC CỦA SHOP (chủ shop chốt 5/11): bot chỉ học KIẾN THỨC CHAT (kiến
 * thức sản phẩm + cách trò chuyện giúp khách dễ mua), TUYỆT ĐỐI không học
 * GIÁ. Lọc cứng tại điểm ghi DB: bài học chứa số giá ngoài giá shop
 * (niêm yết 699k, sàn 679k, giá gốc 1.200k) hoặc chứa mẫu Page nhượng bộ
 * theo khách thì bị loại, kể cả khi prompt AI đã trượt. */
const CONCESSION_PHRASES = [
  "ho tro het muc",
  "dong y voi de xuat cua khach",
  "chap nhan de xuat cua khach",
  "chap nhan gia khach",
  "theo gia khach",
  "chot theo gia",
  "nhuong gia",
  "giam theo yeu cau",
  "chieu khach",
];
const ALLOWED_PRICES = new Set([679000, 699000, 1200000]);

function stripVnLower(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function isPricePoisonedLearning(
  ...texts: Array<string | null | undefined>
): boolean {
  const blob = texts.filter(Boolean).join(" \n ");
  if (!blob) return false;
  const plain = stripVnLower(blob);
  if (CONCESSION_PHRASES.some((p) => plain.includes(p))) return true;
  // Luật chính sách 8/11 (sửa 21:25): bot TUYỆT ĐỐI không nhắc tới bảo
  // hành — bài học/tip nào hứa bảo hành HOẶC phủ nhận bảo hành ("khong
  // co bao hanh") đều là dữ liệu độc, loại bỏ. Cách đáp đúng luật là
  // bỏ qua ý bảo hành, chỉ nói đổi trả 7 ngày + kiểm hàng miễn phí.
  const WARRANTY_CLAIM_PHRASES = [
    "bao hanh 12 thang",
    "bao hanh chinh hang",
    "bao hanh uy tin",
    "bao hanh 1 doi 1",
    "chinh sach bao hanh",
    "khong co bao hanh",
    "khong kem bao hanh",
  ];
  if (WARRANTY_CLAIM_PHRASES.some((p) => plain.includes(p))) return true;
  // Bắt số tiền NGUYÊN CỤM (1.200.000 / 699.000 / 699k) để giá gốc 1.200.000đ
  // không bị tách thành "200.000" rồi kết luận nhầm là giá độc.
  const tokens =
    plain.match(/\b\d{1,3}(?:[.,]\d{3})+(?![\d.,])|\b\d{3}\s?k\b/g) || [];
  return tokens.some((t) => {
    const num = t.replace(/\D/g, "");
    const value = num.length <= 3 ? Number(num) * 1000 : Number(num);
    return value >= 100000 && !ALLOWED_PRICES.has(value);
  });
}

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

  // Lọc cứng luật học trước khi ghi DB: loại bài học/tip dính số giá ngoài
  // luật shop hoặc mẫu Page nhượng bộ theo khách (isPricePoisonedLearning).
  if (aiResult.insights?.length) {
    aiResult.insights = aiResult.insights.filter(
      (ins) =>
        !isPricePoisonedLearning(
          ins.insight,
          ins.effectiveReply || lastOutbound?.text
        )
    );
  }
  if (aiResult.pageTips?.length) {
    aiResult.pageTips = aiResult.pageTips.filter(
      (t) => !isPricePoisonedLearning(t.tip)
    );
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
        effectiveReply: isPricePoisonedLearning(lastOutbound?.text)
          ? null
          : lastOutbound?.text?.slice(0, 500) || null,
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
    type ConsultingTip = { stage?: string; tip: string; pinned?: boolean };
    const existing = Array.isArray(page?.aiConsultingInsights)
      ? (page!.aiConsultingInsights as ConsultingTip[])
      : [];
    // Tip GHIM (luật chủ shop chốt) không bao giờ bị tip học tự động đẩy ra:
    // luôn giữ lại và đặt lên đầu; chỉ phần tip thường mới cắt ở 20 tip gần nhất.
    const pinned = existing.filter((t) => t.pinned);
    const merged = [
      ...pinned,
      ...[...aiResult.pageTips, ...existing.filter((t) => !t.pinned)]
        .filter((t, i, arr) => arr.findIndex((x) => x.tip === t.tip) === i)
        .slice(0, 20),
    ];
    await prisma.page.update({
      where: { id: conversation.pageId },
      data: { aiConsultingInsights: merged },
    });
  }

  return { learned: true };
}

/** Phân tích hội thoại mất khách → lưu bài học dạng avoid_pattern */
export async function analyzeLostConversation(
  conversationId: string
): Promise<boolean> {
  const data = await ensureCustomerForConversation(conversationId);
  if (!data) return false;

  const { conversation, customer, flowMessages } = data;
  const consulting = buildConsultingContext(flowMessages);
  const history = conversation.messages.map((m) => ({
    role: m.direction === "INBOUND" ? "customer" : "page",
    text: m.text,
    aiSuggested: Boolean(m.aiSuggestedReply),
  }));

  try {
    const res = await fetch(`${AI_SERVICE_URL}/analyze-lost-conversation`, {
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
        conversationHistory: history,
        language: "vi",
      }),
    });
    if (!res.ok) return false;
    const aiResult = (await res.json()) as {
      insights?: Array<{
        insight: string;
        effectiveReply?: string;
        stage?: string;
      }>;
    };
    const insights = (aiResult.insights || [])
      .filter((i) => i.insight && !isPricePoisonedLearning(i.insight, i.effectiveReply))
      .slice(0, 2);
    if (!insights.length) return false;
    for (const ins of insights) {
      await prisma.pageCustomerLearning.create({
        data: {
          pageId: conversation.pageId,
          customerId: customer.id,
          conversationId: conversation.id,
          category: "avoid_pattern",
          insight: ins.insight,
          effectiveReply: ins.effectiveReply || null,
          stage: ins.stage || consulting.stage,
          outcome: "lost",
        },
      });
    }
    return true;
  } catch (err) {
    console.error("[analyzeLostConversation]", err);
    return false;
  }
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

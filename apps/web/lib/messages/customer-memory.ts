import { prisma } from "@/lib/prisma";
import {
  detectCustomerPurchaseCommitment,
  type FlowMessage,
} from "@/lib/messages/purchase-detection";
import { buildConsultingContext } from "@/lib/messages/consulting-flow";

const PHONE_EXTRACT =
  /(?:sdt|sđt|điện\s*thoại|phone|zalo)\s*:?\s*(0[35789]\d{8})|(?:^|\s)(0[35789]\d{8})(?:\s|$)/i;

const ADDRESS_EXTRACT =
  /(?:địa\s*chỉ|giao\s*(?:đến|tới|về))\s*:?\s*([^\n.]{10,200})/i;

const SIZE_EXTRACT = /(?:size|sz)\s*:?\s*([a-z0-9]+)/i;
const QTY_EXTRACT = /(?:lấy|mua|đặt|sl)\s*:?\s*(\d+)/i;

export interface CustomerPreferences {
  size?: string;
  color?: string;
  budget?: string;
  productInterests?: string[];
  notes?: string;
}

export interface ExtractedOrderInfo {
  phone: string | null;
  address: string | null;
  size: string | null;
  quantity: number | null;
  productSummary: string | null;
  amount: number | null;
}

export interface OrderCollectionStatus {
  phone: string | null;
  address: string | null;
  productSummary: string | null;
  size: string | null;
  quantity: number | null;
  hasPhone: boolean;
  hasAddress: boolean;
  hasProduct: boolean;
  isComplete: boolean;
  missingFields: Array<"phone" | "address" | "product">;
}

const ADDRESS_KEYWORDS =
  /(?:đường|phố|ngõ|ngách|hẻm|phường|xã|quận|huyện|thị\s*xã|tỉnh|thành\s*phố|tp\.?\s*\w+)/i;

const PRODUCT_LINE =
  /(?:hàng(?:\s*hóa)?|sản\s*phẩm|mặt\s*hàng|đặt|lấy|chốt|mua)\s*:?\s*([^\n.!?]{3,160})/gi;

export function buildOrderCollectionStatus(
  info: ExtractedOrderInfo
): OrderCollectionStatus {
  const hasPhone = Boolean(info.phone);
  const hasAddress = Boolean(info.address);
  const hasProduct = Boolean(info.productSummary);
  const missingFields: OrderCollectionStatus["missingFields"] = [];
  if (!hasPhone) missingFields.push("phone");
  if (!hasAddress) missingFields.push("address");
  if (!hasProduct) missingFields.push("product");

  return {
    phone: info.phone,
    address: info.address,
    productSummary: info.productSummary,
    size: info.size,
    quantity: info.quantity,
    hasPhone,
    hasAddress,
    hasProduct,
    isComplete: hasPhone && hasAddress && hasProduct,
    missingFields,
  };
}

function extractAddressFromInbound(allInbound: string): string | null {
  const labeled = extractAddressFromText(allInbound);
  if (labeled) return labeled;

  const shipMatch = allInbound.match(
    /(?:ship|giao|nhận)\s*(?:về|đến|tại|ở)\s*:?\s*([^\n.!?]{10,220})/i
  );
  if (shipMatch?.[1]) return shipMatch[1].trim();

  const lines = allInbound.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    if (line.length < 12 || line.length > 220) continue;
    if (PHONE_EXTRACT.test(line) && line.replace(/\D/g, "").length <= 11) continue;
    if (ADDRESS_KEYWORDS.test(line) || /^\d+[\s,/]/.test(line)) {
      return line.replace(/^(địa\s*chỉ|dc|addr)\s*:?\s*/i, "").trim();
    }
  }

  return null;
}

function extractProductSummaryFromInbound(
  inbound: FlowMessage[],
  productNames?: string[]
): string | null {
  const texts = inbound.map((m) => m.text);
  const allInbound = texts.join("\n");

  if (productNames?.length) {
    const sorted = [...productNames].sort((a, b) => b.length - a.length);
    const found: string[] = [];
    for (const name of sorted) {
      if (name.length < 3) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(escaped, "i").test(allInbound)) {
        found.push(name);
      }
    }
    if (found.length) return found.join(", ");
  }

  const labeled: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PRODUCT_LINE.source, "gi");
  while ((match = re.exec(allInbound)) !== null) {
    const part = match[1]?.trim();
    if (part && part.length >= 3) labeled.push(part);
  }
  if (labeled.length) return Array.from(new Set(labeled)).slice(-3).join(" | ");

  const productLines = inbound
    .filter((m) => /lấy|mua|đặt|chốt|size|màu|hàng|sp\b/i.test(m.text))
    .map((m) => m.text.trim())
    .slice(-4);

  if (productLines.length) return productLines.join(" | ");

  return null;
}

export interface CustomerAiContext {
  customerId: string | null;
  isReturning: boolean;
  participantName: string | null;
  phone: string | null;
  address: string | null;
  preferences: CustomerPreferences;
  memorySummary: string | null;
  totalOrders: number;
  pastOrders: Array<{
    productSummary: string | null;
    size: string | null;
    amount: number | null;
    confirmedAt: string;
  }>;
  pageLearnings: Array<{
    category: string;
    insight: string;
    effectiveReply: string | null;
    stage: string | null;
  }>;
  consultingStage: string;
  stageLabel: string;
}

export function extractPhoneFromText(text: string): string | null {
  const m = text.match(PHONE_EXTRACT);
  return m?.[1] || m?.[2] || null;
}

export function extractAddressFromText(text: string): string | null {
  const m = text.match(ADDRESS_EXTRACT);
  return m?.[1]?.trim() || null;
}

export function extractCustomerInfoFromMessages(
  messages: FlowMessage[],
  productNames?: string[]
): ExtractedOrderInfo & { preferences: CustomerPreferences } {
  const inbound = messages.filter((m) => m.direction === "INBOUND");
  const allInbound = inbound.map((m) => m.text).join("\n");

  const phone = extractPhoneFromText(allInbound);
  const address = extractAddressFromInbound(allInbound);
  const sizeMatch = allInbound.match(SIZE_EXTRACT);
  const qtyMatch = allInbound.match(QTY_EXTRACT);

  const preferences: CustomerPreferences = {};
  if (sizeMatch?.[1]) preferences.size = sizeMatch[1];
  if (/màu\s*(\w+)/i.test(allInbound)) {
    const colorM = allInbound.match(/màu\s*(\w+)/i);
    if (colorM?.[1]) preferences.color = colorM[1];
  }
  if (/ngân\s*sách|tầm\s*\d+/i.test(allInbound)) {
    const budgetM = allInbound.match(/(?:ngân\s*sách|tầm)\s*([^\n.]{3,40})/i);
    if (budgetM?.[1]) preferences.budget = budgetM[1].trim();
  }

  const productSummary = extractProductSummaryFromInbound(inbound, productNames);

  return {
    phone,
    address,
    size: sizeMatch?.[1] || null,
    quantity: qtyMatch?.[1] ? parseInt(qtyMatch[1], 10) : null,
    productSummary,
    amount: null,
    preferences,
  };
}

export async function getOrCreatePageCustomer(
  pageId: string,
  participantFbId: string,
  participantName?: string | null
) {
  const existing = await prisma.pageCustomer.findUnique({
    where: { pageId_participantFbId: { pageId, participantFbId } },
  });
  if (existing) {
    if (participantName && participantName !== existing.participantName) {
      return prisma.pageCustomer.update({
        where: { id: existing.id },
        data: { participantName, lastContactAt: new Date() },
      });
    }
    return prisma.pageCustomer.update({
      where: { id: existing.id },
      data: { lastContactAt: new Date() },
    });
  }

  return prisma.pageCustomer.create({
    data: {
      pageId,
      participantFbId,
      participantName: participantName || null,
      firstContactAt: new Date(),
      lastContactAt: new Date(),
    },
  });
}

export async function linkConversationToCustomer(
  conversationId: string,
  customerId: string
) {
  await prisma.pageConversation.update({
    where: { id: conversationId },
    data: { customerId },
  });
}

export async function syncCustomerProfileFromMessages(
  customerId: string,
  messages: FlowMessage[]
) {
  const extracted = extractCustomerInfoFromMessages(messages);
  const customer = await prisma.pageCustomer.findUnique({ where: { id: customerId } });
  if (!customer) return;

  const prevPrefs = (customer.preferences as CustomerPreferences) || {};
  const mergedPrefs: CustomerPreferences = {
    ...prevPrefs,
    ...Object.fromEntries(
      Object.entries(extracted.preferences).filter(([, v]) => v != null && v !== "")
    ),
  };

  await prisma.pageCustomer.update({
    where: { id: customerId },
    data: {
      phone: extracted.phone || customer.phone,
      address: extracted.address || customer.address,
      preferences: mergedPrefs as object,
      lastContactAt: new Date(),
    },
  });
}

export async function recordCustomerOrder(
  pageId: string,
  customerId: string,
  conversationId: string,
  extracted: ExtractedOrderInfo,
  sourceMessageId?: string
) {
  const { recordPageOrder } = await import("@/lib/messages/orders");
  const result = await recordPageOrder(pageId, customerId, conversationId, extracted, {
    sourceMessageId,
  });
  return result.order;
}

export async function buildCustomerAiContext(options: {
  pageId: string;
  participantFbId: string | null;
  participantName: string | null;
  messages: FlowMessage[];
  consultingStage?: string;
}): Promise<CustomerAiContext> {
  const consulting = buildConsultingContext(options.messages);

  if (!options.participantFbId) {
    return {
      customerId: null,
      isReturning: false,
      participantName: options.participantName,
      phone: null,
      address: null,
      preferences: {},
      memorySummary: null,
      totalOrders: 0,
      pastOrders: [],
      pageLearnings: [],
      consultingStage: options.consultingStage || consulting.stage,
      stageLabel: consulting.stageLabel,
    };
  }

  const customer = await prisma.pageCustomer.findUnique({
    where: {
      pageId_participantFbId: {
        pageId: options.pageId,
        participantFbId: options.participantFbId,
      },
    },
    include: {
      orders: { orderBy: { confirmedAt: "desc" }, take: 5 },
    },
  });

  const page = await prisma.page.findUnique({
    where: { id: options.pageId },
    select: { aiConsultingInsights: true },
  });

  const stage = options.consultingStage || consulting.stage;
  const [learnings, avoidLearnings] = await Promise.all([
    prisma.pageCustomerLearning.findMany({
      where: {
        pageId: options.pageId,
        OR: [{ stage }, { category: "success_pattern" }],
      },
      orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
    prisma.pageCustomerLearning.findMany({
      where: { pageId: options.pageId, category: "avoid_pattern" },
      orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
      take: 2,
    }),
  ]);

  // Học tăng cường: bài học nào được dùng trong prompt thì tăng useCount,
  // để mẫu nào thật sự hiệu quả sẽ nổi lên đầu theo thời gian.
  const usedLearningIds = [...learnings, ...avoidLearnings].map((l) => l.id);
  if (usedLearningIds.length) {
    void prisma.pageCustomerLearning
      .updateMany({
        where: { id: { in: usedLearningIds } },
        data: { useCount: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  const pageInsights = Array.isArray(page?.aiConsultingInsights)
    ? (page!.aiConsultingInsights as Array<{ stage?: string; tip: string }>)
        .filter((i) => !i.stage || i.stage === stage)
        .slice(0, 5)
    : [];

  const pageLearnings = [
    ...learnings.map((l) => ({
      category: l.category,
      insight: l.insight,
      effectiveReply: l.effectiveReply,
      stage: l.stage,
    })),
    ...avoidLearnings.map((l) => ({
      category: l.category,
      insight: l.insight,
      effectiveReply: l.effectiveReply,
      stage: l.stage,
    })),
    ...pageInsights.map((i) => ({
      category: "page_tip",
      insight: i.tip,
      effectiveReply: null,
      stage: i.stage || null,
    })),
  ];

  if (!customer) {
    const extracted = extractCustomerInfoFromMessages(options.messages);
    return {
      customerId: null,
      isReturning: false,
      participantName: options.participantName,
      phone: extracted.phone,
      address: extracted.address,
      preferences: extracted.preferences,
      memorySummary: null,
      totalOrders: 0,
      pastOrders: [],
      pageLearnings,
      consultingStage: stage,
      stageLabel: consulting.stageLabel,
    };
  }

  return {
    customerId: customer.id,
    isReturning: customer.isReturning || customer.totalOrders > 0,
    participantName: customer.participantName || options.participantName,
    phone: customer.phone,
    address: customer.address,
    preferences: (customer.preferences as CustomerPreferences) || {},
    memorySummary: customer.aiMemorySummary,
    totalOrders: customer.totalOrders,
    pastOrders: customer.orders.map((o) => ({
      productSummary: o.productSummary,
      size: o.size,
      amount: o.amount,
      confirmedAt: o.confirmedAt.toISOString(),
    })),
    pageLearnings,
    consultingStage: stage,
    stageLabel: consulting.stageLabel,
  };
}

export function shouldLearnFromConversation(
  messages: FlowMessage[],
  manualPurchased: boolean
): boolean {
  return manualPurchased || detectCustomerPurchaseCommitment(messages);
}

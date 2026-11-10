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

/** Số lượng chỉ hợp lệ khi NHỎ và không dính đơn vị tiền. Câu "lấy 600 nha
 * shop" là khách mặc cả 600k, không phải mua 600 bộ — đơn ảo #DH-20261105-004
 * từng ghi số lượng 600 = 407.400.000đ vì bắt thẳng số sau động từ mua/lấy. */
function extractQuantity(allInbound: string): number | null {
  const m = allInbound.match(QTY_EXTRACT);
  if (!m?.[1]) return null;
  const after = allInbound.slice(
    (m.index ?? 0) + m[0].length,
    (m.index ?? 0) + m[0].length + 8
  );
  // Số kèm đơn vị tiền ngay sau (600k, 600 nghìn...) là GIÁ, không phải số lượng
  if (/^\s*(k|nghìn|ngàn|tr|triệu|đ|₫)/i.test(after)) return null;
  const qty = parseInt(m[1], 10);
  if (!Number.isFinite(qty) || qty < 1 || qty > 20) return null;
  return qty;
}

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

function stripVnDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const VN_PROVINCES = [
  "ha noi", "ho chi minh", "hai phong", "da nang", "can tho", "phu tho",
  "hoa binh", "bac ninh", "bac giang", "vinh phuc", "hung yen", "hai duong",
  "quang ninh", "thai nguyen", "lang son", "lao cai", "yen bai", "son la",
  "dien bien", "lai chau", "ha giang", "cao bang", "bac kan", "tuyen quang",
  "nam dinh", "thai binh", "ninh binh", "ha nam", "thanh hoa", "nghe an",
  "ha tinh", "quang binh", "quang tri", "thua thien hue", "quang nam",
  "quang ngai", "binh dinh", "phu yen", "khanh hoa", "ninh thuan",
  "binh thuan", "kon tum", "gia lai", "dak lak", "dak nong", "lam dong",
  "binh phuoc", "binh duong", "dong nai", "tay ninh", "ba ria vung tau",
  "long an", "tien giang", "ben tre", "tra vinh", "vinh long", "dong thap",
  "an giang", "kien giang", "hau giang", "soc trang", "bac lieu", "ca mau",
];

/** Câu mặc cả giá KHÔNG phải địa chỉ giao hàng: "600 có được thì mua" từng bị
 * rule số nhà (dòng bắt đầu bằng số) bắt thành địa chỉ → sinh đơn ảo
 * #DH-20261105-002 cho khách chưa hề đồng ý giá. Chặn các dòng mặc cả TRƯỚC
 * mọi rule nhận diện địa chỉ bên dưới. */
const HAGGLE_LINE =
  /(co duoc thi mua|duoc thi mua|co duoc khong|duoc khong|co duoc ko|duoc ko|co ban khong|ban duoc khong|ban ko|gia do thi|chot gia|tra gia|mac ca|giam gia|giam ko|bot them|bot khong|bot ko|freeship khong|mien ship khong)/;

/** Câu PHÀN NÀN về đơn/hàng đã giao KHÔNG phải địa chỉ: "Sao giao Bộ nồi
 * không giống quản cáo vậy..." bị rule từ khóa quận (quan) trong
 * looksLikeAddressLine bắt thành địa chỉ của đơn #DH-20261108-002 ("quản
 * cáo" bỏ dấu thành "quan cao" — trùng từ khóa "quan"). Chặn các câu nói
 * về hàng đã giao / lỗi hàng / đổi trả TRƯỚC mọi rule nhận diện địa chỉ
 * bên dưới: gặp câu phàn nàn thì coi như CHƯA có địa chỉ, bot hỏi lại,
 * tuyệt đối không đoán. */
const COMPLAINT_LINE =
  /(khong giong|quang cao|quan cao|khong dung hang|sai hang|hang sai|hang loi|loi hang|bi vo|bi meo|hoi meo|bi mop|bi hong|bi gay|bi nut|bi cham|bi thieu|bi sai|lan truoc|hom truoc|don truoc|don cu|giao truoc|da giao|giao roi|doi tra|tra hang|tra lai|hoan hang|doi hang|phan nan|khieu nai|khong hai long)/;

function isComplaintText(s: string): boolean {
  return COMPLAINT_LINE.test(stripVnDiacritics(s).toLowerCase());
}

/** Nhận diện 1 dòng tin nhắn có phải địa chỉ giao hàng không — kể cả khi
 * khách gõ thiếu dấu/không có từ khóa chuẩn, vd "Khu 2 đại phạm hạ Hòa phú Thọ"
 * (đơn #DH-20261103-002 từng bị mất địa chỉ vì dòng này không khớp từ khóa cũ). */
function looksLikeAddressLine(line: string): boolean {
  const strippedLine = stripVnDiacritics(line).toLowerCase();
  if (HAGGLE_LINE.test(strippedLine)) return false;
  if (COMPLAINT_LINE.test(strippedLine)) return false;
  // "600k ..." ở đầu dòng là giá tiền, không phải số nhà
  if (/^\d{3}\s*k\b/.test(strippedLine)) return false;
  if (ADDRESS_KEYWORDS.test(line)) return true;
  if (/^\d+[\s,/]/.test(line)) return true;
  const n = stripVnDiacritics(line).replace(/[.,]/g, " ");
  if (/^(khu|thon|ap|xom|to|so|ngo|hem|duong|pho|ban)\b/.test(n)) return true;
  if (/\b(xa|phuong|huyen|quan|thi xa|thi tran|tinh|thanh pho)\b/.test(n)) return true;
  const padded = ` ${n.replace(/\s+/g, " ")} `;
  return VN_PROVINCES.some((p) => padded.includes(` ${p} `));
}

/** Cắt phần câu chuyện trò TRƯỚC địa chỉ thật: khách hay gõ cả câu
 * "Rồi em cam kết rồi đó nha số nhà chị 29 đường..." — chỉ giữ từ
 * mốc địa chỉ đầu tiên (số nhà/đường/phường...) trở đi, bỏ luôn đại
 * từ sở hữu sau "số nhà" (ca Kim Ngọc, đơn #DH-20261110-005). */
const ADDRESS_ANCHOR =
  /(số\s*nhà|số\s*\d+|địa\s*chỉ|đường|phố|ngõ|hẻm|thôn|ấp|xóm|tổ\s*\d+|khu\s*phố|phường|xã|quận|huyện|tỉnh|thành\s*phố)/i;

function trimToAddressAnchor(line: string): string {
  const m = line.match(ADDRESS_ANCHOR);
  if (m && m.index && m.index > 0) {
    return line
      .slice(m.index)
      .replace(/^số nhà (chị|anh|em|tôi|mình)\s+/i, "số nhà ")
      .trim();
  }
  return line;
}

function extractAddressFromInbound(allInbound: string): string | null {
  const labeled = extractAddressFromText(allInbound);
  if (labeled && !isComplaintText(labeled)) return labeled;

  const shipMatch = allInbound.match(
    /(?:ship|giao|nhận)\s*(?:về|đến|tại|ở)\s*:?\s*([^\n.!?]{10,220})/i
  );
  if (shipMatch?.[1] && !isComplaintText(shipMatch[1])) return shipMatch[1].trim();

  const lines = allInbound.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    if (line.length < 12 || line.length > 220) continue;
    if (PHONE_EXTRACT.test(line) && line.replace(/\D/g, "").length <= 11) continue;
    if (looksLikeAddressLine(line)) {
      return trimToAddressAnchor(
        line.replace(/^(địa\s*chỉ|dc|addr)\s*:?\s*/i, "").trim()
      );
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
    // Page chỉ bán 1 sản phẩm → đơn luôn là sản phẩm đó. Nhiều sản phẩm mà
    // không khớp tên catalog thì để trống, KHÔNG bịa từ câu chữ của khách
    // (lỗi cũ: câu "ko đẹp ko nhận a" bị ghi thành sản phẩm của đơn #DH-20261103-002).
    if (productNames.length === 1) return productNames[0];
    return null;
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
    quantity: extractQuantity(allInbound),
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

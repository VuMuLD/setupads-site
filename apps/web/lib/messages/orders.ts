import { prisma } from "@/lib/prisma";
import {
  extractCustomerInfoFromMessages,
  getOrCreatePageCustomer,
  linkConversationToCustomer,
  type ExtractedOrderInfo,
} from "@/lib/messages/customer-memory";
import { detectCustomerPurchaseCommitment } from "@/lib/messages/purchase-detection";
import { getManualLabelsFromDb } from "@/lib/messages/conversation-status";
import { sendConversationReply } from "@/lib/messages/send-page-reply";
import { learnFromConversation } from "@/lib/ai/customer-learning";
import {
  type OrderStatus,
  parseOrderStatus,
  orderGrandTotal,
} from "@/lib/messages/order-status";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatVnDate(d: Date): string {
  return d.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export async function generateOrderCode(pageId: string): Promise<string> {
  const now = new Date();
  // Đếm theo TIỀN TỐ MÃ (DH-<ngày>-): MỌI đơn đã mang mã của ngày đó trong
  // Page, kể cả đơn received chưa xác nhận. Cách cũ đếm theo confirmedAt
  // trong cửa sổ ngày-local, còn mã lại lấy ngày UTC (toISOString) — đơn tạo
  // 7/11 01:02 VN mang mã 20261106 nhưng rơi ngoài cửa sổ đếm ngày 7/11 nên
  // cùng ra 001 với đơn 6/11 (sự cố trùng mã DH-20261106-001 ở Bếp Việt).
  // Đếm theo tiền tố thì ngày đếm và ngày trong mã là một, không lệch múi giờ.
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.pageCustomerOrder.count({
    where: { pageId, orderCode: { startsWith: `DH-${dateStr}-` } },
  });
  let seq = count + 1;
  // Chốt chặn cuối: mã phải duy nhất trong Page — mã đã tồn tại thì tăng tiếp.
  for (;;) {
    const code = `DH-${dateStr}-${String(seq).padStart(3, "0")}`;
    const exists = await prisma.pageCustomerOrder.findFirst({
      where: { pageId, orderCode: code },
      select: { id: true },
    });
    if (!exists) return code;
    seq += 1;
  }
}

/** "Bếp Việt" → "BV", "Siêu Thị Gia Dụng" → "STGD" — ghi tắt Page theo form chốt đơn của chủ shop */
export function abbreviatePageName(pageName: string): string {
  return pageName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d")
        .charAt(0)
        .toUpperCase()
    )
    .join("");
}

export function formatOrderConfirmationMessage(options: {
  orderCode: string;
  pageName: string;
  customerName: string | null;
  productSummary: string | null;
  productCode?: string | null;
  size: string | null;
  quantity: number | null;
  phone: string | null;
  address: string | null;
  amount: number | null;
  unitPrice?: number | null;
  confirmedAt?: Date | null;
}): string {
  // Form chốt đơn chuẩn của chủ shop (2026-11-03): đúng và đủ, mã đơn giữ nguyên.
  const qty = options.quantity && options.quantity > 0 ? options.quantity : 1;
  const unitPrice =
    options.unitPrice ??
    (options.amount ? Math.round(options.amount / qty) : null);
  const vnDate = new Date(
    (options.confirmedAt ?? new Date()).toLocaleString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
    })
  );
  const dateStr = `${String(vnDate.getDate()).padStart(2, "0")}/${String(
    vnDate.getMonth() + 1
  ).padStart(2, "0")}`;
  const lines = [
    `✅ XÁC NHẬN ĐƠN #${options.orderCode}`,
    `Ngày: ${dateStr}`,
    `Tên: ${options.customerName?.trim() || "anh/chị"}`,
    `SĐT: ${options.phone?.trim() || ""}`,
    `ĐC: ${options.address?.trim() || ""}`,
    `${options.productCode || "SP01"} . Số Lượng: ${qty}`,
    `Giá / 1 bộ: ${unitPrice ? `${unitPrice.toLocaleString("vi-VN")}đ` : ""}`,
    abbreviatePageName(options.pageName),
  ];
  return lines.join("\n");
}

/** Câu chốt gửi thành 1 tin RIÊNG ngay sau khi tin xác nhận đơn đã gửi xong
 * (chủ shop chốt 2026-11-03 — nguyên văn, không gộp vào tin xác nhận) */
export const ORDER_CLOSING_MESSAGE =
  "Dạ em đã lên đơn cho anh/chị rồi ạ. Tầm 3-5 ngày nữa bác để ý điện thoại shipper gọi nhận hàng nhé. Cần hỗ trợ gì bác cứ nhắn em ạ!";

/** Giá sàn mặc cả ghi trong mô tả sản phẩm, dạng: "thấp nhất còn 679.000đ".
 * Mô tả SP là nguồn sự thật duy nhất cho giá sàn — sửa mô tả là sửa giá sàn. */
export function parseFloorPrice(description?: string | null): number | null {
  if (!description) return null;
  const m = description.match(/thấp nhất còn\s+([\d.]+)\s*đ/i);
  if (!m) return null;
  const value = parseInt(m[1].replace(/[.,]/g, ""), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Tin có nhắc tới một mức giá cụ thể không (679k / 679.000 / 679000...) */
function mentionsPrice(text: string, price: number): boolean {
  const t = text.toLowerCase().replace(/\s+/g, "");
  const k = Math.round(price / 1000);
  return (
    t.includes(`${k}k`) ||
    t.includes(`${k}.000`) ||
    t.includes(`${k},000`) ||
    t.includes(String(price))
  );
}

/**
 * Giá/1 bộ THEO THỎA THUẬN trong hội thoại (chủ shop chốt 2026-11-04: "ghi
 * theo thoả thuận"). Chỉ tính các tin GỬI ĐI (bot hoặc nhân viên chào giá):
 * mức giá được nhắc GẦN NHẤT là giá sàn → đơn ghi giá sàn; nhắc gần nhất là
 * giá niêm yết, hoặc không có thỏa thuận nào → null (giữ giá catalog).
 * Tin khách tự nhắc giá không tính (khách đòi giá thấp không thành thỏa thuận).
 */
export function resolveAgreedUnitPrice(
  product: { price: number | null; description?: string | null },
  messages: Array<{ direction: "INBOUND" | "OUTBOUND"; text: string | null }>
): number | null {
  if (!product.price) return null;
  const floor = parseFloorPrice(product.description);
  if (!floor || floor >= product.price) return null;
  let lastMentioned: number | null = null;
  for (const m of messages) {
    if (m.direction !== "OUTBOUND" || !m.text) continue;
    const hitFloor = mentionsPrice(m.text, floor);
    const hitList = mentionsPrice(m.text, product.price);
    // Một tin nhắc cả 2 (vd "giá gốc 699k, hỗ trợ còn 679k") → tính là chào sàn
    if (hitFloor) lastMentioned = floor;
    else if (hitList) lastMentioned = product.price;
  }
  return lastMentioned === floor ? floor : null;
}

export async function recordPageOrder(
  pageId: string,
  customerId: string,
  conversationId: string,
  extracted: ExtractedOrderInfo,
  options?: {
    sourceMessageId?: string;
    participantName?: string | null;
    productIds?: string[];
  }
) {
  const existing = await prisma.pageCustomerOrder.findFirst({
    where: { customerId, conversationId },
  });
  if (existing) return { order: existing, isNew: false };

  const orderCode = await generateOrderCode(pageId);
  const order = await prisma.pageCustomerOrder.create({
    data: {
      pageId,
      customerId,
      conversationId,
      orderCode,
      participantName: options?.participantName || null,
      phone: extracted.phone,
      address: extracted.address,
      size: extracted.size,
      quantity: extracted.quantity,
      productSummary: extracted.productSummary,
      productIds: options?.productIds,
      amount: extracted.amount,
      sourceMessageId: options?.sourceMessageId || null,
      status: "received",
    },
  });

  await prisma.pageCustomer.update({
    where: { id: customerId },
    data: {
      totalOrders: { increment: 1 },
      successfulCloses: { increment: 1 },
      isReturning: true,
      ...(extracted.amount ? { totalSpent: { increment: extracted.amount } } : {}),
    },
  });

  return { order, isNew: true };
}

export async function sendOrderConfirmation(
  orderId: string,
  userId: string
): Promise<boolean> {
  const order = await prisma.pageCustomerOrder.findFirst({
    where: {
      id: orderId,
      customer: { page: { facebookAccount: { userId } } },
    },
    include: {
      customer: true,
      page: { select: { name: true } },
    },
  });

  if (!order?.conversationId || order.confirmationSentAt) return false;

  // Mã SP theo vị trí trong catalog của Page (SP01, SP02...) + giá/1 bộ từ catalog
  const pageProducts = await prisma.pageProduct.findMany({
    where: { pageId: order.pageId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, price: true },
  });
  const orderProductIds = Array.isArray(order.productIds)
    ? (order.productIds as string[])
    : [];
  let productIdx = orderProductIds.length
    ? pageProducts.findIndex((p) => p.id === orderProductIds[0])
    : -1;
  if (productIdx < 0 && pageProducts.length === 1) productIdx = 0;
  const productCode =
    productIdx >= 0 ? `SP${String(productIdx + 1).padStart(2, "0")}` : "SP01";
  const catalogUnit = productIdx >= 0 ? pageProducts[productIdx].price : null;
  const amountUnit =
    order.amount && order.quantity
      ? Math.round(order.amount / order.quantity)
      : null;
  // Đơn đã thỏa thuận giá thấp hơn catalog (vd giá sàn 679k) thì in giá thỏa
  // thuận đã lưu trong amount, không in lại giá catalog.
  const unitPrice =
    amountUnit && catalogUnit && amountUnit < catalogUnit
      ? amountUnit
      : catalogUnit ?? amountUnit ?? order.amount;

  const text = formatOrderConfirmationMessage({
    orderCode: order.orderCode || order.id.slice(-8).toUpperCase(),
    pageName: order.page.name,
    customerName: order.participantName || order.customer.participantName,
    productSummary: order.productSummary,
    productCode,
    size: order.size,
    quantity: order.quantity,
    phone: order.phone || order.customer.phone,
    address: order.address || order.customer.address,
    amount: order.amount,
    unitPrice,
    confirmedAt: order.confirmedAt,
  });

  await sendConversationReply({
    conversationId: order.conversationId,
    userId,
    text,
  });

  // LUẬT 2026-11-06 (chủ shop): sau phiếu xác nhận KHÔNG gửi thêm tin nào
  // nữa — bỏ hẳn câu chốt riêng từng gửi sau phiếu (ORDER_CLOSING_MESSAGE
  // không còn được dùng).

  await prisma.pageCustomerOrder.update({
    where: { id: order.id },
    data: {
      confirmationSentAt: new Date(),
      status: order.status === "received" ? "confirmed" : order.status,
    },
  });

  return true;
}

/** Phát hiện chốt đơn → lưu DB → gửi xác nhận → học AI */
export async function captureOrderFromConversation(
  conversationId: string,
  userId: string,
  options?: { force?: boolean; skipConfirm?: boolean; manual?: boolean }
): Promise<{
  captured: boolean;
  reason?: string;
  orderId?: string;
  orderCode?: string | null;
  isNew?: boolean;
  phone?: string | null;
  address?: string | null;
  productSummary?: string | null;
  size?: string | null;
  quantity?: number | null;
  confirmationSent?: boolean;
  confirmationJustSent?: boolean;
}> {
  const conversation = await prisma.pageConversation.findFirst({
    where: {
      id: conversationId,
      page: { facebookAccount: { userId } },
    },
    include: {
      page: { select: { id: true, name: true } },
      messages: { orderBy: { sentAt: "asc" }, take: 50 },
    },
  });

  if (!conversation?.participantFbId) {
    return { captured: false };
  }

  const pageProducts = await prisma.pageProduct.findMany({
    where: { pageId: conversation.pageId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, price: true, description: true },
  });

  const flowMessages = conversation.messages.map((m) => ({
    direction: m.direction as "INBOUND" | "OUTBOUND",
    text: m.text,
    sentAt: m.sentAt,
  }));

  const manualPurchased = getManualLabelsFromDb(conversation.manualLabels).includes(
    "purchased"
  );
  const extracted = extractCustomerInfoFromMessages(
    flowMessages,
    pageProducts.map((p) => p.name)
  );

  // Chuẩn hóa theo catalog của Page: sản phẩm/giá/số lượng lấy từ catalog,
  // không lấy từ câu chữ tự do của khách.
  const matchedProduct =
    pageProducts.find((p) => p.name === extracted.productSummary) ||
    (pageProducts.length === 1 ? pageProducts[0] : null);
  let productIds: string[] | undefined;
  if (matchedProduct) {
    extracted.productSummary = matchedProduct.name;
    if (!extracted.quantity) extracted.quantity = 1;
    if (matchedProduct.price) {
      extracted.amount = matchedProduct.price * extracted.quantity;
    }
    productIds = [matchedProduct.id];
    // Giá thỏa thuận: hội thoại đã chốt ở giá sàn mặc cả thì ghi đơn theo giá
    // sàn thay vì giá catalog (vẫn chỉ ghi khi THẤP HƠN catalog).
    if (matchedProduct.price) {
      const agreedUnit = resolveAgreedUnitPrice(matchedProduct, flowMessages);
      if (agreedUnit && agreedUnit < matchedProduct.price) {
        extracted.amount = agreedUnit * extracted.quantity;
      }
    }
  }

  const hasOrderInfo = Boolean(
    extracted.phone || extracted.address || extracted.productSummary || extracted.size
  );

  const purchased =
    options?.manual ||
    options?.force ||
    manualPurchased ||
    detectCustomerPurchaseCommitment(flowMessages);

  if (!purchased) {
    return { captured: false, reason: "no_purchase_signal" };
  }

  if (options?.manual && !hasOrderInfo && !options?.force) {
    return { captured: false, reason: "no_order_info" };
  }

  // Tự động bắt đơn: khách CHỈ CẦN SĐT + địa chỉ là lên đơn (chủ shop chốt
  // 2026-11-03). Tên lấy từ profile FB, sản phẩm/giá lấy từ catalog của Page.
  // Thiếu SĐT hoặc địa chỉ thì chờ tin tiếp theo của khách (mỗi tin mới đều
  // chạy lại capture) thay vì chốt đơn thiếu như #DH-20261103-002.
  // Nhân viên chốt tay (manual/force) không bị chặn này.
  if (!options?.manual && !options?.force) {
    const missing: string[] = [];
    if (!extracted.phone) missing.push("phone");
    if (!extracted.address) missing.push("address");
    if (missing.length) {
      return {
        captured: false,
        reason: `incomplete_order_info:${missing.join(",")}`,
      };
    }
  }

  const customer = await getOrCreatePageCustomer(
    conversation.pageId,
    conversation.participantFbId,
    conversation.participantName
  );
  if (!conversation.customerId) {
    await linkConversationToCustomer(conversation.id, customer.id);
  }

  const lastInbound = conversation.messages.filter((m) => m.direction === "INBOUND").pop();

  const { order, isNew } = await recordPageOrder(
    conversation.pageId,
    customer.id,
    conversation.id,
    extracted,
    {
      sourceMessageId: lastInbound?.id,
      participantName: conversation.participantName,
      productIds,
    }
  );

  let finalOrder = order;
  if (!isNew && options?.manual) {
    finalOrder = await prisma.pageCustomerOrder.update({
      where: { id: order.id },
      data: {
        phone: extracted.phone || order.phone,
        address: extracted.address || order.address,
        size: extracted.size || order.size,
        quantity: extracted.quantity || order.quantity,
        productSummary: extracted.productSummary || order.productSummary,
        amount: extracted.amount || order.amount,
        ...(productIds ? { productIds } : {}),
        participantName: conversation.participantName || order.participantName,
      },
    });
  }

  // Đơn cũ THIẾU thông tin (nháp rác từ đường học tập cũ) mà lần này đã
  // trích đủ SĐT + địa chỉ (cổng tự động phía trên đã chặn thiếu) →
  // hoàn thiện chính đơn cũ rồi xác nhận, không tạo đơn trùng, không
  // để đơn nháp chặn mất đơn thật.
  let completedExisting = false;
  if (
    !isNew &&
    !options?.manual &&
    !options?.force &&
    (!order.phone || !order.address)
  ) {
    finalOrder = await prisma.pageCustomerOrder.update({
      where: { id: order.id },
      data: {
        phone: extracted.phone || order.phone,
        address: extracted.address || order.address,
        size: extracted.size || order.size,
        quantity: extracted.quantity || order.quantity,
        productSummary: extracted.productSummary || order.productSummary,
        amount: extracted.amount || order.amount,
        ...(productIds ? { productIds } : {}),
        participantName: conversation.participantName || order.participantName,
      },
    });
    completedExisting = true;
  }

  let confirmationSent = Boolean(finalOrder.confirmationSentAt);
  const hadConfirmation = confirmationSent;

  const shouldConfirm =
    (isNew || completedExisting || (options?.manual && !confirmationSent)) &&
    !options?.skipConfirm;

  if (shouldConfirm) {
    try {
      const sent = await sendOrderConfirmation(finalOrder.id, userId);
      confirmationSent = sent || confirmationSent;
    } catch (err) {
      console.error("[captureOrder] confirm send failed:", err);
    }
  }
  // Xác nhận vừa được gửi trong lần capture này (không phải đã gửi từ trước)
  const confirmationJustSent = confirmationSent && !hadConfirmation;

  if (isNew || options?.manual) {
    void learnFromConversation(conversationId, { force: true }).catch((err) =>
      console.error("[captureOrder] learn failed:", err)
    );
  }

  return {
    captured: true,
    orderId: finalOrder.id,
    orderCode: finalOrder.orderCode,
    isNew,
    phone: finalOrder.phone,
    address: finalOrder.address,
    productSummary: finalOrder.productSummary,
    size: finalOrder.size,
    quantity: finalOrder.quantity,
    confirmationSent,
    confirmationJustSent,
  };
}

export interface OrderListItem {
  id: string;
  orderCode: string | null;
  participantName: string | null;
  phone: string | null;
  address: string | null;
  productSummary: string | null;
  size: string | null;
  quantity: number | null;
  amount: number | null;
  shippingFee: number | null;
  grandTotal: number;
  status: OrderStatus;
  confirmationSentAt: string | null;
  confirmedAt: string;
  conversationId: string | null;
}

export interface OrderPeriodGroup {
  key: string;
  label: string;
  isCurrent: boolean;
  orderCount: number;
  totalAmount: number;
  totalShippingFee: number;
  grandTotal: number;
  byStatus: Record<OrderStatus, number>;
  orders: OrderListItem[];
}

export interface OrderSummary {
  orderCount: number;
  totalAmount: number;
  totalShippingFee: number;
  grandTotal: number;
  byStatus: Record<OrderStatus, number>;
}

function emptyStatusCounts(): Record<OrderStatus, number> {
  return {
    received: 0,
    confirmed: 0,
    shipping: 0,
    delivered: 0,
    returned: 0,
  };
}

function mapOrderToListItem(o: {
  id: string;
  orderCode: string | null;
  participantName: string | null;
  phone: string | null;
  address: string | null;
  productSummary: string | null;
  size: string | null;
  quantity: number | null;
  amount: number | null;
  shippingFee: number | null;
  status: string;
  confirmationSentAt: Date | null;
  confirmedAt: Date;
  conversationId: string | null;
  customer: { participantName: string | null; phone: string | null; address: string | null };
}): OrderListItem {
  const amount = o.amount;
  const shippingFee = o.shippingFee;
  return {
    id: o.id,
    orderCode: o.orderCode,
    participantName: o.participantName || o.customer.participantName,
    phone: o.phone || o.customer.phone,
    address: o.address || o.customer.address,
    productSummary: o.productSummary,
    size: o.size,
    quantity: o.quantity,
    amount,
    shippingFee,
    grandTotal: orderGrandTotal(amount, shippingFee),
    status: parseOrderStatus(o.status),
    confirmationSentAt: o.confirmationSentAt?.toISOString() || null,
    confirmedAt: o.confirmedAt.toISOString(),
    conversationId: o.conversationId,
  };
}

function getWeekKey(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return formatDateKey(monday);
}

function formatWeekLabel(mondayKey: string): string {
  const start = new Date(mondayKey + "T12:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) =>
    x.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  return `Tuần ${fmt(start)} – ${fmt(end)}`;
}

function getMonthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `Tháng ${m}/${y}`;
}

function accumulateSummary(
  target: OrderSummary,
  amount: number | null,
  shippingFee: number | null,
  status: OrderStatus
) {
  target.orderCount++;
  target.totalAmount += amount || 0;
  target.totalShippingFee += shippingFee || 0;
  target.grandTotal += orderGrandTotal(amount, shippingFee);
  target.byStatus[status]++;
}

export async function updatePageOrder(
  orderId: string,
  userId: string,
  data: { status?: OrderStatus; shippingFee?: number | null; amount?: number | null }
) {
  const order = await prisma.pageCustomerOrder.findFirst({
    where: {
      id: orderId,
      page: { facebookAccount: { userId } },
    },
  });
  if (!order) throw new Error("Đơn hàng không tồn tại");

  const update: {
    status?: string;
    shippingFee?: number | null;
    amount?: number | null;
  } = {};

  if (data.status) update.status = data.status;
  if (data.shippingFee !== undefined) update.shippingFee = data.shippingFee;
  if (data.amount !== undefined) update.amount = data.amount;

  return prisma.pageCustomerOrder.update({
    where: { id: orderId },
    data: update,
  });
}

export type OrderGroupBy = "day" | "week" | "month";

export async function listOrdersGrouped(
  pageId: string,
  userId: string,
  options?: { days?: number; groupBy?: OrderGroupBy }
): Promise<{
  pageName: string;
  groupBy: OrderGroupBy;
  groups: OrderPeriodGroup[];
  summary: OrderSummary;
}> {
  const days = options?.days ?? 30;
  const groupBy = options?.groupBy ?? "day";
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId } },
    select: { id: true, name: true },
  });
  if (!page) throw new Error("Page không tồn tại");

  const orders = await prisma.pageCustomerOrder.findMany({
    where: { pageId: page.id, confirmedAt: { gte: since } },
    orderBy: { confirmedAt: "desc" },
    include: {
      customer: { select: { participantName: true, phone: true, address: true } },
    },
  });

  const todayKey = formatDateKey(new Date());
  const currentWeekKey = getWeekKey(new Date());
  const currentMonthKey = getMonthKey(new Date());

  const byPeriod = new Map<string, OrderPeriodGroup>();
  const summary: OrderSummary = {
    orderCount: 0,
    totalAmount: 0,
    totalShippingFee: 0,
    grandTotal: 0,
    byStatus: emptyStatusCounts(),
  };

  for (const o of orders) {
    const item = mapOrderToListItem(o);
    accumulateSummary(summary, o.amount, o.shippingFee, item.status);

    let key: string;
    let label: string;
    let isCurrent = false;

    if (groupBy === "week") {
      key = getWeekKey(o.confirmedAt);
      label = formatWeekLabel(key);
      isCurrent = key === currentWeekKey;
    } else if (groupBy === "month") {
      key = getMonthKey(o.confirmedAt);
      label = formatMonthLabel(key);
      isCurrent = key === currentMonthKey;
    } else {
      key = formatDateKey(o.confirmedAt);
      const d = new Date(key + "T12:00:00");
      label = formatVnDate(d);
      isCurrent = key === todayKey;
    }

    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        key,
        label,
        isCurrent,
        orderCount: 0,
        totalAmount: 0,
        totalShippingFee: 0,
        grandTotal: 0,
        byStatus: emptyStatusCounts(),
        orders: [],
      });
    }

    const group = byPeriod.get(key)!;
    group.orderCount++;
    group.totalAmount += o.amount || 0;
    group.totalShippingFee += o.shippingFee || 0;
    group.grandTotal += item.grandTotal;
    group.byStatus[item.status]++;
    group.orders.push(item);
  }

  const groups = Array.from(byPeriod.values()).sort((a, b) =>
    b.key.localeCompare(a.key)
  );

  return { pageName: page.name, groupBy, groups, summary };
}

/** @deprecated dùng listOrdersGrouped */
export async function listOrdersByDay(
  pageId: string,
  userId: string,
  options?: { days?: number }
) {
  const result = await listOrdersGrouped(pageId, userId, {
    ...options,
    groupBy: "day",
  });
  return {
    pageName: result.pageName,
    groups: result.groups.map((g) => ({
      date: g.key,
      dateLabel: g.label,
      isToday: g.isCurrent,
      orderCount: g.orderCount,
      totalAmount: g.grandTotal,
      orders: g.orders,
    })),
    totalOrders: result.summary.orderCount,
    summary: result.summary,
  };
}

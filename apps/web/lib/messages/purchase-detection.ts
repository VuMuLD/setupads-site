export interface FlowMessage {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  sentAt?: string | Date;
}

const PHONE_PATTERN =
  /(?:sdt|sđt|điện\s*thoại|phone|tel|zalo|zl)\s*:?\s*0[35789]\d{8}|(?:^|\s)0[35789]\d{8}(?:\s|$)/i;

const ADDRESS_PATTERN =
  /địa\s*chỉ|giao\s*(?:đến|tới|về|cho)|nhận\s*(?:tại|ở|hàng)|phường|quận|huyện|thị\s*xã|tỉnh|tp\.?\s*[a-zà-ỹ]|số\s*\d+.*(?:đường|phố|ngõ|ấp|thôn|xã)/i;

const ORDER_COMMIT_PATTERN =
  /(?:chốt|đặt|lấy|mua|order)\s*(?:luôn|ngay|giúp|hộ|cho|em|nha|ạ)?|(?:cho|lấy|mua)\s*(?:em|shop)?\s*\d+|(?:size|sz)\s*[a-z0-9]+.*(?:lấy|mua|đặt|chốt)/i;

const PAYMENT_CONFIRM_PATTERN =
  /(?:đã|em|anh|chị)\s*(?:chuyển|ck|chuyển\s*khoản|thanh\s*toán)|chuyển\s*khoản\s*(?:xong|rồi|ok|thành\s*công)|đã\s*thanh\s*toán|cod\s*(?:ok|được)/i;

const EXPLICIT_PURCHASE_PATTERN =
  /đã\s*mua|đặt\s*hàng\s*(?:rồi|xong|ok|thành\s*công)|chốt\s*đơn|mua\s*rồi|lấy\s*rồi/i;

/** Chỉ tin nhắn khách gửi — không tính tin Page/AI */
export function getInboundMessages(messages: FlowMessage[]): FlowMessage[] {
  return messages.filter((m) => m.direction === "INBOUND");
}

/**
 * Chốt đơn khi khách gửi thông tin mua hàng thật:
 * SĐT + địa chỉ, hoặc xác nhận thanh toán, hoặc chốt kèm chi tiết đơn.
 * Không đánh dấu khi chỉ AI/Page hỏi địa chỉ hoặc cảm ơn đơn.
 */
export function detectCustomerPurchaseCommitment(messages: FlowMessage[]): boolean {
  const inbound = getInboundMessages(messages);
  if (inbound.length === 0) return false;

  const inboundText = inbound.map((m) => m.text).join("\n");
  const hasPhone = PHONE_PATTERN.test(inboundText);
  const hasAddress = ADDRESS_PATTERN.test(inboundText);
  const hasOrderCommit = ORDER_COMMIT_PATTERN.test(inboundText);
  const hasPaymentConfirm = PAYMENT_CONFIRM_PATTERN.test(inboundText);

  if (hasPaymentConfirm) return true;
  if (hasPhone && (hasAddress || hasOrderCommit)) return true;
  if (hasAddress && hasOrderCommit) return true;

  return inbound.some((m) => EXPLICIT_PURCHASE_PATTERN.test(m.text));
}

/** Khách đang có ý định mua nhưng chưa gửi đủ thông tin chốt */
export function detectCustomerClosingIntent(messages: FlowMessage[]): boolean {
  const inbound = getInboundMessages(messages);
  if (inbound.length === 0) return false;
  if (detectCustomerPurchaseCommitment(messages)) return false;

  const lastInbound = [...inbound].sort(
    (a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime()
  )[0];

  return /đặt\s*(?:hàng|luôn|ngay)|chốt|ok\s*em|oke|được\s*em|lấy\s*luôn|ship\s*cho|giao\s*cho|cod|chuyển\s*khoản/i.test(
    lastInbound.text
  );
}

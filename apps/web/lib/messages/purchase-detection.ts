import { stripVnDiacritics, VN_PROVINCES, extractPhone } from "./vn-text";

export interface FlowMessage {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  sentAt?: string | Date;
}

/** Từ khóa địa chỉ trên văn bản đã bỏ dấu (khách hay gõ không dấu).
 * \b dùng được vì văn bản bỏ dấu chỉ còn ký tự ASCII. Không gồm "xa" trần
 * (trùng "xa quá") — địa chỉ có "xã" thường kèm từ khóa khác hoặc tên tỉnh. */
const ADDRESS_KEYWORDS_ND =
  /(dia\s*chi|giao\s*(den|toi|ve|cho)|nhan\s*(tai|o|hang)|\b(phuong|quan|huyen|thi\s*xa|tinh|thon|ap|xom|khu|duong|pho|ngo|hem)\b|tp\.?\s*\w|so\s*\d+.*(duong|pho|ngo|ap|thon|xa))/;

function hasAddressSignal(text: string): boolean {
  const n = stripVnDiacritics(text).toLowerCase();
  if (ADDRESS_KEYWORDS_ND.test(n)) return true;
  const padded = ` ${n.replace(/[.,]/g, " ").replace(/\s+/g, " ")} `;
  return VN_PROVINCES.some((p) => padded.includes(` ${p} `));
}

const ORDER_COMMIT_PATTERN =
  /(?:chốt|chot|đặt|dat|lấy|lay|mua|order)\s*(?:luôn|luon|ngay|giúp|giup|hộ|ho|cho|em|nha|ạ|a)?|(?:cho|lấy|lay|mua)\s*(?:em|shop)?\s*\d+|(?:size|sz)\s*[a-z0-9]+.*(?:lấy|lay|mua|đặt|dat|chốt|chot)/i;

const PAYMENT_CONFIRM_PATTERN =
  /(?:đã|da|em|anh|chị|chi)\s*(?:chuyển|chuyen|ck|chuyển\s*khoản|chuyen\s*khoan|thanh\s*toán|thanh\s*toan)|(?:chuyển\s*khoản|chuyen\s*khoan)\s*(?:xong|rồi|roi|ok|thành\s*công|thanh\s*cong)|đã\s*thanh\s*toán|da\s*thanh\s*toan|cod\s*(?:ok|được|duoc)/i;

const EXPLICIT_PURCHASE_PATTERN =
  /đã\s*mua|da\s*mua|(?:đặt\s*hàng|dat\s*hang)\s*(?:rồi|roi|xong|ok|thành\s*công|thanh\s*cong)|chốt\s*đơn|chot\s*don|mua\s*rồi|mua\s*roi|lấy\s*rồi|lay\s*roi/i;

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
  const hasPhone = extractPhone(inboundText) !== null;
  const hasAddress = hasAddressSignal(inboundText);
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

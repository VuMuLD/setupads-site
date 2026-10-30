import {
  detectCustomerClosingIntent,
  detectCustomerPurchaseCommitment,
  type FlowMessage,
} from "@/lib/messages/purchase-detection";

export type { FlowMessage };

export type ConsultingStage =
  | "greeting"
  | "discovery"
  | "recommendation"
  | "objection"
  | "closing"
  | "follow_up"
  | "purchased";

const PRICE_ASK_PATTERN =
  /giá\s*bao\s*nhiêu|bao\s*nhiêu\s*tiền|giá\s*bn|báo\s*giá|price/i;

const PRODUCT_ASK_PATTERN =
  /còn\s*hàng|size\s*gì|màu\s*gì|mẫu\s*nào|sản\s*phẩm|xem\s*ảnh|cho\s*xem/i;

const OBJECTION_PATTERN =
  /đắt|suy\s*nghĩ|chưa\s*chắc|không\s*chắc|lo\s*lắng|tin\s*không|scam|lừa\s*đảo|review|đánh\s*giá|feedback|thật\s*không|uy\s*tín/i;

const GREETING_ONLY_PATTERN =
  /^(hi|hello|chào|dạ chào|alo|shop ơi|ad ơi|xin chào)[\s!.?]*$/i;

export const STAGE_LABELS: Record<ConsultingStage, string> = {
  greeting: "Chào hỏi",
  discovery: "Tìm hiểu nhu cầu",
  recommendation: "Giới thiệu sản phẩm",
  objection: "Xử lý lo ngại",
  closing: "Chốt đơn",
  follow_up: "Theo dõi",
  purchased: "Đã mua",
};

export function inferConsultingStage(messages: FlowMessage[]): ConsultingStage {
  if (!messages.length) return "greeting";

  const sorted = [...messages].sort(
    (a, b) => new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime()
  );
  const lastInbound = [...sorted].reverse().find((m) => m.direction === "INBOUND");
  const lastText = lastInbound?.text || "";

  if (detectCustomerPurchaseCommitment(sorted)) return "purchased";
  if (detectCustomerClosingIntent(sorted)) return "closing";
  if (OBJECTION_PATTERN.test(lastText)) return "objection";
  if (PRICE_ASK_PATTERN.test(lastText) || PRODUCT_ASK_PATTERN.test(lastText)) {
    return "recommendation";
  }

  const inboundCount = sorted.filter((m) => m.direction === "INBOUND").length;
  const outboundCount = sorted.filter((m) => m.direction === "OUTBOUND").length;

  if (inboundCount <= 1 && outboundCount === 0) {
    if (GREETING_ONLY_PATTERN.test(lastText.trim())) return "greeting";
    return "discovery";
  }

  if (outboundCount > 0 && inboundCount > outboundCount) {
    if (OBJECTION_PATTERN.test(lastText)) return "objection";
    if (PRICE_ASK_PATTERN.test(lastText) || PRODUCT_ASK_PATTERN.test(lastText)) {
      return "recommendation";
    }
    return "discovery";
  }

  if (outboundCount >= 2 && inboundCount <= outboundCount) return "follow_up";

  return "discovery";
}

export function getConsultingPlan(stage: ConsultingStage): string {
  const plans: Record<ConsultingStage, string> = {
    greeting: [
      "1. Chào khách thân thiện, giới thiệu ngắn shop đang có gì",
      "2. Hỏi 1 câu mở: khách đang tìm sản phẩm gì / dùng cho ai",
      "3. Chưa ép mua, chưa báo giá dồn dập",
    ].join("\n"),
    discovery: [
      "1. Hỏi rõ nhu cầu: size, màu, ngân sách, dùng cho ai",
      "2. Lắng nghe trước — ghi nhận câu trả lời của khách",
      "3. Hỏi thêm 1 câu để hiểu sâu hơn (VD: thích form rộng hay ôm?)",
      "4. Khi đủ thông tin → chuyển sang giới thiệu SP phù hợp",
    ].join("\n"),
    recommendation: [
      "1. Gợi ý 1–2 sản phẩm phù hợp nhất (không liệt kê hết)",
      "2. Nêu giá rõ ràng + 1–2 lợi ích nổi bật",
      "3. Gửi ảnh sản phẩm (sendImages) để khách xem trực quan",
      "4. Kết bằng câu hỏi nhẹ: size/màu khách thích không?",
    ].join("\n"),
    objection: [
      "1. Đồng cảm trước (em hiểu ạ / nhiều khách cũng hỏi vậy)",
      "2. Giải thích ngắn: chất lượng, ship, đổi trả, COD",
      "3. Gửi ảnh khách đã mua (sendCustomerPhotos) nếu khách do dự",
      "4. Không tranh cãi — nhẹ nhàng dẫn về lợi ích",
    ].join("\n"),
    closing: [
      "1. Khách đã có ý định → hướng dẫn đặt hàng đơn giản",
      "2. Hỏi size/màu/số lượng nếu chưa rõ",
      "3. Nhắc ship COD / giao nhanh / freeship nếu có",
      "4. Xin SĐT + địa chỉ một cách tự nhiên",
    ].join("\n"),
    follow_up: [
      "1. Nhắc nhẹ nếu khách im lặng sau khi tư vấn",
      "2. Hỏi khách còn thắc mắc gì không",
      "3. Gợi ý ưu đãi / còn hàng (nếu phù hợp)",
    ].join("\n"),
    purchased: [
      "1. Cảm ơn khách đã tin tưởng",
      "2. Xác nhận đơn, thời gian giao dự kiến",
      "3. Mời khách feedback sau khi nhận hàng",
    ].join("\n"),
  };
  return plans[stage];
}

export function getStageGuidance(stage: ConsultingStage): string {
  const guidance: Record<ConsultingStage, string> = {
    greeting:
      "Khách mới nhắn. Chào ấm áp, tạo cảm giác được lắng nghe. Hỏi 1 câu mở để bắt chuyện — KHÔNG bán ngay.",
    discovery:
      "Đang tìm hiểu nhu cầu. Ưu tiên HỎI hơn NÓI. Mỗi tin nhắn nên có ít nhất 1 câu hỏi để hiểu khách.",
    recommendation:
      "Khách đã có nhu cầu hoặc hỏi giá/SP. Giới thiệu cụ thể, gửi ảnh, nêu giá. Kết bằng câu hỏi xác nhận.",
    objection:
      "Khách đang do dự hoặc phàn nàn. Đồng cảm trước, giải thích ngắn, dùng social proof (ảnh khách mua).",
    closing:
      "Khách sắp mua. Hướng dẫn đặt hàng rõ ràng, hỏi thông tin giao hàng. Đừng hỏi lan man.",
    follow_up:
      "Khách chưa trả lời sau tư vấn. Nhắc nhẹ, không ép. Hỏi còn thắc mắc gì không.",
    purchased:
      "Khách đã đặt/mua. Cảm ơn, xác nhận đơn. Không tư vấn bán thêm trừ khi khách hỏi.",
  };
  return guidance[stage];
}

export function buildConsultingContext(messages: FlowMessage[]) {
  const stage = inferConsultingStage(messages);
  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    guidance: getStageGuidance(stage),
    plan: getConsultingPlan(stage),
    inboundCount: messages.filter((m) => m.direction === "INBOUND").length,
    outboundCount: messages.filter((m) => m.direction === "OUTBOUND").length,
  };
}

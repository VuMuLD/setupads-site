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
  | "follow_up_value"
  | "follow_up_offer"
  | "follow_up_final"
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
  follow_up_value: "Theo dõi — thêm giá trị",
  follow_up_offer: "Theo dõi — chốt mềm",
  follow_up_final: "Theo dõi — tin cuối",
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
      "2. Nếu shop chỉ bán 1 sản phẩm duy nhất → giới thiệu thẳng sản phẩm đó (tên + giá + ưu đãi chính), TUYỆT ĐỐI không hỏi khách đang tìm/quan tâm sản phẩm gì; chỉ khi shop bán nhiều sản phẩm mới hỏi 1 câu mở khách đang tìm gì / dùng cho ai",
      "3. Thứ tự câu đầu: báo giá 699k trước → kèm 'được kiểm tra hàng trước khi nhận' + miễn phí ship → kết bằng câu hỏi tư vấn đúng mẫu: 'anh/chị dùng bếp ga hay bếp từ để em tư vấn tốt nhất cho mình ạ' (TUYỆT ĐỐI không hỏi chốt mua ở tin đầu); mỗi ý 1 dòng riêng, thật ngắn; chỉ gọi khách anh/chị, TUYỆT ĐỐI không nhắc tên khách",
    ].join("\n"),
    discovery: [
      "1. Nếu shop chỉ bán 1 sản phẩm duy nhất → mặc định mọi câu hỏi của khách là về sản phẩm đó, tư vấn thẳng sản phẩm đó, chỉ hỏi nhu cầu gắn với chính sản phẩm đó (VD: nhà dùng bếp từ hay bếp ga, nấu cho mấy người), TUYỆT ĐỐI không hỏi khách đang quan tâm sản phẩm/bộ nào; shop bán nhiều sản phẩm mới hỏi rõ nhu cầu: size, màu, ngân sách, dùng cho ai",
      "2. Lắng nghe trước — ghi nhận câu trả lời của khách",
      "3. Kết bằng câu hỏi tư vấn về cách dùng sản phẩm, mặc định đúng mẫu: 'anh/chị dùng bếp ga hay bếp từ để em tư vấn tốt nhất cho mình ạ?' — KHÔNG hỏi chốt mua khi khách chưa tỏ ý muốn mua",
      "4. Khi đủ thông tin → chuyển sang giới thiệu SP phù hợp",
    ].join("\n"),
    recommendation: [
      "1. Gợi ý 1–2 sản phẩm phù hợp nhất (không liệt kê hết)",
      "2. Báo GIÁ 699.000đ (giá gốc 1.200.000đ) ngay dòng đầu, dòng tiếp theo: 'được kiểm tra hàng trước khi nhận' + miễn phí ship; không liệt kê tính năng dài dòng",
      "3. Gửi ảnh sản phẩm (sendImages) để khách xem trực quan",
      "4. Kết bằng 1 câu hỏi tư vấn đúng mẫu: 'anh/chị dùng bếp ga hay bếp từ để em tư vấn tốt nhất cho mình ạ?' — KHÔNG hỏi chốt mua ở lượt tư vấn này",
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
    follow_up_value: [
      "1. Khách đã im lặng vài giờ — mở đầu tự nhiên, nhắc lại điểm khách từng quan tâm",
      "2. TẶNG thêm 1 thông tin hữu ích cụ thể về sản phẩm mà khách chưa biết (chất liệu, cách dùng, cách kiểm tra hàng...)",
      "3. Kết bằng 1 câu hỏi nhẹ, dễ trả lời",
      "4. KHÔNG nhắc lại nguyên văn tin trước, KHÔNG ép mua",
    ].join("\n"),
    follow_up_offer: [
      "1. Khách im lặng nửa ngày — tóm gọn lại đề nghị: giá + freeship",
      "2. Hạ rào cản: COD kiểm tra hàng ưng mới trả tiền (miễn phí kiểm tra), đổi trả 7 ngày nếu lỗi từ nhà sản xuất; TUYỆT ĐỐI không nhắc tới bảo hành dưới mọi hình thức (không hứa, không phủ nhận) — khách hỏi bảo hành thì chỉ đáp 2 ý đổi trả + kiểm hàng miễn phí",
      "3. Hỏi chốt nhẹ 1 câu (VD: em giữ 1 bộ cho mình nhé?)",
      "4. Không dọa hết hàng, không giục giã",
    ].join("\n"),
    follow_up_final: [
      "1. Đây là tin chăm sóc CUỐI — lịch sự khép lại, để khách thật thoải mái",
      "2. Nhắc ngắn: shop luôn sẵn hàng và giữ ưu đãi khi khách quay lại",
      "3. Cảm ơn khách đã quan tâm + để cửa mở (khi nào cần cứ nhắn em)",
      "4. TUYỆT ĐỐI không ép chốt, không hỏi xin thông tin",
    ].join("\n"),
    purchased: [
      "1. Khách ĐÃ CHỐT ĐƠN — chỉ hỗ trợ sau mua: giao hàng, kiểm tra hàng, đổi trả 7 ngày nếu lỗi từ nhà sản xuất, cách dùng; TUYỆT ĐỐI không nhắc tới bảo hành dưới mọi hình thức",
      "2. Trả lời ĐÚNG câu khách hỏi, 1 câu ngắn gọn — xong là dừng",
      "3. Nếu khách chỉ cảm ơn/xác nhận (ok, dạ, cảm ơn...) → đáp lại 1 câu cảm ơn ngắn, KHÔNG nói thêm gì nữa",
      "4. TUYỆT ĐỐI không nhắc lại giá/ưu đãi, không giới thiệu sản phẩm, không gửi ảnh, không móc nối chốt đơn, không xin lại SĐT/địa chỉ",
    ].join("\n"),
  };
  return plans[stage];
}

export function getStageGuidance(stage: ConsultingStage): string {
  const guidance: Record<ConsultingStage, string> = {
    greeting:
      "Khách mới nhắn. Chào ấm áp, tạo cảm giác được lắng nghe. Nếu shop chỉ bán 1 sản phẩm duy nhất → giới thiệu thẳng sản phẩm đó (tên + giá + ưu đãi chính) và hỏi 1 câu mở gắn với chính sản phẩm đó (VD: nhà mình dùng bếp từ hay bếp ga ạ), TUYỆT ĐỐI không hỏi khách đang tìm/quan tâm sản phẩm gì. Chỉ khi shop bán nhiều sản phẩm mới hỏi 1 câu mở để bắt chuyện — KHÔNG bán ngay. Câu đầu tiên của shop 1 sản phẩm: báo giá 699.000đ trước, ngay sau đó 'được kiểm tra hàng trước khi nhận' + miễn phí ship, mỗi ý 1 dòng, kết bằng câu hỏi tư vấn đúng mẫu (bếp ga hay bếp từ để em tư vấn tốt nhất cho mình), KHÔNG hỏi chốt mua ở các tin đầu; chỉ gọi anh/chị, không nhắc tên khách.",
    discovery:
      "Đang tìm hiểu nhu cầu. Nếu shop chỉ bán 1 sản phẩm duy nhất → mặc định mọi câu hỏi của khách là về sản phẩm đó: tư vấn thẳng sản phẩm đó, câu hỏi chỉ để hiểu cách khách dùng chính sản phẩm đó, TUYỆT ĐỐI không hỏi khách đang quan tâm sản phẩm/bộ nào. Shop bán nhiều sản phẩm: ưu tiên HỎI hơn NÓI, mỗi tin nhắn nên có ít nhất 1 câu hỏi để hiểu khách. Shop 1 sản phẩm, lượt tư vấn đầu: báo giá 699.000đ trước kèm 'được kiểm tra hàng trước khi nhận' + miễn phí ship, mỗi ý 1 dòng, kết bằng câu hỏi tư vấn đúng mẫu (bếp ga hay bếp từ để em tư vấn tốt nhất cho mình), KHÔNG hỏi chốt mua ở các tin đầu; chỉ gọi anh/chị, không nhắc tên khách.",
    recommendation:
      "Khách đã có nhu cầu hoặc hỏi giá/SP. Báo giá 699.000đ ngay dòng đầu, dòng tiếp theo 'được kiểm tra hàng trước khi nhận' + miễn phí ship, gửi ảnh, mỗi ý 1 dòng, kết bằng 1 câu hỏi tư vấn đúng mẫu (bếp ga hay bếp từ để em tư vấn tốt nhất cho mình). Chỉ gọi anh/chị, không nhắc tên khách.",
    objection:
      "Khách đang do dự hoặc phàn nàn. Đồng cảm trước, giải thích ngắn, dùng social proof (ảnh khách mua).",
    closing:
      "Khách sắp mua. Hướng dẫn đặt hàng rõ ràng, hỏi thông tin giao hàng. Đừng hỏi lan man.",
    follow_up:
      "Khách chưa trả lời sau tư vấn. Nhắc nhẹ, không ép. Hỏi còn thắc mắc gì không.",
    follow_up_value:
      "Khách im lặng vài giờ sau tư vấn. Đừng nhắc lại y nguyên — hãy TẶNG thêm một thông tin có ích về sản phẩm để khách có lý do quay lại. Ngắn, thân thiện, không ép mua.",
    follow_up_offer:
      "Khách im lặng nửa ngày. Đây là lần gợi ý mua rõ ràng nhất trong chuỗi chăm sóc: nhắc giá tốt + freeship + kiểm tra hàng trước khi trả tiền. Vẫn ngắn gọn, thân thiện, không giục giã, không dọa hết hàng.",
    follow_up_final:
      "Tin nhắn cuối trong chuỗi chăm sóc (sắp hết cửa sổ 24h của Messenger). Tuyệt đối không ép chốt. Lịch sự, để lại ấn tượng tốt và lời mời mở để khách quay lại bất cứ lúc nào.",
    purchased:
      "Khách đã đặt hàng rồi — mọi tin nhắn bán hàng lúc này đều là spam. Chỉ trả lời hỗ trợ sau mua, thật ngắn và đúng trọng tâm; không pitch, không báo giá lại, không gửi ảnh sản phẩm, không móc nối mua thêm.",
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

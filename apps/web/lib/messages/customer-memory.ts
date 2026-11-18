import { prisma } from "@/lib/prisma";
import {
  detectCustomerPurchaseCommitment,
  type FlowMessage,
} from "@/lib/messages/purchase-detection";
import { buildConsultingContext } from "@/lib/messages/consulting-flow";
import {
  stripVnDiacritics,
  VN_PROVINCES,
  extractPhone,
  stripPhones,
} from "@/lib/messages/vn-text";

/** SĐT: dùng extractPhone/stripPhones ở ./vn-text (vá 16/11) — bắt SĐT
 * dính liền chữ, sau dấu chấm/phẩy, cách quãng (0848 176 189), có dấu chấm
 * (0343.492.093), +84, nhãn đt/dt; \b của JS là ASCII nên không dùng gần
 * chữ có dấu. */

/** Nhãn địa chỉ: "địa chỉ"/"giao đến|tới|về" (dấu : tùy chọn) và
 * "Đc"/"Dc" — riêng "Đc" BẮT BUỘC có dấu : vì "đc" còn là viết tắt của
 * "được" ("đc ko shop" không phải địa chỉ). Vùng bắt cho phép dấu chấm vì
 * địa chỉ thật hay viết liền dấu chấm ("A.Phường Hoà Mạc.TDP Số 4...") —
 * câu thừa sau địa chỉ được cắt ở extractAddressFromText. (Vá 15/11, đơn
 * #BV-DH-20261115-009: "Đc : ... Ninh Bình" từng không khớp mẫu này.) */
const ADDRESS_EXTRACT =
  /(?:(?:địa\s*chỉ|dia\s*chi|giao\s*(?:đến|tới|về|den|toi|ve))\s*:?|(?:đc|dc)\s*:)\s*([^\n]{10,200})/i;

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


/** Câu mặc cả giá KHÔNG phải địa chỉ giao hàng: "600 có được thì mua" từng bị
 * rule số nhà (dòng bắt đầu bằng số) bắt thành địa chỉ → sinh đơn ảo
 * #DH-20261105-002 cho khách chưa hề đồng ý giá. Chặn các dòng mặc cả TRƯỚC
 * mọi rule nhận diện địa chỉ bên dưới. Mở rộng 18/11 (đơn #BV-DH-20261117-007):
 * "Muốn 600k thôi" (muốn + số), "679 thì nói chi nữa" (nói chi nữa), và mọi
 * câu có giá tiền dạng số+k ("600k") đều là mặc cả, không phải địa chỉ. */
const HAGGLE_LINE =
  /(co duoc thi mua|duoc thi mua|co duoc khong|duoc khong|co duoc ko|duoc ko|co ban khong|ban duoc khong|ban ko|gia do thi|chot gia|tra gia|mac ca|giam gia|giam ko|bot them|bot khong|bot ko|freeship khong|mien ship khong|muon\s+\d|\d{2,4}\s*k|noi chi nua)/;

/** Câu PHÀN NÀN về đơn/hàng đã giao KHÔNG phải địa chỉ: "Sao giao Bộ nồi
 * không giống quản cáo vậy..." bị rule từ khóa quận (quan) trong
 * looksLikeAddressLine bắt thành địa chỉ của đơn #DH-20261108-002 ("quản
 * cáo" bỏ dấu thành "quan cao" — trùng từ khóa "quan"). Chặn các câu nói
 * về hàng đã giao / lỗi hàng / đổi trả TRƯỚC mọi rule nhận diện địa chỉ
 * bên dưới: gặp câu phàn nàn thì coi như CHƯA có địa chỉ, bot hỏi lại,
 * tuyệt đối không đoán. */
const COMPLAINT_LINE_HARD =
  /(khong dung hang|sai hang|hang sai|hang loi|loi hang|bi vo|bi meo|hoi meo|bi mop|bi hong|bi gay|bi nut|bi cham|bi thieu|bi sai|lan truoc|hom truoc|don truoc|don cu|giao truoc|da giao|giao roi|sao giao|doi tra|tra hang|tra lai|hoan hang|doi hang|phan nan|khieu nai|khong hai long)/;

/** Câu NGHI VẤN về sản phẩm (mềm): "hàng có như quảng cáo không" là câu hỏi
 * trước khi mua, KHÔNG phải phàn nàn về đơn đã giao — dòng có địa chỉ thật
 * + câu nghi vấn thì CẮT ở câu nghi vấn và giữ phần địa chỉ (ca Bế Lợi,
 * 16/11). Chỉ chặn hẳn khi có dấu hiệu đơn cũ/lỗi hàng (HARD trên). */
const SOFT_COMPLAINT_CUT =
  /(không giống|khong giong|quảng cáo|quang cao|quán cáo|quan cao|hàng có như|hang co nhu)/i;

function cutAtSoftComplaint(text: string): string {
  const m = text.match(SOFT_COMPLAINT_CUT);
  if (m && m.index !== undefined) return text.slice(0, m.index).trim();
  return text;
}

/** Tin hệ thống của Facebook — không phải thông tin khách đưa: "Bạn có thể
 * gọi cho ... trong 7 ngày tới" từng bị fallback ghi làm địa chỉ. */
const SYSTEM_LINE =
  /(ban co the goi cho|trong 7 ngay toi|cuoc goi|da goi|tep dinh kem|dinh kem|da gui mot)/;

/** Câu NHẬN XÉT về khoảng cách/vị trí KHÔNG phải địa chỉ: "Quảng Nam xa quá
 * shop à" từng bị rule "xa" (trùng "xã" sau khi bỏ dấu) + tên tỉnh bắt thành
 * địa chỉ của đơn #BV-DH-20261115-009. Chặn các câu hỏi/bình luận về vị trí
 * TRƯỚC mọi rule nhận diện địa chỉ. */
const REMARK_LINE =
  /(xa qua|xa vay|xa the|xa lam|xa nhi|gan qua|o dau|o cho nao|o tinh nao|o xa nao|o huyen nao|(xa|gan)\s*$)/;

function isComplaintText(s: string): boolean {
  return COMPLAINT_LINE_HARD.test(stripVnDiacritics(s).toLowerCase());
}

/** Nhận diện 1 dòng tin nhắn có phải địa chỉ giao hàng không — kể cả khi
 * khách gõ thiếu dấu/không có từ khóa chuẩn, vd "Khu 2 đại phạm hạ Hòa phú Thọ"
 * (đơn #DH-20261103-002 từng bị mất địa chỉ vì dòng này không khớp từ khóa cũ). */
function looksLikeAddressLine(line: string): boolean {
  const strippedLine = stripVnDiacritics(line).toLowerCase();
  if (HAGGLE_LINE.test(strippedLine)) return false;
  if (COMPLAINT_LINE_HARD.test(strippedLine)) return false;
  if (REMARK_LINE.test(strippedLine)) return false;
  if (SYSTEM_LINE.test(strippedLine)) return false;
  // "600k ..." ở đầu dòng là giá tiền, không phải số nhà
  if (/^\d{3}\s*k\b/.test(strippedLine)) return false;
  // "1 bộ nhé shop" là câu chốt số lượng, không phải số nhà — chặn trước
  // rule số nhà bên dưới (vá 15/11, test W; 18/11: kiểm trên dòng đã bỏ
  // dấu để "1 bo nhe shop" không dấu cũng bị chặn — test BA).
  if (/^\d+\s*(bo|mon|cai|sp)(\s|$|[.,!?])/i.test(strippedLine)) return false;
  if (ADDRESS_KEYWORDS.test(line)) return true;
  if (/^\d+[\s,/]/.test(line)) return true;
  const n = stripVnDiacritics(line).replace(/[.,]/g, " ");
  // "ban" (bản) bỏ khỏi danh sách: "Bạn có thể..." (tin hệ thống FB) bỏ dấu
  // thành "ban co the..." nên bị bắt nhầm. "to"/"so" phải kèm số hoặc "nha"
  // ("tổ 2", "số 29", "số nhà") để không bắt "So sánh..." hay "To...".
  if (/^(khu|thon|ap|xom|ngo|hem|duong|pho)\b/.test(n)) return true;
  if (/^to\s+\d+/.test(n)) return true;
  if (/^so(\s+\d+|\s+nha)\b/.test(n)) return true;
  if (/\b(xa|phuong|huyen|quan|thi xa|thi tran|tinh|thanh pho|duong|pho|ngo|hem)\b/.test(n)) return true;
  const padded = ` ${n.replace(/\s+/g, " ")} `;
  return VN_PROVINCES.some((p) => padded.includes(` ${p} `));
}

/** Cắt phần câu chuyện trò TRƯỚC địa chỉ thật: khách hay gõ cả câu
 * "Rồi em cam kết rồi đó nha số nhà chị 29 đường..." — chỉ giữ từ
 * mốc địa chỉ đầu tiên (số nhà/đường/phường...) trở đi, bỏ luôn đại
 * từ sở hữu sau "số nhà" (ca Kim Ngọc, đơn #DH-20261110-005). */
const ADDRESS_ANCHOR =
  /(số\s*nhà|so\s*nha|số\s*\d+|so\s*\d+|địa\s*chỉ|dia\s*chi|đường|duong|phố|pho|ngõ|ngo|hẻm|hem|thôn|thon|ấp|ap|xóm|xom|tổ\s*\d+|to\s*\d+|khu\s*phố|khu\s*pho|phường|phuong|xã|xa|quận|quan|huyện|huyen|tỉnh|tinh|thành\s*phố|thanh\s*pho)/i;

/** Từ khóa địa danh/cơ sở đứng TRƯỚC mốc địa chỉ — phần này LÀ địa chỉ,
 * không phải câu chuyện trò: "quán sông quê chân cầu ..." (đơn
 * #BV-DH-20261116-003 từng bị cắt mất vì trim chỉ giữ từ "phường"). Gặp
 * từ khóa này thì giữ nguyên cả dòng. Kiểm tra trên văn bản đã bỏ dấu;
 * "quan" ở đây là "quán"/"cơ quan" (quận đã là mốc nên không bao giờ nằm
 * trước mốc), "cau" là "cầu". "cho" (chợ) loại trừ dạng "cho em/anh/chị"
 * (động từ cho). */
const LANDMARK_BEFORE_ANCHOR =
  /\b(quan|cau|truong|shop|showroom|homestay|salon|spa|garage|karaoke|cong ty|benh vien|khach san|nha hang|cua hang|sieu thi|trung tam|chung cu|nha tho|ben xe|san bay|uy ban|cong an|buu dien|ky tuc xa|co quan|tru so|dai ly|cong vien|tram y te|phong kham|nha nghi|nga ba|nga tu|lo\s*[A-Za-z]?\d+|can\s*[A-Za-z]?\d+|cho(?!\s+(em|anh|chi|minh|toi|xin|hoi)))\b/;

function trimToAddressAnchor(line: string): string {
  const m = line.match(ADDRESS_ANCHOR);
  if (m && m.index && m.index > 0) {
    const before = line.slice(0, m.index);
    // Giữ nguyên cả dòng khi phần trước mốc là địa danh/cơ sở (quán, cầu,
    // trường, chợ...) hoặc chỉ là số nhà trần ("29 đường...", "Lô A29") —
    // đó là thông tin giao hàng, không phải câu chuyện trò.
    const strippedBefore = stripVnDiacritics(before).toLowerCase();
    if (LANDMARK_BEFORE_ANCHOR.test(strippedBefore)) return line.trim();
    if (/^\s*\d+[A-Za-z]?(?:\s*[\/,\-]\s*\d+[A-Za-z]?)?\s*$/.test(before))
      return line.trim();
    return line
      .slice(m.index)
      .replace(/^số nhà (chị|anh|em|tôi|mình)\s+/i, "số nhà ")
      .replace(/^so nha (chi|anh|em|toi|minh)\s+/i, "so nha ")
      .trim();
  }
  return line;
}

function extractAddressFromInbound(allInbound: string): string | null {
  // Bỏ SĐT trước khi xét địa chỉ (vá 15/11, đơn #BV-DH-20261115-009):
  // khách hay gõ địa chỉ + SĐT cùng 1 dòng ("Đc: ... Ninh Bình sđt: 0343...").
  // Cách cũ bỏ cả dòng khi tổng số chữ số <= 11 nên mất luôn địa chỉ thật,
  // rồi nhặt nhầm câu nhận xét cũ hơn ("Quảng Nam xa quá shop à") làm địa chỉ.
  const noPhone = stripPhones(allInbound);

  const labeled = extractAddressFromText(noPhone);
  if (labeled && !isComplaintText(labeled)) {
    const cut = cutAtSoftComplaint(labeled);
    if (cut) return cut;
  }

  const shipMatch = noPhone.match(
    /(?:ship|giao|nhận|nhan)\s*(?:về|ve|đến|den|tại|tai|ở|o|cho)\s*:?\s*([^\n.!?]{10,220})/i
  );
  if (shipMatch?.[1] && !isComplaintText(shipMatch[1])) {
    const cut = cutAtSoftComplaint(shipMatch[1].trim());
    if (cut) return cut;
  }

  const lines = noPhone.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    const cut = cutAtSoftComplaint(line);
    if (cut.length < 12 || cut.length > 220) continue;
    if (looksLikeAddressLine(cut)) {
      return trimToAddressAnchor(
        cut.replace(/^(địa\s*chỉ|dia\s*chi|[đd]c|addr)\s*:?\s*/i, "").trim()
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
  return extractPhone(text);
}

export function extractAddressFromText(text: string): string | null {
  const m = text.match(ADDRESS_EXTRACT);
  const raw = m?.[1]?.trim();
  if (!raw) return null;
  // "Theo địa chỉ đó mà gửi nhé" trỏ về địa chỉ cũ — nhãn "địa chỉ" ở đây
  // không mở đầu địa chỉ thật (đơn #BV-DH-20261117-006, test BB2). Bỏ qua
  // nhãn này để đường quét dòng / fallback tìm địa chỉ thật.
  if (m && m.index !== undefined && m.index > 0) {
    const beforeLabel = stripVnDiacritics(text.slice(0, m.index)).toLowerCase();
    if (/theo\s*$/.test(beforeLabel)) return null;
  }
  // Địa chỉ hay viết liền dấu chấm ("A.Phường...") nên vùng bắt cho phép
  // chấm — nhưng câu thừa sau địa chỉ thì cắt: chỉ giữ các đoạn sau dấu
  // ". " khi đoạn đó còn từ khóa địa chỉ ("123 đường X. Tôi muốn mua"
  // → chỉ giữ "123 đường X").
  const parts = raw.split(/\. /);
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    if (
      /(đường|duong|phố|pho|ngõ|ngo|hẻm|hem|thôn|thon|ấp|ap|xóm|xom|phường|phuong|xã|xa|quận|quan|huyện|huyen|tỉnh|tinh|thành phố|thanh pho|\btdp\b|số\s*\d+|so\s*\d+)/i.test(
        parts[i]
      )
    ) {
      out += ". " + parts[i];
    } else {
      break;
    }
  }
  return out.trim() || null;
}

/** Câu chốt mua / đặt hàng thuần túy — KHÔNG phải địa chỉ: "Tôi 1 bộ 6
 * món", "Cho mình 1 bộ", "Ok lấy 1 bộ", "Đặt hàng cho em nhé". Dùng để loại
 * khỏi fallback câu thô bên dưới. Mẫu KHÔNG DẤU, kiểm trên văn bản đã bỏ
 * dấu: bản cũ bắt "bộ/món" có dấu trên câu gốc nên "Cho chi mot bo"
 * (không dấu) lọt qua và thành địa chỉ của khách Minh Hoàng (TGĐGD,
 * 17/11); "Gửi tôi bộ" (đơn #BV-DH-20261117-006) cũng lọt vì thiếu động
 * từ gửi. */
// KHÔNG dùng \b ở đây: \b của JS chỉ hiểu ký tự ASCII nên đứng cạnh
// chữ có dấu thì hỏng (\b trước "đặt" không bao giờ khớp — test T từng
// lọt "Đặt hàng cho em nhé"). Dùng neo đầu dòng / khoảng trắng thay thế.
const PURCHASE_STATEMENT =
  /((lay|mua|dat|chot|gui)\s+.*(bo|mon|cai|sp|san pham)|^[.,\s]*(toi|minh|em|anh|chi|cho)\s+.*(bo|mon)|^[.,\s]*\d+\s*(bo|mon|cai)|(dat hang|len don|chot don|gui hang|giao hang|ship hang))/;

/** Câu HỎI — không phải địa chỉ: "Tôi thanh toán khi nhận hàng đúng
 * không?" từng bị fallback ghi làm địa chỉ của đơn #BV-DH-20261117-006.
 * Câu hỏi (kết thúc "?", mang từ hỏi, hoặc kết thúc "không") không bao
 * giờ là thông tin giao hàng. Kiểm trên văn bản đã bỏ dấu. */
const QUESTION_LINE =
  /(\?\s*$|(khi nao|bao gio|the nao|lam sao|nhu the nao|tai sao|vi sao|co duoc|duoc khong|dung khong|phai khong|hay khong|co phai)|khong\??\s*$)/;

/** Câu TRỎ về địa chỉ cũ — không phải địa chỉ: "Theo địa chỉ đó mà gửi
 * nhé" (đơn #BV-DH-20261117-006) chỉ nhắc tới địa chỉ đã đưa trước đó,
 * bản thân câu không chứa thông tin giao hàng. */
const REFERENCE_LINE = /(theo dia chi|dia chi cu|dia chi truoc)/;

/** Fallback địa chỉ (chủ shop chốt 15/11): đã có SĐT mà không trích được
 * địa chỉ theo mẫu thì ghi NGUYÊN CÂU của khách để team đọc và hỏi lại,
 * thay vì bỏ đơn. Chỉ lấy câu mới nhất còn giống "đang đưa thông tin"
 * trong 3 tin nhắn gần nhất: đủ dài, không phải câu mặc cả/phàn nàn/
 * nhận xét khoảng cách, không phải câu chốt mua / câu hỏi / câu trỏ về
 * địa chỉ cũ, đã bỏ SĐT khỏi câu. */
function extractRawAddressFallback(inbound: FlowMessage[]): string | null {
  const recent = inbound.slice(-3).reverse();
  for (const msg of recent) {
    const lines = msg.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines.reverse()) {
      const clean = cutAtSoftComplaint(
        stripPhones(line)
          .replace(/\s+/g, " ")
          .replace(/^[.,;!]+/, "")
          .replace(/^(địa\s*chỉ|dia\s*chi|[đd]c|addr)\s*:?\s*/i, "")
          .trim()
      );
      if (clean.length < 12 || clean.length > 220) continue;
      const stripped = stripVnDiacritics(clean).toLowerCase();
      if (HAGGLE_LINE.test(stripped)) continue;
      if (COMPLAINT_LINE_HARD.test(stripped)) continue;
      if (SYSTEM_LINE.test(stripped)) continue;
      if (REMARK_LINE.test(stripped)) continue;
      if (PURCHASE_STATEMENT.test(stripped)) continue;
      if (QUESTION_LINE.test(stripped)) continue;
      if (REFERENCE_LINE.test(stripped)) continue;
      return clean;
    }
  }
  return null;
}

export function extractCustomerInfoFromMessages(
  messages: FlowMessage[],
  productNames?: string[]
): ExtractedOrderInfo & { preferences: CustomerPreferences } {
  const inbound = messages.filter((m) => m.direction === "INBOUND");
  const allInbound = inbound.map((m) => m.text).join("\n");

  const phone = extractPhoneFromText(allInbound);
  const address =
    extractAddressFromInbound(allInbound) ??
    (phone ? extractRawAddressFallback(inbound) : null);
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

/** Tiện ích chung cho văn bản tiếng Việt + SĐT (tách từ customer-memory.ts
 * 16/11 để purchase-detection dùng chung — cổng chốt đơn và cổng trích xuất
 * phải nhận diện SĐT/địa chỉ GIỐNG nhau, nếu không đơn bị lọt. */

/** Bỏ dấu tiếng Việt + lowercase. */
export function stripVnDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export const VN_PROVINCES = [
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

/**
 * SĐT Việt Nam: 0 + đầu số 3/5/7/8/9 + 8 chữ số, cho phép dấu . - khoảng
 * trắng xen giữa các chữ số ("0343.492.093", "0848 176 189"). Không dùng
 * \b: \b của JS chỉ hiểu ký tự ASCII nên đứng cạnh chữ có dấu thì hỏng
 * ("bo0339200740" từng lọt). Nhánh trần dùng (?:^|[^0-9]) + (?![0-9]) để
 * bắt SĐT dính liền chữ/dấu câu mà không bắt dãy số dài hơn 10 chữ số.
 */
const PHONE_DIGITS = "0[35789](?:[. -]?\\d){8}";
const PHONE_LABELS = "(?:sdt|sđt|đt|dt|điện\\s*thoại|phone|tel|zalo|zl)";

const PHONE_EXTRACT_RE = new RegExp(
  `${PHONE_LABELS}\\s*:?\\s*(${PHONE_DIGITS})|\\+84\\s*([35789](?:[. -]?\\d){8})|(?:^|[^0-9])(${PHONE_DIGITS})(?![0-9])`,
  "i"
);

const PHONE_STRIP_RE = new RegExp(
  `${PHONE_LABELS}\\s*:?\\s*${PHONE_DIGITS}|\\+84\\s*[35789](?:[. -]?\\d){8}|(^|[^0-9])${PHONE_DIGITS}(?![0-9])`,
  "gi"
);

/** Trả SĐT chuẩn 10 chữ số (bỏ dấu phân cách, +84 → 0) hoặc null. */
export function extractPhone(text: string): string | null {
  const m = text.match(PHONE_EXTRACT_RE);
  if (!m) return null;
  if (m[1]) return m[1].replace(/[. -]/g, "");
  if (m[2]) return "0" + m[2].replace(/[. -]/g, "");
  if (m[3]) return m[3].replace(/[. -]/g, "");
  return null;
}

/** Xóa SĐT khỏi văn bản (giữ lại ký tự ngay trước SĐT nếu có). */
export function stripPhones(text: string): string {
  return text.replace(PHONE_STRIP_RE, (_m, lead) =>
    lead ? `${lead} ` : " "
  );
}

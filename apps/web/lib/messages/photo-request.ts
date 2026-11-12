// Luật gửi ảnh của chủ shop (2026-11-10): khách cần/xin xem ảnh thì mới
// gửi thêm — đừng spam ảnh. Lượt ảnh ĐẦU TIÊN của hội thoại vẫn tự kèm
// (mở màn theo luật câu đầu: ảnh → câu trả lời → gợi chuyện); từ lượt thứ
// hai trở đi, chỉ gửi ảnh khi câu khách vừa nhắn thể hiện muốn xem ảnh.
// Số lượng vẫn giữ trần cứng: tối đa 2 ảnh/lượt, 2 lượt/hội thoại.
// Vá ảnh chi tiết (2026-11-12): trước đây bot chỉ gửi 2 ảnh ĐẦU (#1/#2),
// ảnh chi tiết #3–#9 chưa từng được gửi lần nào (0 lần). Từ nay map từ
// khóa khách hỏi -> đúng file ảnh chi tiết (đáy/quánh/nồi 18cm/chảo...),
// và lượt ảnh 2+ không từ khóa cụ thể thì gửi góc chụp mới (#3/#4).

function stripVnLower(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

const PHOTO_REQUEST_PATTERNS = [
  "xem anh",
  "gui anh",
  "cho xem",
  "anh that",
  "anh dau",
  "co anh khong",
  "co anh ko",
  "xem hinh",
  "gui hinh",
  "hinh anh",
  "co hinh khong",
  "xem hang",
  "cho coi",
  "xem coi",
  "chup anh",
  "xem bo noi",
  "xem san pham",
  "gui em anh",
  "gui minh anh",
  // Vá 12/11: các cách hỏi ảnh chi tiết trước đây bị bỏ sót.
  "chi tiet",
  "anh gan",
  "xem gan",
  "xem day",
  "chup gan",
  "xem can",
  "chup can",
  "bang kich thuoc",
  "can canh",
];

/** True when the customer's message asks to see product photos. */
export function customerAskedForPhotos(text: string | null | undefined): boolean {
  const plain = stripVnLower((text || "").trim());
  if (!plain) return false;
  return PHOTO_REQUEST_PATTERNS.some((p) => plain.includes(p));
}

// Ảnh chi tiết Engelberg (tên file chuẩn trên cả 3 Page):
// eb8013-5 = đáy khắc thương hiệu, eb8013-6 = quánh 16cm,
// eb8013-7 = nồi 18cm, eb8013-8/9 = ảnh toàn bộ,
// eb8013-3/4 = góc chụp khác (chưa từng gửi trước 12/11).
export interface DetailPhotoPick {
  files: string[]; // tên file cần ưu tiên, tối đa 2
  specific: boolean; // true = khách hỏi CỤ THỂ 1 chi tiết -> mở cổng gửi ảnh
}

/**
 * Chọn ảnh chi tiết theo câu khách vừa nhắn (vá 12/11).
 * - Khách hỏi cụ thể 1 chi tiết (đáy/quánh/nồi 18cm/chảo/cận cảnh/kích
 *   thước) -> đúng file ảnh đó, specific=true (ảnh là 1 phần câu trả lời).
 * - Lượt ảnh 2+ không từ khóa cụ thể -> góc chụp mới #3/#4 thay vì lặp #1/#2.
 * - Lượt đầu (mở màn) không từ khóa cụ thể -> null (giữ 2 ảnh đầu như cũ).
 * Cẩn thận dương tính giả sau khi bỏ dấu: "đáy"/"dày"/"đây" đều thành
 * "day", "chảo"/"chào" thành "chao", "quánh"/"quanh" thành "quanh",
 * "cận"/"cần" thành "can" — nên các từ này chỉ nhận qua cụm từ/có dấu.
 */
export function pickDetailPhotoFiles(
  text: string | null | undefined,
  imageRoundsSent: number
): DetailPhotoPick | null {
  const raw = (text || "").toLowerCase();
  const plain = stripVnLower((text || "").trim());
  if (!plain) return null;

  // So TU, khong substring: "anh" dang substring se nhan ca "quanh".
  const words = new Set(plain.split(/\s+/));
  const hasPhotoWord =
    words.has("anh") ||
    words.has("hinh") ||
    words.has("xem") ||
    words.has("chup") ||
    words.has("coi");

  const files: string[] = [];
  const add = (f: string) => {
    if (!files.includes(f) && files.length < 2) files.push(f);
  };

  // Đáy nồi (đáy khắc) — ảnh #5.
  if (
    raw.includes("đáy") ||
    raw.includes("dày") ||
    plain.includes("day noi") ||
    plain.includes("day 5 lop") ||
    plain.includes("day khac") ||
    plain.includes("day day")
  ) {
    add("eb8013-5");
  }
  // Quánh 16cm — ảnh #6.
  if (
    raw.includes("quánh") ||
    plain.includes("quanh 16") ||
    plain.includes("16cm") ||
    plain.includes("noi 16") ||
    (plain.includes("quanh") && hasPhotoWord)
  ) {
    add("eb8013-6");
  }
  // Nồi 18cm — ảnh #7.
  if (plain.includes("18cm") || plain.includes("noi 18")) {
    add("eb8013-7");
  }
  // Chảo chống dính 24cm — chỉ có trong ảnh toàn bộ #8/#9.
  if (
    raw.includes("chảo") ||
    plain.includes("chao chong dinh") ||
    plain.includes("chao 24") ||
    plain.includes("24cm")
  ) {
    add("eb8013-8");
    add("eb8013-9");
  }
  // Hỏi chi tiết / cận cảnh / kích thước — cặp ảnh chi tiết #5 + #7.
  if (
    plain.includes("chi tiet") ||
    raw.includes("ảnh cận") ||
    plain.includes("anh gan") ||
    plain.includes("xem gan") ||
    plain.includes("can canh") ||
    plain.includes("chup gan") ||
    plain.includes("xem can") ||
    plain.includes("chup can") ||
    plain.includes("bang kich thuoc") ||
    plain.includes("kich thuoc")
  ) {
    add("eb8013-5");
    add("eb8013-7");
  }

  if (files.length > 0) return { files, specific: true };

  // Không hỏi cụ thể: lượt 2+ gửi góc chụp mới (#3/#4) thay vì lặp #1/#2.
  if (imageRoundsSent >= 1 && customerAskedForPhotos(text)) {
    return { files: ["eb8013-3", "eb8013-4"], specific: false };
  }
  return null;
}

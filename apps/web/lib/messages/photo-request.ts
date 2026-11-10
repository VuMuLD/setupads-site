// Luật gửi ảnh của chủ shop (2026-11-10): khách cần/xin xem ảnh thì mới
// gửi thêm — đừng spam ảnh. Lượt ảnh ĐẦU TIÊN của hội thoại vẫn tự kèm
// (mở màn theo luật câu đầu: ảnh → câu trả lời → gợi chuyện); từ lượt thứ
// hai trở đi, chỉ gửi ảnh khi câu khách vừa nhắn thể hiện muốn xem ảnh.
// Số lượng vẫn giữ trần cứng: tối đa 2 ảnh/lượt, 2 lượt/hội thoại.

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
];

/** True when the customer's message asks to see product photos. */
export function customerAskedForPhotos(text: string | null | undefined): boolean {
  const plain = stripVnLower((text || "").trim());
  if (!plain) return false;
  return PHOTO_REQUEST_PATTERNS.some((p) => plain.includes(p));
}

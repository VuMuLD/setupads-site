/** Chuẩn hóa xuống dòng Messenger — dễ đọc, không quá nhiều dòng trống */
export function formatMessengerText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Thay placeholder trong mẫu tin */
export function personalizeTemplate(
  text: string,
  vars: { name?: string | null; pageName?: string }
): string {
  const greeting = vars.name?.trim() ? `anh/chị ${vars.name.trim()}` : "anh/chị";
  return formatMessengerText(
    text
      .replace(/\{name\}/gi, greeting)
      .replace(/\{ten\}/gi, greeting)
      .replace(/\{pageName\}/gi, vars.pageName || "shop")
      .replace(/\{shop\}/gi, vars.pageName || "shop")
  );
}

export const DEFAULT_OLD_CUSTOMER_TEMPLATES = [
  {
    name: "Tri ân khách cũ — chương trình ưu đãi",
    category: "old_customer",
    text: `Dạ em chào {name} ạ!

Em là {pageName}, nhớ anh/chị đã tin tưởng mua hàng bên em lần trước.

Hiện shop có chương trình dành riêng cho khách cũ:
• Ưu đãi khi đặt lại
• Freeship đơn từ 300k
• Tư vấn size/màu miễn phí

Anh/chị còn quan tâm sản phẩm nào không ạ?
Em sẵn sàng tư vấn thêm cho mình nhé!`,
  },
  {
    name: "Nhắc lại — sản phẩm mới về",
    category: "old_customer",
    text: `Chào {name}!

{pageName} vừa về thêm hàng mới, em nghĩ mẫu này hợp gu anh/chị.

Nếu anh/chị cần xem ảnh hoặc báo giá, nhắn em nhé — em tư vấn ngay ạ!

Cảm ơn anh/chị đã ủng hộ shop trước đây.`,
  },
  {
    name: "Hỏi thăm — mời đặt lại",
    category: "old_customer",
    text: `Dạ em chào {name}!

Em hỏi thăm anh/chị — lần trước mua bên {pageName} anh/chị còn hài lòng không ạ?

Shop đang có ưu đãi cho khách quen. Anh/chị cần đặt thêm gì cứ nhắn em, em hỗ trợ nhanh nhé!`,
  },
] as const;

export function parseImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((u): u is string => typeof u === "string" && u.length > 0);
}

export function parseProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((u): u is string => typeof u === "string" && u.length > 0);
}

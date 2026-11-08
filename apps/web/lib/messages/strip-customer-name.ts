// Luật xưng hô của chủ shop (2026-11-08): bot TUYỆT ĐỐI không chèn tên
// khách vào câu trả lời — chỉ gọi anh/chị. Prompt đã cấm nhưng AI vẫn
// thỉnh thoảng lọt tên (thường ở câu mở đầu đồng cảm). Guard tất định này
// gọt tên khách khỏi câu AI soạn TRƯỚC khi gửi.
//
// CHỈ áp dụng cho tin AI soạn (auto-reply / chăm sóc / mời lại) thông qua
// cờ `stripCustomerName` trong sendConversationReply. Phiếu xác nhận đơn
// (có dòng "Tên: ...") và tin do nhân viên soạn KHÔNG đi qua guard này.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove the customer's name from an AI-composed reply.
 * - Removes the full name (case-insensitive, whole-phrase match).
 * - Removes "anh/chị/em + <last name token>" (e.g. "chị Hằng" -> "chị");
 *   the token match is case-sensitive so ordinary words like "hằng ngày"
 *   are never touched.
 * - Tidies leftover double spaces / dangling vocatives.
 * - If stripping would empty the text, returns the original text.
 */
export function stripCustomerName(
  text: string,
  participantName: string | null | undefined
): string {
  const raw = (text || "").trim();
  const name = (participantName || "").trim().replace(/\s+/g, " ");
  if (!raw || !name || name.length < 2) return raw;

  let out = raw;

  // 1) Full name, case-insensitive, not glued to other letters/digits.
  const fullNameRe = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
    "giu"
  );
  out = out.replace(fullNameRe, "");

  // 2) Title + last token, e.g. "chị Hằng" -> "chị". Case-sensitive token.
  const tokens = name.split(" ");
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (last.length >= 3) {
      const titleRe = new RegExp(
        `\\b(anh|chị|em)(\\s+)${escapeRegExp(last)}(?![\\p{L}\\p{N}])`,
        "gu"
      );
      out = out.replace(titleRe, "$1");
    }
  }

  // 3) Tidy each line: collapse spaces, drop space before punctuation,
  //    drop a dangling leading "ơi" left by a removed leading name.
  const lines = out
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.;:!?…])/g, "$1")
        .replace(/^\s*ơi\s*[,!.]\s*/i, "")
        .trim()
    )
    .filter((line) => line.length > 0 && line.toLowerCase() !== "ơi");

  const cleaned = lines.join("\n").trim();
  return cleaned || raw;
}

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
 * - Removes "anh/chị/em + <any name token>" (e.g. "chị Hằng" -> "chị",
 *   "anh Hong" -> "anh"); the token match is case-sensitive so ordinary
 *   words like "hằng ngày" are never touched. (Originally only the LAST
 *   token was stripped; the AI also addresses customers by the FIRST
 *   token — "anh Hong ơi" leaked on 2026-11-10.)
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

  // 2) Title + ANY name token, e.g. "chị Hằng" -> "chị", "anh Hong" ->
  //    "anh". Case-sensitive token match (see header note).
  const tokens = name.split(" ");
  if (tokens.length >= 2) {
    for (const token of Array.from(new Set(tokens))) {
      if (token.length < 3) continue;
      const titleRe = new RegExp(
        `\\b(anh|chị|em|Anh|Chị|Em)(\\s+)${escapeRegExp(token)}(?![\\p{L}\\p{N}])`,
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

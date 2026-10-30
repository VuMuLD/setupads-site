import {
  detectCustomerClosingIntent,
  detectCustomerPurchaseCommitment,
  type FlowMessage,
} from "@/lib/messages/purchase-detection";

export type StatusMessage = FlowMessage & {
  aiSuggestedReply?: string | null;
};

export type ConversationLabel =
  | "unread"
  | "consulting"
  | "closing"
  | "follow_up"
  | "purchased"
  | "lost"
  | "vip";

export type ManualConversationLabel = Exclude<ConversationLabel, "unread">;

export const MANUAL_LABEL_OPTIONS: Array<{
  id: ManualConversationLabel;
  text: string;
  className: string;
  hint: string;
}> = [
  {
    id: "consulting",
    text: "Tư vấn",
    className: "bg-amber-100 text-amber-800 border border-amber-200",
    hint: "Đang hỏi / chưa chốt",
  },
  {
    id: "closing",
    text: "Sắp chốt",
    className: "bg-orange-100 text-orange-800 border border-orange-200",
    hint: "Khách có ý mua, chưa gửi đủ thông tin",
  },
  {
    id: "follow_up",
    text: "Cần theo dõi",
    className: "bg-sky-100 text-sky-800 border border-sky-200",
    hint: "Cần nhắc lại sau",
  },
  {
    id: "purchased",
    text: "Đã mua",
    className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    hint: "Khách đã gửi thông tin chốt đơn",
  },
  {
    id: "lost",
    text: "Không mua",
    className: "bg-slate-200 text-slate-700 border border-slate-300",
    hint: "Khách từ chối / không tiềm năng",
  },
  {
    id: "vip",
    text: "VIP",
    className: "bg-violet-100 text-violet-800 border border-violet-200",
    hint: "Khách quen / ưu tiên",
  },
];

const STATUS_LABELS: ManualConversationLabel[] = [
  "consulting",
  "closing",
  "follow_up",
  "purchased",
  "lost",
];

const CONSULT_PATTERN =
  /tư\s*vấn|báo\s*giá|giá\s*bao\s*nhiêu|còn\s*hàng|ship\s*không|giao\s*hàng\s*không|size\s*gì|màu\s*gì|chi\s*tiết|thông\s*tin\s*sản\s*phẩm/i;

function parseManualLabels(raw: unknown): ManualConversationLabel[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(MANUAL_LABEL_OPTIONS.map((o) => o.id));
  return raw.filter((v): v is ManualConversationLabel => typeof v === "string" && allowed.has(v as ManualConversationLabel));
}

function inferAutoStatusLabels(input: {
  unreadCount: number;
  messages: StatusMessage[];
}): ManualConversationLabel[] {
  const { unreadCount, messages } = input;
  const labels: ManualConversationLabel[] = [];

  if (detectCustomerPurchaseCommitment(messages)) {
    labels.push("purchased");
    return labels;
  }

  if (detectCustomerClosingIntent(messages)) {
    labels.push("closing");
    return labels;
  }

  const allText = messages.map((m) => m.text).join(" ");
  const lastInbound = [...messages].reverse().find((m) => m.direction === "INBOUND");
  const lastOutbound = [...messages].reverse().find((m) => m.direction === "OUTBOUND");

  const pendingReply =
    lastInbound &&
    (!lastOutbound ||
      (lastInbound.sentAt &&
        lastOutbound.sentAt &&
        new Date(lastInbound.sentAt) > new Date(lastOutbound.sentAt)));

  const hasConsultIntent = CONSULT_PATTERN.test(allText);
  const hasAiSuggestion = messages.some((m) => m.direction === "INBOUND" && m.aiSuggestedReply);
  const needsAi = messages.some((m) => m.direction === "INBOUND" && !m.aiSuggestedReply);

  const inboundCount = messages.filter((m) => m.direction === "INBOUND").length;
  const outboundCount = messages.filter((m) => m.direction === "OUTBOUND").length;

  if (
    unreadCount > 0 ||
    pendingReply ||
    hasConsultIntent ||
    hasAiSuggestion ||
    needsAi
  ) {
    labels.push("consulting");
  }

  if (outboundCount >= 2 && inboundCount <= outboundCount && !pendingReply && !unreadCount) {
    labels.push("follow_up");
  }

  return labels;
}

/** Gộp thẻ tự động + thẻ thủ công (thủ công ưu tiên cho trạng thái chính) */
export function resolveConversationLabels(input: {
  unreadCount: number;
  messages: StatusMessage[];
  manualLabels?: unknown;
}): ConversationLabel[] {
  const manual = parseManualLabels(input.manualLabels);
  const autoStatus = inferAutoStatusLabels(input);
  const labels: ConversationLabel[] = [];

  if (input.unreadCount > 0) {
    labels.push("unread");
  }

  const manualStatus = manual.filter((l) => STATUS_LABELS.includes(l));
  const manualVip = manual.includes("vip");

  if (manualStatus.includes("purchased")) {
    labels.push("purchased");
  } else if (manualStatus.includes("lost")) {
    labels.push("lost");
  } else if (manualStatus.length > 0) {
    for (const tag of manualStatus) {
      if (tag !== "vip") labels.push(tag);
    }
  } else if (autoStatus.includes("purchased")) {
    labels.push("purchased");
  } else if (autoStatus.includes("closing")) {
    labels.push("closing");
  } else {
    for (const tag of autoStatus) {
      labels.push(tag);
    }
  }

  if (manualVip && !labels.includes("vip")) {
    labels.push("vip");
  }

  return Array.from(new Set(labels));
}

/** @deprecated Dùng resolveConversationLabels — giữ tương thích */
export function inferConversationLabels(input: {
  unreadCount: number;
  messages: StatusMessage[];
  manualLabels?: unknown;
}): ConversationLabel[] {
  return resolveConversationLabels(input);
}

export function labelMeta(label: ConversationLabel): {
  text: string;
  className: string;
} {
  if (label === "unread") {
    return { text: "Chưa đọc", className: "bg-red-500 text-white" };
  }
  const found = MANUAL_LABEL_OPTIONS.find((o) => o.id === label);
  if (found) return { text: found.text, className: found.className };
  return { text: label, className: "bg-muted text-muted-foreground" };
}

export function getManualLabelsFromDb(raw: unknown): ManualConversationLabel[] {
  return parseManualLabels(raw);
}

export function toggleManualLabel(
  current: ManualConversationLabel[],
  label: ManualConversationLabel
): ManualConversationLabel[] {
  const statusExclusive: ManualConversationLabel[] = [
    "consulting",
    "closing",
    "follow_up",
    "purchased",
    "lost",
  ];

  if (label === "vip") {
    return current.includes("vip")
      ? current.filter((l) => l !== "vip")
      : [...current, "vip"];
  }

  if (current.includes(label)) {
    return current.filter((l) => l !== label);
  }

  const withoutStatus = current.filter((l) => !statusExclusive.includes(l));
  return [...withoutStatus, label];
}

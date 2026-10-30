import { prisma } from "@/lib/prisma";
import { inferConversationLabels } from "@/lib/messages/conversation-status";

export type BroadcastAudience = "purchased" | "consulting" | "all";
export type BroadcastSendMode = "within24h" | "all";

export interface AudienceMember {
  id: string;
  participantName: string | null;
  participantFbId: string;
  lastInboundAt: Date | null;
  within24h: boolean;
  labels: string[];
}

const HOURS_24_MS = 24 * 60 * 60 * 1000;

async function loadLastInboundMap(
  conversationIds: string[]
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (conversationIds.length === 0) return map;

  const rows = await prisma.pageMessage.groupBy({
    by: ["conversationId"],
    where: {
      conversationId: { in: conversationIds },
      direction: "INBOUND",
    },
    _max: { sentAt: true },
  });

  for (const row of rows) {
    if (row._max.sentAt) {
      map.set(row.conversationId, row._max.sentAt);
    }
  }
  return map;
}

export async function getAudienceMembers(
  pageId: string,
  audience: BroadcastAudience
): Promise<AudienceMember[]> {
  const conversations = await prisma.pageConversation.findMany({
    where: { pageId, participantFbId: { not: null } },
    include: {
      messages: {
        orderBy: { sentAt: "desc" },
        take: 15,
        select: { direction: true, text: true, aiSuggestedReply: true, sentAt: true },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const matched: Array<{
    id: string;
    participantName: string | null;
    participantFbId: string;
    unreadCount: number;
    messages: typeof conversations[0]["messages"];
  }> = [];

  for (const c of conversations) {
    if (!c.participantFbId) continue;

    const labels = inferConversationLabels({
      unreadCount: c.unreadCount,
      messages: c.messages.map((m) => ({
        direction: m.direction as "INBOUND" | "OUTBOUND",
        text: m.text,
        aiSuggestedReply: m.aiSuggestedReply,
        sentAt: m.sentAt,
      })),
    });

    const match =
      audience === "all"
        ? true
        : audience === "purchased"
          ? labels.includes("purchased")
          : (labels.includes("consulting") ||
              labels.includes("closing") ||
              labels.includes("follow_up")) &&
            !labels.includes("purchased") &&
            !labels.includes("lost");

    if (!match && audience === "purchased" && c.participantFbId) {
      // Ưu tiên hồ sơ khách có đơn trong database
      const dbCustomer = await prisma.pageCustomer.findUnique({
        where: {
          pageId_participantFbId: { pageId, participantFbId: c.participantFbId },
        },
        select: { totalOrders: true },
      });
      if (dbCustomer && dbCustomer.totalOrders > 0) {
        matched.push({
          id: c.id,
          participantName: c.participantName,
          participantFbId: c.participantFbId,
          unreadCount: c.unreadCount,
          messages: c.messages,
        });
      }
      continue;
    }

    if (!match) continue;

    matched.push({
      id: c.id,
      participantName: c.participantName,
      participantFbId: c.participantFbId,
      unreadCount: c.unreadCount,
      messages: c.messages,
    });
  }

  const lastInboundMap = await loadLastInboundMap(matched.map((m) => m.id));
  const now = Date.now();

  return matched.map((c) => {
    const lastInboundAt = lastInboundMap.get(c.id) ?? null;
    const within24h = lastInboundAt
      ? now - lastInboundAt.getTime() < HOURS_24_MS
      : false;

    const labels = inferConversationLabels({
      unreadCount: c.unreadCount,
      messages: c.messages.map((m) => ({
        direction: m.direction as "INBOUND" | "OUTBOUND",
        text: m.text,
        aiSuggestedReply: m.aiSuggestedReply,
        sentAt: m.sentAt,
      })),
    });

    return {
      id: c.id,
      participantName: c.participantName,
      participantFbId: c.participantFbId,
      lastInboundAt,
      within24h,
      labels,
    };
  });
}

/** Chiến lược gửi theo từng khách — dùng khi sendMode = all */
export function getBroadcastSendStrategy(member: AudienceMember): {
  messagingType: "RESPONSE" | "MESSAGE_TAG";
  tag?: "POST_PURCHASE_UPDATE";
} {
  if (member.within24h) {
    return { messagingType: "RESPONSE" };
  }
  if (member.labels.includes("purchased")) {
    return { messagingType: "MESSAGE_TAG", tag: "POST_PURCHASE_UPDATE" };
  }
  return { messagingType: "RESPONSE" };
}

export function estimateReachableCount(
  members: AudienceMember[],
  sendMode: BroadcastSendMode
): number {
  if (sendMode === "all") return members.length;
  return members.filter((m) => m.within24h).length;
}

export function estimateTagReachableCount(members: AudienceMember[]): number {
  return members.filter((m) => !m.within24h && m.labels.includes("purchased")).length;
}

/** Chỉ khách trong cửa sổ 24h — Facebook mới cho gửi tin tự do */
export async function getReachableMembers(
  pageId: string,
  audience: BroadcastAudience
): Promise<AudienceMember[]> {
  const all = await getAudienceMembers(pageId, audience);
  return all.filter((m) => m.within24h);
}

export async function countAudience(
  pageId: string,
  audience: BroadcastAudience,
  sendMode: BroadcastSendMode = "within24h"
): Promise<{
  total: number;
  within24h: number;
  outside24h: number;
  tagReachable: number;
  reachable: number;
  sendMode: BroadcastSendMode;
}> {
  const members = await getAudienceMembers(pageId, audience);
  const within24h = members.filter((m) => m.within24h).length;
  const tagReachable = estimateTagReachableCount(members);
  return {
    total: members.length,
    within24h,
    outside24h: members.length - within24h,
    tagReachable,
    reachable: estimateReachableCount(members, sendMode),
    sendMode,
  };
}

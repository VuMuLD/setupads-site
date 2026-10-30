import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getSelectedPage } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveConversationLabels } from "@/lib/messages/conversation-status";

const DEFAULT_LIMIT = 20;

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const pageIdParam = request.nextUrl.searchParams.get("pageId");
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    50
  );
  const cursor = request.nextUrl.searchParams.get("cursor");
  const filter = request.nextUrl.searchParams.get("filter");

  let pageId = pageIdParam;

  if (!pageId) {
    const page = await getSelectedPage(session!.user.id);
    if (!page) {
      return NextResponse.json({ error: "Chưa chọn Page" }, { status: 400 });
    }
    pageId = page.id;
  }

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      facebookAccount: { userId: session!.user.id },
    },
  });

  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const conversations = await prisma.pageConversation.findMany({
    where: { pageId: page.id },
    orderBy: { lastMessageAt: "desc" },
    take: limit + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    include: {
      messages: {
        orderBy: { sentAt: "desc" },
        take: 10,
        select: {
          id: true,
          text: true,
          direction: true,
          aiSuggestedReply: true,
          sentAt: true,
        },
      },
    },
  });

  const hasMore = conversations.length > limit;
  const items = hasMore ? conversations.slice(0, limit) : conversations;

  const mapped = items.map((c) => {
    const labels = resolveConversationLabels({
      unreadCount: c.unreadCount,
      messages: c.messages.map((m) => ({
        direction: m.direction,
        text: m.text,
        aiSuggestedReply: m.aiSuggestedReply,
        sentAt: m.sentAt,
      })),
      manualLabels: c.manualLabels,
    });

    return {
      id: c.id,
      participantName: c.participantName,
      snippet: c.snippet,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      lastMessage: c.messages[0] || null,
      labels,
    };
  });

  const filtered =
    filter === "unread"
      ? mapped.filter((c) => c.labels.includes("unread"))
      : filter === "consulting"
        ? mapped.filter(
            (c) =>
              (c.labels.includes("consulting") || c.labels.includes("follow_up")) &&
              !c.labels.includes("purchased")
          )
        : filter === "closing"
          ? mapped.filter((c) => c.labels.includes("closing"))
          : filter === "purchased"
            ? mapped.filter((c) => c.labels.includes("purchased"))
            : mapped;

  const [totalConversations, totalMessages] = await Promise.all([
    prisma.pageConversation.count({ where: { pageId: page.id } }),
    prisma.pageMessage.count({
      where: { conversation: { pageId: page.id } },
    }),
  ]);

  return NextResponse.json({
    page: { id: page.id, name: page.name, autoAiEnabled: page.autoAiEnabled },
    conversations: filtered,
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
    hasMore,
    totalConversations,
    totalMessages,
    loadedCount: filtered.length,
  });
}

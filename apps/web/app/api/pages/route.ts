import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getUserPages } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/security/rate-limit";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const pages = await getUserPages(session!.user.id);

  const enriched = await Promise.all(
    pages.map(async (p) => {
      const unread = await prisma.pageConversation.aggregate({
        where: { pageId: p.id },
        _sum: { unreadCount: true },
      });
      const pendingAi = await prisma.pageMessage.count({
        where: {
          direction: "INBOUND",
          aiSuggestedReply: null,
          conversation: { pageId: p.id },
        },
      });
      return {
        id: p.id,
        fbPageId: p.fbPageId,
        name: p.name,
        category: p.category,
        isSelected: p.isSelected,
        autoAiEnabled: p.autoAiEnabled,
        aiTone: p.aiTone,
        lastMessageSyncAt: p.lastMessageSyncAt,
        conversationCount: p._count.conversations,
        productCount: p._count.products,
        unreadCount: unread._sum.unreadCount || 0,
        pendingAi,
      };
    })
  );

  return NextResponse.json({ pages: enriched });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rateLimitError = rateLimit(request, session!.user.id);
  if (rateLimitError) return rateLimitError;

  const body = await request.json();
  const { pageId, action, autoAiEnabled, aiTone } = body;

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      isActive: true,
      facebookAccount: { userId: session!.user.id },
    },
    include: { facebookAccount: true },
  });

  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  if (action === "select") {
    await prisma.page.updateMany({
      where: { facebookAccountId: page.facebookAccountId },
      data: { isSelected: false },
    });
    await prisma.page.update({
      where: { id: pageId },
      data: { isSelected: true },
    });
    return NextResponse.json({ success: true });
  }

  if (action === "toggleAutoAi") {
    const updated = await prisma.page.update({
      where: { id: pageId },
      data: {
        autoAiEnabled: typeof autoAiEnabled === "boolean" ? autoAiEnabled : !page.autoAiEnabled,
        ...(aiTone ? { aiTone } : {}),
      },
    });
    return NextResponse.json({ success: true, page: updated });
  }

  if (action === "updateTone" && aiTone) {
    await prisma.page.update({
      where: { id: pageId },
      data: { aiTone },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Action không hợp lệ" }, { status: 400 });
}

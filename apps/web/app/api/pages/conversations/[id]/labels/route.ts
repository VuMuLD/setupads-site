import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  getManualLabelsFromDb,
  toggleManualLabel,
  resolveConversationLabels,
  type ManualConversationLabel,
} from "@/lib/messages/conversation-status";
import { learnFromConversation } from "@/lib/ai/customer-learning";
import { captureOrderFromConversation } from "@/lib/messages/orders";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const conversation = await prisma.pageConversation.findFirst({
    where: {
      id,
      page: { facebookAccount: { userId: session!.user.id } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Hội thoại không tồn tại" }, { status: 404 });
  }

  let manualLabels = getManualLabelsFromDb(conversation.manualLabels);

  if (Array.isArray(body.manualLabels)) {
    manualLabels = getManualLabelsFromDb(body.manualLabels);
  } else if (typeof body.toggle === "string") {
    manualLabels = toggleManualLabel(
      manualLabels,
      body.toggle as ManualConversationLabel
    );
  } else if (body.clear === true) {
    manualLabels = [];
  } else {
    return NextResponse.json(
      { error: "Gửi toggle, manualLabels hoặc clear" },
      { status: 400 }
    );
  }

  const updated = await prisma.pageConversation.update({
    where: { id: conversation.id },
    data: { manualLabels },
  });

  const statusMessages = await prisma.pageMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { sentAt: "desc" },
    take: 15,
    select: {
      direction: true,
      text: true,
      aiSuggestedReply: true,
      sentAt: true,
    },
  });

  const labels = resolveConversationLabels({
    unreadCount: updated.unreadCount,
    messages: statusMessages,
    manualLabels: updated.manualLabels,
  });

  if (
    typeof body.toggle === "string" &&
    body.toggle === "purchased" &&
    manualLabels.includes("purchased")
  ) {
    void captureOrderFromConversation(conversation.id, session!.user.id, {
      force: true,
    });
    void learnFromConversation(conversation.id, { force: true });
  }

  return NextResponse.json({
    success: true,
    manualLabels: getManualLabelsFromDb(updated.manualLabels),
    labels,
  });
}

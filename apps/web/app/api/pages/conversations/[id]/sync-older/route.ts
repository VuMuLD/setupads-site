import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { syncPageMessages } from "@/lib/jobs/sync-page-messages";
import { formatMessagingError } from "@/lib/facebook/messaging-access";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;

  const conversation = await prisma.pageConversation.findFirst({
    where: {
      id,
      page: { facebookAccount: { userId: session!.user.id } },
    },
    select: { id: true, pageId: true },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Hội thoại không tồn tại" }, { status: 404 });
  }

  try {
    const result = await syncPageMessages(conversation.pageId, session!.user.id, {
      conversationId: conversation.id,
      messageLimit: 20,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    const message = formatMessagingError(err);
    const status = message.includes("pages_messaging") ? 403 : 500;
    return NextResponse.json({ error: message, code: "MESSAGING_PERMISSION" }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  syncPageMessages,
  syncPageMessagesFull,
  syncAllPagesForUser,
  SYNC_RECENT_CONVERSATIONS,
  SYNC_RECENT_MESSAGES_PER_CONV,
} from "@/lib/jobs/sync-page-messages";
import { formatMessagingError } from "@/lib/facebook/messaging-access";

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let pageId: string | undefined;
  let scope = "selected";
  let syncMode: "recent" | "full" | "more" = "recent";
  let conversationsAfter: string | undefined;

  try {
    const body = await request.json().catch(() => ({}));
    pageId = body.pageId;
    if (body.scope === "all") scope = "all";
    if (body.syncMode === "full") syncMode = "full";
    if (body.syncMode === "more") syncMode = "more";
    conversationsAfter = body.conversationsAfter;
  } catch {
    // defaults
  }

  try {
    if (scope === "all") {
      const result = await syncAllPagesForUser(session!.user.id);
      return NextResponse.json({ success: true, scope: "all", ...result });
    }

    if (!pageId) {
      const { getSelectedPage } = await import("@/lib/auth");
      const page = await getSelectedPage(session!.user.id);
      if (!page) {
        return NextResponse.json(
          { error: "Chưa chọn Page. Vào Cài đặt hoặc Tin nhắn." },
          { status: 400 }
        );
      }
      pageId = page.id;
    }

    if (syncMode === "full") {
      const result = await syncPageMessagesFull(pageId, session!.user.id);
      return NextResponse.json({
        success: true,
        ...result,
        scope: "full",
        pageId,
      });
    }

    const result = await syncPageMessages(pageId, session!.user.id, {
      conversationLimit: SYNC_RECENT_CONVERSATIONS,
      messageLimit: SYNC_RECENT_MESSAGES_PER_CONV,
      conversationsAfter: syncMode === "more" ? conversationsAfter : undefined,
    });

    return NextResponse.json({
      success: true,
      ...result,
      scope: syncMode === "more" ? "more" : "recent",
      pageId,
      syncMode: syncMode === "more" ? "more" : "recent",
    });
  } catch (err) {
    const message = formatMessagingError(err);
    const status = message.includes("pages_messaging") ? 403 : 500;
    return NextResponse.json({ error: message, code: "MESSAGING_PERMISSION" }, { status });
  }
}

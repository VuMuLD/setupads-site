import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getBroadcastStatus } from "@/lib/messages/broadcast";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; broadcastId: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId, broadcastId } = await params;

  const status = await getBroadcastStatus(broadcastId, session!.user.id);
  if (!status || status.pageId !== pageId) {
    return NextResponse.json({ error: "Không tìm thấy tiến trình gửi" }, { status: 404 });
  }

  return NextResponse.json(status);
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { countAudience, type BroadcastAudience } from "@/lib/messages/old-customers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const audience = (request.nextUrl.searchParams.get("audience") ||
    "purchased") as BroadcastAudience;
  const sendMode = (request.nextUrl.searchParams.get("sendMode") ||
    "all") as "within24h" | "all";

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId: session!.user.id } },
  });
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const counts = await countAudience(pageId, audience, sendMode);

  const policyNote =
    sendMode === "all"
      ? counts.tagReachable > 0
        ? `Sẽ thử gửi tất cả ${counts.total} khách. Khách đã mua ngoài 24h (${counts.tagReachable}) dùng tag POST_PURCHASE — Facebook cho phép nhắc lại khách cũ. Khách tư vấn ngoài 24h có thể bị từ chối.`
        : `Sẽ thử gửi tất cả ${counts.total} khách. Khách ngoài 24h có thể bị Facebook từ chối nếu chưa nhắn lại Page.`
      : "Chỉ gửi khách nhắn Page trong 24 giờ qua. Bật 'Gửi tất cả khách' để thử gửi cả khách cũ.";

  return NextResponse.json({
    audience,
    ...counts,
    pageName: page.name,
    policyNote,
  });
}

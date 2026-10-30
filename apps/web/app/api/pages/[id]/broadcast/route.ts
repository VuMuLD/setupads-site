import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  startBroadcast,
  resolveTemplateImages,
} from "@/lib/messages/broadcast";
import {
  parseImageUrls,
  parseProductIds,
} from "@/lib/messages/message-templates";
import { resolveCustomerPhotoUrls } from "@/lib/messages/send-page-reply";
import type { BroadcastAudience } from "@/lib/messages/old-customers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const body = await request.json();

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId: session!.user.id } },
  });
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const audience = (body.audience || "purchased") as BroadcastAudience;
  const sendMode = (body.sendMode === "within24h" ? "within24h" : "all") as
    | "within24h"
    | "all";
  let text = String(body.text || "").trim();
  let templateId: string | undefined = body.templateId;
  let imageUrls: string[] = parseImageUrls(body.imageUrls);
  const productIds: string[] = parseProductIds(body.productIds);
  const customerPhotoIds: string[] = parseProductIds(body.customerPhotoIds);

  if (body.templateId && !text) {
    const template = await prisma.pageMessageTemplate.findFirst({
      where: { id: body.templateId, pageId },
    });
    if (!template) {
      return NextResponse.json({ error: "Mẫu tin không tồn tại" }, { status: 404 });
    }
    text = template.text;
    templateId = template.id;
    imageUrls = await resolveTemplateImages(
      pageId,
      parseProductIds(template.productIds),
      parseImageUrls(template.imageUrls)
    );
  }

  if (productIds.length > 0) {
    imageUrls = await resolveTemplateImages(pageId, productIds, imageUrls);
  }
  if (customerPhotoIds.length > 0) {
    const fromPhotos = await resolveCustomerPhotoUrls(pageId, customerPhotoIds);
    imageUrls = Array.from(new Set([...imageUrls, ...fromPhotos]));
  }

  if (!text) {
    return NextResponse.json({ error: "Nội dung tin nhắn trống" }, { status: 400 });
  }

  try {
    const result = await startBroadcast({
      pageId,
      userId: session!.user.id,
      audience,
      text,
      imageUrls: imageUrls.slice(0, 10),
      templateId,
      sendMode,
    });

    return NextResponse.json({
      success: true,
      broadcastId: result.broadcastId,
      total: result.total,
      reachable: result.reachable,
      skippedOutside24h: result.skippedOutside24h,
      pageName: result.pageName,
      pageId: result.pageId,
      status: "running",
    });
  } catch (err) {
    console.error("[broadcast POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gửi hàng loạt thất bại" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "10", 10), 20);

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId: session!.user.id } },
  });
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const broadcasts = await prisma.pageBroadcast.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { template: { select: { name: true } } },
  });

  return NextResponse.json({ broadcasts });
}

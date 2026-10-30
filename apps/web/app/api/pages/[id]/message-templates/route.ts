import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  parseImageUrls,
  parseProductIds,
} from "@/lib/messages/message-templates";
import { ensureDefaultTemplates } from "@/lib/messages/broadcast";
import { getUploadedFiles, isUploadedFile } from "@/lib/uploads/form-data-file";
import { saveMultipleUploads } from "@/lib/uploads/page-uploads";

async function getPage(pageId: string, userId: string) {
  return prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId } },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const page = await getPage(pageId, session!.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  await ensureDefaultTemplates(pageId);

  const templates = await prisma.pageMessageTemplate.findMany({
    where: { pageId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    templates: templates.map((t) => ({
      ...t,
      imageUrls: parseImageUrls(t.imageUrls),
      productIds: parseProductIds(t.productIds),
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const page = await getPage(pageId, session!.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const name = String(form.get("name") || "").trim();
      const text = String(form.get("text") || "").trim();
      if (!name || !text) {
        return NextResponse.json({ error: "Tên và nội dung bắt buộc" }, { status: 400 });
      }

      const files = getUploadedFiles(form, "images");
      const single = form.get("image");
      if (isUploadedFile(single)) files.push(single);
      const uploaded =
        files.length > 0
          ? await saveMultipleUploads(pageId, "products", files)
          : [];

      const productIds = String(form.get("productIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const template = await prisma.pageMessageTemplate.create({
        data: {
          pageId,
          name,
          text,
          category: String(form.get("category") || "old_customer"),
          imageUrls: uploaded.length > 0 ? uploaded : undefined,
          productIds: productIds.length > 0 ? productIds : undefined,
        },
      });

      return NextResponse.json({ template }, { status: 201 });
    }

    const body = await request.json();
    const { name, text, category, imageUrls, productIds } = body;
    if (!name?.trim() || !text?.trim()) {
      return NextResponse.json({ error: "Tên và nội dung bắt buộc" }, { status: 400 });
    }

    const template = await prisma.pageMessageTemplate.create({
      data: {
        pageId,
        name: name.trim(),
        text: text.trim(),
        category: category || "old_customer",
        imageUrls: parseImageUrls(imageUrls),
        productIds: parseProductIds(productIds),
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    console.error("[message-templates POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể tạo mẫu" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const page = await getPage(pageId, session!.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const body = await request.json();
  const { templateId, name, text, category, imageUrls, productIds, isActive } = body;
  if (!templateId) {
    return NextResponse.json({ error: "Thiếu templateId" }, { status: 400 });
  }

  const existing = await prisma.pageMessageTemplate.findFirst({
    where: { id: templateId, pageId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Mẫu không tồn tại" }, { status: 404 });
  }

  const updated = await prisma.pageMessageTemplate.update({
    where: { id: templateId },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(text !== undefined && { text: String(text).trim() }),
      ...(category !== undefined && { category }),
      ...(imageUrls !== undefined && { imageUrls: parseImageUrls(imageUrls) }),
      ...(productIds !== undefined && { productIds: parseProductIds(productIds) }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  return NextResponse.json({ template: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const templateId = request.nextUrl.searchParams.get("templateId");
  if (!templateId) {
    return NextResponse.json({ error: "Thiếu templateId" }, { status: 400 });
  }

  const existing = await prisma.pageMessageTemplate.findFirst({
    where: {
      id: templateId,
      pageId,
      page: { facebookAccount: { userId: session!.user.id } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Mẫu không tồn tại" }, { status: 404 });
  }

  await prisma.pageMessageTemplate.delete({ where: { id: templateId } });
  return NextResponse.json({ success: true });
}

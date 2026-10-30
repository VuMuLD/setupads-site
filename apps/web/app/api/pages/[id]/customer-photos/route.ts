import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { savePageUpload, normalizeUploadUrl } from "@/lib/uploads/page-uploads";
import { isUploadedFile } from "@/lib/uploads/form-data-file";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      facebookAccount: { userId: session!.user.id },
    },
  });

  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const photos = await prisma.pageCustomerPhoto.findMany({
    where: { pageId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { product: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    photos: photos.map((ph) => ({
      ...ph,
      imageUrl: normalizeUploadUrl(ph.imageUrl),
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

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      facebookAccount: { userId: session!.user.id },
    },
  });

  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!isUploadedFile(file)) {
      return NextResponse.json({ error: "Cần chọn ảnh" }, { status: 400 });
    }

    const imageUrl = await savePageUpload(pageId, "customer-photos", file);
    const productId = String(form.get("productId") || "") || null;

    const photo = await prisma.pageCustomerPhoto.create({
      data: {
        pageId,
        productId,
        customerName: String(form.get("customerName") || "") || null,
        caption: String(form.get("caption") || "") || null,
        imageUrl,
      },
      include: { product: { select: { id: true, name: true } } },
    });

    return NextResponse.json(
      {
        photo: {
          ...photo,
          imageUrl: normalizeUploadUrl(photo.imageUrl),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[customer-photos POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể thêm ảnh" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const photoId = request.nextUrl.searchParams.get("photoId");

  if (!photoId) {
    return NextResponse.json({ error: "Thiếu photoId" }, { status: 400 });
  }

  const photo = await prisma.pageCustomerPhoto.findFirst({
    where: {
      id: photoId,
      pageId,
      page: { facebookAccount: { userId: session!.user.id } },
    },
  });

  if (!photo) {
    return NextResponse.json({ error: "Ảnh không tồn tại" }, { status: 404 });
  }

  await prisma.pageCustomerPhoto.delete({ where: { id: photoId } });
  return NextResponse.json({ success: true });
}

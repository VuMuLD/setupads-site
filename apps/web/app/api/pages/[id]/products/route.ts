import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { parseImageUrls } from "@/lib/messages/product-images";
import { getUploadedFiles, isUploadedFile } from "@/lib/uploads/form-data-file";
import { saveMultipleUploads, savePageUpload, normalizeUploadUrl } from "@/lib/uploads/page-uploads";

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

  const products = await prisma.pageProduct.findMany({
    where: { pageId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  const customerPhotos = await prisma.pageCustomerPhoto.findMany({
    where: { pageId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { product: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    page: { id: page.id, name: page.name },
    products: products.map((p) => ({
      ...p,
      imageUrl: p.imageUrl ? normalizeUploadUrl(p.imageUrl) : null,
      imageUrls: parseImageUrls(p.imageUrls).map(normalizeUploadUrl),
    })),
    customerPhotos: customerPhotos.map((ph) => ({
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
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const name = String(form.get("name") || "").trim();
      if (!name) {
        return NextResponse.json({ error: "Tên sản phẩm bắt buộc" }, { status: 400 });
      }

      const uploaded = getUploadedFiles(form, "images");
      const single = form.get("image");
      if (isUploadedFile(single)) uploaded.push(single);

      const imageUrl = uploaded[0] ? await savePageUpload(pageId, "products", uploaded[0]) : null;
      const extraUrls =
        uploaded.length > 1
          ? await saveMultipleUploads(pageId, "products", uploaded.slice(1))
          : [];

      const product = await prisma.pageProduct.create({
        data: {
          pageId,
          name,
          description: String(form.get("description") || "") || null,
          price: form.get("price") ? parseFloat(String(form.get("price"))) : null,
          currency: String(form.get("currency") || "VND"),
          imageUrl,
          imageUrls: extraUrls.length > 0 ? extraUrls : undefined,
          tags: form.get("tags")
            ? String(form.get("tags"))
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
        },
      });

      return NextResponse.json(
        {
          product: {
            ...product,
            imageUrl: product.imageUrl ? normalizeUploadUrl(product.imageUrl) : null,
            imageUrls: parseImageUrls(product.imageUrls).map(normalizeUploadUrl),
          },
        },
        { status: 201 }
      );
    }

    const body = await request.json();
    const { name, description, price, currency, imageUrl, imageUrls, tags } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Tên sản phẩm bắt buộc" }, { status: 400 });
    }

    const gallery = parseImageUrls(imageUrls);
    const product = await prisma.pageProduct.create({
      data: {
        pageId,
        name: name.trim(),
        description: description || null,
        price: price ?? null,
        currency: currency || "VND",
        imageUrl: imageUrl || gallery[0] || null,
        imageUrls: gallery.length > 1 ? gallery.slice(1) : undefined,
        tags: tags || undefined,
      },
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    console.error("[products POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể thêm sản phẩm" },
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

  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const productId = String(form.get("productId") || "");
      if (!productId) {
        return NextResponse.json({ error: "Thiếu productId" }, { status: 400 });
      }

      const product = await prisma.pageProduct.findFirst({
        where: {
          id: productId,
          pageId,
          page: { facebookAccount: { userId: session!.user.id } },
        },
      });

      if (!product) {
        return NextResponse.json({ error: "Sản phẩm không tồn tại" }, { status: 404 });
      }

      let allImages = [
        ...(product.imageUrl ? [normalizeUploadUrl(product.imageUrl)] : []),
        ...parseImageUrls(product.imageUrls).map(normalizeUploadUrl),
      ];
      allImages = Array.from(new Set(allImages));

      const removeRaw = form.get("removeImages");
      if (removeRaw) {
        try {
          const toRemove = JSON.parse(String(removeRaw)) as string[];
          const removeSet = new Set(toRemove.map((u) => normalizeUploadUrl(u)));
          allImages = allImages.filter((u) => !removeSet.has(u));
        } catch {
          return NextResponse.json({ error: "removeImages không hợp lệ" }, { status: 400 });
        }
      }

      const newFiles = getUploadedFiles(form, "images");
      const newUrls =
        newFiles.length > 0 ? await saveMultipleUploads(pageId, "products", newFiles) : [];
      allImages = [...allImages, ...newUrls];

      const nameField = form.get("name");
      const descriptionField = form.get("description");
      const priceField = form.get("price");
      const tagsField = form.get("tags");

      const updated = await prisma.pageProduct.update({
        where: { id: productId },
        data: {
          ...(nameField !== null && { name: String(nameField).trim() }),
          ...(descriptionField !== null && {
            description: String(descriptionField) || null,
          }),
          ...(priceField !== null && {
            price: priceField === "" ? null : parseFloat(String(priceField)),
          }),
          ...(tagsField !== null && {
            tags: String(tagsField)
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }),
          imageUrl: allImages[0] || null,
          imageUrls: allImages.length > 1 ? allImages.slice(1) : [],
        },
      });

      return NextResponse.json({
        product: {
          ...updated,
          imageUrl: updated.imageUrl ? normalizeUploadUrl(updated.imageUrl) : null,
          imageUrls: parseImageUrls(updated.imageUrls).map(normalizeUploadUrl),
        },
      });
    }

    const body = await request.json();
    const { productId, ...data } = body;

    const product = await prisma.pageProduct.findFirst({
      where: {
        id: productId,
        pageId,
        page: { facebookAccount: { userId: session!.user.id } },
      },
    });

    if (!product) {
      return NextResponse.json({ error: "Sản phẩm không tồn tại" }, { status: 404 });
    }

    const updated = await prisma.pageProduct.update({
      where: { id: productId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        ...(data.imageUrls !== undefined && { imageUrls: parseImageUrls(data.imageUrls) }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });

    return NextResponse.json({
      product: { ...updated, imageUrls: parseImageUrls(updated.imageUrls) },
    });
  } catch (err) {
    console.error("[products PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể cập nhật sản phẩm" },
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
  const productId = request.nextUrl.searchParams.get("productId");

  if (!productId) {
    return NextResponse.json({ error: "Thiếu productId" }, { status: 400 });
  }

  const product = await prisma.pageProduct.findFirst({
    where: {
      id: productId,
      pageId,
      page: { facebookAccount: { userId: session!.user.id } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Sản phẩm không tồn tại" }, { status: 404 });
  }

  await prisma.pageProduct.delete({ where: { id: productId } });
  return NextResponse.json({ success: true });
}

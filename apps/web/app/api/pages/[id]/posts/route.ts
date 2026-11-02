import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { toAbsoluteImageUrl } from "@/lib/messages/product-images";
import {
  createPostDraft,
  listPostsByPage,
  POST_ANGLES,
} from "@/lib/posts/post-store";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

async function getOwnedPage(userId: string, pageId: string) {
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

  const page = await getOwnedPage(session!.user.id, pageId);
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const [posts, products] = await Promise.all([
    listPostsByPage(pageId),
    prisma.pageProduct.findMany({
      where: { pageId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, name: true },
    }),
  ]);

  return NextResponse.json({
    pageName: page.name,
    products,
    angles: POST_ANGLES,
    posts,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id: pageId } = await params;

  const page = await getOwnedPage(session!.user.id, pageId);
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const angle = POST_ANGLES.some((a) => a.id === body.angle)
    ? (body.angle as string)
    : "gioi_thieu";
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "Giờ hẹn đăng không hợp lệ" },
      { status: 400 }
    );
  }

  const product = body.productId
    ? await prisma.pageProduct.findFirst({
        where: { id: body.productId, pageId, isActive: true },
      })
    : await prisma.pageProduct.findFirst({
        where: { pageId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      });

  if (!product) {
    return NextResponse.json(
      { error: "Page chưa có sản phẩm đang bán để AI soạn bài" },
      { status: 400 }
    );
  }

  // Ảnh sản phẩm (tối đa 3) — chuyển sang URL tuyệt đối để Facebook tải được
  const rawImages: string[] = [];
  if (product.imageUrl) rawImages.push(product.imageUrl);
  if (Array.isArray(product.imageUrls)) {
    for (const u of product.imageUrls) {
      if (typeof u === "string") rawImages.push(u);
    }
  }
  const imageUrls = rawImages
    .map((u) => toAbsoluteImageUrl(u))
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);

  let content: string;
  try {
    const response = await fetch(`${AI_SERVICE_URL}/write-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageName: page.name,
        product: {
          name: product.name,
          price: product.price,
          description: product.description || "",
        },
        angle,
        language: "vi",
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI service lỗi ${response.status}: ${detail.slice(0, 200)}`);
    }
    const data = await response.json();
    content = (data.content || "").trim();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Không soạn được bài: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 }
    );
  }

  if (!content) {
    return NextResponse.json(
      { error: "AI trả về nội dung trống, hãy thử lại" },
      { status: 502 }
    );
  }

  const post = await createPostDraft({
    pageId,
    productId: product.id,
    angle,
    content,
    imageUrls,
    scheduledAt,
  });

  return NextResponse.json({ post });
}

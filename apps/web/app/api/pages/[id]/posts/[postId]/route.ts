import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  deletePost,
  getPostById,
  updatePost,
} from "@/lib/posts/post-store";

async function loadOwnedPost(
  userId: string,
  pageId: string,
  postId: string
) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId } },
    select: { id: true },
  });
  if (!page) return null;
  const post = await getPostById(postId);
  if (!post || post.pageId !== pageId) return null;
  return post;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id: pageId, postId } = await params;

  const post = await loadOwnedPost(session!.user.id, pageId, postId);
  if (!post) {
    return NextResponse.json({ error: "Bài viết không tồn tại" }, { status: 404 });
  }
  if (post.status !== "draft" && post.status !== "approved") {
    return NextResponse.json(
      { error: "Chỉ sửa được bài nháp / chờ đăng" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const data: { content?: string; scheduledAt?: Date | null } = {};
  if (typeof body.content === "string" && body.content.trim()) {
    data.content = body.content.trim();
  }
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null || body.scheduledAt === "") {
      data.scheduledAt = null;
    } else {
      const when = new Date(body.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json(
          { error: "Giờ hẹn đăng không hợp lệ" },
          { status: 400 }
        );
      }
      data.scheduledAt = when;
    }
  }

  await updatePost(postId, data);
  return NextResponse.json({ post: await getPostById(postId) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id: pageId, postId } = await params;

  const post = await loadOwnedPost(session!.user.id, pageId, postId);
  if (!post) {
    return NextResponse.json({ error: "Bài viết không tồn tại" }, { status: 404 });
  }
  if (post.status === "posted") {
    return NextResponse.json(
      { error: "Bài đã đăng không xoá được tại đây" },
      { status: 409 }
    );
  }

  await deletePost(postId);
  return NextResponse.json({ ok: true });
}

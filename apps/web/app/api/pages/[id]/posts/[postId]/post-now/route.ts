import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getPostById, updatePost } from "@/lib/posts/post-store";
import { publishScheduledPost } from "@/lib/posts/publish-post";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id: pageId, postId } = await params;

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId: session!.user.id } },
    select: { id: true },
  });
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const post = await getPostById(postId);
  if (!post || post.pageId !== pageId) {
    return NextResponse.json({ error: "Bài viết không tồn tại" }, { status: 404 });
  }
  if (post.status === "posted") {
    return NextResponse.json({ error: "Bài này đã đăng rồi" }, { status: 409 });
  }
  if (post.status === "draft") {
    await updatePost(postId, { status: "approved" });
  }

  const result = await publishScheduledPost(postId);
  const updated = await getPostById(postId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Đăng bài thất bại", post: updated },
      { status: 502 }
    );
  }
  return NextResponse.json({ post: updated });
}

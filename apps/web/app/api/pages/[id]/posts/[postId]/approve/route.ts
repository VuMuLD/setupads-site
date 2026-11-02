import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getPostById, updatePost } from "@/lib/posts/post-store";

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
  if (post.status !== "draft") {
    return NextResponse.json(
      { error: "Chỉ duyệt được bài đang ở trạng thái nháp" },
      { status: 409 }
    );
  }

  await updatePost(postId, { status: "approved", error: null });
  return NextResponse.json({ post: await getPostById(postId) });
}

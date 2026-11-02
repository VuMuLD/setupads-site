import { prisma } from "@/lib/prisma";
import { getPageAccessToken } from "@/lib/auth";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import { getPostById, updatePost } from "@/lib/posts/post-store";

/**
 * Đăng 1 bài đã duyệt lên tường Page qua Graph API.
 * Trả về { ok } và ghi kết quả (fb_post_id/url hoặc lỗi) vào DB.
 */
export async function publishScheduledPost(
  postId: string
): Promise<{ ok: boolean; error?: string }> {
  const post = await getPostById(postId);
  if (!post) return { ok: false, error: "Bài viết không tồn tại" };
  if (post.status === "posted") {
    return { ok: false, error: "Bài này đã đăng rồi" };
  }

  const page = await prisma.page.findUnique({
    where: { id: post.pageId },
    include: { facebookAccount: true },
  });
  if (!page) {
    await updatePost(postId, { status: "failed", error: "Không tìm thấy Page" });
    return { ok: false, error: "Không tìm thấy Page" };
  }

  const token = await getPageAccessToken(page.facebookAccount.userId, page.id);
  if (!token) {
    const error = "Page chưa có token. Hãy kết nối lại Facebook trong setupads.";
    await updatePost(postId, { status: "failed", error });
    return { ok: false, error };
  }

  try {
    const client = new FacebookGraphClient(token);
    const attachedMedia: Array<{ media_fbid: string }> = [];
    for (const url of post.imageUrls.slice(0, 4)) {
      const uploaded = await client.uploadPagePhoto(page.fbPageId, url);
      if (uploaded?.id) attachedMedia.push({ media_fbid: uploaded.id });
    }
    const result = await client.createPageFeedPost(
      page.fbPageId,
      post.content,
      attachedMedia
    );
    await updatePost(postId, {
      status: "posted",
      fbPostId: result.id,
      fbPostUrl: `https://www.facebook.com/${result.id}`,
      error: null,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updatePost(postId, {
      status: "failed",
      error: message.slice(0, 900),
    });
    return { ok: false, error: message };
  }
}

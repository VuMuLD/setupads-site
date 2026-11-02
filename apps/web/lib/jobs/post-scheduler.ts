import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";
import { listDueApprovedPosts } from "@/lib/posts/post-store";
import { publishScheduledPost } from "@/lib/posts/publish-post";

/**
 * Quét các bài đã duyệt tới giờ đăng và đăng lên Page.
 * Chạy mỗi 5 phút từ cron-scheduler.
 */
export async function runScheduledPosts() {
  if (isFacebookAppRateLimited()) {
    console.log("[posts] Bỏ qua lượt quét — Facebook app đang bị giới hạn");
    return;
  }
  let due;
  try {
    due = await listDueApprovedPosts(10);
  } catch (err) {
    console.error("[posts] Không đọc được hàng chờ đăng bài:", err);
    return;
  }
  for (const post of due) {
    try {
      const result = await publishScheduledPost(post.id);
      if (result.ok) {
        console.log(`[posts] Đã đăng bài ${post.id} lên page ${post.pageId}`);
      } else {
        console.error(`[posts] Đăng bài ${post.id} thất bại:`, result.error);
      }
    } catch (err) {
      console.error(`[posts] Lỗi đăng bài ${post.id}:`, err);
    }
  }
}

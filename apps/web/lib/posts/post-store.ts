import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export type ScheduledPostStatus =
  | "draft"
  | "approved"
  | "posted"
  | "failed";

export const POST_ANGLES = [
  { id: "gioi_thieu", label: "Giới thiệu sản phẩm" },
  { id: "uu_dai", label: "Ưu đãi / khuyến mãi" },
  { id: "tinh_nang", label: "Tính năng nổi bật" },
  { id: "meo_dung", label: "Mẹo sử dụng" },
  { id: "hoi_dap", label: "Hỏi đáp thường gặp" },
] as const;

export interface ScheduledPost {
  id: string;
  pageId: string;
  productId: string | null;
  angle: string | null;
  content: string;
  imageUrls: string[];
  status: ScheduledPostStatus;
  scheduledAt: Date | null;
  fbPostId: string | null;
  fbPostUrl: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PostRow {
  id: string;
  page_id: string;
  product_id: string | null;
  angle: string | null;
  content: string;
  image_urls: string | null;
  status: string;
  scheduled_at: Date | null;
  fb_post_id: string | null;
  fb_post_url: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

let tableReady = false;

export async function ensurePostsTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS page_scheduled_posts (
       id VARCHAR(191) NOT NULL,
       page_id VARCHAR(191) NOT NULL,
       product_id VARCHAR(191) NULL,
       angle VARCHAR(50) NULL,
       content TEXT NOT NULL,
       image_urls TEXT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'draft',
       scheduled_at DATETIME(3) NULL,
       fb_post_id VARCHAR(191) NULL,
       fb_post_url VARCHAR(512) NULL,
       error TEXT NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       KEY idx_posts_page_status (page_id, status),
       KEY idx_posts_due (status, scheduled_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  tableReady = true;
}

function toPost(row: PostRow): ScheduledPost {
  let imageUrls: string[] = [];
  if (row.image_urls) {
    try {
      const parsed = JSON.parse(row.image_urls);
      if (Array.isArray(parsed)) {
        imageUrls = parsed.filter((u) => typeof u === "string");
      }
    } catch {
      imageUrls = [];
    }
  }
  return {
    id: row.id,
    pageId: row.page_id,
    productId: row.product_id,
    angle: row.angle,
    content: row.content,
    imageUrls,
    status: row.status as ScheduledPostStatus,
    scheduledAt: row.scheduled_at,
    fbPostId: row.fb_post_id,
    fbPostUrl: row.fb_post_url,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPostDraft(input: {
  pageId: string;
  productId?: string | null;
  angle?: string | null;
  content: string;
  imageUrls: string[];
  scheduledAt?: Date | null;
}): Promise<ScheduledPost> {
  await ensurePostsTable();
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO page_scheduled_posts
       (id, page_id, product_id, angle, content, image_urls, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    id,
    input.pageId,
    input.productId ?? null,
    input.angle ?? null,
    input.content,
    JSON.stringify(input.imageUrls),
    input.scheduledAt ?? null
  );
  const post = await getPostById(id);
  if (!post) throw new Error("Không tạo được bài nháp");
  return post;
}

export async function getPostById(id: string): Promise<ScheduledPost | null> {
  await ensurePostsTable();
  const rows = await prisma.$queryRawUnsafe<PostRow[]>(
    "SELECT * FROM page_scheduled_posts WHERE id = ? LIMIT 1",
    id
  );
  return rows.length ? toPost(rows[0]) : null;
}

export async function listPostsByPage(
  pageId: string,
  limit = 50
): Promise<ScheduledPost[]> {
  await ensurePostsTable();
  const rows = await prisma.$queryRawUnsafe<PostRow[]>(
    "SELECT * FROM page_scheduled_posts WHERE page_id = ? ORDER BY created_at DESC LIMIT ?",
    pageId,
    limit
  );
  return rows.map(toPost);
}

export async function listDueApprovedPosts(
  limit = 10
): Promise<ScheduledPost[]> {
  await ensurePostsTable();
  const rows = await prisma.$queryRawUnsafe<PostRow[]>(
    `SELECT * FROM page_scheduled_posts
     WHERE status = 'approved' AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     ORDER BY COALESCE(scheduled_at, created_at) ASC LIMIT ?`,
    limit
  );
  return rows.map(toPost);
}

export async function updatePost(
  id: string,
  data: Partial<{
    content: string;
    imageUrls: string[];
    status: ScheduledPostStatus;
    scheduledAt: Date | null;
    fbPostId: string | null;
    fbPostUrl: string | null;
    error: string | null;
  }>
): Promise<void> {
  await ensurePostsTable();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (data.content !== undefined) {
    sets.push("content = ?");
    values.push(data.content);
  }
  if (data.imageUrls !== undefined) {
    sets.push("image_urls = ?");
    values.push(JSON.stringify(data.imageUrls));
  }
  if (data.status !== undefined) {
    sets.push("status = ?");
    values.push(data.status);
  }
  if (data.scheduledAt !== undefined) {
    sets.push("scheduled_at = ?");
    values.push(data.scheduledAt);
  }
  if (data.fbPostId !== undefined) {
    sets.push("fb_post_id = ?");
    values.push(data.fbPostId);
  }
  if (data.fbPostUrl !== undefined) {
    sets.push("fb_post_url = ?");
    values.push(data.fbPostUrl);
  }
  if (data.error !== undefined) {
    sets.push("error = ?");
    values.push(data.error);
  }
  if (!sets.length) return;
  values.push(id);
  await prisma.$executeRawUnsafe(
    `UPDATE page_scheduled_posts SET ${sets.join(", ")} WHERE id = ?`,
    ...values
  );
}

export async function deletePost(id: string): Promise<void> {
  await ensurePostsTable();
  await prisma.$executeRawUnsafe(
    "DELETE FROM page_scheduled_posts WHERE id = ?",
    id
  );
}

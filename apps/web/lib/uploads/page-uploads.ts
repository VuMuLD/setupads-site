import { writeFile, mkdir } from "fs/promises";
import path from "path";
import type { UploadedFile } from "@/lib/uploads/form-data-file";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const ALLOWED_MIME = new Set(Object.keys(MIME_EXT));

function resolveExtension(file: UploadedFile): string {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (fromName && [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(fromName)) {
    return fromName === ".jpeg" ? ".jpg" : fromName;
  }

  const mime = (file as UploadedFile & { type?: string }).type?.toLowerCase();
  if (mime && MIME_EXT[mime]) return MIME_EXT[mime];

  return ".jpg";
}

export function validateImageFile(file: UploadedFile): string | null {
  const mime = (file as UploadedFile & { type?: string }).type?.toLowerCase();
  const ext = resolveExtension(file);

  if (mime && !ALLOWED_MIME.has(mime) && !mime.startsWith("image/")) {
    return `Định dạng không hỗ trợ: ${mime}`;
  }

  if (![".jpg", ".png", ".webp", ".gif"].includes(ext)) {
    return "Chỉ hỗ trợ ảnh JPG, PNG, WEBP, GIF";
  }

  if (file.size > 10 * 1024 * 1024) {
    return "Ảnh tối đa 10MB";
  }

  return null;
}

export async function savePageUpload(
  pageId: string,
  subfolder: "products" | "customer-photos" | "broadcast",
  file: UploadedFile
): Promise<string> {
  const err = validateImageFile(file);
  if (err) throw new Error(err);

  const ext = resolveExtension(file);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", subfolder, pageId);
  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);
  return `/api/uploads/${subfolder}/${pageId}/${filename}`;
}

export async function saveMultipleUploads(
  pageId: string,
  subfolder: "products" | "customer-photos" | "broadcast",
  files: UploadedFile[]
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    if (file.size > 0) urls.push(await savePageUpload(pageId, subfolder, file));
  }
  return urls;
}

/** Chuẩn hóa URL ảnh cũ (/uploads/...) sang API route mới */
export function normalizeUploadUrl(url: string): string {
  if (url.startsWith("/api/uploads/")) return url;
  if (url.startsWith("/uploads/")) return `/api${url}`;
  return url;
}

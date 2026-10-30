import { getAppBaseUrl } from "@/lib/site-url";

export const MAX_ATTACH_IMAGES = 10;

export function toAbsoluteImageUrl(url: string): string | null {
  if (!url) return null;
  const normalized = url.startsWith("/uploads/")
    ? `/api${url}`
    : url;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
  if (normalized.startsWith("/")) return `${getAppBaseUrl()}${normalized}`;
  return null;
}

export function parseImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((u): u is string => typeof u === "string" && u.length > 0);
}

export function getProductAllImages(product: {
  imageUrl: string | null;
  imageUrls?: unknown;
}): string[] {
  const gallery = parseImageUrls(product.imageUrls);
  const all = [product.imageUrl, ...gallery].filter((u): u is string => Boolean(u));
  return Array.from(new Set(all));
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  ExternalLink,
  Megaphone,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface PostItem {
  id: string;
  productId: string | null;
  angle: string | null;
  content: string;
  imageUrls: string[];
  status: "draft" | "approved" | "posted" | "failed";
  scheduledAt: string | null;
  fbPostUrl: string | null;
  error: string | null;
  createdAt: string;
}

interface ProductOption {
  id: string;
  name: string;
}

interface AngleOption {
  id: string;
  label: string;
}

const STATUS_META: Record<PostItem["status"], { label: string; cls: string }> = {
  draft: { label: "Nháp", cls: "bg-gray-100 text-gray-700" },
  approved: { label: "Chờ đăng", cls: "bg-amber-100 text-amber-800" },
  posted: { label: "Đã đăng", cls: "bg-green-100 text-green-800" },
  failed: { label: "Lỗi", cls: "bg-red-100 text-red-700" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PagePostsPage() {
  const params = useParams();
  const pageId = params.id as string;

  const [pageName, setPageName] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [angles, setAngles] = useState<AngleOption[]>([]);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState({ productId: "", angle: "gioi_thieu", scheduledAt: "" });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [schedules, setSchedules] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/posts`);
    if (!res.ok) {
      setStatus("Không tải được danh sách bài viết");
      return;
    }
    const data = await res.json();
    setPageName(data.pageName || "");
    setProducts(data.products || []);
    setAngles(data.angles || []);
    setPosts(data.posts || []);
    setGen((g) => ({ ...g, productId: g.productId || data.products?.[0]?.id || "" }));
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setStatus("Đang nhờ AI soạn bài...");
    try {
      const res = await fetch(`/api/pages/${pageId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: gen.productId || undefined,
          angle: gen.angle,
          scheduledAt: gen.scheduledAt
            ? new Date(gen.scheduledAt).toISOString()
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Soạn bài thất bại");
      setStatus("Đã soạn xong 1 bài nháp — kiểm tra rồi bấm Duyệt nhé");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Soạn bài thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function act(postId: string, action: "approve" | "post-now" | "delete") {
    setBusy(true);
    try {
      const res =
        action === "delete"
          ? await fetch(`/api/pages/${pageId}/posts/${postId}`, { method: "DELETE" })
          : await fetch(`/api/pages/${pageId}/posts/${postId}/${action}`, {
              method: "POST",
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Thao tác thất bại");
      setStatus(
        action === "approve"
          ? "Đã duyệt — bài sẽ tự đăng đúng giờ hẹn (hoặc ở lượt quét kế tiếp)"
          : action === "post-now"
            ? "Đã đăng bài lên Page"
            : "Đã xoá bài"
      );
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(post: PostItem) {
    const content = (edits[post.id] ?? post.content).trim();
    const scheduledRaw = schedules[post.id];
    setBusy(true);
    try {
      const res = await fetch(`/api/pages/${pageId}/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          ...(scheduledRaw !== undefined
            ? { scheduledAt: scheduledRaw ? new Date(scheduledRaw).toISOString() : null }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Lưu thất bại");
      setStatus("Đã lưu bài");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/messages">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Tin nhắn
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Megaphone className="h-6 w-6 text-indigo-600" />
              Đăng bài — {pageName}
            </h1>
            <p className="text-sm text-muted-foreground">
              AI soạn bài sẵn, bạn duyệt mới đăng lên tường Page
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Làm mới
          </Button>
        </div>

        {status && (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            {status}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              Soạn bài mới bằng AI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Sản phẩm</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={gen.productId}
                  onChange={(e) => setGen((g) => ({ ...g, productId: e.target.value }))}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Góc nội dung</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={gen.angle}
                  onChange={(e) => setGen((g) => ({ ...g, angle: e.target.value }))}
                >
                  {angles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Hẹn giờ đăng (tuỳ chọn)</Label>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={gen.scheduledAt}
                  onChange={(e) => setGen((g) => ({ ...g, scheduledAt: e.target.value }))}
                />
              </div>
            </div>
            <Button className="mt-4" onClick={() => void generate()} disabled={busy || !products.length}>
              <Sparkles className="mr-2 h-4 w-4" />
              AI soạn bài
            </Button>
            {!products.length && (
              <p className="mt-2 text-sm text-red-600">
                Page chưa có sản phẩm đang bán — thêm sản phẩm trước để AI có dữ liệu soạn bài.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {posts.map((post) => {
            const meta = STATUS_META[post.status];
            const editable = post.status === "draft" || post.status === "approved";
            return (
              <Card key={post.id}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <span>
                      {angles.find((a) => a.id === post.angle)?.label || post.angle || ""}
                    </span>
                    <span>· Tạo {fmtTime(post.createdAt)}</span>
                    {post.scheduledAt && (
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        Hẹn đăng {fmtTime(post.scheduledAt)}
                      </span>
                    )}
                    {post.fbPostUrl && (
                      <a
                        href={post.fbPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-indigo-600 underline"
                      >
                        Xem bài <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <textarea
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    rows={7}
                    disabled={!editable || busy}
                    value={edits[post.id] ?? post.content}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [post.id]: e.target.value }))
                    }
                  />

                  {post.imageUrls.length > 0 && (
                    <div className="flex gap-2">
                      {post.imageUrls.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={url}
                          src={url}
                          alt=""
                          className="h-20 w-20 rounded-md object-cover"
                        />
                      ))}
                    </div>
                  )}

                  {post.error && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      {post.error}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {editable && (
                      <>
                        <input
                          type="datetime-local"
                          className="rounded-md border px-2 py-1.5 text-sm"
                          value={
                            schedules[post.id] ??
                            (post.scheduledAt
                              ? new Date(post.scheduledAt).toISOString().slice(0, 16)
                              : "")
                          }
                          onChange={(e) =>
                            setSchedules((prev) => ({ ...prev, [post.id]: e.target.value }))
                          }
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void saveEdit(post)}
                        >
                          Lưu
                        </Button>
                      </>
                    )}
                    {post.status === "draft" && (
                      <Button size="sm" disabled={busy} onClick={() => void act(post.id, "approve")}>
                        <CheckCheck className="mr-1 h-4 w-4" />
                        Duyệt
                      </Button>
                    )}
                    {(post.status === "draft" || post.status === "approved" || post.status === "failed") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void act(post.id, "post-now")}
                      >
                        <Send className="mr-1 h-4 w-4" />
                        Đăng ngay
                      </Button>
                    )}
                    {post.status !== "posted" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void act(post.id, "delete")}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Xoá
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {posts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Chưa có bài nào. Bấm nút AI soạn bài để tạo bài nháp đầu tiên.
            </p>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

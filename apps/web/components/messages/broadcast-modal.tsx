"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bot,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Save,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { personalizeTemplate } from "@/lib/messages/message-templates";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_IMAGES = 10;

interface Product {
  id: string;
  name: string;
  imageUrl: string | null;
  imageUrls?: string[];
}

interface CustomerPhoto {
  id: string;
  customerName: string | null;
  imageUrl: string;
}

interface Template {
  id: string;
  name: string;
  category: string;
  text: string;
  imageUrls?: string[];
  productIds?: string[];
}

type Step = "compose" | "confirm" | "progress" | "done";

interface BroadcastProgress {
  broadcastId: string;
  status: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  totalSteps: number;
  reachable: number;
  pageName: string;
  currentRecipient: string | null;
}

interface PreviewCounts {
  total: number;
  within24h: number;
  outside24h: number;
  tagReachable?: number;
  reachable: number;
  sendMode?: "within24h" | "all";
  policyNote?: string;
}

interface BroadcastModalProps {
  pageId: string;
  pageName: string;
  products: Product[];
  customerPhotos?: CustomerPhoto[];
  open: boolean;
  onClose: () => void;
  onSent: (message: string) => void;
}

const AUDIENCE_OPTIONS = [
  { id: "purchased", label: "Khách đã mua", desc: "Người từng chốt đơn / đặt hàng" },
  { id: "consulting", label: "Khách tư vấn", desc: "Đã nhắn nhưng chưa mua" },
  { id: "all", label: "Tất cả khách", desc: "Mọi hội thoại có PSID" },
] as const;

function getProductImages(p: Product): string[] {
  const all = [p.imageUrl, ...(p.imageUrls || [])].filter((u): u is string => Boolean(u));
  return Array.from(new Set(all));
}

function getProductThumb(p: Product): string | null {
  return getProductImages(p)[0] || null;
}

export function BroadcastModal({
  pageId,
  pageName,
  products,
  customerPhotos = [],
  open,
  onClose,
  onSent,
}: BroadcastModalProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<"purchased" | "consulting" | "all">("purchased");
  const [sendMode, setSendMode] = useState<"within24h" | "all">("all");
  const [attachProductIds, setAttachProductIds] = useState<string[]>([]);
  const [attachPhotoIds, setAttachPhotoIds] = useState<string[]>([]);
  const [attachedImageUrls, setAttachedImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("compose");
  const [progress, setProgress] = useState<BroadcastProgress | null>(null);
  const [finalResult, setFinalResult] = useState<{
    sent: number;
    failed: number;
    total: number;
    skipped: number;
  } | null>(null);

  const productImageUrls = useMemo(() => {
    const urls: string[] = [];
    for (const id of attachProductIds) {
      const p = products.find((x) => x.id === id);
      if (p) urls.push(...getProductImages(p).slice(0, 2));
    }
    return urls;
  }, [attachProductIds, products]);

  const customerPhotoUrls = useMemo(() => {
    return attachPhotoIds
      .map((id) => customerPhotos.find((p) => p.id === id)?.imageUrl)
      .filter((u): u is string => Boolean(u));
  }, [attachPhotoIds, customerPhotos]);

  const allPreviewImages = useMemo(() => {
    const combined = [...attachedImageUrls, ...productImageUrls, ...customerPhotoUrls];
    return Array.from(new Set(combined)).slice(0, MAX_IMAGES);
  }, [attachedImageUrls, productImageUrls, customerPhotoUrls]);

  const loadTemplates = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/message-templates`);
    const data = await res.json();
    setTemplates(data.templates || []);
  }, [pageId]);

  const loadPreview = useCallback(async () => {
    const res = await fetch(
      `/api/pages/${pageId}/broadcast/preview?audience=${audience}&sendMode=${sendMode}`
    );
    const data = await res.json();
    setPreview(data);
  }, [pageId, audience, sendMode]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setFinalResult(null);
    setProgress(null);
    setStep("compose");
    void loadTemplates();
    void loadPreview();
  }, [open, loadTemplates, loadPreview]);

  useEffect(() => {
    if (open) void loadPreview();
  }, [audience, sendMode, open, loadPreview]);

  const resetImages = () => {
    setAttachedImageUrls([]);
    setAttachProductIds([]);
    setAttachPhotoIds([]);
    setFileInputKey((k) => k + 1);
  };

  const selectTemplate = (t: Template) => {
    setSelectedTemplateId(t.id);
    setTemplateName(t.name);
    setText(t.text);
    setAttachProductIds(t.productIds || []);
    setAttachedImageUrls(t.imageUrls || []);
    setAttachPhotoIds([]);
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = MAX_IMAGES - allPreviewImages.length;
    if (remaining <= 0) {
      setError(`Tối đa ${MAX_IMAGES} ảnh mỗi tin`);
      return;
    }

    setUploading(true);
    setError("");
    const fd = new FormData();
    for (const file of Array.from(files).slice(0, remaining)) {
      fd.append("images", file);
    }

    try {
      const res = await fetch(`/api/pages/${pageId}/broadcast/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Không tải được ảnh");
        return;
      }
      setAttachedImageUrls((prev) =>
        Array.from(new Set([...prev, ...(data.urls || [])])).slice(0, MAX_IMAGES)
      );
      setFileInputKey((k) => k + 1);
    } catch {
      setError("Lỗi khi tải ảnh");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachedUrl = (url: string) => {
    setAttachedImageUrls((prev) => prev.filter((u) => u !== url));
  };

  const generateWithAi = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/pages/${pageId}/message-templates/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programType: "old_customer_promo" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Không tạo được nội dung");
        return;
      }
      setText(data.text || "");
      setTemplateName(data.name || "Tin nhắn khách cũ (AI)");
      setSelectedTemplateId("");
    } catch {
      setError("Lỗi kết nối AI");
    } finally {
      setGenerating(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || !text.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/pages/${pageId}/message-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          text,
          category: "old_customer",
          productIds: attachProductIds,
          imageUrls: attachedImageUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Không lưu được mẫu");
        return;
      }
      await loadTemplates();
      if (data.template?.id) setSelectedTemplateId(data.template.id);
    } catch {
      setError("Lỗi khi lưu mẫu");
    } finally {
      setSaving(false);
    }
  };

  const audienceLabel =
    AUDIENCE_OPTIONS.find((o) => o.id === audience)?.label ?? audience;

  const pollProgress = useCallback(
    async (broadcastId: string) => {
      const res = await fetch(`/api/pages/${pageId}/broadcast/${broadcastId}`);
      const data = await res.json();
      if (!res.ok) return null;
      return data as BroadcastProgress;
    },
    [pageId]
  );

  const startSending = async () => {
    setStep("progress");
    setError("");
    setFinalResult(null);

    try {
      const res = await fetch(`/api/pages/${pageId}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          sendMode,
          text,
          templateId: selectedTemplateId || undefined,
          productIds: attachProductIds,
          customerPhotoIds: attachPhotoIds,
          imageUrls: attachedImageUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gửi thất bại");
        setStep("confirm");
        return;
      }

      const broadcastId = data.broadcastId as string;
      setProgress({
        broadcastId,
        status: "running",
        totalCount: data.reachable ?? data.total,
        totalSteps: data.total,
        reachable: data.reachable ?? data.total,
        sentCount: 0,
        failedCount: 0,
        skippedCount: data.skippedOutside24h ?? 0,
        pageName: data.pageName || pageName,
        currentRecipient: null,
      });

      const poll = async () => {
        const status = await pollProgress(broadcastId);
        if (!status) return;

        setProgress({
          broadcastId: status.broadcastId,
          status: status.status,
          totalCount: status.totalCount,
          totalSteps: status.totalSteps ?? status.totalCount + (status.skippedCount || 0),
          reachable: status.reachable ?? status.totalCount,
          sentCount: status.sentCount,
          failedCount: status.failedCount,
          skippedCount: status.skippedCount || 0,
          pageName: status.pageName,
          currentRecipient: status.currentRecipient,
        });

        if (status.status === "running") {
          setTimeout(() => void poll(), 1000);
        } else {
          setFinalResult({
            sent: status.sentCount,
            failed: status.failedCount,
            total: status.reachable ?? status.totalCount,
            skipped: status.skippedCount || 0,
          });
          setStep("done");
          onSent(
            `Page "${status.pageName}": gửi ${status.sentCount}/${status.reachable ?? status.totalCount} khách` +
              (status.skippedCount ? ` · bỏ qua ${status.skippedCount} (ngoài 24h)` : "") +
              (status.failedCount ? ` · ${status.failedCount} lỗi` : "")
          );
        }
      };

      setTimeout(() => void poll(), 800);
    } catch {
      setError("Lỗi kết nối");
      setStep("confirm");
    }
  };

  const openConfirm = () => {
    if (!text.trim()) {
      setError("Nhập nội dung tin nhắn");
      return;
    }
    if (!preview?.reachable) {
      setError(
        preview?.total
          ? sendMode === "within24h"
            ? `Không có khách nào trong cửa sổ 24h. Bật "Gửi tất cả khách" để thử gửi ${preview.outside24h} khách ngoài 24h.`
            : "Không có khách nào trong nhóm đã chọn"
          : "Không có khách nào trong nhóm đã chọn"
      );
      return;
    }
    setError("");
    setStep("confirm");
  };

  const handleClose = () => {
    if (step === "progress") return;
    onClose();
  };

  const previewText = personalizeTemplate(text || "...", {
    name: "Lan",
    pageName,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Megaphone className="h-5 w-5 text-indigo-600" />
              Gửi tin nhắn khách cũ
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <span className="rounded-md bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800">
                Page: {pageName}
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={step === "progress"}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {step === "confirm" && (
          <div className="border-b bg-amber-50 px-5 py-4">
            <h3 className="font-semibold text-amber-950">Xác nhận gửi tin nhắn</h3>
            <div className="mt-3 space-y-2 text-sm text-amber-900">
              <p>
                <span className="text-muted-foreground">Gửi từ Page:</span>{" "}
                <strong className="text-indigo-700">{pageName}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Đối tượng:</span>{" "}
                <strong>{audienceLabel}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Sẽ gửi:</span>{" "}
                <strong className="text-green-700">{preview?.reachable ?? 0} khách</strong>
                {sendMode === "within24h" && (preview?.outside24h ?? 0) > 0 && (
                  <>
                    {" "}
                    · <span className="text-amber-700">bỏ qua {preview?.outside24h} khách ngoài 24h</span>
                  </>
                )}
                {sendMode === "all" && (preview?.outside24h ?? 0) > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-indigo-700">
                      gồm {preview?.outside24h} khách ngoài 24h
                      {(preview?.tagReachable ?? 0) > 0 &&
                        ` (${preview?.tagReachable} khách đã mua dùng tag POST_PURCHASE)`}
                    </span>
                  </>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">Nội dung:</span> tin nhắn
                {allPreviewImages.length > 0 && (
                  <>
                    {" "}
                    + <strong>{allPreviewImages.length} ảnh</strong>
                  </>
                )}
              </p>
              <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-amber-200 bg-white p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {personalizeTemplate(text, { name: "Lan", pageName })}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("compose")}>
                Quay lại chỉnh sửa
              </Button>
              <Button size="sm" onClick={() => void startSending()}>
                <Send className="mr-1 h-3.5 w-3.5" />
                Xác nhận gửi đến Page này
              </Button>
            </div>
          </div>
        )}

        {step === "progress" && progress && (
          <div className="border-b bg-indigo-50 px-5 py-5">
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-900">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang gửi qua Page <strong className="ml-1">{progress.pageName}</strong>
            </div>
            <div className="mt-3">
              {(() => {
                const processed =
                  progress.sentCount + progress.failedCount + progress.skippedCount;
                const total = progress.totalSteps || processed || 1;
                const pct = Math.round((processed / total) * 100);
                return (
                  <>
                    <div className="mb-1 flex justify-between text-xs text-indigo-800">
                      <span>
                        {processed}/{total} khách
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-indigo-200">
                      <div
                        className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </>
                );
              })()}
              <p className="mt-2 text-xs text-indigo-700">
                Gửi thành công: {progress.sentCount}
                {progress.skippedCount > 0 && ` · Bỏ qua (ngoài 24h): ${progress.skippedCount}`}
                {progress.failedCount > 0 && ` · Lỗi: ${progress.failedCount}`}
                {progress.currentRecipient && <> · Vừa xử lý: {progress.currentRecipient}</>}
              </p>
            </div>
          </div>
        )}

        {step === "done" && finalResult && (
          <div className="border-b bg-green-50 px-5 py-4">
            <div className="flex items-center gap-2 font-semibold text-green-800">
              <CheckCircle2 className="h-5 w-5" />
              Hoàn tất — Page {pageName}
            </div>
            <p className="mt-1 text-sm text-green-700">
              Gửi thành công {finalResult.sent}/{finalResult.total} khách
              {finalResult.skipped > 0 && ` · Bỏ qua ${finalResult.skipped} (ngoài 24h)`}
              {finalResult.failed > 0 && ` · ${finalResult.failed} lỗi`}
            </p>
          </div>
        )}

        <div
          className={`flex-1 space-y-5 overflow-y-auto p-5 ${step !== "compose" ? "pointer-events-none opacity-50" : ""}`}
        >
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              Gửi cho
            </Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {AUDIENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAudience(opt.id)}
                  className={`rounded-xl border p-3 text-left text-sm transition ${
                    audience === opt.id
                      ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <p className="font-medium">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{opt.desc}</p>
                </button>
              ))}
            </div>
            {preview && (
              <div className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Tổng nhóm: <strong>{preview.total}</strong> khách
                </p>
                <p className="font-medium text-green-700">
                  Trong 24h (gửi bình thường): <strong>{preview.within24h}</strong> khách
                </p>
                {preview.outside24h > 0 && (
                  <p className="text-amber-700">
                    Ngoài 24h: <strong>{preview.outside24h}</strong> khách
                    {(preview.tagReachable ?? 0) > 0 && (
                      <>
                        {" "}
                        — <strong>{preview.tagReachable}</strong> khách đã mua có thể nhận qua tag
                        POST_PURCHASE
                      </>
                    )}
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={sendMode === "all"}
                    onChange={(e) => setSendMode(e.target.checked ? "all" : "within24h")}
                  />
                  <span>
                    <strong className="text-indigo-900">Gửi tất cả khách</strong>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-indigo-800/90">
                      Thử gửi cả khách cũ từ trước đến nay. Khách đã mua ngoài 24h dùng tag hợp lệ
                      của Facebook. Khách tư vấn chưa mua ngoài 24h có thể bị từ chối — cần khách
                      nhắn lại Page hoặc dùng quảng cáo Click-to-Messenger.
                    </span>
                  </span>
                </label>
                {preview.policyNote && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {preview.policyNote}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Mẫu tin nhắn có sẵn</Label>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant={selectedTemplateId === t.id ? "default" : "outline"}
                  size="sm"
                  className="h-auto py-1.5 text-xs"
                  onClick={() => selectTemplate(t)}
                >
                  {t.name}
                  {(t.imageUrls?.length || 0) > 0 && (
                    <ImageIcon className="ml-1 h-3 w-3 opacity-70" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="broadcast-name">Tên mẫu</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={generating}
                  onClick={() => void generateWithAi()}
                >
                  {generating ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3 w-3" />
                  )}
                  Tạo bằng AI
                </Button>
              </div>
              <Input
                id="broadcast-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="VD: Tri ân khách cũ tháng 7"
              />

              <Label htmlFor="broadcast-text">
                Nội dung tin nhắn
                <span className="ml-1 font-normal text-muted-foreground">
                  ({"{name}"}, {"{pageName}"})
                </span>
              </Label>
              <textarea
                id="broadcast-text"
                rows={8}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Dạ em chào {name} ạ!\n\nEm là {pageName}...`}
              />

              {/* Image upload */}
              <div className="space-y-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/30 p-3">
                <Label className="flex items-center gap-1 text-indigo-800">
                  <Camera className="h-4 w-4" />
                  Ảnh đính kèm (JPG, PNG, WEBP)
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Gửi kèm hình sản phẩm / chương trình — khách dễ xem và mua hơn. Tối đa {MAX_IMAGES}{" "}
                  ảnh.
                </p>
                <input
                  key={fileInputKey}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  disabled={uploading || allPreviewImages.length >= MAX_IMAGES}
                  className="block w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-800"
                  onChange={(e) => void uploadImages(e.target.files)}
                />
                {uploading && (
                  <p className="flex items-center gap-1 text-xs text-indigo-600">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Đang tải ảnh...
                  </p>
                )}
                {attachedImageUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachedImageUrls.map((url) => (
                      <div key={url} className="relative">
                        <img
                          src={url}
                          alt=""
                          className="h-20 w-20 rounded-lg border object-cover"
                        />
                        <button
                          type="button"
                          className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                          onClick={() => removeAttachedUrl(url)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {products.length > 0 && (
                <div className="space-y-2">
                  <Label>Hoặc chọn ảnh từ sản phẩm</Label>
                  <div className="flex flex-wrap gap-2">
                    {products.map((p) => {
                      const thumb = getProductThumb(p);
                      const selected = attachProductIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setAttachProductIds((prev) =>
                              prev.includes(p.id)
                                ? prev.filter((id) => id !== p.id)
                                : [...prev, p.id]
                            )
                          }
                          className={`flex items-center gap-2 rounded-lg border p-1.5 text-xs ${
                            selected ? "border-indigo-500 bg-indigo-50" : ""
                          }`}
                        >
                          {thumb && (
                            <img src={thumb} alt="" className="h-8 w-8 rounded object-cover" />
                          )}
                          <span className="max-w-[90px] truncate">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {customerPhotos.length > 0 && (
                <div className="space-y-2">
                  <Label>Ảnh khách đã mua (tăng tin cậy)</Label>
                  <div className="flex flex-wrap gap-2">
                    {customerPhotos.map((ph) => {
                      const selected = attachPhotoIds.includes(ph.id);
                      return (
                        <button
                          key={ph.id}
                          type="button"
                          onClick={() =>
                            setAttachPhotoIds((prev) =>
                              prev.includes(ph.id)
                                ? prev.filter((id) => id !== ph.id)
                                : [...prev, ph.id]
                            )
                          }
                          className={`overflow-hidden rounded-lg border ${
                            selected ? "border-emerald-500 ring-2 ring-emerald-300" : ""
                          }`}
                        >
                          <img
                            src={ph.imageUrl}
                            alt=""
                            className="h-16 w-16 object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || !text.trim()}
                  onClick={() => void saveTemplate()}
                >
                  {saving ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3 w-3" />
                  )}
                  Lưu mẫu
                </Button>
                {allPreviewImages.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={resetImages}>
                    Bỏ tất cả ảnh
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <Label>
                Xem trước Messenger
                {allPreviewImages.length > 0 && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    · {allPreviewImages.length} ảnh
                  </span>
                )}
              </Label>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  Page · preview
                </div>
                <div className="space-y-2">
                  <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground whitespace-pre-wrap">
                    {previewText}
                  </div>
                  {allPreviewImages.length > 0 && (
                    <div className="flex max-w-[88%] flex-wrap gap-1.5">
                      {allPreviewImages.map((url, i) => (
                        <img
                          key={url}
                          src={url}
                          alt={`Ảnh ${i + 1}`}
                          className="h-28 w-28 rounded-xl border-2 border-white object-cover shadow-sm"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Khách sẽ nhận tin nhắn chữ trước, sau đó từng ảnh — giống chat Messenger thật.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          {step === "done" ? (
            <Button onClick={onClose}>Đóng</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={step === "progress"}
              >
                {step === "progress" ? "Đang gửi..." : "Đóng"}
              </Button>
              {step === "compose" && (
                <Button
                  disabled={!text.trim() || !preview?.reachable}
                  onClick={openConfirm}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Gửi {preview?.reachable ?? 0} khách
                  {sendMode === "within24h" &&
                    (preview?.outside24h ?? 0) > 0 &&
                    ` (bỏ qua ${preview?.outside24h})`}
                  {allPreviewImages.length > 0 && ` · ${allPreviewImages.length} ảnh`}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

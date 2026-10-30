"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Camera, Loader2, Package, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  imageUrls?: string[];
  tags?: string[];
  isActive: boolean;
}

interface CustomerPhoto {
  id: string;
  customerName: string | null;
  caption: string | null;
  imageUrl: string;
  product?: { id: string; name: string } | null;
}

function getAllImages(p: Product): string[] {
  const extra = p.imageUrls || [];
  const all = [p.imageUrl, ...extra].filter((u): u is string => Boolean(u));
  return Array.from(new Set(all));
}

export default function PageProductsPage() {
  const params = useParams();
  const pageId = params.id as string;
  const [pageName, setPageName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [customerPhotos, setCustomerPhotos] = useState<CustomerPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    tags: "",
  });
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoForm, setPhotoForm] = useState({
    customerName: "",
    caption: "",
    productId: "",
  });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    price: "",
    tags: "",
  });
  const [editImageFiles, setEditImageFiles] = useState<File[]>([]);
  const [editImagePreviews, setEditImagePreviews] = useState<string[]>([]);
  const [removeImageUrls, setRemoveImageUrls] = useState<string[]>([]);
  const [editInputKey, setEditInputKey] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [imageFiles]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    const urls = editImageFiles.map((f) => URL.createObjectURL(f));
    setEditImagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [editImageFiles]);

  const handleImageSelect = (files: FileList | null) => {
    if (!files?.length) return;
    setImageFiles(Array.from(files));
    setStatus("");
  };

  const clearImageSelection = () => {
    setImageFiles([]);
    setFileInputKey((k) => k + 1);
  };

  const load = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/products`);
    const data = await res.json();
    setPageName(data.page?.name || "Page");
    setProducts(data.products || []);
    setCustomerPhotos(data.customerPhotos || []);
    setLoading(false);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setStatus("");

    const fd = new FormData();
    fd.append("name", form.name);
    fd.append("description", form.description);
    if (form.price) fd.append("price", form.price);
    if (form.tags) fd.append("tags", form.tags);
    for (const file of imageFiles) fd.append("images", file);

    try {
      const res = await fetch(`/api/pages/${pageId}/products`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Không thể thêm sản phẩm");
        return;
      }
      setForm({ name: "", description: "", price: "", tags: "" });
      clearImageSelection();
      setStatus(`Đã thêm sản phẩm "${data.product?.name || form.name}"`);
      await load();
    } catch {
      setStatus("Lỗi kết nối. Thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const addMoreImages = async (productId: string, files: FileList | null) => {
    if (!files?.length) return;
    setStatus("Đang tải ảnh...");
    const fd = new FormData();
    fd.append("productId", productId);
    for (const file of Array.from(files)) fd.append("images", file);
    try {
      const res = await fetch(`/api/pages/${pageId}/products`, { method: "PATCH", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Không thể thêm ảnh");
        return;
      }
      setStatus(`Đã thêm ${files.length} ảnh`);
      await load();
    } catch {
      setStatus("Lỗi khi tải ảnh");
    }
  };

  const deleteProduct = async (productId: string) => {
    if (!confirm("Xóa sản phẩm này?")) return;
    await fetch(`/api/pages/${pageId}/products?productId=${productId}`, { method: "DELETE" });
    if (editingProduct?.id === productId) setEditingProduct(null);
    await load();
  };

  const startEdit = (p: Product) => {
    setEditingProduct(p);
    setEditForm({
      name: p.name,
      description: p.description || "",
      price: p.price != null ? String(p.price) : "",
      tags: (p.tags || []).join(", "),
    });
    setEditImageFiles([]);
    setRemoveImageUrls([]);
    setEditInputKey((k) => k + 1);
    setStatus("");
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditImageFiles([]);
    setRemoveImageUrls([]);
  };

  const toggleRemoveImage = (url: string) => {
    setRemoveImageUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !editForm.name.trim()) return;
    setSavingEdit(true);
    setStatus("");

    const fd = new FormData();
    fd.append("productId", editingProduct.id);
    fd.append("name", editForm.name);
    fd.append("description", editForm.description);
    fd.append("price", editForm.price);
    fd.append("tags", editForm.tags);
    if (removeImageUrls.length > 0) {
      fd.append("removeImages", JSON.stringify(removeImageUrls));
    }
    for (const file of editImageFiles) fd.append("images", file);

    try {
      const res = await fetch(`/api/pages/${pageId}/products`, { method: "PATCH", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Không thể cập nhật sản phẩm");
        return;
      }
      setStatus(`Đã cập nhật "${data.product?.name || editForm.name}"`);
      setEditingProduct(null);
      setEditImageFiles([]);
      setRemoveImageUrls([]);
      await load();
    } catch {
      setStatus("Lỗi kết nối. Thử lại.");
    } finally {
      setSavingEdit(false);
    }
  };

  const addCustomerPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoFile) return;
    setSavingPhoto(true);
    setStatus("");
    const fd = new FormData();
    fd.append("image", photoFile);
    if (photoForm.customerName) fd.append("customerName", photoForm.customerName);
    if (photoForm.caption) fd.append("caption", photoForm.caption);
    if (photoForm.productId) fd.append("productId", photoForm.productId);
    try {
      const res = await fetch(`/api/pages/${pageId}/customer-photos`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Không thể thêm ảnh khách");
        return;
      }
      setPhotoForm({ customerName: "", caption: "", productId: "" });
      setPhotoFile(null);
      setPhotoInputKey((k) => k + 1);
      setStatus("Đã thêm ảnh khách đã mua");
      await load();
    } catch {
      setStatus("Lỗi khi tải ảnh khách");
    } finally {
      setSavingPhoto(false);
    }
  };

  const deleteCustomerPhoto = async (photoId: string) => {
    if (!confirm("Xóa ảnh này?")) return;
    await fetch(`/api/pages/${pageId}/customer-photos?photoId=${photoId}`, { method: "DELETE" });
    await load();
  };

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
              <Package className="h-6 w-6 text-indigo-600" />
              Sản phẩm — {pageName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Nhiều ảnh sản phẩm · Ảnh khách đã mua giúp AI chốt đơn tự nhiên hơn
            </p>
          </div>
        </div>

        {status && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              status.startsWith("Đã") || status.startsWith("Đang")
                ? "bg-green-50 text-green-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {status}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thêm sản phẩm mới</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void addProduct(e)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Tên sản phẩm *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="VD: Áo thun cotton basic"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Giá (VND)</Label>
                  <Input
                    id="price"
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="299000"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Mô tả (AI dùng để tư vấn)</Label>
                <textarea
                  id="description"
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Chất liệu, size, màu, ưu điểm..."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tags">Tags (phân cách bằng dấu phẩy)</Label>
                  <Input
                    id="tags"
                    value={form.tags}
                    onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="áo, thời trang, nam"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="images">Ảnh sản phẩm (chọn nhiều ảnh cùng lúc)</Label>
                  <div className="rounded-lg border border-dashed p-3">
                    <input
                      key={fileInputKey}
                      ref={fileInputRef}
                      id="images"
                      type="file"
                      accept={IMAGE_ACCEPT}
                      multiple
                      className="block w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700"
                      onChange={(e) => handleImageSelect(e.target.files)}
                    />
                    {imageFiles.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            Đã chọn {imageFiles.length} ảnh
                          </p>
                          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearImageSelection}>
                            Bỏ chọn
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {imagePreviews.map((url, i) => (
                            <img
                              key={url}
                              src={url}
                              alt={`Preview ${i + 1}`}
                              className="h-24 w-24 rounded-lg border object-cover"
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Thêm sản phẩm
              </Button>
            </form>
          </CardContent>
        </Card>

        {editingProduct && (
          <Card className="border-indigo-200 bg-indigo-50/30">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-indigo-600" />
                  Sửa sản phẩm
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void saveEdit(e)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tên sản phẩm *</Label>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Giá (VND)</Label>
                    <Input
                      type="number"
                      value={editForm.price}
                      onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Mô tả</Label>
                  <textarea
                    rows={3}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <Input
                    value={editForm.tags}
                    onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="áo, thời trang, nam"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ảnh hiện tại (bấm X để xóa khi lưu)</Label>
                  <div className="flex flex-wrap gap-2">
                    {getAllImages(editingProduct).map((url, i) => {
                      const marked = removeImageUrls.includes(url);
                      return (
                        <div key={i} className="relative">
                          <img
                            src={url}
                            alt=""
                            className={`h-20 w-20 rounded-lg border object-cover ${marked ? "opacity-40" : ""}`}
                          />
                          <button
                            type="button"
                            className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                            onClick={() => toggleRemoveImage(url)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Thêm ảnh mới (JPG, PNG, WEBP)</Label>
                  <input
                    key={editInputKey}
                    type="file"
                    accept={IMAGE_ACCEPT}
                    multiple
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700"
                    onChange={(e) => setEditImageFiles(Array.from(e.target.files || []))}
                  />
                  {editImagePreviews.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {editImagePreviews.map((url, i) => (
                        <img
                          key={url}
                          src={url}
                          alt={`New ${i + 1}`}
                          className="h-20 w-20 rounded-lg border object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={savingEdit}>
                    {savingEdit ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Pencil className="mr-2 h-4 w-4" />
                    )}
                    Lưu thay đổi
                  </Button>
                  <Button type="button" variant="outline" onClick={cancelEdit}>
                    Hủy
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Danh sách sản phẩm ({products.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : products.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chưa có sản phẩm. Thêm ít nhất 1 sản phẩm kèm ảnh để AI gửi tin nhắn.
              </p>
            ) : (
              <div className="space-y-4">
                {products.map((p) => {
                  const images = getAllImages(p);
                  return (
                    <div key={p.id} className="rounded-xl border p-4">
                      <div className="flex gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{p.name}</p>
                          {p.price != null && (
                            <p className="text-sm text-indigo-600">
                              {formatCurrency(p.price, p.currency)}
                            </p>
                          )}
                          {p.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {p.description}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(p)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500"
                            onClick={() => void deleteProduct(p.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {images.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={p.name}
                            className="h-20 w-20 rounded-lg border object-cover"
                          />
                        ))}
                        <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground hover:bg-muted/50">
                          <Camera className="mb-1 h-4 w-4" />
                          Thêm ảnh
                          <input
                            type="file"
                            accept={IMAGE_ACCEPT}
                            multiple
                            className="hidden"
                            onChange={(e) => void addMoreImages(p.id, e.target.files)}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-emerald-600" />
              Ảnh khách đã mua ({customerPhotos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={(e) => void addCustomerPhoto(e)} className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <p className="text-sm text-muted-foreground">
                Upload ảnh feedback, đơn hàng thật — AI sẽ gửi kèm khi tư vấn để tăng độ tin cậy.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tên khách (tuỳ chọn)</Label>
                  <Input
                    value={photoForm.customerName}
                    onChange={(e) => setPhotoForm((f) => ({ ...f, customerName: e.target.value }))}
                    placeholder="Chị Lan, Anh Minh..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Liên kết sản phẩm</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={photoForm.productId}
                    onChange={(e) => setPhotoForm((f) => ({ ...f, productId: e.target.value }))}
                  >
                    <option value="">— Không chọn —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ghi chú</Label>
                <Input
                  value={photoForm.caption}
                  onChange={(e) => setPhotoForm((f) => ({ ...f, caption: e.target.value }))}
                  placeholder="VD: Khách Hà Nội, size M, giao 2 ngày"
                />
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <div className="space-y-2">
                  <Label>Ảnh đơn hàng / feedback *</Label>
                  <input
                    key={photoInputKey}
                    type="file"
                    accept="image/*"
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  />
                </div>
                {photoPreview && (
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="h-24 w-24 rounded-lg border object-cover"
                  />
                )}
                <Button type="submit" disabled={savingPhoto || !photoFile} className="self-end">
                  {savingPhoto ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Thêm ảnh khách
                </Button>
              </div>
            </form>

            {customerPhotos.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Chưa có ảnh khách đã mua. Thêm ảnh feedback để AI dùng khi chốt đơn.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {customerPhotos.map((ph) => (
                  <div key={ph.id} className="overflow-hidden rounded-xl border">
                    <img src={ph.imageUrl} alt="" className="aspect-square w-full object-cover" />
                    <div className="space-y-1 p-2 text-xs">
                      {ph.customerName && <p className="font-medium">{ph.customerName}</p>}
                      {ph.product?.name && (
                        <p className="text-indigo-600">{ph.product.name}</p>
                      )}
                      {ph.caption && <p className="text-muted-foreground">{ph.caption}</p>}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-red-500"
                        onClick={() => void deleteCustomerPhoto(ph.id)}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Xóa
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

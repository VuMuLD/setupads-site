"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BroadcastModal } from "@/components/messages/broadcast-modal";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Bot,
  ChevronUp,
  Loader2,
  MessageCircle,
  Megaphone,
  RefreshCw,
  Send,
  Sparkles,
  Package,
  Copy,
  Check,
  ShoppingBag,
  Headphones,
  Image as ImageIcon,
  Tag,
  Clock,
  UserX,
  Star,
  Flame,
  Maximize2,
  Minimize2,
  Phone,
  MapPin,
  Box,
  ChevronDown,
  Info,
} from "lucide-react";

import {
  MANUAL_LABEL_OPTIONS,
  type ConversationLabel,
  type ManualConversationLabel,
} from "@/lib/messages/conversation-status";

type OrderCollection = {
  phone: string | null;
  address: string | null;
  productSummary: string | null;
  size: string | null;
  quantity: number | null;
  hasPhone: boolean;
  hasAddress: boolean;
  hasProduct: boolean;
  isComplete: boolean;
  missingFields: Array<"phone" | "address" | "product">;
};

type FilterTab = "all" | "unread" | "consulting" | "closing" | "purchased";

interface PageInfo {
  id: string;
  name: string;
  isSelected: boolean;
  autoAiEnabled: boolean;
  aiTone: string | null;
  unreadCount: number;
  pendingAi: number;
  productCount: number;
}

interface Conversation {
  id: string;
  participantName: string | null;
  snippet: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  labels: ConversationLabel[];
  lastMessage?: {
    id: string;
    text: string;
    aiSuggestedReply: string | null;
  } | null;
}

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  sentAt: string;
  aiSuggestedReply: string | null;
  aiReplyAt: string | null;
  recommendedProducts?: Array<{ id: string; reason: string }> | null;
}

interface Product {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  imageUrls?: string[];
}

interface CustomerPhoto {
  id: string;
  customerName: string | null;
  caption: string | null;
  imageUrl: string;
  product?: { id: string; name: string } | null;
}

const MAX_ATTACH_IMAGES = 10;

function getProductImages(p: Product): string[] {
  const all = [p.imageUrl, ...(p.imageUrls || [])].filter((u): u is string => Boolean(u));
  return Array.from(new Set(all));
}

const LABEL_STYLES: Record<ConversationLabel, { text: string; className: string }> = {
  unread: { text: "Chưa đọc", className: "bg-red-500 text-white" },
  consulting: { text: "Tư vấn", className: "bg-amber-100 text-amber-800 border border-amber-200" },
  closing: { text: "Sắp chốt", className: "bg-orange-100 text-orange-800 border border-orange-200" },
  follow_up: { text: "Theo dõi", className: "bg-sky-100 text-sky-800 border border-sky-200" },
  purchased: { text: "Đã mua", className: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
  lost: { text: "Không mua", className: "bg-slate-200 text-slate-700 border border-slate-300" },
  vip: { text: "VIP", className: "bg-violet-100 text-violet-800 border border-violet-200" },
};

const LABEL_ICONS: Partial<Record<ConversationLabel, typeof Bot>> = {
  purchased: ShoppingBag,
  consulting: Headphones,
  closing: Flame,
  follow_up: Clock,
  lost: UserX,
  vip: Star,
};

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "unread", label: "Chưa đọc" },
  { id: "consulting", label: "Tư vấn" },
  { id: "closing", label: "Sắp chốt" },
  { id: "purchased", label: "Đã mua" },
];

export default function MessagesPage() {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convCursor, setConvCursor] = useState<string | null>(null);
  const [convHasMore, setConvHasMore] = useState(false);
  const [convSyncCursor, setConvSyncCursor] = useState<string | null>(null);
  const [convSyncHasMore, setConvSyncHasMore] = useState(false);
  const [totalConversations, setTotalConversations] = useState(0);
  const [totalMessagesInPage, setTotalMessagesInPage] = useState(0);
  const [msgTotalCount, setMsgTotalCount] = useState(0);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeLabels, setActiveLabels] = useState<ConversationLabel[]>([]);
  const [manualLabels, setManualLabels] = useState<ManualConversationLabel[]>([]);
  const [savingLabels, setSavingLabels] = useState(false);
  const [capturingOrder, setCapturingOrder] = useState(false);
  const [consultingStageLabel, setConsultingStageLabel] = useState("");
  const [customerMemory, setCustomerMemory] = useState<{
    isReturning: boolean;
    totalOrders: number;
    phone: string | null;
    address: string | null;
    memorySummary: string | null;
    preferences: Record<string, unknown>;
    pastOrders: Array<{ productSummary: string | null; confirmedAt: string }>;
    pageLearnings: Array<{ insight: string }>;
  } | null>(null);
  const [orderCollection, setOrderCollection] = useState<OrderCollection | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [threadDetailsOpen, setThreadDetailsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgHasMore, setMsgHasMore] = useState(false);
  const [msgOldestId, setMsgOldestId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerPhotos, setCustomerPhotos] = useState<CustomerPhoto[]>([]);
  const [participantName, setParticipantName] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [syncingOlder, setSyncingOlder] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [attachProductIds, setAttachProductIds] = useState<string[]>([]);
  const [attachCustomerPhotoIds, setAttachCustomerPhotoIds] = useState<string[]>([]);
  const [advising, setAdvising] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [messagingOk, setMessagingOk] = useState<boolean | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [pageProducts, setPageProducts] = useState<Product[]>([]);
  const [pageCustomerPhotos, setPageCustomerPhotos] = useState<CustomerPhoto[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadPages = useCallback(async () => {
    const [pagesRes, statusRes] = await Promise.all([
      fetch("/api/pages"),
      fetch("/api/pages/messaging-status"),
    ]);
    const data = await pagesRes.json();
    const statusData = await statusRes.json();
    const list = data.pages || [];
    setPages(list);
    setMessagingOk(statusData.granted ?? false);
    const selected = list.find((p: PageInfo) => p.isSelected) || list[0];
    if (selected) setSelectedPageId(selected.id);
  }, []);

  const loadConversations = useCallback(
    async (pageId: string, append = false, cursor?: string | null) => {
      if (append) setLoadingMoreConvs(true);
      else setLoadingConvs(true);

      const params = new URLSearchParams({ pageId, limit: "20" });
      if (cursor) params.set("cursor", cursor);
      if (filter !== "all") params.set("filter", filter);

      const res = await fetch(`/api/pages/conversations?${params}`);
      const data = await res.json();
      const list: Conversation[] = data.conversations || [];

      setConversations((prev) => (append ? [...prev, ...list] : list));
      setConvCursor(data.nextCursor ?? null);
      setConvHasMore(Boolean(data.hasMore));
      if (typeof data.totalConversations === "number") {
        setTotalConversations(data.totalConversations);
      }
      if (typeof data.totalMessages === "number") {
        setTotalMessagesInPage(data.totalMessages);
      }

      if (append) setLoadingMoreConvs(false);
      else setLoadingConvs(false);
    },
    [filter]
  );

  const loadThread = useCallback(async (convId: string, before?: string | null) => {
    const params = new URLSearchParams({ limit: "20" });
    if (before) params.set("before", before);

    const res = await fetch(`/api/pages/conversations/${convId}?${params}`);
    const data = await res.json();

    if (before) {
      setMessages((prev) => [...(data.messages || []), ...prev]);
    } else {
      setMessages(data.messages || []);
      setTimeout(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
      }, 50);
    }

    setProducts(data.products || []);
    setCustomerPhotos(data.customerPhotos || []);
    setParticipantName(data.conversation?.participantName || "Khách hàng");
    setActiveLabels(data.conversation?.labels || []);
    setManualLabels(data.conversation?.manualLabels || []);
    setConsultingStageLabel(data.conversation?.consultingStageLabel || "");
    setCustomerMemory(data.conversation?.customerMemory || null);
    setOrderCollection(data.conversation?.orderCollection || null);
    setMsgHasMore(Boolean(data.hasMore));
    setMsgOldestId(data.oldestMessageId ?? null);
    if (typeof data.totalCount === "number") {
      setMsgTotalCount(data.totalCount);
    }
  }, []);

  useEffect(() => {
    const conv = new URLSearchParams(window.location.search).get("conv");
    if (conv) setActiveConvId(conv);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadPages();
      setLoading(false);
    })();
  }, [loadPages]);

  useEffect(() => {
    if (selectedPageId) {
      setConvCursor(null);
      void loadConversations(selectedPageId);
      void fetch(`/api/pages/${selectedPageId}/products`)
        .then((r) => r.json())
        .then((d) => {
          setPageProducts(d.products || []);
          setPageCustomerPhotos(d.customerPhotos || []);
        });
    }
  }, [selectedPageId, filter, loadConversations]);

  useEffect(() => {
    if (activeConvId) {
      setMsgOldestId(null);
      setManualLabels([]);
      setReplyText("");
      setAttachProductIds([]);
      setAttachCustomerPhotoIds([]);
      setThreadDetailsOpen(false);
      void loadThread(activeConvId);
    }
  }, [activeConvId, loadThread]);

  const syncMessages = useCallback(
    async (mode: "recent" | "full" | "more" = "recent", quiet = false) => {
      if (!selectedPageId) return;
      if (!quiet) setSyncing(true);
      if (!quiet) {
        const statusText =
          mode === "full"
            ? "Đang đồng bộ tất cả (tối đa 400 tin)..."
            : mode === "more"
              ? "Đang tải thêm hội thoại từ Messenger..."
              : "Đang đồng bộ 20 hội thoại mới nhất...";
        setStatus(statusText);
      }
      const res = await fetch("/api/pages/sync-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: selectedPageId,
          syncMode: mode,
          conversationsAfter: mode === "more" ? convSyncCursor : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (mode === "more" || mode === "recent") {
          setConvSyncCursor(data.conversationsNextCursor ?? null);
          setConvSyncHasMore(Boolean(data.hasMoreConversations));
        } else {
          setConvSyncCursor(null);
          setConvSyncHasMore(false);
        }
        if (!quiet) {
          const label =
            mode === "full"
              ? `Đồng bộ tất cả xong`
              : mode === "more"
                ? `Tải thêm`
                : `Đồng bộ 20`;
          setStatus(
            `${label}: ${data.conversationsSynced} hội thoại, ${data.messagesSynced} tin nhắn` +
              (data.aiSuggestions ? `, AI đã trả lời ${data.aiSuggestions} tin` : "") +
              (mode === "full" && data.maxMessages
                ? ` (giới hạn ${data.maxMessages} tin/lần)`
                : "")
          );
        } else if (data.messagesSynced > 0 || data.aiSuggestions > 0) {
          setStatus(
            `AI tự động: ${data.messagesSynced} tin mới` +
              (data.aiSuggestions ? `, đã trả lời ${data.aiSuggestions} khách` : "")
          );
        }
        await loadConversations(selectedPageId);
        if (activeConvId) await loadThread(activeConvId);
        await loadPages();
      } else if (!quiet) {
        setStatus(data.error || "Đồng bộ thất bại");
        if (data.code === "MESSAGING_PERMISSION") setMessagingOk(false);
      }
      if (!quiet) setSyncing(false);
    },
    [selectedPageId, convSyncCursor, activeConvId, loadConversations, loadThread, loadPages]
  );

  const loadOlderMessages = async () => {
    if (!activeConvId) return;
    setLoadingMoreMsgs(true);

    if (msgHasMore && msgOldestId) {
      await loadThread(activeConvId, msgOldestId);
      setLoadingMoreMsgs(false);
      return;
    }

    setSyncingOlder(true);
    const res = await fetch(`/api/pages/conversations/${activeConvId}/sync-older`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.success && data.messagesSynced > 0) {
      await loadThread(activeConvId, msgOldestId);
      setStatus(`Đã tải thêm ${data.messagesSynced} tin nhắn cũ`);
    } else if (data.success) {
      setStatus("Không còn tin nhắn cũ trên Messenger");
      setMsgHasMore(false);
    } else {
      setStatus(data.error || "Không tải được tin cũ");
    }
    setSyncingOlder(false);
    setLoadingMoreMsgs(false);
  };

  const captureOrderFromMessages = async () => {
    if (!activeConvId || capturingOrder) return;
    if (orderCollection && !orderCollection.isComplete) {
      const missing = [
        !orderCollection.hasProduct && "hàng hóa/sản phẩm",
        !orderCollection.hasPhone && "SĐT",
        !orderCollection.hasAddress && "địa chỉ giao hàng",
      ].filter(Boolean);
      setStatus(`Thiếu thông tin: ${missing.join(", ")}. Hỏi khách hoặc đợi khách gửi thêm trong chat.`);
      return;
    }
    setCapturingOrder(true);
    setStatus("");
    try {
      const res = await fetch(`/api/pages/conversations/${activeConvId}/capture-order`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Không nhận được đơn từ tin nhắn");
        return;
      }
      setStatus(data.message || `Đã nhận đơn #${data.orderCode}`);
      await loadThread(activeConvId);
      if (selectedPageId) await loadConversations(selectedPageId);
    } catch {
      setStatus("Lỗi khi nhận đơn");
    } finally {
      setCapturingOrder(false);
    }
  };

  const toggleManualLabel = async (label: ManualConversationLabel) => {
    if (!activeConvId || savingLabels) return;
    setSavingLabels(true);
    try {
      const res = await fetch(`/api/pages/conversations/${activeConvId}/labels`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle: label }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Không cập nhật được thẻ");
        return;
      }
      setManualLabels(data.manualLabels || []);
      setActiveLabels(data.labels || []);
      if (selectedPageId) await loadConversations(selectedPageId);
    } catch {
      setStatus("Lỗi khi lưu thẻ");
    } finally {
      setSavingLabels(false);
    }
  };

  const clearManualLabels = async () => {
    if (!activeConvId || savingLabels) return;
    setSavingLabels(true);
    try {
      const res = await fetch(`/api/pages/conversations/${activeConvId}/labels`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setManualLabels([]);
        setActiveLabels(data.labels || []);
        if (selectedPageId) await loadConversations(selectedPageId);
        setStatus("Đã xóa thẻ thủ công — dùng tự động");
      }
    } finally {
      setSavingLabels(false);
    }
  };

  const toggleAutoAi = async () => {
    if (!selectedPageId) return;
    const page = pages.find((p) => p.id === selectedPageId);
    await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageId: selectedPageId,
        action: "toggleAutoAi",
        autoAiEnabled: !page?.autoAiEnabled,
      }),
    });
    await loadPages();
    setStatus(page?.autoAiEnabled ? "Đã tắt AI tự động" : "Đã bật AI tự động — tin mới sẽ được AI tư vấn & trả lời theo luồng");
  };

  const selectedPage = useMemo(
    () => pages.find((p) => p.id === selectedPageId) ?? null,
    [pages, selectedPageId]
  );

  useEffect(() => {
    if (!selectedPageId || !selectedPage?.autoAiEnabled) return;
    const interval = setInterval(() => {
      void syncMessages("recent", true);
    }, 45000);
    return () => clearInterval(interval);
  }, [selectedPageId, selectedPage?.autoAiEnabled, syncMessages]);

  const toggleAttachProduct = (productId: string) => {
    setAttachProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const toggleAttachCustomerPhoto = (photoId: string) => {
    setAttachCustomerPhotoIds((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId]
    );
  };

  const selectedImageCount = useMemo(() => {
    let count = 0;
    for (const id of attachProductIds) {
      const p = products.find((x) => x.id === id);
      if (p) count += getProductImages(p).length;
    }
    count += attachCustomerPhotoIds.length;
    return Math.min(count, MAX_ATTACH_IMAGES);
  }, [attachProductIds, attachCustomerPhotoIds, products]);

  const sendReply = async (opts?: { useAi?: boolean; text?: string; imageProductIds?: string[] }) => {
    if (!activeConvId) return;
    setSending(true);
    const res = await fetch(`/api/pages/conversations/${activeConvId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: opts?.text ?? replyText,
        imageProductIds: opts?.imageProductIds ?? attachProductIds,
        customerPhotoIds: attachCustomerPhotoIds,
        useAi: opts?.useAi ?? false,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setReplyText("");
      setAttachProductIds([]);
      setAttachCustomerPhotoIds([]);
      await loadThread(activeConvId);
      if (selectedPageId) await loadConversations(selectedPageId);
      setStatus(
        `Đã gửi tin nhắn${data.imageCount ? ` + ${data.imageCount} hình ảnh` : ""} qua Messenger`
      );
    } else {
      setStatus(data.error || "Gửi tin thất bại");
    }
    setSending(false);
  };

  const fillFromAi = async (messageId: string) => {
    setAdvising(messageId);
    const res = await fetch(`/api/pages/messages/${messageId}/advise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ send: false }),
    });
    const data = await res.json();
    if (data.reply) {
      setReplyText(data.reply);
      const ids =
        data.sendImages?.length > 0
          ? data.sendImages
          : data.recommendedProducts?.map((p: { id: string }) => p.id) || [];
      setAttachProductIds(ids);
      if (data.sendCustomerPhotos?.length) {
        setAttachCustomerPhotoIds(data.sendCustomerPhotos);
      }
      setStatus("AI đã soạn tin — bạn có thể chỉnh sửa rồi gửi");
    } else {
      setStatus(data.error || "Không tạo được gợi ý");
    }
    setAdvising(null);
  };

  const requestAdvice = async (messageId: string, send = false) => {
    setAdvising(messageId);
    const res = await fetch(`/api/pages/messages/${messageId}/advise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        send,
        text: send ? undefined : replyText || undefined,
        imageProductIds: attachProductIds.length > 0 ? attachProductIds : undefined,
        customerPhotoIds: attachCustomerPhotoIds.length > 0 ? attachCustomerPhotoIds : undefined,
      }),
    });
    const data = await res.json();
    if (data.reply && activeConvId) {
      if (send) {
        await loadThread(activeConvId);
        if (selectedPageId) await loadConversations(selectedPageId);
        setReplyText("");
        setAttachProductIds([]);
        setAttachCustomerPhotoIds([]);
      }
      setStatus(send ? "Đã gửi tin nhắn + hình ảnh qua Messenger" : "AI đã tạo gợi ý trả lời");
    } else {
      setStatus(data.error || "Không tạo được gợi ý");
    }
    setAdvising(null);
  };

  const copyReply = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const filterCounts = useMemo(() => {
    const counts = {
      all: conversations.length,
      unread: 0,
      consulting: 0,
      closing: 0,
      purchased: 0,
    };
    for (const c of conversations) {
      if (c.labels.includes("unread")) counts.unread++;
      if (
        c.labels.includes("consulting") ||
        c.labels.includes("follow_up")
      ) {
        counts.consulting++;
      }
      if (c.labels.includes("closing")) counts.closing++;
      if (c.labels.includes("purchased")) counts.purchased++;
    }
    return counts;
  }, [conversations]);

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <MessageCircle className="h-7 w-7 text-indigo-600" />
              Tin nhắn Page
            </h1>
            <p className="text-sm text-muted-foreground">
              Nhắn trực tiếp · AI tự động trả lời kèm hình · Tư vấn tự nhiên, ngắn gọn
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void syncMessages("recent")}
              disabled={syncing || !selectedPageId}
            >
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Đồng bộ 20
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void syncMessages("full")}
              disabled={syncing || !selectedPageId}
            >
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Đồng bộ tất cả
            </Button>
            <Button
              variant={selectedPage?.autoAiEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => void toggleAutoAi()}
              disabled={!selectedPageId}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {selectedPage?.autoAiEnabled ? "AI tự động: BẬT" : "AI tự động: TẮT"}
            </Button>
            {selectedPageId && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/pages/${selectedPageId}/products`}>
                  <Package className="mr-2 h-4 w-4" />
                  Sản phẩm ({selectedPage?.productCount ?? 0})
                </Link>
              </Button>
            )}
            {selectedPageId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBroadcastOpen(true)}
              >
                <Megaphone className="mr-2 h-4 w-4" />
                Gửi khách cũ
              </Button>
            )}
          </div>
        </div>

        {messagingOk === false && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Cần cấp quyền Messenger (pages_messaging)</p>
            <p className="mt-1 text-amber-900">
              Tài khoản Facebook hiện chưa có quyền đọc tin nhắn Page. Bấm nút bên dưới để kết nối lại và
              chấp nhận tất cả quyền — đặc biệt <strong>pages_messaging</strong>.
            </p>
            <Button className="mt-3 bg-[#1877F2] hover:bg-[#166FE5]" asChild>
              <a href="/api/facebook/connect?for=messages">Cấp quyền Messenger</a>
            </Button>
          </div>
        )}

        {status && (
          <p className="whitespace-pre-wrap rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
            {status}
          </p>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : pages.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Chưa có Page. Kết nối Facebook trong Cài đặt.</p>
              <Button className="mt-4" asChild>
                <Link href="/settings">Đi tới Cài đặt</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div
            className={`grid min-h-0 flex-1 gap-4 ${
              chatExpanded ? "lg:grid-cols-1" : "lg:grid-cols-[220px_300px_1fr]"
            }`}
          >
            {/* Pages */}
            {!chatExpanded && (
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Facebook Pages</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-2 pt-0">
                {pages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPageId(p.id);
                      setActiveConvId(null);
                      setConvSyncCursor(null);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      p.id === selectedPageId ? "bg-indigo-100 text-indigo-900" : "hover:bg-muted"
                    }`}
                  >
                    <p className="truncate font-medium">{p.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {p.unreadCount > 0 && (
                        <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">
                          {p.unreadCount} chưa đọc
                        </span>
                      )}
                      {p.pendingAi > 0 && (
                        <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] text-indigo-700">
                          {p.pendingAi} chờ AI
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {p.autoAiEnabled ? "AI ON" : "AI OFF"}
                      </span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
            )}

            {/* Conversations */}
            {!chatExpanded && (
            <Card className="flex min-h-0 flex-col overflow-hidden">
              <CardHeader className="space-y-2 pb-2">
                <CardTitle className="text-sm">
                  Hội thoại
                  {totalConversations > 0 && (
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      Đang xem {conversations.length}/{totalConversations} hội thoại
                      {totalMessagesInPage > 0 && ` · ${totalMessagesInPage.toLocaleString("vi-VN")} tin`}
                    </span>
                  )}
                </CardTitle>
                <div className="flex flex-wrap gap-1">
                  {FILTER_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        filter === tab.id
                          ? "bg-indigo-600 text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {tab.label}
                      {filterCounts[tab.id] > 0 && tab.id !== "all" && ` (${filterCounts[tab.id]})`}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col p-2 pt-0">
                {loadingConvs ? (
                  <div className="flex flex-1 items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : conversations.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    {filter === "all" ? "Chưa có tin nhắn. Bấm Đồng bộ." : "Không có hội thoại trong mục này."}
                  </p>
                ) : (
                  <div className="flex-1 space-y-1 overflow-y-auto">
                    {conversations.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setActiveConvId(c.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          c.id === activeConvId
                            ? "border-indigo-300 bg-indigo-50"
                            : c.labels.includes("unread")
                              ? "border-red-100 bg-red-50/40 hover:bg-red-50/70"
                              : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span
                            className={`truncate text-sm font-medium ${
                              c.labels.includes("unread") ? "font-semibold" : ""
                            }`}
                          >
                            {c.participantName || "Khách"}
                          </span>
                          {c.lastMessageAt && (
                            <span className="shrink-0 text-[9px] text-muted-foreground">
                              {new Date(c.lastMessageAt).toLocaleDateString("vi-VN", {
                                day: "2-digit",
                                month: "2-digit",
                              })}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {c.snippet || c.lastMessage?.text}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {c.labels.map((label) => {
                            const Icon = LABEL_ICONS[label];
                            return (
                              <span
                                key={label}
                                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${LABEL_STYLES[label].className}`}
                              >
                                {Icon && <Icon className="h-2.5 w-2.5" />}
                                {LABEL_STYLES[label].text}
                              </span>
                            );
                          })}
                          {c.lastMessage?.aiSuggestedReply && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] text-indigo-600">
                              <Bot className="h-2.5 w-2.5" /> AI
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-2 space-y-1 border-t pt-2">
                  {convHasMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full text-xs"
                      disabled={loadingMoreConvs}
                      onClick={() =>
                        selectedPageId && void loadConversations(selectedPageId, true, convCursor)
                      }
                    >
                      {loadingMoreConvs ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <ChevronUp className="mr-1 h-3 w-3 rotate-180" />
                      )}
                      Xem thêm hội thoại
                      {totalConversations > 0 && ` (${conversations.length}/${totalConversations})`}
                    </Button>
                  )}
                  {convSyncHasMore && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-full text-xs"
                      disabled={syncing}
                      onClick={() => void syncMessages("more")}
                    >
                      {syncing ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
                      Đồng bộ thêm từ Messenger
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            )}

            {/* Thread */}
            <Card className={`flex min-h-0 flex-col overflow-hidden ${chatExpanded ? "min-h-[70vh]" : ""}`}>
              {activeConvId ? (
                <>
                  <CardHeader className="shrink-0 space-y-0 border-b px-3 py-2">
                    {/* Hàng 1: tên + nhãn + hành động */}
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                          {participantName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight">{participantName}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            {Array.from(new Set(activeLabels)).map((label) => {
                              const Icon = LABEL_ICONS[label];
                              return (
                                <span
                                  key={label}
                                  className={`inline-flex items-center rounded px-1.5 py-px text-[9px] font-medium ${LABEL_STYLES[label].className}`}
                                >
                                  {Icon && <Icon className="mr-0.5 h-2.5 w-2.5" />}
                                  {LABEL_STYLES[label].text}
                                </span>
                              );
                            })}
                            {consultingStageLabel && (
                              <span className="rounded bg-indigo-50 px-1.5 py-px text-[9px] font-medium text-indigo-700">
                                {consultingStageLabel}
                              </span>
                            )}
                            {customerMemory && (
                              <span className="rounded bg-violet-50 px-1.5 py-px text-[9px] text-violet-700">
                                {customerMemory.isReturning ? "Khách quen" : "Khách mới"}
                                {customerMemory.totalOrders > 0 && ` · ${customerMemory.totalOrders}đ`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-emerald-700 hover:bg-emerald-50"
                          title="Nhận đơn từ tin nhắn"
                          disabled={capturingOrder}
                          onClick={() => void captureOrderFromMessages()}
                        >
                          {capturingOrder ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Package className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Link href="/orders">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Xem đơn hàng"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={`h-7 px-1.5 text-[10px] ${threadDetailsOpen ? "bg-muted" : ""}`}
                          title="Chi tiết đơn, nhãn, AI"
                          onClick={() => setThreadDetailsOpen((v) => !v)}
                        >
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${threadDetailsOpen ? "rotate-180" : ""}`}
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title={chatExpanded ? "Thu nhỏ chat" : "Mở rộng chat"}
                          onClick={() => setChatExpanded((v) => !v)}
                        >
                          {chatExpanded ? (
                            <Minimize2 className="h-3.5 w-3.5" />
                          ) : (
                            <Maximize2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Hàng 2: tóm tắt đơn — luôn gọn, 1 dòng */}
                    {orderCollection && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            orderCollection.hasProduct
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-50 text-amber-700"
                          }`}
                          title={orderCollection.productSummary || "Chưa có hàng hóa"}
                        >
                          <Box className="h-3 w-3" />
                          {orderCollection.hasProduct ? "Hàng ✓" : "Hàng ?"}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            orderCollection.hasPhone
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-50 text-amber-700"
                          }`}
                          title={orderCollection.phone || "Chưa có SĐT"}
                        >
                          <Phone className="h-3 w-3" />
                          {orderCollection.hasPhone ? "SĐT ✓" : "SĐT ?"}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            orderCollection.hasAddress
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-50 text-amber-700"
                          }`}
                          title={orderCollection.address || "Chưa có địa chỉ"}
                        >
                          <MapPin className="h-3 w-3" />
                          {orderCollection.hasAddress ? "ĐC ✓" : "ĐC ?"}
                        </span>
                        <span
                          className={`text-[10px] ${
                            orderCollection.isComplete ? "text-emerald-600" : "text-amber-600"
                          }`}
                        >
                          {orderCollection.isComplete
                            ? "· Đủ thông tin"
                            : `· Thiếu ${orderCollection.missingFields.length}`}
                        </span>
                      </div>
                    )}

                    {/* Panel chi tiết — thu gọn mặc định */}
                    {threadDetailsOpen && (
                      <div className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-2">
                        {orderCollection && (
                          <div className="grid gap-1.5 text-[10px] sm:grid-cols-3">
                            <div className="rounded-md bg-background px-2 py-1.5">
                              <p className="font-medium text-muted-foreground">Hàng hóa</p>
                              <p className="mt-0.5 line-clamp-2 text-foreground">
                                {orderCollection.productSummary || "—"}
                              </p>
                            </div>
                            <div className="rounded-md bg-background px-2 py-1.5">
                              <p className="font-medium text-muted-foreground">SĐT</p>
                              <p className="mt-0.5 text-foreground">{orderCollection.phone || "—"}</p>
                            </div>
                            <div className="rounded-md bg-background px-2 py-1.5">
                              <p className="font-medium text-muted-foreground">Địa chỉ</p>
                              <p className="mt-0.5 line-clamp-2 text-foreground">
                                {orderCollection.address || "—"}
                              </p>
                            </div>
                          </div>
                        )}

                        <div>
                          <p
                            className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
                            title='Thẻ "Đã mua" chỉ khi khách gửi SĐT/địa chỉ/chốt đơn — không từ tin AI'
                          >
                            <Tag className="h-3 w-3" />
                            Nhãn thủ công
                            {savingLabels && <Loader2 className="h-3 w-3 animate-spin" />}
                            <Info className="h-3 w-3 opacity-50" />
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {MANUAL_LABEL_OPTIONS.map((opt) => {
                              const active = manualLabels.includes(opt.id);
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  title={opt.hint}
                                  disabled={savingLabels}
                                  onClick={() => void toggleManualLabel(opt.id)}
                                  className={`rounded-full border px-2 py-0.5 text-[9px] font-medium transition ${
                                    active
                                      ? opt.className + " ring-1 ring-indigo-300"
                                      : "border-dashed bg-background text-muted-foreground hover:bg-muted/50"
                                  }`}
                                >
                                  {opt.text}
                                </button>
                              );
                            })}
                            {manualLabels.length > 0 && (
                              <button
                                type="button"
                                disabled={savingLabels}
                                onClick={() => void clearManualLabels()}
                                className="px-1 text-[9px] text-muted-foreground underline"
                              >
                                Tự động
                              </button>
                            )}
                          </div>
                        </div>

                        {customerMemory?.pageLearnings[0] && (
                          <p className="line-clamp-2 text-[10px] italic text-violet-600">
                            💡 {customerMemory.pageLearnings[0].insight}
                          </p>
                        )}

                        {products.length > 0 && (
                          <p className="text-[9px] text-muted-foreground">
                            AI: {products.length} SP
                            {customerPhotos.length > 0 && ` · ${customerPhotos.length} ảnh`}
                            {selectedPage?.autoAiEnabled && " · auto ON"}
                          </p>
                        )}
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                    <div className="border-b px-4 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full text-xs"
                        disabled={loadingMoreMsgs || syncingOlder}
                        onClick={() => void loadOlderMessages()}
                      >
                        {loadingMoreMsgs || syncingOlder ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <ChevronUp className="mr-1 h-3 w-3" />
                        )}
                        {msgHasMore
                          ? `Tải tin cũ hơn${msgTotalCount > 0 ? ` (${messages.length}/${msgTotalCount} tin)` : ""}`
                          : `Tải thêm từ Messenger${msgTotalCount > 0 ? ` (${messages.length}/${msgTotalCount} tin)` : ""}`}
                      </Button>
                    </div>
                    <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                      {messages.map((msg) => (
                        <div key={msg.id} className="space-y-2">
                          <div
                            className={`flex ${msg.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                                msg.direction === "OUTBOUND"
                                  ? "rounded-tr-sm bg-primary text-primary-foreground"
                                  : "rounded-tl-sm border bg-muted/60"
                              }`}
                            >
                              {msg.text}
                              <p className="mt-1 text-[10px] opacity-60">
                                {new Date(msg.sentAt).toLocaleString("vi-VN")}
                              </p>
                            </div>
                          </div>

                          {msg.direction === "INBOUND" && (
                            <div className="ml-2 max-w-[90%] rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-3">
                              <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-indigo-700">
                                <Bot className="h-3.5 w-3.5" />
                                Gợi ý trả lời AI
                                {consultingStageLabel && (
                                  <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-normal">
                                    {consultingStageLabel}
                                  </span>
                                )}
                              </div>
                              {msg.aiSuggestedReply ? (
                                <>
                                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                    {msg.aiSuggestedReply}
                                  </p>
                                  {msg.recommendedProducts &&
                                    Array.isArray(msg.recommendedProducts) &&
                                    msg.recommendedProducts.length > 0 && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {msg.recommendedProducts.map((rp, i) => {
                                          const prod = products.find((p) => p.id === rp.id);
                                          return (
                                            <div
                                              key={i}
                                              className="flex items-center gap-1 rounded-lg border bg-white px-1.5 py-1 text-[10px]"
                                            >
                                              {prod?.imageUrl && (
                                                <img
                                                  src={prod.imageUrl}
                                                  alt=""
                                                  className="h-8 w-8 rounded object-cover"
                                                />
                                              )}
                                              <span>{prod?.name || rp.id}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={() => {
                                        setReplyText(msg.aiSuggestedReply || "");
                                        const ids =
                                          msg.recommendedProducts?.map((p) => p.id) || [];
                                        setAttachProductIds(ids.slice(0, 3));
                                      }}
                                    >
                                      Chỉnh sửa
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={() => void copyReply(msg.aiSuggestedReply!, msg.id)}
                                    >
                                      {copied === msg.id ? (
                                        <Check className="mr-1 h-3 w-3" />
                                      ) : (
                                        <Copy className="mr-1 h-3 w-3" />
                                      )}
                                      Sao chép
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      disabled={advising === msg.id}
                                      onClick={() => void requestAdvice(msg.id, false)}
                                    >
                                      {advising === msg.id ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : (
                                        <Sparkles className="mr-1 h-3 w-3" />
                                      )}
                                      Tạo lại
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs"
                                      disabled={advising === msg.id}
                                      onClick={() => void requestAdvice(msg.id, true)}
                                    >
                                      <Send className="mr-1 h-3 w-3" />
                                      Gửi ngay
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={advising === msg.id}
                                  onClick={() => void fillFromAi(msg.id)}
                                >
                                  {advising === msg.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Sparkles className="mr-2 h-4 w-4" />
                                  )}
                                  Gợi ý AI
                                </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Reply composer */}
                    <div className="border-t bg-muted/20 p-3">
                      {products.length > 0 && (
                        <div className="mb-2">
                          <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                            Ảnh sản phẩm (chọn SP → gửi tất cả ảnh của SP)
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {products.map((p) => {
                              const imgs = getProductImages(p);
                              const selected = attachProductIds.includes(p.id);
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => toggleAttachProduct(p.id)}
                                  className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] transition-colors ${
                                    selected
                                      ? "border-indigo-400 bg-indigo-50 text-indigo-800"
                                      : "bg-white hover:bg-muted/50"
                                  }`}
                                >
                                  {imgs[0] ? (
                                    <img src={imgs[0]} alt="" className="h-6 w-6 rounded object-cover" />
                                  ) : (
                                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <span className="max-w-[72px] truncate">{p.name}</span>
                                  {imgs.length > 1 && (
                                    <span className="rounded bg-muted px-1">+{imgs.length - 1}</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {customerPhotos.length > 0 && (
                        <div className="mb-2">
                          <p className="mb-1 text-[10px] font-medium text-emerald-700">
                            Ảnh khách đã mua (social proof)
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {customerPhotos.map((ph) => (
                              <button
                                key={ph.id}
                                type="button"
                                onClick={() => toggleAttachCustomerPhoto(ph.id)}
                                className={`overflow-hidden rounded-lg border text-left transition-colors ${
                                  attachCustomerPhotoIds.includes(ph.id)
                                    ? "border-emerald-500 ring-2 ring-emerald-200"
                                    : "hover:border-emerald-300"
                                }`}
                              >
                                <img
                                  src={ph.imageUrl}
                                  alt=""
                                  className="h-14 w-14 object-cover"
                                />
                                {ph.customerName && (
                                  <p className="max-w-[72px] truncate px-1 pb-0.5 text-[9px]">
                                    {ph.customerName}
                                  </p>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              if (replyText.trim()) void sendReply();
                            }
                          }}
                          placeholder="Nhập tin trả lời khách..."
                          rows={2}
                          className="flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            disabled={sending || !replyText.trim()}
                            onClick={() => void sendReply()}
                          >
                            {sending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={sending}
                            title="AI soạn tin tự nhiên"
                            onClick={() => void sendReply({ useAi: true })}
                          >
                            <Sparkles className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        Enter gửi · Shift+Enter xuống dòng · Tối đa {MAX_ATTACH_IMAGES} ảnh
                        {selectedImageCount > 0 && ` (đã chọn ~${selectedImageCount})`}
                        {customerPhotos.length === 0 && selectedPageId && (
                          <>
                            {" · "}
                            <Link href={`/pages/${selectedPageId}/products`} className="text-indigo-600 underline">
                              Thêm ảnh khách đã mua
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </CardContent>
                </>
              ) : (
                <CardContent className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  Chọn hội thoại để xem tin nhắn và gợi ý AI
                </CardContent>
              )}
            </Card>
          </div>
        )}
      </div>

      {selectedPageId && (
        <BroadcastModal
          pageId={selectedPageId}
          pageName={selectedPage?.name || "Page"}
          products={pageProducts}
          customerPhotos={pageCustomerPhotos}
          open={broadcastOpen}
          onClose={() => setBroadcastOpen(false)}
          onSent={(msg) => {
            setStatus(msg);
            setBroadcastOpen(false);
            void loadConversations(selectedPageId);
          }}
        />
      )}
    </DashboardLayout>
  );
}

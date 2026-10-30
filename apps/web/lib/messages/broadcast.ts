import { prisma } from "@/lib/prisma";
import {
  personalizeTemplate,
  formatMessengerText,
} from "@/lib/messages/message-templates";
import {
  getAudienceMembers,
  getBroadcastSendStrategy,
  type BroadcastAudience,
  type BroadcastSendMode,
  type AudienceMember,
} from "@/lib/messages/old-customers";
import {
  resolveProductImageUrls,
  sendConversationReply,
  formatMessengerSendError,
} from "@/lib/messages/send-page-reply";
import { MAX_ATTACH_IMAGES } from "@/lib/messages/product-images";

const DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RunBroadcastOptions {
  pageId: string;
  userId: string;
  audience: BroadcastAudience;
  text: string;
  imageUrls?: string[];
  templateId?: string;
  sendMode?: BroadcastSendMode;
}

export interface BroadcastStartResult {
  broadcastId: string;
  total: number;
  reachable: number;
  skippedOutside24h: number;
  sendMode: BroadcastSendMode;
  pageName: string;
  pageId: string;
}

export type BroadcastResultStatus = "sent" | "failed" | "skipped";

export interface BroadcastStatus {
  broadcastId: string;
  status: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  totalSteps: number;
  reachable: number;
  pageName: string;
  pageId: string;
  audience: string;
  currentRecipient: string | null;
  results: Array<{
    conversationId: string;
    name: string | null;
    status: BroadcastResultStatus;
    error?: string;
  }>;
}

const SKIP_OUTSIDE_24H_MSG =
  "Ngoài cửa sổ 24h — Facebook không cho gửi tin khuyến mãi cho khách chưa nhắn gần đây";

async function processBroadcast(
  broadcastId: string,
  options: RunBroadcastOptions,
  allMembers: AudienceMember[],
  sendTargets: AudienceMember[],
  pageName: string,
  sendMode: BroadcastSendMode
) {
  const text = formatMessengerText(options.text);
  const imageUrls = options.imageUrls || [];
  const results: BroadcastStatus["results"] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const targetIds = new Set(sendTargets.map((m) => m.id));

  for (const member of allMembers) {
    if (!targetIds.has(member.id)) {
      skipped++;
      results.push({
        conversationId: member.id,
        name: member.participantName,
        status: "skipped",
        error: SKIP_OUTSIDE_24H_MSG,
      });
      await prisma.pageBroadcast.update({
        where: { id: broadcastId },
        data: { sentCount: sent, failedCount: failed, results },
      });
      continue;
    }

    const personalized = personalizeTemplate(text, {
      name: member.participantName,
      pageName,
    });

    const sendStrategy =
      sendMode === "all"
        ? getBroadcastSendStrategy(member)
        : { messagingType: "RESPONSE" as const };

    try {
      await sendConversationReply({
        conversationId: member.id,
        userId: options.userId,
        text: personalized,
        imageUrls,
        messagingType: sendStrategy.messagingType,
        tag: sendStrategy.tag,
      });
      sent++;
      results.push({
        conversationId: member.id,
        name: member.participantName,
        status: "sent",
      });
    } catch (err) {
      failed++;
      results.push({
        conversationId: member.id,
        name: member.participantName,
        status: "failed",
        error: formatMessengerSendError(err),
      });
    }

    await prisma.pageBroadcast.update({
      where: { id: broadcastId },
      data: {
        sentCount: sent,
        failedCount: failed,
        results,
      },
    });

    await sleep(DELAY_MS);
  }

  await prisma.pageBroadcast.update({
    where: { id: broadcastId },
    data: {
      status:
        sent === 0 && sendTargets.length > 0 && failed > 0
          ? "failed"
          : "done",
      sentCount: sent,
      failedCount: failed,
      results,
    },
  });
}

export async function startBroadcast(
  options: RunBroadcastOptions
): Promise<BroadcastStartResult> {
  const page = await prisma.page.findFirst({
    where: {
      id: options.pageId,
      facebookAccount: { userId: options.userId },
    },
  });
  if (!page) throw new Error("Page không tồn tại");

  const text = formatMessengerText(options.text);
  if (!text.trim()) throw new Error("Nội dung tin nhắn trống");

  const sendMode = options.sendMode || "within24h";
  const imageUrls = options.imageUrls || [];
  const allMembers = await getAudienceMembers(options.pageId, options.audience);
  const sendTargets =
    sendMode === "all" ? allMembers : allMembers.filter((m) => m.within24h);

  if (sendTargets.length === 0) {
    throw new Error(
      sendMode === "all"
        ? "Không có khách nào trong nhóm đã chọn."
        : `Không có khách nào trong cửa sổ 24h. ` +
            `${allMembers.length} khách ngoài 24h — bật "Gửi tất cả khách" để thử gửi.`
    );
  }

  const broadcast = await prisma.pageBroadcast.create({
    data: {
      pageId: options.pageId,
      templateId: options.templateId || null,
      audience: options.audience,
      text,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      status: "running",
      totalCount: sendTargets.length,
    },
  });

  void processBroadcast(
    broadcast.id,
    options,
    allMembers,
    sendTargets,
    page.name,
    sendMode
  ).catch((err) => {
    console.error("[broadcast] process failed:", err);
    void prisma.pageBroadcast.update({
      where: { id: broadcast.id },
      data: { status: "failed" },
    });
  });

  return {
    broadcastId: broadcast.id,
    total: allMembers.length,
    reachable: sendTargets.length,
    skippedOutside24h: sendMode === "all" ? 0 : allMembers.length - sendTargets.length,
    sendMode,
    pageName: page.name,
    pageId: page.id,
  };
}

export async function getBroadcastStatus(
  broadcastId: string,
  userId: string
): Promise<BroadcastStatus | null> {
  const broadcast = await prisma.pageBroadcast.findFirst({
    where: {
      id: broadcastId,
      page: { facebookAccount: { userId } },
    },
    include: { page: { select: { id: true, name: true } } },
  });

  if (!broadcast) return null;

  const results =
    (broadcast.results as BroadcastStatus["results"] | null) || [];
  const last = [...results].reverse().find((r) => r.status !== "skipped") ?? results[results.length - 1];
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  return {
    broadcastId: broadcast.id,
    status: broadcast.status,
    totalCount: broadcast.totalCount,
    sentCount: broadcast.sentCount,
    failedCount: broadcast.failedCount,
    skippedCount,
    totalSteps: results.length || broadcast.totalCount + skippedCount,
    reachable: broadcast.totalCount,
    pageName: broadcast.page.name,
    pageId: broadcast.page.id,
    audience: broadcast.audience,
    currentRecipient: last?.name ?? null,
    results,
  };
}

export async function resolveTemplateImages(
  pageId: string,
  productIds: string[],
  directUrls: string[]
): Promise<string[]> {
  const fromProducts = await resolveProductImageUrls(pageId, productIds, {
    maxPerProduct: 2,
  });
  const all = [...directUrls, ...fromProducts];
  return Array.from(new Set(all)).slice(0, MAX_ATTACH_IMAGES);
}

export async function ensureDefaultTemplates(pageId: string) {
  const count = await prisma.pageMessageTemplate.count({ where: { pageId } });
  if (count > 0) return;

  const { DEFAULT_OLD_CUSTOMER_TEMPLATES } = await import(
    "@/lib/messages/message-templates"
  );

  await prisma.pageMessageTemplate.createMany({
    data: DEFAULT_OLD_CUSTOMER_TEMPLATES.map((t, i) => ({
      pageId,
      name: t.name,
      category: t.category,
      text: t.text,
      sortOrder: i,
    })),
  });
}

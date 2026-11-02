import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/token-encryption";
import { syncAdAccountData } from "@/lib/jobs/sync-data";
import { syncPageMessages } from "@/lib/jobs/sync-page-messages";
import { runFollowUpNudges } from "@/lib/jobs/follow-up-nudge";
import { runScheduledPosts } from "@/lib/jobs/post-scheduler";
import { runLearningHarvest } from "@/lib/jobs/learning-harvest";
import { evaluateAutomationRules } from "@/lib/jobs/rules-engine";
import { createNotification } from "@/lib/notifications/notification-service";
import { isFacebookAppRateLimited } from "@/lib/facebook/rate-limit";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const MESSAGE_SYNC_CRON = process.env.MESSAGE_SYNC_CRON || "*/5 * * * *";

let initialized = false;

export function initCronJobs() {
  if (initialized || process.env.NODE_ENV === "test") return;
  initialized = true;

  cron.schedule("0 */6 * * *", async () => {
    console.log("[Cron] Starting 6-hour data sync...");
    await runSyncForAllAccounts();
  });

  cron.schedule("0 7 * * *", async () => {
    console.log("[Cron] Starting daily AI report at 7:00 AM...");
    await runDailyReport();
  });

  cron.schedule("0 7 * * 1", async () => {
    console.log("[Cron] Starting weekly AI report on Monday 7:00 AM...");
    await runWeeklyReport();
  });

  cron.schedule("0 2 * * *", async () => {
    console.log("[Cron] Running data retention cleanup...");
    await cleanupOldData();
  });

  cron.schedule(MESSAGE_SYNC_CRON, async () => {
    if (isFacebookAppRateLimited()) {
      console.log("[Cron] Skip message sync — Facebook app rate limit cooldown");
      return;
    }
    console.log("[Cron] Syncing page messages (auto AI)...");
    await runPageMessageSync();
  });

  cron.schedule("*/10 * * * *", async () => {
    await runFollowUpNudges();
  });

  cron.schedule("*/5 * * * *", async () => {
    await runScheduledPosts();
  });

  cron.schedule("15 23 * * *", async () => {
    await runLearningHarvest();
  });

  console.log(
    `[Cron] Jobs scheduled: sync(6h), messages(${MESSAGE_SYNC_CRON}), daily(7AM), weekly(Mon 7AM), cleanup(2AM), followup(10m), posts(5m), learn(23:15)`
  );
}

async function runPageMessageSync() {
  const pages = await prisma.page.findMany({
    where: { isActive: true, autoAiEnabled: true },
    include: { facebookAccount: true },
  });

  for (const page of pages) {
    if (isFacebookAppRateLimited()) break;
    try {
      await syncPageMessages(page.id, page.facebookAccount.userId);
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Cron] Page message sync failed ${page.id}:`, err);
    }
  }
}

async function runSyncForAllAccounts() {
  const fbAccounts = await prisma.facebookAccount.findMany({
    where: { isActive: true },
    include: { adAccounts: { where: { isActive: true } } },
  });

  for (const fbAccount of fbAccounts) {
    try {
      const accessToken = decrypt(fbAccount.accessTokenEncrypted);
      for (const adAccount of fbAccount.adAccounts) {
        await syncAdAccountData(adAccount.id, accessToken);
        await evaluateAutomationRules(fbAccount.userId, adAccount.id);
      }
    } catch (err) {
      console.error(`[Cron] Sync failed for account ${fbAccount.id}:`, err);
    }
  }
}

async function runDailyReport() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: {
      facebookAccounts: {
        where: { isActive: true },
        include: { adAccounts: { where: { isActive: true } } },
      },
    },
  });

  for (const user of users) {
    for (const fbAccount of user.facebookAccounts) {
      for (const adAccount of fbAccount.adAccounts) {
        try {
          await generateAIReport(user.id, adAccount.id, "daily");
          await createNotification({
            userId: user.id,
            type: "DAILY_REPORT",
            title: "Báo cáo AI hàng ngày",
            message: `Báo cáo phân tích ngày ${new Date().toLocaleDateString("vi-VN")} đã sẵn sàng.`,
          });
        } catch (err) {
          console.error(`[Cron] Daily report failed for user ${user.id}:`, err);
        }
      }
    }
  }
}

async function runWeeklyReport() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: {
      facebookAccounts: {
        where: { isActive: true },
        include: { adAccounts: { where: { isActive: true } } },
      },
    },
  });

  for (const user of users) {
    for (const fbAccount of user.facebookAccounts) {
      for (const adAccount of fbAccount.adAccounts) {
        try {
          await generateAIReport(user.id, adAccount.id, "weekly");
          await createNotification({
            userId: user.id,
            type: "WEEKLY_REPORT",
            title: "Báo cáo AI hàng tuần",
            message: `Báo cáo phân tích tuần đã sẵn sàng. Xem tại mục Báo cáo.`,
          });
        } catch (err) {
          console.error(`[Cron] Weekly report failed for user ${user.id}:`, err);
        }
      }
    }
  }
}

async function generateAIReport(userId: string, adAccountId: string, type: string) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const campaigns = await prisma.campaign.findMany({
    where: { adAccountId, deletedAt: null },
    include: {
      insights: { where: { date: { gte: thirtyDaysAgo } }, orderBy: { date: "asc" } },
    },
  });

  const dailyInsights = await prisma.dailyInsight.findMany({
    where: { adAccountId, date: { gte: thirtyDaysAgo } },
    orderBy: { date: "asc" },
  });

  const response = await fetch(`${AI_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      campaigns,
      accountInsights: dailyInsights,
      language: "vi",
    }),
  });

  if (!response.ok) return;

  const result = await response.json();

  await prisma.report.create({
    data: {
      userId,
      type,
      period: new Date().toISOString().split("T")[0],
      content: result,
    },
  });

  for (const rec of result.recommendations || []) {
    await prisma.aIRecommendation.create({
      data: {
        userId,
        campaignId: rec.campaignId || null,
        type: rec.type,
        confidence: rec.confidence,
        reasoningVi: rec.reasoningVi,
        suggestedAction: rec.suggestedAction,
        modelSource: result.model || "gemini",
        consensusData: result.consensusData || null,
      },
    });
  }
}

async function cleanupOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  await prisma.campaignInsight.deleteMany({
    where: { date: { lt: cutoff } },
  });
  await prisma.dailyInsight.deleteMany({
    where: { date: { lt: cutoff } },
  });
}

import { prisma } from "@/lib/prisma";
import { getFacebookAccessToken } from "@/lib/auth";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import { createNotification } from "@/lib/notifications/notification-service";
import { createAuditLog } from "@/lib/security/audit-log";

interface Condition {
  metric: string;
  operator: string;
  value: number;
  period: string;
}

interface Action {
  type: string;
  params?: Record<string, unknown>;
}

export async function evaluateAutomationRules(userId: string, adAccountId: string) {
  const rules = await prisma.automationRule.findMany({
    where: { userId, isActive: true },
  });

  if (!rules.length) return;

  const campaigns = await prisma.campaign.findMany({
    where: { adAccountId, deletedAt: null, status: "ACTIVE" },
    include: {
      insights: {
        where: {
          date: { gte: getPeriodStart("today") },
        },
      },
    },
  });

  const adAccount = await prisma.adAccount.findUnique({
    where: { id: adAccountId },
  });

  if (!adAccount) return;

  const accessToken = await getFacebookAccessToken(userId);
  const client = accessToken ? new FacebookGraphClient(accessToken) : null;

  for (const rule of rules) {
    const condition = rule.conditionJson as unknown as Condition;
    const action = rule.actionJson as unknown as Action;

    for (const campaign of campaigns) {
      const metricValue = calculateMetric(campaign.insights, condition.metric);
      if (!evaluateCondition(metricValue, condition.operator, condition.value)) {
        continue;
      }

      await createNotification({
        userId,
        type: "RULE_TRIGGERED",
        title: `Rule: ${rule.name}`,
        message: `Campaign "${campaign.name}" - ${condition.metric} ${condition.operator} ${condition.value}`,
        payload: { ruleId: rule.id, campaignId: campaign.id },
      });

      if (rule.isAutoPilot && client) {
        await executeAction(client, campaign, action, adAccount.fbAdAccountId, userId, rule);
      }

      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastTriggered: new Date() },
      });
    }
  }
}

function getPeriodStart(period: string): Date {
  const now = new Date();
  if (period === "last_7d") {
    now.setDate(now.getDate() - 7);
  } else if (period === "last_30d") {
    now.setDate(now.getDate() - 30);
  } else {
    now.setHours(0, 0, 0, 0);
  }
  return now;
}

function calculateMetric(
  insights: Array<{ spend: number; roas: number; cpc: number; ctr: number; conversions: number }>,
  metric: string
): number {
  if (!insights.length) return 0;

  switch (metric) {
    case "spend":
      return insights.reduce((s, i) => s + i.spend, 0);
    case "roas":
      return insights.reduce((s, i) => s + i.roas, 0) / insights.length;
    case "cpc":
      return insights.reduce((s, i) => s + i.cpc, 0) / insights.length;
    case "ctr":
      return insights.reduce((s, i) => s + i.ctr, 0) / insights.length;
    case "conversions":
      return insights.reduce((s, i) => s + i.conversions, 0);
    default:
      return 0;
  }
}

function evaluateCondition(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case "gt": return value > threshold;
    case "lt": return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
    default: return false;
  }
}

async function executeAction(
  client: FacebookGraphClient,
  campaign: { id: string; fbCampaignId: string; name: string },
  action: Action,
  fbAdAccountId: string,
  userId: string,
  rule: { id: string; maxBudget: number | null }
) {
  try {
    if (action.type === "pause") {
      await client.pauseCampaign(campaign.fbCampaignId, fbAdAccountId);
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "PAUSED" },
      });
    } else if (action.type === "resume") {
      await client.resumeCampaign(campaign.fbCampaignId, fbAdAccountId);
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "ACTIVE" },
      });
    }

    await createAuditLog({
      userId,
      action: "AUTO_RULE_EXECUTED",
      entityType: "AutomationRule",
      entityId: rule.id,
      afterData: { campaignId: campaign.id, action: action.type },
    });
  } catch (err) {
    console.error(`[Rules] Action failed for campaign ${campaign.id}:`, err);
  }
}

import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  objective: z.string().min(1),
  dailyBudget: z.number().positive().optional(),
  lifetimeBudget: z.number().positive().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  dailyBudget: z.number().positive().optional(),
  lifetimeBudget: z.number().positive().optional(),
});

export const bulkActionSchema = z.object({
  campaignIds: z.array(z.string()).min(1).max(50),
  action: z.enum(["pause", "resume", "delete"]),
});

export const selectAdAccountSchema = z.object({
  adAccountId: z.string().min(1),
});

export const automationRuleSchema = z.object({
  name: z.string().min(1).max(255),
  conditionJson: z.object({
    metric: z.enum(["spend", "roas", "cpc", "ctr", "conversions"]),
    operator: z.enum(["gt", "lt", "gte", "lte", "eq"]),
    value: z.number(),
    period: z.enum(["today", "last_7d", "last_30d"]).default("today"),
  }),
  actionJson: z.object({
    type: z.enum(["pause", "resume", "notify", "adjust_budget"]),
    params: z.record(z.unknown()).optional(),
  }),
  isActive: z.boolean().default(true),
  isAutoPilot: z.boolean().default(false),
  maxBudget: z.number().positive().optional(),
});

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(4000),
  model: z.enum(["gemini", "gpt4o", "claude", "consensus"]).default("gemini"),
  campaignIds: z.array(z.string()).optional(),
  adIds: z.array(z.string()).optional(),
});

export const analyzeRequestSchema = z.object({
  type: z.enum(["daily", "weekly"]).default("daily"),
  campaignIds: z.array(z.string()).optional(),
  adIds: z.array(z.string()).optional(),
});

export const applyRecommendationSchema = z.object({
  recommendationId: z.string().min(1),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type BulkActionInput = z.infer<typeof bulkActionSchema>;
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

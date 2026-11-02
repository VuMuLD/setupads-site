export type UserRole = "ADMIN" | "MANAGER" | "VIEWER";

export type RecommendationStatus = "PENDING" | "APPLIED" | "REJECTED";

export type RecommendationType =
  | "INCREASE_BUDGET"
  | "DECREASE_BUDGET"
  | "PAUSE_CAMPAIGN"
  | "RESUME_CAMPAIGN"
  | "CHANGE_TARGETING"
  | "DUPLICATE_CAMPAIGN"
  | "OPTIMIZE_CREATIVE";

export type AIModel = "gemini" | "gpt4o" | "claude" | "consensus";

export type NotificationChannel = "WEB" | "EMAIL" | "TELEGRAM";

export type CampaignStatus =
  | "ACTIVE"
  | "PAUSED"
  | "DELETED"
  | "ARCHIVED";

export interface CampaignMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number;
  cpc: number;
  ctr: number;
  cpm: number;
  reach?: number;
}

export interface AIRecommendationPayload {
  type: RecommendationType;
  confidence: number;
  reasoningVi: string;
  suggestedAction: Record<string, unknown>;
  campaignId?: string;
  campaignName?: string;
}

export interface ConsensusResult {
  recommendation: AIRecommendationPayload;
  modelVotes: {
    model: AIModel;
    vote: RecommendationType;
    confidence: number;
    reasoning: string;
  }[];
  finalConfidence: number;
}

export const FB_API_VERSION = "v21.0";

export const FB_AUTH_SCOPES = "public_profile";

export const FB_ADS_SCOPES = [
  "ads_management",
  "ads_read",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_posts",
  "pages_messaging",
  "business_management",
].join(",");

export const FB_MESSAGING_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_posts",
  "pages_messaging",
  "business_management",
].join(",");

export const FB_SCOPES = [FB_AUTH_SCOPES, FB_ADS_SCOPES].join(",");

export const RATE_LIMITS = {
  facebookPerAccount: 200,
  internalPerUser: 100,
} as const;

export const AI_TOKEN_LIMIT = 4000;

export const DATA_RETENTION_DAYS = 90;

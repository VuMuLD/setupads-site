import { FB_API_VERSION, RATE_LIMITS } from "@fb-ads/shared";
import {
  FACEBOOK_RATE_LIMIT_MESSAGE,
  isFacebookAppRateLimited,
  markFacebookAppRateLimited,
} from "@/lib/facebook/rate-limit";

export class FacebookAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public fbError?: { code: number; message: string }
  ) {
    super(message);
    this.name = "FacebookAPIError";
  }
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(adAccountId: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(adAccountId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(adAccountId, {
      count: 1,
      resetAt: now + 3600000,
    });
    return;
  }

  if (entry.count >= RATE_LIMITS.facebookPerAccount) {
    throw new FacebookAPIError(
      `Rate limit exceeded for ad account ${adAccountId}`,
      429
    );
  }

  entry.count++;
}

export class FacebookGraphClient {
  constructor(private accessToken: string) {}

  async fetchAllPages<T>(
    initialEndpoint: string,
    adAccountId: string
  ): Promise<T[]> {
    const results: T[] = [];
    let endpoint: string | null = initialEndpoint;

    while (endpoint) {
      const page: { data: T[]; paging?: { next?: string } } = await this.request<{
        data: T[];
        paging?: { next?: string };
      }>(endpoint, {}, adAccountId);
      results.push(...(page.data || []));
      if (page.paging?.next) {
        endpoint = page.paging.next;
      } else {
        endpoint = null;
      }
    }

    return results;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    adAccountId?: string
  ): Promise<T> {
    if (isFacebookAppRateLimited()) {
      throw new FacebookAPIError(FACEBOOK_RATE_LIMIT_MESSAGE, 429, {
        code: 4,
        message: FACEBOOK_RATE_LIMIT_MESSAGE,
      });
    }

    if (adAccountId) checkRateLimit(adAccountId);

    const url = endpoint.startsWith("http")
      ? endpoint
      : `https://graph.facebook.com/${FB_API_VERSION}/${endpoint}`;

    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}access_token=${this.accessToken}`;

    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      if (data.error?.code === 4 || data.error?.code === 17 || data.error?.code === 32) {
        markFacebookAppRateLimited();
      }
      throw new FacebookAPIError(
        data.error?.message || "Facebook API error",
        response.status,
        data.error
      );
    }

    return data as T;
  }

  async getMe() {
    return this.request<{ id: string; name: string; email?: string }>(
      "me?fields=id,name,email"
    );
  }

  async getPages() {
    return this.request<{
      data: Array<{
        id: string;
        name: string;
        access_token: string;
        category?: string;
        tasks?: string[];
      }>;
    }>("me/accounts?fields=id,name,access_token,category,tasks&limit=100");
  }

  async getPermissions() {
    return this.request<{
      data: Array<{ permission: string; status: string }>;
    }>("me/permissions");
  }

  async getAdAccounts() {
    return this.request<{
      data: Array<{
        id: string;
        name: string;
        account_id: string;
        currency: string;
        timezone_name: string;
      }>;
    }>("me/adaccounts?fields=id,name,account_id,currency,timezone_name&limit=100");
  }

  async getCampaigns(adAccountId: string) {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;
    const fields =
      "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,buying_type,bid_strategy,special_ad_categories";
    const data = await this.fetchAllPages<{
      id: string;
      name: string;
      status: string;
      objective: string;
      daily_budget?: string;
      lifetime_budget?: string;
      start_time?: string;
      stop_time?: string;
      buying_type?: string;
      bid_strategy?: string;
      special_ad_categories?: string[];
    }>(`${accountId}/campaigns?fields=${fields}&limit=100`, adAccountId);
    return { data };
  }

  async getAdSets(campaignId: string, adAccountId: string) {
    const fields =
      "id,name,status,daily_budget,lifetime_budget,bid_amount,bid_strategy,billing_event,optimization_goal,promoted_object,targeting,destination_type,start_time,end_time";
    const data = await this.fetchAllPages<{
      id: string;
      name: string;
      status: string;
      daily_budget?: string;
      lifetime_budget?: string;
      bid_amount?: string;
      bid_strategy?: string;
      billing_event?: string;
      optimization_goal?: string;
      promoted_object?: Record<string, unknown>;
      targeting?: Record<string, unknown>;
      destination_type?: string;
      start_time?: string;
      end_time?: string;
    }>(`${campaignId}/adsets?fields=${fields}&limit=100`, adAccountId);
    return { data };
  }

  async getAds(adSetId: string, adAccountId: string) {
    const fields =
      "id,name,status,creative{id,thumbnail_url,body,title,call_to_action_type,object_story_spec}";
    const data = await this.fetchAllPages<{
      id: string;
      name: string;
      status: string;
      creative?: Record<string, unknown>;
    }>(`${adSetId}/ads?fields=${fields}&limit=100`, adAccountId);
    return { data };
  }

  async getCampaignInsights(
    campaignId: string,
    adAccountId: string,
    datePreset = "last_30d"
  ) {
    const fields =
      "spend,impressions,clicks,cpc,cpm,ctr,reach,actions,action_values,cost_per_action_type";
    return this.request<{
      data: Array<{
        date_start: string;
        date_stop: string;
        spend: string;
        impressions: string;
        clicks: string;
        cpc: string;
        cpm: string;
        ctr: string;
        reach?: string;
        actions?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
        cost_per_action_type?: Array<{ action_type: string; value: string }>;
      }>;
    }>(
      `${campaignId}/insights?fields=${fields}&date_preset=${datePreset}&time_increment=1`,
      {},
      adAccountId
    );
  }

  async getAdInsights(adId: string, adAccountId: string, datePreset = "last_7d") {
    const fields =
      "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,cost_per_action_type";
    return this.request<{
      data: Array<{
        spend: string;
        impressions: string;
        clicks: string;
        cpc: string;
        cpm: string;
        ctr: string;
        actions?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
        cost_per_action_type?: Array<{ action_type: string; value: string }>;
      }>;
    }>(
      `${adId}/insights?fields=${fields}&date_preset=${datePreset}`,
      {},
      adAccountId
    );
  }

  async getAdSetInsights(adSetId: string, adAccountId: string, datePreset = "last_30d") {
    const fields =
      "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,cost_per_action_type";
    return this.request<{
      data: Array<{
        spend: string;
        impressions: string;
        clicks: string;
        cpc: string;
        cpm: string;
        ctr: string;
        actions?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
        cost_per_action_type?: Array<{ action_type: string; value: string }>;
      }>;
    }>(
      `${adSetId}/insights?fields=${fields}&date_preset=${datePreset}`,
      {},
      adAccountId
    );
  }

  async updateAdSet(
    adSetId: string,
    adAccountId: string,
    data: Record<string, unknown>
  ) {
    return this.request<{ success: boolean }>(
      adSetId,
      { method: "POST", body: JSON.stringify(data) },
      adAccountId
    );
  }

  async getAccountInsights(adAccountId: string, datePreset = "last_30d") {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;
    return this.request<{
      data: Array<{
        date_start: string;
        spend: string;
        impressions: string;
        clicks: string;
        cpc: string;
        cpm: string;
        ctr: string;
        actions?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
      }>;
    }>(
      `${accountId}/insights?fields=spend,impressions,clicks,cpc,cpm,ctr,actions,action_values&date_preset=${datePreset}&time_increment=1`,
      {},
      adAccountId
    );
  }

  async createCampaign(
    adAccountId: string,
    data: {
      name: string;
      objective: string;
      status?: string;
      daily_budget?: number;
      lifetime_budget?: number;
    }
  ) {
    const accountId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;
    return this.request<{ id: string }>(
      `${accountId}/campaigns`,
      {
        method: "POST",
        body: JSON.stringify({
          ...data,
          special_ad_categories: [],
        }),
      },
      adAccountId
    );
  }

  async updateCampaign(
    campaignId: string,
    adAccountId: string,
    data: Record<string, unknown>
  ) {
    return this.request<{ success: boolean }>(
      campaignId,
      { method: "POST", body: JSON.stringify(data) },
      adAccountId
    );
  }

  async pauseCampaign(campaignId: string, adAccountId: string) {
    return this.updateCampaign(campaignId, adAccountId, { status: "PAUSED" });
  }

  async resumeCampaign(campaignId: string, adAccountId: string) {
    return this.updateCampaign(campaignId, adAccountId, { status: "ACTIVE" });
  }

  async deleteCampaign(campaignId: string, adAccountId: string) {
    return this.request<{ success: boolean }>(
      campaignId,
      { method: "DELETE" },
      adAccountId
    );
  }

  async getPageConversations(
    pageId: string,
    pageTokenKey: string,
    options?: { limit?: number; after?: string }
  ) {
    const limit = options?.limit ?? 20;
    const fields = "id,updated_time,snippet,unread_count,message_count,participants";
    let endpoint = `${pageId}/conversations?platform=messenger&fields=${fields}&limit=${limit}`;
    if (options?.after) {
      endpoint += `&after=${encodeURIComponent(options.after)}`;
    }
    return this.request<{
      data: Array<{
        id: string;
        updated_time?: string;
        snippet?: string;
        unread_count?: number;
        message_count?: number;
        participants?: { data?: Array<{ id: string; name?: string; email?: string }> };
      }>;
      paging?: { cursors?: { after?: string }; next?: string };
    }>(endpoint, {}, pageTokenKey);
  }

  async getConversationMessages(
    conversationId: string,
    pageTokenKey: string,
    options?: { limit?: number; before?: string }
  ) {
    const limit = options?.limit ?? 20;
    const fields = "id,message,from,created_time,attachments";
    let endpoint = `${conversationId}/messages?fields=${fields}&limit=${limit}`;
    if (options?.before) {
      endpoint += `&before=${encodeURIComponent(options.before)}`;
    }
    return this.request<{
      data: Array<{
        id: string;
        message?: string;
        from?: { id: string; name?: string };
        created_time?: string;
        attachments?: { data?: Array<Record<string, unknown>> };
      }>;
      paging?: { cursors?: { before?: string }; next?: string };
    }>(endpoint, {}, pageTokenKey);
  }

  async sendPageMessage(
    pageId: string,
    pageTokenKey: string,
    recipientId: string,
    payload: string | { text?: string; imageUrl?: string },
    options?: {
      messagingType?: "RESPONSE" | "MESSAGE_TAG" | "UPDATE";
      tag?: "POST_PURCHASE_UPDATE" | "CONFIRMED_EVENT_UPDATE" | "ACCOUNT_UPDATE";
    }
  ) {
    const msgOptions = typeof payload === "string" ? { text: payload } : payload;
    const messagingType = options?.messagingType || "RESPONSE";

    let message: Record<string, unknown>;
    if (msgOptions.imageUrl) {
      message = {
        attachment: {
          type: "image",
          payload: { url: msgOptions.imageUrl, is_reusable: true },
        },
      };
    } else {
      message = { text: msgOptions.text || "" };
    }

    const body: Record<string, unknown> = {
      recipient: { id: recipientId },
      message,
      messaging_type: messagingType,
    };
    if (messagingType === "MESSAGE_TAG" && options?.tag) {
      body.tag = options.tag;
    }

  return this.request<{ message_id?: string }>(
      `${pageId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
      // Không áp rate-limit Ads (200/h) lên gửi tin Messenger
    );
  }

  async exchangeLongLivedToken(shortLivedToken: string, appId: string, appSecret: string) {
    const url = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new FacebookAPIError(
        data.error?.message || "Token exchange failed",
        response.status,
        data.error
      );
    }
    return data as { access_token: string; expires_in?: number };
  }
}

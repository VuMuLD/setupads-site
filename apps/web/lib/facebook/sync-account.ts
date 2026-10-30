import { createHmac, timingSafeEqual } from "crypto";
import { FB_ADS_SCOPES, FB_API_VERSION, FB_MESSAGING_SCOPES } from "@fb-ads/shared";
import { encrypt } from "@/lib/crypto/token-encryption";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import { prisma } from "@/lib/prisma";

export async function syncFacebookAdsAccount(userId: string, accessToken: string) {
  let token = accessToken;
  let expiresAt: Date | null = null;

  try {
    const client = new FacebookGraphClient(token);
    const longLived = await client.exchangeLongLivedToken(
      token,
      process.env.FACEBOOK_CLIENT_ID!,
      process.env.FACEBOOK_CLIENT_SECRET!
    );
    token = longLived.access_token;
    if (longLived.expires_in) {
      expiresAt = new Date(Date.now() + longLived.expires_in * 1000);
    }
  } catch {
    // Use short-lived token if exchange fails
  }

  const fbUser = await new FacebookGraphClient(token).getMe();

  const fbAccount = await prisma.facebookAccount.upsert({
    where: {
      userId_fbUserId: {
        userId,
        fbUserId: fbUser.id,
      },
    },
    create: {
      userId,
      fbUserId: fbUser.id,
      accessTokenEncrypted: encrypt(token),
      expiresAt,
    },
    update: {
      accessTokenEncrypted: encrypt(token),
      expiresAt,
      isActive: true,
    },
  });

  const client = new FacebookGraphClient(token);

  const pages = await client.getPages();
  for (const page of pages.data) {
    await prisma.page.upsert({
      where: {
        facebookAccountId_fbPageId: {
          facebookAccountId: fbAccount.id,
          fbPageId: page.id,
        },
      },
      create: {
        facebookAccountId: fbAccount.id,
        fbPageId: page.id,
        name: page.name,
        accessTokenEncrypted: encrypt(page.access_token),
        category: page.category,
      },
      update: {
        name: page.name,
        accessTokenEncrypted: encrypt(page.access_token),
        category: page.category,
        isActive: true,
      },
    });
  }

  const adAccounts = await client.getAdAccounts();
  let firstAdAccountId: string | null = null;

  for (const adAccount of adAccounts.data) {
    const row = await prisma.adAccount.upsert({
      where: {
        facebookAccountId_fbAdAccountId: {
          facebookAccountId: fbAccount.id,
          fbAdAccountId: adAccount.account_id,
        },
      },
      create: {
        facebookAccountId: fbAccount.id,
        fbAdAccountId: adAccount.account_id,
        name: adAccount.name,
        currency: adAccount.currency,
        timezone: adAccount.timezone_name,
      },
      update: {
        name: adAccount.name,
        currency: adAccount.currency,
        timezone: adAccount.timezone_name,
        isActive: true,
      },
    });
    if (!firstAdAccountId) firstAdAccountId = row.id;
  }

  const hasSelected = await prisma.adAccount.count({
    where: { facebookAccountId: fbAccount.id, isSelected: true, isActive: true },
  });

  if (!hasSelected && firstAdAccountId) {
    await prisma.adAccount.update({
      where: { id: firstAdAccountId },
      data: { isSelected: true },
    });
  }

  const hasPageSelected = await prisma.page.count({
    where: { facebookAccountId: fbAccount.id, isSelected: true, isActive: true },
  });
  if (!hasPageSelected) {
    const firstPage = await prisma.page.findFirst({
      where: { facebookAccountId: fbAccount.id, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (firstPage) {
      await prisma.page.update({
        where: { id: firstPage.id },
        data: { isSelected: true },
      });
    }
  }

  return fbAccount;
}

export function buildFacebookOAuthUrl(
  redirectUri: string,
  state: string,
  scopes: string,
  options?: { configId?: string; authType?: "rerequest" | "reauthenticate" }
) {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  if (options?.configId) {
    params.set("config_id", options.configId);
  } else {
    params.set("scope", scopes);
  }

  if (options?.authType) {
    params.set("auth_type", options.authType);
  }

  return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export function createOAuthState(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const signature = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function verifyOAuthState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;

    const payload = decoded.slice(0, lastDot);
    const signature = decoded.slice(lastDot + 1);
    const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(payload)
      .digest("hex");

    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const [userId, timestamp] = payload.split(".");
    if (!userId || !timestamp) return null;

    const age = Date.now() - Number(timestamp);
    if (Number.isNaN(age) || age > 10 * 60 * 1000) return null;

    return userId;
  } catch {
    return null;
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_CLIENT_ID!,
    client_secret: process.env.FACEBOOK_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(
    `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Không thể đổi mã Facebook");
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Facebook không trả về access token");
  }

  return data.access_token;
}

export { FB_ADS_SCOPES, FB_MESSAGING_SCOPES };

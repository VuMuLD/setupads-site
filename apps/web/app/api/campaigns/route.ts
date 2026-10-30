import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { requireRole } from "@/lib/security/rbac";
import { getFacebookAccessToken, getSelectedAdAccount } from "@/lib/auth";
import { FacebookGraphClient } from "@/lib/facebook/graph-client";
import { prisma } from "@/lib/prisma";
import { createCampaignSchema, updateCampaignSchema, bulkActionSchema } from "@/lib/validations/schemas";
import { rateLimit, getClientIp } from "@/lib/security/rate-limit";
import { createAuditLog } from "@/lib/security/audit-log";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rateLimitError = rateLimit(request, session!.user.id);
  if (rateLimitError) return rateLimitError;

  const adAccount = await getSelectedAdAccount(session!.user.id);
  if (!adAccount) {
    return NextResponse.json({ error: "Chưa chọn Ad Account" }, { status: 400 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const campaigns = await prisma.campaign.findMany({
    where: {
      adAccountId: adAccount.id,
      deletedAt: null,
      ...(status ? { status: status as "ACTIVE" | "PAUSED" } : {}),
    },
    include: {
      insights: {
        orderBy: { date: "desc" },
        take: 7,
      },
      _count: { select: { adSets: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rateLimitError = rateLimit(request, session!.user.id);
  if (rateLimitError) return rateLimitError;

  const roleError = await requireRole(session!.user.id, ["ADMIN", "MANAGER"]);
  if (roleError) return roleError;

  const body = await request.json();
  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const accessToken = await getFacebookAccessToken(session!.user.id);
  const adAccount = await getSelectedAdAccount(session!.user.id);
  if (!accessToken || !adAccount) {
    return NextResponse.json({ error: "Chưa kết nối Facebook" }, { status: 400 });
  }

  const client = new FacebookGraphClient(accessToken);
  const fbCampaign = await client.createCampaign(adAccount.fbAdAccountId, {
    name: parsed.data.name,
    objective: parsed.data.objective,
    status: parsed.data.status,
    daily_budget: parsed.data.dailyBudget,
    lifetime_budget: parsed.data.lifetimeBudget,
  });

  const campaign = await prisma.campaign.create({
    data: {
      adAccountId: adAccount.id,
      fbCampaignId: fbCampaign.id,
      name: parsed.data.name,
      objective: parsed.data.objective,
      status: parsed.data.status,
      dailyBudget: parsed.data.dailyBudget,
      lifetimeBudget: parsed.data.lifetimeBudget,
    },
  });

  await createAuditLog({
    userId: session!.user.id,
    action: "CREATE_CAMPAIGN",
    entityType: "Campaign",
    entityId: campaign.id,
    afterData: parsed.data as Record<string, unknown>,
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ campaign }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await request.json();

  if (body.campaignIds) {
    const parsed = bulkActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const accessToken = await getFacebookAccessToken(session!.user.id);
    const adAccount = await getSelectedAdAccount(session!.user.id);
    if (!accessToken || !adAccount) {
      return NextResponse.json({ error: "Chưa kết nối Facebook" }, { status: 400 });
    }

    const client = new FacebookGraphClient(accessToken);
    const results = [];

    for (const campaignId of parsed.data.campaignIds) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, adAccountId: adAccount.id },
      });
      if (!campaign) continue;

      if (parsed.data.action === "pause") {
        await client.pauseCampaign(campaign.fbCampaignId, adAccount.fbAdAccountId);
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
      } else if (parsed.data.action === "resume") {
        await client.resumeCampaign(campaign.fbCampaignId, adAccount.fbAdAccountId);
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "ACTIVE" } });
      } else if (parsed.data.action === "delete") {
        await client.deleteCampaign(campaign.fbCampaignId, adAccount.fbAdAccountId);
        await prisma.campaign.update({ where: { id: campaignId }, data: { deletedAt: new Date() } });
      }

      results.push(campaignId);
    }

    return NextResponse.json({ updated: results });
  }

  const { id, ...updateData } = body;
  const parsed = updateCampaignSchema.safeParse(updateData);
  if (!parsed.success || !id) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const accessToken = await getFacebookAccessToken(session!.user.id);
  const adAccount = await getSelectedAdAccount(session!.user.id);
  if (!accessToken || !adAccount) {
    return NextResponse.json({ error: "Chưa kết nối Facebook" }, { status: 400 });
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id, adAccountId: adAccount.id },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign không tồn tại" }, { status: 404 });
  }

  const client = new FacebookGraphClient(accessToken);
  const fbUpdate: Record<string, unknown> = {};
  if (parsed.data.name) fbUpdate.name = parsed.data.name;
  if (parsed.data.status) fbUpdate.status = parsed.data.status;
  if (parsed.data.dailyBudget) fbUpdate.daily_budget = parsed.data.dailyBudget;

  await client.updateCampaign(campaign.fbCampaignId, adAccount.fbAdAccountId, fbUpdate);

  const updated = await prisma.campaign.update({
    where: { id },
    data: {
      ...(parsed.data.name && { name: parsed.data.name }),
      ...(parsed.data.status && { status: parsed.data.status }),
      ...(parsed.data.dailyBudget && { dailyBudget: parsed.data.dailyBudget }),
    },
  });

  await createAuditLog({
    userId: session!.user.id,
    action: "UPDATE_CAMPAIGN",
    entityType: "Campaign",
    entityId: id,
    beforeData: { name: campaign.name, status: campaign.status },
    afterData: parsed.data as Record<string, unknown>,
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ campaign: updated });
}

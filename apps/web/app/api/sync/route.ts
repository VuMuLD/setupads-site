import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getFacebookAccessToken, getSelectedAdAccount } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncAdAccountData, syncAllAdAccountsForUser } from "@/lib/jobs/sync-data";
import { syncPageMessages, syncAllPagesForUser } from "@/lib/jobs/sync-page-messages";
import { getSelectedPage } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accessToken = await getFacebookAccessToken(session!.user.id);
  if (!accessToken) {
    return NextResponse.json({ error: "Token Facebook hết hạn" }, { status: 401 });
  }

  let scope = "selected";
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.scope === "all") scope = "all";
    if (body?.scope === "messages") scope = "messages";
    if (body?.scope === "messages_all") scope = "messages_all";
  } catch {
    // default selected
  }

  try {
    if (scope === "messages_all") {
      const result = await syncAllPagesForUser(session!.user.id);
      return NextResponse.json({ success: true, scope: "messages_all", ...result });
    }

    if (scope === "messages") {
      const page = await getSelectedPage(session!.user.id);
      if (!page) {
        return NextResponse.json({ error: "Chưa chọn Page" }, { status: 400 });
      }
      const result = await syncPageMessages(page.id, session!.user.id);
      return NextResponse.json({ success: true, scope: "messages", ...result });
    }

    if (scope === "all") {
      const result = await syncAllAdAccountsForUser(session!.user.id, accessToken);
      return NextResponse.json({ success: true, scope: "all", ...result });
    }

    const adAccount = await getSelectedAdAccount(session!.user.id);
    if (!adAccount) {
      return NextResponse.json(
        { error: "Chưa chọn Ad Account. Vào Cài đặt hoặc dùng Đồng bộ tất cả." },
        { status: 400 }
      );
    }

    const result = await syncAdAccountData(adAccount.id, accessToken);
    return NextResponse.json({ success: true, scope: "selected", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const adAccounts = await prisma.adAccount.count({
    where: {
      isActive: true,
      facebookAccount: { userId: session!.user.id, isActive: true },
    },
  });

  const lastCampaign = await prisma.campaign.findFirst({
    where: {
      adAccount: { facebookAccount: { userId: session!.user.id } },
    },
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });

  return NextResponse.json({
    lastSyncedAt: lastCampaign?.lastSyncedAt ?? null,
    adAccountsCount: adAccounts,
  });
}

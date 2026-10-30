import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getSelectedAdAccount } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const adAccount = await getSelectedAdAccount(session!.user.id);
  if (!adAccount) {
    return NextResponse.json({ error: "Chưa chọn Ad Account" }, { status: 400 });
  }

  const status = request.nextUrl.searchParams.get("status") || "ACTIVE";
  const statusFilter =
    status === "ALL" ? undefined : (status as "ACTIVE" | "PAUSED" | "ARCHIVED");

  const campaigns = await prisma.campaign.findMany({
    where: {
      adAccountId: adAccount.id,
      deletedAt: null,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: {
      adSets: {
        where: { deletedAt: null },
        include: {
          ads: {
            where: {
              deletedAt: null,
              ...(statusFilter ? { status: statusFilter } : {}),
            },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { name: "asc" },
      },
      insights: { orderBy: { date: "desc" }, take: 7 },
    },
    orderBy: { name: "asc" },
  });

  const tree = campaigns.map((c) => {
    const spend7d = c.insights.reduce((s, i) => s + i.spend, 0);
    const adCount = c.adSets.reduce((s, as) => s + as.ads.length, 0);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      spend7d: Math.round(spend7d),
      adCount,
      adSets: c.adSets.map((as) => ({
        id: as.id,
        name: as.name,
        status: as.status,
        ads: as.ads.map((ad) => {
          const creative =
            ad.creative && typeof ad.creative === "object"
              ? (ad.creative as Record<string, unknown>)
              : null;
          return {
            id: ad.id,
            name: ad.name,
            status: ad.status,
            thumbnailUrl:
              creative && typeof creative.thumbnail_url === "string"
                ? creative.thumbnail_url
                : null,
          };
        }),
      })),
    };
  });

  const totalAds = tree.reduce(
    (s, c) => s + c.adSets.reduce((ss, as) => ss + as.ads.length, 0),
    0
  );

  return NextResponse.json({
    campaigns: tree,
    totalAds,
    adAccountName: adAccount.name,
  });
}

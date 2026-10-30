import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/security/rate-limit";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const fbAccount = await prisma.facebookAccount.findFirst({
    where: { userId: session!.user.id, isActive: true },
    include: {
      adAccounts: { where: { isActive: true }, orderBy: { name: "asc" } },
      pages: { where: { isActive: true }, orderBy: { name: "asc" } },
    },
  });

  return NextResponse.json({
    adAccounts: fbAccount?.adAccounts ?? [],
    pages: fbAccount?.pages?.map((p) => ({
      id: p.id,
      fbPageId: p.fbPageId,
      name: p.name,
      category: p.category,
      isSelected: p.isSelected,
      autoAiEnabled: p.autoAiEnabled,
      aiTone: p.aiTone,
    })) ?? [],
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rateLimitError = rateLimit(request, session!.user.id);
  if (rateLimitError) return rateLimitError;

  const { adAccountId } = await request.json();

  const adAccount = await prisma.adAccount.findFirst({
    where: {
      id: adAccountId,
      facebookAccount: { userId: session!.user.id },
    },
    include: { facebookAccount: true },
  });

  if (!adAccount) {
    return NextResponse.json({ error: "Ad Account không tồn tại" }, { status: 404 });
  }

  await prisma.adAccount.updateMany({
    where: { facebookAccountId: adAccount.facebookAccountId },
    data: { isSelected: false },
  });

  await prisma.adAccount.update({
    where: { id: adAccountId },
    data: { isSelected: true },
  });

  return NextResponse.json({ success: true });
}

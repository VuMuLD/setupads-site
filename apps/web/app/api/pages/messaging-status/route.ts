import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkUserMessagingPermission } from "@/lib/facebook/messaging-access";
import { FB_ADS_SCOPES } from "@fb-ads/shared";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const check = await checkUserMessagingPermission(session!.user.id);

  return NextResponse.json({
    ...check,
    reconnectUrl: "/api/facebook/connect?for=messages",
    requiredScopes: FB_ADS_SCOPES.split(","),
  });
}

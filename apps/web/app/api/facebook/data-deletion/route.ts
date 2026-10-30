import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function parseSignedRequest(
  signedRequest: string,
  appSecret: string
): { user_id: string } | null {
  const [encodedSig, payload] = signedRequest.split(".", 2);
  if (!encodedSig || !payload) return null;

  const expectedSig = createHmac("sha256", appSecret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (encodedSig !== expectedSig) return null;

  try {
    return JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "Facebook app not configured" }, { status: 500 });
  }

  const form = await request.formData();
  const signedRequest = String(form.get("signed_request") || "");
  const data = parseSignedRequest(signedRequest, appSecret);

  if (!data?.user_id) {
    return NextResponse.json({ error: "Invalid signed request" }, { status: 400 });
  }

  const fbUserId = data.user_id;
  const confirmationCode = `del_${fbUserId}_${Date.now()}`;

  const fbAccounts = await prisma.facebookAccount.findMany({
    where: { fbUserId },
    select: { userId: true },
  });

  for (const account of fbAccounts) {
    await prisma.user.update({
      where: { id: account.userId },
      data: { deletedAt: new Date() },
    });
  }

  await prisma.facebookAccount.updateMany({
    where: { fbUserId },
    data: { isActive: false },
  });

  const statusUrl = `${process.env.NEXTAUTH_URL}/api/facebook/data-deletion/status?code=${confirmationCode}`;

  return NextResponse.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
}

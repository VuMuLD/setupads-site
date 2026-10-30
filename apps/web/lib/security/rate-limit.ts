import { NextRequest, NextResponse } from "next/server";

const userRateLimitMap = new Map<string, { count: number; resetAt: number }>();

const MAX_REQUESTS_PER_MINUTE = 100;

export function rateLimit(
  request: NextRequest,
  userId: string
): NextResponse | null {
  const now = Date.now();
  const entry = userRateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    userRateLimitMap.set(userId, {
      count: 1,
      resetAt: now + 60000,
    });
    return null;
  }

  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu. Vui lòng thử lại sau." },
      { status: 429 }
    );
  }

  entry.count++;
  return null;
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

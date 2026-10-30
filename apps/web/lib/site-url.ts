import type { NextRequest } from "next/server";

export function getAppBaseUrl(request?: NextRequest | Request): string {
  const fromEnv = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
    if (forwardedHost) {
      return `${forwardedProto}://${forwardedHost.split(",")[0]?.trim()}`;
    }

    const host = request.headers.get("host");
    if (host && !host.includes("localhost") && !host.startsWith("127.0.0.1")) {
      const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  }

  return "https://setupads.site";
}

export function appUrl(path: string, request?: NextRequest | Request): string {
  const base = getAppBaseUrl(request);
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

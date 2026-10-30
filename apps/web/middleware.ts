import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/site-url";

export async function middleware(request: Request) {
  const { pathname } = new URL(request.url);

  const publicPaths = ["/login", "/register", "/privacy", "/oauth-check", "/oauth.php", "/api/auth", "/api/facebook/diagnostic", "/api/facebook/data-deletion", "/api/facebook/callback", "/api/facebook/webhook", "/api/uploads"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  if (isPublic) return NextResponse.next();

  const session = await auth();
  if (!session) {
    return NextResponse.redirect(appUrl("/login", request));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/uploads|uploads|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

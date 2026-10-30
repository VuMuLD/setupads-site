import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.redirect(new URL("/oauth-check", "https://setupads.site"));
}

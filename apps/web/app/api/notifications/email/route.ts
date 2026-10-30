import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return NextResponse.json({ error: "SMTP not configured" }, { status: 503 });
  }

  const { to, subject, body } = await request.json();

  // SMTP relay via external service or manual configuration
  // For production, integrate nodemailer or SendGrid/Resend API
  console.log(`[Email] Sending to ${to}: ${subject}`);

  return NextResponse.json({ success: true, message: "Email queued" });
}

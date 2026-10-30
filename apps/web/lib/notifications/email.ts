export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[Email] SMTP not configured. Would send to ${to}: ${subject}`);
    return false;
  }

  try {
    const response = await fetch(`${process.env.NEXTAUTH_URL || ""}/api/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, body }),
    });
    return response.ok;
  } catch (err) {
    console.error("[Email] Send failed:", err);
    return false;
  }
}

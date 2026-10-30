import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ status: "pending" });
  }

  return NextResponse.json({
    status: "completed",
    confirmation_code: code,
    message: "Yêu cầu xóa dữ liệu đã được ghi nhận.",
  });
}

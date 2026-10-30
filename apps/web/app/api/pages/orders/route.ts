import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getSelectedPage } from "@/lib/auth";
import { listOrdersGrouped, type OrderGroupBy } from "@/lib/messages/orders";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const pageIdParam = request.nextUrl.searchParams.get("pageId");
  const days = Math.min(
    parseInt(request.nextUrl.searchParams.get("days") || "30", 10) || 30,
    365
  );
  const groupBy = (request.nextUrl.searchParams.get("groupBy") ||
    "day") as OrderGroupBy;

  let pageId = pageIdParam;
  if (!pageId) {
    const page = await getSelectedPage(session!.user.id);
    if (!page) {
      return NextResponse.json({ error: "Chưa chọn Page" }, { status: 400 });
    }
    pageId = page.id;
  }

  if (!["day", "week", "month"].includes(groupBy)) {
    return NextResponse.json({ error: "groupBy không hợp lệ" }, { status: 400 });
  }

  try {
    const data = await listOrdersGrouped(pageId, session!.user.id, { days, groupBy });
    return NextResponse.json({
      ...data,
      totalOrders: data.summary.orderCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tải được đơn hàng" },
      { status: 500 }
    );
  }
}

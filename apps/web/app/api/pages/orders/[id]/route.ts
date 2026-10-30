import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { updatePageOrder } from "@/lib/messages/orders";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/messages/order-status";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const update: {
    status?: OrderStatus;
    shippingFee?: number | null;
    amount?: number | null;
  } = {};

  if (typeof body.status === "string" && ORDER_STATUSES.includes(body.status as OrderStatus)) {
    update.status = body.status as OrderStatus;
  }
  if (body.shippingFee !== undefined) {
    const fee =
      body.shippingFee === null || body.shippingFee === ""
        ? null
        : Number(body.shippingFee);
    update.shippingFee = fee !== null && !Number.isNaN(fee) ? fee : null;
  }
  if (body.amount !== undefined) {
    const amt =
      body.amount === null || body.amount === ""
        ? null
        : Number(body.amount);
    update.amount = amt !== null && !Number.isNaN(amt) ? amt : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Không có dữ liệu cập nhật" }, { status: 400 });
  }

  try {
    const order = await updatePageOrder(id, session!.user.id, update);
    return NextResponse.json({ success: true, order });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cập nhật thất bại" },
      { status: 500 }
    );
  }
}

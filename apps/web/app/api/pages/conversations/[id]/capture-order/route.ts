import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { captureOrderFromConversation } from "@/lib/messages/orders";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: conversationId } = await params;

  try {
    const result = await captureOrderFromConversation(conversationId, session!.user.id, {
      manual: true,
      force: true,
    });

    if (!result.captured) {
      const messages: Record<string, string> = {
        no_purchase_signal:
          "Chưa thấy dấu hiệu chốt đơn trong tin nhắn. Hãy đánh dấu «Đã mua» hoặc chờ khách gửi SĐT/địa chỉ.",
        no_order_info:
          "Không trích xuất được SĐT, địa chỉ hay sản phẩm từ tin nhắn. Kiểm tra lại hội thoại.",
      };
      return NextResponse.json(
        {
          success: false,
          reason: result.reason,
          error: messages[result.reason || ""] || "Không tạo được đơn",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
      message: result.isNew
        ? `Đã tạo đơn #${result.orderCode}${result.confirmationSent ? " và gửi xác nhận cho khách" : ""}`
        : `Đã cập nhật đơn #${result.orderCode} từ tin nhắn`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nhận đơn thất bại" },
      { status: 500 }
    );
  }
}

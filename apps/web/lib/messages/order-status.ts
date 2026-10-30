export const ORDER_STATUSES = [
  "received",
  "confirmed",
  "shipping",
  "delivered",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; className: string }
> = {
  received: {
    label: "Nhận đơn",
    className: "bg-sky-100 text-sky-800 border border-sky-200",
  },
  confirmed: {
    label: "Xác nhận đơn",
    className: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  },
  shipping: {
    label: "Đang vận chuyển",
    className: "bg-amber-100 text-amber-800 border border-amber-200",
  },
  delivered: {
    label: "Đã giao",
    className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  },
  returned: {
    label: "Hoàn lại",
    className: "bg-rose-100 text-rose-800 border border-rose-200",
  },
};

export function parseOrderStatus(value: string | null | undefined): OrderStatus {
  if (value && ORDER_STATUSES.includes(value as OrderStatus)) {
    return value as OrderStatus;
  }
  if (value === "confirmed") return "confirmed";
  return "received";
}

export function orderGrandTotal(amount: number | null, shippingFee: number | null): number {
  return (amount || 0) + (shippingFee || 0);
}

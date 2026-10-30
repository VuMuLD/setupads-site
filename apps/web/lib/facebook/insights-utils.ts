export function extractConversions(
  actions?: Array<{ action_type: string; value: string }>
): number {
  if (!actions) return 0;
  const types = [
    "offsite_conversion.fb_pixel_purchase",
    "purchase",
    "lead",
    "complete_registration",
  ];
  let total = 0;
  for (const type of types) {
    const found = actions.find((a) => a.action_type === type);
    if (found) total += parseFloat(found.value) || 0;
  }
  return total;
}

export function extractRevenue(
  actionValues?: Array<{ action_type: string; value: string }>
): number {
  if (!actionValues) return 0;
  const types = ["offsite_conversion.fb_pixel_purchase", "purchase"];
  let total = 0;
  for (const type of types) {
    const found = actionValues.find((a) => a.action_type === type);
    if (found) total += parseFloat(found.value) || 0;
  }
  return total;
}

export function calcRoas(revenue: number, spend: number): number {
  if (spend <= 0) return 0;
  return revenue / spend;
}

export function centsToCurrency(value?: string | null): number | null {
  if (!value) return null;
  return parseFloat(value) / 100;
}

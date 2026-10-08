import { z } from "zod";
import { StoreError } from "./errors";
export const returnLineSchema = z
  .object({ itemId: z.uuid(), quantity: z.number().int().min(1) })
  .strict();
export const refundLineSchema = returnLineSchema
  .extend({
    quantity: z.number().int().nonnegative(),
    amountCents: z.number().int().nonnegative(),
  })
  .refine(
    (line) => line.quantity > 0 || line.amountCents > 0,
    "Wskaż ilość lub dodatnią korektę kwoty.",
  );
export type RefundLine = z.infer<typeof refundLineSchema>;
export type ReturnLine = z.infer<typeof returnLineSchema>;
export type RefundItem = {
  id: string;
  product_id: string | null;
  quantity: number;
  total_cents: number;
  tax_rate: string | number;
  unit_price_cents: number;
  product_name: string;
  sku: string;
};
type Event = { kind: string; data: Record<string, any> };
export function refundSummary(items: RefundItem[], events: Event[]) {
  const lines = items.map((item) => ({
    ...item,
    refundedQuantity: 0,
    refundedCents: 0,
    returnedQuantity: 0,
  }));
  let refundedCents = 0,
    shippingRefundedCents = 0;
  for (const { kind, data } of events) {
    if (kind === "record_refund") {
      refundedCents += Number(data.amountCents || 0);
      const refunded: RefundLine[] =
        data.refundItems ??
        items.map((i) => ({
          itemId: i.id,
          quantity: i.quantity,
          amountCents: i.total_cents,
        }));
      for (const r of refunded) {
        const line = lines.find((i) => i.id === r.itemId);
        if (line) {
          line.refundedQuantity += r.quantity;
          line.refundedCents += r.amountCents;
        }
      }
      shippingRefundedCents +=
        data.shippingRefundCents ??
        Math.max(
          0,
          Number(data.amountCents || 0) -
            items.reduce((sum, i) => sum + i.total_cents, 0),
        );
    }
    if (
      kind === "record_return" ||
      (kind === "record_refund" && data.restock)
    ) {
      const returned: ReturnLine[] =
        data.returnItems ??
        items.map((i) => ({ itemId: i.id, quantity: i.quantity }));
      for (const r of returned) {
        const line = lines.find((i) => i.id === r.itemId);
        if (line) line.returnedQuantity += r.quantity;
      }
    }
  }
  return { lines, refundedCents, shippingRefundedCents };
}
export function validateRefund(
  summary: ReturnType<typeof refundSummary>,
  totalCents: number,
  shippingCents: number,
  input: {
    amountCents?: number;
    refundItems?: RefundLine[];
    shippingRefundCents?: number;
  },
) {
  const remaining = totalCents - summary.refundedCents;
  if (
    !Number.isInteger(input.amountCents) ||
    !input.amountCents ||
    input.amountCents > remaining
  )
    throw new StoreError(
      "REFUND_PROOF_REQUIRED",
      "Podaj rzeczywistą dodatnią kwotę zwrotu, nie większą niż pozostała kwota zamówienia.",
    );
  if (input.refundItems === undefined && input.amountCents !== remaining)
    throw new StoreError(
      "REFUND_PROOF_REQUIRED",
      "Przy częściowym zwrocie wskaż pozycje, ilości oraz kwotę zwrotu kosztu dostawy.",
    );
  const lines =
    input.refundItems ??
    summary.lines
      .filter(
        (i) =>
          i.quantity > i.refundedQuantity || i.total_cents > i.refundedCents,
      )
      .map((i) => ({
        itemId: i.id,
        quantity: i.quantity - i.refundedQuantity,
        amountCents: i.total_cents - i.refundedCents,
      }));
  const shipping =
    input.shippingRefundCents ??
    (input.refundItems === undefined
      ? shippingCents - summary.shippingRefundedCents
      : 0);
  if (
    shipping < 0 ||
    shipping > shippingCents - summary.shippingRefundedCents ||
    new Set(lines.map((r) => r.itemId)).size !== lines.length
  )
    throw new StoreError(
      "REFUND_LIMIT",
      "Zwrot kosztu dostawy lub lista pozycji przekracza pozostałe rozliczenie.",
      409,
    );
  for (const r of lines) {
    const item = summary.lines.find((i) => i.id === r.itemId);
    if (
      !item ||
      r.quantity > item.quantity - item.refundedQuantity ||
      r.amountCents > item.total_cents - item.refundedCents
    )
      throw new StoreError(
        "REFUND_LIMIT",
        "Sprawdź zwracane pozycje, ilości i kwoty. Nie można rozliczyć ich drugi raz.",
        409,
      );
  }
  if (
    lines.reduce((sum, i) => sum + i.amountCents, shipping) !==
    input.amountCents
  )
    throw new StoreError(
      "REFUND_TOTAL",
      "Suma pozycji i zwrotu dostawy musi odpowiadać faktycznie zwróconej kwocie.",
    );
  return {
    refundItems: lines,
    shippingRefundCents: shipping,
    full: input.amountCents === remaining,
  };
}
export function validateReturn(
  summary: ReturnType<typeof refundSummary>,
  lines: ReturnLine[],
) {
  if (
    !lines.length ||
    new Set(lines.map((r) => r.itemId)).size !== lines.length
  )
    throw new StoreError(
      "RETURN_ITEMS",
      "Wskaż pozycje i sztuki faktycznie przyjęte do magazynu.",
    );
  for (const r of lines) {
    const item = summary.lines.find((i) => i.id === r.itemId);
    if (!item?.product_id || r.quantity > item.quantity - item.returnedQuantity)
      throw new StoreError(
        "RETURN_LIMIT",
        "Nie można przyjąć więcej sztuk niż zamówiono ani ponownie przyjąć już zwróconego towaru.",
        409,
      );
  }
  return lines;
}

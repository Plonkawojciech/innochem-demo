export type ShippingPayment = "bank_transfer" | "cod" | "stripe";
export type ShippingRate = {
  id: string;
  kind?: "courier" | "pickup";
  priceCents: number;
  codPriceCents?: number | null;
  freeFromUnits?: number;
  freeShippingIncludesCod?: boolean;
  maxWeightGrams?: number;
};
export type ShippingLine = {
  quantity: number;
  weightGrams?: number;
  eligible?: boolean;
};
export function shippingKind(method: Pick<ShippingRate, "id" | "kind">) {
  // Preserve the historical pickup identifiers until settings are saved explicitly.
  return (
    method.kind ||
    (/^(?:pickup|odbior)(?:-|$)/.test(method.id) ? "pickup" : "courier")
  );
}
export function quoteShipping(
  method: ShippingRate,
  lines: ShippingLine[],
  payment: ShippingPayment,
) {
  const pickup = shippingKind(method) === "pickup";
  const units = lines.reduce(
    (sum, line) => sum + (line.eligible === false ? 0 : line.quantity),
    0,
  );
  const weightGrams = lines.reduce(
    (sum, line) => sum + (line.weightGrams || 0) * line.quantity,
    0,
  );
  const threshold = method.freeFromUnits || 0;
  const freeEligible =
    !pickup &&
    threshold > 0 &&
    (payment !== "cod" || method.freeShippingIncludesCod !== false);
  const isFree = pickup || (freeEligible && units >= threshold);
  const priceCents = isFree
    ? 0
    : payment === "cod"
      ? (method.codPriceCents ?? method.priceCents)
      : method.priceCents;
  const limit = pickup ? 0 : method.maxWeightGrams || 0;
  const unknownWeight = lines.some(
    (line) =>
      line.quantity > 0 &&
      (!Number.isSafeInteger(line.weightGrams) || (line.weightGrams || 0) <= 0),
  );
  const error =
    limit && unknownWeight
      ? {
          code: "SHIPPING_WEIGHT_UNKNOWN",
          message:
            "Nie można potwierdzić masy tej przesyłki. Skontaktuj się ze sklepem, aby ustalić dostawę.",
        }
      : limit && weightGrams > limit
        ? {
            code: "SHIPPING_LIMIT",
            message:
              "Zamówienie przekracza limit wybranej metody dostawy. Skontaktuj się ze sklepem, aby ustalić wysyłkę kilku paczek.",
          }
        : null;
  return {
    priceCents,
    isFree,
    units,
    weightGrams,
    freeEligible,
    remainingUnits: freeEligible ? Math.max(0, threshold - units) : 0,
    error,
  };
}

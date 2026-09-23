import type { NextRequest } from "next/server";
import { customerForSession } from "./auth";
import { accessibleOrder } from "./orders";
import { StoreError } from "./errors";
export async function ownedPaymentOrder(request: NextRequest, id: string) {
  const data = await accessibleOrder(
    id,
    await customerForSession(request.headers),
    request.cookies.get(`innochem_order_${id}`)?.value,
  );
  if (!data || data.order.legacy_id || data.order.payment_method !== "stripe")
    throw new StoreError("NOT_FOUND", "Nie znaleziono zamówienia.", 404);
  return data.order;
}

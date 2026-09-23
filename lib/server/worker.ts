import { createHash, timingSafeEqual } from "node:crypto";
import { expireReservations } from "./orders";
import { deliverMailBatch } from "./mail";
import { reconcileStripePayments } from "./stripe-payments";
export function workerAuthorized(request: Request) {
  const expected = process.env.WORKER_SECRET;
  if (!expected || expected.length < 32) return false;
  const actual = request.headers.get("authorization") || "";
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(`Bearer ${expected}`).digest(),
  );
}
export async function runWorker() {
  if (process.env.STORE_WORKER_ENABLED !== "true")
    return {
      enabled: false,
      expired: 0,
      mail: { enabled: false, sent: 0, failed: 0, uncertain: 0 },
    };
  const payments = await reconcileStripePayments();
  const expired = await expireReservations();
  const mail = await deliverMailBatch();
  return { enabled: true, expired, payments, mail };
}

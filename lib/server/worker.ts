import { deliverAnalyticsBatch } from "./analytics";
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
type WorkerTasks = {
  payments: () => ReturnType<typeof reconcileStripePayments>;
  reservations: () => ReturnType<typeof expireReservations>;
  mail: () => ReturnType<typeof deliverMailBatch>;
  analytics: () => ReturnType<typeof deliverAnalyticsBatch>;
};
export async function runWorker(
  tasks: WorkerTasks = {
    payments: reconcileStripePayments,
    reservations: expireReservations,
    mail: deliverMailBatch,
    analytics: deliverAnalyticsBatch,
  },
) {
  if (process.env.STORE_WORKER_ENABLED !== "true")
    return {
      enabled: false,
      healthy: true,
      errors: [] as string[],
      warnings: [] as string[],
      payments: null,
      analytics: null,
      expired: 0,
      mail: { enabled: false, sent: 0, failed: 0, uncertain: 0 },
    };
  const errors: string[] = [];
  const warnings: string[] = [];
  async function run<T>(name: string, task: () => Promise<T>) {
    try {
      return await task();
    } catch {
      errors.push(name);
      return null;
    }
  }
  // Keep payment/release ordering; isolate external failures from later queues.
  const payments = await run("payments", tasks.payments);
  const expired = await run("reservations", tasks.reservations);
  const mail = await run("mail", tasks.mail);
  const analytics = await run("analytics", tasks.analytics);
  for (const [name, result] of [
    ["payments", payments],
    ["mail", mail],
    ["analytics", analytics],
  ] as const) {
    if (
      result &&
      (Number("failed" in result ? result.failed : 0) > 0 ||
        Number("uncertain" in result ? result.uncertain : 0) > 0) &&
      !warnings.includes(name)
    )
      warnings.push(name);
  }
  return {
    enabled: true,
    healthy: errors.length === 0,
    errors,
    warnings,
    expired: expired ?? 0,
    payments,
    mail,
    analytics,
  };
}

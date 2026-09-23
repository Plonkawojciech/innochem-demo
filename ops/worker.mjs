import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
const target = new URL(
  process.env.WORKER_URL || "http://web:3000/api/internal/worker",
);
if (!process.env.WORKER_SECRET || process.env.WORKER_SECRET.length < 32)
  throw new Error("WORKER_SECRET is required");
while (true) {
  try {
    const result = await fetch(target, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${process.env.WORKER_SECRET}` },
      signal: AbortSignal.timeout(180000),
    });
    if (!result.ok) throw new Error("Worker request failed");
    const data = await result.json();
    await writeFile("/tmp/innochem-worker-heartbeat", String(Date.now()));
    if (
      data.enabled &&
      (data.expired ||
        data.mail?.sent ||
        data.mail?.failed ||
        data.mail?.uncertain ||
        data.payments?.failed)
    )
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          expired: data.expired,
          payments: data.payments,
          mail: data.mail,
        }),
      );
  } catch {
    console.error(
      "Store worker failed; check application health and operator configuration.",
    );
  }
  await sleep(60000);
}

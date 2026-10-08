import { setTimeout as sleep } from "node:timers/promises";
import { runWorkerCycle } from "./worker-once.mjs";
while (true) {
  try {
    await runWorkerCycle({
      target: process.env.WORKER_URL || "http://web:3000/api/internal/worker",
    });
  } catch {
    console.error(
      "Store worker failed; check application health and operator configuration.",
    );
  }
  await sleep(60000);
}

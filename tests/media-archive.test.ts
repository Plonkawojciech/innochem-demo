import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { streamArchiveProcess } from "../lib/server/media-archive";
test("a producer failure after its complete stdout cannot be accepted as a successful archive", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.stdout.write('synthetic-archive',()=>process.exit(1))"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await assert.rejects(
    new Response(
      streamArchiveProcess(child, new AbortController().signal),
    ).arrayBuffer(),
    /Archive unavailable/,
  );
});
test("a progressing download may exceed the inactivity limit in total duration", async (t) => {
  // A virtual inactivity clock avoids mistaking slow process startup on a busy
  // test host for a stalled archive. The stream and backpressure stay real.
  let now = 0;
  const timers = new Map<object, { due: number; fire: () => void }>();
  t.mock.method(globalThis, "setTimeout", (fire: () => void, delay: number) => {
    const timer = { unref: () => timer };
    timers.set(timer, { due: now + delay, fire });
    return timer as unknown as ReturnType<typeof setTimeout>;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: object) =>
    timers.delete(timer),
  );
  let stopped = false;
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      stopped = true;
      return true;
    },
  }) as unknown as EventEmitter &
    Pick<ChildProcess, "kill" | "once"> & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
  const response = new Response(
    streamArchiveProcess(child, new AbortController().signal, 250),
  ).text();
  for (let n = 0; n < 12; n++) {
    child.stdout.write("chunk");
    await new Promise<void>((resolve) => setImmediate(resolve));
    now += 50;
    for (const [timer, entry] of timers) {
      if (entry.due <= now) {
        timers.delete(timer);
        entry.fire();
      }
    }
  }
  child.stdout.end();
  child.emit("close", 0);
  const body = await response;
  assert.equal(now, 600);
  assert.equal(stopped, false);
  assert.equal(body, "chunk".repeat(12));
});
test("cancelling a download ends its producer", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(()=>process.stdout.write('chunk'),20)"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  const reader = streamArchiveProcess(
    child,
    new AbortController().signal,
  ).getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  const [, signal] = await closed;
  assert.equal(signal, "SIGTERM");
});

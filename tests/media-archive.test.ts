import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
test("a progressing download may exceed the inactivity limit in total duration", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "let n=0;const t=setInterval(()=>{process.stdout.write('chunk');if(++n===12){clearInterval(t);}},50)",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const body = await new Response(
    streamArchiveProcess(child, new AbortController().signal, 250),
  ).text();
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

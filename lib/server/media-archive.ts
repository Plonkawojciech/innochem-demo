import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";

type ArchiveProcess = Pick<ChildProcess, "kill" | "once"> & {
  stdout: Readable;
  stderr: Readable;
};

/** Preserve backpressure, detect a failed producer before EOF, and bound inactivity. */
export function streamArchiveProcess(
  child: ArchiveProcess,
  signal: AbortSignal,
  inactivityMs = 120000,
) {
  child.stderr.resume();
  let exited = false;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => {
    child.kill();
    child.stdout.destroy(new Error("Archive interrupted"));
  };
  const progress = () => {
    clearTimeout(timer);
    if (!exited) {
      timer = setTimeout(stop, inactivityMs);
      timer.unref();
    }
  };
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () => {
      child.stdout.destroy(new Error("Archive unavailable"));
      reject(new Error("Archive unavailable"));
    });
    child.once("close", (code) => {
      exited = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (code === 0) resolve();
      else reject(new Error("Archive incomplete"));
    });
  });
  completed.catch(() => {});
  const reader = (
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  ).getReader();
  child.stdout.once("close", () => {
    if (!child.stdout.readableEnded) child.kill();
  });
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  progress();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) {
          await completed;
          controller.close();
        } else {
          progress();
          controller.enqueue(part.value);
        }
      } catch {
        controller.error(new Error("Archive unavailable"));
      }
    },
    async cancel() {
      stop();
      await reader.cancel().catch(() => {});
    },
  });
}

export function archiveMedia(root: string, signal: AbortSignal) {
  const child = spawn(
    "tar",
    [
      "--exclude=./_derivatives",
      "--exclude=*.tmp",
      "-czf",
      "-",
      "-C",
      root,
      ".",
    ],
    { stdio: ["ignore", "pipe", "pipe"], signal },
  );
  return streamArchiveProcess(child, signal);
}

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const script = path.resolve("ops/backup-host.sh");
const docker = `#!/usr/bin/env python3
import os,sys,time
from pathlib import Path
if sys.argv[1]=='exec':
 print('-- PostgreSQL database dump\\n'+('SELECT 123456789;\\n'*200),flush=True)
 if os.environ.get('SLOW_DUMP'): time.sleep(0.7)
 if os.environ.get('FAIL_DUMP'): raise SystemExit(1)
elif sys.argv[1]=='run':
 if os.environ.get('FAIL_MEDIA'): raise SystemExit(1)
 root=Path(os.environ['INNOCHEM_BACKUP_DIR'])
 media=root/'media';media.mkdir(exist_ok=True);(media/'bottle.jpg').write_bytes(b'original media')
 if os.environ.get('COLLIDE'):
  raise SystemExit('Collision must be injected before publication')
else: raise SystemExit(2)
`;
// macOS has no bundled flock command. This implements the same advisory flock
// against the inherited open file description, using the real kernel lock.
const flock = `#!/usr/bin/env python3
import fcntl,sys
try: fcntl.flock(int(sys.argv[-1]),fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: raise SystemExit(1)
`;
const ln = `#!/usr/bin/env python3
import os,sys
from pathlib import Path
if os.environ.get('COLLIDE'): Path(sys.argv[-1]).write_bytes(b'pre-existing copy; do not overwrite')
os.execv('/bin/ln',['/bin/ln',*sys.argv[1:]])
`;

async function fixture(t, extra = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "innochem-backup-host-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const copies = path.join(root, "copies");
  await mkdir(bin);
  await mkdir(copies);
  await writeFile(path.join(bin, "docker"), docker, { mode: 0o700 });
  await writeFile(path.join(bin, "flock"), flock, { mode: 0o700 });
  await writeFile(path.join(bin, "ln"), ln, { mode: 0o700 });
  await writeFile(
    path.join(copies, "innochem-previous.sql.gz"),
    "previous backup",
  );
  return {
    copies,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      INNOCHEM_BACKUP_DIR: copies,
      INNOCHEM_BACKUP_MIN_BYTES: "32",
      ...extra,
    },
  };
}

function run(env) {
  const child = spawn("bash", [script], { env, detached: true });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (value) => {
    stdout += value;
  });
  child.stderr.on("data", (value) => {
    stderr += value;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  return { child, done };
}

async function files(copies) {
  const names = await readdir(copies);
  return {
    completed: names.filter(
      (name) => name.endsWith(".sql.gz") && name !== "innochem-previous.sql.gz",
    ),
    partial: names.filter(
      (name) => name.startsWith(".innochem-") && name.includes(".partial."),
    ),
    failed: names.includes("LAST_BACKUP_FAILED"),
  };
}

async function waitForPartial(copies) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((await files(copies)).partial.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Backup did not start its staging file");
}

async function previousPreserved(copies) {
  assert.equal(
    await readFile(path.join(copies, "innochem-previous.sql.gz"), "utf8"),
    "previous backup",
  );
}

test("host backup publishes valid SQL and completes the media mirror before clearing failure", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.copies, "LAST_BACKUP_FAILED"), "old failure");
  const result = await run(f.env).done;
  assert.equal(result.code, 0, result.stderr);
  const state = await files(f.copies);
  assert.equal(state.completed.length, 1);
  assert.equal(state.partial.length, 0);
  assert.equal(state.failed, false);
  assert.match(
    gunzipSync(
      await readFile(path.join(f.copies, state.completed[0])),
    ).toString(),
    /PostgreSQL database dump/,
  );
  assert.equal(
    await readFile(path.join(f.copies, "media/bottle.jpg"), "utf8"),
    "original media",
  );
  await previousPreserved(f.copies);
});

for (const [label, extra] of [
  ["failed pg_dump despite partial stdout", { FAIL_DUMP: "1" }],
  ["dump below minimum size", { INNOCHEM_BACKUP_MIN_BYTES: "1000000" }],
]) {
  test(`host backup retains previous copies and flags ${label}`, async (t) => {
    const f = await fixture(t, extra);
    const result = await run(f.env).done;
    assert.equal(result.code, 1);
    assert.deepEqual(await files(f.copies), {
      completed: [],
      partial: [],
      failed: true,
    });
    await previousPreserved(f.copies);
  });
}

test("a failed media mirror retains the newly verified SQL and reports incomplete backup", async (t) => {
  const f = await fixture(t, { FAIL_MEDIA: "1" });
  const result = await run(f.env).done;
  assert.equal(result.code, 1);
  const state = await files(f.copies);
  assert.equal(state.completed.length, 1);
  assert.equal(state.partial.length, 0);
  assert.equal(state.failed, true);
  assert.match(
    gunzipSync(
      await readFile(path.join(f.copies, state.completed[0])),
    ).toString(),
    /PostgreSQL database dump/,
  );
  assert.doesNotMatch(
    await readFile(path.join(f.copies, "backup.log"), "utf8"),
    /backup OK/,
  );
  await previousPreserved(f.copies);
});

test("host backup never overwrites a conflicting final filename", async (t) => {
  const f = await fixture(t, { COLLIDE: "1" });
  const result = await run(f.env).done;
  assert.equal(result.code, 1);
  const state = await files(f.copies);
  assert.equal(state.completed.length, 1);
  assert.equal(state.partial.length, 0);
  assert.equal(state.failed, true);
  assert.equal(
    await readFile(path.join(f.copies, state.completed[0]), "utf8"),
    "pre-existing copy; do not overwrite",
  );
  await previousPreserved(f.copies);
});

test("overlapping host backups cannot publish concurrently or remove another staging file", async (t) => {
  const f = await fixture(t, { SLOW_DUMP: "1" });
  const first = run(f.env);
  await waitForPartial(f.copies);
  const second = await run(f.env).done;
  assert.equal(second.code, 0);
  assert.match(
    await readFile(path.join(f.copies, "backup.log"), "utf8"),
    /backup SKIP/,
  );
  const firstResult = await first.done;
  assert.equal(firstResult.code, 0, firstResult.stderr);
  const state = await files(f.copies);
  assert.equal(state.completed.length, 1);
  assert.equal(state.partial.length, 0);
  assert.equal(state.failed, false);
  await previousPreserved(f.copies);
});

test("interrupted host backup removes only its incomplete copy and records failure", async (t) => {
  const f = await fixture(t, { SLOW_DUMP: "1" });
  const running = run(f.env);
  await waitForPartial(f.copies);
  process.kill(-running.child.pid, "SIGTERM");
  await running.done;
  assert.deepEqual(await files(f.copies), {
    completed: [],
    partial: [],
    failed: true,
  });
  await previousPreserved(f.copies);
});

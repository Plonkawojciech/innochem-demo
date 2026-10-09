import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapperPath = fileURLToPath(
  new URL("../ops/worker-host.sh", import.meta.url),
);
const selectorPath = fileURLToPath(
  new URL("../ops/select-healthy-container.py", import.meta.url),
);
const workerUrl = new URL("../ops/worker-once.mjs", import.meta.url).href;
const uuid = "oxdsv73fkwbxg7t0umly3ucd";
const target = "http://127.0.0.1:3000/api/internal/worker";

// Transport/metadata only. Never runs Docker, reaches a network or reads Env.
const docker = String.raw`#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
root=Path(os.environ['TEST_WORKER_ROOT'])
with (root/'docker-calls.jsonl').open('a') as f:f.write(json.dumps(sys.argv[1:])+'\n')
case=os.environ['TEST_WORKER_CASE'];uuid='oxdsv73fkwbxg7t0umly3ucd'
def row(letter,name,created,started,health='healthy'):
 return {'id':letter*64,'name':'/'+uuid+'-'+name,'imageId':'sha256:'+'2'*64,
 'imageReference':uuid+':'+'1'*40,'created':created,'running':True,'status':'running',
 'startedAt':started,'health':health,'user':'store','labels':{'coolify.managed':'true','coolify.type':'application','coolify.pullRequestId':'0'}}
def rows(scan):
 result=[row('a','20261009T115800','2026-10-09T10:00:00Z','2026-10-09T12:01:00Z'),
 row('b','20261009T115900','2026-10-09T11:59:00Z','2026-10-09T11:59:10Z')]
 if case=='starting':result[1]['health']='starting'
 if case=='nohealthy':
  for item in result:item['health']='unhealthy'
 if case=='rotation' and scan>=2:result.append(row('c','20261009T120000','2026-10-09T12:00:00Z','2026-10-09T12:00:01Z'))
 return result
scan_file=root/'scans'
scan=int(scan_file.read_text()) if scan_file.exists() else 0
if sys.argv[1]=='ps':
 scan+=1;scan_file.write_text(str(scan))
 print('\n'.join(item['name'][1:] for item in rows(scan)))
elif sys.argv[1]=='inspect':
 assert '.Config.Env' not in sys.argv[3]
 items=rows(scan);assert sys.argv[4:]==[item['name'][1:] for item in items]
 for item in items:
  values=[item[k] for k in ('id','name','imageId','imageReference','created','running','status','startedAt','health','user')]+[item['labels'][k] for k in ('coolify.managed','coolify.type','coolify.pullRequestId')]
  print('\t'.join(json.dumps(value) for value in values))
elif sys.argv[1]=='exec':
 selected=('a' if case=='starting' else 'b')*64
 assert sys.argv[1:]==['exec','--user','store','--workdir','/app','--env','WORKER_URL=http://127.0.0.1:3000/api/internal/worker',selected,'node','/app/operations/worker-once.mjs']
 if case=='execfailure':raise SystemExit(27)
 os.environ['WORKER_URL']='http://127.0.0.1:3000/api/internal/worker'
 os.execv(os.environ['TEST_NODE'],[os.environ['TEST_NODE'],str(root/'cycle.mjs')])
else:raise SystemExit('Unexpected Docker operation')
`;

// macOS has no stock flock CLI: use the kernel advisory lock inherited on fd 9.
const flock = String.raw`#!/usr/bin/env python3
import fcntl,sys
try:fcntl.flock(int(sys.argv[-1]),fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise SystemExit(1)
`;

function bridge() {
  return `
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {runWorkerCycle} from ${JSON.stringify(workerUrl)};
const root=process.env.TEST_WORKER_ROOT;
const scenario=process.env.TEST_WORKER_CASE;
const append=(file,data)=>appendFileSync(path.join(root,file),JSON.stringify(data)+'\\n');
try {
 await runWorkerCycle({
  secret:'synthetic-worker-secret-with-at-least-32-characters',
  target:process.env.WORKER_URL,
  fetcher:async (url,options)=>{
   assert.equal(String(url),${JSON.stringify(target)});
   assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
   assert.ok(options.signal instanceof AbortSignal);
   append('requests.jsonl',{target:String(url),method:options.method,redirect:options.redirect});
   if(scenario==='held') {
    await writeFile(path.join(root,'request-started'),'ready');
    const deadline=Date.now()+5000;
    while(true){try{await access(path.join(root,'release'));break;}catch{if(Date.now()>deadline)throw new Error('Fixture release timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
   }
   if(scenario==='transportfailure')throw new Error('synthetic transport secret');
   if(scenario==='httpfailure')return new Response(null,{status:503});
   if(scenario==='invalidresult')return Response.json({enabled:true,healthy:true,errors:'wrong-type',warnings:[]});
   const failed=scenario==='unhealthy';
   return Response.json({enabled:true,healthy:!failed,errors:failed?['mail','synthetic transport secret']:[],warnings:[],mail:{sent:1,failed:failed?1:0,uncertain:0,password:'synthetic-password-do-not-log'}});
  },
  writer:async (file,value)=>{
   assert.ok(['/tmp/innochem-worker-attempt','/tmp/innochem-worker-heartbeat'].includes(file));
   await writeFile(path.join(root,'output',path.basename(file)),value);
  },
  logger:record=>{append('worker-records.jsonl',record);console.log(JSON.stringify(record));},
 });
}catch{console.error('Store worker failed; check application health and operator configuration.');process.exitCode=1;}
`;
}

async function fixture(t, scenario = "success") {
  const root = await mkdtemp(path.join(tmpdir(), "innochem-worker-host-test-"));
  const children = [];
  t.after(async () => {
    for (const running of children) {
      if (
        running.child.exitCode === null &&
        running.child.signalCode === null
      ) {
        try {
          process.kill(-running.child.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        await running.done;
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  const bin = path.join(root, "bin");
  const ops = path.join(root, "ops");
  const lock = path.join(root, "lock");
  await Promise.all(
    [bin, ops, lock, path.join(root, "output")].map((name) => mkdir(name)),
  );
  await writeFile(path.join(bin, "docker"), docker, { mode: 0o700 });
  await writeFile(path.join(bin, "flock"), flock, { mode: 0o700 });
  await writeFile(
    path.join(ops, "select-healthy-container.py"),
    await readFile(selectorPath),
  );
  await writeFile(path.join(root, "cycle.mjs"), bridge());
  const original = await readFile(wrapperPath, "utf8");
  assert.equal(original.split("worker_root=/root/innochem-monitor").length, 2);
  assert.equal(original.split("lock_root=/run/innochem-worker").length, 2);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  // Relocate exactly two fixed host paths for the isolated filesystem fixture.
  const relocated = original
    .replace("worker_root=/root/innochem-monitor", `worker_root=${quote(ops)}`)
    .replace("lock_root=/run/innochem-worker", `lock_root=${quote(lock)}`);
  assert.equal(
    relocated
      .replace(
        `worker_root=${quote(ops)}`,
        "worker_root=/root/innochem-monitor",
      )
      .replace(`lock_root=${quote(lock)}`, "lock_root=/run/innochem-worker"),
    original,
  );
  const script = path.join(root, "worker-host.sh");
  await writeFile(script, relocated);
  return {
    root,
    lock,
    children,
    script,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_WORKER_ROOT: root,
      TEST_WORKER_CASE: scenario,
      TEST_NODE: process.execPath,
    },
  };
}

function run(f) {
  const child = spawn("/bin/sh", [f.script], { env: f.env, detached: true });
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
  const running = { child, done };
  f.children.push(running);
  return running;
}
async function records(f, file) {
  try {
    return (await readFile(path.join(f.root, file), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function waitFor(file) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await exists(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Worker did not reach the mocked request");
}

for (const [scenario, id] of [
  ["success", "b"],
  ["starting", "a"],
]) {
  test(`host worker runs one existing cycle as store in the selected ${scenario} container`, async (t) => {
    const f = await fixture(t, scenario);
    const result = await run(f).done;
    assert.equal(result.code, 0, result.stderr);
    const calls = await records(f, "docker-calls.jsonl");
    assert.deepEqual(
      calls.map((call) => call[0]),
      ["ps", "inspect", "ps", "inspect", "exec"],
    );
    assert.equal(calls.at(-1)[7], id.repeat(64));
    assert.deepEqual(await records(f, "requests.jsonl"), [
      { target, method: "POST", redirect: "error" },
    ]);
    assert.equal(
      await exists(path.join(f.root, "output/innochem-worker-attempt")),
      true,
    );
    assert.equal(
      await exists(path.join(f.root, "output/innochem-worker-heartbeat")),
      true,
    );
    assert.match(result.stdout, new RegExp(`"containerId":"${id.repeat(64)}"`));
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-password|synthetic-worker-secret/,
    );
  });
}

test("host worker refuses a newer healthy container appearing between selection and verify", async (t) => {
  const f = await fixture(t, "rotation");
  const result = await run(f).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /selection_changed_before_execution/);
  assert.deepEqual(
    (await records(f, "docker-calls.jsonl")).map((call) => call[0]),
    ["ps", "inspect", "ps", "inspect"],
  );
  assert.deepEqual(await records(f, "requests.jsonl"), []);
  assert.equal(
    await exists(path.join(f.root, "output/innochem-worker-heartbeat")),
    false,
  );
});

test("host worker fails before API execution if no owned healthy container exists", async (t) => {
  const f = await fixture(t, "nohealthy");
  const result = await run(f).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no_healthy_owned_container/);
  assert.equal((await records(f, "docker-calls.jsonl")).length, 2);
  assert.deepEqual(await records(f, "requests.jsonl"), []);
});

test("host worker does not retry a Docker execution failure after verify", async (t) => {
  const f = await fixture(t, "execfailure");
  const result = await run(f).done;
  assert.equal(result.code, 27);
  assert.equal(
    (await records(f, "docker-calls.jsonl")).filter(
      (call) => call[0] === "exec",
    ).length,
    1,
  );
  assert.deepEqual(await records(f, "requests.jsonl"), []);
  assert.equal(
    await exists(path.join(f.root, "output/innochem-worker-heartbeat")),
    false,
  );
});

for (const scenario of [
  "unhealthy",
  "transportfailure",
  "httpfailure",
  "invalidresult",
]) {
  test(`host worker preserves failure for the actual ${scenario} cycle without retry or success heartbeat`, async (t) => {
    const f = await fixture(t, scenario);
    const result = await run(f).done;
    assert.equal(result.code, 1);
    assert.equal(
      (await records(f, "docker-calls.jsonl")).filter(
        (call) => call[0] === "exec",
      ).length,
      1,
    );
    assert.equal((await records(f, "requests.jsonl")).length, 1);
    assert.equal(
      await exists(path.join(f.root, "output/innochem-worker-heartbeat")),
      false,
    );
    assert.equal(
      await exists(path.join(f.root, "output/innochem-worker-attempt")),
      scenario === "unhealthy",
    );
    if (scenario === "unhealthy")
      assert.deepEqual((await records(f, "worker-records.jsonl"))[0].errors, [
        "mail",
      ]);
    assert.match(result.stderr, /Store worker failed/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic transport secret|synthetic-password|synthetic-worker-secret/,
    );
  });
}

test("overlapping host wrappers hold a real advisory lock until the first cycle finishes", async (t) => {
  const f = await fixture(t, "held");
  const first = run(f);
  await waitFor(path.join(f.root, "request-started"));
  const second = await run(f).done;
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.stdout.trim(), '{"status":"skipped_busy"}');
  assert.equal((await records(f, "requests.jsonl")).length, 1);
  await writeFile(path.join(f.root, "release"), "release");
  const finished = await first.done;
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(
    (await records(f, "docker-calls.jsonl")).filter(
      (call) => call[0] === "exec",
    ).length,
    1,
  );
  assert.equal(
    await exists(path.join(f.root, "output/innochem-worker-heartbeat")),
    true,
  );
});

test("host worker refuses to run without its private runtime directory", async (t) => {
  const f = await fixture(t);
  await rm(f.lock, { recursive: true });
  const result = await run(f).done;
  assert.equal(result.code, 1);
  assert.deepEqual(await records(f, "docker-calls.jsonl"), []);
  assert.deepEqual(await records(f, "requests.jsonl"), []);
});

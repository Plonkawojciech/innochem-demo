import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPython } from "./helpers/host-ops-fixtures.mjs";

const uuid = "oxdsv73fkwbxg7t0umly3ucd";
const selector = fileURLToPath(
  new URL("../ops/select-healthy-container.py", import.meta.url),
);
function owned(changes = {}) {
  return {
    id: "a".repeat(64),
    name: `/${uuid}-20261009T115900`,
    imageReference: `${uuid}:${"1".repeat(40)}`,
    created: "2026-10-09T11:59:00.000000001Z",
    startedAt: "2026-10-09T11:59:00Z",
    running: true,
    status: "running",
    health: "healthy",
    user: "store",
    labels: {
      "coolify.managed": "true",
      "coolify.type": "application",
      "coolify.pullRequestId": "0",
    },
    ...changes,
  };
}
function select(rows, verifyId) {
  const args = ["-B", selector];
  if (verifyId) args.push("--verify-id", verifyId);
  const result = spawnSync("python3", args, {
    input: JSON.stringify(rows),
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, String(result.error));
  return result;
}
function failed(rows, reason, verifyId) {
  const result = select(rows, verifyId);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    status: "failed_selection",
    reason,
  });
}

test("healthy selector orders rolling deploys by Created rather than restart StartedAt", () => {
  const old = owned({
    created: "2026-10-09T10:00:00Z",
    startedAt: "2026-10-09T12:00:00Z",
  });
  const next = owned({
    id: "b".repeat(64),
    name: `/${uuid}-20261009T115800`,
    created: "2026-10-09T11:58:00Z",
    startedAt: "2026-10-09T11:58:10Z",
  });
  const result = select([old, next]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), next.id);
  for (const health of ["starting", "unhealthy", null]) {
    const fallback = select([old, { ...next, health }]);
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.equal(fallback.stdout.trim(), old.id);
  }
});

test("healthy selector preserves nanosecond creation order and refuses equally new candidates", () => {
  const first = owned({ created: "2026-10-09T11:59:00.123456781Z" });
  const second = owned({
    id: "b".repeat(64),
    created: "2026-10-09T11:59:00.123456782Z",
  });
  assert.equal(select([second, first]).stdout.trim(), second.id);
  failed(
    [first, { ...second, created: first.created }],
    "ambiguous_newest_owned_container",
  );
  failed(
    [first, { ...second, created: "2026-10-09T11:59:00.1234567810Z" }],
    "invalid_creation_timestamp",
  );
});

test("healthy selector excludes wrong roles, pull requests, users, images and names", () => {
  const good = owned();
  const wrong = [
    { name: "/foreign-20261009T120000" },
    { name: `/${uuid}-20261009T120000-extra` },
    { name: `/${uuid}-not-a-timestamp` },
    { imageReference: `${uuid}:latest` },
    { imageReference: `${uuid}:${"a".repeat(39)}` },
    { imageReference: `${uuid}:${"A".repeat(40)}` },
    { imageReference: `foreign:${"a".repeat(40)}` },
    { user: "root" },
    { user: "store:store" },
    { user: "" },
    { labels: { ...good.labels, "coolify.managed": "false" } },
    { labels: { ...good.labels, "coolify.type": "service" } },
    { labels: { ...good.labels, "coolify.pullRequestId": "3" } },
    { labels: {} },
    { running: false },
    { running: "true" },
    { status: "paused" },
    { status: "exited" },
    { health: "unhealthy" },
    { health: undefined },
  ];
  for (const changes of wrong) {
    const invalid = owned({
      id: "b".repeat(64),
      created: "2026-10-09T12:00:00Z",
      ...changes,
    });
    const result = select([invalid, good]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), good.id, JSON.stringify(changes));
    failed([invalid], "no_healthy_owned_container");
  }
});

test("healthy selector supports base deploy metadata without requiring applicationId", () => {
  for (const value of [undefined, null, "", "0"]) {
    const row = owned();
    row.labels["coolify.pullRequestId"] = value;
    const result = select([row]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), row.id);
  }
});

test("healthy selector fails closed for corrupt owned IDs, timestamps and verify races", () => {
  for (const id of ["short", "g".repeat(64), "A".repeat(64)]) {
    failed([owned({ id })], "invalid_container_id");
  }
  for (const created of [null, "", "2026-10-09T11:59:00+00:00"]) {
    failed([owned({ created })], "invalid_creation_timestamp");
  }
  const row = owned();
  assert.equal(select([row], row.id).status, 0);
  failed([row], "selection_changed_before_execution", "b".repeat(64));
  failed([], "no_healthy_owned_container");
});

const dockerDriver = String.raw`
m=load('select-healthy-container');scenario=json.load(sys.stdin);calls=[]
rows=[owned(id=letter*64,name='/'+UUID+'-20261009T11590'+str(i),created=stamp(NOW-60+i)) for i,letter in enumerate('abc')]
names=[row['name'][1:] for row in rows]
def fields(row):
 return [row.get(k) for k in ('id','name','imageId','imageReference','created','running','status','startedAt','health','user')]+[row['labels'].get(k) for k in ('coolify.managed','coolify.type','coolify.pullRequestId')]
def fake_run(args,**kwargs):
 calls.append({'args':args,'timeout':kwargs['timeout']})
 assert kwargs=={'capture_output':True,'text':True,'timeout':10,'check':True}
 mode=scenario.get('mode')
 if mode=='ps-timeout' and args[1]=='ps':raise subprocess.TimeoutExpired(args,10)
 if mode=='inspect-timeout' and args[1]=='inspect':raise subprocess.TimeoutExpired(args,10)
 if mode=='inspect-error' and args[1]=='inspect':raise subprocess.CalledProcessError(1,args,stderr='synthetic sensitive marker')
 if args[1]=='ps':
  assert args==['docker','ps','--filter','name='+UUID,'--format','{{.Names}}']
  return SimpleNamespace(stdout='\n'.join(names+['foreign-app',UUID+'-20261009T115900-extra']))
 assert args[:3]==['docker','inspect','--format'] and args[4:]==names
 assert '.Config.Env' not in args[3]
 selected_rows=rows[:-1] if mode=='incomplete' else rows
 lines=['\t'.join(json.dumps(value) for value in fields(row)) for row in selected_rows]
 if mode=='shape':lines[0]+='\ttrue'
 if mode=='json':lines[0]='not-json'
 return SimpleNamespace(stdout='\n'.join(lines))
m.subprocess.run=fake_run;sys.argv=['select-healthy-container.py','--docker']
out=io.StringIO();err=io.StringIO()
with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):code=m.main()
print(json.dumps({'code':code,'stdout':out.getvalue(),'stderr':err.getvalue(),'calls':calls}))
`;

test("Docker selector batches metadata into two bounded calls and never requests Config.Env", () => {
  const result = JSON.parse(runPython(dockerDriver, {}));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "c".repeat(64));
  assert.equal(result.calls.length, 2);
  assert.deepEqual(
    result.calls.map((call) => call.timeout),
    [10, 10],
  );
  assert.equal(result.calls[1].args.slice(4).length, 3);
});

for (const [mode, reason] of [
  ["incomplete", "incomplete_metadata_inventory"],
  ["shape", "invalid_metadata_shape"],
  ["json", "metadata_read_failed"],
  ["ps-timeout", "metadata_read_failed"],
  ["inspect-timeout", "metadata_read_failed"],
  ["inspect-error", "metadata_read_failed"],
]) {
  test(`Docker selector refuses ${mode} without leaking metadata errors`, () => {
    const result = JSON.parse(runPython(dockerDriver, { mode }));
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      status: "failed_selection",
      reason,
    });
    assert.doesNotMatch(result.stderr, /sensitive/);
    assert.ok(result.calls.length <= 2);
  });
}

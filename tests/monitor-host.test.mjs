import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runPython } from "./helpers/host-ops-fixtures.mjs";
test("VM monitor identifies stale backups, stopped workers and operator queues without exposing data", () => {
  const script = `import importlib.util, json
s=importlib.util.spec_from_file_location('monitor','ops/monitor-host.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
healthy=dict(containerHealthy=True,httpHealthy=True,workerEnabled=True,heartbeatAgeSeconds=60,backupValid=True,backupAgeHours=1,diskUsedPercent=76)
assert m.assess(healthy)==[]
assert m.assess({**healthy,'backupFailed':True})==['backup']
assert m.assess({**healthy,'heartbeatAgeSeconds':999999,'workerStartupGrace':True})==[]
assert m.assess({**healthy,'workerEnabled':False,'heartbeatAgeSeconds':999999,'workerStartupGrace':True})==['worker']
assert m.assess({**healthy,'heartbeatAgeSeconds':999999,'workerStartupGrace':False})==['worker']
bad={**healthy,'workerEnabled':False,'heartbeatAgeSeconds':301,'backupAgeHours':35,'diskUsedPercent':91,'mailUncertain':1,'paymentsStale':1}
assert m.assess(bad)==['worker','backup','disk','mailUncertain','paymentsStale']
recovery={**bad,'workerEnabled':True,'heartbeatAgeSeconds':10,'backupAgeHours':2,'diskUsedPercent':76,'mailUncertain':0,'paymentsStale':0}
assert m.assess(recovery)==[]
print('monitor failure and recovery verified')`;
  const result = spawnSync("python3", ["-B", "-c", script], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "monitor failure and recovery verified");
});

test("VM monitor reads the failure marker and ignores unfinished dumps on disk", () => {
  const script = `
m=load('monitor-host');selector=m.load_container_selector()
container=owned();selector.docker_rows=lambda:[container]
m.load_container_selector=lambda:selector
queues=dict.fromkeys(('mailUncertain','mailExhausted','mailOverdue','paymentsStale','paymentReview','analyticsOverdue'),0)
def command(args):
 if 'node' in args:
  assert args[:7]==['docker','exec','--user','store','--workdir','/app',container['id']]
  return json.dumps({'workerEnabled':True,'heartbeat':time.time()*1000,'heartbeatState':'valid'})
 if 'psql' in args: return json.dumps(queues)
 raise AssertionError('Unexpected external command')
class Health(io.BytesIO):
 status=200
m.command=command
m.urllib.request.urlopen=lambda *a,**kw:Health(b'{"status":"ok"}')
m.os.statvfs=lambda p:SimpleNamespace(f_bavail=70,f_blocks=100)
with tempfile.TemporaryDirectory(prefix='innochem-monitor-test-') as name:
 root=Path(name);valid=root/'innochem-complete.sql.gz'
 with gzip.open(valid,'wb') as f:f.write(b'-- valid synthetic SQL dump')
 (root/'.innochem-new.partial.123456').write_bytes(b'incomplete gzip')
 (root/'LAST_BACKUP_FAILED').touch()
 state=m.collect(UUID,'test-db',name,'https://test.invalid/health')
 assert state['backupValid'] and state['backupFailed'] and m.assess(state)==['backup']
 (root/'LAST_BACKUP_FAILED').unlink()
 state=m.collect(UUID,'test-db',name,'https://test.invalid/health')
 assert state['backupValid'] and not state['backupFailed'] and m.assess(state)==[]
 valid.write_bytes(b'corrupt final gzip')
 state=m.collect(UUID,'test-db',name,'https://test.invalid/health')
 assert not state['backupValid'] and m.assess(state)==['backup']
print('monitor filesystem checks verified')`;
  assert.equal(runPython(script), "monitor filesystem checks verified");
});

const collectFixture = `
m=load('monitor-host');selector=m.load_container_selector()
rows=[owned()];selector.docker_rows=lambda:copy.deepcopy(rows)
m.load_container_selector=lambda:selector
m.time.time=lambda:NOW
runtime={'workerEnabled':True,'heartbeat':(NOW-60)*1000,'heartbeatState':'valid'}
calls=[]
queues=dict.fromkeys(('mailUncertain','mailExhausted','mailOverdue','paymentsStale','paymentReview','analyticsOverdue'),0)
def command(args):
 calls.append(args)
 if 'node' in args:
  assert args[:6]==['docker','exec','--user','store','--workdir','/app']
  assert args[6] in {row['id'] for row in rows}
  return json.dumps(runtime)
 if 'psql' in args:return json.dumps(queues)
 raise AssertionError('Unexpected external command')
class Health(io.BytesIO):status=200
m.command=command
m.urllib.request.urlopen=lambda *a,**kw:Health(b'{"status":"ok"}')
m.os.statvfs=lambda p:SimpleNamespace(f_bavail=70,f_blocks=100)
def collect(name):return m.collect(UUID,'synthetic-db',name,'https://test.invalid/health')
def valid_backup(name):
 file=Path(name)/'innochem-complete.sql.gz'
 with gzip.open(file,'wb') as stream:stream.write(b'-- synthetic SQL')
 os.utime(file,(NOW,NOW))
`;

test("monitor uses the newest healthy Created ID even when the old container was restarted later", () => {
  assert.equal(
    runPython(
      collectFixture +
        `
rows=[owned(id='a'*64,created='2026-10-09T11:00:00Z',startedAt=stamp(NOW-1)),
      owned(id='b'*64,name='/'+UUID+'-20261009T115800',created='2026-10-09T11:58:00Z',startedAt=stamp(NOW-120))]
with tempfile.TemporaryDirectory() as name:
 valid_backup(name);state=collect(name)
 assert state['workerContainerId']=='b'*64 and state['workerContainerCreated']==rows[1]['created']
 assert calls[0][6]=='b'*64 and state['heartbeatAgeSeconds']==60 and m.assess(state)==[]
 rows[1]['health']='starting'
 state=collect(name)
 assert state['workerContainerId']=='a'*64 and calls[-2][6]=='a'*64
print('rolling ID and runtime context verified')
`,
    ),
    "rolling ID and runtime context verified",
  );
});

test("monitor grants grace only for missing heartbeat before 300 seconds and never hides disabled worker", () => {
  assert.equal(
    runPython(
      collectFixture +
        `
with tempfile.TemporaryDirectory() as name:
 valid_backup(name)
 runtime.update(heartbeat=None,heartbeatState='missing')
 for age,grace in [(0,True),(299,True),(300,False),(301,False)]:
  rows[0]['startedAt']=stamp(NOW-age);state=collect(name)
  assert state['workerStartupGrace'] is grace and state['heartbeatAgeSeconds']==999999
  assert ('worker' in m.assess(state)) is (not grace)
 rows[0]['startedAt']=stamp(NOW-1);runtime['workerEnabled']=False
 state=collect(name);assert state['workerStartupGrace'] and 'worker' in m.assess(state)
print('missing heartbeat grace boundaries verified')
`,
    ),
    "missing heartbeat grace boundaries verified",
  );
});

test("monitor alarms invalid, unreadable, stale, nonfinite and future heartbeat on a young container", () => {
  assert.equal(
    runPython(
      collectFixture +
        `
with tempfile.TemporaryDirectory() as name:
 valid_backup(name);rows[0]['startedAt']=stamp(NOW-1)
 cases=[('invalid',None),('unreadable',None),('valid',None),('valid','NaN'),('valid','Infinity'),
        ('valid',float('nan')),('valid',float('inf')),('valid',-1),('valid',0),
        ('valid',(NOW-301)*1000),('valid',(NOW+5.001)*1000)]
 for heartbeat_state,value in cases:
  runtime.update(heartbeatState=heartbeat_state,heartbeat=value);state=collect(name)
  assert not state['workerStartupGrace'] and 'worker' in m.assess(state),(heartbeat_state,value,state)
 for seconds,expected_age in [(-300,300),(-60,60),(0,0),(5,0)]:
  runtime.update(heartbeatState='valid',heartbeat=(NOW+seconds)*1000);state=collect(name)
  assert state['heartbeatAgeSeconds']==expected_age and m.assess(state)==[]
print('heartbeat content and future limits verified')
`,
    ),
    "heartbeat content and future limits verified",
  );
});

test("monitor retains every operator queue alert and HTTP failure beside a healthy worker", () => {
  assert.equal(
    runPython(
      collectFixture +
        `
with tempfile.TemporaryDirectory() as name:
 valid_backup(name)
 for queue in queues:
  queues[queue]=1;assert m.assess(collect(name))==[queue];queues[queue]=0
 m.urllib.request.urlopen=lambda *a,**kw:Health(b'{"status":"failed"}')
 assert m.assess(collect(name))==['http']
 m.urllib.request.urlopen=lambda *a,**kw:Health(b'not-json')
 assert m.assess(collect(name))==['http']
print('operator alerts and invalid health response verified')
`,
    ),
    "operator alerts and invalid health response verified",
  );
});

test("monitor CLI reports sanitized unavailable status on selection, runtime read or timeout failure", () => {
  assert.equal(
    runPython(
      collectFixture +
        `
with tempfile.TemporaryDirectory() as name:
 valid_backup(name);sys.argv=['monitor-host.py','--backups',name]
 def check_main():
  out=io.StringIO()
  with contextlib.redirect_stdout(out):
   try:m.main()
   except SystemExit as error:assert error.code==1
   else:raise AssertionError('Expected unavailable failure')
  record=json.loads(out.getvalue());assert record['failures']==['monitor_unavailable'] and record['healthy'] is False
  assert 'sensitive-synthetic-marker' not in out.getvalue()
 rows.clear();check_main();assert not calls
 rows.append(owned())
 def failed_read(args):raise RuntimeError('sensitive-synthetic-marker')
 m.command=failed_read;check_main()
 m.command=lambda args:'not-json';check_main()
 def timed_out(*a,**kw):raise subprocess.TimeoutExpired('sensitive-synthetic-marker',20)
 m.subprocess.run=timed_out;m.command=load('monitor-host').command
 check_main()
 try:m.collect('foreign-app','synthetic-db',name,'https://test.invalid/health')
 except RuntimeError as error:assert str(error)=='Store application identity mismatch'
 else:raise AssertionError('Wrong application accepted')
print('unavailable status is fail-closed and sanitized')
`,
    ),
    "unavailable status is fail-closed and sanitized",
  );
});

test("runtime heartbeat script uses inherited boolean and distinguishes missing from unreadable and invalid", () => {
  const script = JSON.parse(
    runPython("print(json.dumps(load('monitor-host').WORKER_STATUS_SCRIPT))"),
  );
  for (const [value, errorCode, enabled, expected] of [
    [
      "1234",
      null,
      "true",
      { workerEnabled: true, heartbeat: 1234, heartbeatState: "valid" },
    ],
    [
      null,
      "ENOENT",
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "missing" },
    ],
    [
      null,
      "EACCES",
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "unreadable" },
    ],
    [
      "Infinity",
      null,
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "invalid" },
    ],
    [
      "NaN",
      null,
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "invalid" },
    ],
    [
      "",
      null,
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "invalid" },
    ],
    [
      "0",
      null,
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "invalid" },
    ],
    [
      "-1",
      null,
      "true",
      { workerEnabled: true, heartbeat: null, heartbeatState: "invalid" },
    ],
    [
      "1234",
      null,
      "TRUE",
      { workerEnabled: false, heartbeat: 1234, heartbeatState: "valid" },
    ],
  ]) {
    const setup = `const testFs=require('node:fs');testFs.readFileSync=(file,encoding)=>{if(file!=='/tmp/innochem-worker-heartbeat'||encoding!=='utf8')throw new Error('Unexpected file read');${errorCode ? `throw Object.assign(new Error('synthetic unreadable'),{code:${JSON.stringify(errorCode)}});` : `return ${JSON.stringify(value)};`}};process.env.STORE_WORKER_ENABLED=${JSON.stringify(enabled)};`;
    const result = spawnSync(process.execPath, ["-e", setup + script], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
});

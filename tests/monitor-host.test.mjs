import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  const script = `import importlib.util, json, tempfile, gzip, time, datetime
from pathlib import Path
from io import BytesIO
from types import SimpleNamespace
s=importlib.util.spec_from_file_location('monitor','ops/monitor-host.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
container={'Name':'/test-app','State':{'StartedAt':now,'Health':{'Status':'healthy'}},'Config':{'Env':['STORE_WORKER_ENABLED=true']}}
queues=dict.fromkeys(('mailUncertain','mailExhausted','mailOverdue','paymentsStale','paymentReview','analyticsOverdue'),0)
def command(args):
 if args[:2]==['docker','ps']: return 'test-app'
 if args[:2]==['docker','inspect']: return json.dumps([container])
 if 'node' in args: return str(time.time()*1000)
 if 'psql' in args: return json.dumps(queues)
 raise AssertionError('Unexpected external command')
class Health(BytesIO):
 status=200
m.command=command
m.urllib.request.urlopen=lambda *a,**kw:Health(b'{"status":"ok"}')
m.os.statvfs=lambda p:SimpleNamespace(f_bavail=70,f_blocks=100)
with tempfile.TemporaryDirectory(prefix='innochem-monitor-test-') as name:
 root=Path(name);valid=root/'innochem-complete.sql.gz'
 with gzip.open(valid,'wb') as f:f.write(b'-- valid synthetic SQL dump')
 (root/'.innochem-new.partial.123456').write_bytes(b'incomplete gzip')
 (root/'LAST_BACKUP_FAILED').touch()
 state=m.collect('test-app','test-db',name,'https://test.invalid/health')
 assert state['backupValid'] and state['backupFailed'] and m.assess(state)==['backup']
 (root/'LAST_BACKUP_FAILED').unlink()
 state=m.collect('test-app','test-db',name,'https://test.invalid/health')
 assert state['backupValid'] and not state['backupFailed'] and m.assess(state)==[]
 valid.write_bytes(b'corrupt final gzip')
 state=m.collect('test-app','test-db',name,'https://test.invalid/health')
 assert not state['backupValid'] and m.assess(state)==['backup']
print('monitor filesystem checks verified')`;
  const result = spawnSync("python3", ["-B", "-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "monitor filesystem checks verified");
});

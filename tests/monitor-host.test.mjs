import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("VM monitor identifies stale backups, stopped workers and operator queues without exposing data", () => {
  const script = `import importlib.util, json
s=importlib.util.spec_from_file_location('monitor','ops/monitor-host.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
healthy=dict(containerHealthy=True,httpHealthy=True,workerEnabled=True,heartbeatAgeSeconds=60,backupValid=True,backupAgeHours=1,diskUsedPercent=76)
assert m.assess(healthy)==[]
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

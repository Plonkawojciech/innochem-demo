import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function python(script) {
  const result = spawnSync("python3", ["-B", "-c", script], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

const setup = `import importlib.util,datetime,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('notify','ops/offsite-alerts.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=datetime.datetime.now(datetime.timezone.utc).timestamp()
at=datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()
`;

test("Innochem alarm validates freshness and exposes only known aggregate problem descriptions", () => {
  python(
    setup +
      `
healthy=dict(at=at,failures=[])
offsite=dict(state='OK',completedAt=at,snapshotAt=at)
assert m.issues_from_status(healthy,offsite,now)==[]
assert m.issues_from_status(dict(at=at,failures=['disk','mailUncertain']),offsite,now)==['Innochem: dysk VM przekroczył 90% zajęcia','Innochem: kolejka poczty zawiera wysyłki o niepewnym wyniku']
assert len(m.issues_from_status({}, {},now))==2
assert len(m.issues_from_status(healthy,dict(offsite,state='FAILED'),now))==1
assert len(m.issues_from_status(healthy,offsite,now,dict(state='FAILED')))==1
assert m.issues_from_status(healthy,offsite,now,dict(state='RUNNING'))==[]
assert len(m.issues_from_status(healthy,dict(offsite,snapshotAt='2000-01-01T00:00:00Z'),now))==1
assert len(m.issues_from_status(healthy,dict(offsite,snapshotAt='2999-01-01T00:00:00Z'),now))==1
assert 'secret' not in json.dumps(m.issues_from_status(dict(at=at,failures=['secret']),offsite,now))
`,
  );
});

test("alarm marks delivery only after both authorized channels accept and keeps failed receipts retryable", () => {
  python(
    setup +
      `
class Alerts:
 def __init__(self):self.deliveries=0
 def step(self,state,issues,metrics,now):return dict(due=not state.get('complete'))
 def render(self,plan,source,now):return 'Innochem alarm','Synthetic test body'
 def delivered(self,state,plan,now):self.deliveries+=1;state['complete']=True
alerts=Alerts();state={}
result=m.advance(state,['Innochem: test'],alerts,lambda *args:dict(email=dict(accepted=True),push=dict(accepted=False)),now)
assert result['due'] and alerts.deliveries==0 and state['alerts']['attemptAt']==now
result=m.advance(state,['Innochem: test'],alerts,lambda *args:dict(email=dict(accepted=True),push=dict(accepted=True)),now+121)
assert result['due'] and alerts.deliveries==1
result=m.advance(state,['Innochem: test'],alerts,lambda *args:(_ for _ in ()).throw(AssertionError('duplicate notification')),now+242)
assert not result['due']
`,
  );
});

test("notification check is read-only, rejects stale states and leaves alert files absent", () => {
  python(
    setup +
      `
import subprocess
with tempfile.TemporaryDirectory() as name:
 root=Path(name);(root/'status.json').write_text(json.dumps(dict(at=at,failures=[])))
 (root/'offsite-status.json').write_text(json.dumps(dict(state='OK',completedAt=at,snapshotAt=at)))
 (root/'vm.json').write_text(json.dumps(dict(state='OK')))
 result=subprocess.run(['python3','-B','ops/offsite-alerts.py','--root',name,'--vm-state',str(root/'vm.json'),'--check'],capture_output=True,text=True)
 assert result.returncode==0 and json.loads(result.stdout)['recipient']=='wojciech.plonka@programo.pl'
 assert sorted(p.name for p in root.iterdir())==['offsite-status.json','status.json','vm.json']
 assert not json.loads(result.stdout)['productionStateChanged']
`,
  );
});

test("partial channel retries keep an accepted email receipt without sending it again", () => {
  python(
    setup +
      `
class Channels:
 def __init__(self):self.email=0;self.push=0
 def send_push(self,*args):self.push+=1;return dict(accepted=True,id='push-retry')
 def send_email(self,*args):self.email+=1;return dict(accepted=True,id='unexpected-email')
channels=Channels()
receipts=m.deliver_channels(channels,'not-printed-topic','not-printed-key','test','test',dict(email=dict(accepted=True,id='email-first'),push=dict(accepted=False)))
assert channels.email==0 and channels.push==1 and receipts['email']['id']=='email-first'
`,
  );
});

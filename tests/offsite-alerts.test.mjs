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

const stateMachine = `
spec=importlib.util.spec_from_file_location('shared','tests/fixtures/programo-alerts-state-20261009.py');alerts=importlib.util.module_from_spec(spec);spec.loader.exec_module(alerts)
def render(plan,source,now):
 phase='failure' if plan['new'] else 'reminder' if plan['remind'] else 'recovery'
 return phase,'Synthetic state-machine test body'
alerts.render=render
state={};events=[];accepted={'email':True,'push':False};issue='Innochem: test failure'
def deliver(channel,event,persist):
 events.append((channel,event['subject']));return dict(accepted=accepted[channel],id=f'{channel}-{len(events)}',definiteRejected=not accepted[channel])
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

test("lost Resend reply retries the persisted key and exact payload without sending a second email", () => {
  python(
    setup +
      stateMachine +
      `
from io import BytesIO
class Response(BytesIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
alerts.SENDER='Programo <monitoring@example.invalid>';alerts.FALLBACK_SENDER='Programo <fallback@example.invalid>'
alerts.render=lambda plan,source,now:('failure' if plan['new'] else 'recovery',f'Immutable payload rendered at {now}')
stored={};posts=[];persisted=[]
def opener(request,**kwargs):
 event_key=request.get_header('Idempotency-key');posts.append((event_key,request.data))
 if event_key not in stored:
  stored[event_key]=request.data;raise TimeoutError('simulated reply lost after acceptance')
 assert stored[event_key]==request.data
 return Response(b'{"id":"one-actual-email"}')
def deliver(channel,event,persist):
 if channel=='push':return dict(accepted=True,id='one-push')
 return m.send_email_idempotent(alerts,'fake-runtime-key',event,persist,opener)
def persist(value):persisted.append(json.loads(json.dumps(value)))
m.advance(state,[issue],alerts,deliver,now,persist)
m.advance(state,[issue],alerts,deliver,now+301,persist)
assert len(posts)==1 and state['channels']['email']['pending']['lastReceipt']['uncertain']
assert any(row['channels'].get('email',{}).get('pending',{}).get('inFlight') for row in persisted)
first=state['channels']['email']['pending'];original_key=first['key'];original_body=first['body']
state=json.loads(json.dumps(state))
m.advance(state,[issue],alerts,deliver,now+602,persist)
assert len(posts)==2 and len(stored)==1 and posts[0]==posts[1]
assert original_body in posts[1][1].decode() and 'pending' not in state['channels']['email']
assert state['channels']['email']['alerts']['problems'][issue]['alertedAt']==now+602
`,
  );
});

test("expired Resend idempotency window preserves uncertainty and sends no replacement POST", () => {
  python(
    setup +
      stateMachine +
      `
calls=[]
def deliver(channel,event,persist):
 calls.append(channel)
 return dict(accepted=True,id='push') if channel=='push' else dict(accepted=False,uncertain=True,error='TimeoutError')
m.advance(state,[issue],alerts,deliver,now);m.advance(state,[issue],alerts,deliver,now+301)
state=json.loads(json.dumps(state));before=calls.count('email')
result=m.advance(state,[issue],alerts,deliver,now+301+m.IDEMPOTENCY_TTL_SECONDS+1)
assert calls.count('email')==before and result['receipts']['email']['error']=='IDEMPOTENCY_WINDOW_EXPIRED'
assert state['channels']['email']['pending']['lastReceipt']['uncertain']
`,
  );
});

test("uncertain ntfy publication is reconciled through GET and never blindly republished", () => {
  python(
    setup +
      `
from io import BytesIO
class Response(BytesIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
event=dict(createdAt=now,key='one-logical-incident',subject='Synthetic test',body='Original body',attempts=1)
posts=[];gets=[];stored=None
def opener(request,**kwargs):
 global stored
 if request.get_method()=='POST':
  posts.append(request.data);stored=dict(id='one-push',event='message',title=event['subject'],message=request.data.decode())
  raise TimeoutError('simulated lost publication reply')
 gets.append(True);return Response((json.dumps(stored)+'\\n').encode())
receipt=m.send_push_safe('not-printed-topic',event,opener)
assert receipt['uncertain'] and len(posts)==1
event.update(lastReceipt=receipt,attempts=2)
receipt=m.send_push_safe('not-printed-topic',event,opener)
assert receipt['accepted'] and receipt['reconciled'] and len(posts)==1 and len(gets)==1
event.update(attempts=3,lastReceipt=dict(accepted=False,uncertain=True))
def absent(request,**kwargs):
 assert request.get_method()=='GET';return Response(b'')
receipt=m.send_push_safe('not-printed-topic',event,absent)
assert receipt['uncertain'] and len(posts)==1
`,
  );
});

test("actual Programo state machine recovers accepted email after push failure and allows a later incident", () => {
  python(
    setup +
      stateMachine +
      `
assert not m.advance(state,[issue],alerts,deliver,now)['due']
m.advance(state,[issue],alerts,deliver,now+301)
assert events==[('push','failure'),('email','failure')]
assert state['channels']['email']['alerts']['problems'][issue]['alertedAt']==now+301
assert state['channels']['push']['alerts']['problems'][issue]['alertedAt'] is None
m.advance(state,[issue],alerts,deliver,now+602)
assert events==[('push','failure'),('email','failure'),('push','failure')]
for offset in (903,1204,1505):m.advance(state,[],alerts,deliver,now+offset)
assert events[-1]==('email','recovery') and ('push','recovery') not in events
assert all(channel['alerts']['problems']=={} for channel in state['channels'].values())
assert not m.advance(state,[issue],alerts,deliver,now+1806)['due']
m.advance(state,[issue],alerts,deliver,now+2107)
assert events.count(('email','failure'))==2 and events[-1]==('email','failure')
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

test("actual Programo state machine retries only failed email then recovers both acknowledged channels", () => {
  python(
    setup +
      stateMachine +
      `
accepted={'push':True,'email':False}
m.advance(state,[issue],alerts,deliver,now);m.advance(state,[issue],alerts,deliver,now+301)
assert events==[('push','failure'),('email','failure')]
assert not m.advance(state,[issue],alerts,deliver,now+350)['due']
accepted['email']=True;m.advance(state,[issue],alerts,deliver,now+602)
assert events==[('push','failure'),('email','failure'),('email','failure')]
for offset in (903,1204,1505):m.advance(state,[],alerts,deliver,now+offset)
assert events[-2:]==[('push','recovery'),('email','recovery')]
assert not m.advance(state,[],alerts,deliver,now+1806)['due']
assert events.count(('push','failure'))==1 and events.count(('push','recovery'))==1 and events.count(('email','recovery'))==1
`,
  );
});

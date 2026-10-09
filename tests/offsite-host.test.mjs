import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function python(script) {
  const result = spawnSync("python3", ["-B", "-c", script], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

const setup = `import importlib.util,json,tempfile,gzip,os,datetime,shutil
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('offsite','ops/offsite-host.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
snapshot='a'*64
class Restic:
 def __init__(self,root):self.root=root;self.fail=None
 def json(self,*args):
  if args[0]=='snapshots':return json.dumps([dict(id=snapshot,tags=['vm'],time=datetime.datetime.now(datetime.timezone.utc).isoformat())])
  files=[dict(type='file',path=str(p),size=p.stat().st_size) for p in self.root.rglob('*') if p.is_file()]
  if self.fail=='sql':files=[f for f in files if not f['path'].endswith('.sql.gz')]
  if self.fail=='media':files=[f for f in files if not f['path'].endswith('sample.webp')]
  return '\\n'.join(map(json.dumps,files))
 def dump(self,snapshot,source,destination,limit):
  if self.fail=='restore':destination.write_bytes(b'corrupt')
  else:shutil.copyfile(source,destination)
def fixture(name):
 root=Path(name)/'backup';(root/'media').mkdir(parents=True)
 sql=root/'innochem-current.sql.gz'
 with gzip.open(sql,'wb',compresslevel=1) as stream:stream.write(os.urandom(230000))
 (root/'media'/'nested').mkdir();(root/'media'/'nested'/'sample.webp').write_bytes(b'public synthetic media')
 state=Path(name)/'vm-state.json';state.write_text(json.dumps(dict(state='OK',snapshot_id=snapshot,source_nodes_verified=True)))
 return SimpleNamespace(backups=str(root),vm_state=str(state),repository='test',password_file='not-read',restore_limit=2097152),Restic(root)
`;

test("offsite verifies real restored bytes and the complete media inventory without returning contents", () => {
  python(
    setup +
      `
with tempfile.TemporaryDirectory() as name:
 args,restic=fixture(name);result=m.verify(args,restic)
 assert result['state']=='OK' and result['mediaInventoryMatch'] and result['mediaFiles']==1
 assert result['snapshotId']==snapshot and result['restoredBytes']<args.restore_limit
 assert all(row['match'] and row['sourceSha256']==row['restoredSha256'] for row in result['restoredSamples'])
 assert 'public synthetic media' not in json.dumps(result)
 assert not result['retentionChanged']
`,
  );
});

test("offsite rejects missing SQL, missing media and corrupted restores", () => {
  python(
    setup +
      `
for failure,expected in [('sql','LATEST_SQL_MISSING_FROM_OFFSITE'),('media','MEDIA_INVENTORY_MISMATCH'),('restore','RESTORED_CONTENT_MISMATCH')]:
 with tempfile.TemporaryDirectory() as name:
  args,restic=fixture(name);restic.fail=failure
  try:m.verify(args,restic);raise AssertionError('accepted invalid snapshot')
  except ValueError as error:assert str(error)==expected
`,
  );
});

test("offsite rejects failed, stale and unverified source backups", () => {
  python(
    setup +
      `
with tempfile.TemporaryDirectory() as name:
 args,restic=fixture(name);root=Path(args.backups)
 (root/'LAST_BACKUP_FAILED').touch()
 try:m.verify(args,restic);raise AssertionError('accepted failed backup')
 except ValueError as error:assert str(error)=='LOCAL_BACKUP_FAILED'
 (root/'LAST_BACKUP_FAILED').unlink();sql=next(root.glob('*.sql.gz'));os.utime(sql,(1,1))
 try:m.verify(args,restic);raise AssertionError('accepted stale backup')
 except ValueError as error:assert str(error)=='SQL_DUMP_STALE'
 os.utime(sql,None);Path(args.vm_state).write_text(json.dumps(dict(state='OK',snapshot_id=snapshot,source_nodes_verified=False)))
 try:m.verify(args,restic);raise AssertionError('accepted unverified VM snapshot')
 except ValueError as error:assert str(error)=='SHARED_VM_BACKUP_NOT_VERIFIED'
`,
  );
});

test("offsite refuses symlinks and oversized bounded restore sources", () => {
  python(
    setup +
      `
with tempfile.TemporaryDirectory() as name:
 args,restic=fixture(name);root=Path(args.backups)
 (root/'media'/'foreign').symlink_to('/etc/passwd')
 try:m.verify(args,restic);raise AssertionError('accepted foreign media symlink')
 except ValueError as error:assert str(error)=='MEDIA_SYMLINK_NOT_ALLOWED'
 (root/'media'/'foreign').unlink();args.restore_limit=200000
 try:m.verify(args,restic);raise AssertionError('accepted oversized dump')
 except ValueError as error:assert str(error)=='SQL_DUMP_OUTSIDE_RESTORE_LIMIT'
`,
  );
});

test("restic restore enforces its file cap against a process emitting excess data", () => {
  python(
    setup +
      `
with tempfile.TemporaryDirectory() as name:
 script=Path(name)/'fake-restic';script.write_text('#!/usr/bin/env python3\\nimport os\\nremaining=b"x"*100000\\nwhile remaining: remaining=remaining[os.write(1,remaining):]\\n')
 script.chmod(0o700);client=m.Restic('test','not-read',str(script));destination=Path(name)/'restored'
 try:client.dump(snapshot,'/ignored',destination,1024);raise AssertionError('accepted overflowing restore')
 except RuntimeError as error:assert str(error)=='BOUNDED_RESTORE_FAILED'
 assert destination.stat().st_size<=1024
`,
  );
});

test("offsite state is private and atomic without leaving staged files", () => {
  python(
    setup +
      `
with tempfile.TemporaryDirectory() as name:
 path=Path(name)/'state.json';m.atomic(path,dict(state='OK'));m.atomic(path,dict(state='FAILED'))
 assert json.loads(path.read_text())['state']=='FAILED' and path.stat().st_mode&0o777==0o600
 assert list(Path(name).glob('*.writing-*'))==[]
`,
  );
});

test("offsite atomic cleanup never removes a pre-existing stage it did not create", () => {
  python(
    setup +
      `
with tempfile.TemporaryDirectory() as name:
 path=Path(name)/'state.json';staged=path.with_name(path.name+'.writing-'+str(os.getpid()));staged.write_text('foreign stage')
 try:m.atomic(path,dict(state='OK'));raise AssertionError('overwrote foreign stage')
 except FileExistsError:pass
 assert staged.read_text()=='foreign stage' and not path.exists()
`,
  );
});

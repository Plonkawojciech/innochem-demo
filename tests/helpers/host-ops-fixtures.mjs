import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ops = fileURLToPath(new URL("../../ops/", import.meta.url));

export const pythonPrelude = `
import contextlib, copy, datetime, gzip, importlib.util, io, json, math, os, subprocess, sys, tempfile, time
from pathlib import Path
from types import SimpleNamespace
OPS_ROOT=Path(${JSON.stringify(ops)})
UUID='oxdsv73fkwbxg7t0umly3ucd'
NOW=datetime.datetime(2026,10,9,12,0,tzinfo=datetime.timezone.utc).timestamp()
def stamp(seconds):
 return datetime.datetime.fromtimestamp(seconds,datetime.timezone.utc).isoformat().replace('+00:00','Z')
def load(name):
 spec=importlib.util.spec_from_file_location('test_'+name.replace('-','_'),OPS_ROOT/(name+'.py'))
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def owned(**changes):
 row={'id':'a'*64,'name':'/'+UUID+'-20261009T115900','imageReference':UUID+':'+'1'*40,
      'imageId':'sha256:'+'2'*64,'created':'2026-10-09T11:59:00.000000001Z',
      'running':True,'status':'running','startedAt':stamp(NOW-60),'health':'healthy',
      'user':'store','labels':{'coolify.managed':'true','coolify.type':'application','coolify.pullRequestId':'0'}}
 row.update(changes);return row
`;

export function runPython(script, payload = null) {
  const result = spawnSync("python3", ["-B", "-c", pythonPrelude + script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

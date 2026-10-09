"""Own QA Docker only; caller must wrap this script in heavy."""
import hashlib, json, os, shlex, subprocess, sys, tarfile
from pathlib import Path

root=Path.cwd()
work=root/"private/lcp-20261009"
series, version, source_sha, runtime_path=sys.argv[1:]
if not series.replace("-", "").isalnum() or len(source_sha)!=40:
    raise SystemExit("Invalid series/SHA")
remote_dir="/tmp/innochem-lcp-20261009-"+series
container="innochem-lcp-20261009-"+series
identity="/Users/wojciechplonka/.ssh/netcup_rs2000"
expected_image="sha256:ea50dc50f7f9a231ebb842a78b868b16f89011a2efe3d770ff51d6bd78fc6f01"
ssh=["ssh","-i",identity,"-o","BatchMode=yes","root@159.195.206.7"]
def invoke(args, **kw):
    return subprocess.run(args, check=True, **kw)
def remote(command, **kw):
    return invoke(ssh+[command], **kw)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()

modules=Path("/Users/wojciechplonka/Programo/innochem-demo/private/goal-20261009/performance-3/tooling/node_modules")
manifest_path=root/"scripts/home-lcp-runtime-dependencies.json"
packages=json.loads(manifest_path.read_text())["packages"]
names=[package["name"] for package in packages]
for package in packages:
    package_json=modules/package["name"]/"package.json"
    if digest(package_json)!=package["packageJsonSHA256"]:
        raise SystemExit("Dependency package metadata changed: "+package["name"])
instrumentation_commit=invoke(["git","rev-parse","HEAD"],capture_output=True,text=True).stdout.strip()
owned_sources=["scripts/measure-home-lcp.mjs","scripts/analyze-home-lcp.py","scripts/run-home-lcp-vm.py","scripts/home-lcp-runtime-dependencies.json"]
invoke(["git","diff","--quiet","HEAD","--",*owned_sources])
pipeline_inputs={"instrumentationCommit":instrumentation_commit,"sourceSHA":source_sha,"series":series,"plannedSamples":6,"expectedBrowserVersion":version,"imageID":expected_image,"inputSHA256":{name:digest(root/name) for name in owned_sources}}
payload=work/(series+"-payload.tar.gz")
if payload.exists():raise SystemExit("Payload already exists; never overwrite")
def permitted(info):
    if any(part.startswith(".env") or part in (".DS_Store", "__pycache__") for part in Path(info.name).parts):return None
    return info
with tarfile.open(payload,"w:gz",compresslevel=1) as archive:
    archive.add(root/"scripts/measure-home-lcp.mjs",arcname="measure-home-lcp.mjs")
    archive.add(runtime_path,arcname="runtime-proof.json")
    for name in names:archive.add(modules/name,arcname="tooling/node_modules/"+name,filter=permitted)
payload_sha=digest(payload)
print(json.dumps({"stage":"payload","bytes":payload.stat().st_size,"sha256":payload_sha,"runtimeModules":len(names)}),flush=True)
remote("test ! -e "+shlex.quote(remote_dir)+" && mkdir "+shlex.quote(remote_dir))
invoke(["scp","-i",identity,"-o","BatchMode=yes",str(payload),"root@159.195.206.7:"+remote_dir+"/payload.tar.gz"])
quoted_dir=shlex.quote(remote_dir)
quoted_container=shlex.quote(container)
program="""set -eu
qa_dir=%s
qa_container=%s
actual=$(sha256sum "$qa_dir/payload.tar.gz" | cut -d' ' -f1)
test "$actual" = %s
volumes=$(docker image inspect --format '{{json .Config.Volumes}}' skup-fb-collector:local)
test "$volumes" = '{"/profile":{}}'
image=$(docker image inspect --format '{{.Id}}' skup-fb-collector:local)
test "$image" = %s
printf '%%s\n' "$image" > "$qa_dir/image-id.txt"
cat /proc/loadavg > "$qa_dir/host-load-before.txt"
free -b > "$qa_dir/host-memory-before.txt"
mkdir "$qa_dir/payload"
tar -xzf "$qa_dir/payload.tar.gz" -C "$qa_dir/payload"
docker create --name "$qa_container" --label programo.qa-owner=innochem-lcp-20261009 --cpus=2 --memory=2g --pids-limit=256 --user=1000:1000 --workdir=/tmp --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /profile:rw,nosuid,noexec,size=16m,mode=0700,uid=1000,gid=1000 --entrypoint /usr/bin/env "$image" -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/innochem-lcp TMPDIR=/tmp /bin/sh -c %s
docker cp "$qa_dir/payload" "$qa_container:/tmp/payload"
docker inspect --format '{{json .HostConfig}}' "$qa_container" > "$qa_dir/container-host-config.json"
docker inspect --format '{{json .Mounts}}' "$qa_container" > "$qa_dir/container-mounts.json"
test "$(docker inspect --format '{{range .Mounts}}{{if ne .Type "tmpfs"}}unexpected{{end}}{{end}}' "$qa_container")" = ''
docker start --attach "$qa_container" || true
docker inspect --format '{{json .State}}' "$qa_container" > "$qa_dir/container-state.json"
cat /proc/loadavg > "$qa_dir/host-load-after.txt"
free -b > "$qa_dir/host-memory-after.txt"
docker cp "$qa_container:/tmp/innochem-results" "$qa_dir/results"
tar -czf "$qa_dir/results.tar.gz" -C "$qa_dir" results image-id.txt host-load-before.txt host-load-after.txt host-memory-before.txt host-memory-after.txt container-host-config.json container-state.json container-mounts.json
sha256sum "$qa_dir/results.tar.gz"
"""
inside="mkdir -p /tmp/innochem-results /tmp/innochem-lcp && exec env LIGHTHOUSE_MODULES=/tmp/payload/tooling/node_modules INNOCHEM_EXPECTED_BROWSER_VERSION="+shlex.quote(version)+" INNOCHEM_SOURCE_SHA="+shlex.quote(source_sha)+" INNOCHEM_RUNTIME_PROOF=/tmp/payload/runtime-proof.json node /tmp/payload/measure-home-lcp.mjs https://sklep-innochem.programo.pl /tmp/innochem-results/"+series+" 6"
remote(program % (quoted_dir,quoted_container,shlex.quote(payload_sha),shlex.quote(expected_image),shlex.quote(inside)))
local_archive=work/(series+"-vm-results.tar.gz")
if local_archive.exists():raise SystemExit("Results archive already exists")
invoke(["scp","-i",identity,"-o","BatchMode=yes","root@159.195.206.7:"+remote_dir+"/results.tar.gz",str(local_archive)])
remote_sha=remote("sha256sum "+quoted_dir+"/results.tar.gz",capture_output=True,text=True).stdout.split()[0]
local_sha=digest(local_archive)
if remote_sha!=local_sha:raise SystemExit("Remote/local result hashes differ; preserve remote QA")
local_results=work/(series+"-vm")
local_results.mkdir()
with tarfile.open(local_archive) as archive:archive.extractall(local_results,filter="data")
measurements=json.loads((local_results/"results"/series/"measurements.json").read_text())
manifest=json.loads((local_results/"results"/series/"hashes.json").read_text())
for row in manifest:
    target=local_results/"results"/series/row["name"]
    if digest(target)!=row["sha256"]:raise SystemExit("Artifact hash mismatch; preserve remote QA")
(local_results/"pipeline-inputs.json").write_text(json.dumps(pipeline_inputs,indent=2)+"\n")
closure={"remoteDirectory":remote_dir,"container":container,"payloadSHA256":payload_sha,"resultArchiveSHA256":local_sha,"artifactHashesVerified":len(manifest),"runs":len(measurements["runs"]),"allBrowsersClosed":all(row["browserClosed"] for row in measurements["runs"]),"cleanupAuthorized":"Only these newly created QA resources after verified retrieval"}
remote("test \"$(docker inspect --format '{{.State.Running}}' "+quoted_container+")\" = false && test \"$(docker inspect --format '{{index .Config.Labels \"programo.qa-owner\"}}' "+quoted_container+")\" = innochem-lcp-20261009 && docker rm "+quoted_container+" && rm -rf -- "+quoted_dir)
closure["remoteResourcesRemoved"]=True
(local_results/"retrieval-cleanup.json").write_text(json.dumps(closure,indent=2)+"\n")
print(json.dumps(closure),flush=True)
invoke(["python3", "scripts/analyze-home-lcp.py", str(local_results/"results"/series)])
if series == "baseline-six":
    historical = work/"historical-validation"
    invoke(["python3", "scripts/analyze-home-lcp.py", str(historical)])
    sample = json.loads((historical/"trace-diagnosis.json").read_text())["samples"][0]
    assert abs(sample["observedLcpMs"]-2492.829) < 0.001
    assert any(abs(phase["wallMs"]-1002.520) < 0.001
               for phase in sample["nativePresentedFrameStages"])
    print(json.dumps({"stage": "historical-parser-validation", "passed": True}),flush=True)

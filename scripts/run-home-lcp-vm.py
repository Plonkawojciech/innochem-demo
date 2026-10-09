"""Run six cold samples in one owned QA container; invoke through heavy."""
import hashlib
import io
import json
import re
import shlex
import signal
import subprocess
import sys
import tarfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "private/lcp-20261009"
IMAGE = "sha256:ea50dc50f7f9a231ebb842a78b868b16f89011a2efe3d770ff51d6bd78fc6f01"
IDENTITY = "/Users/wojciechplonka/.ssh/netcup_rs2000"
SSH = ["ssh", "-i", IDENTITY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@159.195.206.7"]
MODULES = Path("/Users/wojciechplonka/Programo/innochem-demo/private/goal-20261009/performance-3/tooling/node_modules")
OWNED_SOURCES = ["scripts/measure-home-lcp.mjs", "scripts/analyze-home-lcp.py", "scripts/run-home-lcp-vm.py", "scripts/home-lcp-runtime-dependencies.json"]


def invoke(args, **options):
    return subprocess.run(args, check=True, **options)


def remote(command, **options):
    return invoke(SSH + [command], **options)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def validate_runtime(raw_path, source_sha):
    """Read only a canonical, explicitly allowed metadata file, then sanitize it."""
    file = Path(raw_path)
    allowed = {ROOT.parent / name for name in ("innochem-runtime-before.json", "innochem-runtime-after.json")}
    if (not file.is_absolute() or file.name.startswith(".env") or file.suffix != ".json"
            or file not in allowed or file.is_symlink() or not file.is_file()
            or file.resolve(strict=True) != file or file.stat().st_size > 8192):
        raise ValueError("Runtime proof must be the canonical regular allowlisted JSON file")
    metadata = json.loads(file.read_bytes())
    expected = {
        "application": "oxdsv73fkwbxg7t0umly3ucd",
        "image": "oxdsv73fkwbxg7t0umly3ucd:" + source_sha,
        "healthy": True,
        "STOREFRONT_PREVIEW": "true",
        "PAYMENTS_ENABLED": "false",
        "MAIL_DELIVERY_ENABLED": "false",
        "STORE_WORKER_ENABLED": "true",
    }
    if (not isinstance(metadata, dict) or set(metadata) != {*expected, "source"}
            or any(metadata[key] != value for key, value in expected.items())
            or metadata["healthy"] is not True
            or not isinstance(metadata["source"], str)
            or not re.fullmatch(r"read-only SSH/docker inspect [0-9A-Z :+\-]{10,50}", metadata["source"])):
        raise ValueError("Runtime proof is not the expected minimal nonsensitive preview metadata")
    return (json.dumps(metadata, indent=2) + "\n").encode()


def interrupted(signum, _frame):
    raise KeyboardInterrupt("Pipeline interrupted by signal " + str(signum))


def run():
    series, version, source_sha, runtime_path = sys.argv[1:]
    if (not re.fullmatch(r"[A-Za-z0-9-]{1,40}", series)
            or not re.fullmatch(r"[a-f0-9]{40}", source_sha)
            or version != "154.0.8037.92"):
        raise ValueError("Invalid series, source SHA or pinned browser version")
    runtime_bytes = validate_runtime(runtime_path, source_sha)
    invoke(["git", "diff", "--quiet", "HEAD", "--", *OWNED_SOURCES], cwd=ROOT)
    instrumentation_commit = invoke(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    packages = json.loads((ROOT / OWNED_SOURCES[-1]).read_text())["packages"]
    for package in packages:
        if digest(MODULES / package["name"] / "package.json") != package["packageJsonSHA256"]:
            raise ValueError("Dependency metadata changed: " + package["name"])
    inputs = {
        "instrumentationCommit": instrumentation_commit, "sourceSHA": source_sha,
        "series": series, "plannedSamples": 6, "expectedBrowserVersion": version,
        "imageID": IMAGE, "inputSHA256": {name: digest(ROOT / name) for name in OWNED_SOURCES},
    }
    payload = WORK / (series + "-payload.tar.gz")
    if payload.exists():
        raise ValueError("Payload already exists; never overwrite")

    def permitted(info):
        if any(part.startswith(".env") or part in (".DS_Store", "__pycache__") for part in Path(info.name).parts):
            return None
        return info

    with tarfile.open(payload, "w:gz", compresslevel=1) as archive:
        archive.add(ROOT / OWNED_SOURCES[0], arcname="measure-home-lcp.mjs")
        info = tarfile.TarInfo("runtime-proof.json")
        info.size, info.mode = len(runtime_bytes), 0o644
        archive.addfile(info, io.BytesIO(runtime_bytes))
        for package in packages:
            archive.add(MODULES / package["name"], arcname="tooling/node_modules/" + package["name"], filter=permitted)
    payload_sha = digest(payload)
    print(json.dumps({"stage": "payload", "bytes": payload.stat().st_size, "sha256": payload_sha, "runtimeModules": len(packages)}), flush=True)
    remote_dir = "/tmp/innochem-lcp-20261009-" + series
    container = "innochem-lcp-20261009-" + series
    nonce = uuid.uuid4().hex
    qdir, qcontainer, qnonce = map(shlex.quote, (remote_dir, container, nonce))
    setup = f"qa_dir={qdir}\nqa_container={qcontainer}\nqa_nonce={qnonce}\n"
    # Both the remote shell trap and the local finally identify the exact ID and
    # two ownership labels. On failure they stop, but preserve, owned resources.
    stop_owned = """
stop_owned() {
  test -s "$qa_dir/container-id.txt" || return 0
  qa_id=$(cat "$qa_dir/container-id.txt")
  test ${#qa_id} = 64 || return 1
  ownership=$(docker inspect --format '{{.Id}} {{index .Config.Labels "programo.qa-owner"}} {{index .Config.Labels "programo.qa-nonce"}}' "$qa_id" 2>/dev/null) || return 0
  test "$ownership" = "$qa_id innochem-lcp-20261009 $qa_nonce" || return 1
  docker stop --time=10 "$qa_id" >/dev/null
}
"""
    inside = ("mkdir -p /tmp/innochem-results /tmp/innochem-lcp && exec env "
              "LIGHTHOUSE_MODULES=/tmp/payload/tooling/node_modules "
              "INNOCHEM_EXPECTED_BROWSER_VERSION=" + shlex.quote(version) + " "
              "INNOCHEM_SOURCE_SHA=" + shlex.quote(source_sha) + " "
              "INNOCHEM_RUNTIME_PROOF=/tmp/payload/runtime-proof.json "
              "node /tmp/payload/measure-home-lcp.mjs https://sklep-innochem.programo.pl "
              "/tmp/innochem-results/" + series + " 6")
    program = "set -eu\n" + setup + stop_owned + """
trap stop_owned EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
command -v timeout >/dev/null
actual=$(sha256sum "$qa_dir/payload.tar.gz" | cut -d' ' -f1)
""" + "test \"$actual\" = " + shlex.quote(payload_sha) + "\n" + """
volumes=$(docker image inspect --format '{{json .Config.Volumes}}' skup-fb-collector:local)
test "$volumes" = '{"/profile":{}}'
image=$(docker image inspect --format '{{.Id}}' skup-fb-collector:local)
""" + "test \"$image\" = " + shlex.quote(IMAGE) + "\n" + """
printf '%s\n' "$image" > "$qa_dir/image-id.txt"
cat /proc/loadavg > "$qa_dir/host-load-before.txt"
free -b > "$qa_dir/host-memory-before.txt"
mkdir "$qa_dir/payload"
tar -xzf "$qa_dir/payload.tar.gz" -C "$qa_dir/payload"
docker create --name "$qa_container" --label programo.qa-owner=innochem-lcp-20261009 --label "programo.qa-nonce=$qa_nonce" --cpus=2 --memory=2g --pids-limit=256 --user=1000:1000 --workdir=/tmp --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /profile:rw,nosuid,noexec,size=16m,mode=0700,uid=1000,gid=1000 --entrypoint /usr/bin/env "$image" -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/innochem-lcp TMPDIR=/tmp /bin/sh -c """ + shlex.quote(inside) + """ > "$qa_dir/container-id.txt"
qa_id=$(cat "$qa_dir/container-id.txt")
docker cp "$qa_dir/payload" "$qa_id:/tmp/payload"
docker inspect --format '{{json .HostConfig}}' "$qa_id" > "$qa_dir/container-host-config.json"
docker inspect --format '{{json .Mounts}}' "$qa_id" > "$qa_dir/container-mounts.json"
test "$(docker inspect --format '{{range .Mounts}}{{if ne .Type "tmpfs"}}unexpected{{end}}{{end}}' "$qa_id")" = ''
# Bound the remote start even if the client disappears. A timeout still stops
# the exact owned container before artifact capture.
if ! timeout --signal=TERM --kill-after=15s 900s docker start --attach "$qa_id"; then stop_owned; fi
docker inspect --format '{{json .State}}' "$qa_id" > "$qa_dir/container-state.json"
cat /proc/loadavg > "$qa_dir/host-load-after.txt"
free -b > "$qa_dir/host-memory-after.txt"
docker cp "$qa_id:/tmp/innochem-results" "$qa_dir/results"
tar -czf "$qa_dir/results.tar.gz" -C "$qa_dir" results image-id.txt host-load-before.txt host-load-after.txt host-memory-before.txt host-memory-after.txt container-host-config.json container-state.json container-mounts.json container-id.txt
sha256sum "$qa_dir/results.tar.gz"
"""
    remote_prepared = False
    try:
        # Mark cleanup scope before SSH: a disconnect can hide a successful mkdir.
        remote_prepared = True
        remote("test ! -e " + qdir + " && mkdir " + qdir, timeout=30)
        invoke(["scp", "-i", IDENTITY, "-o", "BatchMode=yes", str(payload), "root@159.195.206.7:" + remote_dir + "/payload.tar.gz"], timeout=120)
        remote(program, timeout=1000)
        local_archive = WORK / (series + "-vm-results.tar.gz")
        if local_archive.exists():
            raise ValueError("Results archive already exists")
        invoke(["scp", "-i", IDENTITY, "-o", "BatchMode=yes", "root@159.195.206.7:" + remote_dir + "/results.tar.gz", str(local_archive)], timeout=120)
        remote_sha = remote("sha256sum " + qdir + "/results.tar.gz", capture_output=True, text=True, timeout=30).stdout.split()[0]
        if remote_sha != digest(local_archive):
            raise ValueError("Result archive hash mismatch; preserve remote QA")
        local_results = WORK / (series + "-vm")
        local_results.mkdir()
        with tarfile.open(local_archive) as archive:
            archive.extractall(local_results, filter="data")
        folder = local_results / "results" / series
        measurements = json.loads((folder / "measurements.json").read_text())
        manifest = json.loads((folder / "hashes.json").read_text())
        for row in manifest:
            file = folder / row["name"]
            if file.parent != folder or digest(file) != row["sha256"]:
                raise ValueError("Artifact hash mismatch; preserve remote QA")
        (local_results / "pipeline-inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
        closure = {"remoteDirectory": remote_dir, "container": container, "payloadSHA256": payload_sha,
                   "resultArchiveSHA256": digest(local_archive), "artifactHashesVerified": len(manifest),
                   "runs": len(measurements["runs"]), "allBrowsersClosed": all(row["browserClosed"] for row in measurements["runs"])}
        remove = ("set -eu\n" + setup + stop_owned + "stop_owned\n" +
                  "qa_id=$(cat \"$qa_dir/container-id.txt\")\n" +
                  "test \"$(docker inspect --format '{{.State.Running}}' \"$qa_id\")\" = false\n" +
                  "docker rm \"$qa_id\" && rm -rf -- \"$qa_dir\"\n")
        remote(remove, timeout=30)
        closure["remoteResourcesRemoved"] = True
        (local_results / "retrieval-cleanup.json").write_text(json.dumps(closure, indent=2) + "\n")
        print(json.dumps(closure), flush=True)
        invoke(["git", "diff", "--quiet", "HEAD", "--", *OWNED_SOURCES], cwd=ROOT)
        invoke(["python3", str(ROOT / OWNED_SOURCES[1]), str(folder)])
        if series == "baseline-six":
            historical = WORK / "historical-validation"
            invoke(["python3", str(ROOT / OWNED_SOURCES[1]), str(historical)])
            sample = json.loads((historical / "trace-diagnosis.json").read_text())["samples"][0]
            assert abs(sample["observedLcpMs"] - 2492.829) < 0.001
            assert any(abs(phase["wallMs"] - 1002.520) < 0.001 for phase in sample["nativePresentedFrameStages"])
            print(json.dumps({"stage": "historical-parser-validation", "passed": True}), flush=True)
    finally:
        if remote_prepared:
            # A second signal must not interrupt the bounded cleanup attempt.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            try:
                result = remote("set -eu\n" + setup + stop_owned + "stop_owned\n", timeout=25, capture_output=True, text=True)
                receipt = {"ownedStopAttemptSucceeded": True, "stdout": result.stdout}
            except Exception as error:
                receipt = {"ownedStopAttemptSucceeded": False, "error": str(error), "remoteDirectory": remote_dir, "container": container}
                print(json.dumps(receipt), file=sys.stderr, flush=True)
            (WORK / (series + "-stop-receipt.json")).write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    run()

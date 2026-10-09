#!/usr/bin/env python3
"""Verify Innochem in the existing encrypted VM repository without exposing data."""

import argparse
import datetime as dt
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import tempfile


class VerificationError(ValueError):
    """An allowlisted, data-free diagnostic code."""


def utc():
    return dt.datetime.now(dt.timezone.utc)


def atomic(path, record):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    staged = path.with_name(path.name + ".writing-" + str(os.getpid()))
    created = False
    try:
        with staged.open("x") as stream:
            created = True
            os.chmod(staged, 0o600)
            json.dump(record, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, path)
    finally:
        if created:
            staged.unlink(missing_ok=True)


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed > utc():
        raise VerificationError("INVALID_TIMESTAMP")
    return parsed


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(128 * 1024):
            digest.update(block)
    return digest.hexdigest()


def inventory(root):
    files = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise VerificationError("MEDIA_SYMLINK_NOT_ALLOWED")
        if path.is_file():
            files[path.relative_to(root).as_posix()] = path.stat().st_size
    if not files:
        raise VerificationError("MEDIA_SOURCE_EMPTY")
    return files


def inventory_digest(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def gzip_valid(path):
    size = 0
    with gzip.open(path, "rb") as stream:
        while block := stream.read(128 * 1024):
            size += len(block)
    if not size:
        raise VerificationError("SQL_DUMP_EMPTY")


class Restic:
    def __init__(self, repository, password_file, binary="restic"):
        self.command = [binary, "-r", repository, "--password-file", password_file,
                        "--limit-download", "4096"]
        # Reuse the already operational encrypted repository cache. Repeated
        # no-cache calls reload a large VM index even for a sub-megabyte restore.
        cache = Path("/root/.cache/restic")
        self.command += ["--cache-dir", str(cache)] if cache.is_dir() else ["--no-cache"]

    def run(self, args, **options):
        process = subprocess.Popen(self.command + list(args), start_new_session=True, **options)
        try:
            output, error = process.communicate(timeout=180)
            return subprocess.CompletedProcess(process.args, process.returncode, output, error)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)

    def json(self, *args):
        result = self.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode or len(result.stdout) > 8 * 1024 * 1024:
            raise RuntimeError("RESTIC_METADATA_FAILED")
        return result.stdout.decode("utf-8")

    def dump(self, snapshot, source, destination, limit):
        def bounded():
            resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))
        with destination.open("xb") as stream:
            result = self.run(["dump", snapshot, source], stdout=stream,
                              stderr=subprocess.PIPE, preexec_fn=bounded)
        if result.returncode or destination.stat().st_size > limit:
            raise RuntimeError("BOUNDED_RESTORE_FAILED")


def verify(args, restic=None):
    root = Path(args.backups)
    if root.is_symlink() or (root / "LAST_BACKUP_FAILED").exists():
        raise VerificationError("LOCAL_BACKUP_FAILED")
    copies = [path for path in root.glob("innochem-*.sql.gz") if path.is_file() and not path.is_symlink()]
    if not copies:
        raise VerificationError("SQL_DUMP_MISSING")
    latest = max(copies, key=lambda path: path.stat().st_mtime)
    source_age = (utc().timestamp() - latest.stat().st_mtime) / 3600
    if not 0 <= source_age <= 34:
        raise VerificationError("SQL_DUMP_STALE")
    if not 200000 <= latest.stat().st_size <= args.restore_limit:
        raise VerificationError("SQL_DUMP_OUTSIDE_RESTORE_LIMIT")
    gzip_valid(latest)
    local_media = inventory(root / "media")
    shared = json.loads(Path(args.vm_state).read_text())
    if shared.get("state") != "OK" or shared.get("source_nodes_verified") is not True:
        raise VerificationError("SHARED_VM_BACKUP_NOT_VERIFIED")
    snapshot = shared.get("snapshot_id", "")
    if len(snapshot) != 64 or any(c not in "0123456789abcdef" for c in snapshot):
        raise VerificationError("INVALID_SNAPSHOT_ID")
    restic = restic or Restic(args.repository, args.password_file)
    records = json.loads(restic.json("snapshots", "--json", snapshot))
    item = next((item for item in records if item.get("id") == snapshot), None)
    if not item or "vm" not in item.get("tags", []):
        raise VerificationError("VM_SNAPSHOT_NOT_FOUND")
    snapshot_time = timestamp(item["time"])
    if (utc() - snapshot_time).total_seconds() > 30 * 3600:
        raise VerificationError("OFFSITE_SNAPSHOT_STALE")
    files = {}
    for line in restic.json("ls", "--json", "--recursive", snapshot, str(root)).splitlines():
        node = json.loads(line)
        if node.get("type") == "file":
            files[node["path"]] = node["size"]
    if files.get(str(latest)) != latest.stat().st_size:
        raise VerificationError("LATEST_SQL_MISSING_FROM_OFFSITE")
    prefix = str(root / "media") + "/"
    remote_media = {path[len(prefix):]: size for path, size in files.items() if path.startswith(prefix)}
    if local_media != remote_media:
        raise VerificationError("MEDIA_INVENTORY_MISMATCH")
    eligible = sorted(name for name, size in local_media.items() if 0 < size <= args.restore_limit - latest.stat().st_size)
    if not eligible:
        raise VerificationError("MEDIA_SAMPLE_OUTSIDE_RESTORE_LIMIT")
    sample = root / "media" / eligible[0]
    samples = []
    with tempfile.TemporaryDirectory(prefix="innochem-restic-restore-") as temporary:
        for label, source in (("sql", latest), ("media", sample)):
            destination = Path(temporary) / label
            restic.dump(snapshot, str(source), destination, args.restore_limit)
            digest = sha256(source)
            restored_digest = sha256(destination)
            if destination.stat().st_size != source.stat().st_size or digest != restored_digest:
                raise VerificationError("RESTORED_CONTENT_MISMATCH")
            if label == "sql":
                gzip_valid(destination)
            samples.append({"kind": label, "bytes": destination.stat().st_size,
                            "sourceSha256": digest, "restoredSha256": restored_digest, "match": True})
    return {"state": "OK", "snapshotId": snapshot, "snapshotAt": snapshot_time.isoformat(),
            "sqlBackupAgeHours": round(source_age, 2), "sqlBackupName": latest.name,
            "mediaFiles": len(local_media), "mediaBytes": sum(local_media.values()),
            "mediaInventorySha256": inventory_digest(local_media), "mediaInventoryMatch": True,
            "restoredBytes": sum(sample["bytes"] for sample in samples), "restoredSamples": samples,
            "repositoryAlias": "storagebox-vm", "repositoryDirectory": "restic", "retentionChanged": False}


def main():
    def interrupted(signum, frame):
        raise KeyboardInterrupt("OWNED_VERIFICATION_INTERRUPTED")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", default="sftp:storagebox-vm:restic")
    parser.add_argument("--password-file", default="/root/.config/restic/vm.pass")
    parser.add_argument("--backups", default="/root/backups/innochem")
    parser.add_argument("--vm-state", default="/var/lib/programo-infra/offsite-restic.json")
    parser.add_argument("--state", default="/root/innochem-monitor/offsite-status.json")
    parser.add_argument("--restore-limit", type=int, default=2 * 1024 * 1024)
    args = parser.parse_args()
    os.umask(0o077)
    state = Path(args.state)
    state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with state.with_suffix(".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"skipped":"already-running"}')
            return 75
        record = {"at": utc().isoformat(), "pid": os.getpid()}
        try:
            record.update(verify(args))
        except Exception as error:
            # Exception messages from restic/SSH must never enter notifications.
            record.update(state="FAILED", error=str(error) if isinstance(error, VerificationError) else type(error).__name__)
        record["completedAt"] = utc().isoformat()
        atomic(state, record)
        print(json.dumps(record, separators=(",", ":")))
        return 0 if record["state"] == "OK" else 1


if __name__ == "__main__":
    raise SystemExit(main())

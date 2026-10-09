#!/bin/bash
# Daily VM copy: consistent pg_dump plus the existing non-deleting media mirror.
# This is not the separately encrypted offsite snapshot/restore workflow.
set -Eeuo pipefail
umask 077
DIR=${INNOCHEM_BACKUP_DIR:-/root/backups/innochem}
DB_CT=${INNOCHEM_BACKUP_DATABASE_CONTAINER:-z0uq3maor6klm78hxjvyzip7}
MEDIA_VOL=${INNOCHEM_BACKUP_MEDIA_VOLUME:-oxdsv73fkwbxg7t0umly3ucd-innochem-store-media}
MIN_BYTES=${INNOCHEM_BACKUP_MIN_BYTES:-200000}
FLAG=$DIR/LAST_BACKUP_FAILED
PARTIAL=
CANDIDATE=
# Close inherited FD8 so a failed allocation cannot claim another open inode.
exec 8>&-
mkdir -p "$DIR"
fail() {
  trap '' HUP INT TERM
  trap - ERR
  printf '%s backup FAIL: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$DIR/backup.log" || true
  touch "$FLAG" || true
  exit 1
}
cleanup() {
  # A signal can arrive before PARTIAL receives its value. The open descriptor
  # proves which inode this invocation created, even in that allocation window.
  trap '' HUP INT TERM
  trap - ERR
  if [[ -n "$CANDIDATE" ]]; then
    python3 - "$CANDIDATE" <<'PY_OWNED_STAGE' || true
import os, stat, sys
try:
    path = sys.argv[1]
    created = os.fstat(8)
    present = os.stat(path, follow_symlinks=False)
    if stat.S_ISREG(present.st_mode) and (created.st_dev, created.st_ino) == (present.st_dev, present.st_ino):
        os.unlink(path)
except OSError:
    pass
PY_OWNED_STAGE
  fi
  exec 8>&-
}
trap cleanup EXIT
trap 'fail "unexpected error at line $LINENO"' ERR
trap 'fail "interrupted"' HUP INT TERM
exec 9>"$DIR/.backup.lock"
if ! flock -n 9; then
  printf '%s backup SKIP: another copy is running\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$DIR/backup.log"
  exit 0
fi
command -v python3 >/dev/null || fail "python3 is required for staging ownership cleanup"
TS=$(date -u +%Y%m%d-%H%M%S)
NONCE=$$-$RANDOM-$RANDOM
CANDIDATE=$DIR/.innochem-$TS.partial.$NONCE
# Builtin redirection creates the stage exclusively and records ownership before
# Bash can dispatch a signal trap; no child output is needed to learn the path.
set -C
if { exec 8> "$CANDIDATE"; }; then
  set +C
  PARTIAL=$CANDIDATE
else
  set +C
  fail "cannot allocate private staging file"
fi
FINAL=$DIR/innochem-$TS-$NONCE.sql.gz
docker exec "$DB_CT" pg_dump -U innochem -d innochem --no-owner | gzip >&8
gzip -t "$PARTIAL"
BYTES=$(wc -c < "$PARTIAL")
[[ "$BYTES" -ge "$MIN_BYTES" ]] || fail "dump only $BYTES bytes"
# A hard link publishes the fully written file atomically, without overwriting
# any pre-existing copy. Preserve valid SQL even if the media step later fails.
# Both paths are on the same backup filesystem.
ln -- "$PARTIAL" "$FINAL"
rm -f -- "$PARTIAL"
PARTIAL=
docker run --rm -v "$MEDIA_VOL":/src:ro -v "$DIR/media":/dst alpine:3.20 sh -c \
  'apk add --no-cache rsync >/dev/null && rsync -a --exclude=*.tmp /src/ /dst/' || fail "media rsync"
MEDIA_FILES=$(find "$DIR/media" -type f | wc -l)
rm -f -- "$FLAG"
printf '%s backup OK %s %s bytes, media %s files\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${FINAL##*/}" "$BYTES" "$MEDIA_FILES" >> "$DIR/backup.log"
# Retention/pruning remains disabled; existing copies are never deleted here.

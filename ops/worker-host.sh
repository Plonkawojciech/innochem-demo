#!/bin/sh
# Activate only after the existing Innochem scheduler is disabled and drained.
set -eu
umask 077
worker_root=/root/innochem-monitor
lock_root=/run/innochem-worker
# RuntimeDirectory is created root-owned by the proposed systemd service.
[ -d "$lock_root" ] || exit 1
exec 9>"$lock_root/worker.lock"
if ! flock -n 9; then
  printf '%s\n' '{"status":"skipped_busy"}'
  exit 0
fi
container_id=$(python3 -B "$worker_root/select-healthy-container.py" --docker)
python3 -B "$worker_root/select-healthy-container.py" --docker --verify-id "$container_id" >/dev/null
# Existing image user, secret, flags, HTTP guards, DB leases and idempotency stay intact.
# Override only the non-secret target URL to this selected container's own API.
# Never retry a failed/uncertain tick in another container in the same invocation.
printf '{"status":"starting_worker","containerId":"%s"}\n' "$container_id"
exec docker exec --user store --workdir /app --env WORKER_URL=http://127.0.0.1:3000/api/internal/worker \
  "$container_id" node /app/operations/worker-once.mjs

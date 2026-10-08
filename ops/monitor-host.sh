#!/bin/sh
# Sanitized local status; notification delivery is configured separately.
set -u
monitor_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
umask 077
python3 -B "$monitor_root/monitor-host.py" > "$monitor_root/status-next.json"
monitor_result=$?
mv "$monitor_root/status-next.json" "$monitor_root/status.json"
cat "$monitor_root/status.json" >> "$monitor_root/history.jsonl"
exit "$monitor_result"

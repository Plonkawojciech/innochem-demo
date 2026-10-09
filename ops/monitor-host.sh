#!/bin/sh
# Sanitized local status plus the existing Programo notification transport.
set -u
monitor_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
umask 077
python3 -B "$monitor_root/monitor-host.py" > "$monitor_root/status-next.json"
monitor_result=$?
mv "$monitor_root/status-next.json" "$monitor_root/status.json"
cat "$monitor_root/status.json" >> "$monitor_root/history.jsonl"
notification_result=0
python3 -B "$monitor_root/offsite-alerts.py" --root "$monitor_root" || notification_result=$?
if [ "$monitor_result" -eq 0 ] && [ "$notification_result" -ne 0 ]; then
  exit "$notification_result"
fi
exit "$monitor_result"

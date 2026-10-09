#!/usr/bin/env python3
"""Read-only Innochem container selector; never invokes a worker/API."""
import argparse
import calendar
import datetime
import json
import re
import subprocess
import sys

RESOURCE_UUID = 'oxdsv73fkwbxg7t0umly3ucd'
NAME = re.compile(r'^/' + RESOURCE_UUID + r'-\d{8}T\d{6}$')
IMAGE = re.compile(r'^' + RESOURCE_UUID + r':[0-9a-f]{40}$')
ID = re.compile(r'^[0-9a-f]{64}$')
CREATED = re.compile(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$')

class SelectionError(Exception):
    pass

def created_ns(value):
    match = CREATED.fullmatch(value or '')
    if not match:
        raise SelectionError('invalid_creation_timestamp')
    base = datetime.datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S')
    return calendar.timegm(base.timetuple()) * 1_000_000_000 + int((match[2] or '').ljust(9, '0'))

def select(rows):
    candidates = []
    for row in rows:
        if not NAME.fullmatch(row.get('name', '')) or not IMAGE.fullmatch(row.get('imageReference', '')):
            continue
        labels = row.get('labels') or {}
        if labels.get('coolify.managed') != 'true' or labels.get('coolify.type') != 'application':
            continue
        # Missing/zero PR label is the base deploy, as in Coolify's own listing source.
        # applicationId is absent in the captured real metadata and is not required.
        if labels.get('coolify.pullRequestId') not in (None, '', '0'):
            continue
        if row.get('user') != 'store':
            continue
        if row.get('running') is not True or row.get('status') != 'running' or row.get('health') != 'healthy':
            continue
        if not ID.fullmatch(row.get('id', '')):
            raise SelectionError('invalid_container_id')
        candidates.append((created_ns(row.get('created')), row))
    if not candidates:
        raise SelectionError('no_healthy_owned_container')
    newest = max(stamp for stamp, _ in candidates)
    winners = [row for stamp, row in candidates if stamp == newest]
    if len(winners) != 1:
        raise SelectionError('ambiguous_newest_owned_container')
    return winners[0]

def docker_rows():
    # Only running candidates can be selected. Batch inspect keeps one complete
    # pass within two Docker calls (10s each), independent of candidate count.
    listed = subprocess.run(['docker', 'ps', '--filter', 'name=' + RESOURCE_UUID, '--format', '{{.Names}}'], capture_output=True, text=True, timeout=10, check=True)
    names = [name for name in listed.stdout.splitlines() if NAME.fullmatch('/' + name)]
    if not names:
        return []
    template = '{{json .Id}}\t{{json .Name}}\t{{json .Image}}\t{{json .Config.Image}}\t{{json .Created}}\t{{json .State.Running}}\t{{json .State.Status}}\t{{json .State.StartedAt}}\t{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}\t{{json .Config.User}}\t{{json (index .Config.Labels "coolify.managed")}}\t{{json (index .Config.Labels "coolify.type")}}\t{{json (index .Config.Labels "coolify.pullRequestId")}}'
    inspected = subprocess.run(['docker', 'inspect', '--format', template, *names], capture_output=True, text=True, timeout=10, check=True)
    rows = []
    for line in inspected.stdout.splitlines():
        values = [json.loads(field) for field in line.split('\t')]
        if len(values) != 13:
            raise SelectionError('invalid_metadata_shape')
        row = dict(zip(['id', 'name', 'imageId', 'imageReference', 'created', 'running', 'status', 'startedAt', 'health', 'user'], values[:10]))
        row['labels'] = dict(zip(['coolify.managed', 'coolify.type', 'coolify.pullRequestId'], values[10:]))
        rows.append(row)
    if len(rows) != len(names):
        raise SelectionError('incomplete_metadata_inventory')
    return rows

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker', action='store_true', help='Read only Docker metadata; default input is JSON from stdin.')
    parser.add_argument('--verify-id', help='Fail if this exact ID is no longer the newest healthy owned container.')
    args = parser.parse_args()
    try:
        rows = docker_rows() if args.docker else json.load(sys.stdin)
        selected = select(rows)
        if args.verify_id and selected['id'] != args.verify_id:
            raise SelectionError('selection_changed_before_execution')
        print(selected['id'])
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error, SelectionError) else 'metadata_read_failed'
        print(json.dumps({'status': 'failed_selection', 'reason': reason}), file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())

"""Read-only VM checks; logs contain aggregates, never credentials or customer data."""
import argparse
import datetime
import gzip
import importlib.util
import math
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError('Monitor command failed')
    return result.stdout.strip()


def assess(state):
    failures = []
    if state.get('containerHealthy') is not True:
        failures.append('container')
    if state.get('httpHealthy') is not True:
        failures.append('http')
    if state.get('workerEnabled') is not True or (
        not 0 <= state.get('heartbeatAgeSeconds', 999999) <= 300
        and state.get('workerStartupGrace') is not True
    ):
        failures.append('worker')
    if state.get('backupValid') is not True or state.get('backupAgeHours', 999999) > 34 or state.get('backupFailed') is True:
        failures.append('backup')
    if state.get('diskUsedPercent', 100) >= 90:
        failures.append('disk')
    for name in ('mailUncertain', 'mailExhausted', 'mailOverdue', 'paymentsStale', 'paymentReview', 'analyticsOverdue'):
        if state.get(name, 0) > 0:
            failures.append(name)
    return failures



def load_container_selector():
    selector_path = Path(__file__).with_name('select-healthy-container.py')
    spec = importlib.util.spec_from_file_location('innochem_container_selector', selector_path)
    if spec is None or spec.loader is None:
        raise RuntimeError('Store selector unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


WORKER_STATUS_SCRIPT = """const fs=require('node:fs');let heartbeat=null,heartbeatState='missing';try{const value=Number(fs.readFileSync('/tmp/innochem-worker-heartbeat','utf8').trim());if(Number.isFinite(value)&&value>0){heartbeat=value;heartbeatState='valid'}else{heartbeatState='invalid'}}catch(error){heartbeatState=error.code==='ENOENT'?'missing':'unreadable'}process.stdout.write(JSON.stringify({workerEnabled:process.env.STORE_WORKER_ENABLED==='true',heartbeat,heartbeatState}))"""


def collect(app, database, backup_directory, health_url):
    selector = load_container_selector()
    if app != selector.RESOURCE_UUID:
        raise RuntimeError('Store application identity mismatch')
    container = selector.select(selector.docker_rows())
    started = datetime.datetime.fromisoformat(container['startedAt'].replace('Z', '+00:00'))
    # Read only the inherited non-secret boolean and numeric heartbeat under the
    # same user/context as the worker. Never read Config.Env or print file contents.
    runtime = json.loads(command(['docker', 'exec', '--user', 'store', '--workdir', '/app', container['id'], 'node', '-e', WORKER_STATUS_SCRIPT]))
    now = time.time()
    container_age = max(0, now - started.timestamp())
    state = {'containerHealthy': True, 'workerEnabled': runtime.get('workerEnabled') is True,
             'workerContainerId': container['id'], 'workerContainerCreated': container['created']}
    heartbeat_state = runtime.get('heartbeatState')
    try:
        heartbeat = float(runtime.get('heartbeat'))
        if heartbeat_state != 'valid' or not math.isfinite(heartbeat) or heartbeat <= 0 or heartbeat / 1000 > now + 5:
            raise ValueError('Invalid heartbeat')
        state['heartbeatAgeSeconds'] = round(max(0, now - heartbeat / 1000))
    except (TypeError, ValueError, OverflowError):
        state['heartbeatAgeSeconds'] = 999999
    # Grace applies only to a genuinely absent heartbeat on the selected startup.
    # Invalid, unreadable and stale heartbeats cannot receive grace.
    state['workerStartupGrace'] = heartbeat_state == 'missing' and container_age < 300
    try:
        with urllib.request.urlopen(health_url, timeout=10) as response:
            state['httpHealthy'] = response.status == 200 and json.loads(response.read(4096)).get('status') == 'ok'
    except Exception:
        state['httpHealthy'] = False
    sql = """SELECT json_build_object(
      'mailUncertain',(SELECT count(*) FROM mail_outbox WHERE NOT preview AND delivery_state='uncertain'),
      'mailExhausted',(SELECT count(*) FROM mail_outbox WHERE NOT preview AND sent_at IS NULL AND attempts>=8),
      'mailOverdue',(SELECT count(*) FROM mail_outbox WHERE NOT preview AND sent_at IS NULL AND delivery_state IN ('queued','failed') AND available_at<=now() AND created_at<now()-interval '30 minutes'),
      'paymentsStale',(SELECT count(*) FROM payment_sessions WHERE state IN ('creating','open','processing') AND COALESCE(last_checked_at,created_at)<now()-interval '10 minutes'),
      'paymentReview',(SELECT count(*) FROM orders WHERE status='payment_review'),
      'analyticsOverdue',(SELECT count(*) FROM analytics_outbox WHERE status IN ('pending','failed') AND next_attempt_at<=now() AND created_at<now()-interval '30 minutes'))"""
    state.update(json.loads(command(['docker', 'exec', database, 'psql', '-U', 'innochem', '-d', 'innochem', '-X', '-At', '-c', sql])))
    root = Path(backup_directory)
    state['backupFailed'] = (root / 'LAST_BACKUP_FAILED').exists()
    copies = list(root.glob('innochem-*.sql.gz'))
    state['backupValid'] = False
    state['backupAgeHours'] = 999999
    if copies:
        latest = max(copies, key=lambda p: p.stat().st_mtime)
        state['backupAgeHours'] = round((time.time() - latest.stat().st_mtime) / 3600, 2)
        try:
            size = 0
            with gzip.open(latest, 'rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
            state['backupValid'] = size > 0
        except Exception:
            pass
    disk = os.statvfs(root)
    state['diskUsedPercent'] = round(100 * (1 - disk.f_bavail / disk.f_blocks), 1)
    return state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', default='oxdsv73fkwbxg7t0umly3ucd')
    parser.add_argument('--database', default='z0uq3maor6klm78hxjvyzip7')
    parser.add_argument('--backups', default='/root/backups/innochem')
    parser.add_argument('--health-url', default='https://sklep-innochem.programo.pl/api/health')
    args = parser.parse_args()
    record = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        state = collect(args.app, args.database, args.backups, args.health_url)
        record.update(state)
        record['failures'] = assess(state)
    except Exception:
        record['failures'] = ['monitor_unavailable']
    record['healthy'] = not record['failures']
    print(json.dumps(record, separators=(',', ':')))
    raise SystemExit(0 if record['healthy'] else 1)


if __name__ == '__main__':
    main()

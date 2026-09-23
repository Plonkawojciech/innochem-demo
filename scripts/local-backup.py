"""Run the encrypted local store backup with its key loaded directly from Keychain."""
import os
from pathlib import Path
import secrets
import base64
import subprocess
import sys

service = 'programo.innochem.store-backup-v1'
result = subprocess.run(['security', 'find-generic-password', '-s', service, '-w'], capture_output=True)
if result.returncode:
    if len(sys.argv) < 2 or sys.argv[1] != 'backup':
        raise SystemExit('Backup key is absent from Keychain; restore cannot continue.')
    secret = base64.b64encode(secrets.token_bytes(32)).decode()
    subprocess.run(['security', 'add-generic-password', '-a', os.getlogin(), '-s', service, '-w', secret], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
else:
    secret = result.stdout.decode().strip()
env = {**os.environ, 'BACKUP_ENCRYPTION_KEY': secret}
if len(sys.argv) < 2:
    raise SystemExit('Usage: python3 scripts/local-backup.py backup NEW_DIRECTORY | restore-test BACKUP NEW_DIRECTORY NEW_DATABASE')
raise SystemExit(subprocess.call([sys.executable, 'scripts/local.py', 'node', 'scripts/backup.mjs', *sys.argv[1:]], env=env))

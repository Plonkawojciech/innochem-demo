"""Run a local command with private paths and a Keychain authentication secret."""
import os
from pathlib import Path
import secrets
import subprocess
import sys

service='programo.innochem.local-auth'
result=subprocess.run(['security','find-generic-password','-s',service,'-w'],capture_output=True)
if result.returncode:
    secret=secrets.token_hex(32)
    subprocess.run(['security','add-generic-password','-a',os.getlogin(),'-s',service,'-w',secret],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
else:
    secret=result.stdout.decode().strip()
env=os.environ.copy()
env.pop("DATABASE_URL",None)
port=int(env.get('INNOCHEM_LOCAL_PORT','3046'))
env['AUTH_COOKIE_PREFIX']='innochem-test' if env.get('INNOCHEM_LOCAL_DB','').startswith('innochem_test_') else 'innochem'
env.update(PGHOST='/tmp/innochem-postgres',PGPORT='55439',PGDATABASE=env.get('INNOCHEM_LOCAL_DB','innochem'),BETTER_AUTH_SECRET=secret,APP_URL=f'http://127.0.0.1:{port}',MEDIA_ROOT=env.get('INNOCHEM_LOCAL_MEDIA_ROOT',str(Path.home()/'Library/Application Support/Programo/innochem/source/media')),MAIL_DELIVERY_ENABLED='false',PAYMENTS_ENABLED='false',STORE_WORKER_ENABLED='false',STOREFRONT_PREVIEW='true',npm_config_cache='/tmp/innochem-npm-cache')
if not sys.argv[1:]:raise SystemExit('Usage: python3 scripts/local.py <command> [args...]')
raise SystemExit(subprocess.call(sys.argv[1:],env=env))

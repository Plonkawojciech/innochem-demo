"""Create an isolated test database; never resets an existing database."""
import datetime,os,subprocess,sys
name='innochem_test_'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
subprocess.run(['createdb','-h','/tmp/innochem-postgres','-p','55439',name],check=True)
env={**os.environ,'INNOCHEM_LOCAL_DB':name}
for command in [['npm','run','db:migrate'],['npm','test']]:
    result=subprocess.run([sys.executable,'scripts/local.py',*command],env=env)
    if result.returncode:raise SystemExit(result.returncode)
print('Test database retained:',name)

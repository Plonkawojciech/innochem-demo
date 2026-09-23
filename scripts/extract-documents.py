"""Recover legacy office attachments without rerunning or overwriting the customer import."""
import argparse, hashlib, importlib.util, io, json, os, subprocess, zipfile
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--backup',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
root=args.output.resolve()
repo=Path(__file__).resolve().parent.parent
if root==repo or repo in root.parents:raise ValueError('Private media must remain outside the repository')
spec=importlib.util.spec_from_file_location('legacy',Path(__file__).with_name('extract-legacy.py'))
legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
manifest=json.loads((args.backup/'manifest.json').read_text())
key=bytes.fromhex(subprocess.check_output(['security','find-generic-password','-s',manifest['keychain_service'],'-w'],stderr=subprocess.DEVNULL).decode().strip())
inventory=json.loads((root/'media-inventory.json').read_text())
paths={m['source_path']:m for m in inventory}
documents=[]
with zipfile.ZipFile(io.BytesIO(legacy.decrypt(args.backup/'website.zip.enc',key))) as archive:
    for item in archive.infolist():
        if item.is_dir() or '/public_html/wp-content/uploads/' not in item.filename or Path(item.filename).suffix.lower() not in {'.doc','.docx','.odt'}:continue
        relative=item.filename.split('/public_html/',1)[1]
        file=(root/'media'/relative).resolve()
        if (root/'media').resolve() not in file.parents:raise ValueError('Unsafe archive path')
        data=archive.read(item);digest=hashlib.sha256(data).hexdigest()
        if file.exists():
            if hashlib.sha256(file.read_bytes()).hexdigest()!=digest:raise ValueError('Refusing to overwrite an existing document')
        else:
            file.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with file.open('xb') as stream:stream.write(data)
            os.chmod(file,0o600)
        entry={'source_path':relative,'path':'/media/'+relative,'size_bytes':len(data),'sha256':digest}
        if relative not in paths:inventory.append(entry)
        documents.append(entry)
temporary=root/'media-inventory.documents.json'
temporary.write_text(json.dumps(inventory,ensure_ascii=False,indent=2))
temporary.replace(root/'media-inventory.json')
(root/'document-extraction-report.json').write_text(json.dumps(documents,ensure_ascii=False,indent=2))
print(json.dumps({'documents':len(documents),'bytes':sum(d['size_bytes'] for d in documents),'totalMedia':len(inventory)}))

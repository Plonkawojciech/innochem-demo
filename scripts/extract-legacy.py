"""Extract selected legacy data and media from an encrypted audit backup.

The destination must be outside the repository. This never contacts the source
server, sends email, imports passwords, or writes to a production database.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def sql_rows(text):
    row, buf, quoted, escaped, active = [], [], False, False, False
    for char in text:
        if quoted:
            if escaped:
                buf.append({'n': '\n', 'r': '\r', 't': '\t', '0': '\0'}.get(char, char))
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == "'":
                quoted = False
            else:
                buf.append(char)
        elif char == "'":
            quoted = True
        elif char == '(':
            active, row, buf = True, [], []
        elif char == ',' and active:
            row.append(''.join(buf)); buf = []
        elif char == ')' and active:
            row.append(''.join(buf)); yield row
            active, buf = False, []
        elif active:
            buf.append(char)


def decrypt(path, key):
    data = path.read_bytes()
    if data[:9] != b'INNOCHEM1':
        raise ValueError('Unknown backup format')
    cipher = Cipher(algorithms.AES(key), modes.GCM(data[9:21], data[-16:])).decryptor()
    return cipher.update(data[21:-16]) + cipher.finalize()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    repo = Path(__file__).resolve().parent.parent
    if out == repo or repo in out.parents:
        raise ValueError('Private migration data must remain outside the repository')
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = json.loads((args.backup / 'manifest.json').read_text())
    secret = subprocess.check_output(['security', 'find-generic-password', '-s', manifest['keychain_service'], '-w'], stderr=subprocess.DEVNULL).strip()
    key = bytes.fromhex(secret.decode())
    raw = decrypt(args.backup / 'database.sql.gz.enc', key)
    raw = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    text = raw.decode('utf8')
    schemas = {m.group(1): re.findall(r'^\s+`([^`]+)`', m.group(2), re.M)
               for m in re.finditer(r'CREATE TABLE `([^`]+)` \((.*?)\) ENGINE=', text, re.S)}
    public = {'product','product_lang','category','category_lang','category_product','image','image_lang','tax','tax_rule','tax_rules_group','lang','currency','country','country_lang','carrier','delivery','range_price','range_weight','cms','cms_lang','order_state','order_state_lang','order_detail','order_history','orders','message','invoice_or_bill','product_attribute','product_attribute_combination','product_attachment','attachment','attachment_lang','stock_mvt'}
    tables = {}
    for line in text.splitlines():
        match = re.match(r'INSERT INTO `([^`]+)` VALUES (.*);$', line)
        if not match:
            continue
        table = match.group(1)
        if table not in public | {'customer','address','wp_posts','wp_postmeta','wp_terms','wp_term_taxonomy','wp_term_relationships'}:
            continue
        for values in sql_rows(match.group(2)):
            if len(values) != len(schemas[table]):
                raise ValueError('Column count mismatch: ' + table)
            row = dict(zip(schemas[table], values))
            for private_key in ['secure_key', 'download_hash', 'post_password']:
                row.pop(private_key, None)
            if table == 'customer':
                row = {k: row[k] for k in ['id_customer','firstname','lastname','email','active','deleted','date_add','date_upd']}
            if table == 'wp_postmeta' and row.get('meta_key') not in ['_wp_attached_file','_wp_attachment_metadata','_thumbnail_id','_wp_attachment_image_alt']:
                continue
            tables.setdefault(table, []).append(row)
    target = out / 'legacy-data.json'
    target.write_text(json.dumps({'source_sha256':hashlib.sha256(raw).hexdigest(),'tables':tables}, ensure_ascii=False))
    os.chmod(target, 0o600)
    media = out / 'media'
    media.mkdir(exist_ok=True, mode=0o700)
    extensions = {'.jpg','.jpeg','.png','.gif','.webp','.avif','.svg','.ico','.pdf','.tif','.tiff','.bmp'}
    inventory = []
    with zipfile.ZipFile(io.BytesIO(decrypt(args.backup / 'website.zip.enc', key))) as archive:
        for item in archive.infolist():
            name = item.filename
            if item.is_dir() or '/public_html/' not in name or Path(name).suffix.lower() not in extensions:
                continue
            relative = name.split('/public_html/', 1)[1]
            path = (media / relative).resolve()
            if media.resolve() not in path.parents:
                raise ValueError('Unsafe archive path')
            body = archive.read(item)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.write_bytes(body)
            inventory.append({'source_path':relative,'path':'/media/'+relative,'size_bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
    (out / 'media-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2))
    report = {'source_sha256':hashlib.sha256(raw).hexdigest(),'table_counts':{k:len(v) for k,v in tables.items()},'media_files':len(inventory),'media_bytes':sum(x['size_bytes'] for x in inventory),'passwords_exported':False}
    (out / 'extraction-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()

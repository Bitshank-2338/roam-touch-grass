"""Consistent SQLite backup and restore to a NEW directory. Contains private data."""
import argparse, hashlib, json, pathlib, shutil, sqlite3

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def backup(source, target):
    if target.exists(): raise ValueError('Backup destination must not exist')
    target.mkdir(parents=True)
    source_db=sqlite3.connect((source/'roam.sqlite').as_uri()+'?mode=ro',uri=True)
    dest_db=sqlite3.connect(target/'roam.sqlite')
    try:
        source_db.backup(dest_db)
        if dest_db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Database integrity failed')
        needed=set()
        for body,public in dest_db.execute('SELECT body,public_body FROM posts'):
            for raw in (body,public):
                if raw:
                    media=json.loads(raw).get('media','')
                    if media.startswith('/uploads/'): needed.add(pathlib.Path(media).name)
        for name in needed:
            found=next((source/d/name for d in ['quarantine','uploads'] if (source/d/name).is_file()),None)
            if found is None: raise ValueError('Referenced media missing; retry with posting paused')
            rel=found.relative_to(source);(target/rel.parent).mkdir(exist_ok=True);shutil.copy2(found,target/rel)
        for name in ['moderator-key.txt','summary-provenance.key']:
            if (source/name).is_file(): shutil.copy2(source/name,target/name)
    finally: source_db.close();dest_db.close()
    manifest={str(p.relative_to(target)):digest(p) for p in target.rglob('*') if p.is_file()}
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2))

def restore(source,target):
    if target.exists(): raise ValueError('Restore destination must not exist')
    manifest=json.loads((source/'manifest.json').read_text())
    for rel,expected in manifest.items():
        p=(source/rel).resolve()
        if not p.is_relative_to(source.resolve()) or digest(p)!=expected: raise ValueError('Backup checksum failed')
    db=sqlite3.connect((source/'roam.sqlite').as_uri()+'?mode=ro',uri=True)
    try:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Backup database failed integrity check')
    finally: db.close()
    shutil.copytree(source,target)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('action',choices=['backup','restore']);ap.add_argument('source',type=pathlib.Path);ap.add_argument('target',type=pathlib.Path);a=ap.parse_args()
    globals()[a.action](a.source.resolve(),a.target.resolve());print('Verified '+a.action+' completed; keep this private data outside source delivery.')

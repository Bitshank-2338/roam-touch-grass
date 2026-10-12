import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('consistent SQLite backup restores WAL rows, referenced media and keys; refuses overwrite and tampering',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'roam-backup-'));try{
  const source=path.join(dir,'source'),saved=path.join(dir,'saved'),restored=path.join(dir,'restored');mkdirSync(source);mkdirSync(path.join(source,'quarantine'));
  const db=new DatabaseSync(path.join(source,'roam.sqlite'));db.exec('PRAGMA journal_mode=WAL;CREATE TABLE posts(body TEXT,public_body TEXT)');const body=JSON.stringify({id:'wal-row',media:'/uploads/one.webp'});db.prepare('INSERT INTO posts VALUES(?,?)').run(body,body);writeFileSync(path.join(source,'quarantine/one.webp'),'photo');writeFileSync(path.join(source,'summary-provenance.key'),Buffer.alloc(32,1));
  const run=(...args)=>spawnSync(process.env.PYTHON||'python',['ops/backup-data.py',...args],{encoding:'utf8'});
  assert.equal(run('backup',source,saved).status,0);db.close();assert.equal(run('restore',saved,restored).status,0);
  const copy=new DatabaseSync(path.join(restored,'roam.sqlite'));assert.equal(JSON.parse(copy.prepare('SELECT body FROM posts').get().body).id,'wal-row');copy.close();assert.equal(readFileSync(path.join(restored,'quarantine/one.webp'),'utf8'),'photo');assert.equal(readFileSync(path.join(restored,'summary-provenance.key')).length,32);
  assert.notEqual(run('restore',saved,restored).status,0);writeFileSync(path.join(saved,'quarantine/one.webp'),'changed');assert.notEqual(run('restore',saved,path.join(dir,'tampered')).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

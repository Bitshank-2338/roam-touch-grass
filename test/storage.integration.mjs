import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {S3Client,CreateBucketCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {createPostgres} from '../postgres.mjs';
import {createPostgresStore} from '../postgres-store.mjs';
import {createSocialStore} from '../social-store.mjs';
import {createPostgresTrending} from '../postgres-trending.mjs';
import {createMediaStore} from '../media-store.mjs';
import {migrateStorage,tables} from '../ops/migrate-storage.mjs';
const connection=process.env.ROAM_TEST_DATABASE_URL||'postgres://roamtest:local-test-only@127.0.0.1:5442/roamtest';
const url=new URL(connection);if(!['localhost','127.0.0.1','roam-test-postgres'].includes(url.hostname)||url.pathname!=='/roamtest')throw new Error('Integration tests require the disposable local roamtest database.');
const db=await createPostgres(connection),store=createPostgresStore(db);
const client=new S3Client({endpoint:process.env.ROAM_TEST_S3_ENDPOINT||'http://127.0.0.1:9005',region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'roam-local-test',secretAccessKey:'local-test-password-only'}});
const bucket='roam-test-'+randomUUID();await client.send(new CreateBucketCommand({Bucket:bucket}));
const media=createMediaStore({bucket,client}),dir=mkdtempSync(path.join(tmpdir(),'roam-storage-'));
const clear=()=>db.exec(`TRUNCATE ${tables.join(',')} RESTART IDENTITY`);
test.beforeEach(clear);test.after(async()=>{await db.close();client.destroy();rmSync(dir,{recursive:true,force:true});});
const post=(id,caption=id)=>({id,place:'Park',area:'City',title:'A walk',caption,category:'Outdoors',created:new Date().toISOString(),demo:false,lat:12,lng:77});

test('PostgreSQL preserves private ownership, transactional moderation, reactions, comments and restart recovery',async()=>{
 const owner=await store.issueDevice(),other=await store.issueDevice();await store.insert(post('one'),'edit',owner.deviceId);assert.equal((await store.publicPosts()).length,0);
 const results=await Promise.all([store.decide('post','one',1,'Published'),store.decide('post','one',1,'Blocked')]);assert.equal(results.filter(Boolean).length,1);
 await store.moderateManually('post','one','Published');
 await Promise.all(Array.from({length:5},()=>store.heart('one',owner.deviceId,true)));assert.equal((await store.publicPosts())[0].heartCount,1);
 const c=await store.addComment('one',other.deviceId,'A good walk','Walker');assert.equal((await store.comments('one',owner.deviceId)).comments.length,0);
 await store.decide('comment',c.id,1,'Published');assert.equal((await store.publicPosts())[0].commentCount,1);
 await store.moderateManually('comment',c.id,'Blocked');await store.recheck('comment',c.id);assert.equal(await store.decide('comment',c.id,1,'Published'),false);assert.equal(await store.decide('comment',c.id,2,'Published'),true);
 await store.update('one',{...post('one'),title:'Changed'});await store.decide('post','one',2,'Needs review');await store.recheck('post','one');assert.equal(await store.decide('post','one',2,'Published'),false);assert.equal((await store.publicPosts())[0].title,'A walk');
 const reopened=await createPostgres(connection);try{assert.equal(await createPostgresStore(reopened).device(owner.deviceKey),owner.deviceId);assert.equal((await createPostgresStore(reopened).ownPosts(owner.deviceId))[0].revision,3);}finally{await reopened.close();}
 await store.remove('one');assert.equal((await db.query('SELECT COUNT(*) n FROM hearts')).rows[0].n,0);assert.equal((await db.query('SELECT COUNT(*) n FROM comments')).rows[0].n,0);
});
test('private S3 media retains bytes, rejects invalid names, handles failed puts and supports removal',async()=>{
 const bytes=Buffer.from('private-test-image');await media.put('memory.webp',bytes);assert.deepEqual(await media.get('memory.webp'),bytes);
 const endpoint=process.env.ROAM_TEST_S3_ENDPOINT||'http://127.0.0.1:9005';assert.equal((await fetch(`${endpoint}/${bucket}/quarantine/memory.webp`)).status,403);
 await assert.rejects(()=>media.get('../memory.webp'));
 const broken=createMediaStore({bucket,client:{send:async()=>{throw new Error('interrupted');}}});await assert.rejects(()=>broken.put('interrupted.webp',bytes));
 const objects=await client.send(new ListObjectsV2Command({Bucket:bucket}));assert.equal(objects.Contents.some(x=>x.Key==='quarantine/interrupted.webp'),false);
 await media.remove('memory.webp');await assert.rejects(()=>media.get('memory.webp'));
});
test('SQLite migration preserves hashes, IDs, approved snapshots, media and usage, rejects a populated target',async()=>{
 const source=new DatabaseSync(path.join(dir,'roam.sqlite'));source.exec('CREATE TABLE posts(id TEXT PRIMARY KEY,body TEXT NOT NULL,owner TEXT,created TEXT NOT NULL);CREATE TABLE reports(id INTEGER PRIMARY KEY,post_id TEXT,reason TEXT,reporter TEXT,created TEXT);CREATE TABLE geoapify_usage(day TEXT PRIMARY KEY,units INTEGER NOT NULL)');
 const local=createSocialStore(source),owner=local.issueDevice();local.insert({...post('migrated'),media:'/uploads/migrated.webp',mediaType:'image'},'original-edit',owner.deviceId);local.decide('post','migrated',1,'Published');source.prepare('INSERT INTO geoapify_usage VALUES(?,?)').run('2026-10-12',24);source.close();
 await createMediaStore({dataDir:dir,bucket:null}).put('migrated.webp',Buffer.from('original-image'));
 const result=await migrateStorage({sourceDir:dir,db,targetMedia:media});assert.equal(result.media,1);assert.equal(await store.device(owner.deviceKey),owner.deviceId);assert.equal((await store.publicPosts())[0].id,'migrated');assert.equal(await store.adopt('migrated','original-edit',owner.deviceId),true);assert.equal((await db.query('SELECT units FROM geoapify_usage')).rows[0].units,24);assert.equal((await media.get('migrated.webp')).toString(),'original-image');
 await assert.rejects(()=>migrateStorage({sourceDir:dir,db,targetMedia:media}),/empty/);
});
test('PostgreSQL trends catch up once and remove blocked evidence immediately',async()=>{
 const owner=await store.issueDevice(),other=await store.issueDevice();const now=new Date('2026-10-12T10:00:00Z');
 for(const [id,day,who]of [['a','12',owner],['b','11',other],['c','10',owner]]){await store.insert({...post(id),created:`2026-10-${day}T09:00:00Z`},'edit',who.deviceId);await store.decide('post',id,1,'Published');}
 const trends=createPostgresTrending({db,store,gemma:async()=>({sourceIds:['invented'],topic:'Outdoors'})});assert.equal(await trends.refresh(now),true);assert.equal(await trends.refresh(now),false);assert.equal((await trends.read(now)).mode,'trending');
 await store.moderateManually('post','b','Blocked');assert.equal((await trends.read(now)).places.some(p=>p.sourceIds.includes('b')),false);
});

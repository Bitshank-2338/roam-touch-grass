import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPostgresStore as createSocialStore} from '../postgres-store.mjs';
import {createPostgres} from '../postgres.mjs';
import {randomUUID} from 'node:crypto';
const schemas=new Map();const open=async filename=>{const base=process.env.ROAM_TEST_DATABASE_URL;if(!base)throw new Error('Use the isolated PostgreSQL test URL.');const url=new URL(base);if(url.pathname!=='/roamtest'||!['localhost','127.0.0.1','roam-test-postgres'].includes(url.hostname))throw new Error('Only disposable local test databases are permitted.');let schema=filename===':memory:'?null:schemas.get(filename);if(!schema){schema='roam_test_'+randomUUID().replaceAll('-','');const root=await createPostgres(base);await root.exec('CREATE SCHEMA '+schema);await root.close();schemas.set(filename,schema);}url.searchParams.set('options','-c search_path='+schema);return createPostgres(url.toString());};
const memory=id=>({id,place:'Park',area:'City',title:'A walk',caption:'I walked in the park.',created:new Date().toISOString(),demo:false,lat:12,lng:77});
test('operator recheck invalidates stale decisions and preserves the approved version during edit review',async ()=>{
 const db=(await open(':memory:')),store=createSocialStore(db),owner=(await store.issueDevice());
 (await store.insert(memory('recheck'),'edit',owner.deviceId));(await store.decide('post','recheck',1,'Published'));
 (await assert.rejects(async ()=>(await store.recheck('post','recheck'))));
 (await store.update('recheck',{...memory('recheck'),title:'New title'}));(await store.decide('post','recheck',2,'Needs review'));
 (await store.recheck('post','recheck'));assert.equal((await store.ownPosts(owner.deviceId))[0].status,'Checking');
 assert.equal((await store.nextJob()).revision,3);assert.equal((await store.decide('post','recheck',2,'Published')),false);
 assert.equal((await store.publicPosts())[0].title,'A walk');(await store.decide('post','recheck',3,'Published'));
 assert.equal((await store.publicPosts())[0].title,'New title');(await assert.rejects(async ()=>(await store.recheck('invalid','recheck'))));(await db.close());
});
test('private browser identity and Checking submissions survive restart; per-post recovery adopts legacy ownership',async ()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'roam-store-')),filename=path.join(dir,'store.sqlite');let db=(await open(filename)),store=createSocialStore(db);const owner=(await store.issueDevice());(await store.insert(memory('draft'),'old-edit-key',owner.deviceId));assert.equal((await store.publicPosts()).length,0);(await db.close());
 db=(await open(filename));store=createSocialStore(db);assert.equal((await store.device(owner.deviceKey)),owner.deviceId);assert.equal((await store.ownPosts(owner.deviceId))[0].status,'Checking');assert.equal((await store.nextJob()).id,'draft');
 (await db.prepare('UPDATE posts SET browser_id=NULL WHERE id=?').run('draft'));assert.equal((await store.adopt('draft','wrong',owner.deviceId)),false);assert.equal((await store.adopt('draft','old-edit-key',owner.deviceId)),true);assert.equal((await store.ownPosts(owner.deviceId)).length,1);(await db.close());rmSync(dir,{recursive:true,force:true});
});
test('revision checks prevent stale approval; edited draft preserves old approved public snapshot until new approval',async ()=>{
 const db=(await open(':memory:')),store=createSocialStore(db),owner=(await store.issueDevice());(await store.insert({...memory('post'),summaryProvenance:'private',placeReference:{sources:[],proof:'private'}},'edit-key',owner.deviceId));assert.equal((await store.decide('post','post',1,'Published')),true);
 (await store.update('post',{...memory('post'),title:'Edited walk'}));assert.equal((await store.decide('post','post',1,'Published')),false);assert.equal((await store.publicPosts())[0].title,'A walk');assert.equal((await store.publicPosts())[0].summaryProvenance,undefined);assert.equal((await store.publicPosts())[0].placeReference.proof,undefined);assert.equal((await store.ownPosts(owner.deviceId))[0].title,'Edited walk');
 (await store.decide('post','post',2,'Needs review'));assert.equal((await store.publicPosts())[0].title,'A walk');(await store.moderateManually('post','post','Published'));assert.equal((await store.publicPosts())[0].title,'Edited walk');(await store.moderateManually('post','post','Blocked'));assert.equal((await store.publicPosts()).length,0);assert.equal((await store.ownPosts(owner.deviceId))[0].status,'Blocked');(await db.close());
});
test('hearts are unique per browser and comments stay private until approved; delete cascades interactions',async ()=>{
 const db=(await open(':memory:')),store=createSocialStore(db),owner=(await store.issueDevice()),other=(await store.issueDevice());(await store.insert(memory('post'),'edit-key',owner.deviceId));(await assert.rejects(async ()=>(await store.heart('post',other.deviceId,true))));(await store.decide('post','post',1,'Published'));
 (await store.heart('post',owner.deviceId,true));assert.equal((await store.heart('post',owner.deviceId,true)).heartCount,1);assert.equal((await store.heart('post',other.deviceId,true)).heartCount,2);assert.equal((await store.publicPosts(owner.deviceId))[0].liked,true);assert.equal((await store.heart('post',other.deviceId,false)).heartCount,1);
 const comment=(await store.addComment('post',other.deviceId,'A lovely place','Explorer'));assert.equal((await store.comments('post',owner.deviceId)).comments.length,0);assert.equal((await store.comments('post',other.deviceId)).mine[0].canDelete,true);(await store.decide('comment',comment.id,1,'Published'));assert.equal((await store.publicPosts())[0].commentCount,1);assert.equal((await store.comments('post',owner.deviceId)).comments[0].canDelete,false);(await store.remove('post'));assert.equal((await db.prepare('SELECT COUNT(*) n FROM hearts').get()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM comments').get()).n,0);(await db.close());
});

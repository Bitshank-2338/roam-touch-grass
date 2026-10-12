import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSocialStore} from '../social-store.mjs';
const open=filename=>{const db=new DatabaseSync(filename);db.exec('CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,body TEXT NOT NULL,owner TEXT,created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,post_id TEXT,reason TEXT,reporter TEXT,created TEXT)');return db;};
const memory=id=>({id,place:'Park',area:'City',title:'A walk',caption:'I walked in the park.',created:new Date().toISOString(),demo:false,lat:12,lng:77});
test('comment recheck cannot apply an earlier in-flight moderation result',()=>{
 const db=open(':memory:'),store=createSocialStore(db),owner=store.issueDevice();store.insert(memory('parent'),'edit',owner.deviceId);store.decide('post','parent',1,'Published');
 const c=store.addComment('parent',owner.deviceId,'A lovely walk','Walker');store.moderateManually('comment',c.id,'Blocked');store.recheck('comment',c.id);
 assert.equal(store.decide('comment',c.id,1,'Published'),false);assert.equal(store.comments('parent',owner.deviceId).comments.length,0);assert.equal(store.decide('comment',c.id,2,'Published'),true);db.close();
});
test('operator recheck invalidates stale decisions and preserves the approved version during edit review',()=>{
 const db=open(':memory:'),store=createSocialStore(db),owner=store.issueDevice();
 store.insert(memory('recheck'),'edit',owner.deviceId);store.decide('post','recheck',1,'Published');
 assert.throws(()=>store.recheck('post','recheck'));
 store.update('recheck',{...memory('recheck'),title:'New title'});store.decide('post','recheck',2,'Needs review');
 store.recheck('post','recheck');assert.equal(store.ownPosts(owner.deviceId)[0].status,'Checking');
 assert.equal(store.nextJob().revision,3);assert.equal(store.decide('post','recheck',2,'Published'),false);
 assert.equal(store.publicPosts()[0].title,'A walk');store.decide('post','recheck',3,'Published');
 assert.equal(store.publicPosts()[0].title,'New title');assert.throws(()=>store.recheck('invalid','recheck'));db.close();
});
test('private browser identity and Checking submissions survive restart; per-post recovery adopts legacy ownership',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'roam-store-')),filename=path.join(dir,'store.sqlite');let db=open(filename),store=createSocialStore(db);const owner=store.issueDevice();store.insert(memory('draft'),'old-edit-key',owner.deviceId);assert.equal(store.publicPosts().length,0);db.close();
 db=open(filename);store=createSocialStore(db);assert.equal(store.device(owner.deviceKey),owner.deviceId);assert.equal(store.ownPosts(owner.deviceId)[0].status,'Checking');assert.equal(store.nextJob().id,'draft');
 db.prepare('UPDATE posts SET browser_id=NULL WHERE id=?').run('draft');assert.equal(store.adopt('draft','wrong',owner.deviceId),false);assert.equal(store.adopt('draft','old-edit-key',owner.deviceId),true);assert.equal(store.ownPosts(owner.deviceId).length,1);db.close();rmSync(dir,{recursive:true,force:true});
});
test('revision checks prevent stale approval; edited draft preserves old approved public snapshot until new approval',()=>{
 const db=open(':memory:'),store=createSocialStore(db),owner=store.issueDevice();store.insert({...memory('post'),summaryProvenance:'private',placeReference:{sources:[],proof:'private'}},'edit-key',owner.deviceId);assert.equal(store.decide('post','post',1,'Published'),true);
 store.update('post',{...memory('post'),title:'Edited walk'});assert.equal(store.decide('post','post',1,'Published'),false);assert.equal(store.publicPosts()[0].title,'A walk');assert.equal(store.publicPosts()[0].summaryProvenance,undefined);assert.equal(store.publicPosts()[0].placeReference.proof,undefined);assert.equal(store.ownPosts(owner.deviceId)[0].title,'Edited walk');
 store.decide('post','post',2,'Needs review');assert.equal(store.publicPosts()[0].title,'A walk');store.moderateManually('post','post','Published');assert.equal(store.publicPosts()[0].title,'Edited walk');store.moderateManually('post','post','Blocked');assert.equal(store.publicPosts().length,0);assert.equal(store.ownPosts(owner.deviceId)[0].status,'Blocked');db.close();
});
test('hearts are unique per browser and comments stay private until approved; delete cascades interactions',()=>{
 const db=open(':memory:'),store=createSocialStore(db),owner=store.issueDevice(),other=store.issueDevice();store.insert(memory('post'),'edit-key',owner.deviceId);assert.throws(()=>store.heart('post',other.deviceId,true));store.decide('post','post',1,'Published');
 store.heart('post',owner.deviceId,true);assert.equal(store.heart('post',owner.deviceId,true).heartCount,1);assert.equal(store.heart('post',other.deviceId,true).heartCount,2);assert.equal(store.publicPosts(owner.deviceId)[0].liked,true);assert.equal(store.heart('post',other.deviceId,false).heartCount,1);
 const comment=store.addComment('post',other.deviceId,'A lovely place','Explorer');assert.equal(store.comments('post',owner.deviceId).comments.length,0);assert.equal(store.comments('post',other.deviceId).mine[0].canDelete,true);store.decide('comment',comment.id,1,'Published');assert.equal(store.publicPosts()[0].commentCount,1);assert.equal(store.comments('post',owner.deviceId).comments[0].canDelete,false);store.remove('post');assert.equal(db.prepare('SELECT COUNT(*) n FROM hearts').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM comments').get().n,0);db.close();
});

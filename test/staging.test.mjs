import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(path.join(tmpdir(),'roam-staging-'));
process.env.DATA_DIR=dir;process.env.PUBLIC_POSTING_ENABLED='0';process.env.SEED_DEMOS='0';
const {app,db,closeBackground}=await import('../server.mjs');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
test('staging serves the site but rejects contributions and identity creation before storage activation',async()=>{
 const unsafe=spawnSync(process.execPath,['server.mjs'],{encoding:'utf8',env:{...process.env,NODE_ENV:'production',PUBLIC_POSTING_ENABLED:'1',DATABASE_URL:'',S3_BUCKET:'',S3_ACCESS_KEY_ID:'',S3_SECRET_ACCESS_KEY:'',ROAM_MODERATOR_KEY:'',ROAM_PROVENANCE_KEY:''}});assert.notEqual(unsafe.status,0);assert.match(unsafe.stderr,/Production publishing requires durable/);
 assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/')).status,200);
 assert.equal((await(await fetch(base+'/api/config')).json()).features.publicPosting,false);
 for(const endpoint of ['/api/device','/api/posts','/api/posts/test/comments','/api/moderation/post/test'])assert.equal((await fetch(base+endpoint,{method:'POST'})).status,503);
 assert.deepEqual(await(await fetch(base+'/api/posts')).json(),[]);
});
test.after(async()=>{closeBackground();await new Promise(r=>server.close(r));await db.close();rmSync(dir,{recursive:true,force:true});});

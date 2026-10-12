import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {rankTrending,dueAt,createTrending} from '../trending.mjs';
const now=new Date('2026-10-11T10:00:00Z');
const post=(id,browser,created,caption=id)=>({id,browserId:browser,created,caption,place:'Test Park',area:'Test City',lat:12,lng:77,demo:false});
test('ranking counts one browser/place/day, deduplicates content, ignores demo/old rows and requires independent contributions',()=>{
 const rows=[post('a','browser1','2026-10-11T09:00:00Z'),post('b','browser1','2026-10-11T08:00:00Z'),post('c','browser2','2026-10-10T09:00:00Z'),post('d','browser1','2026-10-09T09:00:00Z'),post('e','browser3','2026-10-08T09:00:00Z','c'),{...post('demo','browser4','2026-10-11T09:00:00Z'),demo:true},post('old','browser4','2026-10-01T09:00:00Z')];
 const result=rankTrending(rows,now);assert.equal(result.mode,'trending');assert.deepEqual(result.places[0].sourceIds,['a','c','d']);assert.equal(rankTrending(rows.slice(0,3),now).mode,'recent');
});
test('06:00 IST boundary and startup catch-up snapshot are persisted once; invalidations remove stale evidence immediately',async()=>{
 assert.equal(dueAt(new Date('2026-10-11T00:29:00Z')),'2026-10-10T00:30:00.000Z');assert.equal(dueAt(new Date('2026-10-11T00:30:00Z')),'2026-10-11T00:30:00.000Z');
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE trend_snapshots(id INTEGER PRIMARY KEY,body TEXT,due_at TEXT,dirty INTEGER)');let rows=[post('a','one','2026-10-11T09:00:00Z'),post('b','two','2026-10-10T09:00:00Z'),post('c','one','2026-10-09T09:00:00Z')],calls=0;
 const trending=createTrending({db,store:{trendRows:()=>rows},gemma:async()=>{calls++;return{explanation:'Untrusted result',sourceIds:['invented']};}});assert.equal(await trending.refresh(now),true);assert.equal(calls,1);assert.equal(trending.read(now).places[0].explanation,'');assert.equal(await trending.refresh(now),false);
 rows=rows.slice(0,1);db.prepare('UPDATE trend_snapshots SET dirty=1').run();assert.deepEqual(trending.read(now).places[0].sourceIds,['a']);assert.equal(trending.read(now).mode,'recent');db.close();
});

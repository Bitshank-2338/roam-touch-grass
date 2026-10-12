import {DatabaseSync} from 'node:sqlite';
import {createPostgres} from '../postgres.mjs';
import {createMediaStore} from '../media-store.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const tables=['posts','reports','devices','hearts','comments','moderation_audit','trend_snapshots','geoapify_usage'];
export async function migrateStorage({sourceDir,db,targetMedia,dryRun=false}){
 const source=new DatabaseSync(path.join(sourceDir,'roam.sqlite'),{readOnly:true});
 try{
  const available=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
  const rows=Object.fromEntries(tables.map(t=>[t,available.has(t)?source.prepare(`SELECT * FROM ${t}`).all():[]]));
  const media=new Set();for(const r of rows.posts)for(const raw of [r.body,r.public_body])if(raw){const p=JSON.parse(raw);if(p.media?.startsWith('/uploads/'))media.add(path.basename(p.media));}
  const summary={tables:Object.fromEntries(tables.map(t=>[t,rows[t].length])),media:media.size};if(dryRun)return summary;
  if(!db||targetMedia?.kind!=='s3')throw new Error('Migration requires PostgreSQL and a private S3 destination.');
  const local=createMediaStore({dataDir:sourceDir,bucket:null});
  await db.transaction(async()=>{
   // Target is dedicated to this migration. Reject merging or overwriting existing data.
   for(const t of tables){await db.query(`LOCK TABLE ${t} IN ACCESS EXCLUSIVE MODE`);if(Number((await db.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n))throw new Error('Target database must be empty.');}
   // All photos must be available before any migrated post is committed.
   for(const name of media)await targetMedia.put(name,await local.get(name));
   for(const t of tables)for(const row of rows[t]){const cols=Object.keys(row);if(cols.some(c=>!/^\w+$/.test(c)))throw new Error('Invalid source column.');await db.query(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map((_,i)=>`$${i+1}`).join(',')})`,cols.map(c=>row[c]));}
   for(const t of ['reports','moderation_audit'])await db.query(`SELECT setval(pg_get_serial_sequence('${t}','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM ${t}`);
  });return summary;
 }finally{source.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const sourceDir=process.argv[2];if(!sourceDir)throw new Error('Pass the source data directory. Stop posting during final migration.');
 const dryRun=process.argv.includes('--dry-run'),db=dryRun?null:await createPostgres(process.env.DATABASE_URL);
 try{console.log(JSON.stringify(await migrateStorage({sourceDir,db,targetMedia:dryRun?null:createMediaStore({}),dryRun}),null,2));}finally{await db?.close();}
}

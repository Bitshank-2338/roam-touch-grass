import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync} from 'node:fs';

export function translateSql(sql){
 let index=0;
 // Only the application's fixed SQL is passed here; values remain bound parameters.
 let out=sql.replace(/\?/g,()=>`$${++index}`).replace(/INSERT OR IGNORE INTO/g,'INSERT INTO');
 if(sql.includes('INSERT OR IGNORE'))out+=' ON CONFLICT DO NOTHING';
 out=out.replace(/json_extract\((\w+),'\$\.(\w+)'\)/g,"($1::jsonb ->> '$2')");
 return out;
}
export async function createPostgres(connectionString){
 const url=new URL(connectionString),local=['localhost','127.0.0.1','::1'].includes(url.hostname)||(process.env.NODE_ENV==='test'&&url.hostname==='roam-test-postgres'&&url.pathname==='/roamtest');
 // Explicit TLS configuration must not be overridden by connection-string sslmode.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
 const ca=process.env.PGSSLROOTCERT?readFileSync(process.env.PGSSLROOTCERT,'utf8'):undefined;
 const pool=new pg.Pool({connectionString:url.toString(),max:5,connectionTimeoutMillis:10000,ssl:local?false:{rejectUnauthorized:true,...(ca?{ca}:{})}});
 const context=new AsyncLocalStorage();
 const query=async(sql,args=[])=>{const result=await(context.getStore()||pool).query(sql,args);if(result.rows)for(const row of result.rows)if(typeof row.n==='string')row.n=Number(row.n);return result;};
 const db={kind:'postgres',query,exec:sql=>query(sql),prepare:sql=>({
  get:async(...args)=>(await query(translateSql(sql),args)).rows[0],
  all:async(...args)=>(await query(translateSql(sql),args)).rows,
  run:async(...args)=>({changes:(await query(translateSql(sql),args)).rowCount})
 }),close:()=>pool.end(),transaction:async fn=>{
  if(context.getStore())return fn();const client=await pool.connect();
  try{await client.query('BEGIN');const value=await context.run(client,fn);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }};
 await db.exec(`CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,body TEXT NOT NULL,owner TEXT,created TEXT NOT NULL,public_body TEXT,status TEXT DEFAULT 'Needs review',browser_id TEXT,reason TEXT,updated TEXT,revision INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS reports(id BIGSERIAL PRIMARY KEY,post_id TEXT,reason TEXT,reporter TEXT,created TEXT,UNIQUE(post_id,reporter));
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,key_hash TEXT UNIQUE NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS hearts(post_id TEXT NOT NULL,device_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(post_id,device_id));
 CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,post_id TEXT NOT NULL,device_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,created TEXT NOT NULL,revision INTEGER DEFAULT 1);
 ALTER TABLE comments ADD COLUMN IF NOT EXISTS revision INTEGER DEFAULT 1;
 CREATE TABLE IF NOT EXISTS moderation_audit(id BIGSERIAL PRIMARY KEY,kind TEXT,item_id TEXT,decision TEXT,reason TEXT,created TEXT);
 CREATE TABLE IF NOT EXISTS trend_snapshots(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,due_at TEXT NOT NULL,dirty INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS geoapify_usage(day TEXT PRIMARY KEY,units INTEGER NOT NULL);`);
 return db;
}

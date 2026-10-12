import {randomBytes, randomUUID} from 'node:crypto';
import {hashToken, owns} from './core.mjs';

export const statuses=['Checking','Needs review','Blocked','Published'];
export function createPostgresStore(db){
  const decorate=async (row,privateView=false,deviceId=null)=>{
    const p=JSON.parse(privateView?row.body:row.public_body);
    const result={...p,status:privateView?row.status:'Published',heartCount:(await db.prepare('SELECT COUNT(*) n FROM hearts WHERE post_id=?').get(row.id)).n,commentCount:(await db.prepare("SELECT COUNT(*) n FROM comments WHERE post_id=? AND status='Published'").get(row.id)).n,liked:Boolean(deviceId&&(await db.prepare('SELECT 1 FROM hearts WHERE post_id=? AND device_id=?').get(row.id,deviceId)))};
    delete result.browserId;delete result.summaryProvenance;
    if(result.placeReference){result.placeReference={...result.placeReference};delete result.placeReference.proof;}
    if(privateView){result.reviewReason=row.reason||'';result.published=Boolean(row.public_body);result.revision=row.revision;result.provenanceToken=p.summaryProvenance||'';if(result.media?.startsWith('/uploads/'))result.privateMedia=`/api/private-media/${result.media.split('/').pop()}`;}
    return result;
  };
  async function issueDevice(){const key=randomBytes(32).toString('hex'),id=randomUUID();(await db.prepare('INSERT INTO devices VALUES(?,?,?)').run(id,hashToken(key),new Date().toISOString()));return{deviceKey:key,deviceId:id};}
  const device=async key=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)?(await db.prepare('SELECT id FROM devices WHERE key_hash=?').get(hashToken(key)))?.id||null:null;
  const row=async id=>(await db.prepare('SELECT * FROM posts WHERE id=? FOR UPDATE').get(id));
  const publicPosts=async deviceId=>(await Promise.all((await db.prepare('SELECT * FROM posts WHERE public_body IS NOT NULL ORDER BY created DESC').all()).map(async x=>(await decorate(x,false,deviceId)))));
  const ownPosts=async deviceId=>(await Promise.all((await db.prepare('SELECT * FROM posts WHERE browser_id=? ORDER BY created DESC').all(deviceId)).map(async x=>(await decorate(x,true,deviceId)))));
  async function adopt(id,token,deviceId){const p=(await row(id));if(!p||!owns(token,p.owner))return false;(await db.prepare('UPDATE posts SET browser_id=? WHERE id=?').run(deviceId,id));return true;}
  async function insert(p,owner,deviceId){(await db.prepare('INSERT INTO posts(id,body,owner,created,public_body,status,browser_id,reason,updated,revision) VALUES(?,?,?,?,NULL,?,?,NULL,?,1)').run(p.id,JSON.stringify(p),hashToken(owner),p.created,'Checking',deviceId,p.created));return (await decorate((await row(p.id)),true,deviceId));}
  async function update(id,p){(await db.prepare("UPDATE posts SET body=?,status='Checking',reason=NULL,updated=?,revision=revision+1 WHERE id=?").run(JSON.stringify(p),new Date().toISOString(),id));return (await row(id));}
  async function decide(kind,id,revision,status,reason=''){
    if(!statuses.includes(status)||status==='Checking')throw new Error('Invalid moderation decision.');
    const at=new Date().toISOString();
    if(kind==='post'){
      const p=(await row(id));if(!p||p.revision!==revision||p.status!=='Checking')return false;
      (await db.prepare('UPDATE posts SET status=?,reason=?,public_body=CASE WHEN ?=\'Published\' THEN body ELSE public_body END,updated=? WHERE id=? AND revision=?').run(status,reason,status,at,id,revision));
    }else{
      const c=(await db.prepare("SELECT id FROM comments WHERE id=? AND status='Checking' AND revision=? FOR UPDATE").get(id,revision));if(!c)return false;
      (await db.prepare('UPDATE comments SET status=?,reason=? WHERE id=?').run(status,reason,id));
    }
    (await db.prepare('INSERT INTO moderation_audit(kind,item_id,decision,reason,created) VALUES(?,?,?,?,?)').run(kind,id,status,reason,at));(await invalidate());return true;
  }
  async function moderateManually(kind,id,status,reason=''){
    if(!['Published','Blocked','Needs review'].includes(status))throw new Error('Choose Publish, Block or Needs review.');
    if(kind==='post'){
      const p=(await row(id));if(!p)throw new Error('Memory not found.');
      (await db.prepare('UPDATE posts SET status=?,reason=?,public_body=CASE WHEN ?=\'Published\' THEN body WHEN ?=\'Blocked\' THEN NULL ELSE public_body END,updated=? WHERE id=?').run(status,reason,status,status,new Date().toISOString(),id));
      if(status==='Published')(await db.prepare('DELETE FROM reports WHERE post_id=?').run(id));
    }else{
      const c=(await db.prepare('SELECT id FROM comments WHERE id=? FOR UPDATE').get(id));if(!c)throw new Error('Comment not found.');(await db.prepare('UPDATE comments SET status=?,reason=? WHERE id=?').run(status,reason,id));
    }
    (await db.prepare('INSERT INTO moderation_audit(kind,item_id,decision,reason,created) VALUES(?,?,?,?,?)').run(kind,id,status,reason,new Date().toISOString()));(await invalidate());
  }
  async function recheck(kind,id){
    const table=kind==='post'?'posts':kind==='comment'?'comments':null;if(!table)throw new Error('Unknown moderation item.');
    const item=(await db.prepare(`SELECT status FROM ${table} WHERE id=? FOR UPDATE`).get(id));if(!item)throw new Error('Submission not found.');if(!['Needs review','Blocked'].includes(item.status))throw new Error('Only submissions awaiting review or blocked can be checked again.');
    if(kind==='post')(await db.prepare("UPDATE posts SET status='Checking',reason=NULL,revision=revision+1,updated=? WHERE id=?").run(new Date().toISOString(),id));else (await db.prepare("UPDATE comments SET status='Checking',reason=NULL,revision=revision+1 WHERE id=?").run(id));
    (await db.prepare('INSERT INTO moderation_audit(kind,item_id,decision,reason,created) VALUES(?,?,?,?,?)').run(kind,id,'Checking','Operator requested a new policy check',new Date().toISOString()));(await invalidate());
  }
  async function invalidate(){(await db.prepare('UPDATE trend_snapshots SET dirty=1 WHERE id=1').run());}
  async function remove(id){const p=(await row(id));if(!p)return;try{for(const table of ['hearts','comments','reports'])(await db.prepare(`DELETE FROM ${table} WHERE post_id=?`).run(id));(await db.prepare('DELETE FROM posts WHERE id=?').run(id));(await invalidate());}catch(e){throw e;}return p;}
  async function heart(id,deviceId,liked){if(!(await row(id))?.public_body)throw new Error('This memory is not published.');if(liked)(await db.prepare('INSERT OR IGNORE INTO hearts VALUES(?,?,?)').run(id,deviceId,new Date().toISOString()));else (await db.prepare('DELETE FROM hearts WHERE post_id=? AND device_id=?').run(id,deviceId));return{liked,heartCount:(await db.prepare('SELECT COUNT(*) n FROM hearts WHERE post_id=?').get(id)).n};}
  async function addComment(postId,deviceId,text,alias){if(!(await row(postId))?.public_body)throw new Error('This memory is not published.');const c={id:randomUUID(),postId,text,alias:alias||'A fellow explorer',created:new Date().toISOString()};(await db.prepare('INSERT INTO comments(id,post_id,device_id,body,status,reason,created) VALUES(?,?,?,?,\'Checking\',NULL,?)').run(c.id,postId,deviceId,JSON.stringify(c),c.created));return{...c,status:'Checking',canDelete:true};}
  const commentView=(r,deviceId)=>({...JSON.parse(r.body),status:r.status,reviewReason:r.reason||'',canDelete:r.device_id===deviceId});
  const comments=async (id,deviceId)=>({comments:(await db.prepare("SELECT * FROM comments WHERE post_id=? AND status='Published' ORDER BY created").all(id)).map(r=>commentView(r,deviceId)),mine:deviceId?(await db.prepare("SELECT * FROM comments WHERE post_id=? AND device_id=? AND status!='Published' ORDER BY created").all(id,deviceId)).map(r=>commentView(r,deviceId)):[]});
  const nextJob=async ()=>{const p=(await db.prepare("SELECT * FROM posts WHERE status='Checking' ORDER BY updated LIMIT 1").get());if(p)return{kind:'post',id:p.id,revision:p.revision,body:JSON.parse(p.body)};const c=(await db.prepare("SELECT * FROM comments WHERE status='Checking' ORDER BY created LIMIT 1").get());return c?{kind:'comment',id:c.id,revision:c.revision,body:JSON.parse(c.body)}:null;};
  const queue=async ()=>({posts:(await Promise.all((await db.prepare("SELECT * FROM posts WHERE status!='Published' OR id IN(SELECT post_id FROM reports) ORDER BY updated").all()).map(async r=>({...(await decorate(r,true)),reports:(await db.prepare('SELECT reason,created FROM reports WHERE post_id=?').all(r.id))})))),comments:(await db.prepare("SELECT * FROM comments WHERE status!='Published' ORDER BY created").all()).map(r=>commentView(r,null))});
  const trendRows=async ()=>(await db.prepare('SELECT * FROM posts WHERE public_body IS NOT NULL AND browser_id IS NOT NULL AND id NOT IN(SELECT post_id FROM reports)').all()).map(r=>({...JSON.parse(r.public_body),browserId:r.browser_id}));
  const methods={issueDevice,device,row,publicPosts,ownPosts,adopt,insert,update,decide,moderateManually,recheck,invalidate,remove,heart,addComment,comments,nextJob,queue,trendRows,decorate};return Object.fromEntries(Object.entries(methods).map(([name,fn])=>[name,(...args)=>db.transaction(()=>fn(...args))]));
}

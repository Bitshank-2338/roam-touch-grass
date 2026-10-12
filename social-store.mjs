import {randomBytes, randomUUID} from 'node:crypto';
import {hashToken, owns} from './core.mjs';

export const statuses=['Checking','Needs review','Blocked','Published'];
export function createSocialStore(db){
  const columns=new Set(db.prepare('PRAGMA table_info(posts)').all().map(x=>x.name));
  for(const [name,type]of Object.entries({public_body:'TEXT',status:"TEXT DEFAULT 'Needs review'",browser_id:'TEXT',reason:'TEXT',updated:'TEXT',revision:'INTEGER DEFAULT 1'}))if(!columns.has(name))db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,key_hash TEXT UNIQUE NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hearts(post_id TEXT NOT NULL,device_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(post_id,device_id));
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,post_id TEXT NOT NULL,device_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,created TEXT NOT NULL,revision INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS moderation_audit(id INTEGER PRIMARY KEY,kind TEXT,item_id TEXT,decision TEXT,reason TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS trend_snapshots(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,due_at TEXT NOT NULL,dirty INTEGER DEFAULT 0);`);
  if(!db.prepare('PRAGMA table_info(comments)').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE comments ADD COLUMN revision INTEGER DEFAULT 1');
  // Existing fictional examples are curated fixtures. Real legacy uploads must be checked.
  for(const row of db.prepare('SELECT id,body FROM posts WHERE updated IS NULL').all()){
    const p=JSON.parse(row.body);db.prepare('UPDATE posts SET public_body=?,status=?,reason=?,updated=? WHERE id=?').run(p.demo?row.body:null,p.demo?'Published':'Needs review',p.demo?null:'This earlier upload needs a policy check.',new Date().toISOString(),row.id);
  }
  const decorate=(row,privateView=false,deviceId=null)=>{
    const p=JSON.parse(privateView?row.body:row.public_body);
    const result={...p,status:privateView?row.status:'Published',heartCount:db.prepare('SELECT COUNT(*) n FROM hearts WHERE post_id=?').get(row.id).n,commentCount:db.prepare("SELECT COUNT(*) n FROM comments WHERE post_id=? AND status='Published'").get(row.id).n,liked:Boolean(deviceId&&db.prepare('SELECT 1 FROM hearts WHERE post_id=? AND device_id=?').get(row.id,deviceId))};
    delete result.browserId;delete result.summaryProvenance;
    if(result.placeReference){result.placeReference={...result.placeReference};delete result.placeReference.proof;}
    if(privateView){result.reviewReason=row.reason||'';result.published=Boolean(row.public_body);result.revision=row.revision;result.provenanceToken=p.summaryProvenance||'';if(result.media?.startsWith('/uploads/'))result.privateMedia=`/api/private-media/${result.media.split('/').pop()}`;}
    return result;
  };
  function issueDevice(){const key=randomBytes(32).toString('hex'),id=randomUUID();db.prepare('INSERT INTO devices VALUES(?,?,?)').run(id,hashToken(key),new Date().toISOString());return{deviceKey:key,deviceId:id};}
  const device=key=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)?db.prepare('SELECT id FROM devices WHERE key_hash=?').get(hashToken(key))?.id||null:null;
  const row=id=>db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  const publicPosts=deviceId=>db.prepare('SELECT * FROM posts WHERE public_body IS NOT NULL ORDER BY created DESC').all().map(x=>decorate(x,false,deviceId));
  const ownPosts=deviceId=>db.prepare('SELECT * FROM posts WHERE browser_id=? ORDER BY created DESC').all(deviceId).map(x=>decorate(x,true,deviceId));
  function adopt(id,token,deviceId){const p=row(id);if(!p||!owns(token,p.owner))return false;db.prepare('UPDATE posts SET browser_id=? WHERE id=?').run(deviceId,id);return true;}
  function insert(p,owner,deviceId){db.prepare('INSERT INTO posts(id,body,owner,created,public_body,status,browser_id,reason,updated,revision) VALUES(?,?,?,?,NULL,?,?,NULL,?,1)').run(p.id,JSON.stringify(p),hashToken(owner),p.created,'Checking',deviceId,p.created);return decorate(row(p.id),true,deviceId);}
  function update(id,p){db.prepare("UPDATE posts SET body=?,status='Checking',reason=NULL,updated=?,revision=revision+1 WHERE id=?").run(JSON.stringify(p),new Date().toISOString(),id);return row(id);}
  function decide(kind,id,revision,status,reason=''){
    if(!statuses.includes(status)||status==='Checking')throw new Error('Invalid moderation decision.');
    const at=new Date().toISOString();
    if(kind==='post'){
      const p=row(id);if(!p||p.revision!==revision||p.status!=='Checking')return false;
      db.prepare('UPDATE posts SET status=?,reason=?,public_body=CASE WHEN ?=\'Published\' THEN body ELSE public_body END,updated=? WHERE id=? AND revision=?').run(status,reason,status,at,id,revision);
    }else{
      const c=db.prepare("SELECT id FROM comments WHERE id=? AND status='Checking' AND revision=?").get(id,revision);if(!c)return false;
      db.prepare('UPDATE comments SET status=?,reason=? WHERE id=?').run(status,reason,id);
    }
    db.prepare('INSERT INTO moderation_audit(kind,item_id,decision,reason,created) VALUES(?,?,?,?,?)').run(kind,id,status,reason,at);invalidate();return true;
  }
  function moderateManually(kind,id,status,reason=''){
    if(!['Published','Blocked','Needs review'].includes(status))throw new Error('Choose Publish, Block or Needs review.');
    if(kind==='post'){
      const p=row(id);if(!p)throw new Error('Memory not found.');
      db.prepare('UPDATE posts SET status=?,reason=?,public_body=CASE WHEN ?=\'Published\' THEN body WHEN ?=\'Blocked\' THEN NULL ELSE public_body END,updated=? WHERE id=?').run(status,reason,status,status,new Date().toISOString(),id);
      if(status==='Published')db.prepare('DELETE FROM reports WHERE post_id=?').run(id);
    }else{
      const c=db.prepare('SELECT id FROM comments WHERE id=?').get(id);if(!c)throw new Error('Comment not found.');db.prepare('UPDATE comments SET status=?,reason=? WHERE id=?').run(status,reason,id);
    }
    db.prepare('INSERT INTO moderation_audit(kind,item_id,decision,reason,created) VALUES(?,?,?,?,?)').run(kind,id,status,reason,new Date().toISOString());invalidate();
  }
  function recheck(kind,id){
    const table=kind==='post'?'posts':kind==='comment'?'comments':null;if(!table)throw new Error('Unknown moderation item.');
    const item=db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id);if(!item)throw new Error('Submission not found.');if(!['Needs review','Blocked'].includes(item.status))throw new Error('Only submissions awaiting review or blocked can be checked again.');
    if(kind==='post')db.prepare("UPDATE posts SET status='Checking',reason=NULL,revision=revision+1,updated=? WHERE id=?").run(new Date().toISOString(),id);else db.prepare("UPDATE comments SET status='Checking',reason=NULL,revision=revision+1 WHERE id=?").run(id);
    db.prepare('INSERT INTO moderation_audit(kind,item_id,decision,reason,created) VALUES(?,?,?,?,?)').run(kind,id,'Checking','Operator requested a new policy check',new Date().toISOString());invalidate();
  }
  function invalidate(){db.prepare('UPDATE trend_snapshots SET dirty=1 WHERE id=1').run();}
  function remove(id){const p=row(id);if(!p)return;db.exec('BEGIN');try{for(const table of ['hearts','comments','reports'])db.prepare(`DELETE FROM ${table} WHERE post_id=?`).run(id);db.prepare('DELETE FROM posts WHERE id=?').run(id);invalidate();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return p;}
  function heart(id,deviceId,liked){if(!row(id)?.public_body)throw new Error('This memory is not published.');if(liked)db.prepare('INSERT OR IGNORE INTO hearts VALUES(?,?,?)').run(id,deviceId,new Date().toISOString());else db.prepare('DELETE FROM hearts WHERE post_id=? AND device_id=?').run(id,deviceId);return{liked,heartCount:db.prepare('SELECT COUNT(*) n FROM hearts WHERE post_id=?').get(id).n};}
  function addComment(postId,deviceId,text,alias){if(!row(postId)?.public_body)throw new Error('This memory is not published.');const c={id:randomUUID(),postId,text,alias:alias||'A fellow explorer',created:new Date().toISOString()};db.prepare('INSERT INTO comments(id,post_id,device_id,body,status,reason,created) VALUES(?,?,?,?,\'Checking\',NULL,?)').run(c.id,postId,deviceId,JSON.stringify(c),c.created);return{...c,status:'Checking',canDelete:true};}
  const commentView=(r,deviceId)=>({...JSON.parse(r.body),status:r.status,reviewReason:r.reason||'',canDelete:r.device_id===deviceId});
  const comments=(id,deviceId)=>({comments:db.prepare("SELECT * FROM comments WHERE post_id=? AND status='Published' ORDER BY created").all(id).map(r=>commentView(r,deviceId)),mine:deviceId?db.prepare("SELECT * FROM comments WHERE post_id=? AND device_id=? AND status!='Published' ORDER BY created").all(id,deviceId).map(r=>commentView(r,deviceId)):[]});
  const nextJob=()=>{const p=db.prepare("SELECT * FROM posts WHERE status='Checking' ORDER BY updated LIMIT 1").get();if(p)return{kind:'post',id:p.id,revision:p.revision,body:JSON.parse(p.body)};const c=db.prepare("SELECT * FROM comments WHERE status='Checking' ORDER BY created LIMIT 1").get();return c?{kind:'comment',id:c.id,revision:c.revision,body:JSON.parse(c.body)}:null;};
  const queue=()=>({posts:db.prepare("SELECT * FROM posts WHERE status!='Published' OR id IN(SELECT post_id FROM reports) ORDER BY updated").all().map(r=>({...decorate(r,true),reports:db.prepare('SELECT reason,created FROM reports WHERE post_id=?').all(r.id)})),comments:db.prepare("SELECT * FROM comments WHERE status!='Published' ORDER BY created").all().map(r=>commentView(r,null))});
  const trendRows=()=>db.prepare('SELECT * FROM posts WHERE public_body IS NOT NULL AND browser_id IS NOT NULL AND id NOT IN(SELECT post_id FROM reports)').all().map(r=>({...JSON.parse(r.public_body),browserId:r.browser_id}));
  return{issueDevice,device,row,publicPosts,ownPosts,adopt,insert,update,decide,moderateManually,recheck,invalidate,remove,heart,addComment,comments,nextJob,queue,trendRows,decorate};
}

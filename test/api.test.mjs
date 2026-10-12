import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
const dir=mkdtempSync(path.join(tmpdir(),'roam-test-'));process.env.DATA_DIR=dir;process.env.SEED_DEMOS='0';process.env.ROAM_MODERATOR_KEY='test-moderator';process.env.GEOAPIFY_API_KEY='test-geographic-private-key';
const {app,db,closeBackground}=await import('../server.mjs');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
test('anonymous media post persists, rejects foreign edits, strips metadata, and deletes with ownership',async()=>{
 const form=new FormData();const fields={place:'Integration Test Park',title:'Testing a memory',caption:'A test-only observation.',category:'Outdoors',lat:'12',lng:'77',duration:'60',date:'2026-10-09'};for(const[k,v]of Object.entries(fields))form.set(k,v);
 const photo=await sharp({create:{width:20,height:20,channels:3,background:'#214c3d'}}).jpeg().withMetadata().toBuffer();form.set('media',new Blob([photo],{type:'image/jpeg'}),'test.jpg');
 const missingLocation=await fetch(base+'/api/posts',{method:'POST',body:form});assert.equal(missingLocation.status,403);
 const invalidLocation=await fetch(base+'/api/posting-location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:999,lng:77})});assert.equal(invalidLocation.status,400);
 const location=await(await fetch(base+'/api/posting-location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:12,lng:77})})).json();
 const device=await(await fetch(base+'/api/device',{method:'POST'})).json();const privateHeaders={'X-Roam-Device':device.deviceKey};
 const create=await fetch(base+'/api/posts',{method:'POST',headers:{'X-Roam-Location':location.receipt,...privateHeaders},body:form});assert.equal(create.status,202);const {post,editToken}=await create.json();assert.ok(editToken);assert.ok(post.media.endsWith('.webp'));assert.equal(post.status,'Checking');assert.equal((await fetch(base+post.media)).status,404);
 const privateImage=await fetch(base+post.privateMedia,{headers:privateHeaders});assert.equal(privateImage.status,200);
 const approved=await fetch(base+'/api/moderation/post/'+post.id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-moderator'},body:JSON.stringify({status:'Published'})});assert.equal(approved.status,200);
 const reusedLocation=await fetch(base+'/api/posts',{method:'POST',headers:{'X-Roam-Location':location.receipt},body:form});assert.equal(reusedLocation.status,403);
 const publicRows=await(await fetch(base+'/api/posts')).json();assert.equal(publicRows.length,1);assert.equal(publicRows[0].editToken,undefined);
 const image=Buffer.from(await(await fetch(base+post.media)).arrayBuffer());const metadata=await sharp(image).metadata();assert.equal(metadata.exif,undefined);
 const denied=await fetch(base+'/api/posts/'+post.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer wrong'},body:JSON.stringify({title:'Stolen edit'})});assert.equal(denied.status,403);
 const changed=await fetch(base+'/api/posts/'+post.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+editToken},body:JSON.stringify({title:'Updated test'})});assert.equal(changed.status,202);assert.equal((await changed.json()).title,'Updated test');assert.equal((await(await fetch(base+'/api/posts')).json())[0].title,'Testing a memory');
 const crossOrigin=await fetch(base+'/api/posts/'+post.id,{method:'DELETE',headers:{Origin:'https://untrusted.example',Authorization:'Bearer '+editToken}});assert.equal(crossOrigin.status,403);
 const deleted=await fetch(base+'/api/posts/'+post.id,{method:'DELETE',headers:{Authorization:'Bearer '+editToken}});assert.equal(deleted.status,200);assert.equal((await(await fetch(base+'/api/posts')).json()).length,0);assert.equal((await fetch(base+post.media)).status,404);
});
test('private identity is required; moderation queue is protected; comments and real hearts require a published memory',async()=>{
 const owner=await(await fetch(base+'/api/device',{method:'POST'})).json(),other=await(await fetch(base+'/api/device',{method:'POST'})).json();const headers={'Content-Type':'application/json','X-Roam-Device':owner.deviceKey};
 assert.equal((await fetch(base+'/api/my-posts')).status,401);assert.equal((await fetch(base+'/api/moderation')).status,403);assert.equal((await fetch(base+'/api/device',{headers:{'X-Roam-Device':owner.deviceKey}})).status,200);
 const location=await(await fetch(base+'/api/posting-location',{method:'POST',headers,body:JSON.stringify({lat:12,lng:77})})).json();const fields={place:'Community Park',title:'An afternoon walk',caption:'I walked along the path.',category:'Outdoors',lat:'12',lng:'77',duration:'60',date:'2026-10-09'};const form=new FormData();for(const [k,v]of Object.entries(fields))form.set(k,v);
 const create=await fetch(base+'/api/posts',{method:'POST',headers:{'X-Roam-Device':owner.deviceKey,'X-Roam-Location':location.receipt},body:form});assert.equal(create.status,202);const {post}=await create.json();
 assert.equal((await fetch(base+`/api/posts/${post.id}/heart`,{method:'PUT',headers,body:JSON.stringify({liked:true})})).status,400);
 const modHeaders={'Content-Type':'application/json',Authorization:'Bearer test-moderator'};await fetch(base+`/api/moderation/post/${post.id}`,{method:'POST',headers:modHeaders,body:JSON.stringify({status:'Published'})});
 for(let i=0;i<2;i++){const heart=await(await fetch(base+`/api/posts/${post.id}/heart`,{method:'PUT',headers,body:JSON.stringify({liked:true})})).json();assert.equal(heart.heartCount,1);}
 const response=await fetch(base+`/api/posts/${post.id}/comments`,{method:'POST',headers,body:JSON.stringify({text:'Thanks for sharing',alias:'Walker'})});assert.equal(response.status,202);const {comment}=await response.json();assert.equal((await(await fetch(base+`/api/posts/${post.id}/comments`)).json()).comments.length,0);
 await fetch(base+`/api/moderation/comment/${comment.id}`,{method:'POST',headers:modHeaders,body:JSON.stringify({status:'Published'})});assert.equal((await(await fetch(base+`/api/posts/${post.id}/comments`)).json()).comments[0].text,'Thanks for sharing');
 assert.equal((await fetch(base+`/api/comments/${comment.id}`,{method:'DELETE',headers:{'X-Roam-Device':other.deviceKey}})).status,403);assert.equal((await fetch(base+`/api/comments/${comment.id}`,{method:'DELETE',headers})).status,200);
 const videoForm=new FormData();for(const[k,v]of Object.entries(fields))videoForm.set(k,v);videoForm.set('media',new Blob(['video'],{type:'video/mp4'}),'video.mp4');const receipt=await(await fetch(base+'/api/posting-location',{method:'POST',headers,body:JSON.stringify({lat:12,lng:77})})).json();const video=await fetch(base+'/api/posts',{method:'POST',headers:{'X-Roam-Location':receipt.receipt,'X-Roam-Device':owner.deviceKey},body:videoForm});assert.equal(video.status,400);assert.match((await video.json()).error,/video uploads are paused/);
 await fetch(base+`/api/moderation/post/${post.id}`,{method:'POST',headers:modHeaders,body:JSON.stringify({status:'Blocked'})});assert.equal((await(await fetch(base+'/api/posts')).json()).length,0);assert.equal((await(await fetch(base+'/api/my-posts',{headers})).json())[0].status,'Blocked');
});
test.after(()=>{closeBackground();server.close();db.close();rmSync(dir,{recursive:true,force:true});});

test('geographic configuration keeps the shared key private and route proxy rejects unknown evidence',async()=>{
 const config=await(await fetch(base+'/api/config')).json();assert.equal(config.maps.provider,'geoapify');assert.equal(config.maps.apiKey,undefined);assert.equal(JSON.stringify(config).includes('test-geographic-private-key'),false);
 assert.equal((await fetch(base+'/api/maps/tiles/0/1/0.png')).status,400);
 const r=await fetch(base+'/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postIds:['missing-one','missing-two']})});assert.equal(r.status,400);
});

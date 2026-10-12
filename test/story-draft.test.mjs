import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
let modelInput,photoInput,modelAuthorization;
const sourceFacts=['Test Park is a public park with walking paths.','The park features a lake surrounded by gardens.','The grounds contain mature trees along shaded paths.','An established botanical collection grows within the park.'];
const realFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>String(url).startsWith('https://en.wikipedia.org/w/api.php')?Promise.resolve(new Response(JSON.stringify({query:{pages:{1:{pageid:1,title:'Test Park',extract:sourceFacts.join(' '),fullurl:'https://en.wikipedia.org/wiki/Test_Park',index:1}}}}),{headers:{'Content-Type':'application/json'}})):realFetch(url,options);
const fakeModel=createServer(async(req,res)=>{modelAuthorization=req.headers.authorization;let body='';for await(const chunk of req)body+=chunk;modelInput=JSON.parse(body);if(modelInput.messages[1].images)photoInput=modelInput;
 const result=modelInput.format.properties.experience?{experience:'memory-1',context1:'fact-1',context2:'fact-2',context3:'fact-3',context4:'fact-4'}:{place:'Test Park',area:'',title:'A quiet walk',caption:'I walked in Test Park with a friend.',tip:'',cost:'',date:'2026-10-01',category:'Outdoors',duration:2};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:JSON.stringify(result)}}));});
fakeModel.listen(0,'127.0.0.1');await new Promise(r=>fakeModel.once('listening',r));
const dir=mkdtempSync(path.join(tmpdir(),'roam-draft-'));process.env.OLLAMA_SERVICE_KEY='local-test-ai-token';process.env.DATA_DIR=dir;process.env.SEED_DEMOS='0';process.env.ROAM_MODERATOR_KEY='test-moderator-secret';process.env.OLLAMA_URL=`http://127.0.0.1:${fakeModel.address().port}`;
const {app,db,closeBackground}=await import('../server.mjs');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const device=await(await fetch(base+'/api/device',{method:'POST'})).json();
async function submit(fields){const form=new FormData();for(const[key,value]of Object.entries(fields))form.set(key,value);const location=await(await fetch(base+'/api/posting-location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:12,lng:77})})).json();return fetch(base+'/api/posts',{method:'POST',headers:{'X-Roam-Location':location.receipt,'X-Roam-Device':device.deviceKey},body:form});}
test('draft photo is resized and stripped; invented date and invalid duration remain blank, no post published',async()=>{
 const photo=await sharp({create:{width:1000,height:900,channels:3,background:'#416b48'}}).jpeg().withMetadata().toBuffer();
 const form=new FormData();form.set('transcript','I walked in Test Park with a friend. It was quiet.');form.set('media',new Blob([photo],{type:'image/jpeg'}),'test.jpg');
 const response=await fetch(base+'/api/story-draft',{method:'POST',body:form});assert.equal(response.status,200);const result=await response.json();assert.equal(result.reviewRequired,true);assert.equal(result.mediaAnalysed,'photo');assert.equal(result.draft.date,'');assert.equal(result.draft.duration,null);
 assert.equal(result.lines.length,6);assert.equal(result.draft.caption.split('\n').length,6);assert.equal(result.reference.status,'reference_found');
 assert.equal(result.lines[0].text,'I walked in Test Park with a friend. It was quiet.');assert.deepEqual(result.lines.filter(line=>line.kind==='context').map(line=>line.text),sourceFacts);assert.ok(result.provenanceToken);
 const metadata=await sharp(Buffer.from(photoInput.messages[1].images[0],'base64')).metadata();assert.ok(metadata.width<=768&&metadata.height<=768);assert.equal(metadata.exif,undefined);
 assert.equal((await(await fetch(base+'/api/posts')).json()).length,0);
});
test('short transcript rejected before model generation',async()=>{const form=new FormData();form.set('transcript','hi');const response=await fetch(base+'/api/story-draft',{method:'POST',body:form});assert.equal(response.status,400);});
test('pending story preserves signed attribution and approval exposes only checked source metadata',async()=>{
 const expanded=await(await fetch(base+'/api/caption',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:'I enjoyed a quiet walk.',place:'Test Park',area:''})})).json();
 const fields={place:'Test Park',area:'',title:'A quiet walk',caption:expanded.caption,referenceProof:expanded.reference.proof,category:'Outdoors',lat:'12',lng:'77',duration:'30',date:new Date().toLocaleDateString('en-CA')};
 const response=await submit(fields);assert.equal(response.status,202);const{post,editToken}=await response.json();assert.equal(post.placeReference.sources[0].url,'https://en.wikipedia.org/wiki/Test_Park');assert.equal(post.placeReference.sources[0].excerpt,undefined);
 assert.equal((await(await fetch(base+'/api/posts')).json()).length,0);
 const mine=await(await fetch(base+'/api/my-posts',{headers:{'X-Roam-Device':device.deviceKey}})).json();assert.equal(mine[0].provenanceToken,expanded.provenanceToken);
 const approve=await fetch(base+'/api/moderation/post/'+post.id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-moderator-secret'},body:JSON.stringify({status:'Published'})});assert.equal(approve.status,200);
 const rows=await(await fetch(base+'/api/posts')).json();assert.equal(rows[0].placeReference.sources[0].publisher,'Wikipedia');assert.equal(rows[0].placeReference.proof,undefined);assert.equal(rows[0].provenanceToken,undefined);
 const edit=await fetch(base+'/api/posts/'+post.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+editToken},body:JSON.stringify({caption:expanded.caption.replace(sourceFacts[0],'Test Park opens at six every morning.')})});assert.equal(edit.status,202);assert.equal((await edit.json()).placeReference,null);
});
test('a forged client reference does not receive attribution even with a warm reference cache',async()=>{
 const response=await submit({place:'Test Park',area:'',title:'A quiet walk',caption:'I enjoyed a walk.\nPlace context: The park opens at 6 AM.',category:'Outdoors',lat:'12',lng:'77',duration:'30',date:new Date().toLocaleDateString('en-CA'),placeReference:JSON.stringify({sources:[{url:'https://evil.example/fake'}]})});
 assert.equal(response.status,202);assert.equal((await response.json()).post.placeReference,null);
});
test.after(()=>{closeBackground();server.close();fakeModel.close();db.close();rmSync(dir,{recursive:true,force:true});globalThis.fetch=realFetch;});

test('private AI calls include the server-only service credential',()=>{assert.equal(modelAuthorization,'Bearer local-test-ai-token');});

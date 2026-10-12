import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIGateway} from '../ops/ai-gateway.mjs';
test('AI gateway requires a private key, restricts routes/models and fails closed on malformed upstream responses',async()=>{
 let failure=false,received;const key='local-test-only-private-gateway-key';
 const app=createAIGateway({key,shieldKey:'internal-test-key',fetcher:async(url,options)=>{received={url,options};if(failure==='timeout')throw new DOMException('Timed out','TimeoutError');if(failure==='http')return new Response('Unavailable',{status:503});return new Response(failure?'not json':JSON.stringify({ready:true}),{headers:{'Content-Type':'application/json'}});}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 try{
  assert.equal((await fetch(base+'/health')).status,403);assert.equal((await fetch(base+'/api/create',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({model:'other',stream:false})})).status,400);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({model:'gemma3:4b',stream:false,messages:[]})})).status,200);
  assert.equal(received.url,'http://127.0.0.1:11434/api/chat');assert.equal(received.options.headers.Authorization,undefined);
  assert.equal((await fetch(base+'/health',{headers})).status,200);assert.equal(received.options.headers.Authorization,'Bearer internal-test-key');
  failure=true;assert.equal((await fetch(base+'/health',{headers})).status,503);
  failure='timeout';assert.equal((await fetch(base+'/health',{headers})).status,503);failure='http';assert.equal((await fetch(base+'/health',{headers})).status,503);
 }finally{await new Promise(r=>server.close(r));}
});

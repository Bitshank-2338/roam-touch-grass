import test from 'node:test';
import assert from 'node:assert/strict';
import {createModeration,textPolicies,imagePolicies} from '../moderation.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const health={ready:true,policyVersion:'roam-v1',models:{text:'google/shieldgemma-2b',image:'google/shieldgemma-2-4b-it'}};
const scores=value=>Object.fromEntries(textPolicies.map(p=>[p,value]));
const fetcher=(classification,healthValue=health)=>async url=>new Response(JSON.stringify(url.endsWith('/health')?healthValue:classification),{headers:{'Content-Type':'application/json'}});
test('dedicated models and explicit validation gate are required for automatic publication',async()=>{
 const unconfigured=createModeration();assert.equal((await unconfigured.check({caption:'A pleasant walk'})).status,'Needs review');
 const unvalidated=createModeration({url:'http://test',validated:false,fetcher:fetcher({text:scores(0)})});assert.equal((await unvalidated.check({caption:'A walk'})).status,'Needs review');
 const wrongModel=createModeration({url:'http://test',validated:true,fetcher:fetcher({}, {...health,models:{text:'gemma3:4b',image:'gemma3:4b'}})});assert.equal((await wrongModel.readiness()).ready,false);
});
test('every image policy and complete text must be screened, with missing image scores remaining private',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'roam-policy-')),filename=path.join(dir,'test.webp');writeFileSync(filename,'fake test-only image');let input;
 const api=async(url,options)=>{if(url.endsWith('/health'))return new Response(JSON.stringify(health));input=JSON.parse(options.body);return new Response(JSON.stringify({policyVersion:'roam-v1',text:scores(0.01),image:Object.fromEntries(imagePolicies.map(k=>[k,0.01]))}));};
 const service=createModeration({url:'http://test',validated:true,fetcher:api,gemma:async()=>({needsReview:false,reason:''})});assert.equal((await service.check({title:'Whole title',caption:'Whole caption',tip:'Whole tip',alias:'Name'},filename)).status,'Published');assert.match(input.text,/Whole title/);assert.match(input.text,/Whole caption/);assert.match(input.text,/Whole tip/);assert.match(input.text,/Name/);assert.ok(input.image);assert.equal((await service.check({caption:'A normal photo'},Buffer.from('private S3 bytes'))).status,'Published');assert.equal(input.image,Buffer.from('private S3 bytes').toString('base64'));
 const missing=createModeration({url:'http://test',validated:true,fetcher:fetcher({policyVersion:'roam-v1',text:scores(0.01),image:{sexual:0.01}})});assert.equal((await missing.check({caption:'Whole story'},filename)).status,'Needs review');rmSync(dir,{recursive:true,force:true});
});
test('complete score contract, ambiguity and context assistance fail private',async()=>{
 const complete={policyVersion:'roam-v1',text:scores(0.02)};
 const configured=(result,gemma=async()=>({needsReview:false,reason:''}))=>createModeration({url:'http://test',validated:true,fetcher:fetcher(result),gemma});
 assert.equal((await configured(complete).check({caption:'We swam at the beach'})).status,'Published');
 assert.equal((await configured({...complete,text:scores(0.3)}).check({caption:'Ambiguous'})).status,'Needs review');
 assert.equal((await configured({...complete,text:scores(0.95)}).check({caption:'Flagged'})).status,'Blocked');
 assert.equal((await configured({...complete,text:{sexual:0}}).check({caption:'Missing scores'})).status,'Needs review');
 assert.equal((await configured(complete,async()=>({needsReview:true,reason:'Image context uncertain'})).check({caption:'Ambiguous'})).status,'Needs review');
 assert.equal((await configured(complete,async()=>{throw new Error('offline');}).check({caption:'A walk'})).status,'Needs review');
});

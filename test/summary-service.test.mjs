import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSummaryService } from '../summary-service.mjs';

const facts = [
  'Test Park is a public green space in Bengaluru.',
  'The park features shaded walking paths among its mature trees.',
  'The park contains a lake surrounded by established gardens.',
  'A public botanical collection is located within the park grounds.'
];
const fetcher = count => async () => ({ ok: true, json: async () => ({ query: { pages: { 1: { pageid: 1, title: 'Test Park', extract: facts.slice(0, count).join(' '), fullurl: 'https://en.wikipedia.org/wiki/Test_Park' } } } }) });
const choose = (system, input) => Promise.resolve({ experience: input.memoryCandidates[0].id, ...Object.fromEntries([1,2,3,4].map((n,index)=>[`context${n}`,input.factCandidates[index]?.id||null])) });
function setup(t, options = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'roam-summary-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, service: createSummaryService({ dataDir, gemma: choose, fetcher: fetcher(4), ...options }) };
}
test('short experience remains verbatim; selected source sentences alone add context', async t => {
  const { service } = setup(t);
  const notes = 'I walked with my friend.\nIt felt quiet, and we sat for a while.';
  const result = await service.expandStory(notes, 'Test Park', 'Bengaluru');
  assert.equal(result.lines.length, 7);
  assert.deepEqual(result.lines.filter(line=>line.kind==='memory').map(line=>line.text),notes.split('\n'));
  assert.deepEqual(result.lines.filter(line=>line.kind==='context').map(line=>line.text),facts);
  assert.ok(result.provenanceToken);
  assert.equal(result.reference.proof,result.provenanceToken);
});
test('zero and one source facts produce honest useful four-line summaries', async t => {
  for (const count of [0,1]) {
    const { service } = setup(t, { fetcher: fetcher(count) });
    const result = await service.expandStory('I went for a quiet walk.', 'Test Park', 'Bengaluru');
    assert.equal(result.lines.length,4);
    assert.equal(result.lines.filter(line=>line.kind==='context').length,count);
    assert.equal(result.lines[0].text,'I went for a quiet walk.');
    assert.equal(new Set(result.lines.map(line=>line.text)).size,result.lines.length);
  }
});
test('unavailable references use deterministic limitations and never model-authored facts', async t => {
  const { service } = setup(t, { fetcher: async()=>{throw new Error('offline');} });
  const result=await service.expandStory('I had a quiet afternoon walk.','Test Park','Bengaluru');
  assert.equal(result.reference.status,'unavailable');assert.equal(result.lines.length,4);assert.equal(result.provenanceToken,null);
  assert.ok(result.caption.includes('reference service was unavailable'));assert.equal(result.lines.filter(line=>line.kind==='context').length,0);
});
test('unknown IDs fail, duplicates are omitted and facts rejected by Gemma are never forced into the summary', async t => {
  const { service }=setup(t,{gemma:async()=>({experience:'memory-1',context1:'fact-1',context2:'fact-1',context3:null,context4:null})});
  const result=await service.expandStory('I enjoyed my afternoon walk.','Test Park','Bengaluru');
  assert.deepEqual(result.lines.filter(line=>line.kind==='context').map(line=>line.text),[facts[0]]);
  const { service:invalid }=setup(t,{gemma:async()=>({experience:'memory-1',context1:'fact-999',context2:null,context3:null,context4:null})});
  await assert.rejects(invalid.expandStory('I enjoyed my afternoon walk.','Test Park','Bengaluru'),/absent/);
});
test('attribution binds exact place, area and source context while allowing personal-story edits', async t => {
  const { service,dataDir }=setup(t);
  const result=await service.expandStory('I walked with a friend.','Test Park','Bengaluru');
  const input={place:'Test Park',area:'Bengaluru',caption:result.caption,provenanceToken:result.provenanceToken};
  const reference=service.verifiedReference(input);assert.equal(reference.sources[0].publisher,'Wikipedia');assert.equal(reference.sources[0].excerpt,undefined);assert.equal(reference.proof,undefined);
  assert.equal(service.verifiedReference({...input,place:'Another Park'}),null);
  assert.equal(service.verifiedReference({...input,area:'Delhi'}),null);
  assert.equal(service.verifiedReference({...input,caption:input.caption.replace(facts[0],'It opens at 6 AM.')}),null);
  assert.equal(service.verifiedReference({...input,caption:input.caption+'\n place context: The park opens at 6 AM.'}),null);
  assert.deepEqual(service.verifiedReference({...input,caption:input.caption.replace('I walked with a friend.','I enjoyed a short walk.')}),reference);
  const resumed=createSummaryService({dataDir,gemma:choose,fetcher:async()=>{throw new Error('must not need cache');}});
  assert.deepEqual(resumed.verifiedReference(input),reference);
  const [payload,signature]=input.provenanceToken.split('.');
  const changed=Buffer.from(signature,'base64url');changed[0]^=1;
  assert.equal(resumed.verifiedReference({...input,provenanceToken:payload+'.'+changed.toString('base64url')}),null);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias=signature.slice(0,-1)+alphabet[alphabet.indexOf(signature.at(-1))+1];
  assert.deepEqual(Buffer.from(alias,'base64url'),Buffer.from(signature,'base64url'));
  assert.equal(resumed.verifiedReference({...input,provenanceToken:payload+'.'+alias}),null);
  assert.equal(resumed.verifiedReference({...input,provenanceToken:payload+'.'+signature+'='}),null);
});
test('long memories use Gemma-selected exact experience text instead of invented paraphrases',async t=>{
  const notes='I walked through Test Park and then rested for a while. '+ 'I noticed tree shade along the route. '.repeat(12);
  const {service}=setup(t);
  const result=await service.expandStory(notes,'Test Park','Bengaluru');
  assert.equal(result.lines[0].text,'I walked through Test Park and then rested for a while.');
  assert.ok(notes.includes(result.lines[0].text));
});

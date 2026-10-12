import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupPlaceReference,validateExpandedStory,referenceFacts} from '../place-context.mjs';
const fixture=(title,extract,url='https://en.wikipedia.org/wiki/Cubbon_Park')=>async()=>({ok:true,json:async()=>({query:{pages:{1:{pageid:1,title,extract,fullurl:url,index:1}}}})});
test('reference check requires both the place name and supplied city; rejects unrelated links and outage',async()=>{
 assert.equal((await lookupPlaceReference('Cubbon Park','Bangalore',fixture('Cubbon Park','Cubbon Park is in Bengaluru.'))).status,'reference_found');
 assert.equal((await lookupPlaceReference('Cubbon Park','Bengaluru',fixture('A different park','A park in Bengaluru.'))).status,'not_found');
 assert.equal((await lookupPlaceReference('Cubbon Park','Bengaluru',fixture('Cubbon Park Restaurant','A restaurant in Bengaluru.'))).status,'not_found');
 assert.equal((await lookupPlaceReference('Cubbon Park','Delhi',fixture('Cubbon Park','A park in Bengaluru.'))).status,'not_found');
 assert.equal((await lookupPlaceReference('Cubbon Park','',fixture('Cubbon Park','Park','https://evil.example/fake'))).status,'not_found');
 assert.equal((await lookupPlaceReference('Cubbon Park','',async()=>{throw new Error('offline');})).status,'unavailable');
 assert.equal((await lookupPlaceReference('a','',()=>{throw new Error('must not fetch');})).status,'needs_place');
});
test('a confirmed Wikipedia redirect may resolve a renamed park, but ambiguous pages remain unmatched',async()=>{
 const redirected=async()=>({ok:true,json:async()=>({query:{redirects:[{from:'Cubbon Park',to:'Sri Chamarajendra Park'}],pages:{1:{pageid:1,title:'Sri Chamarajendra Park',extract:'Sri Chamarajendra Park is a public park in Bengaluru.',fullurl:'https://en.wikipedia.org/wiki/Sri_Chamarajendra_Park'}}}})});
 assert.equal((await lookupPlaceReference('Cubbon Park','Bengaluru',redirected)).status,'reference_found');
 const ambiguous=async()=>({ok:true,json:async()=>({query:{pages:{1:{pageid:1,title:'Cubbon Park',extract:'A list of parks in Bengaluru.',fullurl:'https://en.wikipedia.org/wiki/Cubbon_Park',pageprops:{disambiguation:''}}}}})});
 assert.equal((await lookupPlaceReference('Cubbon Park','Bengaluru',ambiguous)).status,'not_found');
});
test('expanded summaries enforce 4–8 lines and source-backed context without invented visit dates',()=>{
 const reference={status:'reference_found',sources:[{id:'wiki-1',excerpt:'The park is described in a public reference. The park includes tree-lined walking paths.'}]};
 const lines=[{text:'I enjoyed a walk.',kind:'memory',sourceId:null},...referenceFacts(reference).map(fact=>({text:fact.text,kind:'context',sourceId:fact.sourceId})),{text:'Check current access.',kind:'guidance',sourceId:null}];
 assert.equal(validateExpandedStory({lines},reference,'I enjoyed a walk.').caption.split('\n').length,4);
 assert.throws(()=>validateExpandedStory({lines:lines.slice(0,3)},reference,''));
 assert.throws(()=>validateExpandedStory({lines:Array(9).fill(lines[0])},reference,''));
 assert.throws(()=>validateExpandedStory({lines}, {status:'unavailable',sources:[]},''));
 assert.throws(()=>validateExpandedStory({lines:[lines[0],{text:'The park opens at six every morning.',kind:'context',sourceId:'wiki-1'},...lines.slice(2)]},reference,'I enjoyed a walk.'),/absent/);
 assert.throws(()=>validateExpandedStory({lines:[{...lines[0],text:'I went yesterday.'},...lines.slice(1)]},reference,'I enjoyed a walk.'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechPlayer,speechChunks} from '../public/speech.js';
class Utterance{constructor(text){this.text=text;}}
test('device playback advances chunks and cancels stale callbacks when stopped',async()=>{
 const utterances=[],states=[];let cancels=0;
 const synth={getVoices:()=>[{lang:'en-US',localService:true,name:'Device voice'}],speak:u=>utterances.push(u),cancel:()=>cancels++};
 const player=createSpeechPlayer(synth,Utterance,state=>states.push(state));
 await player.play('First line.\nSecond line.');assert.equal(player.active,true);assert.equal(utterances[0].text,'First line.');assert.equal(utterances[0].voice.localService,true);
 utterances[0].onend();assert.equal(utterances[1].text,'Second line.');const callback=utterances[1].onend;player.stop();callback();assert.equal(player.active,false);assert.equal(utterances.length,2);assert.ok(cancels>=2);
 await player.play('Another summary.');utterances[2].onend();assert.equal(states.at(-1),'finished');assert.equal(player.active,false);
});
test('speech requires a local voice, supports missing API gracefully, and bounds long chunks',async()=>{
 const remote={getVoices:()=>[{lang:'en-US',localService:false}],cancel(){},speak(){throw new Error('must not transmit');}};
 await assert.rejects(createSpeechPlayer(remote,Utterance).play('A private summary.'),/on-device/);
 await assert.rejects(createSpeechPlayer(null,null).play('Summary'),/unavailable/);
 assert.ok(speechChunks('A long line. '.repeat(100)).every(chunk=>chunk.length<=280));
});
test('delayed device voices load before speaking; cancellation removes the wait and prevents stale playback',async()=>{
 const listeners=new Set(),utterances=[],states=[];let voices=[];
 const synth={getVoices:()=>voices,speak:u=>utterances.push(u),cancel(){},addEventListener:(type,callback)=>listeners.add(callback),removeEventListener:(type,callback)=>listeners.delete(callback)};
 const player=createSpeechPlayer(synth,Utterance,state=>states.push(state));
 const loading=player.play('A delayed voice.');assert.equal(player.active,true);assert.equal(states.at(-1),'loading');assert.equal(utterances.length,0);
 voices=[{lang:'en-IN',localService:true}];for(const callback of listeners)callback();assert.equal(await loading,true);assert.equal(utterances[0].text,'A delayed voice.');assert.equal(listeners.size,0);
 player.stop();voices=[];const abandoned=player.play('Never speak this.');assert.equal(listeners.size,1);player.stop();assert.equal(await abandoned,false);assert.equal(listeners.size,0);
 voices=[{lang:'en-IN',localService:true}];for(const callback of listeners)callback();assert.equal(utterances.length,1);
});
test('starting a newer summary cancels the previous voice-loading request',async()=>{
 const listeners=new Set(),spoken=[];let voices=[];
 const synth={getVoices:()=>voices,speak:u=>spoken.push(u),cancel(){},addEventListener:(type,callback)=>listeners.add(callback),removeEventListener:(type,callback)=>listeners.delete(callback)};
 const player=createSpeechPlayer(synth,Utterance);
 const old=player.play('Old summary.');const latest=player.play('New summary.');voices=[{lang:'en-US',localService:true}];for(const callback of listeners)callback();
 assert.equal(await old,false);assert.equal(await latest,true);assert.deepEqual(spoken.map(u=>u.text),['New summary.']);player.stop();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecovery} from '../public/story-tools.js';
test('recovery file restores private keys and saved examples; rejects malformed keys',()=>{
  const id='d14fdf7c-7cc8-4b52-a3c0-1d2c05b79fa4';
  const backup={version:1,device:id,tokens:{[id]:'a'.repeat(64)},saved:[id,'demo-park']};
  assert.equal(validateRecovery(JSON.parse(JSON.stringify(backup))).tokens[id],'a'.repeat(64));
  assert.throws(()=>validateRecovery({...backup,tokens:{[id]:'wrong'}}));
  assert.throws(()=>validateRecovery({...backup,tokens:JSON.parse('{"__proto__":"x"}')}));
  assert.throws(()=>validateRecovery({...backup,saved:['<script>']}));
  assert.throws(()=>validateRecovery({...backup,version:2}));
});

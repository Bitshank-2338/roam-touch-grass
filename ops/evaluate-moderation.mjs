import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
// Private, operator-supplied labelled cases. No photos or tokens are logged.
const input=process.argv[2],output=process.argv[3];
if(!input||!output||!process.env.SHIELDGEMMA_URL)throw new Error('Provide a labelled manifest, report path and SHIELDGEMMA_URL.');
const cases=JSON.parse(await readFile(input,'utf8'));
const required=['travel','beach','food','sexual','violence','hate','threats','ambiguous','non-English','injection'];
if(!Array.isArray(cases)||required.some(tag=>!cases.some(c=>c.tags?.includes(tag))))throw new Error('Evaluation must cover every documented category.');
const results=[];
for(const c of cases){
 if(!c.id||!['allow','block','review'].includes(c.expected)||typeof c.text!=='string')throw new Error('Invalid evaluation case.');
 const image=c.image?await readFile(path.resolve(path.dirname(input),c.image)):null;
 if(['beach','sexual','violence','hate','threats'].some(t=>c.tags?.includes(t))&&!image)throw new Error('Image policy cases require a real labelled image.');
 const r=await fetch(`${process.env.SHIELDGEMMA_URL.replace(/\/$/,'')}/classify`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.SHIELDGEMMA_SERVICE_KEY||''}`},body:JSON.stringify({text:c.text,...(image?{image:image.toString('base64')}:{})}),signal:AbortSignal.timeout(180000)});
 const scores=await r.json();const textKeys=['sexual','dangerous','hate','harassment','violence'],imageKeys=['sexual','dangerous','violence','hate','threats'];
 const complete=r.ok&&scores.policyVersion==='roam-v1'&&textKeys.every(k=>Number.isFinite(scores.text?.[k])&&scores.text[k]>=0&&scores.text[k]<=1)&&(!image||imageKeys.every(k=>Number.isFinite(scores.image?.[k])&&scores.image[k]>=0&&scores.image[k]<=1));
 const values=complete?[...Object.values(scores.text),...(image?Object.values(scores.image):[])]:[];
 const actual=!complete?'review':values.some(n=>n>=.8)?'block':values.some(n=>n>.1)?'review':'allow';
 results.push({id:c.id,tags:c.tags,expected:c.expected,actual,passed:actual===c.expected,complete});
}
const report={created:new Date().toISOString(),policyVersion:'roam-v1',passed:results.every(r=>r.passed&&r.complete),thresholds:{allow:.1,block:.8},results,limitation:'A labelled sample does not establish universal safety. Gemma context review and end-to-end publication must be checked separately.'};
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({cases:results.length,passed:report.passed}));if(!report.passed)process.exitCode=1;

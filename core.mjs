import {createHash, timingSafeEqual} from 'node:crypto';
export const categories=['Outdoors','Trails','Food','Workshops','Culture'];
export const hashToken=token=>createHash('sha256').update(token).digest('hex');
export function validateCaption(caption,draft){
  if(typeof caption!=='string'||!caption.trim())throw new Error('Gemma did not return a caption.');
  for(const phrase of ['yesterday','today','last night','this morning','this afternoon','last weekend'])if(new RegExp(`\\b${phrase}\\b`,'i').test(caption)&&!new RegExp(`\\b${phrase}\\b`,'i').test(draft))throw new Error('Gemma added a time that was not in your notes. Your original story is unchanged; please try again.');
  return caption.slice(0,2500);
}
export function owns(token,hash){if(typeof token!=='string'||!hash)return false;return timingSafeEqual(Buffer.from(hashToken(token)),Buffer.from(hash));}
export function validatePost(input){
  const text=(key,max,required=false)=>{const s=String(input[key]??'').trim();if(s.length>max||(required&&!s))throw new Error(`Please enter a valid ${key} (up to ${max} characters).`);return s;};
  const lat=Number(input.lat),lng=Number(input.lng),duration=Number(input.duration||60);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||input.lat==null||input.lng==null||input.lat===''||input.lng==='')throw new Error('Choose a location on the map.');
  if(!categories.includes(input.category))throw new Error('Choose an experience category.');
  if(!Number.isInteger(duration)||duration<10||duration>1440)throw new Error('Duration must be between 10 and 1440 minutes.');
  const date=text('date',10,true);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>new Date().toLocaleDateString('en-CA'))throw new Error('Use a valid visit date that is not in the future.');
  return {place:text('place',100,true),area:text('area',100),title:text('title',120,true),caption:text('caption',2500,true),tip:text('tip',500),cost:text('cost',80),alias:text('alias',40)||'A fellow explorer',category:input.category,lat,lng,duration,date};
}
export function distance(a,b){const rad=x=>x*Math.PI/180;const dl=rad(b.lat-a.lat),dn=rad(b.lng-a.lng);const k=Math.sin(dl/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dn/2)**2;return 6371*2*Math.atan2(Math.sqrt(k),Math.sqrt(1-k));}
export function validatePlan(raw,sources,budget){
  if(!raw||typeof raw.title!=='string'||typeof raw.summary!=='string'||!Array.isArray(raw.stops)||!raw.stops.length||raw.stops.length>4)throw new Error('Gemma returned an incomplete plan. Try again.');
  const ids=new Set(sources.map(s=>s.id));let total=0;
  const stops=raw.stops.map(s=>{if(!Array.isArray(s.sourceIds)||!s.sourceIds.length||s.sourceIds.some(id=>!ids.has(id))||typeof s.note!=='string')throw new Error('Gemma returned a plan without valid experience references.');const minutes=Number(s.minutes);if(!Number.isInteger(minutes)||minutes<10||minutes>budget)throw new Error('Gemma returned an invalid time estimate.');total+=minutes;return {sourceIds:[...new Set(s.sourceIds)],minutes,note:s.note.slice(0,900)};});
  if(total>budget)throw new Error('The plan exceeds your available time. Try again with fewer stops.');
  return {title:raw.title.slice(0,150),summary:raw.summary.slice(0,1200),stops,totalMinutes:total,packing:Array.isArray(raw.packing)?raw.packing.filter(x=>typeof x==='string').slice(0,6).map(x=>x.slice(0,180)):[]};
}

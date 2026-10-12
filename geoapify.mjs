import {distance} from './core.mjs';
import {normalizePlace} from './place-context.mjs';

const failure=(message,status=503)=>Object.assign(new Error(message),{status});
const clean=value=>String(value??'').slice(0,300);
const discoveryCategories={all:'leisure.park,catering.cafe,catering.restaurant,tourism.attraction,entertainment.museum,entertainment.culture',Outdoors:'leisure.park,tourism.attraction.viewpoint',Food:'catering.cafe,catering.restaurant',Culture:'tourism.attraction,entertainment.museum,entertainment.culture'};
export function describeDiscovery(feature,origin){
  const p=feature.properties||{},cats=Array.isArray(p.categories)?p.categories.filter(c=>typeof c==='string'):[];
  const name=clean(p.name).trim();
  if(!name||cats.some(c=>c==='highway'||c.startsWith('highway.'))||!cats.some(c=>/^(leisure\.park|catering\.(cafe|restaurant)|tourism\.attraction|entertainment\.(museum|culture))($|\.)/.test(c)))return null;
  let point;try{point=coordinates(p.lat??feature.geometry?.coordinates?.[1],p.lon??feature.geometry?.coordinates?.[0]);}catch{return null;}
  const type=cats.includes('entertainment.museum')?'Museum':cats.some(c=>c.startsWith('entertainment.culture'))?'Cultural venue':cats.includes('leisure.park')?'Park':cats.includes('catering.cafe')?'Café':cats.includes('catering.restaurant')?'Restaurant':cats.includes('tourism.attraction.viewpoint')?'Viewpoint':'Attraction';
  const area=clean(p.city||p.town||p.village||p.county),label=clean(p.formatted||p.address_line1);
  const distanceMeters=Math.round(distance(origin,point)*1000);
  const summary=[`${name} is listed as ${/^[aeiou]/i.test(type)?'an':'a'} ${type.toLowerCase()}${area?` in ${area}`:''} in Geoapify / OpenStreetMap.`, `It is approximately ${(distanceMeters/1000).toFixed(1)} km from this map’s centre in a straight line; walking distance may be longer.`,label?`Mapped address: ${label}.`:'No street address is supplied by the map source.', 'Opening hours, entry fees and current activities have not been verified.'];
  return{...point,id:clean(p.place_id),name,label,area,categories:cats.slice(0,10),type,distanceMeters,overview:summary[0],summary:summary.join(' '),sourceUrl:'https://www.openstreetmap.org/?mlat='+point.lat+'&mlon='+point.lng+'#map=18/'+point.lat+'/'+point.lng};
}
export function coordinates(lat,lng){
  if(lat==null||lng==null||lat===''||lng==='')throw failure('Choose a valid map location.',400);
  const p={lat:Number(lat),lng:Number(lng)};
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw failure('Choose a valid map location.',400);
  return p;
}
export async function fitWalkingPlan(geo,stops,budget){
  const chosen=[...stops];let route=null;
  try{while(chosen.length>1){route=await geo.route(chosen);const visitMinutes=chosen.reduce((n,p,i)=>n+(i===0?Math.min(p.duration,Math.max(15,budget-15)):p.duration),0);if(visitMinutes+route.minutes<=budget)return{stops:chosen,route,warning:''};chosen.pop();}return{stops:chosen,route:null,warning:''};}
  catch{return{stops:chosen,route:null,warning:'Walking estimates are unavailable. Travel time is not included.'};}
}
export function createGeoapify({db,key=process.env.GEOAPIFY_API_KEY||'',fetcher=fetch,now=Date.now,spacing=250,dailyCredits=2400}={}){
  if(db.kind!=='postgres')db.exec('CREATE TABLE IF NOT EXISTS geoapify_usage(day TEXT PRIMARY KEY,units INTEGER NOT NULL)');
  const cache=new Map(),pending=new Map();let lastStart=0,gate=Promise.resolve(),cacheBytes=0;
  const configured=Boolean(key.trim());
  async function reserve(units){const day=new Date(now()).toISOString().slice(0,10);const used=(await db.prepare('SELECT units FROM geoapify_usage WHERE day=?').get(day))?.units||0;if(used+units>dailyCredits*4)throw failure('Roam’s daily geographic request budget is reached. Try tomorrow.',429);if(db.kind==='postgres'){const r=await db.query('INSERT INTO geoapify_usage(day,units) VALUES($1,$2) ON CONFLICT(day) DO UPDATE SET units=geoapify_usage.units+excluded.units WHERE geoapify_usage.units+excluded.units <= $3 RETURNING units',[day,units,dailyCredits*4]);if(!r.rowCount)throw failure('Daily geographic request budget reached.',429);}else db.prepare('INSERT INTO geoapify_usage(day,units) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET units=units+excluded.units').run(day,units);}
  async function request(host,pathname,params,units=4,binary=false){
    if(!configured)throw failure('Geoapify is not configured.');
    const query=new URLSearchParams(params),id=`${host}${pathname}?${query}`;
    const old=cache.get(id);if(old&&old.until>now())return old.value;
    if(pending.has(id))return pending.get(id);
    if(pending.size>=100)throw failure('Map requests are busy. Try again shortly.',429);
    const work=(async()=>{
      const turn=gate.then(async()=>{const delay=Math.max(0,lastStart+spacing-now());if(delay)await new Promise(r=>setTimeout(r,delay));await reserve(units);lastStart=now();});gate=turn.catch(()=>{});await turn;
      query.set('apiKey',key.trim());let response;
      try{response=await fetcher(`https://${host}${pathname}?${query}`,{signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw failure('Geoapify could not connect. Try again shortly.');}
      if(!response.ok)throw failure([401,403].includes(response.status)?'Geoapify rejected the server key or its restrictions.':response.status===429?'Geoapify request limit reached. Try again shortly.':'Geoapify is temporarily unavailable.',response.status===429?429:503);
      if(Number(response.headers.get('content-length')||0)>1500000)throw failure('Geoapify returned an oversized response.');
      let value,bytes;
      try{const data=Buffer.from(await response.arrayBuffer());bytes=data.length;if(bytes>1500000)throw new Error();if(binary){if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error();value=data;}else value=JSON.parse(data.toString());}catch{throw failure('Geoapify returned an invalid response.');}
      if(old){cacheBytes-=old.bytes;cache.delete(id);}while(cache.size>=512||cacheBytes+bytes>32*1024*1024){const first=cache.keys().next().value;if(first===undefined)break;cacheBytes-=cache.get(first).bytes;cache.delete(first);}cache.set(id,{value,bytes,until:now()+(binary?3600000:300000)});cacheBytes+=bytes;return value;
    })();pending.set(id,work);try{return await work;}finally{pending.delete(id);}
  }
  function featureList(body){if(!Array.isArray(body?.features))throw failure('Geoapify returned incomplete place data.');return body.features;}
  function place(feature){const p=feature.properties||{},c=feature.geometry?.coordinates;try{const point=coordinates(p.lat??c?.[1],p.lon??c?.[0]);return {...point,id:clean(p.place_id),name:clean(p.name||p.address_line1||p.formatted),label:clean(p.formatted||p.address_line1),area:clean(p.city||p.town||p.village||p.county),categories:Array.isArray(p.categories)?p.categories.filter(x=>typeof x==='string').slice(0,10):[]};}catch{return null;}}
  return {
    configured,
    async details(selected){if(!selected?.id||!/^[a-zA-Z0-9_-]{1,300}$/.test(selected.id))throw failure('Choose a valid discovered place.',400);const body=await request('api.geoapify.com','/v2/place-details',{id:selected.id,features:'details',lang:'en'});const p=featureList(body).find(f=>f.properties?.place_id===selected.id||(f.properties?.feature_type==='details'&&normalizePlace(f.properties.name)===normalizePlace(selected.name)))?.properties;if(!p||distance(selected,coordinates(p.lat,p.lon))>0.5)throw failure('Place details did not match the selected map pin.');const raw=p.datasource?.raw||{};const text=v=>typeof v==='string'?v.slice(0,500):'';return{checkedAt:new Date(now()).toISOString(),website:text(p.website||p.contact?.website||raw.website),openingHours:text(p.opening_hours||raw.opening_hours),description:text(p.description||raw.description),cuisine:text(p.catering?.cuisine||raw.cuisine),reservation:text(p.catering?.reservation||raw.reservation),wheelchair:text(p.accessibility?.wheelchair||raw.wheelchair),facilities:Object.fromEntries(['toilets','wifi','takeaway','delivery','outdoor_seating'].filter(k=>typeof p.facilities?.[k]==='boolean').map(k=>[k,p.facilities[k]])),wikipedia:text(p.wiki_and_media?.wikipedia||raw.wikipedia),wikidata:text(p.wiki_and_media?.wikidata||raw.wikidata)};},
    async tile(z,x,y){if(!/^\d{1,8}$/.test(String(z))||!/^\d{1,8}$/.test(String(x))||!/^\d{1,8}$/.test(String(y))||Number(z)>20||Number(x)>=2**Number(z)||Number(y)>=2**Number(z))throw failure('Invalid map tile.',400);return request('maps.geoapify.com',`/v1/tile/positron/${Number(z)}/${Number(x)}/${Number(y)}.png`,{},1,true);},
    async search(query){const text=String(query??'').trim();if(text.length<3)return[];if(text.length>100)throw failure('Search for a shorter place name.',400);return featureList(await request('api.geoapify.com','/v1/geocode/search',{text,limit:'5',lang:'en'})).map(place).filter(Boolean);},
    async nearby(lat,lng,category='all'){const p=coordinates(lat,lng);if(!discoveryCategories[category])throw failure('Choose parks, food or attractions.',400);const seen=new Set();const groups=await Promise.all((category==='all'?['Outdoors','Culture','Food']:[category]).map(async kind=>featureList(await request('api.geoapify.com','/v2/places',{categories:discoveryCategories[kind],conditions:'named',filter:`circle:${p.lng},${p.lat},3000`,bias:`proximity:${p.lng},${p.lat}`,limit:'20',lang:'en'})).map(f=>describeDiscovery(f,p)).filter(Boolean)));const mixed=[];for(let i=0;i<20;i++)for(const group of groups)if(group[i])mixed.push(group[i]);return mixed.filter(place=>{if(!place)return false;const id=place.id||`${place.name.toLowerCase()}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;if(seen.has(id))return false;seen.add(id);return true;}).slice(0,10);},
    async route(points){if(!Array.isArray(points)||points.length<2||points.length>4)throw failure('Choose two to four plan stops.',400);const ps=points.map(p=>coordinates(p.lat,p.lng));if(ps.slice(1).some(p=>distance(ps[0],p)>50))throw failure('Choose stops within 50 km of the first place.',400);const body=await request('api.geoapify.com','/v1/routing',{waypoints:ps.map(p=>`${p.lat},${p.lng}`).join('|'),mode:'walk',units:'metric'},4*(ps.length-1));const f=featureList(body)[0],p=f?.properties,g=f?.geometry;
      const lines=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:null;
      if(!p||!Number.isFinite(p.time)||p.time<0||!Number.isFinite(p.distance)||p.distance<0||!lines?.length||lines.flat().length>20000||lines.some(line=>!Array.isArray(line)||line.length<2||line.some(c=>!Array.isArray(c)||c.length<2||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90)))throw failure('Geoapify returned an invalid walking route.');
      return{provider:'geoapify',mode:'walk',minutes:Math.ceil(p.time/60),distanceMeters:Math.round(p.distance),feature:{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:lines.map(line=>line.map(c=>c.slice(0,2)))}},attribution:'Powered by Geoapify · © OpenStreetMap contributors'};
    }
  };
}

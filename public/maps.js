const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const point=value=>({lat:typeof value.lat==='function'?value.lat():value.lat,lng:typeof value.lng==='function'?value.lng():value.lng});
let sdkPromise;
async function googleSDK(key){
  if(window.google?.maps?.Map)return window.google.maps;
  if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');const callback='roamGoogleMapsReady';
    const timer=setTimeout(()=>reject(new Error('Google Maps could not load.')),12000);
    window[callback]=()=>{clearTimeout(timer);resolve(window.google.maps);delete window[callback];};
    script.onerror=()=>{clearTimeout(timer);reject(new Error('Google Maps could not connect.'));};
    const params=new URLSearchParams({key,v:'weekly',loading:'async',callback,libraries:'marker'});script.src=`https://maps.googleapis.com/maps/api/js?${params}`;script.async=true;document.head.append(script);
  });
  return sdkPromise;
}
function pinHTML(post,selected){return `<div class="pin-photo">${post.mediaType==='image'&&post.media?`<img src="${escape(post.media)}" alt="">`:'<i class="ph ph-map-pin"></i>'}</div><span class="pin-label">${escape(post.place)}</span>`;}
export async function createMap(element,config={},onMemory=()=>{}){
  const center={lat:12.9707,lng:77.600};let markers=[],picker=null,pickListener=null,currentLocation=null,routeLayer=null,discoveryMarker=null;
  if(config.provider==='google'&&config.apiKey&&config.mapId){try{
    const gm=await googleSDK(config.apiKey);const {AdvancedMarkerElement}=await gm.importLibrary('marker');
    const map=new gm.Map(element,{center,zoom:13,mapId:config.mapId,disableDefaultUI:true,zoomControl:true,gestureHandling:'cooperative',clickableIcons:false});
    await new Promise((resolve,reject)=>{const previous=window.gm_authFailure;const timer=setTimeout(()=>finish(new Error('Google Maps did not render.')),12000);let listener;const finish=error=>{clearTimeout(timer);listener?.remove();window.gm_authFailure=previous;error?reject(error):resolve();};window.gm_authFailure=()=>{previous?.();finish(new Error('Google Maps credentials were rejected.'));};listener=map.addListener('tilesloaded',()=>finish());});
    const wrap={provider:'google',warning:null,getCenter:()=>point(map.getCenter()),getZoom:()=>map.getZoom(),getBounds:()=>({contains:p=>Boolean(map.getBounds()?.contains({lat:p[0],lng:p[1]}))}),invalidateSize(){gm.event.trigger(map,'resize');},flyTo:p=>map.panTo({lat:p[0],lng:p[1]}),focus(p){map.panTo({lat:p.lat,lng:p.lng});map.setZoom(Math.max(map.getZoom(),13));},setView(p,zoom){map.setCenter(Array.isArray(p)?{lat:p[0],lng:p[1]}:p);map.setZoom(zoom);},
      showMemories(list,selected){markers.forEach(marker=>marker.map=null);markers=list.map(post=>{const content=document.createElement('div');content.className=`memory-pin ${post.id===selected?'selected':''}`;content.innerHTML=pinHTML(post,post.id===selected);const marker=new AdvancedMarkerElement({map,position:{lat:post.lat,lng:post.lng},title:`${post.place}: ${post.title}`,content,gmpClickable:true,zIndex:post.id===selected?1000:undefined});marker.addListener('click',()=>onMemory(post.id));return marker;});},
      showLocation(p){if(currentLocation)currentLocation.map=null;const content=document.createElement('div');content.className='you-pin';currentLocation=new AdvancedMarkerElement({map,position:p,content,title:'Your current location'});},
      onPick(callback){if(pickListener)pickListener.remove();pickListener=map.addListener('click',event=>{if(event.latLng)callback(point(event.latLng));});},
      setPickerPin(p,callback){if(picker)picker.position=p;else{const content=document.createElement('div');content.className='picker-pin';content.innerHTML='<i class="ph ph-map-pin"></i>';picker=new AdvancedMarkerElement({map,position:p,content,gmpDraggable:true,title:'Drag the memory location'});picker.addListener('dragend',()=>callback(point(picker.position)));}}
    };return wrap;
  }catch{element.replaceChildren();}}
  const map=L.map(element,{zoomControl:false}).setView([center.lat,center.lng],13);L.control.zoom({position:'bottomright'}).addTo(map);
  const attribution='Powered by <a href="https://www.geoapify.com/">Geoapify</a> · © <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const isGeo=config.provider==='geoapify';
  const tileLayer=L.tileLayer(isGeo?config.tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:isGeo?20:19,attribution:isGeo?attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',className:isGeo?'':'roam-map-tiles'}).addTo(map);
  const wrap={provider:isGeo?'geoapify':'leaflet',warning:config.provider==='google'?'Google Maps unavailable — showing the fallback map.':null,
    onProviderChange:null,
    showPlace(p){discoveryMarker?.remove();discoveryMarker=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'picker-pin',html:'<i class="ph ph-compass"></i>',iconSize:[42,42],iconAnchor:[21,42]})}).addTo(map).bindTooltip(escape(p.name||p.label),{permanent:true,direction:'top',offset:[0,-35]});},
    showRoute(feature){routeLayer?.remove();routeLayer=null;if(feature){routeLayer=L.geoJSON(feature,{style:{color:'#14543d',weight:5,opacity:.85}}).addTo(map);map.fitBounds(routeLayer.getBounds(),{padding:[35,35]});}},
    getCenter:()=>point(map.getCenter()),getZoom:()=>map.getZoom(),getBounds:()=>map.getBounds(),invalidateSize:()=>map.invalidateSize(),flyTo:p=>map.flyTo(p,13,{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches}),focus:p=>map.flyTo([p.lat,p.lng],Math.max(map.getZoom(),13),{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches}),setView:(p,zoom)=>map.setView(Array.isArray(p)?p:[p.lat,p.lng],zoom),
    showMemories(list,selected){markers.forEach(marker=>marker.remove());markers=list.map(post=>{const marker=L.marker([post.lat,post.lng],{title:`${post.place}: ${post.title}`,alt:`Memory at ${post.place}`,icon:L.divIcon({className:`memory-pin ${post.id===selected?'selected':''}`,html:pinHTML(post,post.id===selected),iconSize:[58,58],iconAnchor:[29,58]}),zIndexOffset:post.id===selected?1000:0}).addTo(map);marker.on('click',()=>onMemory(post.id));return marker;});},
    showLocation(p){currentLocation?.remove();currentLocation=L.circleMarker([p.lat,p.lng],{radius:7,color:'#fff',weight:3,fillColor:'#063f2e',fillOpacity:1}).addTo(map).bindTooltip('You are here');},
    onPick(callback){map.off('click');map.on('click',event=>callback(point(event.latlng)));},
    setPickerPin(p,callback){if(picker)picker.setLatLng([p.lat,p.lng]);else{picker=L.marker([p.lat,p.lng],{draggable:true,icon:L.divIcon({className:'picker-pin',html:'<i class="ph ph-map-pin"></i>',iconSize:[42,42],iconAnchor:[21,42]})}).addTo(map);picker.on('dragend',()=>callback(point(picker.getLatLng())));}}
  };
  if(isGeo){let fallback=false;tileLayer.on('tileerror',()=>{if(fallback)return;fallback=true;map.removeLayer(tileLayer);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',className:'roam-map-tiles'}).addTo(map);wrap.provider='leaflet';wrap.warning='Geoapify unavailable — showing OpenStreetMap.';wrap.onProviderChange?.(wrap);});}
  return wrap;
}

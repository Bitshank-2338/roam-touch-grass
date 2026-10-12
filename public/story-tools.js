import {bindListen,stopSpeech} from './speech.js';
import {referenceHTML} from './references.js';
const $=selector=>document.querySelector(selector);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const draftFields=['place','area','title','caption','tip','cost','date','category','duration','alias','lat','lng'];
export function validateRecovery(value){
  if(!value||value.version!==1||!uuid.test(value.device)||!value.tokens||typeof value.tokens!=='object'||Array.isArray(value.tokens)||!Array.isArray(value.saved)||Object.keys(value.tokens).length>1000||value.saved.length>1000)throw new Error('Choose a valid Roam recovery file.');
  for(const [id,key]of Object.entries(value.tokens))if(!uuid.test(id)||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw new Error('This recovery file contains invalid editing keys.');
  if(value.saved.some(id=>typeof id!=='string'||!(uuid.test(id)||/^demo-[\w-]{1,60}$/.test(id))))throw new Error('This recovery file contains invalid saved places.');
  if(value.deviceKey!==undefined&&(typeof value.deviceKey!=='string'||!/^[a-f0-9]{64}$/.test(value.deviceKey)))throw new Error('This recovery file has an invalid private browser key.');
  return value;
}
export function initStoryTools({api,json,setPin,toast,stored,persist,getBackup,restoreBackup}){
  let device=stored('roam-device',null);if(!uuid.test(device)){device=crypto.randomUUID();persist('roam-device',device);}
  let receipt=null,expires=0,recognition=null,listening=false,editing=false,draftBusy=false,draftGeneration=0,currentReference=null;
  const form=$('#postForm');
  function saveDraft(){if(editing)return;const fields={};for(const key of draftFields)fields[key]=form.elements[key].value;persist('roam-story-draft',{fields,transcript:$('#storyTranscript').value,reference:currentReference});}
  const contexts=()=>$('#captionInput').value.split('\n').filter(line=>line.startsWith('Place context:')).map(line=>line.trim());
  function setReference(reference,persistDraft=true){currentReference=reference?{...reference,contextLines:reference.contextLines||contexts(),sources:(reference.sources||[]).map(({id,title,url,publisher})=>({id,title,url,publisher}))}:null;$('#draftReference').hidden=!currentReference;$('#draftReference').innerHTML=currentReference?referenceHTML(currentReference):'';if(persistDraft)saveDraft();}
  bindListen($('#listenDraftBtn'),()=>{stopVoice();return $('#captionInput').value;},toast);
  form.addEventListener('input',event=>{stopSpeech();if(['place','area'].includes(event.target.name)){$('#confirmPlacePin').checked=false;setReference(null);}else if(event.target.id==='captionInput'&&currentReference&&JSON.stringify(contexts())!==JSON.stringify(currentReference.contextLines)){setReference(null);}saveDraft();});
  function stopVoice(){if(recognition){recognition.stop();}listening=false;$('#voiceBtn').textContent='Start speaking';$('#fillStoryBtn').disabled=draftBusy;}
  $('#shareDialog').addEventListener('close',()=>{stopVoice();stopSpeech();draftGeneration++;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoice();});
  window.addEventListener('pagehide',()=>recognition?.abort());
  $('#voiceBtn').onclick=()=>{
    if(listening){stopVoice();return;}stopSpeech();
    const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Speech){$('#voiceStatus').textContent='Voice transcription is unavailable in this browser. Use a supported browser such as Chrome, or type your experience below.';return;}
    const base=$('#storyTranscript').value.trim();let committed='';let interim='';
    recognition=new Speech();recognition.lang=$('#voiceLanguage').value;recognition.continuous=true;recognition.interimResults=true;
    recognition.onresult=event=>{interim='';for(let i=event.resultIndex;i<event.results.length;i++){if(event.results[i].isFinal)committed+=event.results[i][0].transcript+' ';else interim+=event.results[i][0].transcript;}
      $('#storyTranscript').value=[base,committed.trim()].filter(Boolean).join(' ').slice(0,6000);$('#voiceInterim').textContent=interim;saveDraft();if($('#storyTranscript').value.length>=6000)stopVoice();};
    recognition.onstart=()=>{listening=true;$('#voiceBtn').textContent='Stop speaking';$('#fillStoryBtn').disabled=true;$('#voiceStatus').textContent='Listening… Tell us the place, what you did, how long you stayed, and any tips.';};
    recognition.onend=()=>{listening=false;$('#voiceBtn').textContent='Start speaking';$('#fillStoryBtn').disabled=draftBusy;$('#voiceInterim').textContent='';if($('#voiceStatus').textContent.startsWith('Listening'))$('#voiceStatus').textContent='Finished listening. Review the transcript before Gemma fills your memory.';};
    recognition.onerror=event=>{$('#voiceStatus').textContent=({'not-allowed':'Microphone access was denied. Enable it in browser settings, or type your story.','audio-capture':'No working microphone was found.','network':'The browser speech service could not connect. Your transcript is saved; try again or type.','no-speech':'No speech was detected. Try again when ready.'})[event.error]||'Speech recognition stopped. Your transcript is still here.';};
    try{recognition.start();}catch{$('#voiceStatus').textContent='Could not start the microphone. Try again or type your experience.';}
  };
  async function ensureLocation(){
    // Request a current fix each time publishing; this also handles revoked permission.
    if(!navigator.geolocation)throw new Error('Location access is required to post. Use a browser with location support.');
    $('#postingLocationStatus').textContent='Waiting for your location…';
    try{const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
      const result=await api('/api/posting-location',json({lat:pos.coords.latitude,lng:pos.coords.longitude}));receipt=result.receipt;expires=result.expires;
      if(!form.elements.lat.value){setPin(pos.coords.latitude,pos.coords.longitude);saveDraft();}
      $('#postingLocationStatus').textContent='Location enabled. Check the public pin: your current location may differ from the place you visited.';
      if(!$('#confirmPlacePin').checked)toast('Location enabled. Check the place pin and confirm it before publishing.');
      return receipt;
    }catch{receipt=null;expires=0;$('#postingLocationStatus').textContent='Location is required to publish. Allow it in browser settings and try again. Your draft is saved.';throw new Error('Location was unavailable or denied. Enable location access before publishing.');}
  }
  $('#postingLocationBtn').onclick=async()=>{const button=$('#postingLocationBtn');button.disabled=true;try{await ensureLocation();saveDraft();}catch(e){toast(e.message);}finally{button.disabled=false;}};
  $('#fillStoryBtn').onclick=async()=>{
    const transcript=$('#storyTranscript').value.trim();if(transcript.length<10){toast('Mention the place and a little about your experience first.');return;}stopSpeech();saveDraft();
    const generation=++draftGeneration;draftBusy=true;$('#fillStoryBtn').disabled=true;$('#draftStatus').textContent='Gemma is reading your notes, checking a place reference, and writing 4–8 summary lines… Allow a couple of minutes.';$('#draftPlaces').hidden=true;
    try{const body=new FormData();body.set('transcript',transcript);const file=$('#mediaInput').files[0];if(file?.type.startsWith('image/'))body.set('media',file);
      const result=await api('/api/story-draft',{method:'POST',body});if(generation!==draftGeneration||!$('#shareDialog').open)return;
      for(const key of ['place','area','title','caption','tip','cost','date','category','duration'])form.elements[key].value=result.draft[key]??'';$('#confirmPlacePin').checked=false;
      $('#draftStatus').textContent=`${result.lines.length}-line summary ready. Review every field, the place reference, and the public pin. Missing dates and durations are left blank.${file?.type.startsWith('video/')?' Your video will be attached to the post; it was not analysed.':''}`;setReference(result.reference);saveDraft();
      if(result.draft.place){try{const results=await api(`/api/search?q=${encodeURIComponent([result.draft.place,result.draft.area].filter(Boolean).join(', '))}`);if(generation!==draftGeneration)return;const box=$('#draftPlaces');box.replaceChildren();box.hidden=false;const p=document.createElement('p');p.textContent='Is this the place you meant? Confirm a match or choose on the map.';box.append(p);for(const location of results){const button=document.createElement('button');button.type='button';button.textContent=location.label;button.onclick=()=>{setPin(location.lat,location.lng);box.hidden=true;saveDraft();};box.append(button);}if(!results.length)p.textContent='No map match found. Choose the correct place on the map.';}catch{$('#draftStatus').textContent+=' Place search is unavailable; choose the pin on the map.';}}
    }catch(e){if(generation===draftGeneration)$('#draftStatus').textContent=e.message;}finally{draftBusy=false;$('#fillStoryBtn').disabled=listening;}
  };
  $('#restoreDraftBtn').onclick=()=>{const draft=stored('roam-story-draft',null);if(!draft)return;for(const key of draftFields)if(typeof draft.fields?.[key]==='string')form.elements[key].value=draft.fields[key];$('#storyTranscript').value=draft.transcript||'';setReference(draft.reference||null);if(form.elements.lat.value)setPin(Number(form.elements.lat.value),Number(form.elements.lng.value));$('#draftStatus').textContent='Draft restored. Reattach your media, then review before posting.';};
  const recovery=document.createElement('section');recovery.className='recovery-tools';recovery.innerHTML='<h3>Your memories stay yours.</h3><p>No account needed. This browser remembers your posts and saved places. Download a recovery file after posting to restore access in another browser or after clearing browser data. Keep it private: it grants editing access to your posts.</p><button id="backupRoamBtn" class="secondary">Save recovery file</button><label class="recovery-import">Restore recovery file<input id="restoreRoamInput" type="file" accept="application/json,.json"></label>';
  $('#aboutDialog').append(recovery);
  const recoveryButton=document.createElement('button');recoveryButton.className='quiet';recoveryButton.textContent='Keep my memories';recoveryButton.onclick=()=>{$('#aboutDialog').showModal();document.body.classList.add('modal-open');};$('.journal-footer').append(recoveryButton);
  $('#backupRoamBtn').onclick=()=>{const backup={version:1,device,...getBackup()};const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='roam-private-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#restoreRoamInput').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>200000)throw new Error('That recovery file is too large.');const backup=validateRecovery(JSON.parse(await file.text()));await restoreBackup(backup);device=backup.device;persist('roam-device',device);toast('Editing keys and saved places restored. Open My memories to find your posts.');}catch(e){toast(e.message);}finally{event.target.value='';}};
  return {get provenanceToken(){return currentReference?.proof||'';},async ensureLocation(){const value=await ensureLocation();if(!$('#confirmPlacePin').checked)throw new Error('Check the public place pin and confirm it before publishing.');return value;},saveDraft,setReference,reset(isEditing,reference=null){editing=isEditing;receipt=null;expires=0;draftGeneration++;$('#storyTranscript').value='';$('#draftStatus').textContent='';$('#draftPlaces').hidden=true;$('#voiceInterim').textContent='';$('#restoreDraftBtn').hidden=isEditing||!stored('roam-story-draft',null);$('.posting-location').hidden=isEditing;$('.voice-story').hidden=isEditing;$('#postingLocationStatus').textContent='Location access is required to publish. Confirm the public place pin below.';setReference(reference,false);},published(){receipt=null;expires=0;try{localStorage.removeItem('roam-story-draft');}catch{}}};
}

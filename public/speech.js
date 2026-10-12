export function speechChunks(text){return String(text).trim().split(/\n+/).filter(Boolean).flatMap(line=>{const chunks=[];while(line.length>280){let at=line.lastIndexOf(' ',280);if(at<80)at=280;chunks.push(line.slice(0,at).trim());line=line.slice(at).trim();}if(line)chunks.push(line);return chunks;});}
export function createSpeechPlayer(synth,Utterance,onState=()=>{}){
  let generation=0,active=false,current=null,cancelVoiceWait=null;
  function stop(){generation++;cancelVoiceWait?.();cancelVoiceWait=null;synth?.cancel();active=false;current=null;onState('stopped');}
  const matchingVoice=lang=>{const local=(synth.getVoices()||[]).filter(voice=>voice.localService);return local.find(voice=>voice.lang.toLowerCase()===lang.toLowerCase())||local.find(voice=>voice.lang.split('-')[0].toLowerCase()===lang.split('-')[0].toLowerCase());};
  function waitForVoice(lang,run){
    const immediate=matchingVoice(lang);if(immediate)return Promise.resolve(immediate);
    return new Promise(resolve=>{
      let done=false,timer,poll;
      const finish=voice=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);synth.removeEventListener?.('voiceschanged',check);if(cancelVoiceWait===cancel)cancelVoiceWait=null;resolve(voice);};
      const check=()=>{if(run!==generation){finish(null);return;}const voice=matchingVoice(lang);if(voice)finish(voice);};
      const cancel=()=>finish(null);cancelVoiceWait=cancel;
      synth.addEventListener?.('voiceschanged',check);timer=setTimeout(()=>finish(matchingVoice(lang)),2000);poll=setInterval(check,100);check();
    });
  }
  async function play(text,lang='en-IN'){
    stop();if(!synth||!Utterance)throw new Error('Speech playback is unavailable in this browser.');
    const chunks=speechChunks(text);if(!chunks.length)throw new Error('Generate or write a summary first.');
    const run=++generation;active=true;onState('loading');
    let voice;try{voice=await waitForVoice(lang,run);}catch(error){if(run===generation)stop();throw error;}
    if(run!==generation)return false;
    if(!voice){stop();throw new Error('No on-device voice is available for this summary. Enable a matching voice in your device settings or try another browser.');}
    onState('playing');let index=0;
    function next(){if(run!==generation)return;if(index===chunks.length){active=false;current=null;onState('finished');return;}current=new Utterance(chunks[index++]);current.voice=voice;current.lang=voice.lang;current.rate=.95;current.onend=next;current.onerror=()=>{if(run===generation){stop();onState('error');}};try{synth.speak(current);}catch{if(run===generation){stop();onState('error');}}}
    next();return active;
  }
  return {play,stop,get active(){return active;}};
}
let player=null,activeButton=null,originalHTML='';
function resetButton(){if(activeButton){activeButton.innerHTML=originalHTML;activeButton.setAttribute('aria-pressed','false');}activeButton=null;}
export function stopSpeech(){player?.stop();resetButton();}
export function bindListen(button,getText,toast){if(!button)return;button.setAttribute('aria-pressed','false');
  button.onclick=async()=>{
    if(player?.active&&activeButton===button){stopSpeech();return;}
    stopSpeech();
    if(!player)player=createSpeechPlayer(window.speechSynthesis,window.SpeechSynthesisUtterance,state=>{if(state==='finished'||state==='stopped'||state==='error'){resetButton();if(state==='error')toast('Speech playback stopped. Check your device voice settings and try again.');}});
    const text=getText();const lang=/[\u0900-\u097f]/.test(text)?'hi-IN':/[\u0c80-\u0cff]/.test(text)?'kn-IN':'en-IN';
    try{const playing=player.play(text,lang);activeButton=button;originalHTML=button.innerHTML;button.textContent='Stop listening';button.setAttribute('aria-pressed','true');await playing;}catch(error){if(activeButton===button)resetButton();toast(error.message);}
  };
}
if(typeof window!=='undefined'){window.speechSynthesis?.getVoices();document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSpeech();});window.addEventListener('pagehide',stopSpeech);}

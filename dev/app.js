(()=>{
'use strict';
const DSP=MelodeasDSP();
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function h(tag,props,...kids){const e=document.createElement(tag);
  for(const k in props||{}){const v=props[k];if(k==='style')e.style.cssText=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k in e)e[k]=v;else e.setAttribute(k,v);}
  for(const c of kids)if(c!=null)e.append(c);return e;}

/* Every sound: what it is, how its MIDI track is labelled, and its default mix settings.
   eq = [low cut Hz, high cut Hz] following common mixing practice; rev / dly = how much reverb and echo it gets. */
const BASS='Sing or hum the bass line. It plays an octave below your voice.',MEL='Sing or hum the line, one clear note at a time.';
const mel=(name,group,color,program,eq,rev,dly,extra)=>Object.assign({name,kind:'melodic',group,color,program,eq,rev,dly:dly||0,octave:group==='Bass'?-1:0,hint:group==='Bass'?BASS:MEL},extra);
const INST={
  kicksnare:{name:'Kick + snare',kind:'drum',mode:'kicksnare',color:'#FFB648',eq:[30,16000],rev:0,hint:'Beatbox it: “p” or “b” for kick, “k” for snare.'},
  hat:{name:'Hi-hat',kind:'drum',mode:'hat',color:'#6FE3CB',eq:[450,20000],rev:0,hint:'Go “ts ts ts”. Hold a long “tsss” for an open hat.'},
  kit:{name:'Drums',chip:'Drums',kind:'drum',mode:'kit',color:'#FFB648',eq:[30,20000],rev:0,hint:'Beatbox, clap or snap. Deep sounds become kick, middle ones snare, bright ones hat, a long “tsss” an open hat. Change what a row plays under Sounds.'},
  bass:mel('Synth bass','Bass','#6EA8FF',38,[35,5000],0,0,{chip:'Bass'}),
  sub:mel('Sub bass','Bass','#6EA8FF',39,[25,1500],0),
  bass808:mel('808 bass','Bass','#6EA8FF',38,[25,4000],0),
  reese:mel('Reese bass','Bass','#6EA8FF',38,[35,3500],0.05),
  acid:mel('Acid bass','Bass','#6EA8FF',87,[45,7000],0.08,0.1),
  synth1:mel('Supersaw','Lead','#E58BFF',81,[140,14000],0.3,0.15,{chip:'Lead'}),
  sqlead:mel('Square lead','Lead','#E58BFF',80,[140,12000],0.2,0.25),
  synth2:mel('Pluck','Lead','#B79CFF',84,[150,14000],0.22,0.3,{chip:'Pluck'}),
  bell:mel('FM bell','Lead','#B79CFF',98,[250,16000],0.4,0.15),
  epiano:mel('Electric piano','Keys','#F6EFD9',4,[90,10000],0.25,0,{chip:'Keys'}),
  piano:mel('Piano','Keys','#F6EFD9',0,[70,14000],0.22),
  lofi:mel('Lo-fi keys','Keys','#F6EFD9',4,[120,4500],0.35),
  organ:mel('Organ','Keys','#F6EFD9',16,[100,9000],0.25),
  pad:mel('Warm pad','Pads and brass','#9BE28A',89,[180,9000],0.5,0,{chip:'Pad'}),
  strings:mel('Strings','Pads and brass','#9BE28A',48,[160,11000],0.45),
  brass:mel('Synth brass','Pads and brass','#FFD95A',62,[130,10000],0.3,0,{chip:'Brass'}),
  trumpet:mel('Trumpet','Pads and brass','#FFD95A',56,[180,11000],0.3),
  toms:mel('Toms','Percussion','#E8915B',117,[50,12000],0,0,{chip:'Toms',hint:'Sing “dum dum” at different pitches. Each tom is tuned to the note you sing.'}),
  voice:{name:'Voice',kind:'audio',color:'#FF8FB1',eq:[90,20000],rev:0.12,hint:'Records your voice as it is.'}
};
for(const k of ['sub','bass','reese','synth1','sqlead','organ','pad','strings','brass','trumpet'])INST[k].env=true; // long notes follow the loudness curve of the voice
const CHIPS=['kit','toms','bass','synth1','synth2','epiano','pad','brass','voice'];
const KIT_NAMES={punch:'Punchy kit','808':'808 kit',boom:'Boom bap kit',trap:'Trap kit'};
const DRUM_NOTE={kick:36,snare:38,clap:39,snap:37,hat:42,ohat:46,crash:49};
const DRUM_NAME={kick:'Kick',snare:'Snare',clap:'Clap',snap:'Snap',hat:'Hi-hat',ohat:'Open hat',crash:'Crash'};
const CLASS_OF={kick:'kick',snare:'snare',clap:'snare',snap:'snare',hat:'hat',ohat:'ohat',crash:'ohat'}; // which of the detector's sound classes a drum belongs to
const DRUM_ROWS={kit:['crash','ohat','hat','snap','clap','snare','kick'],hat:['ohat','hat'],kicksnare:['snare','kick']};
const DRUM_NEXT={kicksnare:{kick:'snare',snare:'kick'},kit:{kick:'snare',snare:'hat',hat:'kick'},hat:{hat:'ohat',ohat:'hat'}};
const NOTE_NAMES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];

/* ---------- state ---------- */
const S={bpm:96,bars:2,grid:0.25,scale:'off',keyRoot:'auto',click:true,listen:'speakers',firstTake:'metronome',latencyMs:null,sens:1,duck:0.03,tracks:[],sel:null,nextId:1,lastTake:null,learned:[]};
const T={playing:false,t0:0,schedT:0,timer:null};
const R={state:'idle',track:null,free:false,tStart:0,tEnd:0,lat:0,bpm:96,lenBeats:8,timer:null};
let ctx=null,master=null,musicBus=null,clickBus=null,fx=null,micStream=null,micMode=null,micSrc=null,capNode=null,analyser=null,capChunks=null,capViaWorklet=false;
let evCache=null,rootCache=null,statusLock=0,drag=null;
const activeSrc=new Set(),SP_OFFSET=4096;
const spb=()=>60/S.bpm,loopBeats=()=>S.bars*4;
const hasContent=t=>t.lenBeats>0&&(t.notes.length>0||!!t.audio);
const selTrack=()=>S.tracks.find(t=>t.id===S.sel)||null;

function st(msg){const e=$('#status');if(e.textContent!==msg)e.textContent=msg;}
function setStatus(msg,hold){st(msg);statusLock=hold?performance.now()+hold:0;}
function idleStatus(){
  if(performance.now()<statusLock)return;
  const tr=selTrack();
  st(tr?INST[tr.inst].hint+(hasContent(tr)?' Recording again adds to this take.':''):(S.tracks.length?'Tap an instrument at the top to record into it or edit it. Tap + to add one.':'Tap + at the top to add an instrument.'));
}

/* ---------- persistence ---------- */
function snapshot(withAudio){
  return {v:2,bpm:S.bpm,bars:S.bars,grid:S.grid,scale:S.scale,keyRoot:S.keyRoot,click:S.click,listen:S.listen,firstTake:S.firstTake,latencyMs:S.latencyMs,sens:S.sens,duck:S.duck,learned:S.learned,
    tracks:S.tracks.map(t=>({inst:t.inst,kit:t.kit,map:t.map||null,akey:t.akey||null,vol:t.vol,mute:t.mute,dyn:t.dyn,octave:t.octave,eq:t.eq,rev:t.rev,lenBeats:t.lenBeats,notes:t.notes,
      audio:withAudio&&t.audio?{sr:t.audio.sr,bpm:t.audio.bpm,b64:pcmToB64(t.audio.data)}:null}))};
}
function restore(o){
  for(const k of ['bpm','bars','grid','scale','keyRoot','click','listen','firstTake','latencyMs','sens','duck'])if(o[k]!==undefined)S[k]=o[k];
  if(Array.isArray(o.learned))S.learned=o.learned.filter(l=>l&&l.lo!=null).slice(-60); // corrections from before the energy measures are dropped
  S.tracks.forEach(dropTrackNodes);S.tracks=[];
  for(const t of o.tracks||[]){
    if(t.inst==='kicksnare'||t.inst==='hat')t.inst='kit'; // older projects: all drums are one instrument now
    if(!INST[t.inst])continue;
    const tr=newTrack(t.inst);Object.assign(tr,{vol:t.vol??0.8,mute:!!t.mute,dyn:t.dyn!==false,octave:t.octave||0,lenBeats:t.lenBeats||0,notes:t.notes||[]});
    if(t.kit&&KIT_NAMES[t.kit])tr.kit=t.kit;if(t.map)tr.map=t.map;if(t.akey)tr.akey=t.akey;if(t.eq&&t.eq.hp!=null)tr.eq={hp:+t.eq.hp,lp:+t.eq.lp};if(t.rev!=null)tr.rev=+t.rev;
    if(t.audio&&t.audio.b64)tr.audio={sr:t.audio.sr,bpm:t.audio.bpm,data:b64ToPcm(t.audio.b64)};
    else if(INST[t.inst].kind==='audio'){tr.savedLen=tr.lenBeats;tr.lenBeats=0;}
    if(tr.audio)tr.peaks=makePeaks(tr.audio.data);
    S.tracks.push(tr);
  }
  S.sel=null;
}
let saveTimer=0,lastRaw=null;
/* voice recordings are too big for localStorage: they live in IndexedDB, one entry per track */
const AUDIO_DB=(()=>{let p=null;
  const open=()=>p||(p=new Promise((res,rej)=>{const r=indexedDB.open('melodeas',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}));
  const run=(mode,fn)=>open().then(db=>new Promise((res,rej)=>{const t=db.transaction('audio',mode),q=fn(t.objectStore('audio'));t.oncomplete=()=>res(q&&q.result);t.onerror=t.onabort=()=>rej(t.error);}));
  return {get:k=>run('readonly',s=>s.get(k)),put:(k,v)=>run('readwrite',s=>s.put(v,k)),keys:()=>run('readonly',s=>s.getAllKeys()),del:k=>run('readwrite',s=>s.delete(k))};})();
async function saveAudio(){
  try{
    for(const t of S.tracks)if(t.audio&&t.akeyFor!==t.audio){t.akey=t.akey||('a'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));t.akeyFor=t.audio;
      await AUDIO_DB.put(t.akey,{sr:t.audio.sr,bpm:t.audio.bpm,data:t.audio.data});}
    const used=new Set(S.tracks.filter(t=>t.audio).map(t=>t.akey));
    for(const k of await AUDIO_DB.keys())if(!used.has(k))await AUDIO_DB.del(k);
  }catch(e){}
}
async function loadAudio(){ // after restore(): bring back the voice recordings of the saved project
  for(const t of S.tracks)if(t.akey&&!t.audio&&INST[t.inst].kind==='audio')try{const a=await AUDIO_DB.get(t.akey);
    if(a&&a.data){t.audio={sr:a.sr,bpm:a.bpm,data:a.data};t.akeyFor=t.audio;t.peaks=makePeaks(a.data);t.lenBeats=t.savedLen||0;}}catch(e){}
}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{for(const t of S.tracks)if(t.audio&&!t.akey)t.akey='a'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  try{localStorage.setItem('melodeas.v1',JSON.stringify(snapshot(false)));}catch(e){}saveAudio();},300);}
function pcmToB64(f){const b=new Uint8Array(f.length*2),v=new DataView(b.buffer);for(let i=0;i<f.length;i++)v.setInt16(i*2,Math.round(clamp(f[i],-1,1)*32767),true);
  let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);}
function b64ToPcm(s){const bin=atob(s),v=new DataView(new ArrayBuffer(bin.length));for(let i=0;i<bin.length;i++)v.setUint8(i,bin.charCodeAt(i));
  const f=new Float32Array(bin.length>>1);for(let i=0;i<f.length;i++)f[i]=v.getInt16(i*2,true)/32767;return f;}
function download(bytes,name,type){const a=h('a',{href:URL.createObjectURL(new Blob([bytes],{type})),download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}

/* ---------- tracks ---------- */
function mixDefaults(tr){const I=INST[tr.inst];tr.eq={hp:I.eq[0],lp:I.eq[1]};tr.rev=I.rev;}
function newTrack(inst){const tr={id:S.nextId++,inst,kit:'punch',vol:0.8,mute:false,solo:false,dyn:true,octave:INST[inst].octave||0,eq:null,rev:0,eqOpen:false,lenBeats:0,notes:[],audio:null,peaks:null,prev:null,nodes:null,cv:null,rects:[],ev:null,buf:null,geom:null,dragRange:null,dragged:0};
  mixDefaults(tr);return tr;}
function pruneEmpty(){ // an instrument left behind with nothing in it is taken off the board
  for(const t of S.tracks.slice())if(t.id!==S.sel&&!hasContent(t)&&R.track!==t){dropTrackNodes(t);S.tracks=S.tracks.filter(x=>x!==t);if(S.lastTake===t.id)S.lastTake=null;}}
function addTrack(inst){const tr=newTrack(inst);S.tracks.push(tr);S.sel=tr.id;pruneEmpty();invalidate();renderTracks();preview(tr);setStatus(INST[inst].hint+' Press the red button when you are ready.',6000);}
function setInst(tr,inst){if(tr.octave===(INST[tr.inst].octave||0))tr.octave=INST[inst].octave||0;tr.inst=inst;mixDefaults(tr);applyMix(tr);invalidate();renderTracks();preview(tr);}
function dropTrackNodes(tr){if(ctx)stopFrozen(tr);tr.frozen=null;clearTimeout(tr.fzTimer);if(tr.nodes){for(const k of ['vol','rev','dly'])try{tr.nodes[k].disconnect();}catch(e){}tr.nodes=null;}tr.buf=null;}
function removeTrack(tr){if(R.track===tr)cancelRec();dropTrackNodes(tr);S.tracks=S.tracks.filter(t=>t!==tr);if(S.sel===tr.id)S.sel=null;invalidate();renderTracks();}
function softInvalidate(tr){tr.ev=null;evCache=null;rootCache=null;}
function invalidate(){evCache=null;rootCache=null;for(const t of S.tracks)t.ev=null;save();updateKeyLabel();}
function keep(tr){tr.prev={notes:tr.notes.map(n=>Object.assign({},n)),audio:tr.audio,lenBeats:tr.lenBeats,peaks:tr.peaks};S.lastTake=tr.id;}
/* A new take is layered onto what the track already holds. The shorter part repeats to fill the longer one. */
function commitTake(tr,c){
  keep(tr);
  if(c.audio){
    const o=tr.audio;
    if(o&&o.sr===c.audio.sr&&o.data.length===c.audio.data.length&&Math.abs(o.bpm-c.audio.bpm)<1e-6){const d=new Float32Array(o.data.length);for(let i=0;i<d.length;i++)d[i]=clamp(o.data[i]+c.audio.data[i],-1,1);c.audio.data=d;}
    tr.audio=c.audio;tr.lenBeats=c.lenBeats;tr.buf=null;tr.peaks=makePeaks(tr.audio.data);
  }else if(tr.lenBeats>0&&tr.notes.length){
    const len=Math.max(tr.lenBeats,c.lenBeats);
    const tile=(notes,l)=>{const out=[];for(let j=0;j*l<len-1e-9;j++)for(const n of notes)if(j*l+n.t<len-1e-9)out.push(Object.assign({},n,{t:j*l+n.t}));return out;};
    tr.notes=tile(tr.notes,tr.lenBeats).concat(tile(c.notes,c.lenBeats)).sort((a,b)=>a.t-b.t);tr.lenBeats=len;
  }else{tr.notes=c.notes;tr.lenBeats=c.lenBeats;}
  invalidate();renderTracks();
}
function makePeaks(d){const n=400,p=new Float32Array(n),step=d.length/n;for(let i=0;i<n;i++){let m=0;for(let j=Math.floor(i*step);j<Math.floor((i+1)*step);j++){const a=Math.abs(d[j]);if(a>m)m=a;}p[i]=m;}return p;}
function learn(tr,n){ // a corrected drum hit becomes a reference for the next takes
  if(n.f==null||INST[tr.inst].mode==='hat')return;
  n.c=CLASS_OF[n.drum]||n.drum;if(n.lo==null)return;S.learned.push({f:n.f,lo:n.lo,hi:n.hi,drum:n.c});if(S.learned.length>60)S.learned.shift();
}

function currentRoot(){
  if(S.scale==='off')return 0;
  if(S.keyRoot!=='auto')return +S.keyRoot;
  if(rootCache==null){const w=new Array(12).fill(0);
    for(const t of S.tracks)if(INST[t.inst].kind==='melodic')for(const n of t.notes)w[((Math.round(n.p)%12)+12)%12]+=n.d;
    rootCache=DSP.estimateRoot(w,S.scale);}
  return rootCache;
}
/* What a track actually plays: timing snapped to the grid, pitch snapped to the scale */
function playEvents(tr){
  if(tr.ev)return tr.ev;
  const I=INST[tr.inst],len=tr.lenBeats,root=currentRoot();let out=[];
  for(const n of tr.notes){
    let b=DSP.quantize(n.t,S.grid);if(b>=len-1e-6)b-=len;if(b<0)b=0;
    if(I.kind==='drum')out.push({b,d:n.drum==='ohat'?(n.d||0.5):n.drum==='crash'?1:0.25,drum:n.drum,n:DRUM_NOTE[n.drum],v:n.v,src:n});
    else out.push({b,d:n.d,n:clamp(DSP.snapPitch(n.p,root,S.scale)+12*tr.octave,0,127),v:n.v,env:tr.dyn!==false&&I.env?n.env:null,src:n});
  }
  out.sort((a,b)=>a.b-b.b||a.n-b.n);
  out=out.filter((e,i)=>{const p=out[i-1];if(p&&Math.abs(p.b-e.b)<1e-6&&p.n===e.n){p.v=Math.max(p.v,e.v);return false;}return true;});
  if(I.kind==='melodic')for(let i=0;i<out.length;i++){let j=i+1;while(j<out.length&&(out[j].b-out[i].b<1e-6||out[j].n!==out[i].n))j++;
    if(out[j])out[i].d=Math.min(out[i].d,out[j].b-out[i].b);out[i].d=Math.max(out[i].d,0.08);}
  return tr.ev=out;
}
function loopEvents(){
  if(evCache)return evCache;
  const LB=loopBeats(),list=[];
  for(const tr of S.tracks){
    if(INST[tr.inst].kind==='audio'||!tr.lenBeats)continue;
    const evs=playEvents(tr),tiles=Math.ceil(LB/tr.lenBeats-1e-9);
    for(let j=0;j<tiles;j++)for(const e of evs){const b=j*tr.lenBeats+e.b;if(b<LB-1e-9)list.push({b,tr,e,tile:j});}
  }
  list.sort((a,b)=>a.b-b.b);
  return evCache=list;
}

/* ---------- sound: effects and the mixer strip of a track ---------- */
const noiseCache=new WeakMap(),irCache=new WeakMap(),satCurves=new Map();
function noise(c){let b=noiseCache.get(c);if(!b){b=c.createBuffer(1,c.sampleRate,c.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;noiseCache.set(c,b);}return b;}
function impulse(c){ // a small bright room that darkens as it dies away
  let b=irCache.get(c);if(b)return b;
  const sr=c.sampleRate,n=Math.round(sr*2.2),pre=Math.round(sr*0.012);b=c.createBuffer(2,n,sr);
  for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);let y=0;
    for(let i=pre;i<n;i++){const k=(i-pre)/sr,a=0.75*Math.exp(-k*2.2)+0.12;y+=a*((Math.random()*2-1)-y);d[i]=y*Math.exp(-k/0.42);}}
  irCache.set(c,b);return b;
}
function sat(c,drive){ // soft saturation: adds harmonics so low sounds are audible on small speakers
  if(!drive)return c.createGain();
  let cv=satCurves.get(drive);if(!cv){cv=new Float32Array(2049);const k=Math.tanh(drive);for(let i=0;i<2049;i++)cv[i]=Math.tanh(drive*(i/1024-1))/k;satCurves.set(drive,cv);}
  const w=c.createWaveShaper();w.curve=cv;w.oversample='2x';return w;
}
function makeFX(c,dest,sp){
  const rin=c.createBiquadFilter(),conv=c.createConvolver(),rg=c.createGain();
  rin.type='highpass';rin.frequency.value=260;conv.buffer=impulse(c);rg.gain.value=2;rin.connect(conv).connect(rg).connect(dest);
  const din=c.createGain(),d=c.createDelay(2),fb=c.createGain(),lp=c.createBiquadFilter(),hp=c.createBiquadFilter(),dg=c.createGain();
  d.delayTime.value=Math.min(1.9,0.75*sp);fb.gain.value=0.36;lp.type='lowpass';lp.frequency.value=3200;hp.type='highpass';hp.frequency.value=300;dg.gain.value=0.8;
  din.connect(d).connect(lp).connect(hp).connect(dg).connect(dest);hp.connect(fb).connect(d);
  return {rev:rin,dly:din,setTempo(s){d.delayTime.setTargetAtTime(Math.min(1.9,0.75*s),c.currentTime,0.05);}};
}
function setMix(c,n,tr){
  n.hp.frequency.value=tr.eq.hp>20?tr.eq.hp:10;
  n.lp.frequency.value=Math.min(c.sampleRate*0.49,tr.eq.lp<20000?tr.eq.lp:24000);
  n.vol.gain.value=tr.vol;n.rev.gain.value=tr.rev;n.dly.gain.value=INST[tr.inst].dly||0;
}
function makeChain(c,tr,dest,f){ // notes -> low cut -> high cut -> volume -> mix, with sends to reverb and echo
  const n={in:c.createGain(),hp:c.createBiquadFilter(),lp:c.createBiquadFilter(),vol:c.createGain(),rev:c.createGain(),dly:c.createGain()};
  n.hp.type='highpass';n.lp.type='lowpass';n.hp.Q.value=n.lp.Q.value=0.707;
  n.in.connect(n.hp).connect(n.lp).connect(n.vol).connect(dest);n.vol.connect(n.rev).connect(f.rev);n.vol.connect(n.dly).connect(f.dly);
  setMix(c,n,tr);return n;
}
function applyMix(tr){if(tr.nodes)setMix(ctx,tr.nodes,tr);}
function trackOut(tr){if(!tr.nodes)tr.nodes=makeChain(ctx,tr,musicBus,fx);return tr.nodes.in;}

/* ---------- sound: drum kits ---------- */
const KITS={
  punch:{kick:{f0:230,f1:52,drop:0.05,dec:0.32,drive:2,click:0.3,lvl:0.9},snare:{lvl:0.6,t1:200,tDec:0.09,nHP:1300,nDec:0.17,nGain:0.75},hat:{hp:8000,dec:0.04,odec:0.3,gain:0.3}},
  '808':{kick:{f0:140,f1:47,drop:0.09,dec:0.8,drive:1.5,click:0.12,lvl:0.95},snare:{lvl:0.65,t1:176,t2:331,tDec:0.11,nHP:1900,nDec:0.2,nGain:0.55},hat:{metal:1,hp:7000,dec:0.045,odec:0.4,gain:0.2}},
  boom:{kick:{f0:125,f1:56,drop:0.04,dec:0.24,drive:3,click:0.18,lvl:0.9},snare:{lvl:0.75,t1:185,tDec:0.12,nHP:650,lp:6000,nDec:0.22,nGain:0.85},hat:{hp:5200,lp:9500,dec:0.05,odec:0.26,gain:0.34}},
  trap:{kick:{f0:165,f1:41,drop:0.12,dec:1.15,drive:4,click:0.22,lvl:0.75},snare:{lvl:1.1,clap:1,t1:215,tDec:0.05,bp:1700,nDec:0.2,nGain:1.1},hat:{metal:1,hp:8600,dec:0.03,odec:0.3,gain:0.2}}
};
function noiseHit(c,dest,t,o){
  const s=c.createBufferSource(),g=c.createGain();s.buffer=noise(c);let node=s;
  const filt=(type,fr,q)=>{const f=c.createBiquadFilter();f.type=type;f.frequency.value=fr;if(q)f.Q.value=q;node.connect(f);node=f;};
  if(o.hp)filt('highpass',o.hp);if(o.bp)filt('bandpass',o.bp,o.q||1);if(o.lp)filt('lowpass',o.lp);
  const hold=o.hold||0;g.gain.setValueAtTime(Math.max(o.gain,0.001),t);
  if(hold>0||o.dec>0.45)s.loop=true;if(hold>0){g.gain.exponentialRampToValueAtTime(Math.max(o.gain*0.4,0.001),t+hold);} // a held sound: rings on, then dies away
  g.gain.exponentialRampToValueAtTime(0.0008,t+hold+o.dec);
  node.connect(g).connect(dest);s.start(t,Math.random()*0.5);s.stop(t+hold+o.dec+0.02);
}
function playDrum(c,dest,t,type,vel,kitId,len){
  const K=KITS[kitId]||KITS.punch;let v=Math.pow(vel/127,1.3);
  if(type==='clap'){ // a few hands slightly apart, then the room
    const b=kitId==='808'?1100:kitId==='boom'?1250:1500;
    for(const d of [0,0.011,0.022])noiseHit(c,dest,t+d,{bp:b,q:1.1,dec:0.011,gain:v*1.35});
    noiseHit(c,dest,t+0.031,{bp:b*0.9,q:0.7,dec:kitId==='trap'?0.26:0.19,gain:v*1.35});return;}
  if(type==='snap'){ // finger snap: a short bright crack with a little body
    noiseHit(c,dest,t,{bp:2700,q:2,dec:0.035,gain:v*1.5});
    const o=c.createOscillator(),g=c.createGain();o.frequency.setValueAtTime(2100,t);o.frequency.exponentialRampToValueAtTime(1500,t+0.03);
    g.gain.setValueAtTime(Math.max(v*0.25,0.001),t);g.gain.exponentialRampToValueAtTime(0.0008,t+0.04);o.connect(g).connect(dest);o.start(t);o.stop(t+0.05);return;}
  if(type==='crash'){ // a wash of noise and metal that dies away slowly
    const p=K.hat,dec=kitId==='808'?2.2:1.7;
    noiseHit(c,dest,t,{hp:4300,dec,gain:v*0.34});noiseHit(c,dest,t,{bp:6500,q:0.6,dec:0.3,gain:v*0.3});
    if(p.metal){const g=c.createGain(),hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=5000;
      g.gain.setValueAtTime(Math.max(v*0.12,0.001),t);g.gain.exponentialRampToValueAtTime(0.0008,t+dec);
      for(const fr of [205.3,304.4,369.6,522.7,540,800]){const o=c.createOscillator();o.type='square';o.frequency.value=fr*2.1;o.connect(hp);o.start(t);o.stop(t+dec+0.02);}
      hp.connect(g).connect(dest);}
    return;}
  if(type==='kick'){
    const p=K.kick,o=c.createOscillator(),g=c.createGain(),s=sat(c,p.drive),og=c.createGain();
    o.frequency.setValueAtTime(p.f0,t);o.frequency.exponentialRampToValueAtTime(p.f1,t+p.drop);
    g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(v,0.001),t+0.003);g.gain.setTargetAtTime(0,t+0.003,p.dec/3.5);
    og.gain.value=p.lvl;o.connect(g).connect(s).connect(og).connect(dest);o.start(t);o.stop(t+p.dec*1.7+0.05);
    noiseHit(c,dest,t,{hp:1800,dec:0.014,gain:v*p.click});return;
  }
  if(type==='snare'){
    const p=K.snare,v0=v;v=v0*p.lvl;const tone=(fr,dec,gn)=>{const o=c.createOscillator(),g=c.createGain();o.type='triangle';
      o.frequency.setValueAtTime(fr*1.25,t);o.frequency.exponentialRampToValueAtTime(fr,t+0.03);
      g.gain.setValueAtTime(Math.max(gn,0.001),t);g.gain.exponentialRampToValueAtTime(0.0008,t+dec);o.connect(g).connect(dest);o.start(t);o.stop(t+dec+0.02);};
    tone(p.t1,p.tDec,v*0.5);if(p.t2)tone(p.t2,p.tDec*0.7,v*0.3);
    if(p.clap){for(const d of [0,0.011,0.023])noiseHit(c,dest,t+d,{bp:p.bp,q:1.2,dec:0.012,gain:v*p.nGain*0.8});noiseHit(c,dest,t+0.032,{bp:p.bp,q:0.8,dec:p.nDec,gain:v*p.nGain});}
    else noiseHit(c,dest,t,{hp:p.nHP,lp:p.lp,dec:p.nDec,gain:v*p.nGain});
    return;
  }
  const p=K.hat,hold=type==='ohat'&&len>0?Math.max(0,len-0.08):0,dec=type==='ohat'?(hold?p.odec*0.6:p.odec):p.dec;
  if(p.metal){ // six detuned square waves, the classic drum-machine cymbal
    const g=c.createGain(),bp=c.createBiquadFilter(),hp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=10000;bp.Q.value=0.6;hp.type='highpass';hp.frequency.value=p.hp;
    g.gain.setValueAtTime(Math.max(v*p.gain,0.001),t);if(hold)g.gain.exponentialRampToValueAtTime(Math.max(v*p.gain*0.4,0.001),t+hold);g.gain.exponentialRampToValueAtTime(0.0008,t+hold+dec);
    for(const fr of [205.3,304.4,369.6,522.7,540,800]){const o=c.createOscillator();o.type='square';o.frequency.value=fr*1.48;o.connect(bp);o.start(t);o.stop(t+hold+dec+0.02);}
    bp.connect(hp).connect(g).connect(dest);
  }else noiseHit(c,dest,t,{hp:p.hp,lp:p.lp,dec,hold,gain:v*p.gain});
}

/* ---------- sound: melodic instruments ---------- */
const LVL={/*__LVL__*/};
function playNote(c,dest,id,t,midi,vel,dur,env){
  const f=440*Math.pow(2,(midi-69)/12),v=Math.pow(vel/127,1.3),out=c.createGain(),g=out.gain,stop=[];
  if(env&&INST[id].env&&dur>=0.25){ // the loudness curve sung inside the note
    const eg=c.createGain(),n=env.length;eg.gain.setValueAtTime(Math.max(env[0],0.02),t);
    for(let i=0;i<n;i++)eg.gain.linearRampToValueAtTime(Math.max(env[i],0.02),t+dur*(i+0.5)/n);
    eg.connect(dest);out.connect(eg);
  }else out.connect(dest);
  const O=(type,freq,det,pan,gain,to)=>{const o=c.createOscillator();o.type=type;o.frequency.value=freq;if(det)o.detune.value=det;let node=o;
    if(gain!=null&&gain!==1){const gg=c.createGain();gg.gain.value=gain;node.connect(gg);node=gg;}
    if(pan&&c.createStereoPanner){const p=c.createStereoPanner();p.pan.value=pan;node.connect(p);node=p;}
    node.connect(to||out);o.start(t);stop.push(o);return o;};
  const LP=(fr,q,to)=>{const l=c.createBiquadFilter();l.type='lowpass';l.frequency.value=fr;l.Q.value=q||0.7;l.connect(to||out);return l;};
  const SAT=(drive,to)=>{const s=sat(c,drive);s.connect(to||out);return s;};
  const FM=(car,ratio,i0,i1,tau)=>{const m=c.createOscillator(),mg=c.createGain();m.frequency.value=car.frequency.value*ratio;
    mg.gain.setValueAtTime(i0,t);mg.gain.setTargetAtTime(i1,t,tau);m.connect(mg).connect(car.frequency);m.start(t);stop.push(m);};
  const VIB=(oscs,depth,delay,rate)=>{const l=c.createOscillator(),lg=c.createGain();l.frequency.value=rate||5.6;
    lg.gain.setValueAtTime(0,t);lg.gain.setValueAtTime(0,t+delay);lg.gain.linearRampToValueAtTime(depth,t+delay+0.3);l.connect(lg);for(const o of oscs)lg.connect(o.detune);l.start(t);stop.push(l);};
  let A=0.005,D=0.2,Sx=1,Rl=0.1,lvl=0.2; // attack, decay time constant, sustain level, release, loudness
  switch(id){
    case 'sub':{const s=SAT(1.5);O('sine',f,0,0,1,s);O('sine',f*2,0,0,0.12,s);A=0.008;Sx=0.9;D=0.3;Rl=0.12;lvl=0.5;break;}
    case 'bass808':{const s=SAT(3),o=O('sine',f,0,0,1,s);o.frequency.setValueAtTime(f*2.4,t);o.frequency.exponentialRampToValueAtTime(f,t+0.07);A=0.003;Sx=0;D=0.9;Rl=0.18;lvl=0.5;break;}
    case 'reese':{const l=LP(380+v*800,1.5);O('sawtooth',f,-16,-0.3,1,l);O('sawtooth',f,16,0.3,1,l);O('sine',f,0,0,0.7,l);A=0.02;Rl=0.15;lvl=0.3;break;}
    case 'acid':{const s=SAT(2),l=LP(220,12,s);l.frequency.setValueAtTime(350+v*3800,t);l.frequency.exponentialRampToValueAtTime(220,t+0.22);O('sawtooth',f,0,0,1,l);A=0.004;Sx=0.6;D=0.15;Rl=0.06;lvl=0.25;break;}
    case 'bass':{const l=LP(300,4);l.frequency.setValueAtTime(400+v*2400,t);l.frequency.exponentialRampToValueAtTime(300,t+0.28);
      O('sawtooth',f,0,0,1,l);O('square',f,0,0,0.5,l);O('sine',f,0,0,0.8,l);A=0.005;Sx=0.8;D=0.2;Rl=0.08;lvl=0.3;break;}
    case 'synth1':{const l=LP(1400+v*5200,0.8);[-24,-15,-7,0,7,15,24].forEach((d,i)=>O('sawtooth',f,d,(i-3)/3*0.7,i===3?1:0.7,l));A=0.012;Sx=0.85;D=0.3;Rl=0.28;lvl=0.11;break;}
    case 'sqlead':{const l=LP(2600+v*2500,1),o=O('square',f,0,0,1,l),o2=O('triangle',f/2,0,0,0.5,l);VIB([o,o2],16,0.15);A=0.01;Sx=0.8;D=0.2;Rl=0.12;lvl=0.17;break;}
    case 'synth2':{const l=LP(600,3);l.frequency.setValueAtTime(1200+v*6500,t);l.frequency.exponentialRampToValueAtTime(500,t+0.18);
      O('sawtooth',f,-5,-0.2,1,l);O('square',f,5,0.2,0.6,l);A=0.003;Sx=0;D=0.28;Rl=0.18;lvl=0.28;break;}
    case 'bell':{const car=O('sine',f);FM(car,3.5,f*3.2*v,f*0.2,0.35);O('sine',f*2.01,0,0,0.25);A=0.002;Sx=0;D=0.9;Rl=0.5;lvl=0.25;break;}
    case 'epiano':{for(const [d,p] of [[-4,-0.35],[4,0.35]]){const car=O('sine',f,d,p,0.6);FM(car,1,f*1.6*v,f*0.25,0.25);}
      const tine=O('sine',f,0,0,0.25);FM(tine,14,f*2.2*v,0,0.05);A=0.004;Sx=0.25;D=0.8;Rl=0.25;lvl=0.3;break;}
    case 'lofi':{const l=LP(1400+v*600,0.7),car=O('sine',f,0,0,1,l),o2=O('triangle',f,6,0,0.3,l);FM(car,1,f*1.2*v,f*0.3,0.3);VIB([car,o2],9,0,0.7);A=0.006;Sx=0.3;D=0.7;Rl=0.3;lvl=0.35;break;}
    case 'organ':{const os=[1,2,3,4,6].map((k,i)=>O('sine',f*k,0,0,[1,0.7,0.35,0.3,0.15][i]));VIB(os,5,0,6.2);A=0.006;Rl=0.05;lvl=0.16;break;}
    case 'piano':{const l=LP(2500+v*7500,0.5),tau=clamp(2.2-(midi-36)*0.03,0.5,2.4),inh=k=>f*k*Math.sqrt(1+0.00045*k*k);
      const grp=(tc,amp)=>{const gg=c.createGain();gg.gain.setValueAtTime(amp,t);gg.gain.setTargetAtTime(0,t,tc);gg.connect(l);return gg;};
      const g1=grp(tau*1.2,1),g2=grp(tau*0.6,0.7),g3=grp(tau*0.28,0.5*v+0.1);
      O('sine',inh(1),-2,-0.15,0.6,g1);O('sine',inh(1),2,0.15,0.6,g1);O('sine',inh(2),0,0,0.5,g1);
      O('sine',inh(3),0,0,0.4,g2);O('sine',inh(4),0,0,0.28,g2);O('sine',inh(5),0,0,0.2,g2);
      O('sine',inh(6),0,0,0.16,g3);O('sine',inh(7),0,0,0.12,g3);O('sine',inh(8),0,0,0.09,g3);
      noiseHit(c,out,t,{bp:2200,q:0.7,dec:0.03,gain:0.5*v});A=0.003;Rl=0.22;lvl=0.3;break;}
    case 'pad':{const l=LP(500,0.8);l.frequency.setValueAtTime(500+v*500,t);l.frequency.linearRampToValueAtTime(1100+v*1800,t+1.2);
      [-13,-5,5,13].forEach((d,i)=>O('sawtooth',f,d,[-0.6,-0.2,0.2,0.6][i],1,l));O('sine',f/2,0,0,0.7,l);A=0.4;Rl=1;lvl=0.1;break;}
    case 'strings':{const l=LP(2800+v*1500,0.6),os=[-11,-4,3,10].map((d,i)=>O('sawtooth',f,d,[-0.5,-0.15,0.15,0.5][i],1,l));O('sawtooth',f*2,0,0,0.25,l);VIB(os,6,0.25);A=0.11;Rl=0.4;lvl=0.11;break;}
    case 'brass':{const l=LP(400,1.5);l.frequency.setValueAtTime(350,t);l.frequency.linearRampToValueAtTime(900+v*4800,t+0.07);l.frequency.setTargetAtTime(700+v*2200,t+0.07,0.25);
      [-9,0,9].forEach((d,i)=>O('sawtooth',f,d,(i-1)*0.4,1,l));A=0.03;Sx=0.85;D=0.3;Rl=0.14;lvl=0.16;break;}
    case 'toms':{ // a drum, only loosely tuned: the sung pitch is squeezed into tom range (about 65 to 230 Hz)
      const ft=clamp(110*Math.pow(2,(midi-52)/12*0.6),65,230),dec=clamp(0.2-(ft-65)*0.0006,0.1,0.2);
      const o=O('sine',ft);o.frequency.setValueAtTime(ft*1.6,t);o.frequency.exponentialRampToValueAtTime(ft,t+0.045);o.frequency.setTargetAtTime(ft*0.94,t+0.045,0.3);
      const og=c.createGain();og.gain.setValueAtTime(0.5,t);og.gain.setTargetAtTime(0,t,0.035);og.connect(out);
      O('sine',ft*1.59,0,0,1,og);O('sine',ft*2.14,0,0,0.6,og); // drum-head overtones, gone in a moment
      noiseHit(c,out,t,{bp:3200,q:0.6,dec:0.03,gain:1.1*v});        // stick
      noiseHit(c,out,t,{bp:ft*3.2,q:1.2,dec:0.11,gain:0.55*v});     // shell
      dur=0.02;A=0.001;Sx=0;D=dec;Rl=dec*4;lvl=0.7;break;}
    default:{ // trumpet
      const pk=c.createBiquadFilter();pk.type='peaking';pk.frequency.value=1300;pk.Q.value=1.2;pk.gain.value=6;pk.connect(out);
      const l=LP(500,2.5,pk);l.frequency.setValueAtTime(500,t);l.frequency.linearRampToValueAtTime(1300+v*2800,t+0.07);l.frequency.setTargetAtTime(1500+v*1200,t+0.07,0.2);
      const o=O('sawtooth',f,0,0,1,l);VIB([o],14,0.18,5.5);A=0.035;Sx=0.9;Rl=0.09;lvl=0.28;}
  }
  const d=Math.max(dur,A+0.02),peak=v*lvl*(LVL[id]||1);
  g.setValueAtTime(0,t);g.linearRampToValueAtTime(peak,t+A);
  if(Sx<1)g.setTargetAtTime(peak*Sx,t+A,D);
  g.setTargetAtTime(0,t+d,Rl/4);
  const end=t+d+Rl*1.5+0.05;for(const o of stop)o.stop(end);
}
function click(t,accent,countIn){
  const o=ctx.createOscillator(),g=ctx.createGain(),lvl=(R.state!=='idle'&&S.listen==='speakers'&&!countIn)?0.04:0.28;
  o.frequency.value=accent?1568:1047;g.gain.setValueAtTime(lvl,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.05);
  o.connect(g).connect(clickBus);o.start(t);o.stop(t+0.06);
}
function preview(tr,again){ // play a few notes of a sound when it is picked
  if(!ctx||ctx.state!=='running'){if(R.state==='idle'&&!again)ensureAudio().then(()=>preview(tr,true)).catch(()=>{});return;}
  if(R.state!=='idle'||T.playing)return;
  const t=ctx.currentTime+0.05,I=INST[tr.inst];
  if(I.kind==='drum')(I.mode==='hat'?['hat','hat','ohat']:I.mode==='kit'?['kick','hat','snare','hat']:['kick','snare','kick','snare']).forEach((d,i)=>playDrum(ctx,trackOut(tr),t+i*0.22,d,105,tr.kit));
  else if(I.kind==='melodic')[0,7,12].forEach((s,i)=>playNote(ctx,trackOut(tr),tr.inst,t+i*0.24,clamp(57+s+12*tr.octave,0,127),100,0.22));
}
function audition(tr,n){
  if(!ctx||ctx.state!=='running'||T.playing||R.state!=='idle')return;
  const t=ctx.currentTime+0.02;
  if(n.drum)playDrum(ctx,trackOut(tr),t,n.drum,n.v,tr.kit,n.drum==='ohat'?(n.d||0.5)*spb():0);
  else playNote(ctx,trackOut(tr),tr.inst,t,clamp(DSP.snapPitch(n.p,currentRoot(),S.scale)+12*tr.octave,0,127),n.v,0.25);
}
/* ---------- audio setup, microphone, capture ---------- */
const WORKLET=`class Cap extends AudioWorkletProcessor{
  constructor(){super();this.on=false;this.buf=new Float32Array(2048);this.n=0;this.f=0;this.port.onmessage=e=>{this.on=e.data.on;this.n=0;};}
  process(inputs){const ch=inputs[0]&&inputs[0][0];
    if(this.on&&ch){if(this.n+ch.length>this.buf.length)this.flush();if(this.n===0)this.f=currentFrame;this.buf.set(ch,this.n);this.n+=ch.length;if(this.n>=this.buf.length)this.flush();}
    return true;}
  flush(){this.port.postMessage({f:this.f,d:this.buf.slice(0,this.n)});this.n=0;}
}
registerProcessor('melodeas-cap',Cap);`;
async function ensureAudio(){
  if(!ctx){
    ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
    const comp=ctx.createDynamicsCompressor();comp.threshold.value=-10;comp.ratio.value=4;comp.connect(ctx.destination);
    master=ctx.createGain();master.gain.value=0.9;master.connect(comp);
    musicBus=ctx.createGain();musicBus.connect(master);clickBus=ctx.createGain();clickBus.connect(master);fx=makeFX(ctx,musicBus,spb());
  }
  if(ctx.state!=='running')await ctx.resume();
}
async function ensureMic(mode){
  mode=mode||S.listen;
  if(micStream&&micMode===mode)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){const e=new Error('insecure');e.name='InsecureContext';throw e;}
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:mode==='speakers',noiseSuppression:false,autoGainControl:false,channelCount:1}});
  if(micStream){micStream.getTracks().forEach(t=>t.stop());try{micSrc.disconnect();}catch(e){}}
  micStream=stream;micMode=mode;micSrc=ctx.createMediaStreamSource(stream);
  if(!capNode){
    const sink=ctx.createGain();sink.gain.value=0;sink.connect(ctx.destination);
    let ok=false; // a page opened straight from disk can't load a blob worklet, so try a data: URL too
    if(ctx.audioWorklet&&!window.melodeasNoWorklet)for(const u of [URL.createObjectURL(new Blob([WORKLET],{type:'text/javascript'})),'data:text/javascript;base64,'+btoa(WORKLET)]){
      try{await ctx.audioWorklet.addModule(u);ok=true;break;}catch(e){}}
    if(ok){
      capNode=new AudioWorkletNode(ctx,'melodeas-cap',{numberOfInputs:1,numberOfOutputs:1,channelCount:1,channelCountMode:'explicit'});
      capNode.port.onmessage=e=>{if(capChunks)capChunks.push(e.data);};capViaWorklet=true;
    }else{ // fallback: block times come from the audio clock (playbackTime), never from the main thread
      capNode=ctx.createScriptProcessor(2048,1,1);
      capNode.onaudioprocess=e=>{if(capChunks)capChunks.push({f:Math.round(e.playbackTime*ctx.sampleRate)-SP_OFFSET,d:new Float32Array(e.inputBuffer.getChannelData(0))});};
    }
    capNode.connect(sink);
    analyser=ctx.createAnalyser();analyser.fftSize=1024;
  }
  micSrc.connect(capNode);micSrc.connect(analyser);
  $('#micOn').classList.add('hide');
}
function capStart(){capChunks=[];if(capViaWorklet)capNode.port.postMessage({on:true});}
function capStop(){capChunks=null;if(capViaWorklet)capNode.port.postMessage({on:false});}
function capSlice(t0,t1){
  const sr=ctx.sampleRate,a=Math.round(t0*sr),n=Math.max(0,Math.round((t1-t0)*sr)),out=new Float32Array(n);
  for(const c of capChunks||[]){const off=c.f-a,s=Math.max(0,-off),e=Math.min(c.d.length,n-off);if(e>s)out.set(c.d.subarray(s,e),off+s);}
  return out;
}
function latency(){
  if(S.latencyMs!=null)return S.latencyMs/1000;
  let i=0.012;try{i=micStream.getAudioTracks()[0].getSettings().latency||0.012;}catch(e){}
  return (ctx.outputLatency||0.02)+(ctx.baseLatency||0.005)+i;
}
function micError(e){
  if(e&&e.name==='InsecureContext')return 'This browser only opens the microphone on localhost or https. Start the page with start.command (see README) and try again.';
  if(e&&(e.name==='NotAllowedError'||e.name==='SecurityError'))return 'The microphone is blocked. Allow it for this page in the browser, then press record again.';
  if(e&&e.name==='NotFoundError')return 'No microphone found. Plug one in and press record again.';
  return 'Could not open the microphone: '+(e&&e.message||e);
}

/* ---------- analysis runs in a worker so the loop keeps playing ---------- */
let worker=null,wid=0;const pending=new Map();
function analyse(msg){
  if(worker===null){
    try{
      const src=MelodeasDSP.toString()+';const D=MelodeasDSP();onmessage=e=>{const m=e.data;try{postMessage({id:m.id,res:D.analyse(m)});}catch(err){postMessage({id:m.id,err:String(err)});}};';
      worker=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
      worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.err?p.rej(new Error(e.data.err)):p.res(e.data.res);};
      worker.onerror=()=>{worker=false;for(const p of pending.values())try{p.res(DSP.analyse(p.msg));}catch(err){p.rej(err);}pending.clear();};
    }catch(e){worker=false;}
  }
  if(!worker)return Promise.resolve().then(()=>DSP.analyse(msg));
  return new Promise((res,rej)=>{const id=++wid;pending.set(id,{res,rej,msg});worker.postMessage(Object.assign({id},msg));});
}

/* ---------- transport: a look-ahead scheduler ---------- */
function startTransport(t0,from){for(const t of S.tracks)t.bufIt=-1;T.t0=t0;T.schedT=from;T.playing=true;clearInterval(T.timer);T.timer=setInterval(tick,25);tick();updateTransportUI();}
function stopTransport(){T.playing=false;clearInterval(T.timer);for(const s of activeSrc)stopSrc(s);activeSrc.clear();updateTransportUI();}
function tick(){
  const now=ctx.currentTime,end=now+0.2;
  if(T.schedT<now)T.schedT=now;
  scheduleRange((T.schedT-T.t0)/spb(),(end-T.t0)/spb());
  T.schedT=end;
}
function audible(tr,anySolo,t){
  return !(tr.mute||(anySolo&&!tr.solo));
}
function scheduleRange(b0,b1){
  const sp=spb(),LB=loopBeats();
  for(let k=Math.ceil(b0);k<b1;k++)if(k<0||S.click)click(T.t0+k*sp,((k%4)+4)%4===0,k<0);
  if(b1<=0)return;
  const evs=loopEvents(),anySolo=S.tracks.some(t=>t.solo);
  const i0=Math.floor(Math.max(b0,0)/LB),i1=Math.floor((b1-1e-9)/LB);
  for(let it=i0;it<=i1;it++){
    const base=it*LB;
    for(const tr of S.tracks){ // a rendered track plays as one buffer per round; live synthesis is only the fallback
      tr.useBuf=false;const buf=ensureFrozen(tr);if(!buf)continue;
      tr.useBuf=true;
      if(!audible(tr,anySolo)){if(tr.bufIt===it)stopFrozen(tr);continue;}
      if(tr.bufIt!==it){const sb=Math.max(b0,base);startFrozen(tr,buf,T.t0+sb*sp,(sb-base)*sp);tr.bufIt=it;}
    }
    for(const x of evs){
      if(x.tr.useBuf)continue;
      const ab=base+x.b;if(ab<b0||ab>=b1)continue;
      const t=T.t0+ab*sp;if(!audible(x.tr,anySolo,t))continue;
      if(x.e.drum)playDrum(ctx,trackOut(x.tr),t,x.e.drum,x.e.v,x.tr.kit,x.e.d*sp);else playNote(ctx,trackOut(x.tr),x.tr.inst,t,x.e.n,x.e.v,x.e.d*sp,x.e.env);
    }
    for(const tr of S.tracks){
      if(!tr.audio||!tr.lenBeats)continue;
      const tiles=Math.ceil(LB/tr.lenBeats-1e-9);
      for(let j=0;j<tiles;j++){const ab=base+j*tr.lenBeats;if(ab<b0||ab>=b1)continue;
        const t=T.t0+ab*sp;if(audible(tr,anySolo,t))startAudio(tr,t,0,Math.min(tr.lenBeats,LB-j*tr.lenBeats));}
    }
  }
}
/* ---------- rendered tracks: each instrument track is synthesised once, offline, and looped as audio ---------- */
const FZ_TAIL=3,FZ_LEAD=0.02;let fzChain=Promise.resolve();
function stopSrc(s){try{if(s._g){const n=ctx.currentTime;s._g.gain.cancelScheduledValues(n);s._g.gain.setTargetAtTime(0,n,0.008);s.stop(n+0.05);}else s.stop();}catch(e){}}
function freezeKey(tr){
  const ev=playEvents(tr),head=[tr.inst,tr.kit,S.bpm,S.bars,tr.lenBeats,ctx.sampleRate].join('|');
  if(tr.fkEv!==ev||tr.fkHead!==head){tr.fkEv=ev;tr.fkHead=head;tr.fk=head+'|'+ev.map(e=>e.b+','+e.d+','+e.n+','+(e.drum||'')+','+e.v+(e.env?','+e.env.join('/'):'')).join(';');}
  return tr.fk;
}
function ensureFrozen(tr){ // the rendered loop if it is current; otherwise null, and a render is on its way
  if(!ctx||window.melodeasNoFreeze||INST[tr.inst].kind==='audio'||!tr.lenBeats||!tr.notes.length){tr.frozen=null;return null;}
  const k=freezeKey(tr);
  if(tr.frozen&&tr.frozen.key===k)return tr.frozen.buf;
  if(tr.frozen){tr.frozen=null;stopFrozen(tr);}
  if(tr.fzWant!==k){tr.fzWant=k;clearTimeout(tr.fzTimer);
    tr.fzTimer=setTimeout(()=>{fzChain=fzChain.then(()=>renderFrozen(tr)).catch(()=>{});},T.playing?250:40);}
  return null;
}
async function renderFrozen(tr){
  if(!S.tracks.includes(tr)||!tr.lenBeats||!tr.notes.length)return;
  const key=freezeKey(tr);if(tr.fzWant!==key||(tr.frozen&&tr.frozen.key===key))return;
  const sp=spb(),LB=loopBeats(),sr=ctx.sampleRate,off=new OfflineAudioContext(2,Math.ceil((LB*sp+FZ_TAIL+FZ_LEAD)*sr),sr);
  const evs=playEvents(tr),tiles=Math.ceil(LB/tr.lenBeats-1e-9);
  for(let j=0;j<tiles;j++)for(const e of evs){const b=j*tr.lenBeats+e.b;if(b>=LB-1e-9)continue;const t=FZ_LEAD+b*sp;
    if(e.drum)playDrum(off,off.destination,t,e.drum,e.v,tr.kit,e.d*sp);else playNote(off,off.destination,tr.inst,t,e.n,e.v,e.d*sp,e.env);}
  const buf=await off.startRendering();
  if(S.tracks.includes(tr)&&freezeKey(tr)===key)tr.frozen={key,buf};
}
function startFrozen(tr,buf,when,off){
  const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=buf;s._tr=tr;s._g=g;
  if(off>0.001){g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(1,when+0.008);}
  s.connect(g).connect(trackOut(tr));s.start(Math.max(when,0),FZ_LEAD+off);
  activeSrc.add(s);s.onended=()=>{activeSrc.delete(s);try{g.disconnect();}catch(e){}};
}
function stopFrozen(tr){for(const s of activeSrc)if(s._tr===tr){stopSrc(s);activeSrc.delete(s);}tr.bufIt=-1;}
function warmFrozen(){for(const tr of S.tracks)ensureFrozen(tr);}
function startAudio(tr,when,offBeats,durBeats){
  if(!tr.buf){tr.buf=ctx.createBuffer(1,tr.audio.data.length,tr.audio.sr);tr.buf.getChannelData(0).set(tr.audio.data);}
  const s=ctx.createBufferSource();s.buffer=tr.buf;s.playbackRate.value=S.bpm/tr.audio.bpm; // a tempo change plays voice like tape
  s.connect(trackOut(tr));s.start(when,offBeats*60/tr.audio.bpm);s.stop(when+durBeats*spb());
  activeSrc.add(s);s.onended=()=>activeSrc.delete(s);
}
function kickAudio(tr){ // a fresh voice take joins the loop mid-round
  if(!T.playing||!tr.audio)return;
  const now=ctx.currentTime+0.03,ab=(now-T.t0)/spb(),LB=loopBeats();if(ab<0)return;
  const lb=ab%LB,j=Math.floor(lb/tr.lenBeats),off=lb-j*tr.lenBeats,rem=Math.min(tr.lenBeats,LB-j*tr.lenBeats)-off;
  if(rem>0.1&&audible(tr,S.tracks.some(t=>t.solo),now))startAudio(tr,now,off,rem);
}
function showBpm(v){document.querySelectorAll('[data-bpm]').forEach(e=>e.textContent=v);}
function setBpm(v){
  if(R.state!=='idle')return;
  v=clamp(Math.round(v),40,220);
  if(T.playing){const now=ctx.currentTime,pos=(now-T.t0)/spb();T.t0=now-pos*60/v;}
  S.bpm=v;showBpm(v);if(fx)fx.setTempo(spb());save();
}

/* ---------- recording ---------- */
async function recPress(){
  if(R.state==='recording'&&R.free){finishFree();return;}
  if(R.state==='analysing')return;
  if(R.state!=='idle'){cancelRec('Recording cancelled.');return;}
  const tr=selTrack();
  if(!tr){if(!S.tracks.length){openPicker();return;}setStatus('Select an instrument at the top first.',4000);const a=$('#add');a.classList.remove('nudge');void a.offsetWidth;a.classList.add('nudge');return;}
  try{await ensureAudio();await ensureMic();}catch(e){setStatus(micError(e),8000);return;}
  if(R.state!=='idle')return;
  R.track=tr;R.lat=latency();capStart();
  const now=ctx.currentTime,empty=!S.tracks.some(hasContent);
  if(S.firstTake==='free'&&empty){
    if(T.playing)stopTransport();
    R.free=true;R.state='recording';R.tStart=now;
    R.timer=setTimeout(()=>cancelRec('That take ran past a minute, so it was dropped.'),60000);
  }else{
    R.free=false;const sp=spb(),LB=loopBeats();
    if(!T.playing){startTransport(now+0.12+4*sp,now+0.1);R.tStart=T.t0;}
    else{const pos=(now+0.3-T.t0)/sp;R.tStart=T.t0+(pos<=0?0:Math.ceil(pos/LB)*LB)*sp;}
    R.tEnd=R.tStart+LB*sp;R.bpm=S.bpm;R.lenBeats=LB;R.state='armed';
    if(S.listen==='speakers'){ // turn the loop down while the mic is listening
      musicBus.gain.setTargetAtTime(Math.max(S.duck,0.0001),Math.max(now,R.tStart-0.06),0.02);musicBus.gain.setTargetAtTime(1,R.tEnd,0.05);}
    R.timer=setTimeout(finishRec,(R.tEnd+R.lat+0.18-now)*1000);
  }
  lockControls();
}
function endRec(){clearTimeout(R.timer);R.state='idle';R.track=null;R.free=false;lockControls();}
function cancelRec(msg){
  if(R.state==='idle')return;
  capStop();if(musicBus){musicBus.gain.cancelScheduledValues(0);musicBus.gain.setTargetAtTime(1,ctx.currentTime,0.05);}
  endRec();if(msg)setStatus(msg,3000);
}
function fade(d,sr){const n=Math.min(d.length>>1,Math.round(sr*0.006));for(let i=0;i<n;i++){const g=i/n;d[i]*=g;d[d.length-1-i]*=g;}}
/* What the sorter may compare a new take against: hits already on this track and hits the user has corrected */
function drumNote(tr,e,t,sp){const drum=(tr.map&&tr.map[e.drum])||e.drum,n={t,drum,c:e.drum,v:e.v,f:e.f,lo:e.lo,hi:e.hi};if(drum==='ohat')n.d=Math.max(0.25,e.d/sp);return n;}
function setRowSound(tr,from,to){ // every hit on one row becomes another sound; later takes follow
  if(from===to)return;keep(tr);const cls=new Map();
  for(const n of tr.notes)if(n.drum===from){n.drum=to;const c=n.c||CLASS_OF[from];cls.set(c,(cls.get(c)||0)+1);if(to==='ohat'&&!n.d)n.d=0.5;}
  tr.map=tr.map||{};for(const k in tr.map)if(tr.map[k]===from)tr.map[k]=to;
  for(const [c] of cls)tr.map[c]=to;
  if(tr.extra)tr.extra=tr.extra.filter(r=>r!==from);invalidate();save();renderTracks();
}
function knownDrums(tr){return INST[tr.inst].kind==='drum'?tr.notes.filter(n=>n.f!=null&&n.lo!=null).map(n=>({f:n.f,lo:n.lo,hi:n.hi,drum:n.c||CLASS_OF[n.drum]||n.drum})).concat(S.learned):null;}
const NOTHING='Didn’t catch anything. Get closer to the mic, or raise mic sensitivity in Settings.';
async function finishRec(){
  const tr=R.track,I=INST[tr.inst],sr=ctx.sampleRate,pre=0.1,sp=60/R.bpm,len=R.lenBeats;
  const x=capSlice(R.tStart+R.lat-pre,R.tEnd+R.lat+0.06),noise=capSlice(R.tStart+R.lat-0.85,R.tStart+R.lat-0.15);capStop();R.state='analysing';
  lastRaw={x,sr,kind:I.kind,name:INST[tr.inst].name};if(window.melodeas.debug)window.melodeas.lastX=x;
  try{
    if(I.kind==='audio'){
      const a=Math.round(pre*sr),data=x.slice(a,a+Math.round(len*sp*sr));let pk=0;for(let i=0;i<data.length;i++){const v=Math.abs(data[i]);if(v>pk)pk=v;}
      if(pk<0.01)setStatus(NOTHING,6000);
      else{const layered=!!tr.audio;fade(data,sr);for(const s of activeSrc)try{s.stop();}catch(e){}commitTake(tr,{audio:{data,sr,bpm:R.bpm},lenBeats:len});S.tracks.forEach(kickAudio);setStatus(layered?'Voice recorded on top of the earlier take.':'Voice recorded.',3000);}
    }else{
      const res=await analyse({mode:I.kind==='drum'?I.mode:'melodic',x,sr,sens:S.sens,known:knownDrums(tr),noise:noise.some(v=>v!==0)?noise:null});
      const notes=[],had=tr.lenBeats>0?tr.notes.length:0;
      for(const e of res.events){
        let t=(e.t-pre)/sp;if(t<-pre/sp||t>=len)continue;
        if(I.kind==='drum')notes.push(drumNote(tr,e,Math.max(0,t),sp));
        else{let d=e.d/sp;if(t<0){d+=t;t=0;}if(d>0.05)notes.push(e.env?{t,d,p:e.p,v:e.v,env:e.env}:{t,d,p:e.p,v:e.v});}
      }
      if(!notes.length)setStatus(NOTHING,6000);
      else{commitTake(tr,{notes,lenBeats:len});setStatus('Got '+notes.length+(I.kind==='drum'?(notes.length===1?' hit.':' hits.'):(notes.length===1?' note.':' notes.'))+(had?' Added to the '+had+' already on this track.':' Record again to add more, or add another track.'),5000);}
    }
  }catch(err){setStatus('Something went wrong while listening back: '+err.message,8000);}
  endRec();
}
async function finishFree(){
  const tStop=ctx.currentTime,tr=R.track,I=INST[tr.inst],sr=ctx.sampleRate;
  clearTimeout(R.timer);R.state='analysing';
  await sleep(130);
  const x=capSlice(R.tStart,tStop+0.05);capStop();lastRaw={x,sr,kind:I.kind,name:I.name};
  try{
    const res=await analyse({mode:I.kind==='drum'?I.mode:I.kind==='audio'?'audio':'melodic',x,sr,sens:S.sens,known:knownDrums(tr)});
    if(!res.events.length){setStatus(NOTHING,6000);endRec();return;}
    const first=Math.max(0,res.events[0].t),L=(tStop-R.tStart)-first+R.lat/2,tm=DSP.tempoFromLength(L);
    if(!tm){setStatus('That take was too short to loop. Aim for at least one bar, and stop on the first beat of the next round.',7000);endRec();return;}
    if(I.kind!=='audio')tm.bpm=DSP.refineTempo(res.events.map(e=>e.t-first).filter(t=>t>=0&&t<L),tm.bpm);
    const sp=60/tm.bpm,len=tm.bars*4;
    S.bars=tm.bars;S.bpm=clamp(Math.round(tm.bpm),40,220);fx.setTempo(spb());syncControls();
    if(I.kind==='audio'){const a=Math.round(first*sr),data=new Float32Array(Math.round(L*sr));data.set(x.subarray(a,Math.min(x.length,a+data.length)));fade(data,sr);
      commitTake(tr,{audio:{data,sr,bpm:tm.bpm},lenBeats:len});}
    else{const notes=[];
      for(const e of res.events){const t=(e.t-first)/sp;if(t<0||t>=len)continue;
        notes.push(I.kind==='drum'?drumNote(tr,e,t,sp):{t,d:e.d/sp,p:e.p,v:e.v});}
      commitTake(tr,{notes,lenBeats:len});}
    startTransport(tStop,ctx.currentTime);kickAudio(tr);
    setStatus('Loop set: '+tm.bars+(tm.bars===1?' bar':' bars')+' at '+S.bpm+' bpm. Everything you add now follows it.',6000);
  }catch(err){setStatus('Something went wrong while listening back: '+err.message,8000);}
  endRec();
}

/* ---------- latency calibration ---------- */
async function calibrate(){
  if(R.state!=='idle')return;
  try{await ensureAudio();if(T.playing)stopTransport();await ensureMic('raw');}catch(e){setStatus(micError(e),8000);return;}
  setStatus('Measuring… stay quiet for two seconds.',4000);
  capStart();const t0=ctx.currentTime+0.3,offs=[0,0.4,0.8,1.2,1.6];
  for(const o of offs){const os=ctx.createOscillator(),g=ctx.createGain();os.frequency.value=2000;g.gain.setValueAtTime(0.7,t0+o);g.gain.exponentialRampToValueAtTime(0.001,t0+o+0.03);
    os.connect(g).connect(master);os.start(t0+o);os.stop(t0+o+0.04);}
  await sleep(2500);
  const x=capSlice(t0,t0+2.05);capStop();
  const d=DSP.clickDelays(x,ctx.sampleRate,offs,0.38).filter(v=>!isNaN(v)),med=DSP.median(d);
  try{await ensureMic();}catch(e){}
  if(d.length<4||Math.max(...d)-Math.min(...d)>0.03){setStatus('Couldn’t hear the test clicks clearly. This only works on speakers, turned up. On headphones, set the offset by hand.',8000);return;}
  S.latencyMs=Math.round(med*1000);$('#lat').value=S.latencyMs;save();setStatus('Timing offset measured: '+S.latencyMs+' ms.',5000);
}

/* ---------- export ---------- */
function songForMidi(){
  const tracks=[];let ch=0;const byTrack=new Map();
  for(const x of loopEvents()){if(!byTrack.has(x.tr))byTrack.set(x.tr,[]);byTrack.get(x.tr).push({t:x.b,d:x.e.d,n:x.e.n,v:x.e.v,env:x.e.env});}
  for(const tr of S.tracks){const notes=byTrack.get(tr);if(!notes)continue;const I=INST[tr.inst];
    if(I.kind==='drum')tracks.push({name:I.name,channel:9,isDrum:true,notes});
    else{if(ch===9)ch++;tracks.push({name:I.name,channel:ch++%16,program:I.program,notes,expr:notes.some(n=>n.env)});}}
  return {name:'Melodeas loop',bpm:S.bpm,loopBeats:loopBeats(),tracks};
}
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes());}
function exportMidi(){
  const song=songForMidi();
  if(!song.tracks.length){setStatus('Nothing to export yet. Record a drum or instrument track first.',4000);return;}
  download(DSP.buildMidi(song),'melodeas-'+S.bpm+'bpm-'+stamp()+'.mid','audio/midi');
  setStatus('MIDI file exported: '+song.tracks.length+(song.tracks.length===1?' track':' tracks')+' at '+S.bpm+' bpm.',5000);
}
async function renderMix(){ // the loop once through, with the same instruments, EQ and effects as live
  const sp=spb(),LB=loopBeats(),sr=44100,off=new OfflineAudioContext(2,Math.ceil((LB*sp+2.5)*sr),sr);
  const comp=off.createDynamicsCompressor();comp.threshold.value=-10;comp.ratio.value=4;comp.connect(off.destination);
  const bus=off.createGain();bus.gain.value=0.9;bus.connect(comp);
  const f=makeFX(off,bus,sp),anySolo=S.tracks.some(t=>t.solo),outs=new Map();
  const outOf=tr=>{if(!outs.has(tr))outs.set(tr,makeChain(off,tr,bus,f).in);return outs.get(tr);};
  const on=tr=>!tr.mute&&(!anySolo||tr.solo);
  for(const x of loopEvents()){if(!on(x.tr))continue;const t=0.02+x.b*sp;
    if(x.e.drum)playDrum(off,outOf(x.tr),t,x.e.drum,x.e.v,x.tr.kit,x.e.d*sp);else playNote(off,outOf(x.tr),x.tr.inst,t,x.e.n,x.e.v,x.e.d*sp,x.e.env);}
  for(const tr of S.tracks){if(!tr.audio||!tr.lenBeats||!on(tr))continue;
    const b=off.createBuffer(1,tr.audio.data.length,tr.audio.sr);b.getChannelData(0).set(tr.audio.data);
    for(let j=0;j*tr.lenBeats<LB-1e-9;j++){const s=off.createBufferSource();s.buffer=b;s.playbackRate.value=S.bpm/tr.audio.bpm;s.connect(outOf(tr));
      s.start(0.02+j*tr.lenBeats*sp);s.stop(0.02+Math.min((j+1)*tr.lenBeats,LB)*sp);}}
  return off.startRendering();
}
async function exportMix(){
  if(!S.tracks.some(hasContent)){setStatus('Nothing to export yet.',4000);return;}
  const buf=await renderMix();
  download(DSP.encodeWav([buf.getChannelData(0),buf.getChannelData(1)],buf.sampleRate),'melodeas-mix-'+S.bpm+'bpm-'+stamp()+'.wav','audio/wav');
  setStatus('Mix exported as WAV.',4000);
}

/* ---------- the board: every track on one grid, the selected one in front ---------- */
const ROW_LABEL={kick:'kick',snare:'snare',clap:'clap',snap:'snap',hat:'hat',ohat:'open hat',crash:'crash'},ALL_ROWS=['crash','ohat','hat','snap','clap','snare','kick'],GREY='#8C8C8C';
const B={cv:null,view:null,dragRange:null,zoom:1,b0:0,gest:0};
function setView(zoom,b0,LB){LB=LB||loopBeats();B.zoom=clamp(zoom,1,Math.max(1,LB*2));B.b0=clamp(b0,0,LB-LB/B.zoom);}
function zoomAt(f,x,w){const LB=loopBeats(),b=B.b0+x/w*LB/B.zoom,z=clamp(B.zoom*f,1,Math.max(1,LB*2));setView(z,b-x/w*LB/z,LB);} // keeps the beat under x in place
function boardLayout(w,H,LB){
  const kind=k=>S.tracks.filter(t=>INST[t.inst].kind===k),drumT=kind('drum'),melT=kind('melodic'),audT=kind('audio');
  const sel=selTrack(),rows=ALL_ROWS.filter(r=>drumT.some(t=>t.notes.some(n=>n.drum===r))||(sel&&sel.extra&&sel.extra.includes(r))),L={w,H,LB};let y=0;
  if(audT.length){const hA=melT.length||rows.length?Math.min(56,H*0.18):H;L.aud={y0:0,h:hA};y=hA;}
  const dh=rows.length?(melT.length?Math.min(rows.length*28,H*0.36):H-y):0;
  if(rows.length)L.drum={y0:H-dh,h:dh,rows,rh:dh/rows.length};
  if(melT.length){
    let lo,hi;
    if(B.dragRange){lo=B.dragRange.lo;hi=B.dragRange.hi;}
    else{
      // each instrument is shown in the same octave, whatever octave it plays in: only the octaves inside one instrument matter
      lo=127;hi=0;for(const t of melT){const evs=t.lenBeats>0?playEvents(t):[];
        if(!evs.length)t.dOff=-12*t.octave;
        else{if(t.dEv!==evs){t.dEv=evs;t.dMed=DSP.median(evs.map(e=>e.n));}const med=t.dMed;if(t.dOff==null||t.dOff%12!==0||Math.abs(med+t.dOff-60)>8)t.dOff=-12*Math.round((med-60)/12);}
        for(const e of evs){const n=e.n+t.dOff;if(n<lo)lo=n;if(n>hi)hi=n;}}
      if(hi<lo){lo=52;hi=72;}else{lo-=2;hi+=2;while(hi-lo<14){lo--;hi++;}}
      // while a track is selected the pitch range only grows, so notes don't jump around under the pointer
      const vr=B.view;if(S.sel!=null&&vr&&vr.key===S.sel&&Math.max(hi,vr.hi)-Math.min(lo,vr.lo)<=48){lo=Math.min(lo,vr.lo);hi=Math.max(hi,vr.hi);}
      B.view=S.sel!=null?{lo,hi,key:S.sel}:null;
    }
    const hM=H-y-dh;L.mel={y0:y,h:hM,lo,hi,rh:hM/(hi-lo+1)};
  }
  return L;
}
function drawBoard(pos,LB){
  const c=B.cv;if(!c)return;
  const dpr=window.devicePixelRatio||1,w=c.clientWidth,H=c.clientHeight;if(!w||!H)return;
  if(c.width!==Math.round(w*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(H*dpr);}
  setView(B.zoom,B.b0,LB);
  const g=c.getContext('2d'),L=boardLayout(w,H,LB),M=L.mel,D=L.drum,A=L.aud,cur=selTrack(),pxb=w*B.zoom/LB,W=w*B.zoom,b0=B.b0,X=b=>(b-b0)*pxb;
  g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,H);g.font='10px "Avenir Next",Avenir,"Segoe UI",system-ui,sans-serif';
  if(R.state==='recording'){g.fillStyle='rgba(255,93,93,.14)';g.fillRect(0,0,w,H);}
  if(M){
    if(M.rh>=4)for(let n=M.lo;n<=M.hi;n++){const y=M.y0+M.h-(n-M.lo+1)*M.rh,pc=((n%12)+12)%12;
      if(pc===1||pc===3||pc===6||pc===8||pc===10){g.fillStyle='rgba(255,255,255,.035)';g.fillRect(0,y,w,M.rh);}}
    const co=cur&&INST[cur.inst].kind==='melodic'?cur.dOff||0:null; // octave numbers belong to the selected instrument
    g.fillStyle='rgba(168,168,168,.7)';for(let n=M.lo;n<=M.hi;n++)if(((n%12)+12)%12===0)g.fillText(co==null?'C':'C'+((n-co)/12-1),4,M.y0+M.h-(n-M.lo)*M.rh-1);
  }
  if(D){g.fillStyle='rgba(255,255,255,.03)';D.rows.forEach((r,i)=>{if(i%2===0)g.fillRect(0,D.y0+i*D.rh,w,D.rh);});
    g.fillStyle='rgba(168,168,168,.7)';D.rows.forEach((r,i)=>g.fillText(ROW_LABEL[r],4,D.y0+i*D.rh+11));}
  if(S.grid>0&&S.grid<1&&pxb*S.grid>=9){g.strokeStyle='rgba(168,168,168,.07)';for(let k=Math.ceil(b0/S.grid);k*S.grid<=LB;k++){const x=Math.round(X(k*S.grid))+0.5;if(x>w)break;g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();}}
  for(let b=Math.ceil(b0-1e-9);b<=LB;b++){const x=Math.round(X(b))+0.5;if(x>w+1)break;g.strokeStyle=b%4===0?'rgba(168,168,168,.5)':'rgba(168,168,168,.16)';g.beginPath();g.moveTo(x,0);g.lineTo(x,H);g.stroke();}
  if(B.zoom>1.01){g.fillStyle='rgba(168,168,168,.7)';for(let b=Math.ceil(b0/4)*4;b<LB;b+=4){const x=X(b);if(x>w)break;g.fillText('bar '+(b/4+1),x+4,11);}}
  g.strokeStyle='rgba(168,168,168,.5)';for(const y of [A&&(M||D)?A.h:0,D&&(M||A)?D.y0:0])if(y){g.beginPath();g.moveTo(0,Math.round(y)+0.5);g.lineTo(w,Math.round(y)+0.5);g.stroke();}
  const anySoloB=S.tracks.some(t=>t.solo),order=S.tracks.filter(t=>t!==cur);if(cur)order.push(cur);
  for(const tr of order){
    const I=INST[tr.inst],off0=!cur&&(tr.mute||(anySoloB&&!tr.solo)),front=(!cur||tr===cur)&&!off0,dim=front?1:off0?0.22:0.38;tr.cv=c;tr.rects=[];g.fillStyle=front?I.color:GREY;
    const evs=tr.lenBeats>0&&I.kind!=='audio'?playEvents(tr):[],tiles=tr.lenBeats>0?Math.ceil(LB/tr.lenBeats-1e-9):0;
    if(I.kind==='audio'){tr.geom={w:W,LB,b0,y0:A.y0,hh:A.y0+A.h};
      if(tr.peaks)for(let j=0;j<tiles;j++){const x0=X(j*tr.lenBeats),tw=tr.lenBeats*pxb,n=tr.peaks.length;g.globalAlpha=(j?0.5:0.95)*dim;
        for(let i=0;i<n;i++){const x=x0+i/n*tw;if(x>w)break;const a=Math.max(1,tr.peaks[i]*A.h*0.9);g.fillRect(x,A.y0+(A.h-a)/2,Math.max(1,tw/n-0.5),a);}}
    }else if(I.kind==='drum'){
      if(!D){tr.geom=null;continue;}
      const G=tr.geom={w:W,LB,b0,y0:D.y0,hh:D.y0+D.h,rh:D.rh,rows:D.rows,allowed:D.rows},bw=clamp(pxb*0.2,6,36),bh=Math.min(G.rh*0.6,34);
      for(let j=0;j<tiles;j++)for(const e of evs){const b=j*tr.lenBeats+e.b;if(b>=LB-1e-9)continue;
        const x=X(b),y=G.y0+G.rows.indexOf(e.drum)*G.rh+(G.rh-bh)/2,ww=e.drum==='ohat'?Math.max(bw,e.d*pxb-1.5):e.drum==='crash'?bw*3:bw;g.globalAlpha=(0.35+0.65*e.v/127)*(j?0.55:1)*dim;
        g.fillRect(x,y,ww,bh);tr.rects.push({x:x-5,y:y-5,w:ww+10,h:bh+10,src:e.src,n:e.n,rs:e.drum==='ohat'});}
    }else{
      const off=tr.dOff||0,G=tr.geom={w:W,LB,b0,y0:M.y0,hh:M.y0+M.h,rh:M.rh,lo:M.lo-off,hi:M.hi-off};
      for(let j=0;j<tiles;j++)for(const e of evs){const b=j*tr.lenBeats+e.b;if(b>=LB-1e-9||e.n<G.lo||e.n>G.hi)continue;
        const x=X(b),y=G.hh-(e.n-G.lo+1)*G.rh,bw=Math.max(4,e.d*pxb-1.5),bh=Math.max(4,G.rh-1);g.globalAlpha=(0.35+0.65*e.v/127)*(j?0.55:1)*dim;
        g.fillRect(x,y,bw,bh);tr.rects.push({x:x-3,y:y-4,w:bw+6,h:bh+8,src:e.src,n:e.n,mel:true});}
    }
  }
  g.globalAlpha=1;
  if(D){g.fillStyle='rgba(235,235,235,.75)';D.rows.forEach((r,i)=>g.fillText(ROW_LABEL[r],4,D.y0+i*D.rh+11));}
  if(drag&&drag.moved){for(const q of drag.tr.rects)if(q.src===drag.n){g.strokeStyle='#fff';g.lineWidth=1.5;g.strokeRect(q.x+2,q.y+3,q.w-4,q.h-6);g.lineWidth=1;}}
  if(pos>=0){const x=X(pos);g.fillStyle='#FFB43A';g.fillRect(x-1,0,2,H);}
}

/* ---------- editing notes of the selected track ---------- */
function laneXY(tr,e){const r=B.cv.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
function laneHit(tr,e){const [x,y]=laneXY(tr,e);
  for(let i=tr.rects.length-1;i>=0;i--){const q=tr.rects[i];if(x>=q.x&&x<=q.x+q.w&&y>=q.y&&y<=q.y+q.h)return {src:q.src,n:q.n,edge:!!(q.mel||q.rs)&&q.w>20&&x>q.x+q.w-9};}
  return null;}
function drumAt(G,y){ // the drum row under the pointer, kept to the drums this track can play
  const i=clamp(Math.floor((y-G.y0)/G.rh),0,G.rows.length-1);let best=null,bd=99;
  for(const r of G.allowed){const d=Math.abs(G.rows.indexOf(r)-i);if(d<bd){bd=d;best=r;}}return best;}
function selectTrack(tr){ // null, or the track that is already selected, goes back to the view of everything
  if(R.state!=='idle')return;for(const t of S.tracks)if(t!==tr)t.extra=null;S.sel=tr?tr.id:null;pruneEmpty();invalidate();statusLock=0;if(tr)tr.dragged=performance.now();renderTracks();}
function addNoteAt(tr,e){
  const [x,y]=laneXY(tr,e),G=tr.geom,I=INST[tr.inst];if(!G||y<G.y0||y>G.hh)return;
  keep(tr);if(!tr.lenBeats)tr.lenBeats=G.LB;
  let b=G.b0+x/G.w*G.LB;if(S.grid>0)b=Math.floor(b/S.grid+1e-6)*S.grid;
  const n=I.kind==='drum'?{t:b%tr.lenBeats,drum:drumAt(G,y),v:100}
    :{t:b%tr.lenBeats,d:S.grid>0?Math.max(S.grid,0.5):0.5,p:clamp(G.lo+Math.floor((G.hh-y)/G.rh),0,127)-12*tr.octave,v:100};
  tr.notes.push(n);tr.notes.sort((a,b2)=>a.t-b2.t);invalidate();audition(tr,n);
}
function wireBoard(cv){
  B.cv=cv;cv.style.touchAction='none';
  const pts=new Map();let pan=null,pinch=null;
  const endDrag=()=>{if(!drag)return;const d=drag,tr=d.tr;drag=null;B.dragRange=null;
    if(d.moved){tr.dragged=performance.now();if(d.n.drum&&d.n.drum!==d.drum0)learn(tr,d.n);invalidate();audition(tr,d.n);}};
  cv.addEventListener('pointerdown',e=>{
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});try{cv.setPointerCapture(e.pointerId);}catch(err){}
    if(pts.size===2){ // two fingers: pinch to zoom, slide to scroll
      endDrag();pan=null;const [a,b]=[...pts.values()],r=cv.getBoundingClientRect(),mx=(a.x+b.x)/2-r.left;
      pinch={d0:Math.max(20,Math.abs(a.x-b.x)),z0:B.zoom,beat:B.b0+mx/r.width*loopBeats()/B.zoom};return;}
    if(pts.size>2)return;
    const tr=selTrack(),q=tr&&INST[tr.inst].kind!=='audio'?laneHit(tr,e):null;
    if(q){drag={tr,n:q.src,x0:e.clientX,y0:e.clientY,t0:q.src.t,d0:q.src.d??0.5,p0:q.n,drum0:q.src.drum,resize:q.edge,moved:false};
      if(INST[tr.inst].kind==='melodic')B.dragRange={lo:tr.geom.lo+(tr.dOff||0),hi:tr.geom.hi+(tr.dOff||0)};}
    else pan={x0:e.clientX,b0:B.b0,moved:false}; // dragging the empty board scrolls it
  });
  cv.addEventListener('pointermove',e=>{
    if(pts.has(e.pointerId))pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&pts.size>=2){const [a,b]=[...pts.values()],r=cv.getBoundingClientRect(),mx=(a.x+b.x)/2-r.left,LB=loopBeats();
      const z=clamp(pinch.z0*Math.max(20,Math.abs(a.x-b.x))/pinch.d0,1,Math.max(1,LB*2));setView(z,pinch.beat-mx/r.width*LB/z,LB);B.gest=performance.now();return;}
    if(pan){const dx=e.clientX-pan.x0;if(!pan.moved&&Math.abs(dx)<5)return;pan.moved=true;B.gest=performance.now();
      setView(B.zoom,pan.b0-dx/cv.clientWidth*loopBeats()/B.zoom);cv.style.cursor='grabbing';return;}
    const tr=drag?drag.tr:selTrack();
    if(!drag){if(tr&&INST[tr.inst].kind!=='audio'){const q=laneHit(tr,e);cv.style.cursor=q?(q.edge?'ew-resize':'grab'):'crosshair';}else cv.style.cursor='pointer';return;}
    const I=INST[tr.inst],dx=e.clientX-drag.x0,dy=e.clientY-drag.y0;
    if(!drag.moved){if(Math.hypot(dx,dy)<4)return;drag.moved=true;keep(tr);}
    const G=tr.geom,n=drag.n,db=dx/G.w*G.LB,len=tr.lenBeats;
    if(drag.resize){let d=drag.d0+db;if(S.grid>0)d=Math.round(d/S.grid)*S.grid;n.d=Math.max(S.grid>0?S.grid:0.1,d);}
    else{
      let t=drag.t0+db;if(S.grid>0)t=DSP.quantize(t,S.grid);t=((t%len)+len)%len;n.t=t>len-1e-6?0:t;
      if(I.kind==='drum')n.drum=drumAt(G,laneXY(tr,e)[1]);
      else n.p=clamp(drag.p0-Math.round(dy/G.rh),G.lo,G.hi)-12*tr.octave;
    }
    softInvalidate(tr);
  });
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch=null;if(!pts.size){pan=null;endDrag();}};
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{ // pinch or ctrl + wheel zooms, any other wheel or swipe scrolls sideways
    e.preventDefault();const r=cv.getBoundingClientRect();
    if(e.ctrlKey||e.metaKey)zoomAt(Math.exp(-e.deltaY*0.01),e.clientX-r.left,r.width);
    else{const d=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;setView(B.zoom,B.b0+d/r.width*loopBeats()/B.zoom);}
  },{passive:false});
  const quiet=()=>performance.now()-B.gest<350;
  cv.addEventListener('click',e=>{
    if(quiet())return;const tr=selTrack();
    if(!tr){for(let i=S.tracks.length-1;i>=0;i--)if(S.tracks[i].rects&&laneHit(S.tracks[i],e)){selectTrack(S.tracks[i]);break;}return;} // in the overview, a tap on a note picks its instrument
  });
  cv.addEventListener('dblclick',e=>{
    const tr=selTrack();if(quiet()||!tr||INST[tr.inst].kind==='audio')return;
    const q=laneHit(tr,e);if(q){keep(tr);tr.notes=tr.notes.filter(z=>z!==q.src);invalidate();}else addNoteAt(tr,e);
  });
}

/* ---------- instrument bar and the panel of the selected track ---------- */
const PICK_NOTE={kit:'Kick, snare, hi-hat, open hat',toms:'Pitched drum hits',bass:'Synth, sub, 808, Reese, acid',synth1:'Supersaw, square lead',synth2:'Pluck, FM bell',epiano:'Electric piano, piano, lo-fi, organ',pad:'Warm pad, strings',brass:'Synth brass, trumpet',voice:'Your voice as audio'};
const FAMILY={bass:['bass','sub','bass808','reese','acid'],synth1:['synth1','sqlead'],synth2:['synth2','bell'],epiano:['epiano','piano','lofi','organ'],pad:['pad','strings'],brass:['brass','trumpet']};
const chipOf=tr=>{for(const k in FAMILY)if(FAMILY[k].includes(tr.inst))return k;return tr.inst;};
const hpFromX=x=>x<=0.001?0:Math.round(20*Math.pow(50,x)),xFromHp=v=>v<=20?0:Math.log(v/20)/Math.log(50);
const lpFromX=x=>x>=0.999?20000:Math.round(500*Math.pow(40,x)),xFromLp=v=>v>=20000?1:Math.log(v/500)/Math.log(40);
const fmtHz=v=>v>=1000?(v/1000).toFixed(v>=10000?0:1)+' kHz':Math.round(v)+' Hz';
function eqPanel(tr){
  const oHp=h('output'),oLp=h('output'),oRv=h('output');
  const show=()=>{oHp.textContent=tr.eq.hp>20?fmtHz(tr.eq.hp):'Off';oLp.textContent=tr.eq.lp<20000?fmtHz(tr.eq.lp):'Off';oRv.textContent=Math.round(tr.rev*100)+'%';};
  const sl=(label,val,fn)=>h('input',{type:'range',min:0,max:1,step:0.005,value:val,'aria-label':label,oninput:e=>{fn(+e.target.value);applyMix(tr);show();save();}});
  show();
  return h('div',{className:'eq'},
    h('span',{},'Low cut'),sl('Low cut',xFromHp(tr.eq.hp),x=>tr.eq.hp=hpFromX(x)),oHp,
    h('span',{},'High cut'),sl('High cut',xFromLp(tr.eq.lp),x=>tr.eq.lp=lpFromX(x)),oLp,
    h('span',{},'Reverb'),sl('Reverb',tr.rev,x=>tr.rev=Math.round(x*100)/100),oRv,
    h('button',{className:'sm',textContent:'Back to the '+INST[tr.inst].name.toLowerCase()+' default',onclick:()=>{mixDefaults(tr);applyMix(tr);save();renderTracks();}}));
}
function chipLabel(tr){const k=chipOf(tr),same=S.tracks.filter(t=>chipOf(t)===k),base=INST[k].chip||INST[k].name;return same.length>1?base+' '+(same.indexOf(tr)+1):base;}
function wireChip(b,tr){ // tap: select, or mute the selected one; hold (or right-click): solo
  let timer=0,held=false;
  const solo=()=>{held=true;tr.solo=!tr.solo;renderTracks();setStatus(tr.solo?chipLabel(tr)+' solo.':'Solo off.',2500);};
  b.addEventListener('pointerdown',()=>{held=false;clearTimeout(timer);timer=setTimeout(solo,450);});
  for(const ev of ['pointerup','pointerleave','pointercancel'])b.addEventListener(ev,()=>clearTimeout(timer));
  b.addEventListener('contextmenu',e=>{e.preventDefault();if(!held){clearTimeout(timer);solo();}});
  b.onclick=e=>{clearTimeout(timer);if(held){held=false;return;}
    if(e.shiftKey){solo();held=false;return;}
    if(selTrack()===tr){tr.mute=!tr.mute;save();renderTracks();setStatus(tr.mute?chipLabel(tr)+' muted. Tap it again to hear it.':chipLabel(tr)+' back on.',2500);}
    else selectTrack(tr);};
}
function openPicker(){if(R.state!=='idle')return;$('#picker').showModal();}
function renderTracks(){
  const bar=$('#chips'),cur=selTrack(),anySolo=S.tracks.some(t=>t.solo);bar.textContent='';
  if(S.tracks.length)bar.append(h('button',{className:'chip all','aria-pressed':String(!cur),title:'Show all instruments',textContent:'All',onclick:()=>selectTrack(null)}));
  for(const tr of S.tracks){const k=chipOf(tr),on=tr===cur;
    const b=h('button',{className:'chip has'+(on?' on':'')+(tr.mute?' muted':'')+(tr.solo?' solo':'')+(anySolo&&!tr.solo?' quiet':''),style:'--c:'+INST[k].color,
      'aria-pressed':String(on),title:on?'Tap to mute or unmute. Hold to solo.':'Tap to bring it to the front. Hold to solo.'},chipLabel(tr));
    if(tr.solo)b.append(h('span',{className:'badge'},'S'));
    wireChip(b,tr);bar.append(b);}
  const on=bar.querySelector('.on');if(on&&on.scrollIntoView)try{on.scrollIntoView({block:'nearest',inline:'nearest'});}catch(e){}
  $('#empty').classList.toggle('hide',S.tracks.length>0);$('#boardBox').classList.toggle('hide',!S.tracks.length);
  const box=$('#panel');box.textContent='';box.classList.toggle('hide',!cur);
  if(cur){
    const tr=cur,I=INST[tr.inst];box.style.setProperty('--c',I.color);
    box.append(h('div',{className:'row'},h('div',{className:'tn'},chipLabel(tr),h('small',{},tr.mute?'Muted. Tap its name at the top to unmute.':tr.solo?'Solo. Hold its name at the top to end it.':'Next take goes here')),
      h('input',{type:'range',min:0,max:1,step:0.01,value:tr.vol,'aria-label':'Volume',oninput:e=>{tr.vol=+e.target.value;applyMix(tr);save();}})));
    const row3=h('div',{className:'row'}),extraRows=[];
    if(I.kind==='melodic'){
      const fam=FAMILY[chipOf(tr)];
      if(fam){const s=h('select',{'aria-label':'Sound',onchange:e=>setInst(tr,e.target.value)});
        for(const k of fam)s.append(h('option',{value:k,textContent:INST[k].name,selected:k===tr.inst}));row3.append(s);}
      const oct=d=>()=>{tr.octave=clamp(tr.octave+d,-3,3);invalidate();renderTracks();};
      row3.append(h('button',{className:'sm',textContent:'−','aria-label':'Octave down',onclick:oct(-1)}),h('span',{className:'oct'},'Oct '+(tr.octave>0?'+':'')+tr.octave),h('button',{className:'sm',textContent:'+','aria-label':'Octave up',onclick:oct(1)}));
      if(I.env)row3.append(h('button',{className:'sm',textContent:'Dynamics',title:'Long notes follow how loud you sang them, such as a slow fade-in','aria-pressed':String(tr.dyn!==false),onclick:e=>{tr.dyn=tr.dyn===false;e.target.setAttribute('aria-pressed',tr.dyn);invalidate();}}));
    }else if(I.kind==='drum'){
      const s=h('select',{'aria-label':'Drum kit',onchange:e=>{tr.kit=e.target.value;save();renderTracks();preview(tr);}});
      for(const k in KIT_NAMES)s.append(h('option',{value:k,textContent:KIT_NAMES[k],selected:k===tr.kit}));
      row3.append(s);
      const present=ALL_ROWS.filter(r=>tr.notes.some(n=>n.drum===r)||(tr.extra&&tr.extra.includes(r))).reverse(),snd=h('div',{className:'row snds'},h('span',{className:'oct'},'Sounds'));
      for(const r of present){const sel=h('select',{'aria-label':'Sound of the '+ROW_LABEL[r]+' row',onchange:e=>setRowSound(tr,r,e.target.value)});
        for(const k of ALL_ROWS.slice().reverse())sel.append(h('option',{value:k,textContent:DRUM_NAME[k],selected:k===r}));snd.append(sel);}
      const missing=ALL_ROWS.slice().reverse().filter(r=>!present.includes(r));
      if(missing.length){const add=h('select',{'aria-label':'Add a drum sound',onchange:e=>{if(!e.target.value)return;tr.extra=(tr.extra||[]).concat(e.target.value);renderTracks();setStatus('Double-tap the new row to add hits, or drag hits into it.',4000);}},
        h('option',{value:'',textContent:'+ Sound'}));for(const k of missing)add.append(h('option',{value:k,textContent:DRUM_NAME[k]}));snd.append(add);}
      extraRows.push(snd);
    }
    row3.append(
      h('button',{className:'sm',textContent:'Effects','aria-pressed':String(tr.eqOpen),title:'Low cut, high cut and reverb for this instrument',onclick:()=>{tr.eqOpen=!tr.eqOpen;renderTracks();}}),
      h('button',{className:'sm',textContent:'Clear',title:'Empty this track',onclick:()=>{if(!hasContent(tr))return;keep(tr);tr.notes=[];tr.audio=null;tr.peaks=null;tr.buf=null;tr.lenBeats=0;invalidate();renderTracks();setStatus('Track cleared. “Undo last change” brings it back.',4000);}}));
    if(I.kind==='audio'&&tr.audio)row3.append(h('button',{className:'sm',textContent:'WAV',title:'Export this voice track',onclick:()=>download(DSP.encodeWav([tr.audio.data],tr.audio.sr),'melodeas-voice-'+stamp()+'.wav','audio/wav')}));
    row3.append(h('button',{className:'sm',textContent:'Delete',onclick:()=>removeTrack(tr)}));
    box.append(row3,...extraRows);if(tr.eqOpen)box.append(eqPanel(tr));
  }
  idleStatus();
}

/* ---------- controls ---------- */
function updateTransportUI(){const p=$('#play');p.textContent=T.playing?'Stop':'Play';p.setAttribute('aria-pressed',T.playing);}
function lockControls(){const busy=R.state!=='idle';for(const id of ['bpmDown','bpmUp','tap','bars','calib'])$('#'+id).disabled=busy;$('#rec').dataset.state=R.state;}
function updateKeyLabel(){const k=$('#key');if(!k.options.length)return;$('#keyF').classList.toggle('hide',S.scale==='off');
  k.options[0].textContent=S.scale!=='off'&&S.keyRoot==='auto'&&S.tracks.some(t=>INST[t.inst].kind==='melodic'&&t.notes.length)?'Auto ('+NOTE_NAMES[currentRoot()]+')':'Auto';}
function syncControls(){
  showBpm(S.bpm);$('#bars').value=S.bars;$('#grid').value=String(S.grid);if($('#grid').selectedIndex<0)$('#grid').value='0.25';
  $('#scale').value=S.scale;$('#key').value=String(S.keyRoot);$('#click').setAttribute('aria-pressed',S.click);$('#sens').value=String(S.sens);$('#duck').value=String(S.duck);
  $('#lat').value=S.latencyMs==null?'':S.latencyMs;
  document.querySelectorAll('[data-listen]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.listen===S.listen));
  document.querySelectorAll('[data-first]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.first===S.firstTake));
  updateKeyLabel();
}
function init(){
  const key=$('#key');key.append(h('option',{value:'auto',textContent:'Auto'}));NOTE_NAMES.forEach((n,i)=>key.append(h('option',{value:String(i),textContent:n})));
  wireBoard($('#board'));
  $('#plusBtn').onclick=openPicker;
  $('#saveTake').onclick=()=>{if(!lastRaw){setStatus('Record a take first.',3000);return;}
    download(DSP.encodeWav([lastRaw.x],lastRaw.sr),'melodeas-take-'+lastRaw.name.toLowerCase().replace(/\W+/g,'-')+'-'+stamp()+'.wav','audio/wav');setStatus('Last take saved as a WAV file.',3000);};
  $('#forget').onclick=()=>{S.learned=[];save();setStatus('Drum corrections forgotten.',3000);};
  const pk=$('#pickList');for(const k of CHIPS)pk.append(h('button',{className:'pick',style:'--c:'+INST[k].color,onclick:()=>{$('#picker').close();if(R.state==='idle')addTrack(k);}},
    h('b',{},INST[k].chip||INST[k].name),h('small',{},PICK_NOTE[k]||'')));
  // leaving the app (home button, app switcher, closing the tab) stops the sound and the microphone
  const quiet=()=>{if(R.state==='armed'||R.state==='recording')cancelRec('Recording stopped because the app went to the background.');
    if(T.playing)stopTransport();
    if(micStream){micStream.getTracks().forEach(t=>t.stop());try{micSrc.disconnect();}catch(e){}micStream=null;}
    if(ctx&&ctx.state==='running')ctx.suspend().catch(()=>{});};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)quiet();});window.addEventListener('pagehide',quiet);
  try{const s=localStorage.getItem('melodeas.v1');if(s)restore(JSON.parse(s));}catch(e){}
  syncControls();renderTracks(); // voice tracks wait for their audio before empty tracks are tidied away
  Promise.race([loadAudio(),sleep(2000)]).then(()=>{pruneEmpty();invalidate();renderTracks();});

  const menu=$('#menu'),sheet=$('#settings');
  $('#menuBtn').onclick=()=>menu.showModal();$('#loopBtn').onclick=()=>sheet.showModal();
  $('#openSettings').onclick=()=>{menu.close();sheet.showModal();};
  document.querySelectorAll('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d)d.close();});d.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>d.close());});
  menu.addEventListener('click',e=>{const b=e.target.closest('.mi');if(b&&b.id!=='openSettings')menu.close();});
  $('#rec').onclick=recPress;
  $('#play').onclick=async()=>{
    if(T.playing){cancelRec();stopTransport();return;}
    if(R.state!=='idle')return;
    await ensureAudio();warmFrozen();await Promise.race([sleep(60).then(()=>fzChain),sleep(1500)]);
    if(T.playing||R.state!=='idle')return;
    startTransport(ctx.currentTime+0.08,ctx.currentTime+0.08);
  };
  $('#bpmDown').onclick=()=>setBpm(S.bpm-1);$('#bpmUp').onclick=()=>setBpm(S.bpm+1);
  let taps=[];$('#tap').onclick=()=>{const n=performance.now();taps=taps.filter(t=>n-t<2500);taps.push(n);
    if(taps.length>=2){const k=Math.min(taps.length-1,4);setBpm(60000*k/(taps[taps.length-1]-taps[taps.length-1-k]));}};
  $('#bars').onchange=e=>{S.bars=+e.target.value;invalidate();};
  $('#grid').onchange=e=>{S.grid=+e.target.value;invalidate();};
  $('#scale').onchange=e=>{S.scale=e.target.value;invalidate();};
  $('#key').onchange=e=>{S.keyRoot=e.target.value==='auto'?'auto':+e.target.value;invalidate();};
  $('#click').onclick=e=>{S.click=!S.click;e.target.setAttribute('aria-pressed',S.click);save();};
  $('#sens').onchange=e=>{S.sens=+e.target.value;save();};$('#duck').onchange=e=>{S.duck=+e.target.value;save();};
  document.querySelectorAll('[data-listen]').forEach(b=>b.onclick=async()=>{if(R.state!=='idle')return;S.listen=b.dataset.listen;syncControls();save();
    setStatus(S.listen==='speakers'?'Speakers: the loop turns down while you record, and echo cancelling keeps it out of the mic.':'Headphones: the cleanest signal, so the best detection.',5000);
    if(micStream)try{await ensureMic();}catch(e){}});
  document.querySelectorAll('[data-first]').forEach(b=>b.onclick=()=>{S.firstTake=b.dataset.first;syncControls();save();
    setStatus(S.firstTake==='free'?'No click on the first take. Press record, perform one round, and press the button again on the first beat of the next round. The tempo comes from that.':'The first take follows the click, after a one-bar count-in.',8000);});
  $('#lat').onchange=e=>{const v=e.target.value;S.latencyMs=v===''?null:clamp(+v,0,500);save();};
  $('#latAuto').onclick=()=>{S.latencyMs=null;$('#lat').value='';save();};
  $('#calib').onclick=calibrate;
  $('#micOn').onclick=async()=>{try{await ensureAudio();await ensureMic();}catch(e){setStatus(micError(e),8000);}};
  $('#expMidi').onclick=exportMidi;$('#expMix').onclick=()=>exportMix().catch(e=>setStatus('Could not render the mix: '+e.message,6000));
  $('#saveProj').onclick=()=>download(JSON.stringify(snapshot(true)),'melodeas-project-'+stamp()+'.json','application/json');
  $('#openProj').onclick=()=>$('#file').click();
  $('#file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{cancelRec();if(T.playing)stopTransport();restore(JSON.parse(await f.text()));syncControls();invalidate();renderTracks();setStatus('Project opened.',3000);}
    catch(err){setStatus('That file is not a Melodeas project.',5000);}e.target.value='';};
  $('#undo').onclick=()=>{const tr=S.tracks.find(t=>t.id===S.lastTake);if(!tr||!tr.prev){setStatus('Nothing to undo.',3000);return;}
    const p=tr.prev;tr.prev={notes:tr.notes,audio:tr.audio,lenBeats:tr.lenBeats,peaks:tr.peaks};Object.assign(tr,p);tr.buf=null;invalidate();renderTracks();setStatus('Went back one step on '+INST[tr.inst].name.toLowerCase()+'.',3000);};
  $('#clearAll').onclick=()=>{if(!S.tracks.length||!window.confirm('Remove every track?'))return;cancelRec();if(T.playing)stopTransport();S.tracks.forEach(dropTrackNodes);S.tracks=[];S.sel=null;invalidate();renderTracks();};
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)&&e.code==='Space')return;if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if(e.code==='Space'){e.preventDefault();$('#play').click();}else if(e.key==='r'||e.key==='R')recPress();});
  requestAnimationFrame(frame);
}

const RING=289,meterBuf=new Float32Array(1024);
let warmN=0;
function frame(){
  requestAnimationFrame(frame);if(ctx&&++warmN%20===0)warmFrozen();
  const LB=loopBeats(),dots=$('#beats').children;let pos=-1,beat=-1e9;
  if(ctx&&T.playing){beat=(ctx.currentTime-(ctx.outputLatency||0)-T.t0)/spb();if(beat>=0)pos=beat%LB;}
  if(ctx&&R.state==='armed'&&ctx.currentTime>=R.tStart){R.state='recording';lockControls();}
  let frac=pos>=0?pos/LB:0;const dot=$('#recdot');let dotText='';
  if(R.state==='armed'){
    const left=(R.tStart-ctx.currentTime)/spb();dotText=String(Math.max(1,Math.ceil(left)));
    st(beat<0?'Count-in… then '+INST[R.track.inst].name.toLowerCase()+' for '+S.bars+(S.bars===1?' bar.':' bars.'):'Recording starts at the top of the loop.');
  }else if(R.state==='recording'){
    if(R.free){const s=ctx.currentTime-R.tStart;frac=(s%4)/4;st('Recording, '+s.toFixed(1)+' s. Press the button again on the first beat of the next round.');}
    else{const b=(ctx.currentTime-R.tStart)/(60/R.bpm);frac=clamp(b/R.lenBeats,0,1);st('Recording '+INST[R.track.inst].name.toLowerCase()+': bar '+Math.min(S.bars,Math.floor(b/4)+1)+' of '+S.bars+'.');}
  }else if(R.state==='analysing')st('Listening back…');
  else idleStatus();
  if(dot.textContent!==dotText)dot.textContent=dotText;
  $('#ring').style.strokeDashoffset=RING*(1-frac);
  const bi=T.playing&&beat>-4?((Math.floor(beat)%4)+4)%4:-1;
  for(let i=0;i<4;i++)dots[i].className=i===bi?(i===0?'on one':'on'):'';
  drawBoard(pos,LB);
  if(analyser&&$('#settings').open){analyser.getFloatTimeDomainData(meterBuf);let m=0;for(let i=0;i<meterBuf.length;i++){const a=Math.abs(meterBuf[i]);if(a>m)m=a;}$('#meter').value=m;}
}

window.melodeas={activeSrc,warmFrozen,get fzChain(){return fzChain;},S,T,R,DSP,INST,KITS,LVL,commitTake,addTrack,loopEvents,songForMidi,exportMix,renderMix,invalidate,renderTracks,playNote,playDrum,makeFX,makeChain,newTrack,
  get ctx(){return ctx;},get musicBus(){return musicBus;},get capNode(){return capNode;},get mode(){return {worklet:capViaWorklet,worker:!!worker};}};
init();
})();

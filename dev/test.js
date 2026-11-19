const D = require('./dsp.js')();
const sr = 48000;
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
function biquadBand(x, f0, q, type) { // RBJ
  const w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w); let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al; const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y;
}
function burst(kind, amp) {
  const n = Math.round(sr * 0.25), x = new Float32Array(n);
  if (kind === 'kick') { // "p"/"b": low thump + short low noise
    const nz = new Float32Array(n); for (let i = 0; i < n; i++) nz[i] = rnd() * Math.exp(-i / (sr * 0.012));
    const lp = biquadBand(nz, 500, 0.7, 'lp');
    for (let i = 0; i < n; i++) x[i] = amp * (0.8 * Math.sin(2 * Math.PI * 110 * i / sr) * Math.exp(-i / (sr * 0.05)) + 1.5 * lp[i]);
  } else if (kind === 'snare') { // "k": mid noise
    const nz = new Float32Array(n); for (let i = 0; i < n; i++) nz[i] = rnd() * Math.exp(-i / (sr * 0.03));
    const bp = biquadBand(nz, 2800, 1.2, 'bp'); for (let i = 0; i < n; i++) x[i] = amp * 2 * bp[i];
  } else { // "ts": bright noise; 'ohat' rings longer
    const tau = kind === 'ohat' ? 0.25 : 0.02;
    const nz = new Float32Array(n); for (let i = 0; i < n; i++) nz[i] = rnd() * Math.exp(-i / (sr * tau));
    const hp = biquadBand(nz, 6500, 0.7, 'hp'); for (let i = 0; i < n; i++) x[i] = amp * hp[i];
  }
  return x;
}
function mix(len, events) {
  const x = new Float32Array(Math.round(len * sr)); for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.002;
  for (const e of events) { const b = burst(e.k, e.a), o = Math.round(e.t * sr); for (let i = 0; i < b.length && o + i < x.length; i++) x[o + i] += b[i]; }
  return x;
}
let fails = 0; const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };

// --- 1. kick + snare pattern at 100 bpm, 16ths = 0.15 s
{
  const ev = [{ t: 0.2, k: 'kick', a: 0.6 }, { t: 0.5, k: 'kick', a: 0.3 }, { t: 0.8, k: 'snare', a: 0.6 }, { t: 1.25, k: 'kick', a: 0.6 }, { t: 1.4, k: 'kick', a: 0.5 },
  { t: 2.0, k: 'snare', a: 0.5 }, { t: 2.3, k: 'snare', a: 0.2 }, { t: 2.6, k: 'kick', a: 0.6 }, { t: 3.2, k: 'snare', a: 0.6 }];
  const r = D.analyse({ mode: 'kicksnare', x: mix(4, ev), sr, sens: 1 }).events;
  check('kicksnare count', r.length === ev.length, `${r.length}/${ev.length}`);
  let maxErr = 0, wrong = 0; r.forEach((h, i) => { if (!ev[i]) return; maxErr = Math.max(maxErr, Math.abs(h.t - ev[i].t)); if (h.drum !== ev[i].k) wrong++; });
  check('kicksnare timing <12ms', maxErr < 0.012, (maxErr * 1000).toFixed(1) + ' ms; signed: ' + r.map((h, i) => ((h.t - ev[i].t) * 1000).toFixed(1)).join(' '));
  check('kicksnare labels', wrong === 0, r.map(h => h.drum[0]).join(''));
  check('velocity follows loudness', r[1].v < r[0].v && r[6].v < r[5].v, r.map(h => h.v).join(' '));
}
// --- 2. full kit
{
  const ev = []; const pat = ['kick', 'hat', 'snare', 'hat', 'kick', 'kick', 'snare', 'hat'];
  for (let i = 0; i < 16; i++) ev.push({ t: 0.15 + i * 0.25, k: pat[i % 8], a: 0.5 });
  const r = D.analyse({ mode: 'kit', x: mix(4.5, ev), sr, sens: 1 }).events;
  check('kit count', r.length === 16, `${r.length}`);
  check('kit labels', r.every((h, i) => ev[i] && h.drum === ev[i].k), r.map(h => h.drum[0]).join(''));
}
// --- 3. hats, with open hats
{
  const ev = [{ t: 0.2, k: 'hat', a: 0.5 }, { t: 0.45, k: 'hat', a: 0.3 }, { t: 0.7, k: 'ohat', a: 0.5 }, { t: 1.2, k: 'hat', a: 0.5 }, { t: 1.45, k: 'hat', a: 0.5 }];
  const r = D.analyse({ mode: 'hat', x: mix(2, ev), sr, sens: 1 }).events;
  check('hat count + open hat', r.length === 5 && r[2].drum === 'ohat' && r[0].drum === 'hat', r.map(h => h.drum + ':' + h.d.toFixed(2)).join(' '));
}
// --- 4. only kicks on a kick+snare track; silence
{
  const r = D.analyse({ mode: 'kicksnare', x: mix(2, [{ t: 0.3, k: 'kick', a: 0.5 }, { t: 0.8, k: 'kick', a: 0.5 }, { t: 1.3, k: 'kick', a: 0.4 }]), sr, sens: 1 }).events;
  check('only kicks', r.length === 3 && r.every(h => h.drum === 'kick'), r.map(h => h.drum).join(' '));
  check('silence gives nothing (drums)', D.analyse({ mode: 'kit', x: mix(2, []), sr, sens: 1 }).events.length === 0);
  check('silence gives nothing (melody)', D.analyse({ mode: 'melodic', x: mix(2, []), sr, sens: 1 }).events.length === 0);
}

// --- 4a. one Drums instrument (mode 'kit') works out by itself which drums are in a take
{
  const one=k=>D.analyse({mode:'kit',x:mix(2,[{t:0.3,k,a:0.5},{t:0.8,k,a:0.5},{t:1.3,k,a:0.4}]),sr,sens:1}).events;
  check('drums: only "p" -> kick',one('kick').every(h=>h.drum==='kick'),one('kick').map(h=>h.drum).join(' '));
  check('drums: only "ts" -> hat',one('hat').every(h=>h.drum==='hat'),one('hat').map(h=>h.drum).join(' '));
  const ev=[{t:0.2,k:'kick',a:0.5},{t:0.45,k:'hat',a:0.4},{t:0.7,k:'snare',a:0.5},{t:0.95,k:'ohat',a:0.5},{t:1.5,k:'kick',a:0.5}];
  const r=D.analyse({mode:'kit',x:mix(2.4,ev),sr,sens:1}).events;
  check('drums: kick, hat, snare, open hat in one take',r.length===5&&r.every((h,i)=>h.drum===ev[i].k),r.map(h=>h.drum+':'+h.d.toFixed(2)).join(' '));
  check('drums: open hat keeps its length',r[3]&&r[3].d>0.25,r[3]&&r[3].d.toFixed(2));
  const x=place(2.4,[[0.3,pBurst(0.5)],[0.8,pBurst(0.5)],[1.3,pBurst(0.4)],[1.8,pBurst(0.5)]]);
  const rp=D.analyse({mode:'kit',x,sr,sens:1}).events;
  check('drums: breathy "p" only -> kick (not hat)',rp.every(h=>h.drum!=='hat'&&h.drum!=='ohat'),rp.map(h=>h.drum).join(' '));
}

// --- 4a2. other ways to play drums: a hand clap, a finger snap, a deep voiced "boom"
{
  const clap=amp=>{const n=Math.round(sr*0.2),nz=new Float32Array(n);for(let i=0;i<n;i++){const t=i/sr,e=Math.exp(-t/0.004)+Math.exp(-Math.max(0,t-0.011)/0.004)*(t>0.011)+Math.exp(-Math.max(0,t-0.022)/0.03)*(t>0.022);nz[i]=rnd()*e;}
    const bp=biquadBand(nz,1400,0.9,'bp');for(let i=0;i<n;i++)bp[i]*=amp*2;return bp;};
  const snap=amp=>{const n=Math.round(sr*0.1),nz=new Float32Array(n);for(let i=0;i<n;i++)nz[i]=rnd()*Math.exp(-i/(sr*0.006));const bp=biquadBand(nz,2800,1.5,'bp');for(let i=0;i<n;i++)bp[i]*=amp*2.5;return bp;};
  const boom=amp=>{const n=Math.round(sr*0.3),x=new Float32Array(n);for(let i=0;i<n;i++){const t=i/sr,e=Math.min(1,t/0.01)*Math.exp(-t/0.12);let v=0;for(let h=1;h<=8;h++)v+=Math.sin(2*Math.PI*110*h*t)/h;x[i]=amp*e*v;}return x;};
  const r=D.analyse({mode:'kit',x:place(2.4,[[0.2,boom(0.4)],[0.7,clap(0.5)],[1.2,boom(0.4)],[1.7,clap(0.5)]]),sr,sens:1}).events;
  check('drums: deep "boom" = kick, hand clap = snare',r.length===4&&r.map(h=>h.drum).join()==='kick,snare,kick,snare',r.map(h=>h.drum+'@'+Math.round(2**h.f)+'Hz').join(' '));
  const r2=D.analyse({mode:'kit',x:place(2.4,[[0.2,boom(0.4)],[0.7,snap(0.5)],[1.2,boom(0.4)],[1.7,snap(0.5)]]),sr,sens:1}).events;
  check('drums: finger snap is found and is not kick',r2.length===4&&r2[1].drum!=='kick'&&r2[3].drum!=='kick',r2.map(h=>h.drum+'@'+Math.round(2**h.f)+'Hz').join(' '));
}

// --- 4b. a breathy "p": mostly low thump plus some hiss. Used to come out as snare.
function pBurst(amp){const n=Math.round(sr*0.2),x=new Float32Array(n),nz=new Float32Array(n);
  for(let i=0;i<n;i++)nz[i]=rnd()*Math.exp(-i/(sr*0.015));
  const lo=biquadBand(nz,700,0.7,'lp'),hi=biquadBand(nz,3000,0.7,'hp');
  for(let i=0;i<n;i++)x[i]=amp*(2.2*lo[i]+0.5*hi[i]);return x;}
function place(len,list){const x=new Float32Array(Math.round(len*sr));for(let i=0;i<x.length;i++)x[i]=rnd()*0.002;
  for(const [tt,b] of list){const o=Math.round(tt*sr);for(let i=0;i<b.length&&o+i<x.length;i++)x[o+i]+=b[i];}return x;}
{
  const x=place(2.4,[[0.3,pBurst(0.5)],[0.8,pBurst(0.5)],[1.3,pBurst(0.4)],[1.8,pBurst(0.5)]]);
  const r=D.analyse({mode:'kicksnare',x,sr,sens:1}).events;
  check('only breathy "p" sounds -> all kick',r.length===4&&r.every(h=>h.drum==='kick'),r.map(h=>h.drum+'@'+Math.round(2**h.f)+'Hz').join(' '));
  // second take with only "k" sounds, given the kicks already on the track -> snare
  const known=r.map(h=>({f:h.f,drum:'kick'}));
  const r2=D.analyse({mode:'kicksnare',x:mix(2,[{t:0.3,k:'snare',a:0.5},{t:0.9,k:'snare',a:0.5},{t:1.4,k:'snare',a:0.4}]),sr,sens:1,known}).events;
  check('overdub of only "k" sounds next to known kicks -> snare',r2.length===3&&r2.every(h=>h.drum==='snare'),r2.map(h=>h.drum).join(' '));
  // the user corrected such a sound to snare once: the same sound alone is now snare
  const r3=D.analyse({mode:'kicksnare',x,sr,sens:1,known:[{f:r[0].f,drum:'snare'}]}).events;
  check('a correction is remembered',r3.every(h=>h.drum==='snare'),r3.map(h=>h.drum).join(' '));
  const r4=D.analyse({mode:'kicksnare',x:mix(2,[{t:0.3,k:'hat',a:0.5},{t:0.9,k:'hat',a:0.5}]),sr,sens:1}).events;
  check('only clearly bright sounds on kick+snare -> snare',r4.length===2&&r4.every(h=>h.drum==='snare'),r4.map(h=>h.drum+'@'+Math.round(2**h.f)+'Hz').join(' '));
}
// --- 5. melody: voice-like tone with vibrato; gaps, legato steps, repeated note
function sing(notes, len, cents) {
  const x = new Float32Array(Math.round(len * sr)); for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.002;
  let ph = 0;
  for (const n of notes) {
    const a = Math.round(n.t * sr), b = Math.round((n.t + n.d) * sr);
    for (let i = a; i < b; i++) {
      const tt = (i - a) / sr, vib = 0.25 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / 0.2);
      const f = 440 * Math.pow(2, (n.p + (cents || 0) / 100 + vib - 69) / 12); ph += 2 * Math.PI * f / sr;
      const env = Math.min(1, tt / 0.015, (n.d - tt) / (n.legato ? 0.001 : 0.02));
      let s = 0; for (let h = 1; h <= 8; h++) s += Math.sin(h * ph) / h * (h === 2 ? 1.4 : 1);
      x[i] += n.a * 0.3 * env * s;
    }
  }
  return x;
}
{
  const notes = [{ t: 0.3, d: 0.4, p: 48, a: 1 }, { t: 0.9, d: 0.3, p: 50, a: 0.5 }, { t: 1.2, d: 0.3, p: 52, a: 1, legato: 1 }, { t: 1.5, d: 0.5, p: 55, a: 1 },
  { t: 2.2, d: 0.2, p: 55, a: 1 }, { t: 2.45, d: 0.2, p: 55, a: 0.8 }, { t: 2.9, d: 0.6, p: 43, a: 1 }];
  notes[1].legato = 1;
  const t0 = Date.now();
  const r = D.analyse({ mode: 'melodic', x: sing(notes, 4), sr, sens: 1 }).events;
  const ms = Date.now() - t0;
  check('melody count', r.length === notes.length, `${r.length}/${notes.length}: ` + r.map(n => n.p.toFixed(2) + '@' + n.t.toFixed(3) + '+' + n.d.toFixed(2)).join(' '));
  check('melody pitches', r.length === notes.length && r.every((n, i) => Math.round(n.p) === notes[i].p));
  let me = 0; r.forEach((n, i) => { if (notes[i]) me = Math.max(me, Math.abs(n.t - notes[i].t)); });
  check('melody timing <25ms', me < 0.025, (me * 1000).toFixed(1) + ' ms; signed: ' + r.map((n, i) => notes[i] ? ((n.t - notes[i].t) * 1000).toFixed(0) : '?').join(' '));
  check('melody velocity', r.length > 1 && r[1].v < r[0].v, r.map(n => n.v).join(' '));
  console.log('     melody analysis of 4 s took', ms, 'ms');
  // sung 35 cents flat as a whole: should still land on the same notes
  const r2 = D.analyse({ mode: 'melodic', x: sing(notes, 4, -35), sr, sens: 1 }).events;
  check('flat singer is re-centred', r2.length === notes.length && r2.every((n, i) => Math.round(n.p) === notes[i].p), r2.map(n => n.p.toFixed(2)).join(' '));
  // 44.1k too
}
// --- 6. theory
check('snap to C major', D.snapPitch(61.4, 0, 'major') === 62 && D.snapPitch(61.4, 0, 'off') === 61 && D.snapPitch(66.2, 0, 'major') === 67);
{ const w = new Array(12).fill(0);[9, 0, 4, 9, 7, 2, 9, 11].forEach(p => w[p] += 1); check('root estimate A minor', D.estimateRoot(w, 'minor') === 9, '' + D.estimateRoot(w, 'minor')); }
check('tempo from length', D.tempoFromLength(4.0).bars === 2 && Math.abs(D.tempoFromLength(4.0).bpm - 120) < 1e-9 && D.tempoFromLength(9.6).bars === 4);
// --- 7. calibration helper
{
  const x = new Float32Array(sr * 2), offs = [0.3, 0.7, 1.1];
  for (const o of offs) { const a = Math.round((o + 0.062) * sr); for (let i = 0; i < 300; i++) x[a + i] = 0.5 * Math.sin(i * 0.3) * Math.exp(-i / 80); }
  const d = D.clickDelays(x, sr, offs, 0.35); check('click delay 62 ms', d.every(v => Math.abs(v - 0.062) < 0.002), d.map(v => (v * 1000).toFixed(1)).join(' '));
}
// --- 8. MIDI file
{
  const mid = D.buildMidi({ bpm: 96, loopBeats: 8, name: 'test', tracks: [
    { name: 'Kick + snare', channel: 9, isDrum: true, notes: [{ t: 0, d: 0.25, n: 36, v: 110 }, { t: 1, d: 0.25, n: 38, v: 90 }, { t: 7.75, d: 0.25, n: 36, v: 70 }] },
    { name: 'Bass', channel: 0, program: 38, notes: [{ t: 0, d: 1, n: 40, v: 100 }, { t: 1, d: 1, n: 40, v: 100 }, { t: 6, d: 4, n: 43, v: 80 }] }] });
  require('fs').writeFileSync(__dirname + '/test.mid', mid);
  check('midi header', String.fromCharCode(...mid.slice(0, 4)) === 'MThd' && mid[9] === 1 && mid[11] === 3 && mid[12] * 256 + mid[13] === 480);
  const w = D.encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 48000); check('wav', w.length === 52 && String.fromCharCode(...w.slice(0, 4)) === 'RIFF');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);

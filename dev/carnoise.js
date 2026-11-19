// Synthetic car noise (engine hum, road rumble, bumps, hiss): drum and melody detection must ignore it. Run: node dev/carnoise.js
const sr=48000;let seed=99;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296*2-1;};
function biquad(x,f0,q,type){const w=2*Math.PI*f0/sr,c=Math.cos(w),al=Math.sin(w)/(2*q);let b0,b1,b2,a0=1+al,a1=-2*c,a2=1-al;
  if(type==='lp'){b0=(1-c)/2;b1=1-c;b2=(1-c)/2;}else if(type==='hp'){b0=(1+c)/2;b1=-(1+c);b2=(1+c)/2;}else{b0=al;b1=0;b2=-al;}
  const y=new Float32Array(x.length);let x1=0,x2=0,y1=0,y2=0;for(let i=0;i<x.length;i++){const o=(b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2)/a0;x2=x1;x1=x[i];y2=y1;y1=o;y[i]=o;}return y;}
function car(len,level){const n=Math.round(len*sr),w=new Float32Array(n);for(let i=0;i<n;i++)w[i]=rnd();
  const rumble=biquad(biquad(w,140,0.7,'lp'),140,0.7,'lp'),hiss=biquad(w,600,0.7,'hp'),y=new Float32Array(n);
  let next=0.2;const bumps=[];while(next<len){bumps.push([next,0.3+0.7*Math.abs(rnd())]);next+=0.25+0.9*Math.abs(rnd());}
  for(let i=0;i<n;i++){const t=i/sr;y[i]=6*rumble[i]+0.05*hiss[i]+0.25*Math.sin(2*Math.PI*38*t)*(1+0.3*Math.sin(2*Math.PI*0.7*t))+0.12*Math.sin(2*Math.PI*76*t);}
  for(const [t0,a] of bumps){const o=Math.round(t0*sr);for(let i=0;i<0.12*sr&&o+i<n;i++)y[o+i]+=a*0.8*Math.sin(2*Math.PI*(55+20*a)*i/sr)*Math.exp(-i/(sr*0.035));}
  let e=0;for(const v of y)e+=v*v;const r=Math.sqrt(e/n);for(let i=0;i<n;i++)y[i]*=level/r;return y;}
function burst(kind,amp){const n=Math.round(sr*0.25),x=new Float32Array(n),nz=new Float32Array(n);
  const tau=kind==='kick'?0.012:kind==='snare'?0.03:kind==='ohat'?0.25:0.02;for(let i=0;i<n;i++)nz[i]=rnd()*Math.exp(-i/(sr*tau));
  if(kind==='kick'){const lo=biquad(nz,700,0.7,'lp'),hi=biquad(nz,3000,0.7,'hp');for(let i=0;i<n;i++)x[i]=amp*(0.6*Math.sin(2*Math.PI*110*i/sr)*Math.exp(-i/(sr*0.05))+2.2*lo[i]+0.5*hi[i]);} // a breathy "p": lip burst plus a little thump
  else if(kind==='snare'){const bp=biquad(nz,2800,1.2,'bp');for(let i=0;i<n;i++)x[i]=amp*2*bp[i];}
  else{const hp=biquad(nz,6500,0.7,'hp');for(let i=0;i<n;i++)x[i]=amp*hp[i];}return x;}
function sing(notes,len){const x=new Float32Array(Math.round(len*sr));
  for(const [t0,d,midi] of notes){const f=440*2**((midi-69)/12),o=Math.round(t0*sr);let ph=0;
    for(let i=0;i<d*sr&&o+i<x.length;i++){const env=Math.min(1,i/(0.02*sr),(d*sr-i)/(0.03*sr));ph+=2*Math.PI*f/sr;x[o+i]+=0.3*env*(Math.sin(ph)+0.5*Math.sin(2*ph)+0.25*Math.sin(3*ph));}}return x;}
const add=(a,b)=>{const y=new Float32Array(a.length);for(let i=0;i<a.length;i++)y[i]=a[i]+(b[i]||0);return y;};
const NEW=require('./dsp.js')();
const pat=[[0.2,'kick'],[0.5,'hat'],[0.8,'snare'],[1.1,'hat'],[1.4,'kick'],[1.7,'kick'],[2.0,'snare'],[2.3,'hat'],[2.6,'kick'],[2.9,'ohat'],[3.4,'snare']];
const drums=()=>{const x=new Float32Array(4*sr);for(const [t,k] of pat){const b=burst(k,0.5),o=Math.round(t*sr);for(let i=0;i<b.length&&o+i<x.length;i++)x[o+i]+=b[i];}return x;};
const mel=[[0.2,0.5,57],[0.8,0.5,60],[1.4,0.9,64],[2.4,0.5,62],[3.0,0.8,60]];
const score=(r)=>{let ok=0,lab=0;for(const [t,k] of pat){const h=r.find(h=>Math.abs(h.t-t)<0.05);if(h){ok++;if(h.drum===k)lab++;}}return `${r.length} hits (${ok}/${pat.length} real ones found, ${lab} right drum, ${r.length-ok} false)`;};
const mscore=(r)=>{let ok=0;for(const [t,d,m] of mel)if(r.some(n=>Math.abs(n.t-t)<0.08&&Math.abs(Math.round(n.p)-m)===0))ok++;return `${r.length} notes (${ok}/${mel.length} right)`;};
let fails=0;const check=(name,c,info)=>{console.log((c?'PASS ':'FAIL ')+name+'  '+info);if(!c)fails++;};
for(const lvl of [0.02,0.05,0.1]){
  const nz=car(4,lvl),nz0=car(0.7,lvl);
  const rn=NEW.analyse({mode:'kit',x:nz,sr,sens:1}).events;
  console.log(`car noise only, level ${lvl}: ${rn.length} hits`);
  if(lvl<=0.05)check(`noise only (${lvl}): no hits`,rn.length===0,rn.map(h=>h.drum).join(' '));
  const x=add(drums(),nz);
  const sn=NEW.analyse({mode:'kit',x,sr,sens:1}).events;
  console.log(`  beatbox + noise: ${score(sn)}`);
  if(lvl<=0.05){const ok=pat.filter(([t])=>sn.some(h=>Math.abs(h.t-t)<0.05)).length;check(`beatbox in noise (${lvl}): found ≥10 of 11, ≤1 false`,ok>=10&&sn.length-ok<=1,score(sn));}
  const y=add(sing(mel,4),nz);
  const mn=NEW.analyse({mode:'melodic',x:y,sr,sens:1,noise:nz0}).events;
  console.log(`  singing + noise: ${mscore(mn)}`);
  if(lvl<=0.05)check(`singing in noise (${lvl}): all 5 notes, no extra`,mn.length===5&&mscore(mn).includes('5/5'),mscore(mn));
}
console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);

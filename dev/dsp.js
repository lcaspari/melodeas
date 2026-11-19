function MelodeasDSP(){
'use strict';
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const median=a=>{if(!a.length)return NaN;const s=Array.from(a).sort((x,y)=>x-y);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

/* ---------- FFT (radix 2, in place) ---------- */
function makeFFT(n){
  const rev=new Uint32Array(n),cos=new Float32Array(n/2),sin=new Float32Array(n/2),bits=Math.round(Math.log2(n));
  for(let i=0;i<n;i++){let r=0;for(let b=0;b<bits;b++)if(i&(1<<b))r|=1<<(bits-1-b);rev[i]=r;}
  for(let i=0;i<n/2;i++){cos[i]=Math.cos(2*Math.PI*i/n);sin[i]=Math.sin(2*Math.PI*i/n);}
  return function(re,im){
    for(let i=0;i<n;i++){const r=rev[i];if(r>i){let t=re[i];re[i]=re[r];re[r]=t;t=im[i];im[i]=im[r];im[r]=t;}}
    for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
      for(let s=0;s<n;s+=size)for(let k=0,j=0;k<half;k++,j+=step){
        const wr=cos[j],wi=-sin[j],a=s+k,b=a+half;
        const xr=re[b]*wr-im[b]*wi,xi=re[b]*wi+im[b]*wr;
        re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;}}
  };
}

/* ---------- Spectral frames: flux (for onsets), level, brightness ----------
   Background noise (car, street, fan) is estimated per frequency from the quietest fifth of the take and
   subtracted before anything is measured, so only sounds that stand out from it count. */
function spectral(x,sr){
  const N=sr>=32000?1024:512,H=N>>2,bins=N>>1;
  const nF=x.length>=N?Math.floor((x.length-N)/H)+1:0;
  let peak=1e-4;for(let i=0;i<x.length;i++){const a=x[i]<0?-x[i]:x[i];if(a>peak)peak=a;}
  const g=1/peak,fft=makeFFT(N),win=new Float32Array(N);
  for(let i=0;i<N;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/N);
  const re=new Float32Array(N),im=new Float32Array(N);
  const flux=new Float32Array(nF),rms=new Float32Array(nF),cen=new Float32Array(nF),den=new Float32Array(nF),cl=new Float32Array(nF),snr=new Float32Array(nF);
  const lf=new Float32Array(bins);for(let k=1;k<bins;k++)lf[k]=Math.log2(k*sr/N);
  // Flux is summed over log-spaced bands so a dull thump counts as much as a bright hiss
  const NB=24,kLo=Math.max(1,Math.round(100*N/sr)),kHi=Math.min(bins-1,Math.round(11000*N/sr)),nb=kHi-kLo+1;
  const band=new Uint8Array(bins),lr=Math.log(kHi/kLo);
  for(let k=kLo;k<=kHi;k++)band[k]=Math.min(NB-1,Math.floor(NB*Math.log(k/kLo)/lr));
  const P=new Float32Array(nF*nb);
  for(let f=0;f<nF;f++){
    const o=f*H;let e=0;
    for(let i=0;i<N;i++){const v=x[o+i];e+=v*v;re[i]=v*g*win[i];im[i]=0;}
    rms[f]=Math.sqrt(e/N);fft(re,im);
    for(let k=kLo;k<=kHi;k++)P[f*nb+k-kLo]=re[k]*re[k]+im[k]*im[k];
  }
  // noise floor per frequency: the 20th percentile over time (hits are short, so this is the background)
  const nz=new Float32Array(nb);let nSum=0;
  if(nF>=10){const col=new Float32Array(nF),q=Math.floor(nF*0.2);
    for(let k=0;k<nb;k++){for(let f=0;f<nF;f++)col[f]=P[f*nb+k];col.sort();nz[k]=col[q]*4.48;nSum+=nz[k];}} // for noise, the 20th percentile of power is 0.223 x its mean
  const ring=[new Float32Array(NB),new Float32Array(NB),new Float32Array(NB)],acc=new Float32Array(NB);
  for(let f=0;f<nF;f++){
    const cur=ring[f%3],old=ring[(f+1)%3];let fl=0,num=0,dn=0,raw=0;acc.fill(0);
    for(let k=kLo;k<=kHi;k++){const p=P[f*nb+k-kLo];raw+=p;let c=p-1.5*nz[k-kLo];if(c<0)c=0; // a little over-subtraction
      acc[band[k]]+=Math.sqrt(c);num+=lf[k]*c;dn+=c;}
    for(let b=0;b<NB;b++){const lm=Math.log(1+acc[b]);if(f>=2){const d=lm-old[b];if(d>0)fl+=d;}cur[b]=lm;}
    flux[f]=fl;den[f]=dn;cen[f]=dn>0?num/dn:0;
    cl[f]=raw>0?rms[f]*Math.sqrt(dn/raw):0;          // level of what stands out above the noise
    snr[f]=nSum>0?dn/nSum:1e6;
  }
  let dmax=0;for(let f=0;f<nF;f++)if(den[f]>dmax)dmax=den[f];
  return {N,H,nF,flux,rms,cl,snr,cen,den,peak,noisy:dmax>0&&nSum/dmax>3e-4}; // background within ~35 dB of the loudest moment
}

/* ---------- Percussive hits: time, loudness, brightness, ring length ---------- */
function detectHits(x,sr,sens){
  sens=sens||1;
  x=highpass(highpass(x,sr,90),sr,90); // steep low cut: road bumps and engine rumble sit below the lowest beatboxed kick
  const sp=spectral(x,sr),{flux,cl:rms,snr,cen,den,N,H,nF,noisy}=sp; // levels are measured after the background is removed
  let fmax=0;for(let i=0;i<nF;i++)if(flux[i]>fmax)fmax=flux[i];
  if(fmax<=0)return [];
  const thr=0.12*fmax/sens,m=Math.max(2,Math.round(0.03*sr/H)),w=Math.round(0.12*sr/H);
  let c=[];
  for(let n=2;n<nF;n++){
    const v=flux[n];if(v<thr)continue;
    let isMax=true;
    for(let j=Math.max(0,n-m);j<=Math.min(nF-1,n+m);j++)if(flux[j]>v||(flux[j]===v&&j<n)){isMax=false;break;}
    if(!isMax)continue;
    let s=0,k=0;for(let j=Math.max(0,n-w);j<n-2;j++){s+=flux[j];k++;}
    if(k&&v<1.5*s/k)continue;
    let level=0,lf=n,sn=0;for(let j=n;j<Math.min(nF,n+7);j++){if(rms[j]>level){level=rms[j];lf=j;}if(snr[j]>sn)sn=snr[j];}
    if(sn<1/sens)continue; // must stand clearly above the background noise
    let cs=0,ds=0;for(let j=n;j<Math.min(nF,n+4);j++){cs+=cen[j]*den[j];ds+=den[j];}
    let q=lf;while(q<nF&&rms[q]>=0.3*level)q++;
    const fc=ds>0?Math.round(cs/ds*100)/100:9;
    if(noisy&&fc<7.64)continue; // in a noisy place, nothing a mouth or hand makes is centred below 200 Hz: that is rumble or a bump
    c.push({t:(n*H+N*0.5)/sr-0.003,flux:v,level,f:fc,dur:(q-n)*H/sr});
  }
  let lmax=0;for(const h of c)if(h.level>lmax)lmax=h.level;
  const gate=Math.max(0.003,0.06*lmax)/sens;
  c=c.filter(h=>h.level>=gate);
  const out=[];
  for(const h of c){const l=out[out.length-1];
    if(l&&h.t-l.t<0.07){if(h.flux>l.flux)out[out.length-1]=h;}else out.push(h);}
  for(let i=0;i<out.length;i++){const nx=out[i+1];if(nx)out[i].dur=Math.min(out[i].dur,nx.t-out[i].t);}
  return out;
}

function kmeans1d(v,k){
  const s=Array.from(v).sort((a,b)=>a-b);
  let c=[];for(let i=0;i<k;i++)c.push(s[Math.min(s.length-1,Math.floor((i+0.5)*s.length/k))]);
  let asg=new Array(v.length).fill(0);
  for(let it=0;it<25;it++){
    for(let i=0;i<v.length;i++){let b=0;for(let j=1;j<k;j++)if(Math.abs(v[i]-c[j])<Math.abs(v[i]-c[b]))b=j;asg[i]=b;}
    for(let j=0;j<k;j++){let s2=0,n=0;for(let i=0;i<v.length;i++)if(asg[i]===j){s2+=v[i];n++;}if(n)c[j]=s2/n;}
  }
  return {c,asg};
}

/* Sort hits into drums by brightness f (log2 Hz): dark = kick ("p","b"), mid = snare ("k"), bright = hat ("ts").
   known = [{f,drum}] from notes already on the track and from the user's own corrections; it outranks the built-in thresholds. */
function labelDrums(hits,mode,known){
  if(!hits.length)return hits;
  const vel=()=>{ // loudness is judged within each drum: a soft "ts" next to a loud "b" is still a full hat
    const mx={};for(const h of hits){const k=h.drum==='ohat'?'hat':h.drum;if(!(mx[k]>=h.level))mx[k]=h.level;}
    for(const h of hits){const dB=20*Math.log10(h.level/mx[h.drum==='ohat'?'hat':h.drum]);h.v=Math.round(clamp(118+dB*3.5,25,127));}
    return hits;};
  if(mode==='hat'){for(const h of hits)h.drum=h.dur>0.16?'ohat':'hat';return vel();}
  const K=mode==='kit'?3:2,names=['kick','snare','hat'],L=Math.log2;
  const v=hits.map(h=>h.f);
  const abs=c=>K===3?(c<L(1300)?0:c<L(4200)?1:2):(c<L(1300)?0:1);
  const ks=[0,0,0],kn=[0,0,0];
  for(const k of known||[]){const ci=names.indexOf(k.drum==='ohat'?'hat':k.drum);if(ci>=0&&ci<K&&isFinite(k.f)){ks[ci]+=k.f;kn[ci]++;}}
  const anyKnown=kn[0]+kn[1]+kn[2]>0;
  let groups=null;
  for(let k=Math.min(K,hits.length);k>=1&&!groups;k--){
    const km=kmeans1d(v,k);let g=[];
    for(let j=0;j<k;j++){const idx=[];for(let i=0;i<v.length;i++)if(km.asg[i]===j)idx.push(i);if(idx.length)g.push({mean:km.c[j],idx});}
    g.sort((a,b)=>a.mean-b.mean);
    // split only where the sounds really fall apart: centres 0.7 octave apart and a clear gap between the groups
    let ok=true;for(let j=1;j<g.length;j++){const hiPrev=Math.max(...g[j-1].idx.map(i=>v[i])),loNext=Math.min(...g[j].idx.map(i=>v[i]));
      if(g[j].mean-g[j-1].mean<0.7||loNext-hiPrev<0.6)ok=false;}
    if(ok||k===1)groups=g;
  }
  const rule=groups.map(g=>{
    const m=g.mean;let near=-1,nd=0.6,lb=0,ub=K-1;
    for(let c=0;c<K;c++){if(!kn[c])continue;const kc=ks[c]/kn[c],d=Math.abs(m-kc);
      if(d<nd){nd=d;near=c;}
      if(m>kc+0.6)lb=Math.max(lb,Math.min(K-1,c+1));if(m<kc-0.6)ub=Math.min(ub,Math.max(0,c-1));}
    return {m,near,lb,ub};
  });
  let lab;
  if(groups.length===1){const r=rule[0];
    if(r.near>=0)lab=[r.near];
    else{ // one kind of sound and nothing to compare against: kick unless it is clearly bright
      const a=!anyKnown?(r.m<L(2600)?0:K===3&&r.m>=L(4200)?2:1):abs(r.m);lab=[r.lb<=r.ub?clamp(a,r.lb,r.ub):a];}
  }else{ // several groups: the brighter group is the higher drum; pick the order that best fits typical sounds and the references
    const proto=[L(900),L(3000),L(8000)];let best=null,bc=1e9;
    const walk=(gi,from,acc,cost)=>{if(cost>=bc)return;if(gi===groups.length){bc=cost;best=acc.slice();return;}
      for(let c=from;c<=K-(groups.length-gi);c++){const r=rule[gi];
        const cc=r.near>=0?(c===r.near?0:4):Math.abs(r.m-proto[c])+(c<r.lb||c>r.ub?3:0);
        acc.push(c);walk(gi+1,c+1,acc,cost+cc);acc.pop();}};
    walk(0,0,[],0);lab=best;
  }
  groups.forEach((g,gi)=>g.idx.forEach(i=>hits[i].drum=names[lab[gi]]));
  if(K===3)for(const h of hits)if(h.drum==='hat'&&h.dur>0.16)h.drum='ohat'; // a held "tsss" is an open hat
  return vel();
}

/* ---------- Pitch tracking (YIN on a decimated signal) ---------- */
function decim2(x){
  const n=x.length>>1,y=new Float32Array(n);
  for(let i=0;i<n;i++){const a=x[2*i-1]||0,b=x[2*i],c=x[2*i+1]||0;y[i]=0.25*a+0.5*b+0.25*c;}
  return y;
}
function highpass(x,sr,fc){ // 2nd-order Butterworth: takes out engine and road rumble below the voice
  const w=2*Math.PI*fc/sr,c=Math.cos(w),al=Math.sin(w)/Math.SQRT2,a0=1+al,b0=(1+c)/2/a0,b1=-(1+c)/a0,a1=-2*c/a0,a2=(1-al)/a0;
  const y=new Float32Array(x.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<x.length;i++){const v=x[i],o=b0*v+b1*x1+b0*x2-a1*y1-a2*y2;x2=x1;x1=v;y2=y1;y1=o;y[i]=o;}return y;}
function frameRms(y,W,hop){const n=y.length>=W?Math.floor((y.length-W)/hop)+1:0,r=new Float32Array(n);
  for(let f=0;f<n;f++){let e=0;const s=f*hop;for(let j=0;j<W;j++)e+=y[s+j]*y[s+j];r[f]=Math.sqrt(e/W);}return r;}
function pitchTrack(x,sr,sens,noise){
  sens=sens||1;
  let y=highpass(x,sr,55),fs=sr;while(fs>30000){y=decim2(y);fs/=2;}
  const W=fs>=20000?1024:512,hop=W>>2,tauMin=Math.floor(fs/1000),tauMax=Math.ceil(fs/65);
  const nF=y.length>=W+tauMax?Math.floor((y.length-W-tauMax)/hop)+1:0;
  const pitch=new Float32Array(nF).fill(NaN),rms=new Float32Array(nF);
  for(let f=0;f<nF;f++){let e=0;const s=f*hop;for(let j=0;j<W;j++)e+=y[s+j]*y[s+j];rms[f]=Math.sqrt(e/W);}
  const sorted=Array.from(rms).sort((a,b)=>a-b),r95=sorted[Math.floor(sorted.length*0.95)]||0;
  // background level: from the quiet count-in before the take when there is one, else the quietest 5% of the take
  let bg=sorted[Math.floor(sorted.length*0.05)]||0;
  if(noise&&noise.length>sr*0.2){let z=highpass(noise,sr,55);for(let q=fs;q<sr;q*=2)z=decim2(z);const nr=Array.from(frameRms(z,W,hop)).sort((a,b)=>a-b);if(nr.length)bg=nr[nr.length>>1];}
  const gate=Math.max(0.004,0.07*r95,2.5*bg)/sens,d=new Float32Array(tauMax+2);
  for(let f=0;f<nF;f++){
    if(rms[f]<gate)continue;
    const s=f*hop;
    for(let tau=1;tau<=tauMax;tau++){let sum=0;for(let j=0;j<W;j++){const t=y[s+j]-y[s+j+tau];sum+=t*t;}d[tau]=sum;}
    let run=0;for(let tau=1;tau<=tauMax;tau++){run+=d[tau];d[tau]=run>0?d[tau]*tau/run:1;}
    let tau=-1;
    for(let t=tauMin;t<=tauMax;t++)if(d[t]<0.15){while(t+1<=tauMax&&d[t+1]<d[t])t++;tau=t;break;}
    if(tau<0){let b=tauMin;for(let t=tauMin;t<=tauMax;t++)if(d[t]<d[b])b=t;if(d[b]<0.3)tau=b;}
    if(tau>0){
      let tr=tau;
      if(tau>1&&tau<tauMax){const a=d[tau-1],b=d[tau],c=d[tau+1],dn=a-2*b+c;if(dn>0)tr=tau+0.5*(a-c)/dn;}
      pitch[f]=69+12*Math.log2(fs/tr/440);
    }
  }
  return {pitch,rms,nF,hop,W,fs};
}

/* ---------- Turn a pitch track into notes ---------- */
function segmentNotes(pt){
  const {pitch,rms,nF,hop,W,fs}=pt,p=new Float32Array(nF).fill(NaN);
  for(let f=0;f<nF;f++){if(isNaN(pitch[f]))continue;const v=[];
    for(let j=Math.max(0,f-2);j<=Math.min(nF-1,f+2);j++)if(!isNaN(pitch[j]))v.push(pitch[j]);p[f]=median(v);}
  for(let f=1;f<nF-1;f++)if(isNaN(p[f])&&!isNaN(p[f-1])){ // bridge dropouts where the voice clearly kept going
    let j=f,lo=Infinity;while(j<nF&&isNaN(p[j])){if(rms[j]<lo)lo=rms[j];j++;}
    if(j<nF&&Math.abs(p[j]-p[f-1])<1&&(j-f<=2||(j-f<=6&&lo>=0.6*Math.min(rms[f-1],rms[j]))))for(let q=f;q<j;q++)p[q]=p[f-1];
    f=j;}
  const notes=[];let cur=null;
  const open=(f,bound)=>({start:f,fv:[],bound,peak:rms[f],valley:rms[f],valleyF:f});
  const close=f=>{if(cur){cur.end=f;notes.push(cur);cur=null;}};
  for(let f=0;f<nF;f++){
    const v=p[f];
    if(isNaN(v)){close(f);continue;}
    if(!cur){cur=open(f,'gap');cur.fv.push([f,v]);continue;}
    const med=median(cur.fv.map(a=>a[1]));
    if(Math.abs(v-med)>0.8){
      let ok=true;
      for(let j=1;j<=2;j++){const q=p[f+j];if(q===undefined||isNaN(q)||Math.abs(q-med)<=0.8||Math.sign(q-med)!==Math.sign(v-med))ok=false;}
      if(ok){close(f);cur=open(f,'pitch');cur.fv.push([f,v]);continue;}
    }else cur.fv.push([f,v]);
    const e=rms[f];
    if(cur.valley<0.5*cur.peak&&e>1.6*cur.valley&&cur.valleyF-cur.start>=5){ // re-articulated on the same pitch
      const vf=cur.valleyF,rest=cur.fv.filter(a=>a[0]>=vf);
      cur.fv=cur.fv.filter(a=>a[0]<vf);close(vf);
      cur=open(vf,'energy');cur.fv=rest;cur.peak=e;cur.valley=e;cur.valleyF=f;
    }else if(e>cur.peak){cur.peak=e;cur.valley=e;cur.valleyF=f;}
    else if(e<cur.valley){cur.valley=e;cur.valleyF=f;}
  }
  close(nF);
  for(const n of notes){
    const len=n.end-n.start,skip=len>=6?Math.min(3,Math.floor(len*0.25)):0;
    const vals=n.fv.filter(a=>a[0]>=n.start+skip).map(a=>a[1]);
    n.p=median(vals.length?vals:n.fv.map(a=>a[1]));
    let l=0;for(let f=n.start;f<n.end;f++)if(rms[f]>l)l=rms[f];n.level=l;
  }
  let a=notes.filter(n=>!isNaN(n.p));
  const MIN=5;let b=[];
  for(let i=0;i<a.length;i++){ // very short blips: fold scoops into the note they lead to, drop the rest
    const n=a[i];
    if(n.end-n.start>=MIN){b.push(n);continue;}
    const nx=a[i+1],pv=b[b.length-1];
    if(nx&&nx.start===n.end&&nx.bound==='pitch'){nx.start=n.start;nx.bound=n.bound;}
    else if(pv&&pv.end===n.start&&n.bound==='pitch')pv.end=n.end;
  }
  const out=[];
  for(const n of b){const pv=out[out.length-1];
    if(pv&&pv.end===n.start&&n.bound==='pitch'&&Math.round(pv.p)===Math.round(n.p)){pv.end=n.end;pv.level=Math.max(pv.level,n.level);}
    else out.push(n);}
  return out.map(n=>({t:(n.start*hop+W*0.5)/fs-0.001,d:(n.end-n.start)*hop/fs,p:n.p,level:n.level}));
}

function detectNotes(x,sr,sens,noise){
  const notes=segmentNotes(pitchTrack(x,sr,sens,noise));
  if(!notes.length)return notes;
  let lmax=0,sx=0,sy=0,sw=0;
  for(const n of notes){if(n.level>lmax)lmax=n.level;
    const a=2*Math.PI*(n.p-Math.floor(n.p));sx+=n.d*Math.cos(a);sy+=n.d*Math.sin(a);sw+=n.d;}
  // Singers without a reference drift off A440 as a whole: shift everything by the shared offset
  if(Math.hypot(sx,sy)/sw>0.6){const off=Math.atan2(sy,sx)/(2*Math.PI);for(const n of notes)n.p-=off;}
  for(const n of notes){const dB=20*Math.log10(n.level/lmax);n.v=Math.round(clamp(112+dB*3,30,127));delete n.level;
    if(n.d>=0.25){ // loudness curve inside a long note: 8 points, 1 = its loudest part
      const K=8,i0=Math.max(0,Math.round(n.t*sr)),i1=Math.min(x.length,Math.round((n.t+n.d)*sr)),e=[];let mx=0;
      for(let k=0;k<K;k++){const a=i0+Math.floor((i1-i0)*k/K),b=i0+Math.floor((i1-i0)*(k+1)/K);let q=0;for(let i=a;i<b;i++)q+=x[i]*x[i];e.push(Math.sqrt(q/Math.max(1,b-a)));}
      const sm=e.map((v,k)=>k===0||k===K-1?v:0.25*e[k-1]+0.5*v+0.25*e[k+1]);for(const v of sm)if(v>mx)mx=v;
      if(mx>0)n.env=sm.map(v=>Math.round(clamp(v/mx,0.02,1)*100)/100);
    }}
  return notes;
}

function firstSound(x,sr){
  const B=Math.round(sr*0.01);let mx=0;const e=[];
  for(let i=0;i+B<=x.length;i+=B){let s=0;for(let j=0;j<B;j++)s+=x[i+j]*x[i+j];const r=Math.sqrt(s/B);e.push(r);if(r>mx)mx=r;}
  const g=Math.max(0.01,0.15*mx);
  for(let i=0;i<e.length;i++)if(e[i]>=g)return i*B/sr;
  return -1;
}

/* One entry point, used from the worker */
function analyse(m){
  if(m.mode==='melodic')return {events:detectNotes(m.x,m.sr,m.sens,m.noise)};
  if(m.mode==='audio'){const t=firstSound(m.x,m.sr);return {events:t<0?[]:[{t}]};}
  const hits=labelDrums(detectHits(m.x,m.sr,m.sens),m.mode,m.known);
  return {events:hits.map(h=>({t:h.t,d:h.dur,drum:h.drum,v:h.v,f:h.f}))};
}

/* Delay between scheduled clicks and where they show up in the recording (latency calibration) */
function clickDelays(x,sr,offsets,span){
  const out=[];
  for(const o of offsets){
    const a=Math.max(0,Math.round(o*sr)),b=Math.min(x.length,Math.round((o+span)*sr));
    let pk=0;for(let i=a;i<b;i++){const v=Math.abs(x[i]);if(v>pk)pk=v;}
    if(pk<0.01){out.push(NaN);continue;}
    let i=a;while(i<b&&Math.abs(x[i])<0.4*pk)i++;
    out.push(i/sr-o);
  }
  return out;
}

/* ---------- Music theory helpers ---------- */
const SCALES={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],majpent:[0,2,4,7,9],minpent:[0,3,5,7,10],
  dorian:[0,2,3,5,7,9,10],mixo:[0,2,4,5,7,9,10],blues:[0,3,5,6,7,10]};
function estimateRoot(w,scale){
  const sc=SCALES[scale];if(!sc)return 0;let best=0,bs=-1;
  for(let r=0;r<12;r++){let s=0;for(const pc of sc)s+=w[(r+pc)%12];s+=0.6*w[r]+0.3*w[(r+7)%12];if(s>bs+1e-9){bs=s;best=r;}}
  return best;
}
function snapPitch(p,root,scale){
  const sc=SCALES[scale];if(!sc)return Math.round(p);
  let best=Math.round(p),bd=1e9;
  for(let q=Math.floor(p)-3;q<=Math.ceil(p)+3;q++){
    if(sc.indexOf(((q-root)%12+12)%12)<0)continue;
    const dd=Math.abs(q-p);if(dd<bd){bd=dd;best=q;}}
  return best;
}
function quantize(t,grid){return grid>0?Math.round(t/grid)*grid:t;}
function tempoFromLength(sec){ // loop-pedal style: pick the bar count that lands the tempo in a normal range
  for(const bars of [1,2,4,8,16]){const bpm=bars*240/sec;if(bpm>=75&&bpm<150)return {bars,bpm};}
  return null;
}

function refineTempo(times,bpm){ // nudge the tempo (within 4%) so the hits sit on a 16th-note grid
  if(times.length<4)return bpm;
  let best=bpm,bc=Infinity;
  for(let i=-20;i<=20;i++){const s=i*0.002,sp=60/(bpm*(1+s));let c=0;
    for(const t of times){const g=t/sp*4,d=g-Math.round(g);c+=d*d;}
    c=c/times.length+0.002*(s/0.04)*(s/0.04);if(c<bc){bc=c;best=bpm*(1+s);}}
  return best;
}

/* ---------- Standard MIDI file (format 1) ---------- */
function vlq(n){const b=[n&0x7f];while((n>>=7)>0)b.unshift((n&0x7f)|0x80);return b;}
function buildMidi(song){
  const PPQ=480,loopTicks=Math.round(song.loopBeats*PPQ);
  const str=s=>Array.from(unescape(encodeURIComponent(s))).map(ch=>ch.charCodeAt(0));
  const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
  const chunk=(id,data)=>str(id).concat(u32(data.length),data);
  const meta=(type,data)=>[0xff,type].concat(vlq(data.length),data);
  const us=Math.round(6e7/song.bpm);
  const tracks=[[].concat([0],meta(3,str(song.name||'Melodeas')),[0],meta(0x58,[4,2,24,8]),
    [0],meta(0x51,[(us>>16)&255,(us>>8)&255,us&255]),vlq(loopTicks),meta(0x2f,[]))];
  for(const tr of song.tracks){
    const ch=tr.channel&15,ev=[];
    for(const n of tr.notes){
      const on=clamp(Math.round(n.t*PPQ),0,loopTicks-1);
      const off=clamp(Math.round((n.t+n.d)*PPQ),on+1,loopTicks);
      ev.push({tick:on,on:2,n:clamp(n.n|0,0,127),v:clamp(n.v|0,1,127)},{tick:off,on:0,n:clamp(n.n|0,0,127),v:64});
      if(tr.expr){ // loudness inside the note as MIDI expression (CC 11)
        if(n.env)n.env.forEach((g,k)=>ev.push({tick:clamp(on+Math.round((off-on)*(k?k+0.5:0)/n.env.length),on,off-1),on:1,cc:11,v:clamp(Math.round(127*g),1,127)}));
        else ev.push({tick:on,on:1,cc:11,v:127});
      }
    }
    ev.sort((a,b)=>a.tick-b.tick||a.on-b.on);
    let d=[].concat([0],meta(3,str(tr.name)));
    if(!tr.isDrum)d=d.concat([0,0xc0|ch,tr.program&127]);
    let last=0;
    for(const e of ev){d=d.concat(vlq(e.tick-last),e.cc?[0xb0|ch,e.cc,e.v]:[(e.on?0x90:0x80)|ch,e.n,e.v]);last=e.tick;}
    d=d.concat(vlq(Math.max(0,loopTicks-last)),meta(0x2f,[]));
    tracks.push(d);
  }
  let bytes=chunk('MThd',[0,1,(tracks.length>>8)&255,tracks.length&255,(PPQ>>8)&255,PPQ&255]);
  for(const t of tracks)bytes=bytes.concat(chunk('MTrk',t));
  return new Uint8Array(bytes);
}

function encodeWav(chs,sr){
  const n=chs[0].length,nc=chs.length,buf=new ArrayBuffer(44+n*nc*2),v=new DataView(buf);
  const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  w(0,'RIFF');v.setUint32(4,36+n*nc*2,true);w(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);
  v.setUint16(22,nc,true);v.setUint32(24,sr,true);v.setUint32(28,sr*nc*2,true);v.setUint16(32,nc*2,true);v.setUint16(34,16,true);
  w(36,'data');v.setUint32(40,n*nc*2,true);
  let o=44;for(let i=0;i<n;i++)for(let c=0;c<nc;c++){v.setInt16(o,Math.round(clamp(chs[c][i],-1,1)*32767),true);o+=2;}
  return new Uint8Array(buf);
}

return {analyse,detectHits,labelDrums,detectNotes,pitchTrack,firstSound,clickDelays,SCALES,estimateRoot,snapPitch,
  quantize,tempoFromLength,refineTempo,buildMidi,encodeWav,median};
}
if(typeof module!=='undefined')module.exports=MelodeasDSP;

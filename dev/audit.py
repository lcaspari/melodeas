import asyncio, json, sys, os
from playwright.async_api import async_playwright
JS = """
async () => {
  const m=window.melodeas, sr=44100, out={mel:{},drum:{}};
  const stats=(buf,a,b)=>{const L=buf.getChannelData(0),Rr=buf.getChannelData(1);let pk=0;const i0=Math.round(a*sr),i1=Math.min(L.length,Math.round(b*sr));
    for(let i=i0;i<i1;i++){const v=Math.max(Math.abs(L[i]),Math.abs(Rr[i]));if(v>pk)pk=v;}
    const win=Math.round(0.4*sr);let best=0;for(let s=i0;s+win<=i1;s+=Math.round(0.05*sr)){let e=0;for(let i=s;i<s+win;i++)e+=L[i]*L[i]+Rr[i]*Rr[i];e=Math.sqrt(e/(2*win));if(e>best)best=e;}
    let bad=false;for(let i=0;i<L.length;i++)if(!isFinite(L[i])){bad=true;break;}
    return {pk,rms:best,bad};};
  // K-weighting approximation so that loudness, not raw energy, is compared
  const kw=(c)=>{const hs=c.createBiquadFilter();hs.type='highshelf';hs.frequency.value=1500;hs.gain.value=4;const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=38;hp.Q.value=0.5;hs.connect(hp);return {in:hs,out:hp};};
  for(const id in m.INST){ const I=m.INST[id]; if(I.kind!=='melodic')continue;
    const res={};
    for(const mode of ['dry','kw','strip']){
      const c=new OfflineAudioContext(2,sr*4,sr); let dest=c.destination;
      if(mode==='kw'){const k=kw(c);k.out.connect(c.destination);dest=k.in;}
      if(mode==='strip'){const tr=m.newTrack(id);tr.vol=1;const f=m.makeFX(c,c.destination,0.5);dest=m.makeChain(c,tr,c.destination,f).in;}
      m.playNote(c,dest,id,0.05,57+12*(I.octave||0),100,0.8);
      const b=await c.startRendering(); res[mode]=stats(b,0,1.2); if(mode==='strip')res.tail=stats(b,1.6,3.5);
    }
    out.mel[id]={pk:res.dry.pk,rms:res.dry.rms,kw:res.kw.rms,strip:res.strip.pk,tail:res.tail.rms,bad:res.dry.bad||res.strip.bad};
  }
  for(const kit in m.KITS) for(const d of ['kick','snare','hat','ohat']){
    const c=new OfflineAudioContext(2,sr*2,sr); m.playDrum(c,c.destination,0.05,d,110,kit); const b=await c.startRendering(); const s=stats(b,0,1.9);
    const c2=new OfflineAudioContext(2,sr*2,sr); const k=kw(c2);k.out.connect(c2.destination); m.playDrum(c2,k.in,0.05,d,110,kit); const b2=await c2.startRendering();
    out.drum[kit+'/'+d]={pk:s.pk,kw:stats(b2,0,1.9).rms,bad:s.bad};
  }
  return out;
}
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'), headless=True, args=['--autoplay-policy=no-user-gesture-required','--no-sandbox'])
        page = await b.new_page(); errs=[]
        page.on('console', lambda m: errs.append(m.text) if m.type in('error','warning') else None); page.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await page.goto('file://'+os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','index.html')))
        r = await page.evaluate(JS)
        json.dump(r, open('audit.json','w'))
        print('%-10s %6s %6s %6s %6s %7s'%('sound','peak','rms','k-rms','strip','tail dB'))
        import math
        for k,v in r['mel'].items(): print('%-10s %6.3f %6.3f %6.3f %6.3f %7.1f %s'%(k,v['pk'],v['rms'],v['kw'],v['strip'],20*math.log10(max(v['tail'],1e-9)/max(v['rms'],1e-9)),'BAD' if v['bad'] else ''))
        for k,v in r['drum'].items(): print('%-12s peak %5.3f  k-rms %5.3f %s'%(k,v['pk'],v['kw'],'BAD' if v['bad'] else ''))
        print('console:', errs[:6])
        await b.close()
asyncio.run(main())

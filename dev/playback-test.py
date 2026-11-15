import asyncio,json
from playwright.async_api import async_playwright
SETUP="""async(nofreeze)=>{ window.melodeasNoFreeze=nofreeze; const m=window.melodeas;
  const mk=(inst,notes)=>{m.addTrack(inst);const t=m.S.tracks[m.S.tracks.length-1];t.lenBeats=8;t.notes=notes;return t;};
  const mel=(p0)=>Array.from({length:16},(_,i)=>({t:i*0.5,d:0.45,p:p0+[0,3,7,10][i%4],v:100}));
  mk('kicksnare',Array.from({length:8},(_,i)=>({t:i,drum:i%2?'snare':'kick',v:110})));
  mk('hat',Array.from({length:16},(_,i)=>({t:i*0.5,drum:'hat',v:90})));
  mk('bass',mel(45));mk('synth1',mel(57));mk('pad',mel(60));mk('epiano',mel(64));mk('brass',mel(62));mk('synth2',mel(69));
  m.invalidate();m.renderTracks(); }"""
RMS="""async(sec)=>{ const m=window.melodeas,a=m.ctx.createAnalyser();a.fftSize=2048;m.musicBus.connect(a);const b=new Float32Array(2048);let s=0,n=0;const t1=performance.now()+sec*1000;
  while(performance.now()<t1){a.getFloatTimeDomainData(b);for(const x of b){s+=x*x;n++;}await new Promise(r=>setTimeout(r,40));}
  m.musicBus.disconnect(a);return Math.sqrt(s/n); }"""
async def run(p,nofreeze):
    b=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    pg=await b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    await pg.goto('file:///home/claude/melodeas/index.html'); await pg.evaluate("localStorage.clear()"); await pg.reload()
    await pg.evaluate(SETUP,nofreeze); await pg.click('#play'); await pg.wait_for_timeout(1500)
    rms=await pg.evaluate(RMS,5)
    st=await pg.evaluate("window.melodeas.S.tracks.map(t=>[t.inst,!!t.frozen,t.bufIt])")
    out={'nofreeze':nofreeze,'rms':round(rms,4),'tracks':st}
    if not nofreeze:
        # edit a note while playing: that track falls back to live, then re-renders
        await pg.evaluate("(()=>{const m=window.melodeas,t=m.S.tracks[2];t.notes[0].p+=2;m.invalidate();})()")
        await pg.wait_for_timeout(120); out['after_edit_now']=await pg.evaluate("window.melodeas.S.tracks.map(t=>!!t.frozen)")
        await pg.wait_for_timeout(1500); out['after_edit_later']=await pg.evaluate("window.melodeas.S.tracks.map(t=>!!t.frozen)")
        await pg.evaluate("(()=>{const m=window.melodeas;m.S.tracks[3].mute=true;})()"); await pg.wait_for_timeout(300)
        out['muted_sources']=await pg.evaluate("[...window.melodeas.activeSrc].filter(s=>s._tr===window.melodeas.S.tracks[3]).length")
        out['other_sources']=await pg.evaluate("[...window.melodeas.activeSrc].filter(s=>s._tr).length")
        await pg.evaluate("window.melodeas.S.tracks[3].mute=false"); await pg.wait_for_timeout(300)
        out['unmuted_sources']=await pg.evaluate("[...window.melodeas.activeSrc].filter(s=>s._tr===window.melodeas.S.tracks[3]).length")
        await pg.click('#loopBtn'); await pg.click('#bpmUp'); await pg.click('#bpmUp'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(2500)
        out['after_bpm']=await pg.evaluate("window.melodeas.S.tracks.map(t=>!!t.frozen)"); out['rms_after']=round(await pg.evaluate(RMS,3),4)
        await pg.click('#play'); await pg.wait_for_timeout(300); out['after_stop']=await pg.evaluate("window.melodeas.activeSrc.size")
    out['errors']=errs; await b.close(); return out
async def main():
    async with async_playwright() as p:
        for nf in (False,True): print(json.dumps(await run(p,nf)))
asyncio.run(main())

import asyncio, json, sys, os
from playwright.async_api import async_playwright
URL=sys.argv[1] if len(sys.argv)>1 else 'file://'+os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','index.html'))
NOWL=len(sys.argv)>2
PATCH = """
() => {
  window.__dl=[];
  const orig=URL.createObjectURL.bind(URL);
  // fake microphone: a stream fed from the page's own AudioContext, so test sounds can be placed at exact times
  navigator.mediaDevices.getUserMedia = async () => { const c=window.melodeas.ctx; window.__mic=c.createMediaStreamDestination(); return window.__mic.stream; };
  window.__burst=(kind,t,amp)=>{ const c=window.melodeas.ctx, g=c.createGain(); g.connect(window.melodeas.capNode);
    if(kind==='kick'){ const o=c.createOscillator(); o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(70,t+0.08);
      g.gain.setValueAtTime(amp,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.12); o.connect(g); o.start(t); o.stop(t+0.13); }
    else if(kind==='p'){ const b=c.createBuffer(1,c.sampleRate*0.3,c.sampleRate), d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
      const s=c.createBufferSource(); s.buffer=b; const lo=c.createBiquadFilter(); lo.type='lowpass'; lo.frequency.value=700; const hi=c.createBiquadFilter(); hi.type='highpass'; hi.frequency.value=3000; const hg=c.createGain(); hg.gain.value=0.22;
      g.gain.setValueAtTime(amp*2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.06); s.connect(lo).connect(g); s.connect(hi).connect(hg).connect(g); s.start(t); s.stop(t+0.07); }
    else { const b=c.createBuffer(1,c.sampleRate*0.3,c.sampleRate), d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
      const s=c.createBufferSource(); s.buffer=b; const f=c.createBiquadFilter(); f.type=kind==='snare'?'bandpass':'highpass'; f.frequency.value=kind==='snare'?2500:7000; f.Q.value=1;
      const len=kind==='ohat'?0.3:0.05; g.gain.setValueAtTime(amp,t); if(kind==='ohat')g.gain.setValueAtTime(amp*0.8,t+0.22); g.gain.exponentialRampToValueAtTime(0.001,t+len); s.connect(f).connect(g); s.start(t); s.stop(t+len+0.01); } };
  window.__sing=(midi,t,dur,amp)=>{ const c=window.melodeas.ctx, o=c.createOscillator(), f=c.createBiquadFilter(), g=c.createGain();
    o.type='sawtooth'; o.frequency.value=440*Math.pow(2,(midi-69)/12); f.type='lowpass'; f.frequency.value=1800;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(amp,t+0.02); g.gain.setValueAtTime(amp,t+dur-0.03); g.gain.linearRampToValueAtTime(0,t+dur);
    o.connect(f).connect(g).connect(window.melodeas.capNode); o.start(t); o.stop(t+dur+0.01); };
}
"""
async def wait_state(page, st, timeout=30000):
    await page.wait_for_function("s => window.melodeas.R.state===s", arg=st, timeout=timeout)
async def main():
    fails=0
    def check(name, ok, extra=''):
        nonlocal fails; print(('PASS ' if ok else 'FAIL ')+name+('  '+str(extra) if extra else '')); fails += (not ok)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'), headless=True,
            args=['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'])
        page = await b.new_page(viewport={'width':1180,'height':900})
        errs=[]
        page.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        page.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        await page.goto(URL); await page.evaluate(PATCH)
        if NOWL: await page.evaluate('window.melodeasNoWorklet=true')
        await page.screenshot(path='shot-empty.png', full_page=True)
        # ---- 1. kick+snare, following the click
        await page.click('text=Kick + snare'); await page.click('summary'); await page.fill('#lat','0'); await page.dispatch_event('#lat','change')
        await page.click('#rec'); await wait_state(page,'armed')
        pat=[(0,'kick',.6),(1,'kick',.3),(2,'snare',.6),(3.5,'kick',.6),(4,'kick',.6),(5,'kick',.5),(6,'snare',.6),(6.75,'snare',.25),(7.5,'kick',.5)]
        await page.evaluate("pat => { const m=window.melodeas, sp=60/m.S.bpm; for(const [b,k,a] of pat) window.__burst(k, m.R.tStart+b*sp, a); }", pat)
        await page.screenshot(path='shot-countin.png')
        await wait_state(page,'recording'); await page.screenshot(path='shot-rec.png')
        await wait_state(page,'idle')
        notes = await page.evaluate("window.melodeas.S.tracks[0].notes")
        st = await page.inner_text('#status')
        check('drum take: count', len(notes)==len(pat), f"{len(notes)}/{len(pat)}  status: {st}")
        if len(notes)==len(pat):
            err=[n['t']-q[0] for n,q in zip(notes,pat)]
            check('drum take: timing within 30 ms of the beat', max(abs(e) for e in err)*0.625<0.012, ' '.join(f"{e*625:.0f}ms" for e in err))
            check('drum take: labels', [n['drum'] for n in notes]==[q[1] for q in pat], ''.join(n['drum'][0] for n in notes))
            check('drum take: velocity', notes[1]['v']<notes[0]['v'] and notes[7]['v']<notes[6]['v'], [n['v'] for n in notes])
        # ---- 2. bass over the playing loop
        await page.click('.chip:has-text("Bass")')
        await page.click('#rec'); await wait_state(page,'armed')
        mel=[(0,1.5,45),(2,1,48),(3,1,50),(4,1.5,52),(6,0.5,52),(6.5,0.5,52),(7,1,43)]
        await page.evaluate("mel => { const m=window.melodeas, sp=60/m.S.bpm; for(const [b,d,p] of mel) window.__sing(p, m.R.tStart+b*sp, d*sp*0.9, 0.4); }", mel)
        await wait_state(page,'idle')
        notes = await page.evaluate("window.melodeas.S.tracks[1].notes")
        check('bass take: count', len(notes)==len(mel), f"{len(notes)}/{len(mel)}: "+' '.join(f"{n['p']:.2f}@{n['t']:.2f}" for n in notes))
        if len(notes)==len(mel):
            check('bass take: pitches', [round(n['p']) for n in notes]==[q[2] for q in mel])
            check('bass take: timing', max(abs(n['t']-q[0]) for n,q in zip(notes,mel))*0.625<0.03, ' '.join(f"{(n['t']-q[0])*625:.0f}ms" for n,q in zip(notes,mel)))
        await page.wait_for_timeout(700); await page.screenshot(path='shot-two-tracks.png', full_page=True)
        # ---- 3. MIDI export of what the page plays
        mid = await page.evaluate("Array.from(window.melodeas.DSP.buildMidi(window.melodeas.songForMidi()))")
        open('e2e.mid','wb').write(bytes(mid))
        import mido
        m=mido.MidiFile('e2e.mid')
        tempo=[e for e in m.tracks[0] if e.type=='set_tempo'][0].tempo
        check('midi: 3 tracks, 96 bpm, 2 bars', len(m.tracks)==3 and abs(mido.tempo2bpm(tempo)-96)<0.01 and abs(m.length-5.0)<0.01, f"tracks={len(m.tracks)} len={m.length}")
        bass=[e for e in m.tracks[2] if e.type=='note_on']; drums=[e for e in m.tracks[1] if e.type=='note_on']
        check('midi: bass an octave down, quantised', [e.note for e in bass]==[q[2]-12 for q in mel], [e.note for e in bass])
        t=0; ticks=[]
        for e in m.tracks[1]:
            t+=e.time
            if e.type=='note_on': ticks.append(t)
        check('midi: drum ticks on the 16th grid', ticks==[round(q[0]*480) for q in pat] and all(e.channel==9 for e in drums), ticks)
        check('midi: drum notes', [e.note for e in drums]==[36 if q[1]=='kick' else 38 for q in pat])
        # ---- 4. mix render
        n = await page.evaluate("""async()=>{ let got=null; const a=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){got=this.download;};
            await window.melodeas.exportMix(); HTMLAnchorElement.prototype.click=a; return got; }""")
        check('mix export produces a WAV', bool(n) and n.endswith('.wav'), n)

        # ---- 4a. second take on the drum track adds to the first
        await page.click('.tr >> nth=0 >> .tn')
        await page.click('#rec'); await wait_state(page,'armed')
        await page.evaluate("()=>{ const m=window.melodeas, sp=60/m.S.bpm; window.__burst('snare', m.R.tStart+1.5*sp, 0.5); window.__burst('snare', m.R.tStart+5.5*sp, 0.5); }")
        await wait_state(page,'idle')
        notes = await page.evaluate("window.melodeas.S.tracks[0].notes"); st = await page.inner_text('#status')
        added=[n for n in notes if abs(n['t']-1.5)<0.05 or abs(n['t']-5.5)<0.05]
        check('overdub: 9 + 2 hits, new ones are snare', len(notes)==11 and len(added)==2 and all(n['drum']=='snare' for n in added), f"{len(notes)} notes; status: {st}")
        await page.click('#undo'); n2 = await page.evaluate("window.melodeas.S.tracks[0].notes.length")
        check('undo removes the overdub', n2==9, n2)
        # ---- 4b. drag a bass note one beat right and two semitones up; add and remove notes
        await page.click('.tr >> nth=1 >> .tn'); await page.wait_for_timeout(300)
        geo = "()=>{const tr=window.melodeas.S.tracks[1]; tr.cv.scrollIntoView({block:'center'}); const r=tr.cv.getBoundingClientRect(), q=tr.rects[1]; return {x:r.left+q.x+q.w/2,y:r.top+q.y+q.h/2,left:r.left,top:r.top,beat:tr.geom.w/tr.geom.LB,rh:tr.geom.rh,hh:tr.geom.hh,lo:tr.geom.lo,n:q.n}}"
        g = await page.evaluate(geo); await page.wait_for_timeout(100); g = await page.evaluate(geo)
        await page.mouse.move(g['x'],g['y']); await page.mouse.down(); await page.mouse.move(g['x']+g['beat']*0.5,g['y']-g['rh'],steps=4); await page.mouse.move(g['x']+g['beat'],g['y']-2*g['rh'],steps=4); await page.mouse.up()
        notes = await page.evaluate("window.melodeas.S.tracks[1].notes")
        moved=[n for n in notes if abs(n['t']-3.0)<1e-6 and n['p']==50]
        check('drag: note moved to beat 3, D', len(moved)==1 and len(notes)==7, ' '.join(f"{n['p']:.1f}@{n['t']:.2f}" for n in notes))
        ax=g['left']+g['beat']*1.2; ay=g['top']+g['hh']-(36-g['lo']+0.5)*g['rh']
        await page.mouse.dblclick(ax,ay); notes = await page.evaluate("window.melodeas.S.tracks[1].notes")
        newn=[n for n in notes if abs(n['t']-1.0)<1e-6]
        check('double-click adds a note on the grid', len(notes)==8 and len(newn)==1 and newn[0]['p']==48, ' '.join(f"{n['p']:.1f}@{n['t']:.2f}" for n in notes))
        await page.wait_for_timeout(450); await page.mouse.dblclick(ax+3,ay); n3 = await page.evaluate("window.melodeas.S.tracks[1].notes.length")
        check('double-click removes it again', n3==7, n3)
        # ---- 4c. sound, EQ and reverb per track
        await page.select_option('.tr.sel select[aria-label="Sound"]','bass808')
        r = await page.evaluate("(()=>{const t=window.melodeas.S.tracks[1];return {inst:t.inst,eq:t.eq,oct:t.octave,hp:t.nodes&&t.nodes.hp.frequency.value}})()")
        check('sound change applies that sound\'s default EQ', r['inst']=='bass808' and r['eq']=={'hp':25,'lp':4000} and r['oct']==-1 and abs(r['hp']-25)<0.01, r)
        await page.click('.tr.sel button:has-text("EQ")')
        await page.evaluate("()=>{const i=document.querySelector('.tr.sel input[aria-label=\"Low cut\"]'); i.value=0.5; i.dispatchEvent(new Event('input',{bubbles:true}));}")
        r = await page.evaluate("(()=>{const t=window.melodeas.S.tracks[1];return {eq:t.eq,hp:t.nodes.hp.frequency.value,txt:document.querySelector('.tr.sel .eq output').textContent}})()")
        check('EQ low cut slider moves the filter', 135<r['hp']<150 and r['txt'].endswith('Hz'), r)
        await page.screenshot(path='shot-edit.png', full_page=True)
        # ---- 5. free first take sets tempo
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.click('#play'); await page.click('#clearAll')
        await page.click('text=Set the tempo'); await page.click('.chip:has-text("Hi-hat")')
        await page.click('#rec'); await wait_state(page,'recording')
        await page.evaluate("()=>{ const m=window.melodeas; window.__t0=m.ctx.currentTime+0.4; for(let i=0;i<8;i++) window.__burst(i===3?'ohat':'hat', window.__t0+i*0.5, 0.5); }")
        await page.wait_for_function("window.melodeas.ctx.currentTime >= window.__t0+4.0-0.012")
        await page.click('#rec'); await wait_state(page,'idle')
        r = await page.evaluate("({bpm:window.melodeas.S.bpm,bars:window.melodeas.S.bars,notes:window.melodeas.S.tracks[0].notes,playing:window.melodeas.T.playing})")
        st = await page.inner_text('#status')
        check('free take: tempo found', r['bars']==2 and abs(r['bpm']-120)<=2 and r['playing'], f"{r['bars']} bars {r['bpm']} bpm  status: {st}")
        check('free take: 8 hats, one open', len(r['notes'])==8 and r['notes'][3]['drum']=='ohat' and max(abs(n['t']-i) for i,n in enumerate(r['notes']))<0.08, ' '.join(f"{n['drum']}@{n['t']:.2f}" for n in r['notes']))
        # ---- 6. voice track
        await page.click('.chip:has-text("Voice")'); await page.click('#rec'); await wait_state(page,'armed')
        await page.evaluate("()=>{ const m=window.melodeas; window.__sing(57, m.R.tStart+0.2, 1.0, 0.4); }")
        await wait_state(page,'idle')
        v = await page.evaluate("(()=>{const t=window.melodeas.S.tracks[1]; return t.audio?{n:t.audio.data.length,sr:t.audio.sr,len:t.lenBeats}:null})()")
        check('voice take stored', bool(v) and abs(v['n']/v['sr']-4.0)<0.05, v)

        # ---- 7. voice layering, then a kick-only take of breathy "p" sounds
        await page.click('#rec'); await wait_state(page,'armed')
        await page.evaluate("()=>{ const m=window.melodeas; window.__sing(64, m.R.tStart+2.0, 1.0, 0.4); }")
        await wait_state(page,'idle'); st = await page.inner_text('#status')
        check('voice overdub layers', 'on top' in st, st)
        await page.click('#play'); await page.click('#clearAll'); await page.click('text=Follow the click')
        await page.click('text=Kick + snare'); await page.click('#rec'); await wait_state(page,'armed')
        await page.evaluate("()=>{ const m=window.melodeas, sp=60/m.S.bpm; for(const b of [0,2,4,6]) window.__burst('p', m.R.tStart+b*sp, 0.5); }")
        await wait_state(page,'idle')
        notes = await page.evaluate("window.melodeas.S.tracks[0].notes")
        check('only "p" sounds: all four are kicks', len(notes)==4 and all(n['drum']=='kick' for n in notes), ' '.join(f"{n['drum']}@{round(2**n['f'])}Hz" for n in notes))
        # correct one to snare by clicking it: later takes of that sound follow the correction
        g = await page.evaluate("()=>{const tr=window.melodeas.S.tracks[0]; tr.cv.scrollIntoView({block:'center'}); const r=tr.cv.getBoundingClientRect(), q=tr.rects[0]; return {x:r.left+q.x+q.w/2,y:r.top+q.y+q.h/2}}")
        g = await page.evaluate("()=>{const tr=window.melodeas.S.tracks[0]; const r=tr.cv.getBoundingClientRect(), q=tr.rects[0]; return {x:r.left+q.x+q.w/2,y:r.top+q.y+q.h/2}}")
        await page.wait_for_timeout(400); await page.mouse.click(g['x'],g['y'])
        r = await page.evaluate("({d:window.melodeas.S.tracks[0].notes[0].drum,l:window.melodeas.S.learned.length})")
        check('click switches kick to snare and is remembered', r['d']=='snare' and r['l']==1, r)
        await page.wait_for_timeout(400); await page.screenshot(path='shot-final.png', full_page=True)
        await page.set_viewport_size({'width':390,'height':800}); await page.wait_for_timeout(300); await page.screenshot(path='shot-mobile.png', full_page=True)
        check('no console errors', not errs, errs[:5])
        print('     capture/analysis path:', await page.evaluate('window.melodeas.mode'))
        await b.close()
    print('\n%d FAILED'%fails if fails else '\nall passed'); sys.exit(1 if fails else 0)
asyncio.run(main())

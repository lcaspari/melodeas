# Building and testing

`../index.html` is generated. Edit the sources here, then rebuild.

| File | What it is |
| --- | --- |
| `index.src.html` | Page markup and styles, with placeholders for the two scripts |
| `dsp.js` | Detection (onsets, drum sorting, pitch, notes), music helpers, MIDI and WAV writers. No browser APIs, so it runs in Node |
| `app.js` | The page: recording, transport, instruments, effects, editing, export |
| `lvl.json` | Loudness correction per instrument, from `audit.py` |
| `build.js` | Puts the pieces together into `../index.html` |

```
node build.js          # rebuild ../index.html
node test.js           # detection and MIDI tests on synthetic audio
node carnoise.js       # detection with synthetic car noise in the background
python3 e2e.py         # full run in headless Chrome (needs playwright and mido; set CHROME to your Chrome binary)
python3 audit.py       # renders every instrument and prints its level
```

# Melodeas

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/lcaspari)
[![PayPal](https://img.shields.io/badge/PayPal-0070BA?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/LucaCaspari)

Try it at **[melodeas.net](https://melodeas.net)**.

A loop station you play with your voice. Sing or beatbox a track, and it comes back as MIDI notes played by an instrument. Export the loop as a MIDI file for Ableton.

Everything is in `index.html`. No install, no build step, no network.

## Online

https://melodeas.net, served over https, so the microphone works in every browser and on a phone. The same site is also available at https://lcaspari.github.io/melodeas/.

## Start from this folder

- **Chrome or Edge:** open `index.html` and allow the microphone.
- **Safari or Firefox:** double-click `start.command` (it serves the folder on http://localhost:8123 and opens it). These browsers only give microphone access to localhost or https pages.

## Use

1. Tap an instrument in the bar at the top. It is added and comes to the front.
2. Press the red button. You get a one-bar count-in, then one round of the loop to perform.
3. The take is converted and starts looping. Tap the next instrument and repeat. Recording again into an instrument adds to what is already there; "Clear" empties it and "Undo last change" in the menu steps back.
4. "Export MIDI" in the menu writes a `.mid` with one track per instrument, tempo and velocities.

All instruments share one board: melodies on a piano roll, drums in rows below, voice as a waveform on top. The selected instrument is shown in its colour in front, with its controls (sound, octave, EQ, mute, volume) between the board and the record bar; the others are grey behind it. Tap the selected instrument again to see everything in colour. An instrument you leave with nothing recorded in it is removed again.

**Zoom and scroll:** pinch the board with two fingers or hold Ctrl and scroll to zoom; drag an empty spot or scroll to move left and right. The −, + and Fit buttons on the board do the same.

**Mixer:** with no instrument selected, the bar above the record button lists the recorded instruments. Tap one to mute it, tap again to bring it back.
 On the piano roll every instrument is drawn in the same octave, so a bass two octaves below the keys does not stretch the view; octaves only count inside one instrument, and the C labels show the octave of the selected one.

What to perform:

| Track | What to do |
| --- | --- |
| Kick + snare | "p" or "b" for kick, "k" for snare |
| Hi-hat | "ts ts"; a long "tsss" becomes an open hat |
| Full kit | "p", "k" and "ts" in one take |
| Toms | "dum dum" at different pitches; higher and lower sounds become higher and lower toms |
| Bass, Lead, Pluck, Keys, Pad, Brass | sing or hum, one note at a time |
| Voice | recorded as audio, not converted |

## Sounds

Select an instrument to see its controls. All sounds are synthesised in the browser (Web Audio), with reverb and echo.

- **Drum kits:** Punchy, 808, Boom bap, Trap.
- **Bass:** Synth bass, Sub bass, 808 bass, Reese bass, Acid bass.
- **Lead:** Supersaw, Square lead, Pluck, FM bell.
- **Keys:** Electric piano, Piano, Lo-fi keys, Organ.
- **Pads and brass:** Warm pad, Strings, Synth brass, Trumpet.
- **Percussion:** Toms.

**Dynamics:** on sounds with long notes (pads, strings, brass, organ, sustained basses and leads) each note follows how loud you sang it, so a slow fade-in stays a fade-in. The "Dynamics" button on the track switches this off. In the MIDI file it is written as expression (CC 11).

**EQ** on a track opens a low cut, a high cut and a reverb amount. Every sound starts with a default that follows common mixing practice (for example hi-hats cut below 450 Hz, leads below 140 Hz, sub bass above 1.5 kHz, bass and drums with no reverb).

## Editing notes

In the selected instrument: drag a note to move it in time and pitch (or between drums), drag its right edge to change its length, double-click it to remove it, double-click an empty spot to add one. Clicking a drum hit switches the drum.

"Snap timing to" and "Snap pitch to" can be changed after recording; the original performance is kept.

## Choices made in this version

- **Tempo:** the default is a metronome with a count-in, because it is the most reliable. "First take: Set the tempo" is the loop-pedal way: no click, press the button again on the first beat of the next round, and the tempo and bar count are worked out from the take.
- **Speakers:** in "Speakers" mode the loop is turned down while recording and the browser's echo cancelling is switched on. "Headphones" turns both off and gives the cleanest detection.
- **Timing offset:** sound takes time to leave the speakers and return through the mic. The page estimates this; "Measure with speakers" in Settings measures it properly.
- **Detection:** onsets come from spectral flux, drums are sorted by brightness (dark = kick, mid = snare, bright = hat), pitch comes from the YIN algorithm. Velocity follows how loud each hit or note was.
- **Kick or snare:** a take with only one kind of sound on a Kick + snare track is read as kick unless it is clearly bright. A second take is compared with the hits already on the track. When you correct a hit, that sound is remembered and later takes follow the correction.
- **Each track keeps its own length**, so a 1-bar beat keeps repeating under a 4-bar bass line if you change "Loop length" between takes.
- **Playback:** each instrument track is rendered once into an audio buffer and looped, so many tracks play smoothly. Editing a track re-renders just that track in the background.

## Known limits

- One note at a time per melodic track (no chords).
- Voice tracks are audio: they are not in the MIDI file (use the WAV button on the track), and the autosave in the browser does not keep them. "Save project" does.
- Changing the tempo after recording a voice track plays it faster or slower, like tape.

## Support

Melodeas is free. If it helps you catch ideas, you can [buy me a coffee](https://buymeacoffee.com/lcaspari) or send something via [PayPal](https://paypal.me/LucaCaspari).

## Development

`index.html` is built from the sources in `dev/`. See `dev/README.md`.

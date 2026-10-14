# MaxTunes

A music notation and composition studio that runs in the browser. Write scores with the mouse or keyboard, play them back, or play your instrument into the microphone and have MaxTunes transcribe it and write an accompaniment under it.

**Try it:** https://maxvbuda.github.io/maxtunes/

## Features

- **Engraving:** scores are drawn with VexFlow (Bravura font). Supports multiple parts and staves, clefs, key and time signatures, tempo, ties, slurs, tuplets, articulations, dynamics, chord symbols and bar text.
- **Note input:** click on the staff, or type letters, durations and accidentals (see the shortcuts below).
- **Playback:** a Web Audio synthesizer with a mixer, plus a metronome and count-in.
- **Record and arrange:** play into the microphone after a one-bar count-in.
  - Pitch is detected with YIN and snapped to the grid you choose, then written at the caret.
  - MaxTunes detects the key and picks a chord progression with a Viterbi pass over the diatonic chords.
  - It writes an accompaniment on the piano left hand if that staff is free, otherwise on an Accompaniment part. Styles: sustained chords, *marcato* (every beat), or *síncopa* (3-3-2).
- **Import and export:**
  - Open: MaxTunes JSON and MusicXML.
  - Export: MaxTunes JSON, MusicXML (for Sibelius, Finale, MuseScore and others), MIDI, SVG and PNG.
  - Print.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | Toggle note input |
| `A`–`G` | Enter a note (`Shift` adds it to a chord) |
| `1`–`7` | Duration: whole, half, quarter, 8th, 16th, 32nd, 64th |
| `0` | Rest |
| `.` | Dot |
| `#` / `-` / `=` | Sharp / flat / natural |
| `T` / `S` | Tie / slur |
| `↑` / `↓` | Move the selection by a step (`⌘` moves it an octave) |
| `←` / `→` | Move the caret |
| `Space` | Play or stop (`Shift` plays from the start) |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘C` / `⌘V` | Copy / paste a bar |
| `⌘K` | Add a chord symbol |
| `⇧⌘F` | Record from the microphone |
| `⌘S` | Save the score |

## Development

```sh
npm install
npm run dev      # http://localhost:5180
npm run build    # production build in dist/
```

Built with React 19, Zustand, VexFlow 5 and Vite.

Every push to `main` builds the app and deploys it to GitHub Pages (see `.github/workflows/pages.yml`).

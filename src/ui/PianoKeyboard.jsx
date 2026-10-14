import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { audio } from '../audio/engine.js';
import { buildTimeline } from '../core/timing.js';
import { midiToPitch, pitchName } from '../core/theory.js';

const WHITE_W = 23;
const BLACK_W = 14;
const LOW = 36;   // C2
const HIGH = 96;  // C7
const BLACK = new Set([1, 3, 6, 8, 10]);

export default function PianoKeyboard() {
  const score = useStore((s) => s.score);
  const cursor = useStore((s) => s.cursor);
  const playing = useStore((s) => s.playback.playing);
  const inputMidi = useStore((s) => s.inputMidi);
  const noteInput = useStore((s) => s.tool.noteInput);
  const [lit, setLit] = useState(() => new Set());

  const timeline = useMemo(() => buildTimeline(score), [score]);

  useEffect(() => {
    if (!playing) { setLit(new Set()); return undefined; }
    let raf = 0;
    const step = () => {
      const pos = audio.position();
      const set = new Set();
      for (const e of timeline.events) {
        if (e.time > pos) break;
        if (pos < e.time + e.duration) set.add(e.midi);
      }
      setLit(set);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeline]);

  const keys = useMemo(() => {
    const out = [];
    let whiteIndex = 0;
    for (let midi = LOW; midi <= HIGH; midi++) {
      const black = BLACK.has(midi % 12);
      if (black) {
        out.push({ midi, black, x: whiteIndex * WHITE_W - BLACK_W / 2 });
      } else {
        out.push({ midi, black, x: whiteIndex * WHITE_W });
        whiteIndex++;
      }
    }
    return { list: out, width: whiteIndex * WHITE_W };
  }, []);

  const press = (midi, shift) => {
    const part = score.parts[cursor.partIndex];
    audio.preview(midi, part?.instrumentId || 'piano', 0.85, 1);
    if (noteInput) inputMidi(midi, { chord: shift, audition: false });
  };

  return (
    <div className="keyboard-wrap">
      <div className="piano" style={{ width: keys.width }}>
        {keys.list.filter((k) => !k.black).map((k) => (
          <div
            key={k.midi}
            className={`pkey${lit.has(k.midi) ? ' lit' : ''}`}
            style={{ left: k.x, width: WHITE_W - 1, height: 82 }}
            onMouseDown={(e) => press(k.midi, e.shiftKey)}
            title={pitchName(midiToPitch(k.midi))}
          >
            {k.midi % 12 === 0 && <span className="lbl">C{Math.floor(k.midi / 12) - 1}</span>}
          </div>
        ))}
        {keys.list.filter((k) => k.black).map((k) => (
          <div
            key={k.midi}
            className={`pkey black${lit.has(k.midi) ? ' lit' : ''}`}
            style={{ left: k.x, width: BLACK_W, height: 52 }}
            onMouseDown={(e) => press(k.midi, e.shiftKey)}
            title={pitchName(midiToPitch(k.midi))}
          />
        ))}
      </div>
    </div>
  );
}

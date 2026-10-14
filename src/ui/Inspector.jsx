import { useStore } from '../store.js';
import { findEvent, timeSigAt, keySigAt } from '../core/score.js';
import {
  pitchName, DURATIONS, ARTICULATIONS, DYNAMICS, KEY_NAMES, TIME_SIGNATURES, pitchToMidi,
  TECHNIQUES,
} from '../core/theory.js';
import { INSTRUMENTS } from '../core/instruments.js';

export default function Inspector() {
  const score = useStore((s) => s.score);
  const selection = useStore((s) => s.selection);
  const cursor = useStore((s) => s.cursor);
  const store = useStore.getState();

  const loc = selection.length === 1 ? findEvent(score, selection[0]) : null;
  const ev = loc?.ev;
  const part = score.parts[cursor.partIndex];
  const ts = timeSigAt(score, cursor.measureIndex);
  const fifths = keySigAt(score, cursor.measureIndex);

  return (
    <div className="side right">
      <div className="side-head"><span>Inspector</span></div>
      <div className="side-body">
        <div className="side-section">
          <h4>Selection</h4>
          {!ev && <div className="hint">Click a note to inspect it. Shift-click adds to the selection.</div>}
          {ev && (
            <>
              <div className="form-row">
                <label>Type</label>
                <span>{ev.kind === 'rest' ? 'Rest' : ev.pitches.length > 1 ? 'Chord' : 'Note'}</span>
              </div>
              {ev.kind === 'note' && (
                <div className="form-row">
                  <label>Pitch</label>
                  <span>{ev.pitches.map(pitchName).join(' · ')}</span>
                </div>
              )}
              {ev.kind === 'note' && (
                <div className="form-row">
                  <label>MIDI</label>
                  <span>{ev.pitches.map((p) => pitchToMidi(p)).join(', ')}</span>
                </div>
              )}
              <div className="form-row">
                <label>Value</label>
                <select
                  value={ev.dur.base}
                  onChange={(e) => store.applyDurationToSelection(Number(e.target.value))}
                >
                  {DURATIONS.map((d) => <option key={d.base} value={d.base}>{d.label}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Bar · beat</label>
                <span>{loc.measureIndex + 1} · voice {loc.voiceIndex + 1}</span>
              </div>
              <div className="form-row">
                <label>Articulations</label>
              </div>
              <div className="chip-row">
                {ARTICULATIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`chip${ev.articulations?.includes(a.id) ? ' on' : ''}`}
                    onClick={() => store.toggleArticulation(a.id)}
                  >{a.label}</button>
                ))}
              </div>
              <div className="form-row" style={{ marginTop: 10 }}><label>Dynamic</label></div>
              <div className="chip-row">
                {DYNAMICS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip${ev.dynamic === d ? ' on' : ''}`}
                    onClick={() => store.setDynamic(d)}
                  >{d}</button>
                ))}
              </div>
              <div className="form-row" style={{ marginTop: 10 }}><label>Tango technique</label></div>
              <div className="chip-row">
                {TECHNIQUES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip${ev.technique === t.id ? ' on' : ''}`}
                    onClick={() => store.setTechnique(t.id)}
                  >{t.label}</button>
                ))}
              </div>
              <div className="form-row" style={{ marginTop: 10 }}>
                <label>Chord symbol</label>
                <input
                  type="text"
                  value={ev.chord || ''}
                  placeholder="Am7"
                  spellCheck={false}
                  onChange={(e) => store.setChord(ev.id, e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Lyric</label>
                <input
                  type="text"
                  value={ev.lyric || ''}
                  placeholder="—"
                  onChange={(e) => store.setLyric(ev.id, e.target.value)}
                />
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <button type="button" className={`chip${ev.tie ? ' on' : ''}`} onClick={store.toggleTie}>Tie</button>
                <button type="button" className="chip" onClick={() => store.transposeSelection(12)}>+8ve</button>
                <button type="button" className="chip" onClick={() => store.transposeSelection(-12)}>−8ve</button>
              </div>
            </>
          )}
        </div>

        <div className="side-section">
          <h4>Bar {cursor.measureIndex + 1}</h4>
          <div className="form-row">
            <label>Time</label>
            <select
              value={`${ts.n}/${ts.d}`}
              onChange={(e) => {
                const [n, d] = e.target.value.split('/').map(Number);
                store.setTimeSignature(cursor.measureIndex, { n, d });
              }}
            >
              {TIME_SIGNATURES.map((t) => (
                <option key={`${t.n}/${t.d}`} value={`${t.n}/${t.d}`}>{t.n}/{t.d}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Key</label>
            <select
              value={fifths}
              onChange={(e) => store.setKeySignature(cursor.measureIndex, Number(e.target.value))}
            >
              {Object.entries(KEY_NAMES).map(([f, name]) => (
                <option key={f} value={f}>{name} major</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Tempo</label>
            <input
              type="number"
              min="20"
              max="300"
              value={score.measures[cursor.measureIndex]?.tempo || ''}
              placeholder={String(score.tempo)}
              onChange={(e) => store.setTempo(Number(e.target.value) || score.tempo, cursor.measureIndex)}
            />
          </div>
        </div>

        <div className="side-section">
          <h4>Instrument</h4>
          <div className="form-row">
            <label>Sound</label>
            <select
              value={part?.instrumentId}
              onChange={(e) => store.changeInstrument(cursor.partIndex, e.target.value)}
            >
              {INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Name</label>
            <input
              type="text"
              value={part?.name || ''}
              onChange={(e) => store.setPartProps(cursor.partIndex, { name: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>Transposition</label>
            <input
              type="number"
              min="-24"
              max="24"
              value={part?.transpose || 0}
              onChange={(e) => store.setPartProps(cursor.partIndex, { transpose: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

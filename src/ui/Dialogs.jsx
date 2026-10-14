import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { INSTRUMENTS, INSTRUMENT_FAMILIES } from '../core/instruments.js';
import { KEY_NAMES, MINOR_KEY_NAMES, TIME_SIGNATURES } from '../core/theory.js';
import { createScore, findEvent } from '../core/score.js';
import { audio } from '../audio/engine.js';

function Dialog({ title, onClose, children, footer, width }) {
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" style={width ? { width } : undefined}>
        <header>
          <span>{title}</span>
          <button type="button" className="btn ghost" onClick={onClose}>✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** Lowercase and strip accents so "bandoneon" finds "Bandoneón". */
const fold = (text) => text.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function InstrumentList({ selected, onPick, multi }) {
  const [query, setQuery] = useState('');
  const grouped = useMemo(() => {
    const q = fold(query);
    return INSTRUMENT_FAMILIES.map((family) => ({
      family,
      items: INSTRUMENTS.filter((i) => i.family === family && (!q || fold(i.name).includes(q))),
    })).filter((g) => g.items.length);
  }, [query]);

  return (
    <>
      <div className="form-row">
        <label>Search</label>
        <input type="text" value={query} placeholder="flute, guitar…" onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="inst-list">
        {grouped.map((g) => (
          <div key={g.family}>
            <div className="fam-head">{g.family}</div>
            {g.items.map((i) => (
              <div
                key={i.id}
                className={`inst-item${selected?.includes(i.id) ? ' sel' : ''}`}
                onClick={() => { onPick(i.id); audio.preview(64, i.id, 0.7, 0.7); }}
              >
                <span>{i.name}</span>
                <span className="fam">{i.staves > 1 ? `${i.staves} staves` : i.clefs[0]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {multi && <div className="hint" style={{ marginTop: 8 }}>Click to add — pick the same instrument twice for e.g. Violin I and II.</div>}
    </>
  );
}

export default function Dialogs({ open, onClose }) {
  const store = useStore.getState();
  const score = useStore((s) => s.score);
  const cursor = useStore((s) => s.cursor);
  const selection = useStore((s) => s.selection);

  const [draft, setDraft] = useState(() => ({
    title: 'Untitled Score',
    composer: '',
    instruments: ['piano'],
    timeSig: '4/4',
    keySig: 0,
    tempo: 100,
    measureCount: 16,
  }));
  const [lyricText, setLyricText] = useState('');

  if (!open) return null;

  if (open === 'new') {
    return (
      <Dialog
        title="New score"
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const [n, d] = draft.timeSig.split('/').map(Number);
                store.replaceScore(createScore({
                  title: draft.title,
                  composer: draft.composer,
                  instruments: draft.instruments.length ? draft.instruments : ['piano'],
                  measureCount: Math.max(1, Number(draft.measureCount) || 16),
                  timeSig: { n, d },
                  keySig: Number(draft.keySig),
                  tempo: Number(draft.tempo) || 100,
                }), 'new');
                onClose();
              }}
            >Create score</button>
          </>
        )}
      >
        <div className="inst-grid">
          <div>
            <div className="form-row">
              <label>Title</label>
              <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Composer</label>
              <input type="text" value={draft.composer} onChange={(e) => setDraft({ ...draft, composer: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Time signature</label>
              <select value={draft.timeSig} onChange={(e) => setDraft({ ...draft, timeSig: e.target.value })}>
                {TIME_SIGNATURES.map((t) => <option key={`${t.n}/${t.d}`}>{`${t.n}/${t.d}`}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Key</label>
              <select value={draft.keySig} onChange={(e) => setDraft({ ...draft, keySig: Number(e.target.value) })}>
                {Object.entries(KEY_NAMES).map(([f, name]) => (
                  <option key={f} value={f}>{name} major / {MINOR_KEY_NAMES[f]}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Tempo ♩=</label>
              <input type="number" value={draft.tempo} onChange={(e) => setDraft({ ...draft, tempo: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Bars</label>
              <input type="number" value={draft.measureCount} onChange={(e) => setDraft({ ...draft, measureCount: e.target.value })} />
            </div>
            <h4 style={{ margin: '14px 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-dim)' }}>
              Chosen instruments
            </h4>
            {draft.instruments.length === 0 && <div className="hint">Pick instruments from the list.</div>}
            <div className="inst-list" style={{ maxHeight: 150 }}>
              {draft.instruments.map((id, index) => (
                <div className="inst-item" key={`${id}-${index}`}>
                  <span>{INSTRUMENTS.find((i) => i.id === id)?.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove"
                    onClick={() => setDraft({
                      ...draft,
                      instruments: draft.instruments.filter((_, i) => i !== index),
                    })}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <InstrumentList
              multi
              selected={[]}
              onPick={(id) => setDraft({ ...draft, instruments: [...draft.instruments, id] })}
            />
          </div>
        </div>
      </Dialog>
    );
  }

  if (open === 'instruments') {
    return (
      <Dialog
        title="Add instruments"
        onClose={onClose}
        footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}
      >
        <div className="inst-grid">
          <div>
            <h4 style={{ marginTop: 0 }}>In this score</h4>
            <div className="inst-list">
              {score.parts.map((p, i) => (
                <div key={p.id} className="inst-item">
                  <span>{p.name}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove"
                    onClick={() => store.removePart(i)}
                    disabled={score.parts.length <= 1}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 style={{ marginTop: 0 }}>Available</h4>
            <InstrumentList selected={[]} onPick={(id) => store.addPart(id)} />
          </div>
        </div>
      </Dialog>
    );
  }

  if (open === 'key') {
    return (
      <Dialog title={`Key signature — from bar ${cursor.measureIndex + 1}`} onClose={onClose}>
        <div className="chip-row">
          {Object.entries(KEY_NAMES).map(([f, name]) => (
            <button
              key={f}
              type="button"
              className="chip"
              onClick={() => { store.setKeySignature(cursor.measureIndex, Number(f)); onClose(); }}
            >{name} major · {MINOR_KEY_NAMES[f]}</button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Existing notes are respelled to fit the new key.
        </div>
      </Dialog>
    );
  }

  if (open === 'time') {
    return (
      <Dialog title={`Time signature — from bar ${cursor.measureIndex + 1}`} onClose={onClose}>
        <div className="chip-row">
          {TIME_SIGNATURES.map((t) => (
            <button
              key={`${t.n}/${t.d}`}
              type="button"
              className="chip"
              onClick={() => { store.setTimeSignature(cursor.measureIndex, t); onClose(); }}
            >{t.n}/{t.d}</button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Bars from here on are re-fitted; anything that no longer fits is trimmed to the bar.
        </div>
      </Dialog>
    );
  }

  if (open === 'info') {
    return (
      <Dialog title="Score information" onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
        {[['title', 'Title'], ['subtitle', 'Subtitle'], ['composer', 'Composer'], ['lyricist', 'Lyricist'], ['copyright', 'Copyright']].map(([key, label]) => (
          <div className="form-row" key={key}>
            <label>{label}</label>
            <input type="text" value={score[key] || ''} onChange={(e) => store.setMeta({ [key]: e.target.value })} />
          </div>
        ))}
      </Dialog>
    );
  }

  if (open === 'lyrics') {
    return (
      <Dialog
        title="Add lyrics"
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                const words = lyricText.split(/\s+/).filter(Boolean);
                const loc = selection.length ? findEvent(score, selection[0]) : null;
                if (!loc || !words.length) { onClose(); return; }
                store.apply((draft) => {
                  const staff = draft.parts[loc.partIndex].staves[loc.staffIndex];
                  let w = 0;
                  for (let m = loc.measureIndex; m < staff.bars.length && w < words.length; m++) {
                    const voice = staff.bars[m].voices[loc.voiceIndex] || [];
                    for (const ev of voice) {
                      if (w >= words.length) break;
                      if (m === loc.measureIndex && voice.indexOf(ev) < loc.index) continue;
                      if (ev.kind !== 'note') continue;
                      ev.lyric = words[w++];
                    }
                  }
                }, 'lyrics');
                setLyricText('');
                onClose();
              }}
            >Apply</button>
          </>
        )}
      >
        <div className="hint" style={{ marginBottom: 10 }}>
          Words are assigned one per note, starting at the selected note and running through the following bars.
        </div>
        <textarea
          value={lyricText}
          onChange={(e) => setLyricText(e.target.value)}
          rows={4}
          style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--paper)', color: 'var(--text)' }}
          placeholder="Twin-kle twin-kle lit-tle star"
        />
      </Dialog>
    );
  }

  if (open === 'shortcuts') {
    const rows = [
      ['Note input mode', 'N'],
      ['Note values', '1 … 7'],
      ['Dotted note', '.'],
      ['Write pitch by letter', 'A – G'],
      ['Add note to chord', 'Shift + letter'],
      ['Rest', '0'],
      ['Sharp / flat / natural', '# / - / ='],
      ['Move caret', '← →'],
      ['Change staff', '↑ ↓ with Alt'],
      ['Transpose selection', '↑ ↓'],
      ['Transpose an octave', 'Ctrl + ↑ ↓'],
      ['Tie', 'T'],
      ['Slur over selection', 'S'],
      ['Delete / turn into rest', 'Backspace'],
      ['Play / pause', 'Space'],
      ['Play from caret', 'Shift + Space'],
      ['Record from microphone', '⇧⌘F'],
      ['Stop recording', 'Space / Esc'],
      ['Undo / redo', '⌘Z / ⇧⌘Z'],
      ['Copy bar / paste', '⌘C / ⌘V'],
      ['Save score file', '⌘S'],
      ['Print', '⌘P'],
      ['Zoom in / out', '⌘+ / ⌘−'],
    ];
    return (
      <Dialog title="Keyboard shortcuts" onClose={onClose}>
        <div className="shortcut-grid">
          {rows.map(([label, key]) => (
            <div className="k" key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </Dialog>
    );
  }

  if (open === 'about') {
    return (
      <Dialog title="About MaxTunes" onClose={onClose} width={520}>
        <p style={{ marginTop: 0 }}>
          <b>MaxTunes</b> is a browser-based notation and composition studio: write for up to
          dozens of instruments, hear the score through a built-in synthesiser, and export
          MusicXML, MIDI, SVG or PNG.
        </p>
        <p className="hint">
          Engraving by VexFlow. Playback is synthesised live with the Web Audio API — no samples
          are downloaded. Your work autosaves to this browser.
        </p>
      </Dialog>
    );
  }

  return null;
}

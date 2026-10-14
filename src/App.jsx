import { useCallback, useEffect, useState } from 'react';
import { useStore } from './store.js';
import Ribbon from './ui/Ribbon.jsx';
import ScoreView from './ui/ScoreView.jsx';
import PartsPanel from './ui/PartsPanel.jsx';
import Inspector from './ui/Inspector.jsx';
import Transport from './ui/Transport.jsx';
import PianoKeyboard from './ui/PianoKeyboard.jsx';
import Mixer from './ui/Mixer.jsx';
import Dialogs from './ui/Dialogs.jsx';
import ListenPanel from './ui/ListenPanel.jsx';
import { useKeyboardShortcuts, useMidiInput } from './ui/useKeyboard.js';
import { audio } from './audio/engine.js';
import { timeSigAt, keySigAt } from './core/score.js';
import { KEY_NAMES } from './core/theory.js';

export default function App() {
  const view = useStore((s) => s.view);
  const score = useStore((s) => s.score);
  const cursor = useStore((s) => s.cursor);
  const tool = useStore((s) => s.tool);
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);
  const setMeta = useStore((s) => s.setMeta);
  const [dialog, setDialog] = useState(null);
  const [midiStatus, setMidiStatus] = useState('');

  useKeyboardShortcuts();
  useMidiInput(useCallback((m) => setMidiStatus(m), []));

  useEffect(() => {
    document.documentElement.dataset.theme = view.theme;
  }, [view.theme]);

  useEffect(() => {
    const unlock = () => audio.ensure();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    audio.syncParts(score);
  }, [score.parts]);

  useEffect(() => {
    if (!status) return undefined;
    const t = setTimeout(() => setStatus(''), 4000);
    return () => clearTimeout(t);
  }, [status, setStatus]);

  const ts = timeSigAt(score, cursor.measureIndex);
  const fifths = keySigAt(score, cursor.measureIndex);
  const part = score.parts[cursor.partIndex];

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">
          <span className="mark">♪</span>
          <span>MaxTunes</span>
          <span className="ver">Notation Studio</span>
        </div>
        <div className="doc-title">
          <input
            className="title-main"
            value={score.title}
            onChange={(e) => setMeta({ title: e.target.value })}
            placeholder="Untitled Score"
          />
          <input
            className="title-sub"
            value={score.composer}
            onChange={(e) => setMeta({ composer: e.target.value })}
            placeholder="Composer"
          />
        </div>
        <button type="button" className="btn" onClick={() => setDialog('new')}>New</button>
        <button type="button" className="btn" onClick={() => setDialog('shortcuts')}>Shortcuts</button>
      </div>

      <Ribbon onDialog={setDialog} />

      <div className="workspace">
        <PartsPanel onDialog={setDialog} />
        <ScoreView />
        {view.showInspector && <Inspector />}
      </div>

      <div className="dock">
        <ListenPanel />
        <Transport />
        {view.showMixer && <Mixer />}
        {view.showKeyboard && <PianoKeyboard />}
      </div>

      <div className="statusbar">
        <span>
          <b>{part?.name || '—'}</b>
          {part?.staves.length > 1 ? ` · staff ${cursor.staffIndex + 1}` : ''}
        </span>
        <span>Bar <b>{cursor.measureIndex + 1}</b> / {score.measures.length}</span>
        <span>{ts.n}/{ts.d} · {KEY_NAMES[String(fifths)]} major · ♩={score.tempo}</span>
        <span>{tool.noteInput ? 'Note input on — click the staff or type A–G' : 'Selection mode — click notes to edit'}</span>
        <span className="sp" />
        {midiStatus && <span>{midiStatus}</span>}
        {status && <span><b>{status}</b></span>}
        <span>{Math.round(view.zoom * 100)}%</span>
      </div>

      <Dialogs open={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

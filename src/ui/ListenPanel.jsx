import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { listener } from '../audio/listen.js';
import { keySigAt } from '../core/score.js';
import { midiToPitch, pitchName } from '../core/theory.js';

export default function ListenPanel() {
  const listen = useStore((s) => s.listen);
  const score = useStore((s) => s.score);
  const stopListening = useStore((s) => s.stopListening);
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (listen.phase !== 'recording') {
      setLive(null);
      return undefined;
    }
    let raf = 0;
    const step = () => {
      setLive(listener.live());
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [listen.phase]);

  if (listen.phase === 'idle' || !listen.target) return null;

  const { target } = listen;
  const part = score.parts[target.partIndex];
  const staffLabel = part?.staves.length > 1 ? ` · staff ${target.staffIndex + 1}` : '';

  let title = 'Waiting for the microphone…';
  let detail = 'Allow access when the browser asks';
  if (listen.phase === 'processing') {
    title = listen.arrange === 'off' ? 'Writing what you played…' : 'Writing and arranging what you played…';
    detail = '';
  } else if (listen.phase === 'recording' && live) {
    if (live.countdown > 0) {
      title = `Count-in · ${live.countdown}`;
      detail = `Starts at bar ${target.measureIndex + 1} — ${part?.name}${staffLabel}`;
    } else {
      title = `Recording · bar ${target.measureIndex + live.bar + 1}, beat ${live.beat + 1}`;
      detail = `${part?.name}${staffLabel}`;
    }
  }

  // Show the note as it will be written, which differs from concert pitch on transposing parts.
  const heard = live?.midi ?? null;
  const written = heard === null ? null
    : midiToPitch(Math.round(heard) - (part?.transpose || 0), keySigAt(score, target.measureIndex));
  const cents = heard === null ? 0 : Math.round((heard - Math.round(heard)) * 100);
  const db = live?.level > 0 ? 20 * Math.log10(live.level) : -80;
  const levelPct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

  return (
    <div className={`listen-panel ${listen.phase}`} role="status" aria-live="polite">
      <span className="rec-dot" />
      <div className="listen-state">
        <b>{title}</b>
        {detail && <span>{detail}</span>}
      </div>
      {listen.phase === 'recording' && (
        <>
          <div className="tuner" title="Pitch the microphone is hearing">
            <span className="tuner-note">{written ? pitchName(written) : '—'}</span>
            <div className="tuner-scale"><i style={{ left: `${50 + cents}%`, opacity: written ? 1 : 0 }} /></div>
            <span className="tuner-cents">{written ? `${cents > 0 ? '+' : ''}${cents}¢` : ''}</span>
          </div>
          <div className="level" title="Input level"><i style={{ width: `${levelPct}%` }} /></div>
          {listen.click && <span className="listen-hint">Headphones keep the click out of the mic</span>}
        </>
      )}
      <button type="button" className="btn" onClick={stopListening} disabled={listen.phase === 'processing'}>
        ■ Stop <kbd>Space</kbd>
      </button>
    </div>
  );
}

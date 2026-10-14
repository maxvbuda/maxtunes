import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { audio } from '../audio/engine.js';
import { buildTimeline } from '../core/timing.js';

const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export default function Transport() {
  const score = useStore((s) => s.score);
  const playback = useStore((s) => s.playback);
  const setPlayback = useStore((s) => s.setPlayback);
  const togglePlay = useStore((s) => s.togglePlay);
  const stopPlayback = useStore((s) => s.stopPlayback);
  const play = useStore((s) => s.play);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const cursor = useStore((s) => s.cursor);
  const listening = useStore((s) => s.listen.phase !== 'idle');
  const startListening = useStore((s) => s.startListening);
  const stopListening = useStore((s) => s.stopListening);
  const [pos, setPos] = useState(0);

  const total = useMemo(() => buildTimeline(score).duration, [score]);

  useEffect(() => {
    if (!playback.playing) { setPos(playback.seconds); return undefined; }
    let raf = 0;
    const step = () => { setPos(audio.position()); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playback.playing, playback.seconds]);

  return (
    <div className="transport">
      <button type="button" className="tbtn round primary" onClick={togglePlay} title="Play / pause (Space)">
        {playback.playing ? '⏸' : '▶'}
      </button>
      <button type="button" className="tbtn round" onClick={stopPlayback} title="Stop">⏹</button>
      <button
        type="button"
        className={`tbtn round rec${listening ? ' on' : ''}`}
        onClick={listening ? stopListening : startListening}
        title={listening ? 'Stop recording (Space)' : 'Listen: play your instrument and it writes the notes (⌘⇧F)'}
        aria-label={listening ? 'Stop recording' : 'Record from microphone'}
      >●</button>
      <button type="button" className="tbtn round" onClick={() => play(true)} title="Play from the caret">⏵|</button>

      <span className="time-read">
        {fmt(pos)} / {fmt(total)} · bar {cursor.measureIndex + 1} of {score.measures.length}
      </span>

      <input
        type="range"
        min="0"
        max={Math.max(1, total)}
        step="0.05"
        value={Math.min(pos, total)}
        onChange={(e) => {
          const seconds = Number(e.target.value);
          setPlayback({ seconds });
          if (playback.playing) play(false);
        }}
        style={{ flex: 1, minWidth: 140 }}
      />

      <button
        type="button"
        className={`tbtn${playback.loop ? ' active' : ''}`}
        onClick={toggleLoop}
        title="Loop the score"
      >🔁</button>
      <button
        type="button"
        className={`tbtn${playback.metronome ? ' active' : ''}`}
        onClick={() => setPlayback({ metronome: !playback.metronome })}
        title="Metronome"
      >🥁</button>
      <button
        type="button"
        className={`tbtn${view.showKeyboard ? ' active' : ''}`}
        onClick={() => setView({ showKeyboard: !view.showKeyboard })}
        title="Piano keyboard"
      >🎹</button>
      <button
        type="button"
        className={`tbtn${view.showMixer ? ' active' : ''}`}
        onClick={() => setView({ showMixer: !view.showMixer })}
        title="Mixer"
      >🎚️</button>
    </div>
  );
}

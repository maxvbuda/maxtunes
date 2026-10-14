import { useStore } from '../store.js';
import { getInstrument } from '../core/instruments.js';

export default function Mixer() {
  const score = useStore((s) => s.score);
  const setPartProps = useStore((s) => s.setPartProps);

  return (
    <div className="mixer">
      {score.parts.map((part, i) => (
        <div className="strip" key={part.id}>
          <div className="sname" title={part.name}>{part.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{getInstrument(part.instrumentId).family}</div>
          <input
            type="range" min="0" max="1" step="0.01" value={part.volume}
            onChange={(e) => setPartProps(i, { volume: Number(e.target.value) })}
            title="Volume"
          />
          <input
            type="range" min="-1" max="1" step="0.05" value={part.pan || 0}
            onChange={(e) => setPartProps(i, { pan: Number(e.target.value) })}
            title="Pan"
          />
          <div className="row">
            <button
              type="button"
              className={`mini${part.mute ? ' on' : ''}`}
              onClick={() => setPartProps(i, { mute: !part.mute })}
            >Mute</button>
            <button
              type="button"
              className={`mini solo${part.solo ? ' on' : ''}`}
              onClick={() => setPartProps(i, { solo: !part.solo })}
            >Solo</button>
          </div>
        </div>
      ))}
    </div>
  );
}

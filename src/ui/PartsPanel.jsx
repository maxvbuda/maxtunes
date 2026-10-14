import { useStore } from '../store.js';
import { getInstrument } from '../core/instruments.js';
import { CLEFS } from '../core/theory.js';

export default function PartsPanel({ onDialog }) {
  const score = useStore((s) => s.score);
  const cursor = useStore((s) => s.cursor);
  const setCursor = useStore((s) => s.setCursor);
  const setPartProps = useStore((s) => s.setPartProps);
  const removePart = useStore((s) => s.removePart);
  const movePart = useStore((s) => s.movePart);

  return (
    <div className="side">
      <div className="side-head">
        <span>Instruments</span>
        <button type="button" className="icon-btn" title="Add instrument" onClick={() => onDialog('instruments')}>+</button>
      </div>
      <div className="side-body">
        {score.parts.map((part, i) => {
          const inst = getInstrument(part.instrumentId);
          const active = cursor.partIndex === i;
          return (
            <div key={part.id}>
              <div
                className={`part-row${active ? ' active' : ''}`}
                onClick={() => setCursor({ partIndex: i, staffIndex: 0 })}
              >
                <span className="pname" title={inst.family}>{part.name}</span>
                <span className="pbadge">{part.staves.length > 1 ? `${part.staves.length}×` : CLEFS[part.staves[0].clef]?.label.slice(0, 3)}</span>
                <button
                  type="button"
                  className={`icon-btn${part.mute ? ' on' : ''}`}
                  title="Mute"
                  onClick={(e) => { e.stopPropagation(); setPartProps(i, { mute: !part.mute }); }}
                >M</button>
                <button
                  type="button"
                  className={`icon-btn${part.visible === false ? '' : ' on'}`}
                  title="Show in score"
                  onClick={(e) => { e.stopPropagation(); setPartProps(i, { visible: part.visible === false }); }}
                >👁</button>
              </div>
              {active && part.staves.length > 1 && (
                <div style={{ paddingLeft: 14 }}>
                  {part.staves.map((staff, si) => (
                    <div
                      key={staff.id}
                      className={`part-row${cursor.staffIndex === si ? ' active' : ''}`}
                      onClick={() => setCursor({ partIndex: i, staffIndex: si })}
                    >
                      <span className="pname">Staff {si + 1}</span>
                      <span className="pbadge">{CLEFS[staff.clef]?.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="side-section" style={{ marginTop: 8 }}>
          <h4>Order</h4>
          <div className="chip-row">
            <button type="button" className="chip" onClick={() => movePart(cursor.partIndex, cursor.partIndex - 1)}>Move up</button>
            <button type="button" className="chip" onClick={() => movePart(cursor.partIndex, cursor.partIndex + 1)}>Move down</button>
            <button
              type="button"
              className="chip"
              onClick={() => removePart(cursor.partIndex)}
              disabled={score.parts.length <= 1}
            >Remove</button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { engrave } from '../render/engrave.js';
import { lineToPitch, pitchName } from '../core/theory.js';
import { keySigAt, findEvent } from '../core/score.js';
import { buildTimeline } from '../core/timing.js';
import { audio } from '../audio/engine.js';

export default function ScoreView() {
  const score = useStore((s) => s.score);
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const playback = useStore((s) => s.playback);
  const chordEntry = useStore((s) => s.chordEntry);

  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const areaRef = useRef(null);
  const layoutRef = useRef(null);

  const [layout, setLayout] = useState(null);
  const [width, setWidth] = useState(980);
  const [ghost, setGhost] = useState(null);
  const [live, setLive] = useState({ ids: [], x: null, systemIndex: 0 });

  // Track available width.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(560, el.clientWidth - 74));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Engrave whenever the document or view changes.
  useLayoutEffect(() => {
    if (!stageRef.current) return;
    const ink = view.theme === 'dark' ? '#e9ecf1' : '#14171c';
    const result = engrave(stageRef.current, score, {
      width,
      zoom: view.zoom,
      showNames: true,
      colors: { ink },
    });
    layoutRef.current = result;
    setLayout(result);
  }, [score, width, view.zoom, view.theme]);

  const timeline = useMemo(() => buildTimeline(score), [score]);

  // Playback highlight + playhead.
  useEffect(() => {
    if (!playback.playing) {
      setLive({ ids: [], x: null, systemIndex: 0 });
      return undefined;
    }
    let raf = 0;
    const step = () => {
      const pos = audio.position();
      const ids = [];
      for (const e of timeline.events) {
        if (e.time > pos) break;
        if (e.time <= pos && pos < e.time + e.duration) ids.push(e.eventId);
      }
      const L = layoutRef.current;
      let x = null;
      let systemIndex = 0;
      if (L) {
        const times = timeline.measureTimes;
        let m = 0;
        while (m < times.length - 2 && times[m + 1] <= pos) m++;
        const frac = Math.max(0, Math.min(1, (pos - times[m]) / Math.max(0.001, times[m + 1] - times[m])));
        const box = L.staveBoxes.find((b) => b.measureIndex === m);
        if (box) {
          x = box.noteStartX + (box.x + box.w - box.noteStartX) * frac;
          systemIndex = box.systemIndex;
        }
      }
      setLive({ ids, x, systemIndex });
      if (useStore.getState().playback.followPlayhead && L && x !== null) {
        const area = areaRef.current;
        const sys = L.systems[systemIndex];
        if (area && sys) {
          const target = sys.top - 60;
          if (Math.abs(area.scrollTop - target) > area.clientHeight * 0.55) {
            area.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
          }
        }
      }
      if (!audio.isPlaying()) {
        useStore.getState().setPlayback({ playing: false, seconds: 0 });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playback.playing, timeline]);

  const pick = useCallback((clientX, clientY) => {
    const L = layoutRef.current;
    const host = hostRef.current;
    if (!L || !host) return null;
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const note = L.notes.find((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
    const box = L.staveBoxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.top && y <= b.bottom)
      || L.staveBoxes.find((b) => x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.top - 22 && y <= b.bottom + 22);
    if (!box) return note ? { note } : null;

    const line = Math.round(box.stave.getLineForY(y / L.zoom) * 2) / 2;
    const fifths = keySigAt(score, box.measureIndex);
    const pitch = lineToPitch(line, box.clef, fifths);

    // Snap to the rhythmic slot under the pointer.
    const inBar = L.notes.filter((n) => n.measureIndex === box.measureIndex
      && n.partIndex === box.partIndex && n.staffIndex === box.staffIndex
      && n.voiceIndex === (cursor.voiceIndex || 0));
    let tick = 0;
    let best = Infinity;
    for (const n of inBar) {
      const d = Math.abs(n.cx - x);
      if (n.cx - 10 <= x && d < best) { best = d; tick = n.tick; }
    }
    if (!inBar.length) tick = 0;
    const slot = inBar.find((n) => n.tick === tick) || null;

    return { note, box, pitch, line, tick, slot, x, y };
  }, [score, cursor.voiceIndex]);

  const onClick = useCallback((e) => {
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    const store = useStore.getState();

    if (hit.note && (!store.tool.noteInput || e.altKey)) {
      store.setSelection(e.shiftKey ? [...new Set([...store.selection, hit.note.id])] : [hit.note.id]);
      if (hit.note.midi.length) {
        const part = score.parts[hit.note.partIndex];
        audio.playChord(hit.note.midi.map((m) => m + (part.transpose || 0)), part.instrumentId, 0.7, 0.7);
      }
      return;
    }
    if (!hit.box) return;

    store.setCursor({
      partIndex: hit.box.partIndex,
      staffIndex: hit.box.staffIndex,
      measureIndex: hit.box.measureIndex,
      tick: hit.tick,
    });

    if (store.tool.noteInput && !e.altKey) {
      // The pointer sits at the new pitch, not on the existing notehead, so the chord
      // target is whichever note already occupies this beat.
      const target = e.shiftKey && hit.slot?.kind === 'note' ? hit.slot.id : null;
      store.inputPitch(hit.pitch, { chord: !!target, chordTargetId: target });
    } else if (hit.note) {
      store.setSelection([hit.note.id]);
    } else {
      store.setSelection([]);
    }
  }, [pick, score]);

  const onMove = useCallback((e) => {
    if (!tool.noteInput) { setGhost(null); return; }
    const hit = pick(e.clientX, e.clientY);
    if (!hit?.box) { setGhost(null); return; }
    setGhost({
      x: hit.x, y: hit.box.stave.getYForLine(hit.line) * (layoutRef.current?.zoom || 1),
      pitch: hit.pitch,
    });
  }, [pick, tool.noteInput]);

  const selBoxes = useMemo(() => {
    if (!layout) return [];
    const set = new Set(selection);
    return layout.notes.filter((n) => set.has(n.id));
  }, [layout, selection]);

  const liveBoxes = useMemo(() => {
    if (!layout || !live.ids.length) return [];
    const set = new Set(live.ids);
    return layout.notes.filter((n) => set.has(n.id));
  }, [layout, live.ids]);

  const caret = useMemo(() => {
    if (!layout) return null;
    const box = layout.staveBoxes.find((b) => b.measureIndex === cursor.measureIndex
      && b.partIndex === cursor.partIndex && b.staffIndex === cursor.staffIndex);
    if (!box) return null;
    const at = layout.notes.find((n) => n.measureIndex === cursor.measureIndex
      && n.partIndex === cursor.partIndex && n.staffIndex === cursor.staffIndex
      && n.voiceIndex === (cursor.voiceIndex || 0) && n.tick === cursor.tick);
    const x = at ? at.cx : box.noteStartX;
    return { x: x - 1, y: box.top + 6, h: box.bottom - box.top - 12 };
  }, [layout, cursor]);

  const playX = live.x;
  const playSystem = layout?.systems[live.systemIndex];

  return (
    <div className="score-area" ref={areaRef}>
      <div className="paper" style={{ width: layout ? layout.width + 60 : width + 60 }}>
        <PaperHead />
        <div
          className="score-stage"
          ref={hostRef}
          style={{ marginLeft: 30 }}
          onClick={onClick}
          onMouseMove={onMove}
          onMouseLeave={() => setGhost(null)}
        >
          <div ref={stageRef} />
          <div className="overlay">
            {selBoxes.map((n) => (
              <div key={`s${n.id}`} className="hl sel" style={{ left: n.x, top: n.y, width: n.w, height: n.h }} />
            ))}
            {liveBoxes.map((n) => (
              <div key={`p${n.id}`} className="hl play" style={{ left: n.x, top: n.y, width: n.w, height: n.h }} />
            ))}
            {caret && !selection.length && (
              <div className="caret" style={{ left: caret.x, top: caret.y, height: caret.h }} />
            )}
            {playX !== null && playSystem && (
              <div className="playline" style={{ left: playX, top: playSystem.top - 10, height: playSystem.height + 20 }} />
            )}
            {ghost && (
              <div
                className="hl"
                style={{
                  left: ghost.x - 7, top: ghost.y - 5, width: 14, height: 10,
                  background: 'rgba(47,111,208,.45)', borderRadius: '50%',
                }}
              />
            )}
            {chordEntry && <ChordInput layout={layout} entry={chordEntry} />}
            {layout?.staveBoxes.filter((b) => b.partIndex === 0 && b.staffIndex === 0).map((b) => (
              <div key={`t${b.measureIndex}`} className="bar-tag" style={{ left: b.x + 2, top: b.top - 12 }}>
                {b.measureIndex + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
      {ghost && (
        <div className="statusbar" style={{ position: 'sticky', bottom: 0, display: 'none' }}>
          {pitchName(ghost.pitch)}
        </div>
      )}
    </div>
  );
}

function ChordInput({ layout, entry }) {
  const score = useStore((s) => s.score);
  const commit = useStore((s) => s.commitChordEntry);
  const cancel = useStore((s) => s.cancelChordEntry);
  const inputRef = useRef(null);
  const [value, setValue] = useState('');

  const box = layout?.notes.find((n) => n.id === entry.eventId);
  const stave = layout?.staveBoxes.find((b) => box
    && b.measureIndex === box.measureIndex
    && b.partIndex === box.partIndex
    && b.staffIndex === box.staffIndex);

  useEffect(() => {
    const existing = findEvent(score, entry.eventId)?.ev.chord || '';
    setValue(existing);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [entry.eventId, score]);

  if (!box || !stave) return null;

  return (
    <input
      ref={inputRef}
      className="chord-input"
      value={value}
      placeholder="Am7"
      spellCheck={false}
      style={{ left: box.cx - 12, top: stave.top - 30 }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value, { advance: false })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Tab' || e.key === ' ') {
          e.preventDefault();
          commit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}

function PaperHead() {
  const score = useStore((s) => s.score);
  const setMeta = useStore((s) => s.setMeta);
  return (
    <div className="paper-head">
      <input
        className="t"
        value={score.title}
        onChange={(e) => setMeta({ title: e.target.value })}
        placeholder="Title"
      />
      <input
        className="s"
        value={score.subtitle}
        onChange={(e) => setMeta({ subtitle: e.target.value })}
        placeholder="Subtitle"
      />
      <div className="credits">
        <input
          className="lyr"
          value={score.lyricist}
          onChange={(e) => setMeta({ lyricist: e.target.value })}
          placeholder="Lyricist"
        />
        <input
          className="cmp"
          value={score.composer}
          onChange={(e) => setMeta({ composer: e.target.value })}
          placeholder="Composer"
        />
      </div>
    </div>
  );
}

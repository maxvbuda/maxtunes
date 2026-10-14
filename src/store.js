import { create } from 'zustand';
import {
  createScore, cloneScore, measureTicks, findEvent, eventAtTick, keySigAt, clefAt, chordAnchor,
  nextEventInVoice, timeSigAt,
} from './core/score.js';
import * as edit from './core/edit.js';
import { audio } from './audio/engine.js';
import { listener, barGrid } from './audio/listen.js';
import { transcribe, quantize } from './audio/pitch.js';
import { getInstrument } from './core/instruments.js';
import { arrangeRecording, canArrange, detectKey, writtenFifths } from './core/arrange.js';
import { pitchToMidi, midiToPitch, stepPitch } from './core/theory.js';
import { tickToSeconds, secondsToPosition, buildTimeline } from './core/timing.js';

const STORAGE_KEY = 'maxtunes.autosave.v1';
const VIEW_KEY = 'maxtunes.view.v1';
const HISTORY_LIMIT = 120;

const DEFAULT_VIEW = {
  zoom: 1,
  theme: 'light',
  showMixer: false,
  showKeyboard: true,
  showInspector: true,
  ribbonTab: 'note-input',
};

function loadView() {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.parts?.length) return null;
    return data;
  } catch {
    return null;
  }
}

let saveTimer = null;
function scheduleSave(score) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(score)); } catch { /* quota */ }
  }, 700);
}

const initialScore = loadAutosave() || createScore({
  title: 'Untitled Score',
  composer: '',
  instruments: ['piano'],
  measureCount: 12,
});

export const useStore = create((set, get) => ({
  score: initialScore,
  past: [],
  future: [],
  lastLabel: null,

  cursor: { partIndex: 0, staffIndex: 0, measureIndex: 0, voiceIndex: 0, tick: 0 },
  selection: [],
  clipboard: null,
  chordEntry: null,

  // Microphone recording. `grid` is the quantize value (8 = eighths, 16 = sixteenths);
  // `arrange` is the accompaniment style written under each take ('off' to skip).
  listen: { phase: 'idle', grid: 16, click: true, arrange: 'chords', target: null },

  tool: {
    duration: { base: 4, dots: 0 },
    accidental: 0,
    noteInput: true,
    articulations: [],
    dynamic: null,
  },

  view: loadView(),

  playback: {
    playing: false,
    seconds: 0,
    tempoScale: 1,
    metronome: false,
    countIn: false,
    loop: null,
    followPlayhead: true,
  },

  status: '',
  setStatus: (status) => set({ status }),

  // ------------------------------------------------------------ history

  apply(mutator, label = 'edit') {
    const { score, past } = get();
    const draft = cloneScore(score);
    mutator(draft);
    const nextPast = [...past, score].slice(-HISTORY_LIMIT);
    set({ score: draft, past: nextPast, future: [], lastLabel: label });
    scheduleSave(draft);
    audio.syncParts(draft);
  },

  undo() {
    const { past, score, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ score: prev, past: past.slice(0, -1), future: [score, ...future].slice(0, HISTORY_LIMIT) });
    scheduleSave(prev);
  },

  redo() {
    const { future, score, past } = get();
    if (!future.length) return;
    const next = future[0];
    set({ score: next, future: future.slice(1), past: [...past, score].slice(-HISTORY_LIMIT) });
    scheduleSave(next);
  },

  replaceScore(score, label = 'load') {
    set({ score, past: [], future: [], selection: [], lastLabel: label,
      cursor: { partIndex: 0, staffIndex: 0, measureIndex: 0, voiceIndex: 0, tick: 0 } });
    scheduleSave(score);
    audio.syncParts(score);
  },

  // ------------------------------------------------------------ view & tools

  setView(patch) {
    set((s) => ({ view: { ...s.view, ...patch } }));
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(get().view)); } catch { /* quota */ }
  },
  setTool: (patch) => set((s) => ({ tool: { ...s.tool, ...patch } })),
  setDuration: (base) => set((s) => ({ tool: { ...s.tool, duration: { ...s.tool.duration, base } } })),
  toggleDot() {
    const { tool, selection } = get();
    const dots = tool.duration.dots ? 0 : 1;
    set({ tool: { ...tool, duration: { ...tool.duration, dots } } });
    if (selection.length) {
      get().apply((score) => {
        for (const id of selection) {
          const loc = findEvent(score, id);
          if (loc) edit.setEventDuration(score, id, { ...loc.ev.dur, dots });
        }
      }, 'dot');
    }
  },

  // ------------------------------------------------------------ cursor & selection

  setCursor: (patch) => set((s) => ({ cursor: { ...s.cursor, ...patch } })),

  setSelection(ids) {
    set({ selection: ids });
    const { score } = get();
    if (ids.length === 1) {
      const loc = findEvent(score, ids[0]);
      if (loc) {
        const timeline = score.parts[loc.partIndex].staves[loc.staffIndex]
          .bars[loc.measureIndex].voices[loc.voiceIndex];
        let tick = 0;
        for (let i = 0; i < loc.index; i++) tick += ticksOf(timeline[i]);
        set({ cursor: {
          partIndex: loc.partIndex, staffIndex: loc.staffIndex,
          measureIndex: loc.measureIndex, voiceIndex: loc.voiceIndex, tick,
        } });
      }
    }
  },

  /** Move the caret by one event left/right, crossing bar lines. */
  moveCursor(direction) {
    const { score, cursor } = get();
    const staff = score.parts[cursor.partIndex]?.staves[cursor.staffIndex];
    if (!staff) return;
    let { measureIndex, tick } = cursor;
    const voiceOf = (m) => staff.bars[m]?.voices[cursor.voiceIndex] || staff.bars[m]?.voices[0] || [];

    if (direction > 0) {
      const slot = eventAtTick(voiceOf(measureIndex), tick);
      if (slot && slot.end < measureTicks(score, measureIndex)) tick = slot.end;
      else if (measureIndex < score.measures.length - 1) { measureIndex++; tick = 0; }
    } else {
      if (tick > 0) {
        const timeline = voiceOf(measureIndex);
        let acc = 0; let prev = 0;
        for (const ev of timeline) {
          const d = ticksOf(ev);
          if (acc + d >= tick) break;
          prev = acc; acc += d;
        }
        tick = acc >= tick ? prev : acc;
      } else if (measureIndex > 0) {
        measureIndex--;
        const timeline = voiceOf(measureIndex);
        tick = Math.max(0, timeline.slice(0, -1).reduce((s, e) => s + ticksOf(e), 0));
      }
    }
    const voice = voiceOf(measureIndex);
    const slot = eventAtTick(voice, tick);
    set({ cursor: { ...cursor, measureIndex, tick }, selection: slot ? [slot.ev.id] : [] });
  },

  moveCursorStaff(delta) {
    const { score, cursor } = get();
    const flat = [];
    score.parts.forEach((p, pi) => p.staves.forEach((s, si) => flat.push({ pi, si })));
    const at = flat.findIndex((f) => f.pi === cursor.partIndex && f.si === cursor.staffIndex);
    const next = flat[Math.max(0, Math.min(flat.length - 1, at + delta))];
    if (next) set({ cursor: { ...cursor, partIndex: next.pi, staffIndex: next.si }, selection: [] });
  },

  // ------------------------------------------------------------ note input

  currentInstrumentId() {
    const { score, cursor } = get();
    return score.parts[cursor.partIndex]?.instrumentId || 'piano';
  },

  inputPitch(pitch, { chord = false, audition = true, chordTargetId = null } = {}) {
    const { tool, cursor, score } = get();
    const applied = { ...pitch };
    if (tool.accidental !== 0) applied.alter = tool.accidental;

    const audition_ = () => {
      if (!audition) return;
      audio.preview(pitchToMidi(applied) + (score.parts[cursor.partIndex]?.transpose || 0),
        get().currentInstrumentId(), 0.8, 0.7);
    };

    // Chord tones stack onto an existing note instead of taking their own slot.
    if (chord) {
      const targetId = chordTargetId ?? chordAnchor(score, cursor);
      if (targetId) {
        get().apply((draft) => edit.addPitchesToEvent(draft, targetId, [applied]), 'chord');
        audition_();
        set({ tool: { ...get().tool, accidental: 0 } });
        return;
      }
    }

    let newTick = cursor.tick;
    get().apply((draft) => {
      newTick = edit.insertNote(draft, cursor, [applied], tool.duration, {
        articulations: tool.articulations,
        dynamic: tool.dynamic,
      });
    }, 'note');

    audition_();

    const total = measureTicks(get().score, cursor.measureIndex);
    if (newTick >= total) {
      if (cursor.measureIndex >= get().score.measures.length - 1) {
        get().apply((draft) => edit.addMeasures(draft, 1), 'add bar');
      }
      set({ cursor: { ...cursor, measureIndex: cursor.measureIndex + 1, tick: 0 } });
    } else {
      set({ cursor: { ...cursor, tick: newTick } });
    }
    set({ tool: { ...get().tool, accidental: 0 } });
  },

  inputMidi(midi, opts = {}) {
    const { score, cursor } = get();
    const fifths = keySigAt(score, cursor.measureIndex);
    const transpose = score.parts[cursor.partIndex]?.transpose || 0;
    get().inputPitch(midiToPitch(midi - transpose, fifths), opts);
  },

  /**
   * Letter-name entry (Sibelius style): the new note lands in the octave nearest
   * the previous note *on this staff*, falling back to the clef's home register.
   */
  inputLetter(letter, opts = {}) {
    const { score, cursor } = get();
    const staff = score.parts[cursor.partIndex]?.staves[cursor.staffIndex];
    if (!staff) return;
    const clef = clefAt(staff, cursor.measureIndex);
    const fifths = keySigAt(score, cursor.measureIndex);

    // Building a chord: measure from its top note so tones stack upward.
    let reference = null;
    if (opts.chord) {
      const anchorId = opts.chordTargetId ?? chordAnchor(score, cursor);
      const anchor = anchorId ? findEvent(score, anchorId) : null;
      if (anchor?.ev.kind === 'note') reference = anchor.ev.pitches[anchor.ev.pitches.length - 1];
    }
    reference = reference || lastPitchBefore(staff, cursor) || defaultPitchForClef(clef);

    let best = null;
    for (let oct = reference.octave - 1; oct <= reference.octave + 1; oct++) {
      const candidate = { step: letter, octave: oct, alter: 0 };
      const dist = Math.abs(pitchToMidi(candidate) - pitchToMidi(reference));
      if (!best || dist < best.dist) best = { candidate, dist };
    }
    const pitch = best.candidate;
    get().inputPitch({ ...pitch, alter: stepPitch(pitch, 0, fifths).alter }, opts);
  },

  inputRest() {
    const { cursor, tool } = get();
    let newTick = cursor.tick;
    get().apply((draft) => { newTick = edit.insertRest(draft, cursor, tool.duration); }, 'rest');
    const total = measureTicks(get().score, cursor.measureIndex);
    if (newTick >= total && cursor.measureIndex < get().score.measures.length - 1) {
      set({ cursor: { ...cursor, measureIndex: cursor.measureIndex + 1, tick: 0 } });
    } else {
      set({ cursor: { ...cursor, tick: Math.min(newTick, total) } });
    }
  },

  // ------------------------------------------------------------ selection edits

  editSelection(fn, label = 'edit') {
    const { selection } = get();
    if (!selection.length) return;
    get().apply((draft) => selection.forEach((id) => fn(draft, id)), label);
  },

  transposeSelection(semitones) {
    get().editSelection((d, id) => edit.transposeEvent(d, id, semitones), 'transpose');
    get().auditionSelection();
  },

  stepSelection(steps) {
    get().editSelection((d, id) => edit.stepEvent(d, id, steps), 'step');
    get().auditionSelection();
  },

  auditionSelection() {
    const { score, selection } = get();
    const midis = [];
    for (const id of selection) {
      const loc = findEvent(score, id);
      if (loc?.ev.kind === 'note') {
        const transpose = score.parts[loc.partIndex].transpose || 0;
        midis.push(...loc.ev.pitches.map((p) => pitchToMidi(p) + transpose));
      }
    }
    if (midis.length) {
      const loc = findEvent(score, selection[0]);
      audio.playChord(midis, score.parts[loc.partIndex].instrumentId, 0.7, 0.8);
    }
  },

  deleteSelection() {
    const { selection } = get();
    if (!selection.length) return;
    get().apply((draft) => selection.forEach((id) => edit.deleteEvent(draft, id)), 'delete');
  },

  applyDurationToSelection(base) {
    const { selection, tool } = get();
    set({ tool: { ...tool, duration: { ...tool.duration, base } } });
    if (!selection.length) return;
    get().apply((draft) => selection.forEach((id) => {
      const loc = findEvent(draft, id);
      if (loc) edit.setEventDuration(draft, id, { base, dots: loc.ev.dur.dots || 0 });
    }), 'duration');
  },

  setAccidentalOnSelection(alter) {
    const { selection, tool } = get();
    set({ tool: { ...tool, accidental: tool.accidental === alter ? 0 : alter } });
    if (selection.length) {
      get().editSelection((d, id) => edit.setAccidental(d, id, alter), 'accidental');
      get().auditionSelection();
    }
  },

  toggleArticulation(art) {
    get().editSelection((d, id) => edit.toggleArticulation(d, id, art), 'articulation');
  },

  setDynamic(dyn) {
    get().editSelection((d, id) => edit.setDynamic(d, id, dyn), 'dynamic');
  },

  setTechnique(technique) {
    get().editSelection((d, id) => edit.setTechnique(d, id, technique), 'technique');
  },

  applyTangoRhythm(kind) {
    const { cursor } = get();
    get().apply((draft) => edit.applyTangoRhythm(
      draft, cursor.partIndex, cursor.staffIndex, cursor.measureIndex, kind,
    ), kind);
  },

  setOrnament(orn) {
    get().editSelection((d, id) => edit.setOrnament(d, id, orn), 'ornament');
  },

  toggleTie() {
    get().editSelection((d, id) => edit.toggleTie(d, id), 'tie');
  },

  setStem(stem) {
    get().editSelection((d, id) => edit.setStem(d, id, stem), 'stem');
  },

  makeSlur() {
    const { selection } = get();
    if (selection.length < 2) return;
    get().apply((draft) => edit.setSlur(draft, selection), 'slur');
  },

  makeTuplet(num, den) {
    const { selection } = get();
    if (selection.length < 2) return;
    get().apply((draft) => edit.applyTuplet(draft, selection, num, den), 'tuplet');
  },

  setLyric(id, text) {
    get().apply((draft) => edit.setLyric(draft, id, text), 'lyric');
  },

  setChord(id, text) {
    get().apply((draft) => edit.setChordSymbol(draft, id, text), 'chord symbol');
  },

  /** Open the inline cifrado editor on the selection, or on the note at the caret. */
  startChordEntry(eventId = null) {
    const { score, selection, cursor } = get();
    const target = eventId
      || selection[0]
      || chordAnchor(score, cursor)
      || firstEventAt(score, cursor);
    if (target) set({ chordEntry: { eventId: target } });
  },

  /** Save the symbol and step to the next note so a whole chart can be typed in one pass. */
  commitChordEntry(text, { advance = true } = {}) {
    const { chordEntry } = get();
    if (!chordEntry) return;
    get().setChord(chordEntry.eventId, text);
    const next = advance ? nextEventInVoice(get().score, chordEntry.eventId) : null;
    set({ chordEntry: next ? { eventId: next } : null });
  },

  cancelChordEntry() {
    set({ chordEntry: null });
  },

  copySelection() {
    const { score, cursor } = get();
    set({ clipboard: edit.copyRange(score, cursor, 1), status: 'Bar copied' });
  },

  paste() {
    const { clipboard, cursor } = get();
    if (!clipboard) return;
    get().apply((draft) => edit.pasteRange(draft, cursor, clipboard), 'paste');
  },

  // ------------------------------------------------------------ structure

  addMeasures(count = 4) {
    get().apply((draft) => edit.addMeasures(draft, count), 'add bars');
  },

  removeMeasure(index) {
    get().apply((draft) => edit.removeMeasure(draft, index), 'remove bar');
  },

  addPart(instrumentId) {
    get().apply((draft) => edit.addPart(draft, instrumentId), 'add instrument');
  },

  removePart(index) {
    get().apply((draft) => edit.removePart(draft, index), 'remove instrument');
    set((s) => ({ cursor: { ...s.cursor, partIndex: 0, staffIndex: 0 } }));
  },

  movePart(from, to) {
    get().apply((draft) => edit.movePart(draft, from, to), 'reorder');
  },

  setPartProps(index, props) {
    get().apply((draft) => edit.setPartProps(draft, index, props), 'part');
  },

  changeInstrument(index, instrumentId) {
    get().apply((draft) => edit.changeInstrument(draft, index, instrumentId), 'instrument');
  },

  setMeta(patch) {
    get().apply((draft) => Object.assign(draft, patch), 'metadata');
  },

  setTimeSignature(measureIndex, ts) {
    get().apply((draft) => edit.setTimeSignature(draft, measureIndex, ts), 'time signature');
  },

  setKeySignature(measureIndex, fifths) {
    get().apply((draft) => edit.setKeySignature(draft, measureIndex, fifths), 'key signature');
  },

  setTempo(bpm, measureIndex = null) {
    get().apply((draft) => {
      if (measureIndex === null || measureIndex === 0) draft.tempo = bpm;
      else edit.setMeasureTempo(draft, measureIndex, bpm);
    }, 'tempo');
  },

  setClef(clef) {
    const { cursor } = get();
    get().apply((draft) => edit.setStaffClef(draft, cursor.partIndex, cursor.staffIndex, cursor.measureIndex, clef), 'clef');
  },

  setBarline(measureIndex, barline) {
    get().apply((draft) => edit.setBarline(draft, measureIndex, barline), 'barline');
  },

  toggleRepeat(measureIndex, which) {
    get().apply((draft) => edit.toggleRepeat(draft, measureIndex, which), 'repeat');
  },

  setRehearsal(measureIndex, mark) {
    get().apply((draft) => edit.setRehearsal(draft, measureIndex, mark), 'rehearsal');
  },

  toggleSystemBreak(measureIndex) {
    get().apply((draft) => edit.toggleSystemBreak(draft, measureIndex), 'system break');
  },

  setVoice(voiceIndex) {
    const { cursor, score } = get();
    set({ cursor: { ...cursor, voiceIndex } });
    const bar = score.parts[cursor.partIndex]?.staves[cursor.staffIndex]?.bars[cursor.measureIndex];
    if (bar && bar.voices.length <= voiceIndex && voiceIndex <= 3) {
      get().apply((draft) => edit.ensureVoice(
        draft, cursor.partIndex, cursor.staffIndex, cursor.measureIndex, voiceIndex,
      ), 'voice');
    }
  },

  transposeAll(semitones, partIndex = null) {
    get().apply((draft) => edit.transposeScope(draft, semitones, partIndex), 'transpose');
  },

  // ------------------------------------------------------------ playback

  play(fromCursor = false) {
    const { score, cursor, playback } = get();
    audio.ensure();
    audio.syncParts(score);
    const from = fromCursor ? tickToSeconds(score, cursor.measureIndex, cursor.tick) : playback.seconds;
    audio.start(score, {
      fromSeconds: from,
      tempoScale: playback.tempoScale,
      metronome: playback.metronome,
      countIn: playback.countIn,
      loop: playback.loop,
    });
    set({ playback: { ...playback, playing: true } });
  },

  pause() {
    const seconds = audio.position();
    audio.stop();
    set((s) => ({ playback: { ...s.playback, playing: false, seconds } }));
  },

  stopPlayback() {
    audio.stop();
    set((s) => ({ playback: { ...s.playback, playing: false, seconds: 0 } }));
  },

  togglePlay() {
    const { playback } = get();
    if (playback.playing) get().pause();
    else get().play(playback.seconds === 0);
  },

  setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),

  toggleLoop() {
    const { playback, score } = get();
    const loop = playback.loop ? null : { start: 0, end: buildTimeline(score).duration };
    set({ playback: { ...playback, loop } });
    if (playback.playing) get().play(false);
  },

  // ------------------------------------------------------------ microphone

  setListen: (patch) => set((s) => ({ listen: { ...s.listen, ...patch } })),

  /** Record from the mic into the caret's staff, from the start of the caret's bar. */
  async startListening() {
    const { listen, cursor, score, playback } = get();
    if (listen.phase !== 'idle') return;
    if (playback.playing) get().stopPlayback();
    const target = {
      partIndex: cursor.partIndex,
      staffIndex: cursor.staffIndex,
      voiceIndex: cursor.voiceIndex || 0,
      measureIndex: cursor.measureIndex,
    };
    set({ listen: { ...listen, phase: 'arming', target }, chordEntry: null });
    try {
      await listener.start({ grid: barGrid(score, target.measureIndex, playback.tempoScale), click: listen.click });
    } catch (err) {
      set((s) => ({ listen: { ...s.listen, phase: 'idle', target: null } }));
      get().setStatus(micError(err));
      return;
    }
    // Stop was pressed while the permission prompt was still open.
    if (get().listen.phase !== 'arming') {
      listener.stop();
      return;
    }
    set((s) => ({ listen: { ...s.listen, phase: 'recording' } }));
  },

  stopListening() {
    const { listen } = get();
    if (listen.phase === 'arming') {
      set({ listen: { ...listen, phase: 'idle', target: null } });
      return;
    }
    if (listen.phase !== 'recording') return;
    const take = listener.stop();
    set({ listen: { ...listen, phase: 'processing' } });
    // Give the panel a frame to show "Writing…" before the analysis holds the thread.
    setTimeout(() => get().finishTake(take), 30);
  },

  /** Transcribe a take, write it into the score, arrange it, and play it back. */
  finishTake(take) {
    const { score, listen, playback } = get();
    const { target } = listen;
    set((s) => ({ listen: { ...s.listen, phase: 'idle', target: null } }));
    const part = score.parts[target.partIndex];
    if (!part || !take) return;

    const [low, high] = getInstrument(part.instrumentId).range || [28, 100];
    const heard = transcribe(take.samples, take.rate, {
      minMidi: low - 3, maxMidi: high + 3, quietUntil: take.quietUntil,
    });
    const { toTick } = barGrid(score, target.measureIndex, playback.tempoScale);
    const notes = quantize(
      heard.map((n) => ({ ...n, start: n.start - take.offset, end: n.end - take.offset })),
      { toTick, grid: 1920 / listen.grid, beat: 1920 / timeSigAt(score, target.measureIndex).d },
    );
    if (!notes.length) {
      get().setStatus("Didn't catch any notes — check the input level, and start after the count-in");
      return;
    }

    const arranging = listen.arrange !== 'off' && canArrange(score, target);
    const key = arranging ? detectKey(notes, keySigAt(score, target.measureIndex)) : null;

    let bars = 0;
    get().apply((draft) => {
      bars = edit.writeRecording(draft, target, notes, {
        spellFifths: key ? writtenFifths(key, part.transpose || 0) : null,
      });
    }, 'record');
    let message = `Wrote ${notes.length} note${notes.length === 1 ? '' : 's'} into ${bars} bar${bars === 1 ? '' : 's'}`;

    // A separate undo step, so the arrangement can be taken back while keeping the take.
    if (arranging) {
      let result = null;
      get().apply((draft) => {
        result = arrangeRecording(draft, target, notes, bars, listen.arrange, key);
      }, 'arrange');
      if (result) {
        const chart = result.progression.slice(0, 8).join(' | ') + (result.progression.length > 8 ? ' …' : '');
        message += ` · arranged in ${result.key} on ${result.label}: ${chart}`;
      }
    }
    get().setStatus(message);

    const written = get().score;
    set({
      cursor: { ...target, tick: 0 },
      selection: [],
      playback: { ...get().playback, playing: true },
    });
    audio.syncParts(written);
    audio.start(written, {
      fromSeconds: tickToSeconds(written, target.measureIndex, 0),
      until: tickToSeconds(written, target.measureIndex + bars, 0),
      tempoScale: playback.tempoScale,
    });
  },

  seekToCursor() {
    const { score, cursor } = get();
    set((s) => ({ playback: { ...s.playback, seconds: tickToSeconds(score, cursor.measureIndex, cursor.tick) } }));
  },

  positionToCursor(seconds) {
    const { score } = get();
    return secondsToPosition(score, seconds);
  },
}));

function micError(err) {
  if (err?.name === 'NotAllowedError') return 'Microphone access was refused — allow it in the browser’s site settings';
  if (err?.name === 'NotFoundError') return 'No microphone found';
  if (err?.name === 'NotReadableError') return 'The microphone is busy in another app';
  return `Couldn't open the microphone: ${err?.message || err}`;
}

function ticksOf(ev) {
  const base = 1920 / ev.dur.base;
  const dotted = base * (2 - 1 / Math.pow(2, ev.dur.dots || 0));
  if (ev.dur.tuplet) return Math.round((dotted * ev.dur.tuplet.den) / ev.dur.tuplet.num);
  return Math.round(dotted);
}

/** The event occupying the caret's position, whether note or rest. */
function firstEventAt(score, cursor) {
  const voice = score.parts[cursor.partIndex]?.staves[cursor.staffIndex]
    ?.bars[cursor.measureIndex]?.voices[cursor.voiceIndex || 0];
  if (!voice) return null;
  const slot = eventAtTick(voice, cursor.tick) || { ev: voice[0] };
  return slot?.ev?.id ?? null;
}

/** The most recent notated pitch at or before the caret on this staff. */
function lastPitchBefore(staff, cursor) {
  const voiceIndex = cursor.voiceIndex || 0;
  for (let m = cursor.measureIndex; m >= 0; m--) {
    const voice = staff.bars[m]?.voices[voiceIndex] || staff.bars[m]?.voices[0];
    if (!voice) continue;
    let tick = 0;
    let found = null;
    for (const ev of voice) {
      if (m === cursor.measureIndex && tick >= cursor.tick) break;
      if (ev.kind === 'note' && ev.pitches.length) found = ev.pitches[ev.pitches.length - 1];
      tick += ticksOf(ev);
    }
    if (found) return found;
  }
  return null;
}

function defaultPitchForClef(clef) {
  if (clef === 'bass') return { step: 'D', octave: 3, alter: 0 };
  if (clef === 'alto') return { step: 'C', octave: 4, alter: 0 };
  if (clef === 'tenor') return { step: 'A', octave: 3, alter: 0 };
  return { step: 'B', octave: 4, alter: 0 };
}

// Pure-ish mutation operations. Each takes a mutable score draft (the store clones first).

import {
  durationTicks, ticksToDurations, timeSigTicks, stepPitch, transposePitch, alterForKey, diatonic,
  DURATIONS, WHOLE_TICKS, midiToPitch,
} from './theory.js';
import {
  makeNote, makeRest, makeBar, makeStaff, makePart, makeMeasureAttrs, fillRests,
  normalizeVoice, voiceTimeline, measureTicks, timeSigAt, keySigAt, findEvent, uid,
  restsForRange,
} from './score.js';
import { getInstrument } from './instruments.js';

function voiceRef(score, cur) {
  const part = score.parts[cur.partIndex];
  if (!part) return null;
  const staff = part.staves[cur.staffIndex];
  if (!staff) return null;
  const bar = staff.bars[cur.measureIndex];
  if (!bar) return null;
  while (bar.voices.length <= cur.voiceIndex) bar.voices.push(fillRests(measureTicks(score, cur.measureIndex)));
  return { part, staff, bar, voice: bar.voices[cur.voiceIndex] };
}

/** Overwrite the span [tick, tick+len) of a voice with `items`, keeping the bar full. */
function spliceSpan(voice, tick, len, items, ticks) {
  const timeline = voiceTimeline(voice);
  const spanEnd = tick + len;
  const before = [];
  const after = [];

  for (const slot of timeline) {
    if (slot.end <= tick) {
      before.push(slot.ev);
    } else if (slot.start >= spanEnd) {
      after.push(slot.ev);
    } else {
      if (slot.start < tick) {
        for (const d of ticksToDurations(tick - slot.start)) before.push(makeRest(d));
      }
      if (slot.end > spanEnd) {
        for (const d of ticksToDurations(slot.end - spanEnd)) after.push(makeRest(d));
      }
    }
  }
  const next = [...before, ...items, ...after];
  return normalizeVoice(next, ticks);
}

/**
 * Insert a note (or chord tone) at the cursor. Returns the tick the cursor should advance to.
 */
export function insertNote(score, cur, pitches, dur, opts = {}) {
  const ref = voiceRef(score, cur);
  if (!ref) return cur.tick;
  const ticks = measureTicks(score, cur.measureIndex);
  const requested = durationTicks(dur);
  const available = Math.max(0, ticks - cur.tick);
  if (available <= 0) return cur.tick;

  const len = Math.min(requested, available);
  const pieces = len === requested ? [dur] : ticksToDurations(len);
  const items = pieces.map((d, i) => {
    const ev = makeNote(pitches, d);
    if (i < pieces.length - 1) ev.tie = true;
    if (opts.articulations) ev.articulations = [...opts.articulations];
    if (opts.dynamic) ev.dynamic = opts.dynamic;
    return ev;
  });
  ref.bar.voices[cur.voiceIndex] = spliceSpan(ref.voice, cur.tick, len, items, ticks);
  return cur.tick + len;
}

/** Stack extra pitches onto an existing note, keeping the chord in ascending order. */
export function addPitchesToEvent(score, eventId, pitches) {
  const loc = findEvent(score, eventId);
  if (!loc || loc.ev.kind !== 'note') return;
  const existing = loc.ev.pitches;
  for (const p of pitches) {
    const already = existing.some((q) => q.step === p.step && q.octave === p.octave && (q.alter || 0) === (p.alter || 0));
    if (!already) existing.push({ step: p.step, octave: p.octave, alter: p.alter || 0 });
  }
  existing.sort((a, b) => diatonic(a.step, a.octave) - diatonic(b.step, b.octave));
}

export function insertRest(score, cur, dur) {
  const ref = voiceRef(score, cur);
  if (!ref) return cur.tick;
  const ticks = measureTicks(score, cur.measureIndex);
  const len = Math.min(durationTicks(dur), Math.max(0, ticks - cur.tick));
  if (len <= 0) return cur.tick;
  const pieces = len === durationTicks(dur) ? [dur] : ticksToDurations(len);
  ref.bar.voices[cur.voiceIndex] = spliceSpan(ref.voice, cur.tick, len, pieces.map((d) => makeRest(d)), ticks);
  return cur.tick + len;
}

export function setEventDuration(score, eventId, dur) {
  const loc = findEvent(score, eventId);
  if (!loc) return;
  const { partIndex, staffIndex, measureIndex, voiceIndex, index } = loc;
  const voice = score.parts[partIndex].staves[staffIndex].bars[measureIndex].voices[voiceIndex];
  const ticks = measureTicks(score, measureIndex);
  const start = voiceTimeline(voice)[index].start;
  const oldLen = durationTicks(voice[index].dur);
  const newLen = Math.min(durationTicks(dur), ticks - start);
  const replacement = { ...voice[index], dur: { ...dur } };
  const span = Math.max(oldLen, newLen);
  const items = [replacement];
  const leftover = span - newLen;
  if (leftover > 0) items.push(...ticksToDurations(leftover).map((d) => makeRest(d)));
  score.parts[partIndex].staves[staffIndex].bars[measureIndex].voices[voiceIndex] =
    spliceSpan(voice, start, span, items, ticks);
}

export function deleteEvent(score, eventId, { removeEntirely = false } = {}) {
  const loc = findEvent(score, eventId);
  if (!loc) return;
  const { partIndex, staffIndex, measureIndex, voiceIndex, index } = loc;
  const voice = score.parts[partIndex].staves[staffIndex].bars[measureIndex].voices[voiceIndex];
  const ticks = measureTicks(score, measureIndex);
  if (removeEntirely) {
    voice.splice(index, 1);
  } else {
    voice[index] = makeRest(voice[index].dur);
  }
  score.parts[partIndex].staves[staffIndex].bars[measureIndex].voices[voiceIndex] = normalizeVoice(voice, ticks);
}

export function updateEvent(score, eventId, updater) {
  const loc = findEvent(score, eventId);
  if (!loc) return;
  updater(loc.ev, loc);
}

export function transposeEvent(score, eventId, semitones) {
  const loc = findEvent(score, eventId);
  if (!loc || loc.ev.kind !== 'note') return;
  const fifths = keySigAt(score, loc.measureIndex);
  loc.ev.pitches = loc.ev.pitches.map((p) => transposePitch(p, semitones, fifths));
}

export function stepEvent(score, eventId, diatonicSteps) {
  const loc = findEvent(score, eventId);
  if (!loc || loc.ev.kind !== 'note') return;
  const fifths = keySigAt(score, loc.measureIndex);
  loc.ev.pitches = loc.ev.pitches.map((p) => stepPitch(p, diatonicSteps, fifths));
}

export function setAccidental(score, eventId, alter) {
  const loc = findEvent(score, eventId);
  if (!loc || loc.ev.kind !== 'note') return;
  loc.ev.pitches = loc.ev.pitches.map((p) => ({ ...p, alter }));
}

export function nudgeAccidental(score, eventId, delta) {
  const loc = findEvent(score, eventId);
  if (!loc || loc.ev.kind !== 'note') return;
  loc.ev.pitches = loc.ev.pitches.map((p) => ({
    ...p, alter: Math.max(-2, Math.min(2, (p.alter || 0) + delta)),
  }));
}

export function toggleArticulation(score, eventId, art) {
  const loc = findEvent(score, eventId);
  if (!loc) return;
  const list = loc.ev.articulations || [];
  loc.ev.articulations = list.includes(art) ? list.filter((a) => a !== art) : [...list, art];
}

export function setDynamic(score, eventId, dynamic) {
  updateEvent(score, eventId, (ev) => { ev.dynamic = ev.dynamic === dynamic ? null : dynamic; });
}

export function setOrnament(score, eventId, ornament) {
  updateEvent(score, eventId, (ev) => { ev.ornament = ev.ornament === ornament ? null : ornament; });
}

export function toggleTie(score, eventId) {
  updateEvent(score, eventId, (ev) => { ev.tie = !ev.tie; });
}

export function setStem(score, eventId, stem) {
  updateEvent(score, eventId, (ev) => { ev.stem = stem; });
}

export function setLyric(score, eventId, lyric) {
  updateEvent(score, eventId, (ev) => { ev.lyric = lyric || null; });
}

export function setTechnique(score, eventId, technique) {
  updateEvent(score, eventId, (ev) => {
    ev.technique = ev.technique === technique ? null : technique;
  });
}

export function setChordSymbol(score, eventId, chord) {
  updateEvent(score, eventId, (ev) => { ev.chord = (chord || '').trim() || null; });
}

export function setText(score, eventId, text) {
  updateEvent(score, eventId, (ev) => { ev.text = text || null; });
}

export function setSlur(score, eventIds) {
  if (eventIds.length < 2) return;
  eventIds.forEach((id, i) => {
    updateEvent(score, id, (ev) => {
      ev.slur = i === 0 ? 'start' : i === eventIds.length - 1 ? 'stop' : 'mid';
    });
  });
}

export function clearSlur(score, eventIds) {
  eventIds.forEach((id) => updateEvent(score, id, (ev) => { ev.slur = null; }));
}

/** Group selected events into a tuplet (e.g. 3 in the time of 2). */
export function applyTuplet(score, eventIds, num, den) {
  const tupletId = uid('t');
  eventIds.forEach((id) => {
    updateEvent(score, id, (ev) => {
      ev.tuplet = { id: tupletId, num, den };
      ev.dur = { ...ev.dur, tuplet: { num, den } };
    });
  });
  // Re-fill affected bars so the measure stays complete.
  const loc = findEvent(score, eventIds[0]);
  if (loc) {
    const voice = score.parts[loc.partIndex].staves[loc.staffIndex].bars[loc.measureIndex].voices[loc.voiceIndex];
    score.parts[loc.partIndex].staves[loc.staffIndex].bars[loc.measureIndex].voices[loc.voiceIndex] =
      normalizeVoice(voice, measureTicks(score, loc.measureIndex));
  }
}

export function clearTuplet(score, eventIds) {
  eventIds.forEach((id) => updateEvent(score, id, (ev) => {
    ev.tuplet = null;
    delete ev.dur.tuplet;
  }));
}

// ------------------------------------------------------------------ structure

export function addMeasures(score, count = 1, atIndex = null) {
  const index = atIndex === null ? score.measures.length : atIndex;
  for (let i = 0; i < count; i++) {
    const ticks = measureTicks(score, Math.max(0, index - 1));
    score.measures.splice(index + i, 0, makeMeasureAttrs());
    for (const part of score.parts) {
      for (const staff of part.staves) staff.bars.splice(index + i, 0, makeBar(ticks));
    }
  }
  const last = score.measures[score.measures.length - 1];
  score.measures.forEach((m) => { if (m.barline === 'final') m.barline = null; });
  last.barline = 'final';
}

export function removeMeasure(score, index) {
  if (score.measures.length <= 1) return;
  score.measures.splice(index, 1);
  for (const part of score.parts) {
    for (const staff of part.staves) staff.bars.splice(index, 1);
  }
  score.measures[score.measures.length - 1].barline = 'final';
}

export function setTimeSignature(score, measureIndex, ts) {
  score.measures[measureIndex].timeSig = { ...ts };
  // Every measure from here to the next explicit change must be re-fitted.
  for (let m = measureIndex; m < score.measures.length; m++) {
    if (m > measureIndex && score.measures[m].timeSig) break;
    const ticks = timeSigTicks(timeSigAt(score, m));
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const bar = staff.bars[m];
        bar.voices = bar.voices.map((v) => normalizeVoice(v, ticks));
      }
    }
  }
}

export function setKeySignature(score, measureIndex, fifths, { respell = true } = {}) {
  score.measures[measureIndex].keySig = fifths;
  if (!respell) return;
  for (let m = measureIndex; m < score.measures.length; m++) {
    if (m > measureIndex && score.measures[m].keySig !== null && score.measures[m].keySig !== undefined) break;
    for (const part of score.parts) {
      for (const staff of part.staves) {
        for (const voice of staff.bars[m].voices) {
          for (const ev of voice) {
            if (ev.kind !== 'note') continue;
            ev.pitches = ev.pitches.map((p) => ({ ...p, alter: alterForKey(p.step, fifths) }));
          }
        }
      }
    }
  }
}

export function setMeasureTempo(score, measureIndex, tempo) {
  score.measures[measureIndex].tempo = tempo;
}

export function setBarline(score, measureIndex, barline) {
  score.measures[measureIndex].barline = barline;
}

export function toggleRepeat(score, measureIndex, which) {
  const m = score.measures[measureIndex];
  m[which] = !m[which];
}

export function setRehearsal(score, measureIndex, mark) {
  score.measures[measureIndex].rehearsal = mark || null;
}

export function toggleSystemBreak(score, measureIndex) {
  score.measures[measureIndex].systemBreak = !score.measures[measureIndex].systemBreak;
}

export function addPart(score, instrumentId, atIndex = null) {
  const part = makePart(instrumentId, score.measures.length, timeSigTicks(timeSigAt(score, 0)));
  part.staves.forEach((staff, i) => {
    staff.bars = score.measures.map((_, m) => makeBar(measureTicks(score, m)));
  });
  if (atIndex === null) score.parts.push(part);
  else score.parts.splice(atIndex, 0, part);
  return part;
}

export function removePart(score, partIndex) {
  if (score.parts.length <= 1) return;
  score.parts.splice(partIndex, 1);
}

export function movePart(score, from, to) {
  if (to < 0 || to >= score.parts.length) return;
  const [p] = score.parts.splice(from, 1);
  score.parts.splice(to, 0, p);
}

export function setPartProps(score, partIndex, props) {
  Object.assign(score.parts[partIndex], props);
}

export function changeInstrument(score, partIndex, instrumentId) {
  const part = score.parts[partIndex];
  const inst = getInstrument(instrumentId);
  part.instrumentId = inst.id;
  part.name = inst.name;
  part.abbr = inst.abbr;
  part.transpose = inst.transpose || 0;
  const wanted = inst.staves || 1;
  while (part.staves.length < wanted) {
    part.staves.push(makeStaff(inst.clefs[part.staves.length] || 'bass', score.measures.length, measureTicks(score, 0)));
  }
  part.staves.length = wanted;
  part.staves.forEach((s, i) => { s.clef = inst.clefs[i] || s.clef; });
}

export function setStaffClef(score, partIndex, staffIndex, measureIndex, clef) {
  const staff = score.parts[partIndex].staves[staffIndex];
  if (measureIndex === 0) staff.clef = clef;
  else staff.clefChanges[measureIndex] = clef;
}

/** Make sure `voiceIndex` exists in this bar, adding empty voices as needed. */
export function ensureVoice(score, partIndex, staffIndex, measureIndex, voiceIndex) {
  const bar = score.parts[partIndex]?.staves[staffIndex]?.bars[measureIndex];
  if (!bar || voiceIndex > 3) return;
  while (bar.voices.length <= voiceIndex) {
    bar.voices.push(fillRests(measureTicks(score, measureIndex)));
  }
}

export function removeVoice(score, partIndex, staffIndex, measureIndex, voiceIndex) {
  const bar = score.parts[partIndex].staves[staffIndex].bars[measureIndex];
  if (voiceIndex === 0 || bar.voices.length <= 1) return;
  bar.voices.splice(voiceIndex, 1);
}

/** Replace a whole measure's first voice with rests. */
export function clearMeasure(score, partIndex, staffIndex, measureIndex) {
  const bar = score.parts[partIndex].staves[staffIndex].bars[measureIndex];
  bar.voices = [fillRests(measureTicks(score, measureIndex))];
}

/**
 * Stamp a tango accompaniment pattern onto a bar: marcato en 4 accents every beat,
 * sincopa accents the 3-3-2 grouping.
 */
export function applyTangoRhythm(score, partIndex, staffIndex, measureIndex, kind) {
  const bar = score.parts[partIndex]?.staves[staffIndex]?.bars[measureIndex];
  if (!bar) return;
  const ts = timeSigAt(score, measureIndex);
  const beat = Math.round(1920 / ts.d);
  const marks = kind === 'marcato4'
    ? Array.from({ length: ts.n }, (_, i) => i * beat)
    : [0, beat * 1.5, beat * 3];
  const articulation = kind === 'marcato4' ? 'marcato' : 'accent';

  for (const voice of bar.voices) {
    let tick = 0;
    for (const ev of voice) {
      if (ev.kind === 'note' && marks.includes(tick)) {
        if (!ev.articulations.includes(articulation)) ev.articulations.push(articulation);
      }
      tick += durationTicks(ev.dur);
    }
  }
  score.measures[measureIndex].text = kind === 'marcato4' ? 'marcato en 4' : 'síncopa';
}

// ------------------------------------------------------------------ recording

const NOTE_VALUES = DURATIONS
  .flatMap(({ base }) => [{ base, dots: 1 }, { base, dots: 0 }])
  .map((v) => ({ ...v, ticks: durationTicks(v) }))
  .sort((a, b) => b.ticks - a.ticks);

/**
 * Readable tied values for a note spanning [start, start+len): each aligned to its own
 * length, no off-beat note hiding the next beat, the middle of an even bar kept visible —
 * except the beat-and-a-half syncopation (tango's 3-3-2), which reads best whole.
 */
function noteValuesForRange(start, len, barLen, beat) {
  const beats = barLen / beat;
  const half = beats >= 4 && beats % 2 === 0 ? barLen / 2 : null;
  const out = [];
  let p = start;
  let left = len;
  while (left > 0) {
    const fit = NOTE_VALUES.find((v) => {
      if (v.ticks > left) return false;
      if (p % (v.dots ? v.ticks / 3 : v.ticks) !== 0) return false;
      const end = p + v.ticks;
      const offBeat = p % beat !== 0;
      if (v.dots && v.ticks === beat * 1.5 && offBeat && p % (beat / 2) === 0) return true;
      if (offBeat && end > Math.ceil(p / beat) * beat) return false;
      if (half && p > 0 && p < half && end > half) return false;
      return true;
    });
    if (!fit) {
      out.push(...ticksToDurations(left));
      break;
    }
    out.push({ base: fit.base, dots: fit.dots });
    p += fit.ticks;
    left -= fit.ticks;
  }
  return out;
}

/**
 * Write a transcribed single line into consecutive bars from `target.measureIndex`,
 * overwriting the target voice in every bar it reaches. Note ticks count from the start
 * of that bar and pitches are concert (sounding) MIDI. `spellFifths` spells them in a key other
 * than the signature's (the key the take was heard in). Returns the number of bars written.
 */
export function writeRecording(score, target, notes, { spellFifths = null } = {}) {
  const { partIndex, staffIndex, voiceIndex = 0, measureIndex } = target;
  const part = score.parts[partIndex];
  const staff = part?.staves[staffIndex];
  if (!staff || !notes.length) return 0;

  const lastTick = Math.max(...notes.map((n) => n.end));
  const bars = [];
  for (let m = measureIndex, at = 0; at < lastTick; m++) {
    if (m >= score.measures.length) addMeasures(score, 1);
    const len = measureTicks(score, m);
    bars.push({ m, at, len });
    at += len;
  }

  for (const { m, at, len } of bars) {
    const beat = WHOLE_TICKS / timeSigAt(score, m).d;
    const fifths = spellFifths ?? keySigAt(score, m);
    const voice = [];
    let p = 0;
    for (const n of notes) {
      const s = Math.max(n.start, at) - at;
      const e = Math.min(n.end, at + len) - at;
      if (e <= s) continue;
      if (s > p) voice.push(...restsForRange(p, s - p, len));
      const pitch = midiToPitch(n.midi - (part.transpose || 0), fifths);
      const values = noteValuesForRange(s, e - s, len, beat);
      values.forEach((d, i) => {
        const ev = makeNote([pitch], d);
        if (i < values.length - 1 || n.end > at + len) ev.tie = true;
        voice.push(ev);
      });
      p = e;
    }
    if (p < len) voice.push(...restsForRange(p, len - p, len));
    const bar = staff.bars[m];
    while (bar.voices.length <= voiceIndex) bar.voices.push(fillRests(len));
    bar.voices[voiceIndex] = voice;
  }
  return bars.length;
}

// ------------------------------------------------------------------ clipboard

export function copyRange(score, cur, measureCount = 1) {
  const staff = score.parts[cur.partIndex]?.staves[cur.staffIndex];
  if (!staff) return null;
  const bars = [];
  for (let m = cur.measureIndex; m < Math.min(score.measures.length, cur.measureIndex + measureCount); m++) {
    bars.push(structuredClone(staff.bars[m]));
  }
  return { type: 'bars', bars };
}

export function pasteRange(score, cur, clip) {
  if (!clip || clip.type !== 'bars') return;
  const staff = score.parts[cur.partIndex]?.staves[cur.staffIndex];
  if (!staff) return;
  clip.bars.forEach((bar, i) => {
    const m = cur.measureIndex + i;
    if (m >= staff.bars.length) return;
    const clone = structuredClone(bar);
    clone.voices = clone.voices.map((v) => normalizeVoice(
      v.map((ev) => ({ ...ev, id: uid(ev.kind === 'rest' ? 'r' : 'n') })),
      measureTicks(score, m),
    ));
    staff.bars[m] = clone;
  });
}

/** Transpose an entire part (or the whole score) by semitones. */
export function transposeScope(score, semitones, partIndex = null) {
  const parts = partIndex === null ? score.parts : [score.parts[partIndex]];
  for (const part of parts) {
    for (const staff of part.staves) {
      staff.bars.forEach((bar, m) => {
        const fifths = keySigAt(score, m);
        for (const voice of bar.voices) {
          for (const ev of voice) {
            if (ev.kind !== 'note') continue;
            ev.pitches = ev.pitches.map((p) => transposePitch(p, semitones, fifths));
          }
        }
      });
    }
  }
}

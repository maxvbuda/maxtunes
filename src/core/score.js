// Score document model and structural helpers.

import { durationTicks, timeSigTicks, ticksToDurations } from './theory.js';
import { getInstrument } from './instruments.js';

let counter = 0;
export const uid = (prefix = 'e') => `${prefix}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function makeRest(dur = { base: 4, dots: 0 }) {
  return {
    id: uid('r'), kind: 'rest', dur: { ...dur }, pitches: [], tuplet: null,
    articulations: [], dynamic: null, text: null, lyric: null, slur: null,
    chord: null, stem: 'auto', tie: false, hidden: false,
  };
}

export function makeNote(pitches, dur = { base: 4, dots: 0 }) {
  return {
    id: uid('n'), kind: 'note', dur: { ...dur },
    pitches: pitches.map((p) => ({ step: p.step, octave: p.octave, alter: p.alter || 0 })),
    tuplet: null, articulations: [], ornament: null, dynamic: null, text: null,
    lyric: null, slur: null, chord: null, technique: null,
    stem: 'auto', tie: false, hidden: false, cue: false,
  };
}

export function makeMeasureAttrs(overrides = {}) {
  return {
    timeSig: null, keySig: null, tempo: null, startRepeat: false, endRepeat: false,
    ending: null, barline: null, systemBreak: false, rehearsal: null, text: null,
    ...overrides,
  };
}

export function makeBar(ticks) {
  return { voices: [fillRests(ticks)] };
}

// Plain (undotted) values, longest first — dotted rests are avoided in simple meters.
const REST_VALUES = [1, 2, 4, 8, 16, 32, 64].map((base) => ({ base, dots: 0 }));

/**
 * Rests covering [start, start+len) inside a bar of `total` ticks.
 * Each rest is aligned to its own duration, which is what produces conventional
 * groupings (an eighth rest completing beat 1, then a quarter, then a half).
 */
export function restsForRange(start, len, total) {
  if (len <= 0) return [];
  if (start === 0 && len === total) return [makeRest({ base: 1, dots: 0 })];

  const out = [];
  let p = start;
  let left = len;
  let guard = 0;
  while (left > 0 && guard++ < 128) {
    const fit = REST_VALUES.find((v) => {
      const t = durationTicks(v);
      return t <= left && p % t === 0;
    });
    if (!fit) break;
    out.push(makeRest(fit));
    const t = durationTicks(fit);
    p += t;
    left -= t;
  }
  if (left > 0) out.push(...ticksToDurations(left).map((d) => makeRest(d)));
  return out;
}

/** Build a run of rests totalling `ticks`, preferring a single whole-measure rest. */
export function fillRests(ticks) {
  return restsForRange(0, ticks, ticks);
}

export function makeStaff(clef, measureCount, ticks) {
  return {
    id: uid('s'), clef,
    clefChanges: {},
    bars: Array.from({ length: measureCount }, () => makeBar(ticks)),
  };
}

export function makePart(instrumentId, measureCount = 8, ticks = 1920) {
  const inst = getInstrument(instrumentId);
  return {
    id: uid('p'),
    instrumentId: inst.id,
    name: inst.name,
    abbr: inst.abbr,
    transpose: inst.transpose || 0,
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    visible: true,
    staves: (inst.clefs || ['treble']).slice(0, inst.staves || 1).map((c) => makeStaff(c, measureCount, ticks)),
  };
}

export function createScore(options = {}) {
  const {
    title = 'Untitled Score',
    composer = '',
    instruments = ['piano'],
    measureCount = 12,
    timeSig = { n: 4, d: 4 },
    keySig = 0,
    tempo = 100,
  } = options;

  const ticks = timeSigTicks(timeSig);
  const measures = Array.from({ length: measureCount }, (_, i) =>
    makeMeasureAttrs(i === 0 ? { timeSig, keySig, tempo } : {}),
  );
  measures[measures.length - 1].barline = 'final';

  return {
    id: uid('sc'),
    version: 1,
    title,
    subtitle: '',
    composer,
    lyricist: '',
    copyright: '',
    tempo,
    mode: 'major',
    measures,
    parts: instruments.map((i) => makePart(i, measureCount, ticks)),
  };
}

// ------------------------------------------------------------- attribute resolution

export function timeSigAt(score, measureIndex) {
  let ts = { n: 4, d: 4 };
  for (let i = 0; i <= measureIndex && i < score.measures.length; i++) {
    if (score.measures[i].timeSig) ts = score.measures[i].timeSig;
  }
  return ts;
}

export function keySigAt(score, measureIndex) {
  let k = 0;
  for (let i = 0; i <= measureIndex && i < score.measures.length; i++) {
    if (score.measures[i].keySig !== null && score.measures[i].keySig !== undefined) k = score.measures[i].keySig;
  }
  return k;
}

export function tempoAt(score, measureIndex) {
  let t = score.tempo;
  for (let i = 0; i <= measureIndex && i < score.measures.length; i++) {
    if (score.measures[i].tempo) t = score.measures[i].tempo;
  }
  return t;
}

export function clefAt(staff, measureIndex) {
  let clef = staff.clef;
  for (const key of Object.keys(staff.clefChanges || {})) {
    const idx = Number(key);
    if (idx <= measureIndex) clef = staff.clefChanges[key];
  }
  return clef;
}

export function measureTicks(score, measureIndex) {
  return timeSigTicks(timeSigAt(score, measureIndex));
}

export function barDuration(voice) {
  return voice.reduce((sum, ev) => sum + durationTicks(ev.dur), 0);
}

/** Pad or trim a voice so it exactly fills the measure, consolidating runs of rests. */
export function normalizeVoice(voice, ticks) {
  const out = [];
  let used = 0;
  for (const ev of voice) {
    const d = durationTicks(ev.dur);
    if (used + d <= ticks) {
      out.push(ev);
      used += d;
    } else if (used < ticks) {
      // Truncate the overflowing event into writable pieces.
      for (const dur of ticksToDurations(ticks - used)) {
        out.push(ev.kind === 'rest' ? makeRest(dur) : { ...ev, id: uid('n'), dur });
      }
      used = ticks;
    }
  }
  if (used < ticks) out.push(...restsForRange(used, ticks - used, ticks));
  if (!out.length) return fillRests(ticks);

  // Rewrite each run of consecutive rests so it reads conventionally.
  const merged = [];
  let position = 0;
  let runStart = 0;
  let runLength = 0;
  const flush = () => {
    if (runLength > 0) merged.push(...restsForRange(runStart, runLength, ticks));
    runLength = 0;
  };
  for (const ev of out) {
    const d = durationTicks(ev.dur);
    if (ev.kind === 'rest') {
      if (runLength === 0) runStart = position;
      runLength += d;
    } else {
      flush();
      merged.push(ev);
    }
    position += d;
  }
  flush();
  return merged;
}

export function getVoice(part, staffIndex, measureIndex, voiceIndex = 0) {
  const staff = part.staves[staffIndex];
  if (!staff) return null;
  const bar = staff.bars[measureIndex];
  if (!bar) return null;
  return bar.voices[voiceIndex] ?? null;
}

/** Positions of each event within a voice, as {ev, start, end, index}. */
export function voiceTimeline(voice) {
  let t = 0;
  return voice.map((ev, index) => {
    const start = t;
    t += durationTicks(ev.dur);
    return { ev, start, end: t, index };
  });
}

/** Locate the event covering `tick` in a voice. */
export function eventAtTick(voice, tick) {
  return voiceTimeline(voice).find((s) => tick >= s.start && tick < s.end) ?? null;
}

/**
 * The note a chord tone should attach to: one starting at the caret (shift-clicked),
 * otherwise the note the caret has just moved past (typed with shift held).
 * Returns null when the caret is not adjacent to a note.
 */
export function chordAnchor(score, cursor) {
  const staff = score.parts[cursor.partIndex]?.staves[cursor.staffIndex];
  if (!staff) return null;
  const voiceIndex = cursor.voiceIndex || 0;
  const voiceAt = (m) => staff.bars[m]?.voices[voiceIndex] || null;

  const here = voiceAt(cursor.measureIndex);
  if (here) {
    const slots = voiceTimeline(here);
    const starting = slots.find((s) => s.start === cursor.tick && s.ev.kind === 'note');
    if (starting) return starting.ev.id;
    const ending = slots.find((s) => s.end === cursor.tick && s.ev.kind === 'note');
    if (ending) return ending.ev.id;
  }
  // A note that filled the previous bar leaves the caret at the start of this one.
  if (cursor.tick === 0 && cursor.measureIndex > 0) {
    const prev = voiceAt(cursor.measureIndex - 1);
    const last = prev?.[prev.length - 1];
    if (last?.kind === 'note') return last.id;
  }
  return null;
}

/** The next event in the same voice, crossing bar lines. Used for chord/lyric entry. */
export function nextEventInVoice(score, eventId) {
  const loc = findEvent(score, eventId);
  if (!loc) return null;
  const staff = score.parts[loc.partIndex].staves[loc.staffIndex];
  const voice = staff.bars[loc.measureIndex].voices[loc.voiceIndex];
  if (voice[loc.index + 1]) return voice[loc.index + 1].id;
  for (let m = loc.measureIndex + 1; m < staff.bars.length; m++) {
    const next = staff.bars[m].voices[loc.voiceIndex];
    if (next?.length) return next[0].id;
  }
  return null;
}

export function totalMeasures(score) {
  return score.measures.length;
}

export function allStaves(score) {
  const out = [];
  score.parts.forEach((part, partIndex) => {
    part.staves.forEach((staff, staffIndex) => out.push({ part, partIndex, staff, staffIndex }));
  });
  return out;
}

export function cloneScore(score) {
  return structuredClone(score);
}

export function findEvent(score, eventId) {
  for (let pi = 0; pi < score.parts.length; pi++) {
    const part = score.parts[pi];
    for (let si = 0; si < part.staves.length; si++) {
      const staff = part.staves[si];
      for (let mi = 0; mi < staff.bars.length; mi++) {
        const bar = staff.bars[mi];
        for (let vi = 0; vi < bar.voices.length; vi++) {
          const idx = bar.voices[vi].findIndex((e) => e.id === eventId);
          if (idx >= 0) {
            return { partIndex: pi, staffIndex: si, measureIndex: mi, voiceIndex: vi, index: idx, ev: bar.voices[vi][idx] };
          }
        }
      }
    }
  }
  return null;
}

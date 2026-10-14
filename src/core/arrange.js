// Arrangement from a recorded line: find its key, harmonise it, and write an accompaniment —
// on the left hand of the same keyboard part when that hand is free, otherwise on a piano
// part of its own.

import {
  STEPS, KEY_NAMES, MINOR_KEY_NAMES, WHOLE_TICKS, alterForKey, ticksToDurations, midiToPitch,
} from './theory.js';
import { makeNote, restsForRange, measureTicks, timeSigAt, keySigAt } from './score.js';
import { addPart } from './edit.js';
import { getInstrument } from './instruments.js';

export const ARRANGE_STYLES = [
  { id: 'off', label: 'Off' },
  { id: 'chords', label: 'Chords' },
  { id: 'marcato', label: 'Marcato' },
  { id: 'sincopa', label: 'Síncopa' },
];

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod12 = (n) => ((n % 12) + 12) % 12;
const ACC_TEXT = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };

// ------------------------------------------------------------------ key

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(hist, profile, tonic) {
  const n = 12;
  const mx = hist.reduce((a, b) => a + b, 0) / n;
  const my = profile.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    const x = hist[mod12(tonic + i)] - mx;
    const y = profile[i] - my;
    sxy += x * y; sxx += x * x; syy += y * y;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

function fifthsOf(majorPc, preferFlats) {
  const f = mod12(majorPc * 7);
  if (f === 6) return preferFlats ? -6 : 6;
  return f > 6 ? f - 12 : f;
}

function spelledName(name) {
  return { step: name[0], alter: name.includes('#') ? 1 : name.includes('b') ? -1 : 0 };
}

/**
 * Most likely key of a line of { midi, start, end } notes, weighted by duration.
 * The score's key signature breaks near-ties, and so does a line ending on the tonic.
 */
export function detectKey(notes, scoreFifths = 0) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[mod12(n.midi)] += Math.max(1, n.end - n.start);
  const lastPc = notes.length ? mod12(notes[notes.length - 1].midi) : null;

  let best = null;
  for (let pc = 0; pc < 12; pc++) {
    for (const mode of ['major', 'minor']) {
      const majorPc = mode === 'major' ? pc : mod12(pc + 3);
      const fifths = fifthsOf(majorPc, scoreFifths < 0);
      let r = correlate(hist, mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE, pc);
      if (fifths === scoreFifths) r += 0.06;
      if (lastPc === pc) r += 0.05;
      if (!best || r > best.r) best = { r, pc, mode, fifths };
    }
  }
  const name = (best.mode === 'major' ? KEY_NAMES : MINOR_KEY_NAMES)[String(best.fifths)].replace(/m$/, '');
  return { tonicPc: best.pc, mode: best.mode, fifths: best.fifths, tonic: spelledName(name), name: `${name} ${best.mode}` };
}

/** Key signature (in fifths) to spell a part in, given its concert key and transposition. */
export function writtenFifths(key, transpose = 0) {
  let f = key.fifths + mod12(-transpose * 7);
  while (f > 6) f -= 12;
  while (f < -6) f += 12;
  return f;
}

// ------------------------------------------------------------------ chords

const QUALITY = {
  maj: { intervals: [0, 4, 7], text: '' },
  min: { intervals: [0, 3, 7], text: 'm' },
  dim: { intervals: [0, 3, 6], text: 'dim' },
  dom7: { intervals: [0, 4, 7, 10], text: '7' },
};

// Diatonic chords worth offering. The minor dominant takes the raised leading tone.
const DEGREES = {
  major: [[0, 'maj'], [1, 'min'], [2, 'min'], [3, 'maj'], [4, 'dom7'], [5, 'min']],
  minor: [[0, 'min'], [1, 'dim'], [2, 'maj'], [3, 'min'], [4, 'dom7'], [5, 'maj'], [6, 'maj']],
};

// Progressions that read as functional (from degree -> to degrees), and ones that don't.
const GOOD = {
  major: { 0: [1, 3, 4, 5], 1: [4], 2: [3, 5], 3: [0, 1, 4], 4: [0, 5], 5: [1, 3, 4] },
  minor: { 0: [1, 3, 4, 5, 6], 1: [4], 2: [3, 5], 3: [0, 4], 4: [0, 5], 5: [1, 3, 4], 6: [0, 2] },
};
const RETROGRESSIONS = new Set(['4>1', '4>3']);

function buildChord(key, degree, quality) {
  const rootIdx = (STEPS.indexOf(key.tonic.step) + degree) % 7;
  const step = STEPS[rootIdx];
  const alter = alterForKey(step, key.fifths);
  const rootPc = mod12(STEP_PC[step] + alter);
  const q = QUALITY[quality];
  const tones = q.intervals.map((iv, i) => {
    const letter = STEPS[(rootIdx + [0, 2, 4, 6][i]) % 7];
    const pc = mod12(rootPc + iv);
    return { step: letter, alter: mod12(pc - STEP_PC[letter] + 6) - 6, pc };
  });
  return {
    degree,
    quality,
    tones,
    pcs: new Set(tones.map((t) => t.pc)),
    symbol: `${step}${ACC_TEXT[String(alter)] ?? ''}${q.text}`,
  };
}

/** How well a chord fits the melody sounding over [start, start+len). */
function fit(chord, notes, start, len, beat) {
  let score = 0;
  for (const n of notes) {
    const overlap = Math.min(n.end, start + len) - Math.max(n.start, start);
    if (overlap <= 0) continue;
    let w = overlap / beat;
    const onDownbeat = n.start <= start && n.end > start;
    if (onDownbeat) w *= 1.5;
    score += chord.pcs.has(mod12(n.midi)) ? w : -0.6 * w;
    if (onDownbeat && mod12(n.midi) === chord.tones[0].pc) score += 0.3;
  }
  return score;
}

function transition(key, from, to, sameBar) {
  if (from === to) return sameBar ? 0.5 : 0.25;
  if (GOOD[key.mode][from.degree]?.includes(to.degree)) return 0.35;
  if (RETROGRESSIONS.has(`${from.degree}>${to.degree}`)) return -0.3;
  return 0;
}

/**
 * Choose one chord per segment with a Viterbi pass: each chord's fit to the melody plus
 * how naturally it follows the previous one, opening and closing on the tonic.
 */
export function harmonize(notes, segments, key) {
  const chords = DEGREES[key.mode].map(([d, q]) => buildChord(key, d, q));
  const last = segments.length - 1;
  const rows = [];
  segments.forEach((seg, s) => {
    const row = chords.map((c) => {
      let local = fit(c, notes, seg.start, seg.len, seg.beat);
      if (s === 0 && c.degree === 0) local += 0.6;
      if (s === last && c.degree === 0) local += 1;
      if (s === last - 1 && c.degree === 4) local += 0.3;
      if (s === 0) return { total: local, from: -1 };
      const prev = rows[s - 1];
      let best = { total: -Infinity, from: 0 };
      chords.forEach((p, pi) => {
        const t = prev[pi].total + transition(key, p, c, segments[s - 1].bar === seg.bar);
        if (t > best.total) best = { total: t, from: pi };
      });
      return { total: best.total + local, from: best.from };
    });
    rows.push(row);
  });

  let ci = 0;
  rows[last].forEach((r, i) => { if (r.total > rows[last][ci].total) ci = i; });
  const picked = new Array(segments.length);
  for (let s = last; s >= 0; s--) {
    picked[s] = chords[ci];
    ci = rows[s][ci].from;
  }
  return picked;
}

// ------------------------------------------------------------------ voicing

function closeVoicings(pcs, lo, hi) {
  const out = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo; base <= hi; base++) {
      if (mod12(base) !== order[0]) continue;
      const v = [base];
      for (const pc of order.slice(1)) {
        const prev = v[v.length - 1];
        v.push(prev + (mod12(pc - prev) || 12));
      }
      if (v[v.length - 1] <= hi) out.push(v);
    }
  }
  return out;
}

/** The close voicing nearest the previous one, so the accompaniment moves smoothly. */
function voiceChord(chord, lo, hi, prev) {
  // A seventh chord drops its fifth: three notes keep the texture even.
  const tones = chord.tones.length > 3 ? [chord.tones[0], chord.tones[1], chord.tones[3]] : chord.tones;
  const options = closeVoicings(tones.map((t) => t.pc), lo, hi);
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const target = prev ?? [(lo + hi) / 2];
  const cost = (v) => Math.abs(mean(v) - mean(target)) + 0.5 * Math.abs(v[v.length - 1] - target[target.length - 1]);
  return options.reduce((best, v) => (cost(v) < cost(best) ? v : best), options[0]);
}

function bassNote(chord, lo, hi, prev) {
  const root = chord.tones[0].pc;
  let best = null;
  for (let m = lo; m <= hi; m++) {
    if (mod12(m) !== root) continue;
    if (best === null || Math.abs(m - (prev ?? (lo + hi) / 2)) < Math.abs(best - (prev ?? (lo + hi) / 2))) best = m;
  }
  return best;
}

function rootPositionAbove(chord, bass) {
  const tones = chord.tones.length > 3 ? [chord.tones[1], chord.tones[3]] : chord.tones.slice(1);
  return tones.map((t) => bass + (mod12(t.pc - bass) || 12));
}

/** Spell a MIDI chord tone the way the chord spells it. */
function spell(midi, chord) {
  const tone = chord.tones.find((t) => t.pc === mod12(midi));
  if (!tone) return midiToPitch(midi);
  return { step: tone.step, alter: tone.alter, octave: Math.floor((midi - tone.alter - STEP_PC[tone.step]) / 12) - 1 };
}

// ------------------------------------------------------------------ rhythm

/** Beat length in ticks; compound meters beat in dotted values. */
function beatTicks(ts) {
  if (ts.d === 8 && ts.n % 3 === 0 && ts.n > 3) return (WHOLE_TICKS / 8) * 3;
  return WHOLE_TICKS / ts.d;
}

/** Where the accompaniment strikes inside a bar: [{ offset, len, accent }]. */
function hitsFor(style, barLen, ts, segments) {
  const beat = beatTicks(ts);
  if (style === 'sincopa' && barLen === WHOLE_TICKS && ts.n * (WHOLE_TICKS / ts.d) === WHOLE_TICKS && ts.d <= 4) {
    // 3-3-2 in eighths.
    return [[0, 720], [720, 720], [1440, 480]].map(([offset, len]) => ({ offset, len, accent: true }));
  }
  if (style === 'marcato' || style === 'sincopa') {
    const hits = [];
    for (let at = 0; at < barLen; at += beat) hits.push({ offset: at, len: Math.min(beat, barLen - at), accent: true });
    return hits;
  }
  return segments.map((s) => ({ offset: s.offset, len: s.len, accent: false }));
}

// ------------------------------------------------------------------ writing

const isReplaceable = (bar) => bar.voices.every((v) => v.every((ev) => ev.kind === 'rest' || ev.arranged));

/** Recording into the accompaniment, or onto drums, has nothing to arrange. */
export function canArrange(score, target) {
  const part = score.parts[target.partIndex];
  return !!part && part.role !== 'accompaniment' && !getInstrument(part.instrumentId).unpitched;
}

function destination(score, target, measures) {
  const part = score.parts[target.partIndex];
  const lowerHand = part.staves[1];
  if (lowerHand && target.staffIndex === 0 && measures.every((m) => isReplaceable(lowerHand.bars[m]))) {
    return { part, staves: [lowerHand], label: 'the left hand' };
  }
  let acc = score.parts.find((p) => p.role === 'accompaniment');
  if (!acc) {
    acc = addPart(score, 'piano', target.partIndex + 1);
    Object.assign(acc, { role: 'accompaniment', name: 'Accompaniment', abbr: 'Acc.' });
  }
  return { part: acc, staves: acc.staves, label: 'a piano accompaniment' };
}

function barVoice(hits, barLen, pitchesFor, symbols) {
  const voice = [];
  let p = 0;
  for (const hit of hits) {
    if (hit.offset > p) voice.push(...restsForRange(p, hit.offset - p, barLen));
    const pieces = ticksToDurations(hit.len);
    pieces.forEach((d, i) => {
      const ev = makeNote(pitchesFor(hit), d);
      ev.arranged = true;
      if (i < pieces.length - 1) ev.tie = true;
      if (i === 0) {
        if (hit.accent) ev.articulations = ['accent'];
        if (symbols) ev.chord = symbols.get(hit.offset) || null;
      }
      voice.push(ev);
    });
    p = hit.offset + hit.len;
  }
  if (p < barLen) voice.push(...restsForRange(p, barLen - p, barLen));
  return voice;
}

/**
 * Harmonise a recorded line and write the accompaniment for its bars. `notes` are concert
 * MIDI with ticks counted from the start of `target.measureIndex`, as `writeRecording` takes
 * them. Returns a summary for the status line, or null when there was nothing to do.
 */
export function arrangeRecording(score, target, notes, barCount, style = 'chords', key = null) {
  if (style === 'off' || !notes.length || !barCount || !canArrange(score, target)) return null;

  const bars = [];
  for (let i = 0, at = 0; i < barCount; i++) {
    const m = target.measureIndex + i;
    const len = measureTicks(score, m);
    bars.push({ m, at, len, ts: timeSigAt(score, m) });
    at += len;
  }

  // Two chords a bar in even meters of four or more beats; síncopa phrases over the whole bar.
  const segments = [];
  bars.forEach((b, bar) => {
    const split = style !== 'sincopa' && b.ts.d <= 4 && b.ts.n >= 4 && b.ts.n % 2 === 0;
    const parts = split ? 2 : 1;
    for (let k = 0; k < parts; k++) {
      const len = b.len / parts;
      segments.push({ bar, offset: k * len, start: b.at + k * len, len, beat: beatTicks(b.ts) });
    }
  });

  key = key || detectKey(notes, keySigAt(score, target.measureIndex));
  const chords = harmonize(notes, segments, key);
  const dest = destination(score, target, bars.map((b) => b.m));
  const [upper, lower] = dest.staves;
  const handOnly = !lower;
  const transpose = dest.part.transpose || 0;
  const toPitch = (midi, chord, m) => (transpose
    ? midiToPitch(midi - transpose, keySigAt(score, m))
    : spell(midi, chord));

  let prevVoicing = null;
  let prevBass = null;
  let prevSymbol = null;
  const progression = [];

  bars.forEach((b, bar) => {
    const segs = segments.map((s, i) => ({ ...s, chord: chords[i] })).filter((s) => s.bar === bar);
    // Hold a chord across both halves of a bar when it didn't change.
    const merged = segs.reduce((out, s) => {
      const last = out[out.length - 1];
      if (last && last.chord === s.chord) last.len += s.len;
      else out.push({ ...s });
      return out;
    }, []);
    const chordAt = (offset) => merged.filter((s) => s.offset <= offset).pop().chord;
    progression.push(merged.map((s) => s.chord.symbol).join(' '));

    const hits = hitsFor(style, b.len, b.ts, merged);
    const symbols = new Map();
    for (const hit of hits) {
      const sym = chordAt(hit.offset).symbol;
      if (sym !== prevSymbol) symbols.set(hit.offset, sym);
      prevSymbol = sym;
    }

    const voicings = new Map();
    for (const hit of hits) {
      const chord = chordAt(hit.offset);
      if (!voicings.has(chord)) {
        // One hand alone plays the chord in root position, within an octave of the bass.
        const bass = bassNote(chord, handOnly ? 41 : 40, handOnly ? 53 : 52, prevBass);
        const upperNotes = handOnly
          ? rootPositionAbove(chord, bass)
          : voiceChord(chord, 55, 76, prevVoicing);
        voicings.set(chord, { bass, upper: upperNotes });
        prevBass = bass;
        prevVoicing = upperNotes;
      }
    }
    const pitches = (hit, which) => {
      const chord = chordAt(hit.offset);
      const v = voicings.get(chord);
      const midis = which === 'upper' ? v.upper : which === 'bass' ? [v.bass] : [v.bass, ...v.upper];
      return midis.map((midi) => toPitch(midi, chord, b.m));
    };

    if (handOnly) {
      upper.bars[b.m].voices = [barVoice(hits, b.len, (h) => pitches(h, 'both'), symbols)];
    } else {
      upper.bars[b.m].voices = [barVoice(hits, b.len, (h) => pitches(h, 'upper'), symbols)];
      lower.bars[b.m].voices = [barVoice(hits, b.len, (h) => pitches(h, 'bass'), null)];
    }
  });

  const first = score.measures[target.measureIndex];
  if (!first.text && (style === 'marcato' || style === 'sincopa')) {
    const inFour = timeSigAt(score, target.measureIndex).n === 4;
    first.text = style === 'sincopa' ? 'síncopa' : inFour ? 'marcato en 4' : 'marcato';
  }

  return { key: key.name, progression, label: dest.label };
}

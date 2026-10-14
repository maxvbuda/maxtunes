// Pitch, duration and key-signature math shared by the editor, engraver and audio engine.

export const WHOLE_TICKS = 1920; // 480 ticks per quarter note

export const DURATIONS = [
  { base: 1, label: 'Whole', vf: 'w' },
  { base: 2, label: 'Half', vf: 'h' },
  { base: 4, label: 'Quarter', vf: 'q' },
  { base: 8, label: 'Eighth', vf: '8' },
  { base: 16, label: '16th', vf: '16' },
  { base: 32, label: '32nd', vf: '32' },
  { base: 64, label: '64th', vf: '64' },
];

const VF_DURATION = Object.fromEntries(DURATIONS.map((d) => [d.base, d.vf]));

export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function vfDuration(base, isRest = false) {
  return `${VF_DURATION[base] ?? 'q'}${isRest ? 'r' : ''}`;
}

export function durationTicks(dur) {
  const base = WHOLE_TICKS / dur.base;
  const dotted = base * (2 - 1 / Math.pow(2, dur.dots || 0));
  if (dur.tuplet) return Math.round((dotted * dur.tuplet.den) / dur.tuplet.num);
  return Math.round(dotted);
}

/** Split an arbitrary tick length into a list of writable {base,dots} durations, longest first. */
export function ticksToDurations(ticks) {
  const out = [];
  let left = ticks;
  const candidates = [];
  for (const { base } of DURATIONS) {
    for (const dots of [1, 0]) candidates.push({ base, dots });
  }
  candidates.sort((a, b) => durationTicks(b) - durationTicks(a));
  let guard = 0;
  while (left > 0 && guard++ < 64) {
    const fit = candidates.find((c) => durationTicks(c) <= left);
    if (!fit) break;
    out.push({ ...fit });
    left -= durationTicks(fit);
  }
  return out.length ? out : [{ base: 4, dots: 0 }];
}

// ---------------------------------------------------------------- pitch

/** Absolute diatonic index: C4 -> 28. Ignores accidentals. */
export function diatonic(step, octave) {
  return octave * 7 + STEPS.indexOf(step);
}

export function fromDiatonic(dn) {
  const octave = Math.floor(dn / 7);
  return { step: STEPS[dn - octave * 7], octave };
}

export function pitchToMidi(p) {
  return (p.octave + 1) * 12 + STEP_SEMITONE[p.step] + (p.alter || 0);
}

const SHARP_SPELLING = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_SPELLING = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];

/** Spell a midi number, preferring flats when the key signature has flats. */
export function midiToPitch(midi, fifths = 0) {
  const table = fifths < 0 ? FLAT_SPELLING : SHARP_SPELLING;
  const octave = Math.floor(midi / 12) - 1;
  const [step, alter] = table[((midi % 12) + 12) % 12];
  return { step, octave, alter };
}

export function pitchName(p) {
  const acc = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' }[String(p.alter || 0)] ?? '';
  return `${p.step}${acc}${p.octave}`;
}

export function vfKey(p) {
  const acc = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' }[String(p.alter || 0)] ?? '';
  return `${p.step.toLowerCase()}${acc}/${p.octave}`;
}

/** Diatonic degree of a pitch inside its key, used to pick the key-correct accidental. */
export function alterForKey(step, fifths) {
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  if (fifths > 0) return sharps.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return flats.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/** Move a pitch by diatonic steps, keeping it in the key signature. */
export function stepPitch(pitch, delta, fifths = 0) {
  const dn = diatonic(pitch.step, pitch.octave) + delta;
  const { step, octave } = fromDiatonic(dn);
  return { step, octave, alter: alterForKey(step, fifths) };
}

/** Move a pitch by semitones, respelling it. */
export function transposePitch(pitch, semitones, fifths = 0) {
  return midiToPitch(pitchToMidi(pitch) + semitones, fifths);
}

// ---------------------------------------------------------------- clefs & keys

export const CLEFS = {
  treble: { label: 'Treble', topLineDiatonic: diatonic('F', 5), midi: 71 },
  bass: { label: 'Bass', topLineDiatonic: diatonic('A', 3), midi: 50 },
  alto: { label: 'Alto', topLineDiatonic: diatonic('G', 4), midi: 60 },
  tenor: { label: 'Tenor', topLineDiatonic: diatonic('E', 4), midi: 57 },
  percussion: { label: 'Percussion', topLineDiatonic: diatonic('F', 5), midi: 71 },
};

/** VexFlow staff line (0 = top line, +0.5 per diatonic step downward) -> pitch. */
export function lineToPitch(line, clef, fifths = 0) {
  const top = (CLEFS[clef] ?? CLEFS.treble).topLineDiatonic;
  const dn = Math.round(top - line * 2);
  const { step, octave } = fromDiatonic(dn);
  return { step, octave, alter: alterForKey(step, fifths) };
}

export function pitchToLine(pitch, clef) {
  const top = (CLEFS[clef] ?? CLEFS.treble).topLineDiatonic;
  return (top - diatonic(pitch.step, pitch.octave)) / 2;
}

export const KEY_NAMES = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};
export const MINOR_KEY_NAMES = {
  '-7': 'Abm', '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm',
  0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m',
};

export function keySpec(fifths, mode = 'major') {
  return (mode === 'minor' ? MINOR_KEY_NAMES : KEY_NAMES)[String(fifths)] ?? 'C';
}

export const TIME_SIGNATURES = [
  { n: 4, d: 4 }, { n: 3, d: 4 }, { n: 2, d: 4 }, { n: 2, d: 2 },
  { n: 6, d: 8 }, { n: 9, d: 8 }, { n: 12, d: 8 }, { n: 5, d: 4 },
  { n: 7, d: 8 }, { n: 3, d: 8 }, { n: 5, d: 8 }, { n: 6, d: 4 },
];

export function timeSigTicks(ts) {
  return Math.round((WHOLE_TICKS * ts.n) / ts.d);
}

export const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
export const DYNAMIC_GAIN = {
  ppp: 0.12, pp: 0.2, p: 0.32, mp: 0.45, mf: 0.6, f: 0.78, ff: 0.9, fff: 1,
};

export const ARTICULATIONS = [
  { id: 'staccato', label: 'Staccato', vf: 'a.', glyph: '·' },
  { id: 'staccatissimo', label: 'Staccatissimo', vf: 'av', glyph: '▾' },
  { id: 'accent', label: 'Accent', vf: 'a>', glyph: '>' },
  { id: 'marcato', label: 'Marcato', vf: 'a^', glyph: '^' },
  { id: 'tenuto', label: 'Tenuto', vf: 'a-', glyph: '–' },
  { id: 'fermata', label: 'Fermata', vf: 'a@a', glyph: '𝄐' },
];

export const ORNAMENTS = [
  { id: 'trill', label: 'Trill', vf: 'tr' },
  { id: 'mordent', label: 'Mordent', vf: 'mordent' },
  { id: 'turn', label: 'Turn', vf: 'turn' },
];

/**
 * Tango playing techniques. Arrastre is the drag into the beat; chicharra and
 * tambor are the string effects (bowing behind the bridge, and damping to imitate
 * a drum); latigo is the whip glissando.
 */
export const TECHNIQUES = [
  { id: 'arrastre', label: 'Arrastre', notehead: null, text: null },
  { id: 'latigo', label: 'Látigo', notehead: null, text: 'látigo' },
  { id: 'chicharra', label: 'Chicharra', notehead: 'X2', text: 'chicharra' },
  { id: 'tambor', label: 'Tambor', notehead: 'X3', text: 'tambor' },
];

export const TECHNIQUE_BY_ID = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));

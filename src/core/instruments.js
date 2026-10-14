// Instrument catalogue: notation defaults plus synthesis parameters for the audio engine.

const env = (a, d, s, r) => ({ a, d, s, r });

const T = {
  piano: {
    osc: [{ wave: 'triangle', gain: 0.9 }, { wave: 'sine', ratio: 2, gain: 0.35 }, { wave: 'sine', ratio: 3.01, gain: 0.12 }],
    env: env(0.002, 1.6, 0.0, 0.35), filter: { freq: 5200, q: 0.7, envAmt: 3800, envDecay: 0.45 }, decayed: true,
  },
  epiano: {
    osc: [{ wave: 'sine', gain: 1 }, { wave: 'sine', ratio: 4.02, gain: 0.3 }, { wave: 'sine', ratio: 7, gain: 0.08 }],
    env: env(0.004, 1.9, 0.05, 0.4), filter: { freq: 3400, q: 0.6, envAmt: 2200, envDecay: 0.6 }, decayed: true,
  },
  organ: {
    osc: [{ wave: 'sine', gain: 0.8 }, { wave: 'sine', ratio: 2, gain: 0.5 }, { wave: 'sine', ratio: 3, gain: 0.3 }, { wave: 'sine', ratio: 4, gain: 0.2 }],
    env: env(0.02, 0.05, 0.95, 0.12), filter: { freq: 4200, q: 0.5, envAmt: 0 },
  },
  strings: {
    osc: [{ wave: 'sawtooth', gain: 0.7 }, { wave: 'sawtooth', detune: 8, gain: 0.5 }, { wave: 'sawtooth', detune: -9, gain: 0.5 }],
    env: env(0.12, 0.3, 0.8, 0.45), filter: { freq: 2400, q: 0.9, envAmt: 900, envDecay: 0.5 },
    vibrato: { rate: 5.2, depth: 5, delay: 0.35 },
  },
  pizz: {
    osc: [{ wave: 'triangle', gain: 1 }, { wave: 'sawtooth', gain: 0.3 }],
    env: env(0.002, 0.5, 0, 0.2), filter: { freq: 3000, q: 1.2, envAmt: 2600, envDecay: 0.18 }, decayed: true,
  },
  brass: {
    osc: [{ wave: 'sawtooth', gain: 0.9 }, { wave: 'square', ratio: 1.001, gain: 0.25 }],
    env: env(0.06, 0.18, 0.85, 0.22), filter: { freq: 1500, q: 1.4, envAmt: 2600, envDecay: 0.25 },
    vibrato: { rate: 5, depth: 3, delay: 0.4 },
  },
  reed: {
    osc: [{ wave: 'square', gain: 0.6 }, { wave: 'sawtooth', ratio: 2, gain: 0.18 }],
    env: env(0.04, 0.15, 0.85, 0.18), filter: { freq: 1900, q: 1.1, envAmt: 1400, envDecay: 0.3 },
    vibrato: { rate: 5.4, depth: 4, delay: 0.35 },
  },
  // Free-reed spectrum: strong odd harmonics, a dip at the 2nd and a peak at the 3rd.
  // That hollow-but-buzzy profile is what separates a reed from a filtered sawtooth.
  bandoneon: {
    partials: [
      1, 0.55, 0.72, 0.36, 0.40, 0.22, 0.26, 0.15, 0.14, 0.10,
      0.09, 0.07, 0.055, 0.045, 0.035, 0.028, 0.022, 0.018,
    ],
    // Two 8' reeds tuned nearly dry (a bandoneon is not a musette accordion),
    // plus a quiet 4' for the bite on top.
    osc: [
      { wave: 'reed', gain: 1 },
      { wave: 'reed', detune: 3, gain: 0.85 },
      { wave: 'reed', ratio: 2, gain: 0.26 },
    ],
    env: env(0.038, 0.1, 0.92, 0.1),
    // Barely tracks pitch: the instrument's resonances stay where they are.
    filter: { freq: 6500, q: 0.5, envAmt: 1400, envDecay: 0.07, track: 0.15 },
    formants: [
      { freq: 440, q: 2.0, gain: 6 },
      { freq: 1700, q: 1.6, gain: 7 },
      { freq: 3000, q: 2.2, gain: 4 },
    ],
    noise: 0.05,
    noiseDecay: 0.07,
    pitchAttack: -14,
    pitchAttackTime: 0.045,
    // Deliberately no vibrato — the player has no way to bend a reed; expression
    // comes from bellows pressure, which is dynamics, not pitch.
  },
  accordion: {
    partials: [
      1, 0.62, 0.58, 0.4, 0.32, 0.24, 0.2, 0.15, 0.12, 0.09,
      0.075, 0.06, 0.05, 0.04, 0.03, 0.024,
    ],
    // Musette: reeds deliberately detuned against each other for the beating.
    osc: [
      { wave: 'reed', gain: 1 },
      { wave: 'reed', detune: 13, gain: 0.8 },
      { wave: 'reed', detune: -12, gain: 0.8 },
    ],
    env: env(0.045, 0.12, 0.9, 0.12),
    filter: { freq: 5200, q: 0.6, envAmt: 1100, envDecay: 0.08, track: 0.2 },
    formants: [
      { freq: 500, q: 1.8, gain: 5 },
      { freq: 1500, q: 1.5, gain: 5 },
    ],
    noise: 0.04,
    noiseDecay: 0.06,
    pitchAttack: -10,
  },
  flute: {
    osc: [{ wave: 'sine', gain: 1 }, { wave: 'sine', ratio: 2, gain: 0.12 }],
    env: env(0.07, 0.12, 0.9, 0.18), filter: { freq: 3600, q: 0.6, envAmt: 800, envDecay: 0.3 },
    noise: 0.05, vibrato: { rate: 5.6, depth: 5, delay: 0.3 },
  },
  guitar: {
    osc: [{ wave: 'triangle', gain: 0.8 }, { wave: 'sawtooth', gain: 0.35 }, { wave: 'sine', ratio: 2.01, gain: 0.2 }],
    env: env(0.003, 1.1, 0.0, 0.25), filter: { freq: 3200, q: 1, envAmt: 2400, envDecay: 0.3 }, decayed: true,
  },
  bass: {
    osc: [{ wave: 'triangle', gain: 1 }, { wave: 'sine', ratio: 0.5, gain: 0.4 }],
    env: env(0.006, 1.0, 0.15, 0.25), filter: { freq: 900, q: 1.1, envAmt: 900, envDecay: 0.3 }, decayed: true,
  },
  voice: {
    osc: [{ wave: 'sawtooth', gain: 0.55 }, { wave: 'sine', ratio: 2, gain: 0.3 }, { wave: 'sine', ratio: 3, gain: 0.14 }],
    env: env(0.09, 0.2, 0.85, 0.3), filter: { freq: 1300, q: 3.2, envAmt: 700, envDecay: 0.4 },
    vibrato: { rate: 5, depth: 6, delay: 0.4 },
  },
  mallet: {
    osc: [{ wave: 'sine', gain: 1 }, { wave: 'sine', ratio: 4, gain: 0.35 }, { wave: 'sine', ratio: 9.2, gain: 0.1 }],
    env: env(0.001, 0.7, 0, 0.2), filter: { freq: 6000, q: 0.6, envAmt: 0 }, decayed: true,
  },
  pluckHarp: {
    osc: [{ wave: 'triangle', gain: 0.9 }, { wave: 'sine', ratio: 2, gain: 0.25 }],
    env: env(0.002, 2.0, 0, 0.5), filter: { freq: 4200, q: 0.7, envAmt: 2000, envDecay: 0.5 }, decayed: true,
  },
  synthLead: {
    osc: [{ wave: 'sawtooth', gain: 0.7 }, { wave: 'square', detune: 7, gain: 0.4 }],
    env: env(0.01, 0.25, 0.7, 0.25), filter: { freq: 1800, q: 6, envAmt: 3200, envDecay: 0.35 },
  },
  synthPad: {
    osc: [{ wave: 'sawtooth', gain: 0.5 }, { wave: 'sawtooth', detune: 11, gain: 0.5 }, { wave: 'triangle', ratio: 0.5, gain: 0.3 }],
    env: env(0.6, 0.8, 0.8, 1.4), filter: { freq: 1400, q: 1.5, envAmt: 1200, envDecay: 1.5 },
  },
  drums: {
    osc: [{ wave: 'triangle', gain: 0.6 }],
    env: env(0.001, 0.28, 0, 0.1), filter: { freq: 5000, q: 0.8, envAmt: 0 }, noise: 0.85, decayed: true,
  },
};

/** id, name, abbr, family, clef(s), transpose (written -> sounding semitones), range, timbre. */
export const INSTRUMENTS = [
  // Keyboards
  { id: 'piano', name: 'Piano', abbr: 'Pno.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [21, 108], timbre: T.piano, brace: 'brace' },
  { id: 'celesta', name: 'Celesta', abbr: 'Cel.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [60, 108], timbre: T.mallet, brace: 'brace' },
  { id: 'harpsichord', name: 'Harpsichord', abbr: 'Hpsd.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [29, 89], timbre: T.pizz, brace: 'brace' },
  { id: 'epiano', name: 'Electric Piano', abbr: 'E.Pno.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [28, 103], timbre: T.epiano, brace: 'brace' },
  { id: 'organ', name: 'Pipe Organ', abbr: 'Org.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [36, 96], timbre: T.organ, brace: 'brace' },
  { id: 'accordion', name: 'Accordion', abbr: 'Accn.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [41, 96], timbre: T.accordion, brace: 'brace' },
  { id: 'bandoneon', name: 'Bandoneón', abbr: 'Bdn.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [36, 93], timbre: T.bandoneon, brace: 'brace' },
  { id: 'harp', name: 'Harp', abbr: 'Hp.', family: 'Keyboards', staves: 2, clefs: ['treble', 'bass'], range: [24, 104], timbre: T.pluckHarp, brace: 'brace' },

  // Voice
  { id: 'soprano', name: 'Soprano', abbr: 'S.', family: 'Voice', staves: 1, clefs: ['treble'], range: [60, 81], timbre: T.voice, lyrics: true },
  { id: 'alto-voice', name: 'Alto', abbr: 'A.', family: 'Voice', staves: 1, clefs: ['treble'], range: [55, 74], timbre: T.voice, lyrics: true },
  { id: 'tenor-voice', name: 'Tenor', abbr: 'T.', family: 'Voice', staves: 1, clefs: ['treble'], range: [48, 69], timbre: T.voice, lyrics: true },
  { id: 'bass-voice', name: 'Bass', abbr: 'B.', family: 'Voice', staves: 1, clefs: ['bass'], range: [40, 62], timbre: T.voice, lyrics: true },
  { id: 'choir', name: 'Choir (Aahs)', abbr: 'Ch.', family: 'Voice', staves: 2, clefs: ['treble', 'bass'], range: [40, 81], timbre: T.voice, brace: 'brace' },

  // Woodwinds
  { id: 'piccolo', name: 'Piccolo', abbr: 'Picc.', family: 'Woodwinds', staves: 1, clefs: ['treble'], transpose: 12, range: [74, 108], timbre: T.flute },
  { id: 'flute', name: 'Flute', abbr: 'Fl.', family: 'Woodwinds', staves: 1, clefs: ['treble'], range: [60, 96], timbre: T.flute },
  { id: 'oboe', name: 'Oboe', abbr: 'Ob.', family: 'Woodwinds', staves: 1, clefs: ['treble'], range: [58, 91], timbre: T.reed },
  { id: 'clarinet', name: 'Clarinet in B♭', abbr: 'Cl.', family: 'Woodwinds', staves: 1, clefs: ['treble'], transpose: -2, range: [50, 91], timbre: T.reed },
  { id: 'bass-clarinet', name: 'Bass Clarinet', abbr: 'B.Cl.', family: 'Woodwinds', staves: 1, clefs: ['treble'], transpose: -14, range: [38, 77], timbre: T.reed },
  { id: 'bassoon', name: 'Bassoon', abbr: 'Bsn.', family: 'Woodwinds', staves: 1, clefs: ['bass'], range: [34, 74], timbre: T.reed },
  { id: 'alto-sax', name: 'Alto Saxophone', abbr: 'A.Sx.', family: 'Woodwinds', staves: 1, clefs: ['treble'], transpose: -9, range: [49, 85], timbre: T.reed },
  { id: 'tenor-sax', name: 'Tenor Saxophone', abbr: 'T.Sx.', family: 'Woodwinds', staves: 1, clefs: ['treble'], transpose: -14, range: [44, 80], timbre: T.reed },
  { id: 'recorder', name: 'Recorder', abbr: 'Rec.', family: 'Woodwinds', staves: 1, clefs: ['treble'], range: [60, 91], timbre: T.flute },

  // Brass
  { id: 'trumpet', name: 'Trumpet in B♭', abbr: 'Tpt.', family: 'Brass', staves: 1, clefs: ['treble'], transpose: -2, range: [52, 84], timbre: T.brass },
  { id: 'horn', name: 'Horn in F', abbr: 'Hn.', family: 'Brass', staves: 1, clefs: ['treble'], transpose: -7, range: [34, 77], timbre: T.brass },
  { id: 'trombone', name: 'Trombone', abbr: 'Tbn.', family: 'Brass', staves: 1, clefs: ['bass'], range: [40, 72], timbre: T.brass },
  { id: 'tuba', name: 'Tuba', abbr: 'Tba.', family: 'Brass', staves: 1, clefs: ['bass'], range: [28, 58], timbre: T.brass },
  { id: 'euphonium', name: 'Euphonium', abbr: 'Euph.', family: 'Brass', staves: 1, clefs: ['bass'], range: [34, 70], timbre: T.brass },

  // Strings
  { id: 'violin', name: 'Violin', abbr: 'Vln.', family: 'Strings', staves: 1, clefs: ['treble'], range: [55, 100], timbre: T.strings },
  { id: 'viola', name: 'Viola', abbr: 'Vla.', family: 'Strings', staves: 1, clefs: ['alto'], range: [48, 88], timbre: T.strings },
  { id: 'cello', name: 'Cello', abbr: 'Vc.', family: 'Strings', staves: 1, clefs: ['bass'], range: [36, 76], timbre: T.strings },
  { id: 'contrabass', name: 'Contrabass', abbr: 'Cb.', family: 'Strings', staves: 1, clefs: ['bass'], transpose: -12, range: [28, 60], timbre: T.strings },
  { id: 'strings-ens', name: 'String Ensemble', abbr: 'Str.', family: 'Strings', staves: 2, clefs: ['treble', 'bass'], range: [28, 96], timbre: T.strings, brace: 'bracket' },

  // Guitars
  { id: 'guitar', name: 'Acoustic Guitar', abbr: 'Gtr.', family: 'Guitars', staves: 1, clefs: ['treble'], transpose: -12, range: [40, 88], timbre: T.guitar },
  { id: 'elec-guitar', name: 'Electric Guitar', abbr: 'E.Gtr.', family: 'Guitars', staves: 1, clefs: ['treble'], transpose: -12, range: [40, 88], timbre: T.synthLead },
  { id: 'elec-bass', name: 'Electric Bass', abbr: 'E.Bs.', family: 'Guitars', staves: 1, clefs: ['bass'], transpose: -12, range: [28, 67], timbre: T.bass },
  { id: 'ukulele', name: 'Ukulele', abbr: 'Uke.', family: 'Guitars', staves: 1, clefs: ['treble'], range: [60, 88], timbre: T.guitar },

  // Percussion
  { id: 'marimba', name: 'Marimba', abbr: 'Mrmb.', family: 'Percussion', staves: 1, clefs: ['treble'], range: [45, 96], timbre: T.mallet },
  { id: 'vibraphone', name: 'Vibraphone', abbr: 'Vib.', family: 'Percussion', staves: 1, clefs: ['treble'], range: [53, 89], timbre: T.mallet },
  { id: 'xylophone', name: 'Xylophone', abbr: 'Xyl.', family: 'Percussion', staves: 1, clefs: ['treble'], transpose: 12, range: [65, 108], timbre: T.mallet },
  { id: 'glockenspiel', name: 'Glockenspiel', abbr: 'Glck.', family: 'Percussion', staves: 1, clefs: ['treble'], transpose: 24, range: [79, 108], timbre: T.mallet },
  { id: 'timpani', name: 'Timpani', abbr: 'Timp.', family: 'Percussion', staves: 1, clefs: ['bass'], range: [36, 60], timbre: T.drums },
  { id: 'drumset', name: 'Drum Set', abbr: 'D.S.', family: 'Percussion', staves: 1, clefs: ['percussion'], range: [35, 81], timbre: T.drums, unpitched: true },

  // Synth
  { id: 'synth-lead', name: 'Synth Lead', abbr: 'Ld.', family: 'Synth', staves: 1, clefs: ['treble'], range: [36, 96], timbre: T.synthLead },
  { id: 'synth-pad', name: 'Synth Pad', abbr: 'Pad', family: 'Synth', staves: 2, clefs: ['treble', 'bass'], range: [28, 96], timbre: T.synthPad, brace: 'bracket' },
  { id: 'synth-bass', name: 'Synth Bass', abbr: 'S.Bs.', family: 'Synth', staves: 1, clefs: ['bass'], range: [24, 60], timbre: T.bass },
];

/**
 * Voices for the tango string effects, which are noise-led rather than pitched:
 * chicharra is bowed behind the bridge, tambor is the damped drum imitation.
 */
export const TECHNIQUE_TIMBRES = {
  chicharra: {
    osc: [{ wave: 'sawtooth', gain: 0.12 }],
    env: env(0.004, 0.18, 0.08, 0.06),
    filter: { freq: 3600, q: 7, envAmt: 2200, envDecay: 0.12, track: 0.1 },
    noise: 1.2,
    decayed: true,
  },
  tambor: {
    osc: [{ wave: 'triangle', ratio: 0.5, gain: 0.8 }],
    env: env(0.002, 0.14, 0, 0.05),
    filter: { freq: 520, q: 2.2, envAmt: 900, envDecay: 0.06, track: 0.2 },
    noise: 0.55,
    noiseDecay: 0.035,
    decayed: true,
  },
};

export const INSTRUMENT_FAMILIES = [...new Set(INSTRUMENTS.map((i) => i.family))];

const BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

export function getInstrument(id) {
  return BY_ID[id] ?? BY_ID.piano;
}

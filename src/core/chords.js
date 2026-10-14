// Chord symbols (cifrado): parsing, engraving blocks and MusicXML mapping.

const ROOT_RE = /^([A-G])(bb|##|b|#)?/;

const norm = (s) => (s || '')
  .replace(/♭/g, 'b').replace(/♯/g, '#')
  .replace(/Δ/g, 'maj7').replace(/ø/g, 'm7b5')
  .replace(/°/g, 'dim').replace(/–|—/g, '-')
  .trim();

/** Split "Dm7/F" into its chord body and bass note. */
function splitBass(text) {
  const at = text.lastIndexOf('/');
  if (at <= 0) return [text, null];
  const tail = text.slice(at + 1).trim();
  return ROOT_RE.test(tail) && tail.length <= 3 ? [text.slice(0, at), tail] : [text, null];
}

export function parseChord(text) {
  const raw = norm(text);
  if (!raw) return null;
  const [body, bass] = splitBass(raw);
  const m = ROOT_RE.exec(body);
  if (!m) return { raw, root: null, alter: 0, quality: body, bass: null };
  const alter = { bb: -2, b: -1, '#': 1, '##': 2 }[m[2]] ?? 0;
  return {
    raw,
    root: m[1],
    alter,
    quality: body.slice(m[0].length),
    bass: bass || null,
  };
}

const accidentalAlter = (s) => ({ bb: -2, b: -1, '#': 1, '##': 2 }[s] ?? 0);

/**
 * Break a symbol into drawable blocks.
 * Each block is { text } or { glyph }, optionally superscript — which is what puts
 * the ø, °, Δ and altered extensions where an engraver expects them.
 */
export function chordBlocks(text) {
  const chord = parseChord(text);
  if (!chord) return [];
  const blocks = [];

  if (chord.root) blocks.push({ text: chord.root + accidentalText(chord.alter) });
  else blocks.push({ text: chord.raw });

  let q = chord.quality;
  const eat = (prefix) => {
    if (q.toLowerCase().startsWith(prefix)) { q = q.slice(prefix.length); return true; }
    return false;
  };

  if (chord.root) {
    if (eat('maj7') || eat('M7')) blocks.push({ glyph: 'majorSeventh', sup: true });
    else if (eat('m7b5') || eat('halfdim')) blocks.push({ glyph: 'halfDiminished', sup: true });
    else if (eat('dim')) blocks.push({ glyph: 'diminished', sup: true });
    else if (eat('aug') || eat('+')) blocks.push({ glyph: '+', sup: true });
    else if (eat('maj') || eat('M')) blocks.push({ text: 'maj', sup: true });
    else if (eat('min')) blocks.push({ text: 'm' });
    else if (eat('m') || eat('-')) blocks.push({ text: 'm' });

    if (q) blocks.push({ text: q, sup: true });
  }

  if (chord.bass) blocks.push({ text: `/${chord.bass}` });
  return blocks;
}

function accidentalText(alter) {
  return { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' }[String(alter)] ?? '';
}

// ------------------------------------------------------------------ MusicXML

const KIND_BY_QUALITY = {
  '': 'major',
  m: 'minor', min: 'minor', '-': 'minor',
  6: 'major-sixth', m6: 'minor-sixth', min6: 'minor-sixth',
  7: 'dominant', 9: 'dominant-ninth', 11: 'dominant-11th', 13: 'dominant-13th',
  maj7: 'major-seventh', M7: 'major-seventh', maj9: 'major-ninth',
  m7: 'minor-seventh', min7: 'minor-seventh', '-7': 'minor-seventh',
  m9: 'minor-ninth', m11: 'minor-11th',
  dim: 'diminished', dim7: 'diminished-seventh',
  m7b5: 'half-diminished', halfdim: 'half-diminished',
  aug: 'augmented', '+': 'augmented',
  sus: 'suspended-fourth', sus4: 'suspended-fourth', sus2: 'suspended-second',
  '7sus4': 'dominant', '5': 'power',
};

export function chordKind(chord) {
  return KIND_BY_QUALITY[chord.quality] ?? KIND_BY_QUALITY[chord.quality.toLowerCase()] ?? 'other';
}

/** Rebuild a display string from MusicXML harmony parts. */
export function chordFromParts({ rootStep, rootAlter = 0, kind, kindText, bassStep, bassAlter = 0 }) {
  if (!rootStep) return null;
  const quality = kindText || QUALITY_BY_KIND[kind] || '';
  const bass = bassStep ? `/${bassStep}${accidentalText(bassAlter)}` : '';
  return `${rootStep}${accidentalText(rootAlter)}${quality}${bass}`;
}

const QUALITY_BY_KIND = Object.entries(KIND_BY_QUALITY).reduce((acc, [quality, kind]) => {
  if (!(kind in acc)) acc[kind] = quality;
  return acc;
}, {});

export { accidentalText };

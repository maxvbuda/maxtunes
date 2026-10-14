// Layout + VexFlow drawing. Returns geometry used for hit-testing and playback overlays.

import {
  Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam, Dot, Articulation,
  Ornament, StaveTie, Curve, StaveConnector, Tuplet, Annotation, Modifier, Stem, Barline,
  ChordSymbol,
} from 'vexflow/bravura';
import {
  vfDuration, vfKey, keySpec, durationTicks, ARTICULATIONS, ORNAMENTS, pitchToMidi,
  TECHNIQUE_BY_ID,
} from '../core/theory.js';
import { timeSigAt, keySigAt, clefAt, voiceTimeline } from '../core/score.js';
import { getInstrument } from '../core/instruments.js';
import { chordBlocks } from '../core/chords.js';

const STAFF_HEIGHT = 40;
const STAFF_GAP = 92;     // between staves inside one part
const PART_GAP = 112;     // between parts
const SYSTEM_GAP = 100;   // between systems, leaving room for chord symbols and bar text
const MARGIN_X = 24;
const MARGIN_TOP = 54;    // headroom for tempo, rehearsal marks and bar text
const MARGIN_BOTTOM = 40;
const MIN_MEASURE_WIDTH = 110;

const ART_VF = Object.fromEntries(ARTICULATIONS.map((a) => [a.id, a.vf]));
const ORN_VF = Object.fromEntries(ORNAMENTS.map((o) => [o.id, o.vf]));

let measureCanvas = null;

/** Real text width, so long part names never collide with the staves. */
function textWidth(text, font) {
  if (!measureCanvas) measureCanvas = document.createElement('canvas').getContext('2d');
  if (!measureCanvas) return text.length * 7;
  measureCanvas.font = font;
  return measureCanvas.measureText(text).width;
}

function restKey(clef, whole) {
  if (clef === 'bass') return whole ? 'f/3' : 'd/3';
  if (clef === 'alto') return whole ? 'd/4' : 'c/4';
  if (clef === 'tenor') return whole ? 'b/3' : 'a/3';
  return whole ? 'd/5' : 'b/4';
}

function makeVexNote(ev, clef, voiceIndex, voiceCount, labelTechnique = false) {
  const isRest = ev.kind === 'rest';
  const duration = vfDuration(ev.dur.base, isRest);
  const technique = ev.technique ? TECHNIQUE_BY_ID[ev.technique] : null;
  const keys = isRest
    ? [restKey(clef, ev.dur.base === 1)]
    : ev.pitches.map((p) => (technique?.notehead ? `${vfKey(p)}/${technique.notehead}` : vfKey(p)));

  const struct = { keys, duration, clef, autoStem: voiceCount === 1 };
  if (voiceCount > 1) struct.stemDirection = voiceIndex % 2 === 0 ? Stem.UP : Stem.DOWN;
  else if (ev.stem === 'up') { struct.stemDirection = Stem.UP; struct.autoStem = false; }
  else if (ev.stem === 'down') { struct.stemDirection = Stem.DOWN; struct.autoStem = false; }

  const note = new StaveNote(struct);
  for (let i = 0; i < (ev.dur.dots || 0); i++) Dot.buildAndAttach([note], { all: true });

  if (!isRest) {
    for (const art of ev.articulations || []) {
      const vf = ART_VF[art];
      if (!vf) continue;
      const a = new Articulation(vf);
      a.setPosition(art === 'fermata' ? Modifier.Position.ABOVE : Modifier.Position.BELOW);
      note.addModifier(a);
    }
    if (ev.ornament && ORN_VF[ev.ornament]) {
      note.addModifier(new Ornament(ORN_VF[ev.ornament]));
    }
  }
  if (technique?.text && labelTechnique) {
    const a = new Annotation(technique.text);
    a.setVerticalJustification(Annotation.VerticalJustify.TOP);
    a.setFont('Georgia', 11, 'normal', 'italic');
    note.addModifier(a);
  }
  if (ev.chord) {
    const symbol = new ChordSymbol();
    symbol.setHorizontal(ChordSymbol.HorizontalJustify.LEFT);
    symbol.setVertical(ChordSymbol.VerticalJustify.TOP);
    for (const block of chordBlocks(ev.chord)) {
      const params = block.sup ? { symbolModifier: ChordSymbol.symbolModifiers.SUPERSCRIPT } : {};
      if (block.glyph) symbol.addGlyph(block.glyph, params);
      else symbol.addGlyphOrText(block.text, params);
    }
    note.addModifier(symbol);
  }
  if (ev.dynamic) {
    const a = new Annotation(ev.dynamic);
    a.setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
    a.setFont('Times New Roman', 15, 'bold', 'italic');
    note.addModifier(a);
  }
  if (ev.lyric) {
    const a = new Annotation(ev.lyric);
    a.setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
    a.setFont('Georgia', 12, 'normal');
    note.addModifier(a);
  }
  if (ev.text) {
    const a = new Annotation(ev.text);
    a.setVerticalJustification(Annotation.VerticalJustify.TOP);
    a.setFont('Georgia', 12, 'normal', 'italic');
    note.addModifier(a);
  }
  return note;
}

/** Build all VexFlow voices for one measure of one staff. */
function buildMeasure(score, part, staff, measureIndex) {
  const bar = staff.bars[measureIndex];
  const clef = clefAt(staff, measureIndex);
  const ts = timeSigAt(score, measureIndex);
  const fifths = keySigAt(score, measureIndex);
  const voices = [];
  const beams = [];
  const tuplets = [];
  const records = [];

  bar.voices.forEach((evs, voiceIndex) => {
    const timeline = voiceTimeline(evs);
    const notes = timeline.map(({ ev }, i) => {
      // Label only where a technique starts, so runs of chicharra don't repeat the word.
      const prev = timeline[i - 1]?.ev;
      const starts = !!ev.technique && prev?.technique !== ev.technique;
      return makeVexNote(ev, clef, voiceIndex, bar.voices.length, starts);
    });
    timeline.forEach(({ ev, start }, i) => {
      records.push({ ev, note: notes[i], voiceIndex, tick: start, clef });
    });

    const voice = new Voice({ numBeats: ts.n, beatValue: ts.d })
      .setMode(Voice.Mode.SOFT)
      .addTickables(notes);
    voices.push(voice);

    // Tuplet brackets, grouped by tuplet id.
    const groups = new Map();
    timeline.forEach(({ ev }, i) => {
      if (!ev.tuplet) return;
      if (!groups.has(ev.tuplet.id)) groups.set(ev.tuplet.id, { spec: ev.tuplet, notes: [] });
      groups.get(ev.tuplet.id).notes.push(notes[i]);
    });
    for (const { spec, notes: tn } of groups.values()) {
      if (tn.length > 1) tuplets.push(new Tuplet(tn, { numNotes: spec.num, notesOccupied: spec.den }));
    }

    beams.push(...Beam.generateBeams(notes.filter((n) => !n.isRest()), {
      groups: Beam.getDefaultBeamGroups(`${ts.n}/${ts.d}`),
    }));
  });

  try {
    Accidental.applyAccidentals(voices, keySpec(fifths));
  } catch { /* malformed key spec — accidentals stay as written */ }

  return { voices, beams, tuplets, records, clef };
}

function minWidthFor(voices) {
  try {
    const f = new Formatter();
    voices.forEach((v) => f.joinVoices([v]));
    return f.preCalculateMinTotalWidth(voices);
  } catch {
    return MIN_MEASURE_WIDTH;
  }
}

function modifierWidth({ isSystemStart, showClef, showKey, showTime, fifths, timeSig }) {
  let w = 12;
  if (isSystemStart || showClef) w += 32;
  if (isSystemStart || showKey) w += Math.abs(fifths) * 9 + (fifths ? 8 : 0);
  if (showTime) w += 28;
  return w;
}

const barlineTypeFor = (name) => ({
  double: Barline.type.DOUBLE, final: Barline.type.END, none: Barline.type.NONE,
}[name] ?? Barline.type.SINGLE);

/**
 * Draw the score into `container`.
 * Returns { width, height, notes, staveBoxes, systems } in *scaled* pixel coordinates.
 */
export function engrave(container, score, options = {}) {
  const {
    width = 1000, zoom = 1, showNames = true, colors = {},
  } = options;

  container.innerHTML = '';
  const pageWidth = width / zoom;

  const visible = [];
  score.parts.forEach((part, partIndex) => {
    if (part.visible === false) return;
    part.staves.forEach((staff, staffIndex) => visible.push({ part, partIndex, staff, staffIndex }));
  });
  if (!visible.length) return { width, height: 100, notes: [], staveBoxes: [], systems: [] };

  const nameWidth = showNames
    ? Math.min(190, Math.max(
      ...score.parts.filter((p) => p.visible !== false).map((p) => textWidth(p.name, '13px Georgia')),
    ) + 12)
    : 0;
  // Braces and brackets are drawn outside the stave's left edge, so reserve room for them.
  const braceSpace = score.parts.some((p) => p.visible !== false && p.staves.length > 1) ? 24 : 8;
  const leftPad = nameWidth + braceSpace;

  // ---- pass 1: build every measure once
  const built = []; // built[m][staveIdx]
  const measureCount = score.measures.length;
  for (let m = 0; m < measureCount; m++) {
    built.push(visible.map(({ part, staff }) => buildMeasure(score, part, staff, m)));
  }

  const baseWidths = built.map((row) => Math.max(MIN_MEASURE_WIDTH, ...row.map((b) => minWidthFor(b.voices) + 24)));

  // ---- pass 2: pack measures into systems
  const systems = [];
  let current = { measures: [], width: 0 };
  const contentWidth = () => pageWidth - MARGIN_X * 2 - leftPad;

  for (let m = 0; m < measureCount; m++) {
    const isSystemStart = current.measures.length === 0;
    const prevTs = m > 0 ? timeSigAt(score, m - 1) : null;
    const ts = timeSigAt(score, m);
    const fifths = keySigAt(score, m);
    const showTime = m === 0 || (prevTs && (prevTs.n !== ts.n || prevTs.d !== ts.d));
    const mod = modifierWidth({ isSystemStart, showClef: false, showKey: false, showTime, fifths, timeSig: ts });
    const need = baseWidths[m] + mod;
    const avail = contentWidth();

    if (!isSystemStart && (current.width + need > avail || score.measures[m].systemBreak)) {
      systems.push(current);
      current = { measures: [], width: 0 };
    }
    current.measures.push(m);
    current.width += need;
  }
  if (current.measures.length) systems.push(current);

  // ---- pass 3: geometry
  const staffOffsets = [];
  let cursorY = 0;
  visible.forEach((v, i) => {
    if (i > 0) {
      const prev = visible[i - 1];
      cursorY += prev.partIndex === v.partIndex ? STAFF_GAP : PART_GAP;
    }
    staffOffsets.push(cursorY);
  });
  const systemHeight = cursorY + STAFF_HEIGHT;

  let y = MARGIN_TOP;
  const systemTops = systems.map(() => 0);
  systems.forEach((_, i) => { systemTops[i] = y; y += systemHeight + SYSTEM_GAP; });
  const totalHeight = y - SYSTEM_GAP + MARGIN_BOTTOM;

  // ---- pass 4: draw
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(Math.ceil(pageWidth * zoom), Math.ceil(totalHeight * zoom));
  const ctx = renderer.getContext();
  ctx.scale(zoom, zoom);
  if (colors.ink) {
    ctx.setFillStyle(colors.ink);
    ctx.setStrokeStyle(colors.ink);
  }

  const noteBoxes = [];
  const staveBoxes = [];
  const tieCandidates = []; // { record, stave, systemIndex }

  systems.forEach((system, systemIndex) => {
    const top = systemTops[systemIndex];
    const avail = contentWidth();
    const rawTotal = system.measures.reduce((s, m) => s + baseWidths[m], 0);

    // Distribute leftover space proportionally to each measure's natural width.
    const mods = system.measures.map((m, i) => {
      const prevTs = m > 0 ? timeSigAt(score, m - 1) : null;
      const ts = timeSigAt(score, m);
      const prevKey = m > 0 ? keySigAt(score, m - 1) : 0;
      const fifths = keySigAt(score, m);
      return modifierWidth({
        isSystemStart: i === 0,
        showClef: false,
        showKey: i !== 0 && prevKey !== fifths,
        showTime: m === 0 || (prevTs && (prevTs.n !== ts.n || prevTs.d !== ts.d)),
        fifths, timeSig: ts,
      });
    });
    const modTotal = mods.reduce((a, b) => a + b, 0);
    const scale = rawTotal > 0 ? Math.max(0.6, (avail - modTotal) / rawTotal) : 1;

    let x = MARGIN_X + leftPad;
    const systemStaves = [];

    system.measures.forEach((m, mi) => {
      const isSystemStart = mi === 0;
      const measureWidth = Math.max(MIN_MEASURE_WIDTH, baseWidths[m] * scale + mods[mi]);
      const attrs = score.measures[m];
      const ts = timeSigAt(score, m);
      const prevTs = m > 0 ? timeSigAt(score, m - 1) : null;
      const fifths = keySigAt(score, m);
      const prevKey = m > 0 ? keySigAt(score, m - 1) : 0;
      const showTime = m === 0 || (prevTs && (prevTs.n !== ts.n || prevTs.d !== ts.d));

      const staves = visible.map((v, si) => {
        const stave = new Stave(x, top + staffOffsets[si], measureWidth, {
          spaceAboveStaffLn: 3,
        });
        const clef = clefAt(v.staff, m);
        const prevClef = m > 0 ? clefAt(v.staff, m - 1) : clef;
        if (isSystemStart) {
          stave.addClef(clef);
          if (fifths !== 0) stave.addKeySignature(keySpec(fifths));
        } else {
          if (clef !== prevClef) stave.addClef(clef, 'small');
          if (fifths !== prevKey) stave.addKeySignature(keySpec(fifths), keySpec(prevKey));
        }
        if (showTime) stave.addTimeSignature(`${ts.n}/${ts.d}`);
        if (attrs.startRepeat) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        if (attrs.endRepeat) stave.setEndBarType(Barline.type.REPEAT_END);
        else if (attrs.barline) stave.setEndBarType(barlineTypeFor(attrs.barline));
        if (mi === system.measures.length - 1 && !attrs.barline && !attrs.endRepeat) {
          stave.setEndBarType(Barline.type.SINGLE);
        }
        stave.setContext(ctx);
        return stave;
      });

      Stave.formatBegModifiers(staves);
      staves.forEach((s) => s.draw());
      systemStaves.push(staves);

      // Format all voices of this measure across every staff together.
      const allVoices = [];
      built[m].forEach((b, si) => {
        b.voices.forEach((v) => { v.setStave(staves[si]); allVoices.push(v); });
      });
      if (allVoices.length) {
        const formatter = new Formatter();
        built[m].forEach((b) => { if (b.voices.length) formatter.joinVoices(b.voices); });
        const noteStart = Math.max(...staves.map((s) => s.getNoteStartX() - s.getX()));
        const justify = Math.max(40, measureWidth - noteStart - 14);
        try {
          formatter.format(allVoices, justify);
        } catch {
          try { formatter.format(allVoices); } catch { /* leave unformatted */ }
        }
      }

      built[m].forEach((b, si) => {
        const stave = staves[si];
        b.voices.forEach((v) => v.draw(ctx, stave));
        b.beams.forEach((beam) => beam.setContext(ctx).draw());
        b.tuplets.forEach((t) => t.setContext(ctx).draw());

        const v = visible[si];
        staveBoxes.push({
          partIndex: v.partIndex, staffIndex: v.staffIndex, measureIndex: m,
          systemIndex, clef: b.clef, stave,
          x: stave.getX() * zoom, y: stave.getYForLine(0) * zoom,
          w: measureWidth * zoom, h: STAFF_HEIGHT * zoom,
          noteStartX: stave.getNoteStartX() * zoom,
          top: (stave.getYForLine(0) - 30) * zoom,
          bottom: (stave.getYForLine(4) + 30) * zoom,
        });

        b.records.forEach((rec) => {
          const note = rec.note;
          let ny; let nh;
          try {
            const bounds = note.getNoteHeadBounds();
            ny = bounds.yTop - 7; nh = bounds.yBottom - bounds.yTop + 14;
          } catch {
            ny = stave.getYForLine(0) - 4; nh = STAFF_HEIGHT + 8;
          }
          if (rec.ev.kind === 'rest' || !Number.isFinite(ny)) {
            ny = stave.getYForLine(0) - 2; nh = STAFF_HEIGHT + 4;
          }
          const nx = note.getAbsoluteX();
          noteBoxes.push({
            id: rec.ev.id,
            kind: rec.ev.kind,
            partIndex: v.partIndex, staffIndex: v.staffIndex,
            measureIndex: m, voiceIndex: rec.voiceIndex,
            tick: rec.tick, ticks: durationTicks(rec.ev.dur),
            midi: rec.ev.kind === 'note' ? rec.ev.pitches.map(pitchToMidi) : [],
            x: (nx - 9) * zoom, y: ny * zoom, w: 20 * zoom, h: nh * zoom,
            cx: nx * zoom, systemIndex,
          });
          if (rec.ev.technique === 'arrastre' || rec.ev.technique === 'latigo') {
            drawTechniqueMark(ctx, rec.ev.technique, note, stave, colors.ink);
          }
          if (rec.ev.tie) tieCandidates.push({ ev: rec.ev, note, systemIndex, partIndex: v.partIndex, staffIndex: v.staffIndex, measureIndex: m, voiceIndex: rec.voiceIndex, tick: rec.tick });
        });
      });

      x += measureWidth;
    });

    // Connectors: a spine down the left edge, plus a bracket once several parts share it.
    const partCount = new Set(visible.map((v) => v.partIndex)).size;
    if (visible.length > 1) {
      const first = systemStaves[0];
      const spine = new StaveConnector(first[0], first[first.length - 1]);
      spine.setType('singleLeft');
      spine.setContext(ctx).draw();

      if (partCount > 1) {
        const bracket = new StaveConnector(first[0], first[first.length - 1]);
        bracket.setType('bracket');
        bracket.setContext(ctx).draw();
      }
    }
    // Braces for multi-staff parts.
    const firstStaves = systemStaves[0];
    let i = 0;
    while (i < visible.length) {
      const pIndex = visible[i].partIndex;
      let j = i;
      while (j + 1 < visible.length && visible[j + 1].partIndex === pIndex) j++;
      if (j > i) {
        const inst = getInstrument(visible[i].part.instrumentId);
        const brace = new StaveConnector(firstStaves[i], firstStaves[j]);
        brace.setType(inst.brace === 'bracket' ? 'bracket' : 'brace');
        brace.setContext(ctx).draw();
        const line = new StaveConnector(firstStaves[i], firstStaves[j]);
        line.setType('singleLeft');
        line.setContext(ctx).draw();
      }
      i = j + 1;
    }

    // Part names at the left edge.
    if (showNames && nameWidth > 0) {
      ctx.save();
      ctx.setFont('Georgia', systemIndex === 0 ? 13 : 11, 'normal');
      if (colors.ink) ctx.setFillStyle(colors.ink);
      let k = 0;
      while (k < visible.length) {
        const pIndex = visible[k].partIndex;
        let j = k;
        while (j + 1 < visible.length && visible[j + 1].partIndex === pIndex) j++;
        const label = systemIndex === 0 ? visible[k].part.name : visible[k].part.abbr;
        const midY = top + (staffOffsets[k] + staffOffsets[j] + STAFF_HEIGHT) / 2 + 4;
        ctx.fillText(label, MARGIN_X, midY);
        k = j + 1;
      }
      ctx.restore();
    }

    // Rehearsal marks and tempo text.
    system.measures.forEach((m, mi) => {
      const attrs = score.measures[m];
      const stave = systemStaves[mi][0];
      if (attrs.rehearsal) {
        ctx.save();
        ctx.setFont('Georgia', 14, 'bold');
        if (colors.ink) ctx.setFillStyle(colors.ink);
        ctx.fillText(attrs.rehearsal, stave.getX() + 4, top - 4);
        ctx.restore();
      }
      if (attrs.tempo || (m === 0 && score.tempo)) {
        const bpm = attrs.tempo || score.tempo;
        if (attrs.tempo || m === 0) {
          ctx.save();
          ctx.setFont('Georgia', 12, 'bold');
          if (colors.ink) ctx.setFillStyle(colors.ink);
          ctx.fillText(`♩ = ${bpm}`, stave.getX() + (attrs.rehearsal ? 34 : 2), top - 6);
          ctx.restore();
        }
      }
      if (attrs.text) {
        ctx.save();
        ctx.setFont('Georgia', 12, 'normal', 'italic');
        if (colors.ink) ctx.setFillStyle(colors.ink);
        ctx.fillText(attrs.text, stave.getX() + 4, top - 20);
        ctx.restore();
      }
    });
  });

  // ---- ties & slurs (drawn last so both endpoints exist)
  const systemOfMeasure = new Map();
  systems.forEach((sys, i) => sys.measures.forEach((m) => systemOfMeasure.set(m, i)));
  drawTies(ctx, score, visible, built, tieCandidates, systemOfMeasure);
  drawSlurs(ctx, built);

  const svg = container.querySelector('svg');
  if (svg) {
    svg.style.display = 'block';
    svg.setAttribute('class', 'score-svg');
  }

  return {
    width: pageWidth * zoom,
    height: totalHeight * zoom,
    notes: noteBoxes,
    staveBoxes,
    systems: systems.map((s, i) => ({ ...s, top: systemTops[i] * zoom, height: systemHeight * zoom })),
    zoom,
  };
}

/** Arrastre: a thick drag sweeping up into the notehead. Latigo: the whip flick above it. */
function drawTechniqueMark(ctx, technique, note, stave, ink) {
  let top;
  let bottom;
  try {
    const bounds = note.getNoteHeadBounds();
    top = bounds.yTop;
    bottom = bounds.yBottom;
  } catch {
    top = stave.getYForLine(1);
    bottom = stave.getYForLine(3);
  }
  const x = note.getAbsoluteX();
  ctx.save();
  if (ink) { ctx.setFillStyle(ink); ctx.setStrokeStyle(ink); }

  if (technique === 'arrastre') {
    // A wedge that thickens as it arrives on the beat.
    ctx.beginPath();
    ctx.moveTo(x - 26, bottom + 7);
    ctx.lineTo(x - 4, (top + bottom) / 2 + 1);
    ctx.lineTo(x - 4, (top + bottom) / 2 - 3);
    ctx.lineTo(x - 24, bottom + 3);
    ctx.closePath();
    ctx.fill();
  } else {
    // Latigo: a steep stroke flicking upward off the note.
    ctx.setLineWidth(1.6);
    ctx.beginPath();
    ctx.moveTo(x + 2, top - 4);
    ctx.lineTo(x + 13, top - 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 13, top - 24);
    ctx.lineTo(x + 7, top - 17);
    ctx.lineTo(x + 14, top - 18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTies(ctx, score, visible, built, candidates, systemOfMeasure) {
  // Map each rendered event id to its VexFlow note, in score order.
  const order = [];
  visible.forEach((v, si) => {
    for (let m = 0; m < score.measures.length; m++) {
      const b = built[m][si];
      if (!b) continue;
      b.records.forEach((r) => order.push({ ...r, si, m }));
    }
  });
  const index = new Map();
  order.forEach((r, i) => index.set(r.ev.id, i));

  for (const c of candidates) {
    const i = index.get(c.ev.id);
    if (i === undefined) continue;
    const next = order.slice(i + 1).find((r) => r.si === order[i].si && r.voiceIndex === order[i].voiceIndex);
    const sameSystem = next && systemOfMeasure.get(order[i].m) === systemOfMeasure.get(next.m);

    // A tie across a system break is drawn as two half ties rather than one long slash.
    const notes = { firstNote: c.note };
    if (next && next.ev.kind === 'note' && sameSystem) notes.lastNote = next.note;
    try {
      new StaveTie(notes).setContext(ctx).draw();
      if (next && next.ev.kind === 'note' && !sameSystem) {
        new StaveTie({ lastNote: next.note }).setContext(ctx).draw();
      }
    } catch { /* endpoint could not be positioned */ }
  }
}

function drawSlurs(ctx, built) {
  for (const row of built) {
    for (const b of row) {
      let start = null;
      for (const rec of b.records) {
        if (rec.ev.slur === 'start') start = rec;
        else if (rec.ev.slur === 'stop' && start) {
          try {
            new Curve(start.note, rec.note, { cps: [{ x: 0, y: 12 }, { x: 0, y: 12 }] })
              .setContext(ctx).draw();
          } catch { /* skip unrenderable slur */ }
          start = null;
        }
      }
    }
  }
}

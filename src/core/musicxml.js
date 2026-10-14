// MusicXML 4.0 (partwise) import and export.

import { durationTicks, WHOLE_TICKS, timeSigTicks } from './theory.js';
import {
  createScore, makeNote, makeRest, makePart, makeMeasureAttrs, makeBar, makeStaff,
  normalizeVoice, timeSigAt, keySigAt, clefAt, measureTicks, tempoAt, uid,
} from './score.js';
import { INSTRUMENTS } from './instruments.js';
import { parseChord, chordKind, chordFromParts } from './chords.js';

const DIVISIONS = 480; // per quarter note
const TYPE_NAMES = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' };
const NAME_TYPES = Object.fromEntries(Object.entries(TYPE_NAMES).map(([k, v]) => [v, Number(k)]));

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const CLEF_XML = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
  tenor: { sign: 'C', line: 4 },
  percussion: { sign: 'percussion', line: 2 },
};

const toDivisions = (ticks) => Math.round((ticks * DIVISIONS) / (WHOLE_TICKS / 4));

export function exportMusicXML(score) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="4.0">');
  lines.push('  <work><work-title>' + esc(score.title) + '</work-title></work>');
  lines.push('  <identification>');
  if (score.composer) lines.push(`    <creator type="composer">${esc(score.composer)}</creator>`);
  if (score.lyricist) lines.push(`    <creator type="lyricist">${esc(score.lyricist)}</creator>`);
  if (score.copyright) lines.push(`    <rights>${esc(score.copyright)}</rights>`);
  lines.push('    <encoding><software>MaxTunes</software></encoding>');
  lines.push('  </identification>');

  lines.push('  <part-list>');
  score.parts.forEach((part, i) => {
    lines.push(`    <score-part id="P${i + 1}">`);
    lines.push(`      <part-name>${esc(part.name)}</part-name>`);
    lines.push(`      <part-abbreviation>${esc(part.abbr)}</part-abbreviation>`);
    lines.push(`      <score-instrument id="P${i + 1}-I1"><instrument-name>${esc(part.name)}</instrument-name></score-instrument>`);
    lines.push('    </score-part>');
  });
  lines.push('  </part-list>');

  score.parts.forEach((part, pi) => {
    lines.push(`  <part id="P${pi + 1}">`);
    for (let m = 0; m < score.measures.length; m++) {
      const attrs = score.measures[m];
      lines.push(`    <measure number="${m + 1}">`);

      const ts = timeSigAt(score, m);
      const prevTs = m > 0 ? timeSigAt(score, m - 1) : null;
      const fifths = keySigAt(score, m);
      const prevKey = m > 0 ? keySigAt(score, m - 1) : null;
      const needAttrs = m === 0 || fifths !== prevKey || !prevTs || prevTs.n !== ts.n || prevTs.d !== ts.d
        || part.staves.some((s, si) => clefAt(s, m) !== (m > 0 ? clefAt(s, m - 1) : null));

      if (needAttrs) {
        lines.push('      <attributes>');
        if (m === 0) lines.push(`        <divisions>${DIVISIONS}</divisions>`);
        if (m === 0 || fifths !== prevKey) lines.push(`        <key><fifths>${fifths}</fifths><mode>${score.mode || 'major'}</mode></key>`);
        if (m === 0 || !prevTs || prevTs.n !== ts.n || prevTs.d !== ts.d) {
          lines.push(`        <time><beats>${ts.n}</beats><beat-type>${ts.d}</beat-type></time>`);
        }
        if (part.staves.length > 1) lines.push(`        <staves>${part.staves.length}</staves>`);
        part.staves.forEach((staff, si) => {
          const clef = clefAt(staff, m);
          const prev = m > 0 ? clefAt(staff, m - 1) : null;
          if (m === 0 || clef !== prev) {
            const c = CLEF_XML[clef] || CLEF_XML.treble;
            const num = part.staves.length > 1 ? ` number="${si + 1}"` : '';
            lines.push(`        <clef${num}><sign>${c.sign}</sign><line>${c.line}</line></clef>`);
          }
        });
        if (part.transpose) {
          lines.push('        <transpose>');
          lines.push(`          <chromatic>${part.transpose % 12}</chromatic>`);
          lines.push(`          <octave-change>${Math.trunc(part.transpose / 12)}</octave-change>`);
          lines.push('        </transpose>');
        }
        lines.push('      </attributes>');
      }

      if (pi === 0 && (m === 0 || attrs.tempo)) {
        const bpm = tempoAt(score, m);
        lines.push('      <direction placement="above"><direction-type><metronome>');
        lines.push('        <beat-unit>quarter</beat-unit>');
        lines.push(`        <per-minute>${bpm}</per-minute>`);
        lines.push(`      </metronome></direction-type><sound tempo="${bpm}"/></direction>`);
      }
      if (attrs.rehearsal) {
        lines.push(`      <direction placement="above"><direction-type><rehearsal>${esc(attrs.rehearsal)}</rehearsal></direction-type></direction>`);
      }
      if (attrs.startRepeat) {
        lines.push('      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
      }

      part.staves.forEach((staff, si) => {
        const bar = staff.bars[m];
        bar.voices.forEach((voice, vi) => {
          if (si > 0 || vi > 0) {
            lines.push(`      <backup><duration>${toDivisions(measureTicks(score, m))}</duration></backup>`);
          }
          for (const ev of voice) {
            const dur = toDivisions(durationTicks(ev.dur));
            const type = TYPE_NAMES[ev.dur.base] || 'quarter';
            if (ev.chord) {
              const chord = parseChord(ev.chord);
              if (chord?.root) {
                const kind = chordKind(chord);
                lines.push('      <harmony>');
                lines.push('        <root>');
                lines.push(`          <root-step>${chord.root}</root-step>`);
                if (chord.alter) lines.push(`          <root-alter>${chord.alter}</root-alter>`);
                lines.push('        </root>');
                const kindText = kind === 'other' ? ` text="${esc(chord.quality)}"` : '';
                lines.push(`        <kind${kindText}>${kind}</kind>`);
                if (chord.bass) {
                  const bassAlter = { '#': 1, b: -1 }[chord.bass.slice(1)] ?? 0;
                  lines.push('        <bass>');
                  lines.push(`          <bass-step>${chord.bass[0]}</bass-step>`);
                  if (bassAlter) lines.push(`          <bass-alter>${bassAlter}</bass-alter>`);
                  lines.push('        </bass>');
                }
                lines.push('      </harmony>');
              }
            }
            if (ev.dynamic) {
              lines.push('      <direction placement="below">');
              lines.push(`        <direction-type><dynamics><${ev.dynamic}/></dynamics></direction-type>`);
              if (part.staves.length > 1) lines.push(`        <staff>${si + 1}</staff>`);
              lines.push('      </direction>');
            }
            if (ev.kind === 'rest') {
              lines.push('      <note>');
              lines.push('        <rest/>');
              lines.push(`        <duration>${dur}</duration>`);
              lines.push(`        <voice>${si * 4 + vi + 1}</voice>`);
              lines.push(`        <type>${type}</type>`);
              for (let d = 0; d < (ev.dur.dots || 0); d++) lines.push('        <dot/>');
              if (part.staves.length > 1) lines.push(`        <staff>${si + 1}</staff>`);
              lines.push('      </note>');
              continue;
            }
            ev.pitches.forEach((p, idx) => {
              lines.push('      <note>');
              if (idx > 0) lines.push('        <chord/>');
              lines.push('        <pitch>');
              lines.push(`          <step>${p.step}</step>`);
              if (p.alter) lines.push(`          <alter>${p.alter}</alter>`);
              lines.push(`          <octave>${p.octave}</octave>`);
              lines.push('        </pitch>');
              lines.push(`        <duration>${dur}</duration>`);
              if (ev.tie) lines.push('        <tie type="start"/>');
              lines.push(`        <voice>${si * 4 + vi + 1}</voice>`);
              lines.push(`        <type>${type}</type>`);
              for (let d = 0; d < (ev.dur.dots || 0); d++) lines.push('        <dot/>');
              if (p.alter) {
                const acc = { '-2': 'flat-flat', '-1': 'flat', 1: 'sharp', 2: 'sharp-sharp' }[String(p.alter)];
                if (acc) lines.push(`        <accidental>${acc}</accidental>`);
              }
              if (ev.tuplet) {
                lines.push('        <time-modification>');
                lines.push(`          <actual-notes>${ev.tuplet.num}</actual-notes>`);
                lines.push(`          <normal-notes>${ev.tuplet.den}</normal-notes>`);
                lines.push('        </time-modification>');
              }
              if (part.staves.length > 1) lines.push(`        <staff>${si + 1}</staff>`);
              const notations = [];
              if (ev.tie) notations.push('          <tied type="start"/>');
              if (ev.articulations?.length) {
                notations.push('          <articulations>');
                for (const a of ev.articulations) {
                  const tag = { staccato: 'staccato', staccatissimo: 'staccatissimo', accent: 'accent', marcato: 'strong-accent', tenuto: 'tenuto' }[a];
                  if (tag) notations.push(`            <${tag}/>`);
                }
                notations.push('          </articulations>');
                if (ev.articulations.includes('fermata')) notations.push('          <fermata/>');
              }
              if (ev.technique) {
                // Tango techniques have no standard MusicXML element; other-technical
                // keeps them valid and lossless on the way back in.
                notations.push('          <technical>');
                notations.push(`            <other-technical>${esc(ev.technique)}</other-technical>`);
                notations.push('          </technical>');
              }
              if (ev.slur === 'start') notations.push('          <slur type="start" number="1"/>');
              if (ev.slur === 'stop') notations.push('          <slur type="stop" number="1"/>');
              if (notations.length) {
                lines.push('        <notations>');
                lines.push(notations.join('\n'));
                lines.push('        </notations>');
              }
              if (ev.lyric && idx === 0) {
                lines.push(`        <lyric number="1"><syllabic>single</syllabic><text>${esc(ev.lyric)}</text></lyric>`);
              }
              lines.push('      </note>');
            });
          }
        });
      });

      if (attrs.endRepeat) {
        lines.push('      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
      } else if (attrs.barline === 'final') {
        lines.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      } else if (attrs.barline === 'double') {
        lines.push('      <barline location="right"><bar-style>light-light</bar-style></barline>');
      }
      lines.push('    </measure>');
    }
    lines.push('  </part>');
  });

  lines.push('</score-partwise>');
  return lines.join('\n');
}

// --------------------------------------------------------------------- import

const XML_CLEF = (sign, line) => {
  if (sign === 'F') return 'bass';
  if (sign === 'C') return Number(line) === 4 ? 'tenor' : 'alto';
  if (sign === 'percussion') return 'percussion';
  return 'treble';
};

function guessInstrument(name = '') {
  const n = name.toLowerCase();
  const hit = INSTRUMENTS.find((i) => n.includes(i.name.toLowerCase().split(' ')[0]));
  return hit ? hit.id : 'piano';
}

export function importMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML.');
  const root = doc.querySelector('score-partwise');
  if (!root) throw new Error('Only partwise MusicXML files are supported.');

  const title = doc.querySelector('work-title')?.textContent
    || doc.querySelector('movement-title')?.textContent || 'Imported Score';
  const composer = doc.querySelector('creator[type="composer"]')?.textContent || '';

  const partEls = [...root.querySelectorAll(':scope > part')];
  const partInfo = [...root.querySelectorAll('part-list > score-part')];
  const measureCount = partEls[0]?.querySelectorAll(':scope > measure').length || 1;

  const score = createScore({ title, composer, instruments: [], measureCount });
  score.parts = [];
  score.measures = Array.from({ length: measureCount }, () => makeMeasureAttrs());

  let divisions = DIVISIONS;
  let globalTempo = 100;

  partEls.forEach((partEl, pi) => {
    const info = partInfo[pi];
    const name = info?.querySelector('part-name')?.textContent?.trim() || `Part ${pi + 1}`;
    const instId = guessInstrument(name);
    const part = makePart(instId, measureCount, 1920);
    part.name = name;
    part.abbr = info?.querySelector('part-abbreviation')?.textContent?.trim() || name.slice(0, 4);
    part.id = uid('p');

    const measures = [...partEl.querySelectorAll(':scope > measure')];
    let staffCount = 1;
    measures.forEach((mEl) => {
      const s = Number(mEl.querySelector('attributes > staves')?.textContent);
      if (s > staffCount) staffCount = s;
    });
    part.staves = Array.from({ length: staffCount }, (_, i) => makeStaff(i === 1 ? 'bass' : 'treble', measureCount, 1920));

    measures.forEach((mEl, mi) => {
      const div = Number(mEl.querySelector('attributes > divisions')?.textContent);
      if (div) divisions = div;
      const ticksPerDivision = (WHOLE_TICKS / 4) / divisions;

      const fifths = mEl.querySelector('attributes > key > fifths')?.textContent;
      if (fifths !== undefined && fifths !== null) score.measures[mi].keySig = Number(fifths);
      const beats = mEl.querySelector('attributes > time > beats')?.textContent;
      const beatType = mEl.querySelector('attributes > time > beat-type')?.textContent;
      if (beats && beatType) score.measures[mi].timeSig = { n: Number(beats), d: Number(beatType) };
      const tempoEl = mEl.querySelector('sound[tempo]');
      if (tempoEl) {
        const bpm = Math.round(Number(tempoEl.getAttribute('tempo')));
        if (mi === 0) globalTempo = bpm; else score.measures[mi].tempo = bpm;
      }
      mEl.querySelectorAll('attributes > clef').forEach((clefEl) => {
        const num = Number(clefEl.getAttribute('number') || 1) - 1;
        const clef = XML_CLEF(clefEl.querySelector('sign')?.textContent, clefEl.querySelector('line')?.textContent);
        if (part.staves[num]) {
          if (mi === 0) part.staves[num].clef = clef;
          else part.staves[num].clefChanges[mi] = clef;
        }
      });
      if (mEl.querySelector('barline repeat[direction="forward"]')) score.measures[mi].startRepeat = true;
      if (mEl.querySelector('barline repeat[direction="backward"]')) score.measures[mi].endRepeat = true;
      if (mEl.querySelector('bar-style')?.textContent === 'light-heavy') score.measures[mi].barline = 'final';

      // Collect notes into (staff, voice) buckets.
      const buckets = new Map();
      const push = (staff, voice, ev) => {
        const key = `${staff}:${voice}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(ev);
      };

      let lastEv = null;
      let pendingDynamic = null;
      let pendingChord = null;
      [...mEl.children].forEach((child) => {
        if (child.tagName === 'direction') {
          const dyn = child.querySelector('direction-type > dynamics > *');
          if (dyn) pendingDynamic = dyn.tagName;
          return;
        }
        if (child.tagName === 'harmony') {
          const kindEl = child.querySelector('kind');
          pendingChord = chordFromParts({
            rootStep: child.querySelector('root > root-step')?.textContent,
            rootAlter: Number(child.querySelector('root > root-alter')?.textContent || 0),
            kind: kindEl?.textContent,
            kindText: kindEl?.getAttribute('text') || null,
            bassStep: child.querySelector('bass > bass-step')?.textContent,
            bassAlter: Number(child.querySelector('bass > bass-alter')?.textContent || 0),
          });
          return;
        }
        if (child.tagName !== 'note') return;
        const nEl = child;
        const staff = Number(nEl.querySelector('staff')?.textContent || 1) - 1;
        const voice = Number(nEl.querySelector('voice')?.textContent || 1);
        const voiceIdx = Math.max(0, (voice - 1) % 4);
        const durTicks = Math.round(Number(nEl.querySelector('duration')?.textContent || 0) * ticksPerDivision);
        const typeName = nEl.querySelector('type')?.textContent;
        const dots = nEl.querySelectorAll('dot').length;
        const base = NAME_TYPES[typeName] || guessBase(durTicks, dots);
        const isChord = !!nEl.querySelector('chord');
        const isRest = !!nEl.querySelector('rest');

        if (isChord && lastEv && lastEv.kind === 'note') {
          const p = nEl.querySelector('pitch');
          if (p) {
            lastEv.pitches.push({
              step: p.querySelector('step')?.textContent || 'C',
              octave: Number(p.querySelector('octave')?.textContent || 4),
              alter: Number(p.querySelector('alter')?.textContent || 0),
            });
          }
          return;
        }

        let ev;
        if (isRest) {
          ev = makeRest({ base, dots });
        } else {
          const p = nEl.querySelector('pitch');
          ev = makeNote([{
            step: p?.querySelector('step')?.textContent || 'C',
            octave: Number(p?.querySelector('octave')?.textContent || 4),
            alter: Number(p?.querySelector('alter')?.textContent || 0),
          }], { base, dots });
          if (nEl.querySelector('tie[type="start"], tied[type="start"]')) ev.tie = true;
          const arts = [];
          const map = { staccato: 'staccato', staccatissimo: 'staccatissimo', accent: 'accent', 'strong-accent': 'marcato', tenuto: 'tenuto' };
          nEl.querySelectorAll('notations > articulations > *').forEach((a) => {
            if (map[a.tagName]) arts.push(map[a.tagName]);
          });
          if (nEl.querySelector('notations > fermata')) arts.push('fermata');
          ev.articulations = arts;
          const tech = nEl.querySelector('notations > technical > other-technical')?.textContent;
          if (tech) ev.technique = tech;
          const slur = nEl.querySelector('notations > slur');
          if (slur) ev.slur = slur.getAttribute('type') === 'start' ? 'start' : 'stop';
          const lyric = nEl.querySelector('lyric > text')?.textContent;
          if (lyric) ev.lyric = lyric;
        }
        if (pendingDynamic && ev.kind === 'note') {
          ev.dynamic = pendingDynamic;
          pendingDynamic = null;
        }
        if (pendingChord) {
          ev.chord = pendingChord;
          pendingChord = null;
        }
        push(staff, voiceIdx, ev);
        lastEv = ev;
      });

      const ticks = 1920;
      part.staves.forEach((staff, si) => {
        const bar = makeBar(ticks);
        const voices = [];
        for (let v = 0; v < 4; v++) {
          const list = buckets.get(`${si}:${v}`);
          if (list?.length) voices.push(list);
        }
        bar.voices = voices.length ? voices : [makeRest({ base: 1, dots: 0 })].map((r) => [r]);
        staff.bars[mi] = bar;
      });
    });

    score.parts.push(part);
  });

  score.tempo = globalTempo;
  // Normalise every bar against its resolved time signature.
  for (let m = 0; m < score.measures.length; m++) {
    const ticks = timeSigTicks(timeSigAt(score, m));
    for (const part of score.parts) {
      for (const staff of part.staves) {
        const bar = staff.bars[m];
        if (!bar) continue;
        bar.voices = bar.voices.map((v) => normalizeVoice(v, ticks));
      }
    }
  }
  if (!score.parts.length) throw new Error('No parts found in this MusicXML file.');
  return score;
}

function guessBase(ticks, dots) {
  const factor = 2 - 1 / Math.pow(2, dots || 0);
  const raw = WHOLE_TICKS / Math.max(1, ticks / factor);
  const bases = [1, 2, 4, 8, 16, 32, 64];
  return bases.reduce((best, b) => (Math.abs(b - raw) < Math.abs(best - raw) ? b : best), 4);
}

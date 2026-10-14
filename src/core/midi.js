// Standard MIDI File (type 1) export.

import { buildTickTimeline, measureTickMap, TICKS_PER_QUARTER } from './timing.js';
import { timeSigAt, tempoAt } from './score.js';

const GM_PROGRAM = {
  piano: 0, epiano: 4, harpsichord: 6, celesta: 8, organ: 19, accordion: 21, bandoneon: 23, harp: 46,
  soprano: 52, 'alto-voice': 52, 'tenor-voice': 52, 'bass-voice': 52, choir: 52,
  piccolo: 72, flute: 73, recorder: 74, oboe: 68, clarinet: 71, 'bass-clarinet': 71,
  bassoon: 70, 'alto-sax': 65, 'tenor-sax': 66,
  trumpet: 56, horn: 60, trombone: 57, tuba: 58, euphonium: 58,
  violin: 40, viola: 41, cello: 42, contrabass: 43, 'strings-ens': 48,
  guitar: 24, 'elec-guitar': 27, 'elec-bass': 33, ukulele: 24,
  marimba: 12, vibraphone: 11, xylophone: 13, glockenspiel: 9, timpani: 47, drumset: 0,
  'synth-lead': 80, 'synth-pad': 88, 'synth-bass': 38,
};

function vlq(value) {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

const str = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

function chunk(id, data) {
  const len = data.length;
  return [...str(id), (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...data];
}

function metaText(type, text) {
  const bytes = str(text);
  return [0x00, 0xff, type, ...vlq(bytes.length), ...bytes];
}

export function exportMIDI(score) {
  const { events } = buildTickTimeline(score);
  const measureMap = measureTickMap(score);

  // ---- conductor track: tempo + time signature changes
  const meta = [];
  meta.push(...metaText(0x03, score.title || 'Score'));
  let lastTempo = null;
  let lastTs = null;
  const conductor = [];
  for (let m = 0; m < score.measures.length; m++) {
    const bpm = tempoAt(score, m);
    const ts = timeSigAt(score, m);
    if (bpm !== lastTempo) {
      const usPerQuarter = Math.round(60000000 / bpm);
      conductor.push({
        tick: measureMap[m],
        bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255],
      });
      lastTempo = bpm;
    }
    if (!lastTs || lastTs.n !== ts.n || lastTs.d !== ts.d) {
      conductor.push({
        tick: measureMap[m],
        bytes: [0xff, 0x58, 0x04, ts.n, Math.round(Math.log2(ts.d)), 24, 8],
      });
      lastTs = ts;
    }
  }
  let prev = 0;
  const track0 = [...meta];
  for (const c of conductor.sort((a, b) => a.tick - b.tick)) {
    track0.push(...vlq(c.tick - prev), ...c.bytes);
    prev = c.tick;
  }
  track0.push(0x00, 0xff, 0x2f, 0x00);

  const tracks = [chunk('MTrk', track0)];

  // ---- one track per part
  score.parts.forEach((part, partIndex) => {
    const channel = partIndex >= 9 ? (partIndex + 1) % 16 : partIndex % 16;
    const program = GM_PROGRAM[part.instrumentId] ?? 0;
    const body = [];
    body.push(...metaText(0x03, part.name));
    body.push(0x00, 0xc0 | channel, program);
    body.push(0x00, 0xb0 | channel, 7, Math.round(Math.max(0, Math.min(1, part.volume)) * 127));
    body.push(0x00, 0xb0 | channel, 10, Math.round(((part.pan || 0) + 1) * 63.5));

    const messages = [];
    for (const e of events) {
      if (e.partIndex !== partIndex) continue;
      const velocity = Math.max(1, Math.min(127, Math.round(e.gain * 100)));
      messages.push({ tick: e.startTick, bytes: [0x90 | channel, e.midi, velocity], order: 1 });
      messages.push({ tick: e.startTick + e.durTicks, bytes: [0x80 | channel, e.midi, 0x40], order: 0 });
    }
    messages.sort((a, b) => a.tick - b.tick || a.order - b.order);

    let last = 0;
    for (const msg of messages) {
      body.push(...vlq(Math.max(0, msg.tick - last)), ...msg.bytes);
      last = msg.tick;
    }
    body.push(...vlq(Math.max(0, measureMap[measureMap.length - 1] - last)), 0xff, 0x2f, 0x00);
    tracks.push(chunk('MTrk', body));
  });

  const header = chunk('MThd', [
    0, 1,
    (tracks.length >> 8) & 255, tracks.length & 255,
    (TICKS_PER_QUARTER >> 8) & 255, TICKS_PER_QUARTER & 255,
  ]);

  return new Uint8Array([...header, ...tracks.flat()]);
}

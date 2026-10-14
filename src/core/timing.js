// Flattens the score into performance events, in ticks (for MIDI) and seconds (for playback).

import { durationTicks, pitchToMidi, DYNAMIC_GAIN } from './theory.js';
import { measureTicks, tempoAt, voiceTimeline } from './score.js';

export const TICKS_PER_QUARTER = 480;

const ARTICULATION_SHAPE = {
  staccato: { len: 0.5, vel: 1 },
  staccatissimo: { len: 0.35, vel: 1.05 },
  tenuto: { len: 1, vel: 1 },
  accent: { len: 0.92, vel: 1.25 },
  marcato: { len: 0.7, vel: 1.35 },
  fermata: { len: 1.8, vel: 1 },
};

/** Absolute start tick of every measure (length = measures + 1). */
export function measureTickMap(score) {
  const ticks = [0];
  for (let m = 0; m < score.measures.length; m++) {
    ticks.push(ticks[m] + measureTicks(score, m));
  }
  return ticks;
}

/** Absolute start time in seconds of every measure, honouring tempo changes. */
export function measureTimeMap(score) {
  const times = [0];
  let t = 0;
  for (let m = 0; m < score.measures.length; m++) {
    const secPerTick = 60 / tempoAt(score, m) / TICKS_PER_QUARTER;
    t += measureTicks(score, m) * secPerTick;
    times.push(t);
  }
  return times;
}

export function tickToSeconds(score, measureIndex, tick) {
  return measureTimeMap(score)[measureIndex] + tick * (60 / tempoAt(score, measureIndex) / TICKS_PER_QUARTER);
}

export function secondsToPosition(score, seconds) {
  const map = measureTimeMap(score);
  let m = 0;
  while (m < map.length - 2 && map[m + 1] <= seconds) m++;
  const tick = Math.max(0, (seconds - map[m]) / (60 / tempoAt(score, m) / TICKS_PER_QUARTER));
  return { measureIndex: m, tick };
}

/** Note events with absolute tick positions. Ties are merged, articulations applied. */
export function buildTickTimeline(score) {
  const map = measureTickMap(score);
  const events = [];

  score.parts.forEach((part, partIndex) => {
    const transpose = part.transpose || 0;
    for (const staff of part.staves) {
      const voiceCount = Math.max(1, ...staff.bars.map((b) => b.voices.length));
      for (let vi = 0; vi < voiceCount; vi++) {
        let dynamic = 'mf';
        const stream = [];
        for (let m = 0; m < staff.bars.length; m++) {
          const voice = staff.bars[m].voices[vi];
          if (!voice) continue;
          for (const slot of voiceTimeline(voice)) {
            stream.push({
              ev: slot.ev, measureIndex: m, tick: slot.start,
              startTick: map[m] + slot.start, durTicks: durationTicks(slot.ev.dur),
            });
          }
        }

        for (let i = 0; i < stream.length; i++) {
          const item = stream[i];
          const ev = item.ev;
          if (ev.dynamic) dynamic = ev.dynamic;
          if (ev.kind !== 'note' || ev.hidden) continue;

          let durTicks = item.durTicks;
          let j = i;
          while (stream[j]?.ev.tie && stream[j + 1]?.ev.kind === 'note') {
            durTicks += stream[j + 1].durTicks;
            j++;
          }

          let lenScale = 0.94;
          let velScale = 1;
          for (const art of ev.articulations || []) {
            const shape = ARTICULATION_SHAPE[art];
            if (!shape) continue;
            lenScale = shape.len > 1 ? shape.len : Math.min(lenScale, shape.len);
            velScale *= shape.vel;
          }

          for (const p of ev.pitches) {
            events.push({
              startTick: item.startTick,
              durTicks: Math.max(15, Math.round(durTicks * lenScale)),
              rawDurTicks: durTicks,
              midi: Math.max(0, Math.min(127, pitchToMidi(p) + transpose)),
              gain: Math.min(1.3, (DYNAMIC_GAIN[dynamic] ?? 0.6) * velScale),
              partId: part.id,
              partIndex,
              eventId: ev.id,
              technique: ev.technique || null,
              measureIndex: item.measureIndex,
              tick: item.tick,
            });
          }
          i = j;
        }
      }
    }
  });

  events.sort((a, b) => a.startTick - b.startTick);
  return { events, measureTicks: map, totalTicks: map[map.length - 1] };
}

/** Playback events in seconds. */
export function buildTimeline(score) {
  const { events } = buildTickTimeline(score);
  const times = measureTimeMap(score);
  const out = events.map((e) => {
    const secPerTick = 60 / tempoAt(score, e.measureIndex) / TICKS_PER_QUARTER;
    return {
      ...e,
      time: times[e.measureIndex] + e.tick * secPerTick,
      duration: Math.max(0.05, e.durTicks * secPerTick),
    };
  });
  return { events: out, measureTimes: times, duration: times[times.length - 1] };
}

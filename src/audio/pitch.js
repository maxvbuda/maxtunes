// Monophonic pitch tracking and transcription for microphone input.
// Nothing here touches Web Audio, so the same code analyses live input and the
// offline renders used to test it.

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

const ANALYSIS_RATE = 16000;
const HOP_SECONDS = 0.01;
const MIN_NOTE_SECONDS = 0.05;
const GAP_FRAMES = 4;        // unpitched frames (~40 ms) that end a note
const CHANGE_FRAMES = 3;     // frames a new pitch must hold before it counts as a new note
const CLARITY = 0.78;        // YIN periodicity needed to call a frame pitched
const REATTACK_FRAMES = 8;   // a re-attack rises fast; a slow return is a bellows swell
const ONSET_LAG = 0.015;     // first pitched frame trails the attack by ~15–20 ms (measured on renders)

function lowpass(fc, fs, q) {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
    z1: 0,
    z2: 0,
  };
}

/**
 * Streaming anti-alias filter and decimator. Pitch tracking only needs a few kHz,
 * and ~16 kHz makes YIN cheap enough to run live.
 */
export class Decimator {
  constructor(inputRate, targetRate = ANALYSIS_RATE) {
    this.factor = Math.max(1, Math.round(inputRate / targetRate));
    this.rate = inputRate / this.factor;
    const fc = 0.35 * this.rate;
    // 4th-order Butterworth as two biquads.
    this.stages = [lowpass(fc, inputRate, 0.5412), lowpass(fc, inputRate, 1.3066)];
    this.count = 0;
  }

  push(input) {
    const { factor, stages } = this;
    const out = new Float32Array(Math.ceil(input.length / factor) + 1);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      let x = input[i];
      for (let k = 0; k < stages.length; k++) {
        const s = stages[k];
        const y = s.b0 * x + s.z1;
        s.z1 = s.b1 * x - s.a1 * y + s.z2;
        s.z2 = s.b2 * x - s.a2 * y;
        x = y;
      }
      if (this.count++ % factor === 0) out[n++] = x;
    }
    return out.slice(0, n);
  }
}

let scratch = new Float32Array(0);

function yinSize(rate, minHz) {
  const tauMax = Math.ceil(rate / minHz);
  return { tauMax, window: Math.max(tauMax, Math.round(rate * 0.02)) };
}

/**
 * YIN estimate for the window starting at `start`: { hz, clarity, rms }, or null when
 * the buffer is too short. Clarity near 1 means strongly periodic.
 */
export function detectPitch(x, start, rate, { minHz = 50, maxHz = 2000, threshold = 0.15 } = {}) {
  const { tauMax, window: W } = yinSize(rate, minHz);
  const tauMin = Math.max(2, Math.floor(rate / maxHz));
  if (start < 0 || start + W + tauMax + 2 > x.length) return null;
  if (scratch.length < tauMax + 2) scratch = new Float32Array(tauMax + 2);
  const d = scratch;

  let energy = 0;
  for (let j = start; j < start + W; j++) energy += x[j] * x[j];
  if (energy === 0) return { hz: 0, clarity: 0, rms: 0 };
  const rms = Math.sqrt(energy / W);

  // Cumulative mean normalised difference.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let j = start; j < start + W; j++) {
      const diff = x[j] - x[j + tau];
      sum += diff * diff;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // First dip under the threshold, followed down to its floor; else the global minimum.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t < tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    tau = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[tau]) tau = t;
  }

  const a = d[tau - 1];
  const b = d[tau];
  const c = d[tau + 1];
  const curve = a - 2 * b + c;
  const shift = curve > 0 ? Math.max(-1, Math.min(1, (a - c) / (2 * curve))) : 0;
  return { hz: rate / (tau + shift), clarity: Math.max(0, 1 - b), rms };
}

function median(values) {
  const v = [...values].sort((p, q) => p - q);
  return v[v.length >> 1];
}

/** Level below which a frame is treated as room noise, measured where nobody is playing. */
function noiseGate(frames, quietUntil) {
  const all = frames.map((f) => f.rms).sort((p, q) => p - q);
  const quiet = frames.filter((f) => f.t < quietUntil).map((f) => f.rms).sort((p, q) => p - q);
  const floor = quiet.length >= 10 ? quiet[quiet.length >> 1] : all[Math.floor(all.length * 0.1)];
  const loud = all[Math.floor(all.length * 0.9)];
  // Never gate so high that a take played end to end disappears.
  return Math.min(Math.max(floor * 3.5, 0.003), loud * 0.25);
}

/**
 * YIN's classic failure is a lone frame an octave off; pull those back to their neighbours.
 * Decided on the original readings and only on a clear majority: correcting in place lets
 * one fix tip the next frame's neighbourhood, and the "error" spreads through a whole note.
 */
function fixOctaveSlips(frames) {
  const original = frames.map((f) => f.midi);
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].voiced) continue;
    const around = [];
    for (let k = Math.max(0, i - 4); k <= Math.min(frames.length - 1, i + 4); k++) {
      if (k !== i && frames[k].voiced) around.push(original[k]);
    }
    if (around.length < 4) continue;
    const center = median(around);
    const agree = around.filter((m) => Math.abs(m - center) < 0.8).length;
    const off = original[i] - center;
    if (agree >= around.length * 0.75 && Math.abs(Math.abs(off) - 12) < 0.8) {
      frames[i].midi = original[i] - 12 * Math.sign(off);
    }
  }
}

// Period ratios 2, 3, 4, 5, 6 and 8 in semitones — where YIN lands when it locks onto a
// multiple of the true period.
const SUBHARMONIC = new Set([12, 19, 24, 28, 31, 36]);

/**
 * Fold detector artefacts back into the notes they belong to:
 * - a bowed or blown attack can read as a subharmonic for a few frames before the pitch
 *   settles, which would write a stray short note in front of the real one;
 * - two reeds beating periodically cancel a held note's fundamental for 30–110 ms and the
 *   octave above wins for that moment. Measured on the bandoneon voice, the blip keeps its
 *   level and clarity, so what gives it away is context: it sits inside a long note of the
 *   pitch below and is shorter than a real legato figure;
 * - any glitch too short to be a note, sandwiched inside one pitch, is only a glitch.
 */
function mergeOctaveBlips(notes) {
  const list = notes.map((n) => ({ ...n }));
  const touching = (a, b) => b.start - a.end < 0.04;
  const dur = (n) => n.end - n.start;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const prev = out[out.length - 1];
    const next = list[i + 1];
    const len = dur(n);

    if (next && len < 0.12 && touching(n, next) && dur(next) > 2 * len
      && SUBHARMONIC.has(next.midi - n.midi)) {
      next.start = n.start;
      continue;
    }

    const glued = prev && touching(prev, n);
    // The blip lasts a fixed share of the beat period, which lengthens as pitch falls: ~40 ms
    // up high, over 200 ms on a low bass note. So the limit grows with how long the note has held.
    const blipLimit = Math.max(0.13, Math.min(0.35, 0.2 * dur(prev || n)));
    const octaveBlip = glued && Math.abs(n.midi - prev.midi) === 12 && len < blipLimit
      && dur(prev) >= Math.max(0.25, 2 * len);
    const sandwiched = glued && next && next.midi === prev.midi && touching(n, next);
    if (sandwiched && (octaveBlip || len < MIN_NOTE_SECONDS)) {
      prev.end = next.end;
      i++;
      continue;
    }
    if (octaveBlip && (!next || !touching(n, next))) {
      prev.end = n.end;
      continue;
    }
    out.push(n);
  }
  return out;
}

function holds(frames, i, midi) {
  let seen = 0;
  for (let k = i + 1; k < frames.length && k <= i + CHANGE_FRAMES + 2; k++) {
    if (!frames[k].voiced) continue;
    if (Math.abs(frames[k].midi - midi) > 0.5) return false;
    if (++seen >= CHANGE_FRAMES - 1) return true;
  }
  return false;
}

function segment(frames, hopSec) {
  const notes = [];
  let note = null;
  let silent = 0;

  // Short segments are kept here: mergeOctaveBlips needs to see detector glitches to stitch
  // the note around them back together. Whatever is still short afterwards is dropped.
  const finish = (idx) => {
    if (!idx.length) return;
    const start = frames[idx[0]].t - ONSET_LAG;
    const end = frames[idx[idx.length - 1]].t + hopSec;
    // Judge the pitch on the body of the note, not the attack or the release.
    const body = idx.slice(Math.floor(idx.length * 0.2), Math.max(1, Math.ceil(idx.length * 0.8)));
    notes.push({ start, end, midi: Math.round(median(body.map((k) => frames[k].midi))) });
  };
  const begin = (idx) => ({ idx, peak: Math.max(...idx.map((k) => frames[k].rms)), dip: null });

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.voiced) {
      if (note && ++silent >= GAP_FRAMES) {
        finish(note.idx);
        note = null;
      }
      continue;
    }
    silent = 0;
    if (!note) {
      note = begin([i]);
      continue;
    }

    const here = median(note.idx.slice(-12).map((k) => frames[k].midi));
    if (Math.abs(f.midi - here) >= 0.6 && holds(frames, i, f.midi)) {
      finish(note.idx);
      note = begin([i]);
      continue;
    }

    // The same pitch played again: the sound nearly stops (−14 dB) and comes straight back.
    // Reed beating and musette tremolo dip too, but not that far; a slow return is a swell.
    if (f.rms < note.peak * 0.2) {
      if (note.dip === null || f.rms <= frames[note.dip].rms) note.dip = i;
    } else if (note.dip !== null && f.rms > note.peak * 0.7) {
      if (i - note.dip <= REATTACK_FRAMES) {
        const cut = note.idx.indexOf(note.dip);
        finish(note.idx.slice(0, cut));
        note = begin([...note.idx.slice(cut), i]);
        continue;
      }
      note.dip = null;
    }
    note.idx.push(i);
    note.peak = Math.max(note.peak, f.rms);
  }
  if (note) finish(note.idx);
  return notes;
}

/**
 * Turn a mono recording into notes — [{ start, end, midi }] in seconds from the first
 * sample. `quietUntil` marks a stretch with no playing (the count-in) to measure the room.
 */
export function transcribe(samples, rate, { minMidi = 28, maxMidi = 100, quietUntil = 0 } = {}) {
  const minHz = Math.max(40, midiToHz(minMidi - 1));
  const maxHz = Math.min(2400, midiToHz(maxMidi + 1));
  const hop = Math.max(1, Math.round(rate * HOP_SECONDS));
  const center = yinSize(rate, minHz).window / 2 / rate;

  const frames = [];
  for (let s = 0; ; s += hop) {
    const f = detectPitch(samples, s, rate, { minHz, maxHz });
    if (!f) break;
    frames.push({ t: s / rate + center, ...f });
  }
  if (!frames.length) return [];

  const gate = noiseGate(frames, quietUntil);
  for (const f of frames) {
    f.voiced = f.rms > gate && f.clarity >= CLARITY && f.hz >= minHz && f.hz <= maxHz;
    f.midi = f.voiced ? hzToMidi(f.hz) : null;
  }
  fixOctaveSlips(frames);
  return mergeOctaveBlips(segment(frames, hop / rate)).filter((n) => n.end - n.start >= MIN_NOTE_SECONDS);
}

/**
 * Snap notes to a grid of `grid` ticks. `toTick` maps seconds to ticks. The result is a
 * single line: never overlapping, and legato wherever the player left only a small gap.
 */
export function quantize(notes, { toTick, grid, beat = 480 }) {
  const snapTo = (t, step) => Math.round(t / step) * step;
  const snap = (t) => snapTo(t, grid);
  const placed = notes
    .map((n) => ({ midi: n.midi, rawStart: toTick(n.start), rawEnd: toTick(n.end) }))
    .map((n) => ({ ...n, start: snap(n.rawStart) }))
    .filter((n) => n.start >= 0)
    .sort((a, b) => a.start - b.start || (b.rawEnd - b.rawStart) - (a.rawEnd - a.rawStart));

  const line = [];
  for (const n of placed) {
    if (line.length && line[line.length - 1].start === n.start) continue;
    line.push(n);
  }

  return line.map((n, i) => {
    const next = line[i + 1];
    // Players let go of long notes early; land the end on a beat or half-beat when it's
    // reasonably close, rather than on a stray sixteenth.
    const tolerance = Math.max(grid / 2, (n.rawEnd - n.rawStart) * 0.15);
    let end = snap(n.rawEnd);
    for (const step of [beat, beat / 2]) {
      if (step > grid && Math.abs(snapTo(n.rawEnd, step) - n.rawEnd) <= tolerance) {
        end = snapTo(n.rawEnd, step);
        break;
      }
    }
    end = Math.max(n.start + grid, end);
    // Close small gaps (detached playing) but keep real rests. Judged on the gap the player
    // actually left: snapping the end first can make a short gap look like a full rest.
    const gapLimit = Math.min(beat / 2, next ? (next.start - n.start) * 0.5 : 0);
    if (next && (end > next.start || next.rawStart - n.rawEnd < gapLimit)) end = next.start;
    return { midi: n.midi, start: n.start, end };
  });
}

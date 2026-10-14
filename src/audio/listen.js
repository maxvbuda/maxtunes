// Microphone recording: a count-in and click on the audio clock, raw input captured
// sample-accurately in an AudioWorklet, and a live pitch readout.

import { audio } from './engine.js';
import { Decimator, detectPitch, hzToMidi } from './pitch.js';
import { measureTicks, tempoAt, timeSigAt } from '../core/score.js';

const CAPTURE_WORKLET = `
class MaxTunesCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.t0 = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this.n === 0) this.t0 = currentTime + i / sampleRate;
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) {
        this.port.postMessage({ samples: this.buf, time: this.t0 }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('maxtunes-capture', MaxTunesCapture);
`;

const LIVE_WINDOW = 1024;
const LIVE_RANGE = { minHz: 50, maxHz: 2000 };
const LEAD_IN = 0.3;
const SCHEDULE_AHEAD = 0.25;

/**
 * Real-time layout of bars from `startBar` onward, carried on past the score's end with its
 * last meter and tempo, plus a map from seconds after the downbeat to ticks from that bar.
 */
export function barGrid(score, startBar, tempoScale = 1, count = 400) {
  const last = score.measures.length - 1;
  const bars = [];
  let sec = 0;
  let tick = 0;
  for (let i = 0; i < count; i++) {
    const m = Math.min(startBar + i, last);
    const ticks = measureTicks(score, m);
    const secPerTick = 60 / (tempoAt(score, m) * tempoScale * 480);
    bars.push({ sec, tick, ticks, beats: timeSigAt(score, m).n, secPerTick });
    sec += ticks * secPerTick;
    tick += ticks;
  }
  const toTick = (s) => {
    if (s < 0) return s / bars[0].secPerTick;
    let i = 0;
    while (i + 1 < bars.length && bars[i + 1].sec <= s) i++;
    return bars[i].tick + (s - bars[i].sec) / bars[i].secPerTick;
  };
  return { bars, toTick };
}

const beatSeconds = (bar) => (bar.ticks * bar.secPerTick) / bar.beats;

class Listener {
  constructor() {
    this.session = null;
    this.loaded = new WeakSet();
  }

  async loadWorklet(ctx) {
    if (this.loaded.has(ctx)) return;
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.loaded.add(ctx);
  }

  /** Open the mic and start the count-in. Resolves once audio is flowing. */
  async start({ grid, click = true }) {
    if (this.session) return;
    const ctx = audio.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access.');

    // Voice-call processing (echo cancelling, noise suppression, auto gain) mangles
    // sustained musical tones, so all of it is off.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    try {
      await this.loadWorklet(ctx);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'maxtunes-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    const first = grid.bars[0];
    const beatSec = beatSeconds(first);
    const decimator = new Decimator(ctx.sampleRate);
    const inputLatency = stream.getAudioTracks()[0]?.getSettings?.().latency || 0.01;

    const s = {
      ctx, stream, source, node, sink, grid, click, beatSec, decimator,
      rate: decimator.rate,
      rawRate: ctx.sampleRate,
      downbeat: ctx.currentTime + LEAD_IN + first.beats * beatSec,
      // A player lines up with the click as it leaves the speakers, and the mic hears them
      // late again; both delays are taken off every note.
      latency: (ctx.outputLatency || ctx.baseLatency || 0) + inputLatency,
      chunks: [],
      rawCount: 0,
      firstTime: null,
      tail: new Float32Array(LIVE_WINDOW),
      peak: 0,
      nextBar: -1,
      nextBeat: 0,
    };
    this.session = s;
    node.port.onmessage = (e) => this.receive(e.data);
    this.schedule();
    s.timer = setInterval(() => this.schedule(), 50);
  }

  clickTime(bar, beat) {
    const s = this.session;
    if (bar < 0) return s.downbeat - (s.grid.bars[0].beats - beat) * s.beatSec;
    const b = s.grid.bars[bar];
    return s.downbeat + b.sec + beat * beatSeconds(b);
  }

  schedule() {
    const s = this.session;
    if (!s) return;
    const horizon = s.ctx.currentTime + SCHEDULE_AHEAD;
    while (s.nextBar < s.grid.bars.length) {
      if (s.nextBar >= 0 && !s.click) return;
      const t = this.clickTime(s.nextBar, s.nextBeat);
      if (t > horizon) return;
      audio.click(s.nextBeat === 0, t, { pitched: false });
      const beats = s.nextBar < 0 ? s.grid.bars[0].beats : s.grid.bars[s.nextBar].beats;
      if (++s.nextBeat >= beats) {
        s.nextBeat = 0;
        s.nextBar++;
      }
    }
  }

  receive({ samples, time }) {
    const s = this.session;
    if (!s) return;
    if (s.firstTime === null) s.firstTime = time;
    // A dropped block would slide everything after it early; fill the hole with silence.
    const missing = Math.round((time - (s.firstTime + s.rawCount / s.rawRate)) * s.rawRate);
    if (missing > 0) this.feed(new Float32Array(missing));
    this.feed(samples);
  }

  feed(raw) {
    const s = this.session;
    s.rawCount += raw.length;
    const dec = s.decimator.push(raw);
    s.chunks.push(dec);

    const { tail } = s;
    if (dec.length >= tail.length) {
      tail.set(dec.subarray(dec.length - tail.length));
    } else {
      tail.copyWithin(0, dec.length);
      tail.set(dec, tail.length - dec.length);
    }
    let peak = 0;
    for (let i = 0; i < dec.length; i++) peak = Math.max(peak, Math.abs(dec[i]));
    s.peak = Math.max(s.peak, peak);
  }

  /** Snapshot for the recording panel: count-in, position, input level and heard pitch. */
  live() {
    const s = this.session;
    if (!s) return null;
    const since = s.ctx.currentTime - s.downbeat;
    const out = { level: s.peak, midi: null, countdown: 0, bar: 0, beat: 0 };
    if (since < 0) {
      out.countdown = Math.ceil(-since / s.beatSec);
    } else {
      const { bars } = s.grid;
      let i = 0;
      while (i + 1 < bars.length && bars[i + 1].sec <= since) i++;
      out.bar = i;
      out.beat = Math.floor((since - bars[i].sec) / beatSeconds(bars[i]));
    }
    const f = detectPitch(s.tail, 0, s.rate, LIVE_RANGE);
    if (f && f.clarity >= 0.8 && f.rms > 0.004) out.midi = hzToMidi(f.hz);
    s.peak *= 0.9;
    return out;
  }

  /** Close the mic and hand back the take, timed relative to the downbeat. */
  stop() {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    clearInterval(s.timer);
    s.node.port.onmessage = null;
    try {
      s.source.disconnect();
      s.node.disconnect();
      s.sink.disconnect();
    } catch { /* already disconnected */ }
    s.stream.getTracks().forEach((t) => t.stop());

    const samples = new Float32Array(s.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of s.chunks) {
      samples.set(c, at);
      at += c.length;
    }
    const first = s.firstTime ?? s.downbeat;
    return {
      samples,
      rate: s.rate,
      offset: s.downbeat + s.latency - first,
      quietUntil: s.downbeat - first - 0.1,
    };
  }
}

export const listener = new Listener();

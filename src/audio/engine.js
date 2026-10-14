// Web Audio synthesis engine: per-instrument subtractive/additive voices, mixer and
// look-ahead scheduler for score playback.

import { getInstrument, TECHNIQUE_TIMBRES } from '../core/instruments.js';
import { buildTimeline } from '../core/timing.js';
import { timeSigAt } from '../core/score.js';

// Wide enough that a background tab's throttled timers (>=1s) never starve the scheduler.
const LOOKAHEAD = 1.8;      // seconds of audio scheduled in advance
const TICK_INTERVAL = 80;   // ms between scheduler wakeups

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.parts = new Map();
    this.active = new Set();
    this.state = null;
    this.listeners = new Set();
    this.masterVolume = 0.85;
    this.metronomeOn = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.22;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.1, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.16;
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.9;

    this.master.connect(this.compressor);
    this.master.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    this.noiseBuffer = makeNoise(ctx, 2);
    return ctx;
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setReverb(v) {
    if (this.reverbSend) this.reverbSend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Create or refresh a mixer channel per part. */
  syncParts(score) {
    const ctx = this.ensure();
    const solo = score.parts.some((p) => p.solo);
    for (const part of score.parts) {
      let chain = this.parts.get(part.id);
      if (!chain) {
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (panner) {
          gain.connect(panner);
          panner.connect(this.master);
        } else {
          gain.connect(this.master);
        }
        chain = { gain, panner };
        this.parts.set(part.id, chain);
      }
      const audible = part.mute ? 0 : solo && !part.solo ? 0 : part.volume;
      chain.gain.gain.setTargetAtTime(audible, ctx.currentTime, 0.02);
      if (chain.panner) chain.panner.pan.setTargetAtTime(part.pan || 0, ctx.currentTime, 0.02);
    }
    for (const [id, chain] of this.parts) {
      if (!score.parts.some((p) => p.id === id)) {
        chain.gain.disconnect();
        this.parts.delete(id);
      }
    }
  }

  destinationFor(partId) {
    const chain = this.parts.get(partId);
    return chain ? chain.gain : this.master;
  }

  /** Build and start one synth voice. Returns a handle that can be released early. */
  spawn({ midi, duration, timbre, gain = 0.7, when = 0, destination, technique = null }) {
    const ctx = this.ensure();
    const handle = buildVoice(ctx, {
      midi,
      duration,
      timbre: TECHNIQUE_TIMBRES[technique] || timbre,
      technique,
      gain,
      when: Math.max(when, ctx.currentTime + 0.002),
      destination: destination || this.master,
      noiseBuffer: this.noiseBuffer,
    });
    this.active.add(handle);
    const cleanupMs = Math.max(0, (handle.stopAt - ctx.currentTime) * 1000 + 60);
    setTimeout(() => {
      handle.dispose();
      this.active.delete(handle);
    }, cleanupMs);
    return handle;
  }

  /** Audition a single pitch (piano keyboard, note entry feedback). */
  preview(midi, instrumentId = 'piano', gain = 0.8, duration = 0.9) {
    const inst = getInstrument(instrumentId);
    this.spawn({ midi, duration, timbre: inst.timbre, gain, when: this.ensure().currentTime + 0.005 });
  }

  playChord(midis, instrumentId = 'piano', gain = 0.7, duration = 1.1) {
    midis.forEach((m) => this.preview(m, instrumentId, gain, duration));
  }

  click(accent = false, when = 0, { pitched = true } = {}) {
    const ctx = this.ensure();
    const t = Math.max(when, ctx.currentTime + 0.002);
    const g = ctx.createGain();
    g.connect(this.compressor);
    let src;
    if (pitched) {
      src = ctx.createOscillator();
      src.type = 'square';
      src.frequency.value = accent ? 1760 : 1200;
      src.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(accent ? 0.14 : 0.08, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.start(t);
    } else {
      // Unpitched tick for recording: if it leaks into the mic it can't be heard as a note.
      src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = accent ? 3400 : 2500;
      band.Q.value = 1.2;
      src.connect(band);
      band.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.start(t, Math.random());
    }
    src.stop(t + 0.07);
  }

  // ------------------------------------------------------------ transport

  start(score, {
    fromSeconds = 0, until = null, loop = null, tempoScale = 1, metronome = false, countIn = false,
  } = {}) {
    this.stop();
    const ctx = this.ensure();
    this.syncParts(score);

    const { events, measureTimes, duration } = buildTimeline(score);
    const timbres = new Map(score.parts.map((p) => [p.id, getInstrument(p.instrumentId).timbre]));

    const clicks = [];
    if (metronome) {
      for (let m = 0; m < score.measures.length; m++) {
        const ts = timeSigAt(score, m);
        const barLen = measureTimes[m + 1] - measureTimes[m];
        const beat = barLen / ts.n;
        for (let b = 0; b < ts.n; b++) clicks.push({ time: measureTimes[m] + b * beat, accent: b === 0 });
      }
    }

    let offset = fromSeconds;
    let leadIn = 0;
    if (countIn) {
      const ts = timeSigAt(score, 0);
      const bpm = score.tempo;
      leadIn = (60 / bpm) * ts.n;
      for (let b = 0; b < ts.n; b++) {
        this.click(b === 0, ctx.currentTime + 0.1 + b * (60 / bpm) / tempoScale);
      }
    }

    this.state = {
      score, events, clicks, timbres, measureTimes, duration,
      index: events.findIndex((e) => e.time >= offset - 1e-6),
      clickIndex: clicks.findIndex((c) => c.time >= offset - 1e-6),
      startCtxTime: ctx.currentTime + 0.1 + leadIn / tempoScale,
      offset,
      tempoScale,
      loop,
      until,
      playing: true,
    };
    if (this.state.index < 0) this.state.index = events.length;
    if (this.state.clickIndex < 0) this.state.clickIndex = clicks.length;

    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
    this.tick();
    this.emit();
    return this.state;
  }

  tick() {
    const s = this.state;
    if (!s || !s.playing) return;
    const ctx = this.ctx;
    const horizon = this.position() + LOOKAHEAD * s.tempoScale;

    while (s.index < s.events.length && s.events[s.index].time <= horizon) {
      const ev = s.events[s.index];
      const when = s.startCtxTime + (ev.time - s.offset) / s.tempoScale;
      if (when >= ctx.currentTime - 0.05) {
        this.spawn({
          midi: ev.midi,
          duration: ev.duration / s.tempoScale,
          timbre: s.timbres.get(ev.partId) || getInstrument('piano').timbre,
          technique: ev.technique,
          gain: ev.gain,
          when,
          destination: this.destinationFor(ev.partId),
        });
      }
      s.index++;
    }
    while (s.clickIndex < s.clicks.length && s.clicks[s.clickIndex].time <= horizon) {
      const c = s.clicks[s.clickIndex];
      this.click(c.accent, s.startCtxTime + (c.time - s.offset) / s.tempoScale);
      s.clickIndex++;
    }

    const pos = this.position();
    const end = s.loop ? s.loop.end : Math.min(s.duration, s.until ?? Infinity);
    if (pos >= end - 0.001) {
      if (s.loop) {
        this.start(s.score, {
          fromSeconds: s.loop.start,
          loop: s.loop,
          tempoScale: s.tempoScale,
          metronome: s.clicks.length > 0,
        });
      } else {
        this.stop();
      }
    }
  }

  /** Current playback position in score seconds. */
  position() {
    const s = this.state;
    if (!s || !this.ctx) return 0;
    return s.offset + Math.max(0, this.ctx.currentTime - s.startCtxTime) * s.tempoScale;
  }

  isPlaying() {
    return !!this.state?.playing;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.state) this.state.playing = false;
    this.state = null;
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      for (const h of [...this.active]) {
        try {
          h.amp.gain.cancelScheduledValues(now);
          h.amp.gain.setTargetAtTime(0.0001, now, 0.03);
          for (const n of h.nodes) if (n.stop) n.stop(now + 0.15);
        } catch { /* node already stopped */ }
        this.active.delete(h);
      }
    }
    this.emit();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.isPlaying());
  }
}

const waveCache = new WeakMap();

/** Cache one PeriodicWave per (context, partial set) — building them per note is wasteful. */
function reedWave(ctx, partials) {
  let byPartials = waveCache.get(ctx);
  if (!byPartials) { byPartials = new Map(); waveCache.set(ctx, byPartials); }
  let wave = byPartials.get(partials);
  if (!wave) {
    const real = new Float32Array(partials.length + 1);
    const imag = new Float32Array(partials.length + 1);
    partials.forEach((amp, i) => { imag[i + 1] = amp; });
    wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    byPartials.set(partials, wave);
  }
  return wave;
}

/**
 * Construct one note's node graph in `ctx`.
 * Split out from the engine so the same DSP can be rendered offline for testing.
 */
export function buildVoice(ctx, {
  midi, duration, timbre, gain = 0.7, when = 0, destination, noiseBuffer, technique = null,
}) {
  const t = when;
  const freq = midiToFreq(midi);
  const env = timbre.env || { a: 0.01, d: 0.3, s: 0.7, r: 0.3 };
  const decayed = !!timbre.decayed;

  const amp = ctx.createGain();
  amp.gain.value = 0;

  // Fixed-frequency body resonances. These deliberately do NOT follow the note:
  // an instrument's formants stay put while its pitch moves, and that cue is most
  // of what makes a synthesised reed read as a real one.
  let head = amp;
  const chain = [amp];
  for (const f of timbre.formants || []) {
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = f.freq;
    peak.Q.value = f.q ?? 1.5;
    peak.gain.value = f.gain ?? 4;
    peak.connect(head);
    head = peak;
    chain.push(peak);
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const fspec = timbre.filter || { freq: 4000, q: 1, envAmt: 0 };
  const track = fspec.track ?? 0.5;
  const fbase = Math.min(18000, Math.max(180, fspec.freq * Math.pow(2, ((midi - 60) / 12) * track)));
  filter.frequency.setValueAtTime(Math.min(18000, fbase + (fspec.envAmt || 0)), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(120, fbase), t + (fspec.envDecay || 0.3));
  filter.Q.value = fspec.q ?? 1;
  filter.connect(head);
  chain.push(filter);

  amp.connect(destination);

  const nodes = [];
  const wave = timbre.partials ? reedWave(ctx, timbre.partials) : null;

  for (const spec of timbre.osc || [{ wave: 'sine', gain: 1 }]) {
    const osc = ctx.createOscillator();
    if (spec.wave === 'reed' && wave) osc.setPeriodicWave(wave);
    else osc.type = spec.wave || 'sine';
    osc.frequency.value = freq * (spec.ratio || 1);
    const detune = spec.detune || 0;
    if (technique === 'arrastre') {
      // The drag: arrive under the pitch and slide up onto the beat.
      osc.detune.setValueAtTime(detune - 220, t);
      osc.detune.linearRampToValueAtTime(detune, t + 0.09);
    } else if (technique === 'latigo') {
      // The whip: a fast gliss straight up off the note.
      osc.detune.setValueAtTime(detune, t);
      osc.detune.linearRampToValueAtTime(detune + 1200, t + Math.min(0.3, duration * 0.75));
    } else if (timbre.pitchAttack) {
      // A reed speaks slightly flat and settles up as air pressure builds.
      const rise = timbre.pitchAttackTime ?? 0.04;
      osc.detune.setValueAtTime(detune + timbre.pitchAttack, t);
      osc.detune.linearRampToValueAtTime(detune, t + rise);
    } else if (detune) {
      osc.detune.value = detune;
    }
    const og = ctx.createGain();
    og.gain.value = spec.gain ?? 1;
    osc.connect(og);
    og.connect(filter);
    osc.start(t);
    nodes.push(osc);
  }

  if (timbre.noise && noiseBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const ng = ctx.createGain();
    if (timbre.noiseDecay) {
      // Breath/bellows chiff at the onset rather than a constant hiss.
      ng.gain.setValueAtTime(timbre.noise, t);
      ng.gain.exponentialRampToValueAtTime(Math.max(0.0001, timbre.noise * 0.08), t + timbre.noiseDecay);
    } else {
      ng.gain.value = timbre.noise;
    }
    src.connect(ng);
    ng.connect(filter);
    src.start(t);
    nodes.push(src);
    chain.push(ng);
  }

  if (timbre.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = timbre.vibrato.rate;
    const depth = ctx.createGain();
    const delay = timbre.vibrato.delay || 0.3;
    depth.gain.setValueAtTime(0, t);
    depth.gain.setValueAtTime(0, t + delay);
    depth.gain.linearRampToValueAtTime(timbre.vibrato.depth, t + delay + 0.25);
    lfo.connect(depth);
    for (const n of nodes) if (n.detune) depth.connect(n.detune);
    lfo.start(t);
    nodes.push(lfo);
    chain.push(depth);
  }

  // Formant peaks add gain in their bands, so compensate or loud notes clip.
  const formantBoost = (timbre.formants || []).reduce((sum, f) => sum + Math.max(0, f.gain ?? 0), 0);
  const makeup = (timbre.outputGain ?? 1) / (1 + formantBoost / 40);
  const peak = Math.max(0.001, gain * 0.28 * makeup);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(peak, t + env.a);

  let stopAt;
  if (decayed) {
    const decayEnd = t + env.a + env.d;
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.02), decayEnd);
    stopAt = Math.min(decayEnd, t + Math.max(duration, env.a + 0.05) + env.r) + 0.02;
    amp.gain.setTargetAtTime(0.0001, Math.max(t + env.a, t + duration), env.r / 3 + 0.02);
  } else {
    amp.gain.linearRampToValueAtTime(Math.max(0.0001, peak * env.s), t + env.a + env.d);
    const rel = Math.max(t + env.a + 0.01, t + duration);
    amp.gain.setValueAtTime(Math.max(0.0001, peak * env.s), rel);
    amp.gain.linearRampToValueAtTime(0.0001, rel + env.r);
    stopAt = rel + env.r + 0.02;
  }

  for (const n of nodes) if (n.stop) n.stop(stopAt);

  return {
    nodes,
    amp,
    stopAt,
    dispose() {
      for (const n of chain) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}

function makeNoise(ctx, seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export const audio = new AudioEngine();

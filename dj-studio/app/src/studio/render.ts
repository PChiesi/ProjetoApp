// Toca e exporta um projeto do Estúdio. O mesmo agendamento serve para ouvir (AudioContext)
// e para gerar o arquivo final (OfflineAudioContext, mais rápido que tempo real).
//
// Cadeia: blocos → [mudo p/ freio/reverse] → passa-alta (subida) → passa-baixa (abafar) → [gate/corte]
//         → master (fades) → saída;  envios de eco e reverb saem depois do gate.

import { barLen, blockLen, blockStarts, projectLength, toSource, type EditProject, type Grid } from './edit';

const SEAM = 0.004; // rampa curtinha em cada emenda: evita estalos
const R = 0.003; // rampa para ligar/desligar efeitos

export interface RenderOpts {
  grid: Grid;
  sound: (id: string) => AudioBuffer | undefined;
}

const reverseCache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();

function reversedSlice(ctx: BaseAudioContext, buf: AudioBuffer, start: number, dur: number): AudioBuffer {
  let m = reverseCache.get(buf);
  if (!m) reverseCache.set(buf, (m = new Map()));
  const key = `${start.toFixed(4)}:${dur.toFixed(4)}`;
  const hit = m.get(key);
  if (hit) return hit;
  const sr = buf.sampleRate;
  const a = Math.floor(start * sr);
  const n = Math.max(1, Math.min(buf.length - a, Math.floor(dur * sr)));
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c);
    const d = out.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = s[a + n - 1 - i];
  }
  m.set(key, out);
  return out;
}

export function impulse(ctx: BaseAudioContext, seconds = 2.4): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let seed = 1234 + c;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
  }
  return b;
}

/** Quanto o áudio final dura (inclui a "cauda" de eco/reverb e sons que passam do fim). */
export function renderLength(p: EditProject, o: RenderOpts): number {
  const total = projectLength(p);
  let end = total;
  for (const f of p.effects) if ((f.type === 'eco' || f.type === 'reverb') && f.t1 >= total - 0.05 && p.fadeOut === 0) end = Math.max(end, total + 2 * barLen(o.grid));
  for (const s of p.sounds) end = Math.max(end, s.at + (o.sound(s.soundId)?.duration ?? 0));
  return end;
}

export function schedule(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  p: EditProject,
  from: number,
  when: number,
  o: RenderOpts,
): AudioScheduledSourceNode[] {
  const total = projectLength(p);
  const beat = 60 / o.grid.bpm;
  const at = (tl: number) => when + (tl - from);
  const clampStart = (tl: number) => at(Math.max(tl, from));

  // ---- nós ----
  const music = ctx.createGain(); // blocos normais
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = 2;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  const gate = ctx.createGain();
  const master = ctx.createGain();
  const ecoSend = ctx.createGain();
  const delay = ctx.createDelay(4);
  const fb = ctx.createGain();
  const revSend = ctx.createGain();
  const conv = ctx.createConvolver();
  const soundBus = ctx.createGain();

  music.connect(hp).connect(lp).connect(gate).connect(master);
  master.connect(dest);
  gate.connect(ecoSend).connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(master);
  delay.delayTime.value = Math.min(3.9, beat * 0.75); // eco pontuado, clássico de saída
  fb.gain.value = 0.48;
  gate.connect(revSend).connect(conv).connect(master);
  conv.buffer = impulse(ctx);
  soundBus.connect(master);

  for (const [param, v] of [
    [music.gain, 1],
    [gate.gain, 1],
    [ecoSend.gain, 0],
    [revSend.gain, 0],
    [hp.frequency, 10],
    [lp.frequency, 22000],
  ] as [AudioParam, number][])
    param.setValueAtTime(v, when);

  // ---- fades da música inteira ----
  const g = master.gain;
  g.setValueAtTime(1, when);
  if (p.fadeIn > 0 && from < p.fadeIn) {
    g.setValueAtTime(from / p.fadeIn, when);
    g.linearRampToValueAtTime(1, at(p.fadeIn));
  }
  if (p.fadeOut > 0) {
    const fs = total - p.fadeOut;
    const startVal = from > fs ? 1 - (from - fs) / p.fadeOut : 1;
    g.setValueAtTime(Math.max(0, startVal), at(Math.max(from, fs)));
    g.linearRampToValueAtTime(0, at(total));
  }

  const sources: AudioScheduledSourceNode[] = [];

  // ---- blocos ----
  const starts = blockStarts(p.blocks);
  p.blocks.forEach((b, i) => {
    const s = starts[i];
    const e = s + blockLen(b);
    if (e <= from + 1e-4) return;
    const inner = Math.max(0, from - s);
    const t0 = at(s + inner);
    const dur = blockLen(b) - inner;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const env = ctx.createGain();
    src.connect(env).connect(music);
    const first = i === 0 || inner > 0;
    const last = i === p.blocks.length - 1;
    env.gain.setValueAtTime(first ? 1 : 0, t0);
    if (!first) env.gain.linearRampToValueAtTime(1, t0 + SEAM);
    if (!last && dur > 2 * SEAM) {
      env.gain.setValueAtTime(1, t0 + dur - SEAM);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
    }
    src.start(t0, b.start + inner, dur);
    sources.push(src);
  });

  // ---- efeitos ----
  const onOff = (param: AudioParam, on: number, off: number, A: number, B: number) => {
    param.setValueAtTime(off, A);
    param.linearRampToValueAtTime(on, A + R);
    param.setValueAtTime(on, B);
    param.linearRampToValueAtTime(off, B + R);
  };
  for (const f of p.effects) {
    if (f.t1 <= from) continue;
    const A = clampStart(f.t0);
    const B = at(f.t1);
    const frac = Math.max(0, (from - f.t0) / (f.t1 - f.t0)); // começou no meio do efeito?
    switch (f.type) {
      case 'eco':
        onOff(ecoSend.gain, 0.85, 0, A, B);
        break;
      case 'reverb':
        onOff(revSend.gain, 0.9, 0, A, B);
        break;
      case 'abafar': {
        lp.frequency.setValueAtTime(22000 * Math.pow(300 / 22000, frac), A);
        lp.frequency.exponentialRampToValueAtTime(300, B);
        lp.frequency.setValueAtTime(22000, B + R);
        break;
      }
      case 'subida': {
        hp.frequency.setValueAtTime(10 * Math.pow(1800 / 10, frac), A);
        hp.frequency.exponentialRampToValueAtTime(1800, B);
        hp.frequency.setValueAtTime(10, B + R);
        break;
      }
      case 'gate': {
        const step = beat / 4;
        const k0 = Math.ceil((Math.max(f.t0, from) - f.t0) / step);
        for (let k = k0; f.t0 + k * step < f.t1 - 1e-4; k++) {
          const t = at(f.t0 + k * step);
          gate.gain.setValueAtTime(1, t);
          gate.gain.setValueAtTime(1, t + step * 0.5 - R);
          gate.gain.linearRampToValueAtTime(0, t + step * 0.5);
          gate.gain.setValueAtTime(0, t + step - R);
          gate.gain.linearRampToValueAtTime(1, t + step);
        }
        gate.gain.setValueAtTime(1, B);
        break;
      }
      case 'corte':
        onOff(gate.gain, 0, 1, A, B);
        break;
      case 'freio':
      case 'reverse': {
        onOff(music.gain, 0, 1, A, B);
        if (from > f.t0) break; // começou no meio: só silencia o trecho
        const src = ctx.createBufferSource();
        const dur = f.t1 - f.t0;
        const srcPos = toSource(p, f.t0);
        if (f.type === 'freio') {
          src.buffer = buffer;
          src.playbackRate.setValueAtTime(1, A);
          src.playbackRate.linearRampToValueAtTime(0.02, B);
          src.start(A, srcPos);
        } else {
          src.buffer = reversedSlice(ctx, buffer, srcPos, dur);
          src.start(A);
        }
        const env = ctx.createGain();
        env.gain.setValueAtTime(1, A);
        env.gain.setValueAtTime(1, B - 0.01);
        env.gain.linearRampToValueAtTime(0, B);
        src.connect(env).connect(hp);
        src.stop(B + 0.01);
        sources.push(src);
        break;
      }
    }
  }

  // ---- sons ----
  for (const e of p.sounds) {
    const buf = o.sound(e.soundId);
    if (!buf || e.at + buf.duration <= from) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gn = ctx.createGain();
    gn.gain.value = e.gain;
    src.connect(gn).connect(soundBus);
    if (e.at >= from) src.start(at(e.at));
    else src.start(when, from - e.at);
    sources.push(src);
  }
  return sources;
}

/** Player do Estúdio (toca no som principal). */
export class StudioPlayer {
  private sources: AudioScheduledSourceNode[] = [];
  private startedAt = 0;
  private from = 0;
  private endAt = 0;
  playing = false;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {}

  play(buffer: AudioBuffer, p: EditProject, from: number, o: RenderOpts, onEnd: () => void) {
    this.stop();
    const when = this.ctx.currentTime + 0.03;
    this.sources = schedule(this.ctx, this.out, buffer, p, from, when, o);
    this.startedAt = when;
    this.from = from;
    this.playing = true;
    this.endAt = when + (renderLength(p, o) - from);
    const check = () => {
      if (!this.playing || this.startedAt !== when) return;
      if (this.ctx.currentTime >= this.endAt) {
        this.stop();
        this.from = 0;
        onEnd();
      } else setTimeout(check, 200);
    };
    setTimeout(check, 200);
  }

  position(): number {
    return this.playing ? this.from + Math.max(0, this.ctx.currentTime - this.startedAt) : this.from;
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* já parou */
      }
      s.disconnect();
    }
    this.sources = [];
    if (this.playing) this.from = this.position();
    this.playing = false;
  }
}

export async function renderProject(buffer: AudioBuffer, p: EditProject, o: RenderOpts): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const len = Math.ceil(renderLength(p, o) * sr);
  const off = new OfflineAudioContext(2, Math.max(1, len), sr);
  schedule(off, off.destination, buffer, p, 0, 0, o);
  return off.startRendering();
}

/** WAV 16 bits (abre em qualquer programa e no próprio Pista). */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

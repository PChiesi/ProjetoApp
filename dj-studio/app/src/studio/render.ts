// Toca e exporta um projeto do Estúdio (multipista). O mesmo agendamento serve para ouvir
// (AudioContext) e para gerar o arquivo final (OfflineAudioContext, mais rápido que tempo real).
//
//   música principal ─▶ [efeitos da principal] ─▶ volume ─┐
//   faixa extra N    ─▶ [efeitos da faixa N]   ─▶ volume ─┼─▶ [efeitos de "Tudo"] ─▶ volume geral + fades ─▶ saída
//   faixa de sons N  ───────────────────────────▶ volume ─┘
//
// Cada cadeia de efeitos: [mudo p/ freio/reverse] → passa-alta (subida) → passa-baixa (abafar) → [picotar/corte]
// com envios de eco e reverb.

import { barLen, blockLen, blockStarts, clipLength, effectiveVolume, projectLength, timelineEnd, toSource, type EditProject, type FxRegion, type Grid } from './edit';

const SEAM = 0.004; // rampa curtinha em cada emenda: evita estalos
const R = 0.003; // rampa para ligar/desligar efeitos

export interface RenderOpts {
  grid: Grid;
  sound: (id: string) => AudioBuffer | undefined;
  /** Áudio de cada faixa extra (já com a parte escolhida: inteira, vocal…). */
  layerAudio?: (layerId: string) => AudioBuffer | undefined;
  /** Cria o corretor de tom (key lock) — se o navegador tiver. */
  pitch?: (ctx: BaseAudioContext) => AudioWorkletNode;
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

/** Em que cada região de efeito age (pela faixa de efeitos onde está). */
function targetOf(p: EditProject, f: FxRegion): string {
  return p.fxLanes.find((l) => l.id === f.lane)?.target ?? 'main';
}

/** Quanto o áudio final dura (inclui a "cauda" de eco/reverb e sons/faixas que passam do fim). */
export function renderLength(p: EditProject, o: RenderOpts): number {
  const end = timelineEnd(p, o.grid, (id) => o.sound(id)?.duration ?? 0);
  let out = end;
  for (const f of p.effects) if ((f.type === 'eco' || f.type === 'reverb') && f.t1 >= end - 0.05 && p.fadeOut === 0) out = Math.max(out, end + 2 * barLen(o.grid));
  return out;
}

interface Timing {
  from: number;
  when: number;
  at: (tl: number) => number;
  beat: number;
}

/**
 * Cadeia de efeitos de uma faixa. `main` dá acesso ao áudio da música principal
 * (necessário para "Freio" e "Ao contrário", que tocam o próprio trecho).
 */
function fxChain(ctx: BaseAudioContext, regions: FxRegion[], tm: Timing, sources: AudioScheduledSourceNode[], main?: { buffer: AudioBuffer; p: EditProject }) {
  const { from, when, at, beat } = tm;
  const clampStart = (tl: number) => at(Math.max(tl, from));
  const music = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = 2;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  const gate = ctx.createGain();
  const out = ctx.createGain();
  music.connect(hp).connect(lp).connect(gate).connect(out);
  const needEco = regions.some((f) => f.type === 'eco');
  const needRev = regions.some((f) => f.type === 'reverb');
  let ecoSend: GainNode | null = null;
  let revSend: GainNode | null = null;
  if (needEco) {
    ecoSend = ctx.createGain();
    const delay = ctx.createDelay(4);
    const fb = ctx.createGain();
    gate.connect(ecoSend).connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(out);
    delay.delayTime.value = Math.min(3.9, beat * 0.75); // eco pontuado, clássico de saída
    fb.gain.value = 0.48;
  }
  if (needRev) {
    revSend = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx);
    gate.connect(revSend).connect(conv).connect(out);
  }
  const init: [AudioParam | undefined, number][] = [
    [music.gain, 1],
    [gate.gain, 1],
    [ecoSend?.gain, 0],
    [revSend?.gain, 0],
    [hp.frequency, 10],
    [lp.frequency, 22000],
  ];
  for (const [param, v] of init) param?.setValueAtTime(v, when);

  const onOff = (param: AudioParam, on: number, off: number, A: number, B: number) => {
    param.setValueAtTime(off, A);
    param.linearRampToValueAtTime(on, A + R);
    param.setValueAtTime(on, B);
    param.linearRampToValueAtTime(off, B + R);
  };
  for (const f of regions) {
    if (f.t1 <= from) continue;
    const A = clampStart(f.t0);
    const B = at(f.t1);
    const frac = Math.max(0, (from - f.t0) / (f.t1 - f.t0)); // começou no meio do efeito?
    switch (f.type) {
      case 'eco':
        if (ecoSend) onOff(ecoSend.gain, 0.85, 0, A, B);
        break;
      case 'reverb':
        if (revSend) onOff(revSend.gain, 0.9, 0, A, B);
        break;
      case 'abafar':
        lp.frequency.setValueAtTime(22000 * Math.pow(300 / 22000, frac), A);
        lp.frequency.exponentialRampToValueAtTime(300, B);
        lp.frequency.setValueAtTime(22000, B + R);
        break;
      case 'subida':
        hp.frequency.setValueAtTime(10 * Math.pow(1800 / 10, frac), A);
        hp.frequency.exponentialRampToValueAtTime(1800, B);
        hp.frequency.setValueAtTime(10, B + R);
        break;
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
        if (!main) {
          // Fora da música principal: o "freio" vira um fechamento rápido (abafa e some); "ao contrário" vira corte
          if (f.type === 'freio') {
            lp.frequency.setValueAtTime(22000, A);
            lp.frequency.exponentialRampToValueAtTime(120, B);
            lp.frequency.setValueAtTime(22000, B + R);
            gate.gain.setValueAtTime(1, A);
            gate.gain.linearRampToValueAtTime(0, B);
            gate.gain.setValueAtTime(1, B + R);
          } else onOff(gate.gain, 0, 1, A, B);
          break;
        }
        onOff(music.gain, 0, 1, A, B);
        if (from > f.t0) break; // começou no meio: só silencia o trecho
        const src = ctx.createBufferSource();
        const dur = f.t1 - f.t0;
        const srcPos = toSource(main.p, f.t0);
        if (f.type === 'freio') {
          src.buffer = main.buffer;
          src.playbackRate.setValueAtTime(1, A);
          src.playbackRate.linearRampToValueAtTime(0.02, B);
          src.start(A, srcPos);
        } else {
          src.buffer = reversedSlice(ctx, main.buffer, srcPos, dur);
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
  return { input: music as AudioNode, output: out as AudioNode };
}

export interface Scheduled {
  sources: AudioScheduledSourceNode[];
  /** Nós que precisam ser desligados ao parar (key lock dos trechos). */
  nodes: AudioNode[];
}

export function schedule(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  p: EditProject,
  from: number,
  when: number,
  o: RenderOpts,
): Scheduled {
  const total = projectLength(p);
  const end = timelineEnd(p, o.grid, (id) => o.sound(id)?.duration ?? 0);
  const tm: Timing = { from, when, at: (tl: number) => when + (tl - from), beat: 60 / o.grid.bpm };
  const at = tm.at;
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];
  const regionsFor = (target: string) => p.effects.filter((f) => targetOf(p, f) === target);

  // ---- saída: efeitos de "Tudo" → volume geral com fades ----
  const master = ctx.createGain();
  master.connect(dest);
  const mixChain = fxChain(ctx, regionsFor('mix'), tm, sources);
  mixChain.output.connect(master);
  const mixBus = mixChain.input;

  const g = master.gain;
  const vol = p.master ?? 1;
  g.setValueAtTime(vol, when);
  if (p.fadeIn > 0 && from < p.fadeIn) {
    g.setValueAtTime((from / p.fadeIn) * vol, when);
    g.linearRampToValueAtTime(vol, at(p.fadeIn));
  }
  if (p.fadeOut > 0) {
    // o fade acompanha o fim da música principal
    const fs = total - p.fadeOut;
    const startVal = from > fs ? 1 - (from - fs) / p.fadeOut : 1;
    g.setValueAtTime(Math.max(0, startVal) * vol, at(Math.max(from, fs)));
    g.linearRampToValueAtTime(0, at(total));
    if (end > total) g.setValueAtTime(0, at(total) + 0.001);
  }

  // ---- música principal ----
  const mainChain = fxChain(ctx, regionsFor('main'), tm, sources, { buffer, p });
  const mainVol = ctx.createGain();
  mainVol.gain.value = effectiveVolume(p, p.main);
  mainChain.output.connect(mainVol).connect(mixBus);
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
    src.connect(env).connect(mainChain.input);
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

  // ---- faixas extras (outras músicas), no BPM do projeto e sem mudar o tom ----
  for (const l of p.layers) {
    const audio = o.layerAudio?.(l.id);
    if (!audio || !l.clips.length) continue;
    const chain = fxChain(ctx, regionsFor(l.id), tm, sources);
    const lv = ctx.createGain();
    lv.gain.value = effectiveVolume(p, l);
    chain.output.connect(lv).connect(mixBus);
    for (const c of l.clips) {
      const len = clipLength(c, l.rate);
      if (c.at + len <= from + 1e-4) continue;
      const inner = Math.max(0, from - c.at);
      const t0 = at(c.at + inner);
      const src = ctx.createBufferSource();
      src.buffer = audio;
      src.playbackRate.value = l.rate;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(c.gain, t0 + SEAM);
      env.gain.setValueAtTime(c.gain, t0 + len - inner - SEAM);
      env.gain.linearRampToValueAtTime(0, t0 + len - inner);
      let head: AudioNode = src;
      if (Math.abs(l.rate - 1) > 1e-3 && o.pitch) {
        try {
          const ps = o.pitch(ctx);
          ps.parameters.get('pitch')!.value = 1 / l.rate;
          head = src.connect(ps);
          nodes.push(ps);
        } catch {
          /* sem key lock: o tom acompanha a velocidade */
        }
      }
      head.connect(env).connect(chain.input);
      src.start(t0, c.start + inner * l.rate);
      src.stop(t0 + len - inner + 0.01);
      sources.push(src);
    }
  }

  // ---- sons, por faixa de sons ----
  const laneVol = new Map<string, GainNode>();
  for (const ln of p.soundLanes) {
    const gn = ctx.createGain();
    gn.gain.value = effectiveVolume(p, ln);
    gn.connect(mixBus);
    laneVol.set(ln.id, gn);
  }
  for (const e of p.sounds) {
    const buf = o.sound(e.soundId);
    if (!buf || e.at + buf.duration <= from) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gn = ctx.createGain();
    gn.gain.value = e.gain;
    src.connect(gn).connect(laneVol.get(e.lane) ?? laneVol.values().next().value ?? mixBus);
    if (e.at >= from) src.start(at(e.at));
    else src.start(when, from - e.at);
    sources.push(src);
  }
  return { sources, nodes };
}

/** Player do Estúdio (toca no som principal). */
export class StudioPlayer {
  private sched: Scheduled = { sources: [], nodes: [] };
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
    this.sched = schedule(this.ctx, this.out, buffer, p, from, when, o);
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
    for (const s of this.sched.sources) {
      try {
        s.stop();
      } catch {
        /* já parou */
      }
      s.disconnect();
    }
    for (const n of this.sched.nodes) n.disconnect();
    this.sched = { sources: [], nodes: [] };
    if (this.playing) this.from = this.position();
    this.playing = false;
  }
}

export async function renderProject(buffer: AudioBuffer, p: EditProject, o: RenderOpts): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const len = Math.ceil(renderLength(p, o) * sr);
  const off = new OfflineAudioContext(2, Math.max(1, len), sr);
  let pitch: RenderOpts['pitch'];
  if (p.layers.some((l) => Math.abs(l.rate - 1) > 1e-3)) {
    const { loadKeyLock, createShifter } = await import('../audio/keylock');
    if (await loadKeyLock(off)) pitch = (c) => createShifter(c, true);
  }
  schedule(off, off.destination, buffer, p, 0, 0, { ...o, pitch });
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

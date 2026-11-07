// Toca e exporta um projeto do Estúdio. O mesmo agendamento serve para ouvir (AudioContext)
// e para gerar o arquivo final (OfflineAudioContext, mais rápido que tempo real).

import { blockLen, blockStarts, projectLength, type EditProject } from './edit';

const SEAM = 0.004; // rampa curtinha em cada emenda: evita estalos

export function schedule(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  p: EditProject,
  from: number,
  when: number,
): AudioBufferSourceNode[] {
  const total = projectLength(p);
  const master = ctx.createGain();
  master.connect(dest);
  const at = (tl: number) => when + (tl - from);

  // Fades da música inteira
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

  const starts = blockStarts(p.blocks);
  const sources: AudioBufferSourceNode[] = [];
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
    src.connect(env).connect(master);
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
  return sources;
}

/** Player do Estúdio (toca no som principal). */
export class StudioPlayer {
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private from = 0;
  playing = false;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {}

  play(buffer: AudioBuffer, p: EditProject, from: number, onEnd: () => void) {
    this.stop();
    const when = this.ctx.currentTime + 0.03;
    this.sources = schedule(this.ctx, this.out, buffer, p, from, when);
    this.startedAt = when;
    this.from = from;
    this.playing = true;
    const last = this.sources[this.sources.length - 1];
    if (last)
      last.onended = () => {
        if (this.sources.includes(last)) {
          this.playing = false;
          onEnd();
        }
      };
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

  setFrom(t: number) {
    this.from = t;
  }
}

export async function renderProject(buffer: AudioBuffer, p: EditProject): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const len = Math.ceil(projectLength(p) * sr);
  const off = new OfflineAudioContext(buffer.numberOfChannels, Math.max(1, len), sr);
  schedule(off, off.destination, buffer, p, 0, 0);
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

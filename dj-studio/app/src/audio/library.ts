// Carrega músicas (demo ou arquivos dela) e roda a análise.
import { computeWaveform, detectTempo } from './analysis';
import { detectKey } from './key';
import { DEMOS, demoSections, renderDemo, type DemoSpec } from './demoTracks';
import { detectSections, type Section } from '../studio/edit';
import type { Track } from './engine';

/** Volume percebido aproximado (RMS das partes com som) → ganho para o alvo. */
export function autoGainFor(data: Float32Array, sampleRate: number): number {
  const win = Math.round(sampleRate * 0.4);
  const levels: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j += 4) s += data[j] * data[j];
    levels.push(Math.sqrt(s / (win / 4)));
  }
  if (!levels.length) return 0;
  levels.sort((a, b) => a - b);
  // Partes altas da música (percentil 80) definem o volume — ignora silêncios e intros.
  const loud = levels[Math.floor(levels.length * 0.8)] || 1e-6;
  const db = 20 * Math.log10(0.2 / loud);
  return Math.max(-9, Math.min(9, Math.round(db * 10) / 10));
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Mixa para mono e reduz a taxa (análise mais rápida). */
function toMono(buf: AudioBuffer, factor: number): { data: Float32Array; sr: number } {
  const n = Math.floor(buf.length / factor);
  const out = new Float32Array(n);
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of chs) for (let k = 0; k < factor; k++) s += c[i * factor + k];
    out[i] = s / (chs.length * factor);
  }
  return { data: out, sr: buf.sampleRate / factor };
}

export async function loadDemo(ctx: AudioContext, spec: DemoSpec): Promise<Track> {
  await nextFrame();
  const sr = ctx.sampleRate;
  const mono = renderDemo(spec, sr);
  const buffer = ctx.createBuffer(2, mono.length, sr);
  buffer.copyToChannel(mono, 0);
  buffer.copyToChannel(mono, 1);
  await nextFrame();
  const waveform = computeWaveform(mono, sr);
  return {
    id: spec.id,
    title: spec.title,
    artist: spec.artist,
    genre: spec.genre,
    bpm: spec.bpm,
    firstBeat: 0, // conhecido: as demos começam exatamente na batida
    key: spec.key,
    duration: buffer.duration,
    confidence: 1,
    buffer,
    waveform,
    demo: true,
    hotCues: new Array(8).fill(null),
    autoGainDb: autoGainFor(mono, sr),
    sections: demoSectionsFor(spec).map((x) => ({ ...x, end: Math.min(x.end, buffer.duration) })),
  };
}

function demoSectionsFor(spec: DemoSpec): Section[] {
  const beat = 60 / spec.bpm;
  const list = demoSections();
  return list.map((x, i) => ({
    start: x.startBeat * beat,
    end: i === list.length - 1 ? Infinity : (x.startBeat + x.bars * 4) * beat,
    kind: x.name === 'Intro' ? 'intro' : x.name === 'Outro' ? 'outro' : x.name === 'Breakdown' ? 'break' : 'parte',
    name: x.name,
  }));
}

/** Cria uma faixa da biblioteca a partir de áudio gerado (ex.: exportado pelo Estúdio). */
export function trackFromBuffer(buffer: AudioBuffer, base: Track, title: string, sections: Section[]): Track {
  const { data, sr } = toMono(buffer, 2);
  return {
    id: `edit-${Date.now()}`,
    title,
    artist: base.artist,
    genre: base.genre,
    bpm: base.bpm,
    firstBeat: base.firstBeat, // os cortes no grid preservam o ritmo
    key: base.key,
    duration: buffer.duration,
    confidence: base.confidence,
    buffer,
    waveform: computeWaveform(data, sr),
    demo: false,
    hotCues: new Array(8).fill(null),
    autoGainDb: autoGainFor(data, sr),
    sections,
  };
}

export async function loadAllDemos(ctx: AudioContext): Promise<Track[]> {
  const out: Track[] = [];
  for (const d of DEMOS) out.push(await loadDemo(ctx, d));
  return out;
}

let fileCounter = 0;

export async function loadFile(ctx: AudioContext, file: File): Promise<Track> {
  const bytes = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(bytes);
  await nextFrame();
  const factor = buffer.sampleRate >= 88000 ? 4 : 2;
  const { data, sr } = toMono(buffer, factor);
  const waveform = computeWaveform(data, sr);
  await nextFrame();
  // Analisa no máximo os 4 primeiros minutos (suficiente e rápido).
  const slice = data.subarray(0, Math.min(data.length, sr * 240));
  const tempo = detectTempo(slice, sr);
  await nextFrame();
  const key = detectKey(data.subarray(0, Math.min(data.length, sr * 150)), sr);
  const name = file.name.replace(/\.[^.]+$/, '');
  const [artist, title] = name.includes(' - ') ? name.split(' - ', 2) : ['', name];
  return {
    id: `file-${++fileCounter}-${name}`,
    title: title.trim(),
    artist: artist.trim() || 'Minha música',
    bpm: tempo.bpm,
    firstBeat: tempo.firstBeat,
    key: key?.camelot ?? null,
    duration: buffer.duration,
    confidence: tempo.confidence,
    buffer,
    source: file,
    waveform,
    demo: false,
    hotCues: new Array(8).fill(null),
    autoGainDb: autoGainFor(data, sr),
    sections: detectSections(waveform, tempo, buffer.duration),
  };
}

export const AUDIO_ACCEPT = '.mp3,.wav,.flac,.ogg,.m4a,.aac,audio/*';

/** Garante o áudio decodificado (músicas salvas só são decodificadas quando usadas). */
export async function ensureBuffer(ctx: AudioContext, t: Track): Promise<AudioBuffer> {
  if (t.buffer) return t.buffer;
  if (!t.source) throw new Error('sem áudio');
  t.buffer = await ctx.decodeAudioData(await t.source.arrayBuffer());
  return t.buffer;
}

// Carrega músicas (demo ou arquivos dela) e roda a análise.
import { computeWaveform, detectTempo } from './analysis';
import { DEMOS, renderDemo, type DemoSpec } from './demoTracks';
import type { Track } from './engine';

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
  const name = file.name.replace(/\.[^.]+$/, '');
  const [artist, title] = name.includes(' - ') ? name.split(' - ', 2) : ['', name];
  return {
    id: `file-${++fileCounter}-${name}`,
    title: title.trim(),
    artist: artist.trim() || 'Minha música',
    bpm: tempo.bpm,
    firstBeat: tempo.firstBeat,
    key: null,
    duration: buffer.duration,
    confidence: tempo.confidence,
    buffer,
    waveform,
    demo: false,
  };
}

export const AUDIO_ACCEPT = '.mp3,.wav,.flac,.ogg,.m4a,.aac,audio/*';

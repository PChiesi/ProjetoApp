// Separação em stems (vocal, batida, baixo, melodia) com o modelo HTDemucs (Meta, licença MIT),
// rodando no próprio computador via ONNX Runtime (WebGPU quando há placa de vídeo, senão WASM).
// - O modelo (~172 MB) é baixado uma vez e fica guardado no app.
// - Os stems de cada música ficam salvos: separar é feito uma vez só por música.

import { CONSTANTS, DemucsProcessor } from 'demucs-web';
import { STEM_IDS, type StemId, type StemSet, type Track } from './engine';
import { del, getOne, put } from '../storage/db';
import { encodeWav } from '../studio/render';

const ORT_VERSION = '1.31.1';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const MODEL_URL: string = CONSTANTS.DEFAULT_MODEL_URL;
const MODEL_KEY = 'htdemucs-v4';
const SR = 44100;

export type StemStatus =
  | { phase: 'baixando'; loaded: number; total: number }
  | { phase: 'preparando' }
  | { phase: 'separando'; progress: number; device: string }
  | { phase: 'salvando' };

type Ort = {
  env: { wasm: { wasmPaths: string; numThreads: number }; logLevel?: string };
  InferenceSession: unknown;
  Tensor: unknown;
};

let ortP: Promise<Ort> | null = null;
function loadOrt(): Promise<Ort> {
  if (!ortP) {
    ortP = (import(/* @vite-ignore */ `${ORT_CDN}ort.webgpu.min.mjs`) as Promise<Ort>).then((ort) => {
      ort.env.wasm.wasmPaths = ORT_CDN;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      ort.env.logLevel = 'error';
      return ort;
    });
    ortP.catch(() => (ortP = null));
  }
  return ortP;
}

export const hasWebGpu = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

/** Modelo: do cache local ou da internet (com progresso). */
async function getModel(onStatus: (s: StemStatus) => void): Promise<ArrayBuffer> {
  const cached = await getOne<{ id: string; data: ArrayBuffer }>('models', MODEL_KEY);
  if (cached?.data) return cached.data;
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`download do modelo falhou (${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || 172_000_000;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - last > 1_000_000) {
      last = loaded;
      onStatus({ phase: 'baixando', loaded, total });
    }
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  await put('models', { id: MODEL_KEY, data: buf.buffer });
  return buf.buffer;
}

export async function modelCached(): Promise<boolean> {
  const m = await getOne<{ id: string }>('models', MODEL_KEY);
  return !!m;
}

let proc: DemucsProcessor | null = null;
let device = 'cpu';
let progressCb: (p: number) => void = () => {};

async function getProcessor(onStatus: (s: StemStatus) => void): Promise<DemucsProcessor> {
  if (proc) return proc;
  const ort = await loadOrt();
  const model = await getModel(onStatus);
  onStatus({ phase: 'preparando' });
  const make = async (eps: string[]) => {
    const p = new DemucsProcessor({
      ort,
      sessionOptions: { executionProviders: eps, graphOptimizationLevel: 'basic' },
      onProgress: (x) => progressCb(x.progress),
    });
    await p.loadModel(model);
    return p;
  };
  if (hasWebGpu()) {
    try {
      proc = await make(['webgpu']);
      device = 'placa de vídeo';
      return proc;
    } catch {
      /* sem WebGPU utilizável: usa o processador */
    }
  }
  proc = await make(['wasm']);
  device = 'processador';
  return proc;
}

/** Converte a música para 44,1 kHz estéreo (o que o modelo espera). */
async function to44k(buf: AudioBuffer): Promise<AudioBuffer> {
  if (buf.sampleRate === SR && buf.numberOfChannels === 2) return buf;
  const off = new OfflineAudioContext(2, Math.ceil(buf.duration * SR), SR);
  const s = off.createBufferSource();
  s.buffer = buf;
  s.connect(off.destination);
  s.start();
  return off.startRendering();
}

/** Separa a música em 4 partes e salva. */
export async function separateTrack(ctx: BaseAudioContext, t: Track, onStatus: (s: StemStatus) => void): Promise<StemSet> {
  if (!t.buffer) throw new Error('áudio não carregado');
  const p = await getProcessor(onStatus);
  const src = await to44k(t.buffer);
  progressCb = (x) => onStatus({ phase: 'separando', progress: x, device });
  onStatus({ phase: 'separando', progress: 0, device });
  const r = await p.separate(src.getChannelData(0), src.getChannelData(1));
  onStatus({ phase: 'salvando' });
  const set = {} as StemSet;
  const rec: Record<string, unknown> = { id: t.id };
  for (const k of STEM_IDS) {
    const b = ctx.createBuffer(2, r[k].left.length, SR);
    b.copyToChannel(r[k].left, 0);
    b.copyToChannel(r[k].right, 1);
    set[k] = b;
    rec[k] = encodeWav(b);
  }
  await put('stems', rec);
  return set;
}

/** Stems já separados desta música (ou null). */
export async function loadStems(ctx: BaseAudioContext, trackId: string): Promise<StemSet | null> {
  const rec = await getOne<Record<StemId, Blob> & { id: string }>('stems', trackId);
  if (!rec) return null;
  const set = {} as StemSet;
  for (const k of STEM_IDS) set[k] = await ctx.decodeAudioData(await rec[k].arrayBuffer());
  return set;
}

export async function hasStems(trackId: string): Promise<boolean> {
  return !!(await getOne('stems', trackId));
}

export const removeStems = (trackId: string) => del('stems', trackId);

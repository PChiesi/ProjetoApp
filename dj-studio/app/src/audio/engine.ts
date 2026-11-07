// Motor de áudio: 2 decks, mixer com EQ/filtro, crossfader, limitador, medidores e gravação.
// Não depende de React: a interface só chama métodos e lê o estado.

import { beatPhase, phaseDelta, syncRate, type Grid } from './beat';
import type { Waveform } from './analysis';
import type { Section } from '../studio/edit';
import { createShifter, loadKeyLock } from './keylock';

export type DeckId = 'A' | 'B';

export interface Track {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  bpm: number;
  firstBeat: number;
  key: string | null;
  duration: number;
  confidence: number;
  buffer: AudioBuffer;
  waveform: Waveform;
  demo: boolean;
  /** 8 hot cues (segundos) — ficam guardados na música. */
  hotCues: (number | null)[];
  /** Ajuste para deixar todas as músicas no mesmo volume. */
  autoGainDb: number;
  /** Partes da música (intro, breakdown, outro…), em frases de 8 compassos. */
  sections: Section[];
}

export interface Loop {
  start: number;
  end: number;
  beats: number;
}

export const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

type Listener = () => void;

class Channel {
  readonly input: GainNode; // ganho (trim)
  readonly low: BiquadFilterNode;
  readonly mid: BiquadFilterNode;
  readonly high: BiquadFilterNode;
  readonly filter: BiquadFilterNode;
  readonly fader: GainNode;
  readonly xfade: GainNode;
  readonly meter: AnalyserNode;
  private meterBuf = new Float32Array(1024);

  constructor(ctx: AudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 250;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.7;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 4000;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 22000;
    this.filter.Q.value = 0.9;
    this.fader = ctx.createGain();
    this.xfade = ctx.createGain();
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.input.connect(this.low).connect(this.mid).connect(this.high).connect(this.filter).connect(this.fader);
    this.fader.connect(this.meter);
    this.fader.connect(this.xfade).connect(out);
  }

  peak(): number {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) p = Math.max(p, Math.abs(this.meterBuf[i]));
    return p;
  }
}

export class Deck {
  track: Track | null = null;
  playing = false;
  /** Tempo: -1..1 representando ±range. */
  tempo = 0;
  range = 0.08;
  cuePoint = 0;
  synced = false;
  loop: Loop | null = null;
  /** Quantize: cues, loops e saltos caem sempre na batida. */
  quantize = true;
  /** Key lock: o tom não muda quando o BPM muda. */
  keyLock = true;
  /** Pitch shifter do key lock (fica entre a música e o canal). */
  shifter: AudioWorkletNode | null = null;
  private offset = 0; // posição (s da música) no último "âncora"
  private anchor = 0; // ctx.currentTime do último âncora
  private rate = 1;
  private nudgeFactor = 1;
  private source: AudioBufferSourceNode | null = null;

  constructor(
    readonly id: DeckId,
    private ctx: AudioContext,
    readonly channel: Channel,
    private changed: () => void,
  ) {}

  get bpm(): number {
    return this.track ? this.track.bpm * this.rate : 0;
  }
  get playbackRate(): number {
    return this.rate * this.nudgeFactor;
  }
  get grid(): Grid | null {
    return this.track ? { bpm: this.track.bpm, firstBeat: this.track.firstBeat } : null;
  }

  position(): number {
    if (!this.playing) return this.offset;
    let p = this.offset + (this.ctx.currentTime - this.anchor) * this.playbackRate;
    const l = this.loop;
    if (l && p > l.end) p = l.start + ((p - l.start) % (l.end - l.start));
    return this.track ? Math.min(p, this.track.duration) : p;
  }

  private beatLen(): number {
    return 60 / (this.track?.bpm || 120);
  }

  /** Encaixa um tempo na batida (se o quantize estiver ligado). */
  snap(t: number, mode: 'round' | 'floor' = 'round'): number {
    if (!this.track || !this.quantize) return t;
    const b = this.beatLen();
    const f = this.track.firstBeat;
    const n = mode === 'floor' ? Math.floor((t - f) / b + 1e-6) : Math.round((t - f) / b);
    return Math.max(0, f + n * b);
  }

  // ---------- hot cues ----------

  /** Pad vazio: marca aqui. Pad marcado: pula para lá (mantendo o ritmo, se tocando). */
  hotCue(i: number) {
    const t = this.track;
    if (!t) return;
    const cur = t.hotCues[i];
    if (cur == null) {
      t.hotCues[i] = this.snap(this.position());
      this.changed();
      return;
    }
    let target = cur;
    if (this.playing && this.quantize) {
      // Leva junto a distância desde a última batida: o salto não "tropeça" e o sync continua.
      const pos = this.position();
      target = cur + (pos - this.snap(pos, 'floor'));
    }
    this.seek(target);
  }

  clearHotCue(i: number) {
    if (!this.track) return;
    this.track.hotCues[i] = null;
    this.changed();
  }

  // ---------- loops ----------

  /** Liga um loop de N batidas a partir da batida atual (mesmo tamanho de novo = desliga). */
  autoLoop(beats: number) {
    if (!this.track) return;
    if (this.loop && Math.abs(this.loop.beats - beats) < 1e-9) {
      this.exitLoop();
      return;
    }
    const pos = this.position();
    const start = this.loop ? this.loop.start : this.snap(pos, 'floor');
    this.setLoop(start, beats, pos);
  }

  resizeLoop(factor: 0.5 | 2) {
    if (!this.loop) return;
    const beats = Math.min(32, Math.max(0.25, this.loop.beats * factor));
    this.setLoop(this.loop.start, beats, this.position());
  }

  private setLoop(start: number, beats: number, pos: number) {
    const end = Math.min(this.track!.duration, start + beats * this.beatLen());
    this.loop = { start, end, beats };
    let moved = false;
    if (pos > end || pos < start) {
      const len = end - start;
      pos = start + ((((pos - start) % len) + len) % len);
      moved = true;
    }
    if (this.playing && this.source) {
      this.offset = pos;
      this.anchor = this.ctx.currentTime;
      const curr = this.source;
      curr.loopStart = start;
      curr.loopEnd = end;
      curr.loop = true;
      // Encolher o loop pode deixar a agulha fora dele: reinicia no ponto certo.
      if (moved) this.restartAt(pos);
    } else {
      this.offset = pos;
    }
    this.changed();
  }

  private restartAt(pos: number) {
    this.stopSource();
    this.startSource(pos);
  }

  exitLoop() {
    if (!this.loop) return;
    if (this.playing) {
      this.offset = this.position();
      this.anchor = this.ctx.currentTime;
      if (this.source) this.source.loop = false;
    }
    this.loop = null;
    this.changed();
  }

  load(track: Track) {
    this.stopSource();
    this.track = track;
    this.playing = false;
    this.tempo = 0;
    this.rate = 1;
    this.synced = false;
    this.loop = null;
    this.cuePoint = track.firstBeat;
    this.offset = track.firstBeat;
    this.changed();
  }

  play() {
    if (!this.track || this.playing) return;
    if (this.offset >= this.track.duration - 0.05) this.offset = this.cuePoint;
    this.startSource(this.offset);
    this.playing = true;
    this.changed();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this.stopSource();
    this.playing = false;
    this.changed();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** CUE estilo CDJ: tocando → volta ao ponto e para; parado → marca o ponto aqui (alinhado à batida). */
  cue() {
    if (!this.track) return;
    if (this.playing) {
      this.pause();
      this.offset = this.cuePoint;
    } else {
      const g = this.grid!;
      const beat = 60 / g.bpm;
      const n = Math.round((this.offset - g.firstBeat) / beat);
      this.cuePoint = Math.max(0, g.firstBeat + n * beat);
      this.offset = this.cuePoint;
    }
    this.changed();
  }

  seek(t: number) {
    if (!this.track) return;
    t = Math.max(0, Math.min(this.track.duration - 0.01, t));
    if (this.loop && (t < this.loop.start || t >= this.loop.end)) this.loop = null; // saiu do loop
    if (this.playing) {
      this.stopSource();
      this.startSource(t);
    } else {
      this.offset = t;
    }
    this.changed();
  }

  setTempo(v: number) {
    this.tempo = Math.max(-1, Math.min(1, v));
    this.applyRate(1 + this.tempo * this.range);
  }

  setRange(r: number) {
    const rate = this.rate;
    this.range = r;
    this.tempo = Math.max(-1, Math.min(1, (rate - 1) / r));
    this.applyRate(1 + this.tempo * r);
  }

  /** Ajusta a taxa diretamente (usado pelo SYNC). */
  applyRate(rate: number) {
    if (this.playing) {
      this.offset = this.position();
      this.anchor = this.ctx.currentTime;
    }
    this.rate = rate;
    this.tempo = Math.max(-1, Math.min(1, (rate - 1) / this.range));
    if (this.source) this.source.playbackRate.setTargetAtTime(this.playbackRate, this.ctx.currentTime, 0.01);
    this.updatePitch();
    this.changed();
  }

  /** Empurrar/segurar o "prato": acelera ou freia um pouco enquanto pressionado. */
  nudge(dir: -1 | 0 | 1) {
    if (this.playing) {
      this.offset = this.position();
      this.anchor = this.ctx.currentTime;
    }
    this.nudgeFactor = 1 + dir * 0.04;
    if (this.source) this.source.playbackRate.setTargetAtTime(this.playbackRate, this.ctx.currentTime, 0.005);
    this.updatePitch();
  }

  setKeyLock(on: boolean) {
    this.keyLock = on;
    this.updatePitch();
    this.changed();
  }

  /** Liga o pitch shifter (chamado pelo motor quando o AudioWorklet carrega). */
  attachShifter(node: AudioWorkletNode) {
    this.shifter = node;
    node.connect(this.channel.input);
    if (this.source) {
      this.source.disconnect();
      this.source.connect(node);
    }
    this.updatePitch();
  }

  private updatePitch() {
    if (!this.shifter) return;
    const p = this.keyLock ? 1 / this.playbackRate : 1;
    this.shifter.parameters.get('pitch')!.setValueAtTime(Math.max(0.5, Math.min(2, p)), this.ctx.currentTime);
  }

  /** Move a música em batidas (para corrigir o grid ou pular). */
  beatJump(beats: number) {
    if (!this.track) return;
    this.seek(this.position() + (beats * 60) / this.track.bpm);
  }

  /** Corrige o grid (BPM ×2/÷2, ou desloca a primeira batida). */
  adjustGrid(change: { bpmFactor?: number; shiftBeats?: number }) {
    if (!this.track) return;
    const t = this.track;
    if (change.bpmFactor) t.bpm = Math.round(t.bpm * change.bpmFactor * 100) / 100;
    if (change.shiftBeats) {
      const beat = 60 / t.bpm;
      t.firstBeat += change.shiftBeats * beat;
      while (t.firstBeat < 0) t.firstBeat += 4 * beat;
    }
    this.changed();
  }

  private startSource(at: number) {
    if (!this.track) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.playbackRate.value = this.playbackRate;
    if (this.loop) {
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
      src.loop = true;
    }
    src.connect(this.shifter ?? this.channel.input);
    src.onended = () => {
      if (this.source === src) {
        this.offset = this.track?.duration ?? 0;
        this.source = null;
        this.playing = false;
        this.changed();
      }
    };
    src.start(0, at);
    this.source = src;
    this.offset = at;
    this.anchor = this.ctx.currentTime;
  }

  private stopSource() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      try {
        s.stop();
      } catch {
        /* já parado */
      }
      s.disconnect();
    }
  }
}

export interface MixerState {
  gain: Record<DeckId, number>; // dB -12..+12
  low: Record<DeckId, number>; // dB -26..+6 (mínimo = corte total)
  mid: Record<DeckId, number>;
  high: Record<DeckId, number>;
  filter: Record<DeckId, number>; // -1 (passa-baixa) .. 0 .. 1 (passa-alta)
  volume: Record<DeckId, number>; // 0..1
  crossfader: number; // -1 (A) .. 1 (B)
  master: number; // 0..1
}

const both = (v: number): Record<DeckId, number> => ({ A: v, B: v });

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly decks: Record<DeckId, Deck>;
  readonly mix: MixerState = {
    gain: both(0),
    low: both(0),
    mid: both(0),
    high: both(0),
    filter: both(0),
    volume: both(0.8),
    crossfader: -1,
    master: 0.85,
  };
  /** Iguala o volume das músicas automaticamente. */
  autoGain = true;
  private bus: GainNode;
  private limiter: DynamicsCompressorNode;
  private masterGain: GainNode;
  private masterMeter: AnalyserNode;
  private busMeter: AnalyserNode;
  private recDest: MediaStreamAudioDestinationNode;
  /** Saída do Estúdio (passa pelo limitador e entra na gravação). */
  readonly studioOut: GainNode;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  recordingSince: number | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private meterBuf = new Float32Array(1024);

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.bus = this.ctx.createGain();
    this.busMeter = this.ctx.createAnalyser();
    this.busMeter.fftSize = 1024;
    // Limitador: impede que o som estoure nas caixas mesmo se ela exagerar no volume.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.masterGain = this.ctx.createGain();
    this.masterMeter = this.ctx.createAnalyser();
    this.masterMeter.fftSize = 1024;
    this.recDest = this.ctx.createMediaStreamDestination();
    this.bus.connect(this.busMeter);
    this.bus.connect(this.limiter).connect(this.masterGain);
    this.masterGain.connect(this.masterMeter);
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.connect(this.recDest);

    this.studioOut = this.ctx.createGain();
    this.studioOut.connect(this.bus);

    const notify = () => {
      this.applyAll();
      this.emit();
    };
    this.decks = {
      A: new Deck('A', this.ctx, new Channel(this.ctx, this.bus), notify),
      B: new Deck('B', this.ctx, new Channel(this.ctx, this.bus), notify),
    };
    this.applyAll();
    loadKeyLock(this.ctx).then((ok) => {
      if (!ok) return;
      this.decks.A.attachShifter(createShifter(this.ctx));
      this.decks.B.attachShifter(createShifter(this.ctx));
      this.keyLockReady = true;
      this.emit();
    });
  }
  keyLockReady = false;

  // ---- assinatura de mudanças (para a interface) ----
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  other(id: DeckId): Deck {
    return this.decks[id === 'A' ? 'B' : 'A'];
  }

  // ---- mixer ----
  set<K extends keyof MixerState>(key: K, value: MixerState[K]) {
    this.mix[key] = value;
    this.applyAll();
    this.emit();
  }
  setCh(key: 'gain' | 'low' | 'mid' | 'high' | 'filter' | 'volume', id: DeckId, v: number) {
    this.mix[key] = { ...this.mix[key], [id]: v };
    this.applyAll();
    this.emit();
  }

  /** Quanto cada deck chega ao master (0..1), juntando fader e crossfader. */
  audibility(id: DeckId): number {
    return this.mix.volume[id] * this.xfGain(id);
  }

  private xfGain(id: DeckId): number {
    // Curva de potência constante: no meio, os dois tocam sem "buraco" de volume.
    const x = (this.mix.crossfader + 1) / 2; // 0 = A, 1 = B
    return id === 'A' ? Math.cos((x * Math.PI) / 2) : Math.sin((x * Math.PI) / 2);
  }

  private applyAll() {
    const t = this.ctx.currentTime;
    const s = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.012);
    for (const id of ['A', 'B'] as DeckId[]) {
      const ch = this.decks?.[id]?.channel;
      if (!ch) continue;
      const auto = this.autoGain ? (this.decks[id].track?.autoGainDb ?? 0) : 0;
      s(ch.input.gain, Math.pow(10, (this.mix.gain[id] + auto) / 20));
      const eq = (v: number) => (v <= -25.5 ? -45 : v); // no mínimo = "kill"
      s(ch.low.gain, eq(this.mix.low[id]));
      s(ch.mid.gain, eq(this.mix.mid[id]));
      s(ch.high.gain, eq(this.mix.high[id]));
      const f = this.mix.filter[id];
      if (Math.abs(f) < 0.03) {
        ch.filter.type = 'lowpass';
        s(ch.filter.frequency, 22000);
        s(ch.filter.Q, 0.7);
      } else if (f < 0) {
        ch.filter.type = 'lowpass';
        s(ch.filter.frequency, 20000 * Math.pow(150 / 20000, -f));
        s(ch.filter.Q, 1.2);
      } else {
        ch.filter.type = 'highpass';
        s(ch.filter.frequency, 20 * Math.pow(6000 / 20, f));
        s(ch.filter.Q, 1.2);
      }
      s(ch.fader.gain, Math.pow(this.mix.volume[id], 1.6));
      s(ch.xfade.gain, this.xfGain(id));
    }
    this.masterGain && s(this.masterGain.gain, this.mix.master);
  }

  setAutoGain(on: boolean) {
    this.autoGain = on;
    this.applyAll();
    this.emit();
  }

  setQuantize(on: boolean) {
    this.decks.A.quantize = on;
    this.decks.B.quantize = on;
    this.emit();
  }

  // ---- sync ----
  /** Sincroniza `id` com o outro deck: mesmo BPM e batidas alinhadas. */
  sync(id: DeckId) {
    const d = this.decks[id];
    const m = this.other(id);
    if (!d.track || !m.track) return false;
    const rate = syncRate(d.track.bpm, m.bpm, 1);
    if (Math.abs(rate - 1) > 0.16) return false; // longe demais: pede corte seco ou efeito
    if (Math.abs(rate - 1) > d.range) d.setRange(0.16);
    d.applyRate(rate);
    d.synced = true;
    this.alignPhase(id);
    this.emit();
    return true;
  }

  unsync(id: DeckId) {
    this.decks[id].synced = false;
    this.emit();
  }

  /** Mantém decks sincronizados acompanhando mudanças de tempo do outro. */
  followTempo(changed: DeckId) {
    const f = this.other(changed);
    if (f.synced && f.track && this.decks[changed].track) {
      f.applyRate(syncRate(f.track.bpm, this.decks[changed].bpm, f.range));
    }
  }

  alignPhase(id: DeckId) {
    const d = this.decks[id];
    const m = this.other(id);
    if (!d.grid || !m.grid) return;
    const delta = phaseDelta(beatPhase(m.grid, m.position()), beatPhase(d.grid, d.position()));
    // Se a música tocava em dobro/metade, a fase é comparada na batida do deck.
    const beat = 60 / d.grid.bpm;
    if (Math.abs(delta) > 0.005) d.seek(d.position() + delta * beat);
  }

  /** Diferença de fase entre os decks em milissegundos (positivo = B adiantado). */
  phaseOffsetMs(): number | null {
    const a = this.decks.A;
    const b = this.decks.B;
    if (!a.grid || !b.grid || !a.playing || !b.playing) return null;
    const ratio = b.bpm / a.bpm;
    const r = ratio > 1.4 ? 2 : ratio < 0.7 ? 0.5 : 1;
    if (Math.abs(b.bpm / r - a.bpm) > 1.5) return null;
    const delta = phaseDelta(beatPhase(b.grid, b.position()), beatPhase(a.grid, a.position()));
    return delta * (60000 / b.bpm);
  }

  // ---- medidores ----
  peaks(): { A: number; B: number; master: number; clip: boolean } {
    this.busMeter.getFloatTimeDomainData(this.meterBuf);
    let bus = 0;
    for (let i = 0; i < this.meterBuf.length; i++) bus = Math.max(bus, Math.abs(this.meterBuf[i]));
    this.masterMeter.getFloatTimeDomainData(this.meterBuf);
    let master = 0;
    for (let i = 0; i < this.meterBuf.length; i++) master = Math.max(master, Math.abs(this.meterBuf[i]));
    return { A: this.decks.A.channel.peak(), B: this.decks.B.channel.peak(), master, clip: bus > 1.0 };
  }

  // ---- gravação ----
  get recording() {
    return this.recorder?.state === 'recording';
  }

  startRecording() {
    if (this.recording) return;
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.recDest.stream, mimeType ? { mimeType, audioBitsPerSecond: 256000 } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.recordingSince = performance.now();
    this.emit();
  }

  stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r || r.state !== 'recording') return resolve(null);
      r.onstop = () => {
        resolve(new Blob(this.chunks, { type: r.mimeType || 'audio/webm' }));
        this.recordingSince = null;
        this.emit();
      };
      r.stop();
    });
  }
}

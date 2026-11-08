// Sons do Estúdio e do sampler. Os de fábrica são sintetizados aqui (sem direitos autorais);
// a vinheta é gravada pelo microfone; outros sons podem ser importados.

export interface SoundAsset {
  id: string;
  name: string;
  icon: string;
  buffer: AudioBuffer;
  /** Criado por ela (vinheta/importado) — pode ser apagado e fica salvo. */
  user?: boolean;
}

type Synth = (sr: number) => Float32Array;

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norm = (x: Float32Array, peak = 0.9) => {
  let m = 1e-9;
  for (const v of x) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
};

const SYNTHS: { id: string; name: string; icon: string; fn: Synth }[] = [
  {
    id: 'buzina',
    name: 'Buzina',
    icon: '📯',
    fn: (sr) => {
      // "pã pã pããã" de air horn: dente de serra com vibrato, em 3 toques
      const out = new Float32Array(Math.floor(sr * 1.2));
      const hits = [
        [0, 0.13],
        [0.2, 0.13],
        [0.4, 0.75],
      ];
      for (const [t0, d] of hits) {
        let p1 = 0;
        let p2 = 0;
        for (let i = 0; i < d * sr; i++) {
          const t = i / sr;
          const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 6 * t);
          p1 += (466 * vib) / sr;
          p2 += (587 * vib) / sr;
          const env = Math.min(1, t * 80) * Math.min(1, (d - t) * 25);
          out[Math.floor(t0 * sr) + i] += Math.tanh((((p1 % 1) * 2 - 1) + ((p2 % 1) * 2 - 1)) * 1.8) * env;
        }
      }
      return norm(out);
    },
  },
  {
    id: 'sirene',
    name: 'Sirene',
    icon: '🚨',
    fn: (sr) => {
      const d = 2.4;
      const out = new Float32Array(Math.floor(sr * d));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = 750 + 450 * Math.sin(2 * Math.PI * 0.85 * t - Math.PI / 2);
        ph += f / sr;
        out[i] = Math.tanh(Math.sin(2 * Math.PI * ph) * 2) * Math.min(1, t * 20) * Math.min(1, (d - t) * 6);
      }
      return norm(out, 0.7);
    },
  },
  {
    id: 'impacto',
    name: 'Impacto',
    icon: '💥',
    fn: (sr) => {
      const rnd = mulberry(7);
      const out = new Float32Array(Math.floor(sr * 2));
      let ph = 0;
      let lp = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (38 + 90 * Math.exp(-t * 9)) / sr;
        lp += 0.05 * (rnd() * 2 - 1 - lp);
        out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2) + lp * 3 * Math.exp(-t * 4);
      }
      return norm(out);
    },
  },
  {
    id: 'riser',
    name: 'Riser',
    icon: '⬆️',
    fn: (sr) => {
      const rnd = mulberry(11);
      const d = 4;
      const out = new Float32Array(Math.floor(sr * d));
      let ph = 0;
      let lp = 0;
      let lp2 = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const k = t / d;
        ph += (180 * Math.pow(12, k)) / sr;
        const c = 0.01 + 0.4 * k * k;
        const n = rnd() * 2 - 1;
        lp += c * (n - lp);
        lp2 += c * (lp - lp2);
        out[i] = ((lp - lp2) * 2.2 + 0.35 * Math.sin(2 * Math.PI * ph)) * Math.pow(k, 1.6);
      }
      return norm(out, 0.75);
    },
  },
  {
    id: 'rewind',
    name: 'Rewind',
    icon: '⏪',
    fn: (sr) => {
      const d = 1.1;
      const out = new Float32Array(Math.floor(sr * d));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = 1800 * Math.exp(-t * 2.3) + 120;
        ph += f / sr;
        const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 22 * t);
        out[i] = Math.tanh(Math.sin(2 * Math.PI * ph) * 3) * trem * Math.min(1, (d - t) * 8);
      }
      return norm(out, 0.75);
    },
  },
  {
    id: 'palmas',
    name: 'Palmas',
    icon: '👏',
    fn: (sr) => {
      const rnd = mulberry(5);
      const out = new Float32Array(Math.floor(sr * 0.5));
      let prev = 0;
      for (const off of [0, 0.011, 0.022, 0.034]) {
        for (let i = 0; i < sr * 0.4; i++) {
          const t = i / sr;
          const n = rnd() * 2 - 1;
          const hp = n - prev;
          prev = n;
          const idx = Math.floor(off * sr) + i;
          if (idx < out.length) out[idx] += hp * Math.exp(-t * (off === 0.034 ? 14 : 60));
        }
      }
      return norm(out);
    },
  },
  {
    id: 'laser',
    name: 'Laser',
    icon: '⚡',
    fn: (sr) => {
      const d = 0.35;
      const out = new Float32Array(Math.floor(sr * d));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (2200 * Math.exp(-t * 9) + 150) / sr;
        out[i] = ((ph % 1) * 2 - 1) * Math.exp(-t * 6);
      }
      return norm(out, 0.6);
    },
  },
];


/** Ruído branco filtrado com a frequência subindo ou descendo (sweep). */
function sweep(sr: number, up: boolean, seed: number): Float32Array {
  const rnd = mulberry(seed);
  const d = 2.2;
  const out = new Float32Array(Math.floor(sr * d));
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < out.length; i++) {
    const k = i / out.length;
    const pos = up ? k : 1 - k;
    const c = 0.01 + 0.5 * pos * pos;
    const n = rnd() * 2 - 1;
    lp += c * (n - lp);
    lp2 += c * (lp - lp2);
    const env = up ? Math.pow(k, 1.4) : Math.pow(1 - k, 1.2) * Math.min(1, k * 40);
    out[i] = (n - lp2) * env;
  }
  return norm(out, 0.7);
}

SYNTHS.push(
  {
    id: 'apito',
    name: 'Apito',
    icon: '😗',
    fn: (sr) => {
      // apito de baile: "fiu-fiuuu" com trinado
      const out = new Float32Array(Math.floor(sr * 0.9));
      const blasts = [
        [0, 0.16, 2900],
        [0.24, 0.55, 3100],
      ];
      for (const [t0, d, f] of blasts) {
        let ph = 0;
        for (let i = 0; i < d * sr; i++) {
          const t = i / sr;
          const trill = 1 + 0.03 * Math.sign(Math.sin(2 * Math.PI * 28 * t));
          const glide = 1 + 0.06 * Math.min(1, t * 12);
          ph += (f * trill * glide) / sr;
          const env = Math.min(1, t * 120) * Math.min(1, (d - t) * 30);
          out[Math.floor(t0 * sr) + i] += Math.sin(2 * Math.PI * ph) * env;
        }
      }
      return norm(out, 0.6);
    },
  },
  {
    id: 'scratch',
    name: 'Scratch',
    icon: '💿',
    fn: (sr) => {
      // vai e volta do disco: chiado com "altura" mudando rápido
      const rnd = mulberry(23);
      const d = 0.6;
      const out = new Float32Array(Math.floor(sr * d));
      let lp = 0;
      let bp = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const speed = Math.abs(Math.sin(2 * Math.PI * 3.3 * t)); // duas idas e voltas
        const c = 0.02 + 0.35 * speed;
        const n = rnd() * 2 - 1;
        lp += c * (n - lp);
        bp += 0.5 * (lp - bp);
        const tone = Math.sin(2 * Math.PI * (180 + 900 * speed) * t);
        out[i] = (lp - bp * 0.6 + tone * 0.25) * speed * Math.min(1, (d - t) * 20);
      }
      return norm(out, 0.75);
    },
  },
  { id: 'sweep-up', name: 'Sweep ↑', icon: '🌪️', fn: (sr) => sweep(sr, true, 31) },
  { id: 'sweep-down', name: 'Sweep ↓', icon: '🍃', fn: (sr) => sweep(sr, false, 37) },
  {
    id: 'subdrop',
    name: 'Sub Drop',
    icon: '🔊',
    fn: (sr) => {
      // grave descendo, para marcar o drop
      const d = 1.8;
      const out = new Float32Array(Math.floor(sr * d));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (30 + 45 * Math.exp(-t * 2.2)) / sr;
        out[i] = Math.sin(2 * Math.PI * ph) * Math.min(1, t * 200) * Math.exp(-t * 1.1);
      }
      return norm(out, 0.9);
    },
  },
);

function toBuffer(ctx: BaseAudioContext, mono: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(2, mono.length, ctx.sampleRate);
  b.copyToChannel(mono, 0);
  b.copyToChannel(mono, 1);
  return b;
}

export class SoundBank {
  private list: SoundAsset[] = [];
  private listeners = new Set<() => void>();

  constructor(ctx: BaseAudioContext) {
    for (const s of SYNTHS) this.list.push({ id: s.id, name: s.name, icon: s.icon, buffer: toBuffer(ctx, s.fn(ctx.sampleRate)) });
  }

  all(): SoundAsset[] {
    return this.list;
  }
  get(id: string): SoundAsset | undefined {
    return this.list.find((s) => s.id === id);
  }
  add(s: SoundAsset) {
    this.list = [...this.list.filter((x) => x.id !== s.id), s];
    this.listeners.forEach((l) => l());
  }
  remove(id: string) {
    this.list = this.list.filter((x) => x.id !== id);
    this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

/** Corta silêncio do começo e do fim e normaliza (ideal para a vinheta gravada). */
export function trimAndNormalize(ctx: BaseAudioContext, buf: AudioBuffer, threshold = 0.03): AudioBuffer {
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const amp = (i: number) => Math.max(...chs.map((c) => Math.abs(c[i])));
  let a = 0;
  let b = buf.length - 1;
  while (a < b && amp(a) < threshold) a++;
  while (b > a && amp(b) < threshold) b--;
  a = Math.max(0, a - Math.floor(buf.sampleRate * 0.01));
  b = Math.min(buf.length - 1, b + Math.floor(buf.sampleRate * 0.08));
  const n = Math.max(1, b - a + 1);
  const out = ctx.createBuffer(2, n, buf.sampleRate);
  let peak = 1e-6;
  for (let i = a; i <= b; i++) peak = Math.max(peak, amp(i));
  const g = 0.95 / peak;
  for (let c = 0; c < 2; c++) {
    const src = chs[Math.min(c, chs.length - 1)];
    const dst = out.getChannelData(c);
    for (let i = 0; i < n; i++) {
      // rampinhas de 5 ms nas pontas evitam estalo
      const edge = Math.min(1, i / (buf.sampleRate * 0.005), (n - i) / (buf.sampleRate * 0.005));
      dst[i] = src[a + i] * g * edge;
    }
  }
  return out;
}

/** Grava do microfone até `stop()` ser chamado. */
export async function recordMic(): Promise<{ stop: () => Promise<Blob>; level: () => number }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(100);
  // medidor de nível para ela ver que está captando
  const actx = new AudioContext();
  const an = actx.createAnalyser();
  an.fftSize = 1024;
  actx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(1024);
  return {
    level: () => {
      an.getFloatTimeDomainData(buf);
      let p = 0;
      for (const v of buf) p = Math.max(p, Math.abs(v));
      return p;
    },
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          actx.close();
          resolve(new Blob(chunks, { type: rec.mimeType }));
        };
        rec.stop();
      }),
  };
}

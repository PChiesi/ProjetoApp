// Detecção de tom: cromagrama (quanto de cada nota aparece) comparado com os perfis
// de Krumhansl para os 24 tons. Resultado na notação Camelot (8A, 9B…), a mesma dos DJs.

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function chroma(data: Float32Array, sampleRate: number): Float64Array {
  const factor = Math.max(1, Math.round(sampleRate / 11025));
  const sr = sampleRate / factor;
  const N = 8192;
  const total = Math.floor(data.length / factor);
  const out = new Float64Array(12);
  const frames = Math.floor(total / N);
  const step = Math.max(1, Math.floor(frames / 120)); // até ~120 quadros espalhados pela música
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const kMin = Math.ceil((60 * N) / sr);
  const kMax = Math.floor((1600 * N) / sr);
  const bassK = Math.floor((260 * N) / sr);
  const pcOfBin = new Int8Array(kMax + 1);
  for (let k = kMin; k <= kMax; k++) {
    const midi = 69 + 12 * Math.log2(((k * sr) / N) / 440);
    pcOfBin[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let f = 0; f < frames; f += step) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      const base = (f * N + i) * factor;
      for (let k = 0; k < factor; k++) s += data[base + k] ?? 0;
      re[i] = (s / factor) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const c = new Float64Array(12);
    let sum = 0;
    const mag = new Float64Array(kMax + 22);
    for (let k = Math.max(1, kMin - 21); k < kMax + 21 && k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    // Só picos do espectro (notas sustentadas); ruído e bateria espalham energia e ficam de fora.
    for (let k = kMin; k <= kMax; k++) {
      if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
      let local = 0;
      for (let j = k - 20; j <= k + 20; j++) local += mag[j];
      local /= 41;
      if (mag[k] < 3 * local) continue;
      // Graves pesam mais: o baixo costuma tocar a tônica.
      const m = Math.log1p(mag[k] * 10) * (k < bassK ? 2 : 1);
      c[pcOfBin[k]] += m;
      sum += m;
    }
    if (sum > 1e-6) for (let i = 0; i < 12; i++) out[i] += c[i] / sum;
  }
  return out;
}

function corr(a: ArrayLike<number>, b: number[], rot: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[(i + rot) % 12];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + rot) % 12] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db || 1);
}

export function toCamelot(tonic: number, minor: boolean): string {
  const majorPc = minor ? (tonic + 3) % 12 : tonic;
  const n = ((majorPc * 7 + 7) % 12) + 1;
  return `${n}${minor ? 'A' : 'B'}`;
}

export interface KeyResult {
  camelot: string;
  name: string;
  confidence: number;
}

export function detectKey(data: Float32Array, sampleRate: number): KeyResult | null {
  const c = chroma(data, sampleRate);
  if (c.every((v) => v === 0)) return null;
  let best = { r: -2, tonic: 0, minor: false };
  let second = -2;
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const r = corr(c, minor ? MINOR : MAJOR, t);
      if (r > best.r) {
        second = best.r;
        best = { r, tonic: t, minor };
      } else if (r > second) second = r;
    }
  }
  return {
    camelot: toCamelot(best.tonic, best.minor),
    name: `${NAMES[best.tonic]}${best.minor ? 'm' : ''}`,
    confidence: Math.max(0, Math.min(1, (best.r - second) * 5 + best.r * 0.5)),
  };
}

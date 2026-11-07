// Análise offline: forma de onda em 3 bandas e detecção de BPM + grid.
// Funções puras sobre Float32Array, para rodar no navegador e nos testes.

export interface Waveform {
  /** Quantos pontos por segundo de música. */
  rate: number;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/** Filtro passa-baixa de 1 polo (coeficiente para a frequência de corte). */
function onePoleCoef(cutoff: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
}

export function computeWaveform(data: Float32Array, sampleRate: number, rate = 120): Waveform {
  const hop = Math.max(1, Math.round(sampleRate / rate));
  const n = Math.ceil(data.length / hop);
  const low = new Float32Array(n);
  const mid = new Float32Array(n);
  const high = new Float32Array(n);
  const cLow = onePoleCoef(200, sampleRate);
  const cMid = onePoleCoef(2500, sampleRate);
  let lp1 = 0;
  let lp1b = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    let sl = 0;
    let sm = 0;
    let sh = 0;
    const end = Math.min(data.length, (i + 1) * hop);
    for (let j = i * hop; j < end; j++) {
      const x = data[j];
      lp1 += cLow * (x - lp1);
      lp1b += cLow * (lp1 - lp1b); // 2ª ordem para graves mais limpos
      lp2 += cMid * (x - lp2);
      const l = lp1b;
      const m = lp2 - lp1b;
      const h = x - lp2;
      sl += l * l;
      sm += m * m;
      sh += h * h;
    }
    const cnt = Math.max(1, end - i * hop);
    low[i] = Math.sqrt(sl / cnt);
    mid[i] = Math.sqrt(sm / cnt);
    high[i] = Math.sqrt(sh / cnt);
  }
  // Normaliza cada banda de forma conjunta para manter as proporções.
  let max = 1e-9;
  for (let i = 0; i < n; i++) max = Math.max(max, low[i], mid[i] * 1.2, high[i] * 2);
  for (let i = 0; i < n; i++) {
    low[i] = Math.min(1, low[i] / max);
    mid[i] = Math.min(1, (mid[i] * 1.2) / max);
    high[i] = Math.min(1, (high[i] * 2) / max);
  }
  return { rate: sampleRate / hop, low, mid, high };
}

// ---------- BPM ----------

export interface TempoResult {
  bpm: number;
  /** Primeira batida (s). */
  firstBeat: number;
  /** 0..1 — quão "regular" é o ritmo (baixo = música ao vivo / tempo variável). */
  confidence: number;
}


function smooth(x: Float32Array): Float32Array {
  const k = [0.05, 0.12, 0.2, 0.26, 0.2, 0.12, 0.05];
  const h = 3;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = -h; j <= h; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < x.length) s += x[idx] * k[j + h];
    }
    y[i] = s;
  }
  return y;
}

/** Envelope de ataques (onsets): aumento positivo de energia, com peso extra nos graves. */
export function onsetEnvelope(data: Float32Array, sampleRate: number): { env: Float32Array; low: Float32Array; mid: Float32Array; frameRate: number } {
  const HOP = Math.max(64, Math.round(sampleRate / 172)); // ~5,8 ms por quadro
  const n = Math.floor(data.length / HOP);
  const env = new Float32Array(n);
  const lowEnv = new Float32Array(n);
  const midEnv = new Float32Array(n); // caixa/palmas (300 Hz–2,5 kHz)
  const c = onePoleCoef(150, sampleRate);
  const c300 = onePoleCoef(300, sampleRate);
  const c4k = onePoleCoef(2500, sampleRate);
  let lp = 0;
  let lp300 = 0;
  let lp4k = 0;
  let prevFull = 0;
  let prevLow = 0;
  let prevMid = 0;
  for (let i = 0; i < n; i++) {
    let ef = 0;
    let el = 0;
    let em = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) {
      const x = data[j];
      lp += c * (x - lp);
      lp300 += c300 * (x - lp300);
      lp4k += c4k * (x - lp4k);
      const m = lp4k - lp300;
      ef += x * x;
      el += lp * lp;
      em += m * m;
    }
    const md = Math.log1p(em * 400);
    midEnv[i] = Math.max(0, md - prevMid);
    prevMid = md;
    const f = Math.log1p(ef * 100);
    const l = Math.log1p(el * 400);
    lowEnv[i] = Math.max(0, l - prevLow);
    env[i] = Math.max(0, f - prevFull) + 1.5 * lowEnv[i];
    prevFull = f;
    prevLow = l;
  }
  // Remove a média local (realça ataques, ignora volume geral).
  const w = 16;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + env[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n, i + w + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    out[i] = Math.max(0, env[i] - mean);
  }
  // Suaviza (gaussiana ~±12 ms): ataques viram "morrinhos" e a autocorrelação fica estável.
  return { env: smooth(out), low: smooth(lowEnv), mid: smooth(midEnv), frameRate: sampleRate / HOP };
}

/** Magnitude e fase da componente periódica do envelope num dado BPM. */
function periodicity(env: Float32Array, frameRate: number, bpm: number): { mag: number; phase: number } {
  const w = (2 * Math.PI * bpm) / 60 / frameRate;
  let re = 0;
  let im = 0;
  // Recorrência de rotação: evita sin/cos por amostra.
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let c = 1;
  let s = 0;
  for (let i = 0; i < env.length; i++) {
    const v = env[i];
    re += v * c;
    im -= v * s;
    const nc = c * cw - s * sw;
    s = s * cw + c * sw;
    c = nc;
  }
  return { mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

/** Valor do envelope em posição fracionária (interpolação linear). */
function at(env: Float32Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

/** Autocorrelação normalizada do envelope até `maxLag` quadros. */
function autocorr(env: Float32Array, maxLag: number): Float32Array {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = env[i] - mean;
  const acf = new Float32Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    acf[lag] = s / (n - lag);
  }
  const z = acf[0] || 1;
  for (let i = 0; i < acf.length; i++) acf[i] /= z;
  return acf;
}

export function detectTempo(data: Float32Array, sampleRate: number, minBpm = 78, maxBpm = 165): TempoResult {
  const { env, low, mid, frameRate } = onsetEnvelope(data, sampleRate);
  let total = 0;
  for (let i = 0; i < env.length; i++) total += env[i];
  if (total <= 0 || env.length < frameRate * 4) return { bpm: 120, firstBeat: 0, confidence: 0 };

  // 1) Busca grossa por autocorrelação: o período certo se repete na batida, em 2 batidas
  //    e no compasso inteiro (4 batidas). Isso resiste a levadas sincopadas (tamborzão!).
  const maxLag = Math.ceil(((8 * 60) / minBpm) * frameRate);
  const acf = autocorr(env, Math.min(maxLag, env.length - 2));
  let best = minBpm;
  let bestS = -Infinity;
  for (let b = minBpm; b <= maxBpm; b += 0.1) {
    const P = (60 / b) * frameRate;
    let s = 0;
    for (let k = 1; k <= 8; k++) s += at(acf, k * P);
    if (s > bestS) {
      bestS = s;
      best = b;
    }
  }

  // 2) Refinamento fino com pente (batida + subdivisões) ao longo da música inteira.
  let fine = best;
  let fineS = -1;
  for (let b = best - 0.5; b <= best + 0.5; b += 0.01) {
    const s = periodicity(env, frameRate, b).mag + periodicity(env, frameRate, b * 2).mag + periodicity(env, frameRate, b * 4).mag;
    if (s > fineS) {
      fineS = s;
      fine = b;
    }
  }
  // Músicas de estúdio quase sempre têm BPM inteiro.
  const rounded = Math.round(fine);
  const bpm = Math.abs(fine - rounded) < 0.12 ? rounded : Math.round(fine * 100) / 100;

  // 3) Fase: modelo de compasso de pop/rock/funk — bumbo no 1 (e no 3) e caixa no 2 e no 4.
  //    Procura a posição do compasso que melhor encaixa; depois ajusta fino com o envelope completo.
  const P = (60 / bpm) * frameRate;
  const bar = 4 * P;
  // "Caixa" = ataque na faixa média que não veio junto com um bumbo.
  const snareAt = (x: number) => Math.max(0, at(mid, x) - at(low, x));
  let barPhase = 0;
  let barS = -1;
  for (let ph = 0; ph < bar; ph += 0.5) {
    let s = 0;
    for (let x = ph; x < low.length; x += bar)
      s += at(low, x) + 0.5 * at(low, x + 2 * P) + snareAt(x + P) + snareAt(x + 3 * P);
    if (s > barS) {
      barS = s;
      barPhase = ph;
    }
  }
  let bestPhase = barPhase;
  let bestPhaseS = -1;
  for (let ph = barPhase - P / 8; ph <= barPhase + P / 8; ph += 0.25) {
    let s = 0;
    for (let x = ph; x < env.length; x += P) s += at(env, x);
    if (s > bestPhaseS) {
      bestPhaseS = s;
      bestPhase = ph;
    }
  }
  bestPhase = ((bestPhase % bar) + bar) % bar; // mantém o "1" do compasso
  const beatLen = 60 / bpm;
  // +0,5 quadro: o ataque cai, em média, no meio do quadro.
  let firstBeat = (bestPhase + 0.5) / frameRate;

  // Começa a contagem no primeiro compasso com som de verdade.
  const thr = (total / env.length) * 2;
  for (let t = firstBeat; t < data.length / sampleRate; t += 4 * beatLen) {
    const i = Math.round(t * frameRate);
    let peak = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) peak = Math.max(peak, env[k]);
    if (peak > thr) {
      firstBeat = t;
      break;
    }
  }

  const beats = env.length / P;
  const confidence = Math.min(1, bestPhaseS / beats / ((total / env.length) * 3));
  return { bpm, firstBeat: Math.max(0, firstBeat), confidence };
}

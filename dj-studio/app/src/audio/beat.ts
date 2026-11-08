// Matemática de batidas, compassos e frases. Funções puras (testáveis sem áudio).

export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 8;
export const BEATS_PER_PHRASE = BEATS_PER_BAR * BARS_PER_PHRASE;

export interface Grid {
  bpm: number;
  /** Instante (s, no tempo da música) da primeira batida "1". */
  firstBeat: number;
}

export function beatLength(bpm: number): number {
  return 60 / bpm;
}

/** Posição em batidas (fracionária) a partir da primeira batida. */
export function beatPosition(grid: Grid, t: number): number {
  return (t - grid.firstBeat) / beatLength(grid.bpm);
}

/** Fase dentro da batida, 0..1. */
export function beatPhase(grid: Grid, t: number): number {
  const b = beatPosition(grid, t);
  return b - Math.floor(b);
}

export interface BeatInfo {
  /** Batida dentro do compasso, 1..4 (0 antes da primeira batida). */
  beatInBar: number;
  /** Compasso dentro da frase, 1..8 (0 antes da primeira batida). */
  barInPhrase: number;
  /** Frase atual, 1.. */
  phrase: number;
  /** Batidas até a próxima frase começar. */
  beatsToNextPhrase: number;
}

export function beatInfo(grid: Grid, t: number): BeatInfo {
  const b = Math.floor(beatPosition(grid, t) + 1e-6);
  if (b < 0) {
    return { beatInBar: 0, barInPhrase: 0, phrase: 0, beatsToNextPhrase: -b };
  }
  const inPhrase = b % BEATS_PER_PHRASE;
  return {
    beatInBar: (b % BEATS_PER_BAR) + 1,
    barInPhrase: Math.floor(inPhrase / BEATS_PER_BAR) + 1,
    phrase: Math.floor(b / BEATS_PER_PHRASE) + 1,
    beatsToNextPhrase: BEATS_PER_PHRASE - inPhrase,
  };
}

/** Diferença de fase circular entre duas fases (0..1), em -0.5..0.5. */
export function phaseDelta(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d);
  return d;
}

/**
 * Taxa de reprodução que faz uma música de `bpm` tocar em `targetBpm`.
 * Se a diferença passar do alcance, tenta metade/dobro (ex.: 75 ↔ 150, comum no funk).
 */
export function syncRate(bpm: number, targetBpm: number, maxRange = 0.16): number {
  const candidates = [targetBpm, targetBpm * 2, targetBpm / 2].map((t) => t / bpm);
  let best = candidates[0];
  for (const r of candidates) if (Math.abs(r - 1) < Math.abs(best - 1)) best = r;
  return Math.min(1 + maxRange, Math.max(1 - maxRange, best));
}

// ---------- Tom (Camelot) ----------

/** Compatibilidade harmônica pela roda de Camelot: 'ok' | 'risco' | 'conflito'. */
export function camelotMatch(a?: string | null, b?: string | null): 'ok' | 'risco' | 'conflito' | 'desconhecido' {
  const pa = parseCamelot(a);
  const pb = parseCamelot(b);
  if (!pa || !pb) return 'desconhecido';
  const dist = Math.min((pa.n - pb.n + 12) % 12, (pb.n - pa.n + 12) % 12);
  if (pa.l === pb.l && dist <= 1) return 'ok';
  if (pa.l !== pb.l && dist === 0) return 'ok';
  if (pa.l === pb.l && dist === 2) return 'risco';
  if (pa.l !== pb.l && dist === 1) return 'risco';
  return 'conflito';
}

function parseCamelot(k?: string | null): { n: number; l: string } | null {
  if (!k) return null;
  const m = /^(\d{1,2})([AB])$/.exec(k.trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return null;
  return { n: n - 1, l: m[2] };
}

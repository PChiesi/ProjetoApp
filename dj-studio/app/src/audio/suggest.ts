// Sugestão da próxima música: BPM perto (ou dobro/metade), tom compatível, energia parecida
// ou um pouco maior, mesmo gênero — e que ainda não tocou nesta sessão.

import { camelotMatch } from './beat';

export interface SuggestTrack {
  id: string;
  bpm: number;
  key: string | null;
  genre?: string;
  energy: number; // 0..1
}

export interface Suggestion {
  id: string;
  score: number;
  reasons: string[];
}

export function energyOf(wf: { low: Float32Array; mid: Float32Array }): number {
  let s = 0;
  const n = wf.low.length;
  for (let i = 0; i < n; i++) s += wf.low[i] + wf.mid[i];
  return n ? Math.min(1, s / n / 0.9) : 0;
}

export function suggestNext(current: SuggestTrack, all: SuggestTrack[], played: Set<string>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const t of all) {
    if (t.id === current.id) continue;
    const reasons: string[] = [];
    let score = 0;
    // BPM: diferença em % considerando dobro/metade (75 ↔ 150)
    const diffs = [1, 2, 0.5].map((k) => Math.abs(t.bpm / (current.bpm * k) - 1));
    const d = Math.min(...diffs);
    if (d <= 0.02) {
      score += 40;
      reasons.push('mesmo BPM');
    } else if (d <= 0.06) {
      score += 30;
      reasons.push('BPM próximo');
    } else if (d <= 0.16) {
      score += 12;
    } else {
      score -= 10;
      reasons.push('BPM longe: corte seco');
    }
    const k = camelotMatch(current.key, t.key);
    if (k === 'ok') {
      score += 30;
      reasons.push('tom combina');
    } else if (k === 'risco') score += 8;
    else if (k === 'conflito') score -= 15;
    if (t.genre && t.genre === current.genre) {
      score += 10;
      reasons.push(t.genre);
    }
    const de = t.energy - current.energy;
    if (de >= -0.03 && de <= 0.12) {
      score += 12;
      if (de > 0.03) reasons.push('sobe a energia');
    } else if (de < -0.15) score -= 5;
    if (played.has(t.id)) {
      score -= 40;
      reasons.push('já tocou');
    }
    out.push({ id: t.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

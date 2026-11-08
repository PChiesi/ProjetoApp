// Relatório pós-set: o que tocou, como foram as transições e UMA dica principal para treinar.

import type { TransitionResult } from './coach';

export interface SetTrackEntry {
  at: number; // segundos desde o começo da gravação
  title: string;
  artist: string;
}

export interface SetTransitionEntry extends TransitionResult {
  at: number;
  from: string;
  to: string;
  auto: boolean;
}

export interface SetReport {
  date: number;
  duration: number;
  tracks: SetTrackEntry[];
  transitions: SetTransitionEntry[];
  avgStars: number;
  mainTip: string;
  praise: string;
}

export class SetRecorder {
  private t0 = 0;
  private tracks: SetTrackEntry[] = [];
  private seen = new Set<string>();
  private transitions: SetTransitionEntry[] = [];
  active = false;

  start(now: number) {
    this.t0 = now;
    this.tracks = [];
    this.seen.clear();
    this.transitions = [];
    this.active = true;
  }

  /** Chamado quando uma música passa a ser ouvida pelo público. */
  noteTrack(id: string, title: string, artist: string, now: number) {
    if (!this.active || this.seen.has(id)) return;
    this.seen.add(id);
    this.tracks.push({ at: now - this.t0, title, artist });
  }

  noteTransition(r: TransitionResult, from: string, to: string, auto: boolean, now: number) {
    if (!this.active) return;
    this.transitions.push({ ...r, at: now - this.t0 - r.seconds, from, to, auto });
  }

  finish(now: number): SetReport {
    this.active = false;
    return buildReport(now - this.t0, this.tracks, this.transitions, Date.now());
  }
}

export function buildReport(duration: number, tracks: SetTrackEntry[], transitions: SetTransitionEntry[], date: number): SetReport {
  const mine = transitions.filter((t) => !t.auto);
  const avgStars = mine.length ? mine.reduce((a, t) => a + t.stars, 0) / mine.length : 0;
  const avg = (f: (t: SetTransitionEntry) => number) => (mine.length ? mine.reduce((a, t) => a + f(t), 0) / mine.length : 0);
  const aligned = avg((t) => t.aligned);
  const clash = avg((t) => t.bassClash);
  const clips = mine.reduce((a, t) => a + t.clips, 0);

  let mainTip: string;
  if (!mine.length)
    mainTip = tracks.length < 2 ? 'Da próxima vez, faça pelo menos uma transição durante a gravação — é ali que a gente evolui.' : 'As transições deste set foram do Automix/transições prontas. Tente fazer uma você mesma: o app avalia!';
  else if (aligned < 0.75) mainTip = 'Treine o alinhamento: antes de subir o volume, deixe o medidor de batidas verde (SYNC ou ◀ ▶). Lição recomendada: "Alinhando de ouvido".';
  else if (clash > 0.25) mainTip = 'Os graves se somaram em boa parte das transições. Corte o GRAVE de quem entra e troque na virada da frase. Lição: "Trocando os graves".';
  else if (clips > 0) mainTip = 'O som estourou algumas vezes. Fique de olho no medidor e use o GANHO/volume com calma.';
  else if (avgStars >= 2.8) mainTip = 'Tudo certo nas transições! Próximo desafio: usar efeitos (eco na saída) ou fazer transições entre gêneros diferentes.';
  else mainTip = 'Bom set! Para subir de nível, entre sempre no "1" da frase — observe o contador "Compasso x/8".';

  const praise =
    avgStars >= 2.8 ? 'Set de profissional! 🔥' : avgStars >= 2 ? 'Mandou bem! 🎧' : mine.length ? 'Cada set é um treino — continue! 💪' : 'Set gravado! 🎙️';
  return { date, duration, tracks, transitions, avgStars, mainTip, praise };
}

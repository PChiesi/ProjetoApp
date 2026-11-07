// Coach: observa a mixagem e dá UMA dica por vez, em português, sempre gentil.
// Funções puras sobre um "retrato" do estado — fáceis de testar e de evoluir.

import type { DeckId } from '../audio/engine';

export interface DeckSnap {
  loaded: boolean;
  playing: boolean;
  /** 0..1: quanto o deck chega ao som principal. */
  audible: number;
  bpm: number;
  /** EQ grave em dB. */
  low: number;
  remaining: number;
  beatsToNextPhrase: number;
  synced: boolean;
}

export interface Snapshot {
  A: DeckSnap;
  B: DeckSnap;
  phaseMs: number | null;
  clip: boolean;
  level: 1 | 2 | 3;
}

export type Tone = 'info' | 'warn' | 'good';
export interface Tip {
  id: string;
  text: string;
  tone: Tone;
  /** Controle a destacar na tela (data-coach). */
  target?: string;
}

const ON = 0.25;

export function coachTip(s: Snapshot): Tip | null {
  const ids: DeckId[] = ['A', 'B'];
  const playing = ids.filter((d) => s[d].playing);
  const audible = ids.filter((d) => s[d].playing && s[d].audible > ON);

  if (!s.A.loaded && !s.B.loaded) {
    return { id: 'empty', text: 'Arraste uma música da biblioteca para o Deck A (ou use o botão "A" na lista).', tone: 'info' };
  }
  if (playing.length === 0) {
    const d = s.A.loaded ? 'A' : 'B';
    return { id: 'start', text: `Aperte ▶ no Deck ${d} para começar a tocar.`, tone: 'info', target: `play-${d}` };
  }
  if (s.clip) {
    return { id: 'clip', text: 'O som está estourando! Abaixe o GANHO ou o VOLUME do deck mais alto.', tone: 'warn' };
  }

  if (audible.length === 2) {
    const [a, b] = [s.A, s.B];
    const ratio = b.bpm / a.bpm;
    const r = ratio > 1.4 ? 2 : ratio < 0.7 ? 0.5 : 1;
    const diff = b.bpm / r - a.bpm;
    if (Math.abs(diff) > 0.3) {
      const faster: DeckId = diff > 0 ? 'B' : 'A';
      return {
        id: 'tempo',
        text: `Os BPMs estão diferentes: o Deck ${faster} está ${Math.abs(diff).toFixed(1)} BPM mais rápido. Aperte SYNC no deck que está entrando.`,
        tone: 'warn',
        target: `sync-${faster}`,
      };
    }
    if (s.phaseMs !== null && Math.abs(s.phaseMs) > 25) {
      const ahead: DeckId = s.phaseMs > 0 ? 'B' : 'A';
      return {
        id: 'phase',
        text: `As batidas estão desencontradas (${Math.abs(s.phaseMs).toFixed(0)} ms). Segure ◀ no Deck ${ahead} para frear um pouquinho, ou aperte SYNC.`,
        tone: 'warn',
        target: `nudge-${ahead}`,
      };
    }
    if (a.low > -8 && b.low > -8) {
      return {
        id: 'bass',
        text: 'Dois graves juntos embolam o som. Abaixe o GRAVE de um dos decks e troque na virada da frase.',
        tone: 'warn',
        target: 'low',
      };
    }
    return { id: 'mixing', text: 'Isso! Batidas alinhadas. Agora leve o crossfader devagar para o outro lado.', tone: 'good', target: 'crossfader' };
  }

  // Um deck no ar: preparar o próximo.
  const live: DeckId = audible[0] ?? playing[0];
  const next: DeckId = live === 'A' ? 'B' : 'A';
  const L = s[live];
  const N = s[next];
  if (!N.loaded) {
    if (L.remaining < 45) {
      return { id: 'load-next', text: `Falta menos de 1 minuto no Deck ${live}! Carregue a próxima música no Deck ${next}.`, tone: 'warn' };
    }
    return { id: 'load-next', text: `Enquanto o Deck ${live} toca, carregue a próxima música no Deck ${next}. Dica: o filtro "Combinam" mostra as melhores opções.`, tone: 'info' };
  }
  if (!N.playing) {
    if (L.beatsToNextPhrase <= 8 && L.beatsToNextPhrase > 0) {
      return {
        id: 'phrase',
        text: `Frase nova em ${L.beatsToNextPhrase} batidas… solte o Deck ${next} (▶) exatamente no "1"!`,
        tone: 'info',
        target: `play-${next}`,
      };
    }
    if (!N.synced && s.level >= 1) {
      return { id: 'presync', text: `Aperte SYNC no Deck ${next} para ele já ficar no mesmo BPM do Deck ${live}.`, tone: 'info', target: `sync-${next}` };
    }
    return { id: 'wait', text: `Espere o começo de uma frase no Deck ${live} (contador 1/8) para soltar o Deck ${next}.`, tone: 'info' };
  }
  // Os dois tocando mas só um audível: hora de subir o volume do outro.
  if (N.playing && N.audible <= ON) {
    const ratio = N.bpm / L.bpm;
    const r = ratio > 1.4 ? 2 : ratio < 0.7 ? 0.5 : 1;
    if (Math.abs(N.bpm / r - L.bpm) > 0.3) {
      return { id: 'tempo-pre', text: `O Deck ${next} está em ${N.bpm.toFixed(1)} BPM e o ${live} em ${L.bpm.toFixed(1)}. Aperte SYNC no ${next} antes de subir o volume.`, tone: 'warn', target: `sync-${next}` };
    }
    if (s.phaseMs !== null && Math.abs(s.phaseMs) > 25) {
      return { id: 'phase-pre', text: `Antes de subir o Deck ${next}, alinhe as batidas (SYNC ou ◀ ▶).`, tone: 'warn', target: `sync-${next}` };
    }
    return {
      id: 'bring-in',
      text: `Deck ${next} rodando no tempo. Abaixe o GRAVE dele e vá trazendo o crossfader para o meio.`,
      tone: 'info',
      target: 'crossfader',
    };
  }
  return null;
}

// ---------- Avaliação de transições ----------

export interface TransitionResult {
  seconds: number;
  aligned: number; // 0..1 do tempo com batidas alinhadas
  bassClash: number; // 0..1 do tempo com dois graves cheios
  clips: number;
  stars: 1 | 2 | 3;
  message: string;
}

/** Acompanha períodos em que os dois decks soam juntos e dá uma nota no final. */
export class TransitionJudge {
  private active = false;
  private t = 0;
  private alignedT = 0;
  private clashT = 0;
  private clipCount = 0;
  private wasClip = false;

  /** Chamar periodicamente com o intervalo `dt` em segundos. Retorna o resultado ao terminar. */
  update(s: Snapshot, dt: number): TransitionResult | null {
    const both = s.A.playing && s.B.playing && s.A.audible > ON && s.B.audible > ON;
    if (both) {
      this.active = true;
      this.t += dt;
      if (s.phaseMs !== null && Math.abs(s.phaseMs) <= 20) this.alignedT += dt;
      if (s.A.low > -8 && s.B.low > -8) this.clashT += dt;
      if (s.clip && !this.wasClip) this.clipCount++;
      this.wasClip = s.clip;
      return null;
    }
    if (!this.active) return null;
    const res = this.finish();
    return res;
  }

  private finish(): TransitionResult | null {
    const seconds = this.t;
    const aligned = seconds ? this.alignedT / seconds : 0;
    const bassClash = seconds ? this.clashT / seconds : 0;
    const clips = this.clipCount;
    this.active = false;
    this.t = this.alignedT = this.clashT = this.clipCount = 0;
    if (seconds < 3) return null; // corte rápido: não avalia
    let score = 0;
    if (aligned >= 0.9) score += 2;
    else if (aligned >= 0.7) score += 1;
    if (bassClash <= 0.25) score += 1;
    if (clips === 0) score += 1;
    const stars = (score >= 4 ? 3 : score >= 2 ? 2 : 1) as 1 | 2 | 3;
    let message: string;
    if (stars === 3) message = 'Transição limpa! Batidas alinhadas, graves trocados e nada estourou.';
    else if (aligned < 0.7) message = 'Bom começo! Para a próxima, deixe as batidas alinhadas antes de subir o volume (SYNC ajuda).';
    else if (bassClash > 0.25) message = 'Quase lá! Tente abaixar o GRAVE do deck que entra até a virada da frase.';
    else message = 'Boa! Cuidado só com o volume — fique de olho no medidor.';
    return { seconds, aligned, bassClash, clips, stars, message };
  }
}

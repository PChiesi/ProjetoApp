// Transições prontas: o app faz a transição sozinho, no "1" de uma frase, e explica cada movimento.
// Cada transição é uma "partitura" de ações em batidas, contadas a partir do começo da frase
// em que a próxima música entra (batida 0). Batidas negativas = preparação antes do "1".

import { beatPosition, BEATS_PER_PHRASE, syncRate } from '../audio/beat';
import type { AudioEngine, DeckId } from '../audio/engine';

export type TransitionId = 'suave' | 'filtro' | 'eco' | 'corte';

interface Lane {
  /** Intervalo em batidas [de, até] e o que fazer (t = 0..1 dentro do intervalo). */
  from: number;
  to: number;
  apply: (e: AudioEngine, out: DeckId, inc: DeckId, t: number) => void;
}

interface Cue {
  at: number;
  say: string;
  run?: (e: AudioEngine, out: DeckId, inc: DeckId) => void;
}

export interface TransitionDef {
  id: TransitionId;
  name: string;
  short: string;
  desc: string;
  /** Batidas de preparação antes do "1" da frase. */
  lead: number;
  /** Duração depois do "1". */
  length: number;
  needsSync: boolean;
  /** Preparação feita na hora (com explicação). */
  prep?: { say: string; run: (e: AudioEngine, out: DeckId, inc: DeckId) => void };
  lanes: Lane[];
  cues: Cue[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Crossfader de "out" (t=0) para "inc" (t=1). */
const xf = (e: AudioEngine, inc: DeckId, t: number) => e.set('crossfader', (inc === 'B' ? 1 : -1) * lerp(-1, 1, t));
const playIn = (e: AudioEngine, _o: DeckId, inc: DeckId) => e.decks[inc].play();

export const TRANSITIONS: Record<TransitionId, TransitionDef> = {
  suave: {
    id: 'suave',
    name: 'Suave',
    short: 'troca de graves, 16 compassos',
    desc: 'A clássica: a próxima entra sem grave, os graves trocam na metade e o crossfader termina no fim.',
    lead: 0,
    length: 64,
    needsSync: true,
    lanes: [
      { from: 0, to: 16, apply: (e, _o, i, t) => xf(e, i, t * 0.5) },
      { from: 30, to: 32, apply: (e, o, i, t) => { e.setCh('low', o, lerp(0, -26, t)); e.setCh('low', i, lerp(-26, 0, t)); } },
      { from: 48, to: 64, apply: (e, _o, i, t) => xf(e, i, 0.5 + t * 0.5) },
    ],
    prep: { say: 'Cortei o GRAVE da próxima música antes dela entrar — assim os dois bumbos não brigam.', run: (e, _o, i) => e.setCh('low', i, -26) },
    cues: [
      { at: 0, say: 'Soltei a próxima no "1" da frase e estou trazendo o crossfader até o meio.', run: playIn },
      { at: 16, say: 'As duas estão tocando juntas, com as batidas alinhadas pelo SYNC.' },
      { at: 30, say: 'Virada de frase chegando: agora TROCO os graves — sai o da antiga, entra o da nova.' },
      { at: 48, say: 'Última frase: levando o crossfader até o fim.' },
      { at: 64, say: 'Pronto! Transição suave de 16 compassos.' },
    ],
  },
  filtro: {
    id: 'filtro',
    name: 'Filtro',
    short: 'abafa uma, abre a outra, 8 compassos',
    desc: 'A música que sai vai ficando abafada enquanto a nova vai "abrindo" com o filtro.',
    lead: 0,
    length: 32,
    needsSync: true,
    lanes: [
      { from: 0, to: 4, apply: (e, _o, i, t) => xf(e, i, t * 0.5) },
      { from: 0, to: 32, apply: (e, o, i, t) => { e.setCh('filter', o, lerp(0, -0.85, t)); e.setCh('filter', i, lerp(0.75, 0, t)); } },
      { from: 28, to: 32, apply: (e, _o, i, t) => xf(e, i, 0.5 + t * 0.5) },
    ],
    prep: { say: 'Deixei a próxima só com os agudos (FILTRO para a direita).', run: (e, _o, i) => e.setCh('filter', i, 0.75) },
    cues: [
      { at: 0, say: 'Entrou no "1". Agora giro devagar o filtro das duas: uma fecha, a outra abre.', run: playIn },
      { at: 28, say: 'A antiga já está bem abafada: hora de levar o crossfader.' },
      { at: 32, say: 'Feito! Filtro de volta ao centro na nova música.', run: (e, o) => e.setCh('filter', o, 0) },
    ],
  },
  eco: {
    id: 'eco',
    name: 'Eco',
    short: 'saída com eco + entrada no 1',
    desc: 'Liga o eco na música que sai, tira o volume e a nova entra no "1" da frase seguinte.',
    lead: 8,
    length: 8,
    needsSync: false,
    lanes: [{ from: -4, to: 0, apply: (e, o, _i, t) => e.setCh('volume', o, lerp(0.8, 0, t)) }],
    cues: [
      { at: -8, say: 'Liguei o ECO na música que está saindo…', run: (e, o) => e.setFx(o, { type: 'eco', div: 0.75, amount: 0.7, on: true }) },
      { at: -4, say: '…e estou baixando o volume dela. Ouça o eco ficando no ar.' },
      { at: 0, say: 'No "1": a nova entra de uma vez!', run: (e, o, i) => { e.decks[i].play(); xf(e, i, 1); e.setCh('volume', i, 0.8); void o; } },
      { at: 8, say: 'Desliguei o eco: ele some sozinho, sem corte.', run: (e, o) => { e.setFx(o, { on: false }); e.setCh('volume', o, 0.8); } },
    ],
  },
  corte: {
    id: 'corte',
    name: 'Corte no 1',
    short: 'troca seca, ótimo para BPMs diferentes',
    desc: 'Troca de uma vez, exatamente no começo da frase — o jeito do funk quando os BPMs são muito diferentes.',
    lead: 0,
    length: 1,
    needsSync: false,
    lanes: [],
    cues: [{ at: 0, say: 'CORTE seco no "1"! Quando a frase vira, a troca não soa como erro.', run: (e, _o, i) => { e.decks[i].play(); xf(e, i, 1); } }],
  },
};

export type RunnerState = 'esperando' | 'tocando' | 'fim';

/**
 * Executa uma transição do deck `out` para o `inc`. Espera a próxima frase do `out` com tempo de
 * preparação suficiente, então segue a partitura batida a batida.
 */
export class TransitionRunner {
  state: RunnerState = 'esperando';
  private timer = 0;
  private startBeat = 0;
  private done = new Set<number>();
  readonly def: TransitionDef;

  constructor(
    private e: AudioEngine,
    readonly out: DeckId,
    readonly inc: DeckId,
    id: TransitionId,
    private say: (text: string) => void,
    private onEnd: (ok: boolean) => void,
  ) {
    this.def = TRANSITIONS[id];
  }

  /** Prepara os decks e começa a contagem. Retorna um motivo se não der para fazer. */
  start(): string | null {
    const e = this.e;
    const o = e.decks[this.out];
    const i = e.decks[this.inc];
    if (!o.track || !o.playing) return `Toque a música do Deck ${this.out} primeiro.`;
    if (!i.track) return `Carregue a próxima música no Deck ${this.inc}.`;
    if (i.playing && e.audibility(this.inc) > 0.2) return `O Deck ${this.inc} já está tocando para o público.`;
    if (this.def.needsSync) {
      const r = syncRate(i.track.bpm, o.bpm, 1);
      if (Math.abs(r - 1) > 0.16) return `BPMs muito diferentes (${o.bpm.toFixed(0)} e ${i.track.bpm.toFixed(0)}): use "Corte no 1" ou "Eco".`;
    }
    // Preparação: próxima no começo (CUE), parada, mixer neutro, crossfader na que está tocando
    if (i.playing) i.pause();
    i.seek(i.track.firstBeat);
    i.cuePoint = i.track.firstBeat;
    for (const k of ['low', 'mid', 'high', 'filter'] as const) e.setCh(k, this.inc, 0);
    e.setCh('volume', this.inc, 0.8);
    e.setFx(this.inc, { on: false });
    xf(e, this.inc, 0);
    if (this.def.needsSync) e.sync(this.inc);
    this.def.prep?.run(e, this.out, this.inc);
    // Próxima frase com tempo de preparação
    const g = o.grid!;
    const b = beatPosition(g, o.position());
    let k = Math.ceil((b + this.def.lead + 1) / BEATS_PER_PHRASE) * BEATS_PER_PHRASE;
    if (k < 0) k = 0;
    this.startBeat = k;
    const wait = Math.max(0, Math.round(k - this.def.lead - b));
    this.say(
      `Transição "${this.def.name}": ${this.def.needsSync ? 'apertei SYNC na próxima. ' : ''}${this.def.prep ? this.def.prep.say + ' ' : ''}Começo ${wait <= 1 ? 'agora' : `em ${wait} batidas`}, na virada da frase.`,
    );
    this.timer = window.setInterval(() => this.tick(), 20);
    return null;
  }

  /** Batida atual relativa ao "1" da transição. */
  beat(): number {
    const o = this.e.decks[this.out];
    return beatPosition(o.grid!, o.position()) - this.startBeat;
  }

  private tick() {
    const o = this.e.decks[this.out];
    if (!o.playing || !o.track) return this.stop(false);
    const b = this.beat();
    if (b >= -this.def.lead) this.state = 'tocando';
    this.def.cues.forEach((c, idx) => {
      if (!this.done.has(idx) && b >= c.at) {
        this.done.add(idx);
        c.run?.(this.e, this.out, this.inc);
        this.say(c.say);
      }
    });
    for (const l of this.def.lanes) {
      if (b >= l.from && b <= l.to + 0.25) l.apply(this.e, this.out, this.inc, Math.min(1, (b - l.from) / Math.max(0.001, l.to - l.from)));
    }
    if (b >= this.def.length) {
      // Limpa a que saiu (o público já não ouve) e encerra
      for (const k of ['low', 'mid', 'high', 'filter'] as const) this.e.setCh(k, this.out, 0);
      this.e.setCh('volume', this.out, 0.8);
      this.stop(true);
    }
  }

  stop(ok: boolean) {
    if (this.state === 'fim') return;
    clearInterval(this.timer);
    this.state = 'fim';
    this.onEnd(ok);
  }
}

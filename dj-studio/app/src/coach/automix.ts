// Automix que explica: escolhe a próxima música, carrega, sincroniza e faz a transição sozinho,
// contando o porquê de cada escolha. Serve de "aula assistida".

import { camelotMatch, syncRate } from '../audio/beat';
import type { AudioEngine, DeckId, Track } from '../audio/engine';
import { energyOf, suggestNext } from '../audio/suggest';
import { TRANSITIONS, type TransitionId } from './transitions';

export interface AutomixDeps {
  engine: AudioEngine;
  tracks: () => Track[];
  load: (d: DeckId, t: Track) => Promise<boolean>;
  say: (text: string) => void;
  /** Inicia uma transição; devolve um motivo se não deu. */
  run: (out: DeckId, inc: DeckId, id: TransitionId, onEnd: (ok: boolean) => void) => string | null;
}

export class Automix {
  on = false;
  private busy = false;
  private nextReady: string | null = null;
  private loading = false;

  constructor(private d: AutomixDeps) {}

  start() {
    this.on = true;
    this.busy = false;
    this.nextReady = null;
    this.d.say('Automix ligado. Eu escolho as músicas e faço as transições — preste atenção no que eu explico!');
  }

  stop() {
    this.on = false;
    this.d.say('Automix desligado. Agora é com você!');
  }

  /** Chamar periodicamente (~4x por segundo). */
  tick() {
    if (!this.on || this.busy || this.loading) return;
    const e = this.d.engine;
    const ids: DeckId[] = ['A', 'B'];
    let live = ids.filter((x) => e.decks[x].playing).sort((x, y) => e.audibility(y) - e.audibility(x))[0];
    if (!live) {
      const first = ids.find((x) => e.decks[x].track) ?? null;
      if (!first) return this.d.say('Carregue uma música num deck para o Automix começar.');
      e.set('crossfader', first === 'A' ? -1 : 1);
      e.decks[first].play();
      e.played.add(e.decks[first].track!.id);
      live = first;
      this.d.say(`Comecei pelo Deck ${first}: "${e.decks[first].track!.title}".`);
      return;
    }
    const out = e.decks[live];
    const incId: DeckId = live === 'A' ? 'B' : 'A';
    const t = out.track!;
    const beatLen = 60 / t.bpm;
    const remaining = (t.duration - out.position()) / beatLen;

    // 1) Escolhe e carrega a próxima
    if (!this.nextReady) {
      const all = this.d.tracks();
      const asS = (x: Track) => ({ id: x.id, bpm: x.bpm, key: x.key, genre: x.genre, energy: energyOf(x.waveform) });
      const ranked = suggestNext(asS(t), all.map(asS), e.played).filter((s) => !e.played.has(s.id));
      const pick = ranked[0] ? all.find((x) => x.id === ranked[0].id) : undefined;
      if (!pick) {
        this.on = false;
        return this.d.say('Toquei todas as músicas da biblioteca! Automix desligado. Adicione mais músicas para continuar.');
      }
      this.loading = true;
      this.d.load(incId, pick).then((ok) => {
        this.loading = false;
        if (!ok) return;
        this.nextReady = pick.id;
        const why = ranked[0].reasons.filter((r) => r !== 'já tocou');
        this.d.say(`Próxima: "${pick.title}" no Deck ${incId}${why.length ? ` — escolhi porque: ${why.join(', ')}` : ''}.`);
      });
      return;
    }

    // 2) Hora da transição
    const inc = e.decks[incId];
    if (!inc.track) return;
    const far = Math.abs(syncRate(inc.track.bpm, out.bpm, 1) - 1) > 0.16;
    const clash = camelotMatch(t.key, inc.track.key) === 'conflito';
    const id: TransitionId = far ? 'corte' : clash ? 'eco' : remaining > 100 ? 'suave' : 'filtro';
    const def = TRANSITIONS[id];
    if (remaining > def.lead + def.length + 40) return;
    this.busy = true;
    const reason = far
      ? 'os BPMs são muito diferentes, então vou de corte seco no 1'
      : clash
        ? 'os tons não combinam, então saio com eco em vez de misturar as melodias'
        : id === 'suave'
          ? 'BPM e tom combinam: dá para misturar com calma'
          : 'a música está acabando, então faço uma transição mais curta';
    this.d.say(`Hora de trocar: ${reason}.`);
    const err = this.d.run(live, incId, id, (ok) => {
      if (ok) {
        // A antiga já saiu do som: para e volta ao começo
        setTimeout(() => {
          out.pause();
          if (out.track) out.seek(out.track.firstBeat);
          out.synced = false;
        }, 1500);
        e.played.add(inc.track!.id);
      }
      this.nextReady = null;
      this.busy = false;
    });
    if (err) {
      this.busy = false;
      this.d.say(err);
    }
  }
}

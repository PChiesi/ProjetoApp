// Trilha de lições: cada passo é conferido automaticamente olhando o motor de áudio.
// A interface destaca o controle do passo (data-coach) e avança sozinha quando ela acerta.

import type { AudioEngine, DeckId, Track } from '../audio/engine';
import { beatInfo, camelotMatch } from '../audio/beat';
import type { SoundBank } from '../studio/sounds';

export interface LessonCtx {
  engine: AudioEngine;
  bank: SoundBank;
  tracks: Track[];
  /** Memória do passo atual (zera a cada passo). */
  mem: Record<string, number | boolean | string>;
  /** Segundos desde a última checagem. */
  dt: number;
}

export interface Step {
  text: string;
  target?: string;
  check: (c: LessonCtx) => boolean;
}

export interface Lesson {
  id: string;
  title: string;
  icon: string;
  /** Nível de interface necessário (libera os controles usados). */
  level: 1 | 2 | 3;
  goal: string;
  /** Prepara os decks para a lição (músicas certas, mixer zerado). */
  setup?: (c: { engine: AudioEngine; tracks: Track[]; load: (d: DeckId, t: Track) => void }) => void;
  steps: Step[];
}

const A = (c: LessonCtx) => c.engine.decks.A;
const B = (c: LessonCtx) => c.engine.decks.B;
const both = (c: LessonCtx) => A(c).playing && B(c).playing && c.engine.audibility('A') > 0.25 && c.engine.audibility('B') > 0.25;
/** Fica verdadeiro depois de `secs` segundos seguidos com `cond`. */
const hold = (c: LessonCtx, key: string, cond: boolean, secs: number) => {
  c.mem[key] = cond ? Number(c.mem[key] ?? 0) + c.dt : 0;
  return Number(c.mem[key]) >= secs;
};
const demo = (tracks: Track[], id: string) => tracks.find((t) => t.id === id);

function resetMixer(engine: AudioEngine) {
  for (const d of ['A', 'B'] as DeckId[]) {
    engine.decks[d].pause();
    engine.setCh('low', d, 0);
    engine.setCh('mid', d, 0);
    engine.setCh('high', d, 0);
    engine.setCh('filter', d, 0);
    engine.setCh('volume', d, 0.8);
    engine.setFx(d, { on: false });
    engine.decks[d].exitLoop();
  }
  engine.set('crossfader', -1);
}

const setupPair = (a: string, b: string) => (c: { engine: AudioEngine; tracks: Track[]; load: (d: DeckId, t: Track) => void }) => {
  resetMixer(c.engine);
  const ta = demo(c.tracks, a);
  const tb = demo(c.tracks, b);
  if (ta) c.load('A', ta);
  if (tb) c.load('B', tb);
};

export const LESSONS: Lesson[] = [
  {
    id: 'deck',
    title: 'Conhecendo o deck',
    icon: '▶',
    level: 1,
    goal: 'Tocar, voltar ao ponto de partida com o CUE e soltar de novo.',
    setup: setupPair('demo-pop', 'demo-rock'),
    steps: [
      { text: 'Aperte ▶ no Deck A para tocar a música.', target: 'play-A', check: (c) => A(c).playing },
      {
        text: 'Agora aperte CUE: a música volta para o ponto marcado e para. Esse é o "ponto de partida" da DJ.',
        target: 'cue-A',
        check: (c) => !A(c).playing && Math.abs(A(c).position() - A(c).cuePoint) < 0.05,
      },
      { text: 'Solte de novo com ▶. Pronto: você já sabe preparar uma música!', target: 'play-A', check: (c) => A(c).playing },
    ],
  },
  {
    id: 'crossfader',
    title: 'A primeira transição',
    icon: '⇄',
    level: 1,
    goal: 'Passar de uma música para a outra com o crossfader, sem silêncio.',
    setup: setupPair('demo-pop', 'demo-rock'),
    steps: [
      { text: 'Toque o Deck A (▶). O crossfader está todo para o lado A.', target: 'play-A', check: (c) => A(c).playing && c.engine.mix.crossfader < -0.8 },
      { text: 'Toque também o Deck B. O público ainda não ouve o B — o crossfader está no A.', target: 'play-B', check: (c) => B(c).playing },
      { text: 'Arraste o crossfader devagar até o MEIO: agora as duas tocam juntas.', target: 'crossfader', check: (c) => hold(c, 'mid', Math.abs(c.engine.mix.crossfader) < 0.2, 1.5) },
      { text: 'Continue até o lado B. Transição feita! 🎉', target: 'crossfader', check: (c) => c.engine.mix.crossfader > 0.85 },
    ],
  },
  {
    id: 'contar',
    title: 'Contando batidas e frases',
    icon: '🔢',
    level: 1,
    goal: 'Entender o 1-2-3-4 e as frases de 8 compassos (onde as músicas "viram").',
    setup: setupPair('demo-funk', 'demo-pop'),
    steps: [
      { text: 'Toque o Deck A e olhe o contador 1·2·3·4 dele: cada número é uma batida, 4 batidas = 1 compasso.', target: 'play-A', check: (c) => hold(c, 'p', A(c).playing, 3) },
      {
        text: 'Repare em "Compasso x/8": 8 compassos formam uma FRASE. Espere a próxima frase começar (Compasso 1/8, batida 1).',
        check: (c) => {
          const g = A(c).grid;
          if (!g || !A(c).playing) return false;
          const i = beatInfo(g, A(c).position());
          if (i.barInPhrase !== 1) c.mem.away = true;
          return !!c.mem.away && i.barInPhrase === 1 && i.beatInBar === 1;
        },
      },
      { text: 'Isso! Na onda, as linhas coloridas "FRASE" marcam esses pontos. As mudanças da música acontecem nelas.', check: (c) => hold(c, 'w', true, 3) },
    ],
  },
  {
    id: 'sync',
    title: 'Beatmatching com SYNC',
    icon: '🔗',
    level: 1,
    goal: 'Deixar duas músicas no mesmo BPM e com as batidas alinhadas.',
    setup: setupPair('demo-pop', 'demo-rock'),
    steps: [
      { text: 'Toque o Deck A.', target: 'play-A', check: (c) => A(c).playing },
      { text: 'O Deck B está em 124 BPM e o A em 120. Aperte SYNC no Deck B.', target: 'sync-B', check: (c) => B(c).synced && Math.abs(B(c).bpm - A(c).bpm) < 0.1 },
      { text: 'Toque o Deck B e leve o crossfader para o meio.', target: 'play-B', check: (c) => both(c) },
      { text: 'Ouça as duas juntas por 4 segundos: o medidor de batidas tem que ficar verde.', check: (c) => hold(c, 'al', both(c) && Math.abs(c.engine.phaseOffsetMs() ?? 99) < 20, 4) },
    ],
  },
  {
    id: 'ouvido',
    title: 'Alinhando de ouvido',
    icon: '👂',
    level: 2,
    goal: 'Fazer o que o SYNC faz, na mão — essencial no rock tocado ao vivo.',
    setup: setupPair('demo-pop', 'demo-rock'),
    steps: [
      { text: 'Toque os dois decks, com o crossfader no meio. Deixe o SYNC desligado.', check: (c) => both(c) && !B(c).synced },
      { text: 'Mexa no TEMPO do Deck B até ele ficar em 120.0 BPM, igual ao A.', target: 'play-B', check: (c) => !B(c).synced && Math.abs(B(c).bpm - A(c).bpm) < 0.15 },
      {
        text: 'Agora segure ◀ ou ▶ do Deck B até o medidor ficar verde (siga a setinha do texto do medidor).',
        target: 'nudge-B',
        check: (c) => hold(c, 'al', both(c) && Math.abs(c.engine.phaseOffsetMs() ?? 99) < 20, 3),
      },
    ],
  },
  {
    id: 'eq',
    title: 'Trocando os graves',
    icon: '🎚',
    level: 1,
    goal: 'Nunca deixar dois graves cheios juntos — o segredo de uma mixagem limpa.',
    setup: setupPair('demo-pop', 'demo-rock'),
    steps: [
      { text: 'Toque o Deck A. Aperte SYNC e ▶ no Deck B.', target: 'sync-B', check: (c) => A(c).playing && B(c).playing && B(c).synced },
      { text: 'Antes de trazer o B, gire o GRAVE do B todo para a esquerda (corta o bumbo e o baixo).', target: 'low', check: (c) => c.engine.mix.low.B < -18 },
      { text: 'Leve o crossfader para o meio.', target: 'crossfader', check: (c) => Math.abs(c.engine.mix.crossfader) < 0.25 },
      { text: 'Agora troque: corte o GRAVE do A e devolva o GRAVE do B (duplo clique volta ao centro).', target: 'low', check: (c) => c.engine.mix.low.A < -18 && c.engine.mix.low.B > -4 },
      { text: 'Termine levando o crossfader para o B. Transição de profissional! ✨', target: 'crossfader', check: (c) => c.engine.mix.crossfader > 0.85 },
    ],
  },
  {
    id: 'frase',
    title: 'Entrando no "1"',
    icon: '🎯',
    level: 1,
    goal: 'Soltar a próxima música exatamente no começo de uma frase.',
    setup: setupPair('demo-pop', 'demo-rock'),
    steps: [
      { text: 'Toque o Deck A e aperte SYNC no Deck B (sem tocar o B ainda).', target: 'sync-B', check: (c) => A(c).playing && B(c).synced && !B(c).playing },
      {
        text: 'Quando o Deck A estiver no "Compasso 8/8", prepare o dedo… e solte o B (▶) no 1 da frase nova!',
        target: 'play-B',
        check: (c) => {
          if (!B(c).playing) {
            c.mem.armed = true;
            return false;
          }
          if (!c.mem.armed) return false;
          if (c.mem.judged === undefined) {
            const g = A(c).grid!;
            const i = beatInfo(g, A(c).position());
            c.mem.judged = i.barInPhrase === 1 && i.beatInBar === 1;
          }
          if (!c.mem.judged) {
            // errou: pausa o B e deixa tentar de novo
            B(c).pause();
            B(c).seek(B(c).cuePoint);
            c.mem.armed = false;
            delete c.mem.judged;
            c.mem.tries = Number(c.mem.tries ?? 0) + 1;
          }
          return !!c.mem.judged;
        },
      },
      { text: 'Na mosca! As duas frases começaram juntas.', check: (c) => hold(c, 'w', true, 2) },
    ],
  },
  {
    id: 'loop',
    title: 'Loops para ganhar tempo',
    icon: '🔁',
    level: 2,
    goal: 'Repetir um trecho no ritmo para estender a música enquanto prepara a próxima.',
    setup: setupPair('demo-funk', 'demo-mandelao'),
    steps: [
      { text: 'Toque o Deck A.', target: 'play-A', check: (c) => A(c).playing },
      { text: 'Na aba LOOP dos pads do Deck A, aperte "8": um loop de 8 batidas.', check: (c) => A(c).loop?.beats === 8 },
      { text: 'Escute o loop dar duas voltas — o ritmo não "tropeça".', check: (c) => hold(c, 'l', !!A(c).loop && A(c).playing, (2 * 8 * 60) / (A(c).bpm || 120)) },
      { text: 'Saia do loop (aperte "8" de novo ou "Sair").', check: (c) => !A(c).loop && A(c).playing },
    ],
  },
  {
    id: 'hotcue',
    title: 'Hot cues',
    icon: '🎯',
    level: 2,
    goal: 'Marcar pontos da música e pular para eles sem perder o ritmo.',
    setup: setupPair('demo-funk', 'demo-pop'),
    steps: [
      { text: 'Toque o Deck A e marque o hot cue 1 (pad vazio = marca o ponto).', check: (c) => A(c).playing && A(c).track?.hotCues[0] != null },
      { text: 'Espere uns segundos e marque o hot cue 2.', check: (c) => A(c).track?.hotCues[1] != null },
      {
        text: 'Aperte o hot cue 1: a música pula para lá, sem sair do ritmo.',
        check: (c) => {
          const hc = A(c).track?.hotCues[0];
          if (hc == null) return false;
          const p = A(c).position();
          const was = Number(c.mem.last ?? p);
          c.mem.last = p;
          return was - p > 1 && Math.abs(p - hc) < 1;
        },
      },
    ],
  },
  {
    id: 'saida-eco',
    title: 'Saída com eco',
    icon: '◎',
    level: 2,
    goal: 'Sair de uma música com estilo: o eco continua quando o volume some.',
    setup: setupPair('demo-pop', 'demo-funk'),
    steps: [
      { text: 'Toque o Deck A. No FX do Deck A, escolha "Eco" e aperte LIGAR.', check: (c) => A(c).playing && c.engine.fx.A.on && c.engine.fx.A.type === 'eco' },
      { text: 'Agora abaixe o volume do Deck A até o fim. Ouça o eco ficando no ar.', check: (c) => c.engine.mix.volume.A < 0.05 },
      { text: 'Desligue o efeito. Repare: o eco vai sumindo sozinho, sem corte.', check: (c) => !c.engine.fx.A.on },
    ],
  },
  {
    id: 'harmonia',
    title: 'Mixagem harmônica',
    icon: '🎼',
    level: 1,
    goal: 'Escolher a próxima música por tom, para as melodias não "brigarem".',
    setup: setupPair('demo-pop', 'demo-mandelao'),
    steps: [
      { text: 'Veja o TOM do Deck A (8A). Na biblioteca, os tons em verde combinam com o que está tocando.', check: (c) => hold(c, 'w', true, 3) },
      {
        text: 'Use o filtro "Combinam com A" e carregue no Deck B uma música DIFERENTE que combine com o A.',
        check: (c) => {
          const a = A(c).track;
          const b = B(c).track;
          if (c.mem.start === undefined) {
            c.mem.start = b?.id ?? '';
            return false;
          }
          return !!a && !!b && a.id !== b.id && b.id !== c.mem.start && camelotMatch(a.key, b.key) === 'ok';
        },
      },
    ],
  },
  {
    id: 'corte',
    title: 'Corte seco no funk (130 → 150)',
    icon: '✂',
    level: 1,
    goal: 'Quando o BPM é muito diferente, a transição é um corte certeiro no "1".',
    setup: setupPair('demo-funk', 'demo-mandelao'),
    steps: [
      { text: 'Toque o Deck A (tamborzão, 130 BPM).', target: 'play-A', check: (c) => A(c).playing },
      { text: 'Toque o Deck B (150 BPM) com o crossfader todo no A — o público ainda não ouve.', target: 'play-B', check: (c) => B(c).playing && c.engine.mix.crossfader < -0.8 },
      {
        text: 'No "1" de uma frase do Deck A, passe o crossfader de uma vez para o B (rápido!).',
        target: 'crossfader',
        check: (c) => {
          const x = c.engine.mix.crossfader;
          if (x < -0.8) c.mem.t = 0;
          else c.mem.t = Number(c.mem.t ?? 0) + c.dt;
          return x > 0.8 && Number(c.mem.t) < 0.6;
        },
      },
    ],
  },
  {
    id: 'vinheta',
    title: 'Minha vinheta',
    icon: '🎤',
    level: 1,
    goal: 'Gravar a sua vinheta e soltar no meio da música, como as DJs de funk.',
    steps: [
      { text: 'Abra o ✂ Estúdio e clique em "🎤 Gravar vinheta". Grave o seu nome de DJ!', target: 'studio-tab', check: (c) => c.bank.all().some((s) => s.user) },
      { text: 'Volte para 🎧 Tocar, toque uma música e solte a vinheta no SAMPLER (o pad roxo).', check: (c) => (A(c).playing || B(c).playing) && Number(c.mem.sampler ?? 0) > 0 },
    ],
  },
  {
    id: 'edit',
    title: 'Minha primeira edit',
    icon: '✂',
    level: 1,
    goal: 'Fazer a sua versão estendida de uma música no Estúdio.',
    steps: [
      { text: 'Clique em ✎ ao lado de uma música da biblioteca para abrir no Estúdio.', target: 'studio-tab', check: (c) => c.mem.view === 'studio' },
      {
        text: 'Aperte "Intro +8" (repete o começo: mais tempo para mixar) e depois "✔ Salvar na biblioteca".',
        check: (c) => {
          const n = c.tracks.filter((t) => / \(Edit\)$/.test(t.title)).length;
          if (c.mem.edits === undefined) c.mem.edits = n;
          return n > Number(c.mem.edits);
        },
      },
    ],
  },
  {
    id: 'set',
    title: 'Gravando um set',
    icon: '⏺',
    level: 1,
    goal: 'Gravar uma mixagem inteira para ouvir depois e evoluir.',
    steps: [
      { text: 'Aperte ● REC no topo da tela.', target: 'rec', check: (c) => c.engine.recording },
      { text: 'Toque e faça pelo menos uma transição (2 minutos de gravação).', check: (c) => hold(c, 'r', c.engine.recording, 120) },
      { text: 'Aperte REC de novo para salvar. Escute depois com calma!', target: 'rec', check: (c) => !c.engine.recording },
    ],
  },
];

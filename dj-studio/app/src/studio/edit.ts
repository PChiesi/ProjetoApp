// Estúdio: modelo de edição NÃO destrutivo.
// O projeto é uma "receita": uma lista de blocos (trechos da música original) tocados em sequência.
// Como todos os cortes caem no grid, o ritmo continua perfeito depois de cortar, repetir ou mover.

export interface Block {
  id: number;
  /** Início e fim no áudio original (s). */
  start: number;
  end: number;
}

export interface Clip {
  id: number;
  name: string;
  blocks: Block[];
}

/** Um som (vinheta, buzina…) colocado num ponto da linha do tempo. */
export interface SoundEvent {
  id: number;
  soundId: string;
  at: number;
  gain: number; // 0..1.5
  /** Faixa de sons onde está. */
  lane: string;
}

/** Volume, mudo e solo de uma faixa. */
export interface Mix {
  volume: number; // 0..1.5
  mute: boolean;
  solo: boolean;
}
export const defaultMix = (): Mix => ({ volume: 1, mute: false, solo: false });

export interface SoundLane extends Mix {
  id: string;
  name: string;
}

/** Em que os efeitos de uma faixa de efeitos agem: tudo, a música principal ou uma faixa de música extra. */
export type FxTarget = string; // 'mix' | 'main' | id de uma camada

export interface FxLane {
  id: string;
  name: string;
  target: FxTarget;
}

export type PartMode = 'tudo' | 'vocal' | 'instrumental' | 'batida';

/** Um trecho de outra música posicionado na linha do tempo. */
export interface LayerClip {
  id: number;
  /** Onde começa na linha do tempo do projeto (s). */
  at: number;
  /** Trecho do áudio de origem (s). */
  start: number;
  end: number;
  gain: number;
}

/** Faixa de música extra (outra música, ou só o vocal / instrumental dela). */
export interface Layer extends Mix {
  id: string;
  name: string;
  trackId: string;
  part: PartMode;
  /** Tempo da música de origem: a faixa é acelerada/freada para o BPM do projeto (sem mudar o tom). */
  bpm: number;
  firstBeat: number;
  duration: number;
  /** Velocidade para tocar no BPM do projeto (BPM do projeto ÷ BPM da música). */
  rate: number;
  clips: LayerClip[];
}

export type FxType = 'eco' | 'reverb' | 'abafar' | 'subida' | 'gate' | 'freio' | 'reverse' | 'corte';

/** Um efeito "pintado" sobre um trecho da linha do tempo. */
export interface FxRegion {
  id: number;
  type: FxType;
  t0: number;
  t1: number;
  /** Faixa de efeitos onde está (ela define em que o efeito age). */
  lane: string;
}

export const FX_INFO: Record<FxType, { name: string; icon: string; color: string; desc: string }> = {
  eco: { name: 'Eco', icon: '◎', color: '#22d3ee', desc: 'Repete o som no tempo da música; o eco continua depois do trecho.' },
  reverb: { name: 'Reverb', icon: '≋', color: '#818cf8', desc: 'Som de "salão grande".' },
  abafar: { name: 'Abafar', icon: '▽', color: '#60a5fa', desc: 'Filtro que vai tirando os agudos, como música vindo de outra sala.' },
  subida: { name: 'Subida', icon: '△', color: '#fbbf24', desc: 'Tira os graves aos poucos e cria tensão antes do drop.' },
  gate: { name: 'Picotar', icon: '▤', color: '#f472b6', desc: 'Liga e desliga o som em 1/8 de batida (efeito "gaguejando").' },
  freio: { name: 'Freio', icon: '⏬', color: '#fb923c', desc: 'Como um vinil parando.' },
  reverse: { name: 'Ao contrário', icon: '⟲', color: '#a3e635', desc: 'Toca o trecho de trás para frente.' },
  corte: { name: 'Corte', icon: '✕', color: '#f87171', desc: 'Silêncio total — o "corte seco" do funk antes de voltar no 1.' },
};

export interface EditProject {
  trackId: string;
  blocks: Block[];
  /** Fade de entrada e de saída (s). */
  fadeIn: number;
  fadeOut: number;
  palette: Clip[];
  sounds: SoundEvent[];
  effects: FxRegion[];
  /** Volume da música principal. */
  main: Mix;
  layers: Layer[];
  soundLanes: SoundLane[];
  fxLanes: FxLane[];
  /** Volume geral (0..1.5). */
  master: number;
}

export interface Grid {
  bpm: number;
  firstBeat: number;
}

export type SectionKind = 'intro' | 'parte' | 'break' | 'outro';
export interface Section {
  start: number;
  end: number;
  kind: SectionKind;
  name: string;
}

let nextId = 1;
export const newId = () => nextId++;

export function newProject(trackId: string, duration: number): EditProject {
  return {
    trackId,
    blocks: [{ id: newId(), start: 0, end: duration }],
    fadeIn: 0,
    fadeOut: 0,
    palette: [],
    sounds: [],
    effects: [],
    main: defaultMix(),
    layers: [],
    soundLanes: [{ id: 's1', name: 'Sons 1', ...defaultMix() }],
    fxLanes: [{ id: 'f1', name: 'Efeitos 1', target: 'main' }],
    master: 1,
  };
}

export const blockLen = (b: Block) => b.end - b.start;
export const projectLength = (p: { blocks: Block[] }) => p.blocks.reduce((a, b) => a + blockLen(b), 0);
export const barLen = (g: Grid) => (4 * 60) / g.bpm;

/** Onde começa cada bloco na linha do tempo. */
export function blockStarts(blocks: Block[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const b of blocks) {
    out.push(t);
    t += blockLen(b);
  }
  return out;
}

/** Encaixa um tempo da linha do tempo no grid (compasso ou batida). As pontas também valem. */
export function snapTime(t: number, g: Grid, unit: 'bar' | 'beat', total: number): number {
  const u = unit === 'bar' ? barLen(g) : 60 / g.bpm;
  const k = Math.round((t - g.firstBeat) / u);
  let s = g.firstBeat + k * u;
  if (s < 0) s = 0;
  if (Math.abs(t - total) < Math.abs(t - s)) s = total;
  if (Math.abs(t) < Math.abs(t - s)) s = 0;
  return Math.max(0, Math.min(total, s));
}

const EPS = 1e-4;

/** Divide o bloco que contém `t` (linha do tempo). Retorna nova lista. */
export function splitAt(blocks: Block[], t: number): Block[] {
  const starts = blockStarts(blocks);
  const out: Block[] = [];
  blocks.forEach((b, i) => {
    const s = starts[i];
    const e = s + blockLen(b);
    if (t > s + EPS && t < e - EPS) {
      const cut = b.start + (t - s);
      out.push({ id: newId(), start: b.start, end: cut }, { id: newId(), start: cut, end: b.end });
    } else out.push(b);
  });
  return out;
}

/** Índices [i0, i1) dos blocos exatamente dentro de [t0, t1] depois de dividir. */
function isolate(blocks: Block[], t0: number, t1: number): { blocks: Block[]; i0: number; i1: number } {
  let bs = splitAt(splitAt(blocks, t0), t1);
  const starts = blockStarts(bs);
  let i0 = bs.length;
  let i1 = bs.length;
  for (let i = 0; i < bs.length; i++) {
    if (i0 === bs.length && starts[i] >= t0 - EPS) i0 = i;
    if (starts[i] >= t1 - EPS) {
      i1 = i;
      break;
    }
  }
  if (i1 < i0) i1 = i0;
  return { blocks: bs, i0, i1 };
}

export function copyRange(p: EditProject, t0: number, t1: number): Block[] {
  const { blocks, i0, i1 } = isolate(p.blocks, t0, t1);
  return blocks.slice(i0, i1).map((b) => ({ ...b, id: newId() }));
}

export function deleteRange(p: EditProject, t0: number, t1: number): EditProject {
  const { blocks, i0, i1 } = isolate(p.blocks, t0, t1);
  const rest = [...blocks.slice(0, i0), ...blocks.slice(i1)];
  if (!rest.length) return p; // não deixa a música vazia
  const len = t1 - t0;
  // Sons e efeitos acompanham a música: os do trecho apagado somem, os de depois andam para trás.
  const sounds = (p.sounds ?? []).filter((e) => e.at < t0 - EPS || e.at >= t1 - EPS).map((e) => (e.at >= t1 - EPS ? { ...e, at: e.at - len } : e));
  const effects = (p.effects ?? [])
    .map((f) => {
      const shift = (t: number) => (t <= t0 ? t : t >= t1 ? t - len : t0);
      return { ...f, t0: shift(f.t0), t1: shift(f.t1) };
    })
    .filter((f) => f.t1 - f.t0 > EPS);
  return { ...p, blocks: rest, sounds, effects, layers: rippleDelete(p, t0, t1) };
}

export function insertAt(p: EditProject, t: number, ins: Block[]): EditProject {
  const bs = splitAt(p.blocks, t);
  const starts = blockStarts(bs);
  let i = bs.length;
  for (let k = 0; k < bs.length; k++) if (starts[k] >= t - EPS) {
    i = k;
    break;
  }
  const copies = ins.map((b) => ({ ...b, id: newId() }));
  const len = ins.reduce((a, b) => a + blockLen(b), 0);
  const sounds = (p.sounds ?? []).map((e) => (e.at >= t - EPS ? { ...e, at: e.at + len } : e));
  const effects = (p.effects ?? []).map((f) => ({ ...f, t0: f.t0 >= t - EPS ? f.t0 + len : f.t0, t1: f.t1 > t + EPS ? f.t1 + len : f.t1 }));
  const layers = (p.layers ?? []).map((l) => ({ ...l, clips: l.clips.map((c) => (c.at >= t - EPS ? { ...c, at: c.at + len } : c)) }));
  return { ...p, blocks: [...bs.slice(0, i), ...copies, ...bs.slice(i)], sounds, effects, layers };
}

export function duplicateRange(p: EditProject, t0: number, t1: number): EditProject {
  return insertAt(p, t1, copyRange(p, t0, t1));
}

/** Estende a intro repetindo os primeiros `bars` compassos a partir do "1". */
export function extendIntro(p: EditProject, g: Grid, bars: number): EditProject {
  const t0 = g.firstBeat;
  const t1 = Math.min(projectLength(p), t0 + bars * barLen(g));
  return duplicateRange(p, t0, t1);
}

/** Estende o final repetindo os últimos `bars` compassos completos. */
export function extendOutro(p: EditProject, g: Grid, bars: number): EditProject {
  const len = projectLength(p);
  const bl = barLen(g);
  const lastBar = g.firstBeat + Math.floor((len - g.firstBeat) / bl + EPS) * bl;
  const t0 = Math.max(g.firstBeat, lastBar - bars * bl);
  return duplicateRange(p, t0, lastBar);
}

/** Converte uma posição da linha do tempo no ponto correspondente do áudio original. */
export function toSource(p: { blocks: Block[] }, t: number): number {
  const starts = blockStarts(p.blocks);
  for (let i = p.blocks.length - 1; i >= 0; i--) {
    if (t >= starts[i] - EPS) return p.blocks[i].start + Math.min(blockLen(p.blocks[i]), t - starts[i]);
  }
  return 0;
}

// ---------- seções ----------

/**
 * Seções automáticas em frases de 8 compassos, pela energia (graves + médios):
 * frases fracas no meio = breakdown; antes do primeiro trecho forte = intro; depois do último = outro.
 */
export function detectSections(wf: { low: Float32Array; mid: Float32Array; rate: number }, g: Grid, duration: number): Section[] {
  const { low, mid, rate } = wf;
  const phrase = 8 * barLen(g);
  const out: { start: number; end: number; e: number }[] = [];
  if (g.firstBeat > 0.05) out.push({ start: 0, end: g.firstBeat, e: 0 });
  for (let s = g.firstBeat; s < duration - 0.5; s += phrase) {
    const e = Math.min(duration, s + phrase);
    let sum = 0;
    let n = 0;
    for (let i = Math.floor(s * rate); i < Math.floor(e * rate) && i < low.length; i++) {
      sum += low[i] + mid[i];
      n++;
    }
    // Sobra no fim menor que meia frase: junta com a anterior.
    if (e - s < phrase / 2 && out.length) out[out.length - 1].end = e;
    else out.push({ start: s, end: e, e: n ? sum / n : 0 });
  }
  const es = out.map((x) => x.e).sort((a, b) => a - b);
  const median = es[Math.floor(es.length / 2)] || 0;
  const max = es[es.length - 1] || 1;
  const strong = (x: { e: number }) => x.e >= max * 0.86;
  const firstStrong = out.findIndex(strong);
  let lastStrong = -1;
  for (let i = out.length - 1; i >= 0; i--) if (strong(out[i])) {
    lastStrong = i;
    break;
  }
  return out.map((x, i) => {
    let kind: SectionKind;
    if (i < firstStrong) kind = 'intro';
    else if (i > lastStrong) kind = 'outro';
    else if (x.e < median * 0.6) kind = 'break';
    else kind = 'parte';
    return { start: x.start, end: x.end, kind, name: SECTION_NAMES[kind] };
  });
}

export const SECTION_NAMES: Record<SectionKind, string> = {
  intro: 'Intro',
  parte: 'Parte',
  break: 'Breakdown',
  outro: 'Outro',
};

// ---------- modelos de um clique ----------

export type TemplateId = 'estendida' | 'radio' | 'baile';

export const TEMPLATES: { id: TemplateId; name: string; desc: string }[] = [
  { id: 'estendida', name: 'Versão estendida', desc: 'Intro e final 16 compassos mais longos: tempo de sobra para mixar.' },
  { id: 'radio', name: 'Versão rádio', desc: 'Tira o breakdown e termina com fade perto de 3 minutos.' },
  { id: 'baile', name: 'Pro baile', desc: 'Tira os breakdowns: a energia não cai na pista.' },
];

export function applyTemplate(id: TemplateId, trackId: string, duration: number, g: Grid, sections: Section[]): EditProject {
  let p = newProject(trackId, duration);
  const breaks = sections.filter((s) => s.kind === 'break');
  if (id === 'estendida') {
    p = extendOutro(extendIntro(p, g, 16), g, 16);
  } else {
    // Apaga do fim para o começo, para os tempos anteriores continuarem válidos.
    const toRemove = id === 'radio' ? breaks.slice(0, 1) : breaks;
    for (const s of [...toRemove].reverse()) p = deleteRange(p, s.start, s.end);
    if (id === 'radio') {
      const len = projectLength(p);
      const phrase = 8 * barLen(g);
      if (len > 200) {
        // corta na virada de frase mais perto de 3:00 e faz fade de 4 compassos
        const k = Math.max(1, Math.round((180 - g.firstBeat) / phrase));
        const cut = Math.min(len, g.firstBeat + k * phrase);
        p = deleteRange(p, cut, len);
      }
      p = { ...p, fadeOut: 4 * barLen(g) };
    }
  }
  return p;
}

// ---------- sons e efeitos ----------

const firstSoundLane = (p: EditProject) => p.soundLanes[0]?.id ?? 's1';
const firstFxLane = (p: EditProject) => p.fxLanes[0]?.id ?? 'f1';

export function addSound(p: EditProject, soundId: string, at: number, gain = 1, lane?: string): EditProject {
  return { ...p, sounds: [...p.sounds, { id: newId(), soundId, at, gain, lane: lane ?? firstSoundLane(p) }] };
}

export function addEffect(p: EditProject, type: FxType, t0: number, t1: number, lane?: string): EditProject {
  if (t1 - t0 < EPS) return p;
  const ln = lane ?? firstFxLane(p);
  // O mesmo efeito por cima de outro igual, na mesma faixa: substitui a parte sobreposta.
  const others = p.effects.filter((f) => f.type !== type || f.lane !== ln || f.t1 <= t0 || f.t0 >= t1);
  return { ...p, effects: [...others, { id: newId(), type, t0, t1, lane: ln }].sort((a, b) => a.t0 - b.t0) };
}

export function removeItem(p: EditProject, id: number): EditProject {
  return {
    ...p,
    sounds: p.sounds.filter((s) => s.id !== id),
    effects: p.effects.filter((f) => f.id !== id),
    layers: p.layers.map((l) => ({ ...l, clips: l.clips.filter((c) => c.id !== id) })),
  };
}

/** Muda o volume de um som ou de um trecho de música. */
export function setItemGain(p: EditProject, id: number, gain: number): EditProject {
  const g = Math.max(0, Math.min(1.5, gain));
  return {
    ...p,
    sounds: p.sounds.map((s) => (s.id === id ? { ...s, gain: g } : s)),
    layers: p.layers.map((l) => ({ ...l, clips: l.clips.map((c) => (c.id === id ? { ...c, gain: g } : c)) })),
  };
}

/** Move um efeito no tempo (mantém o tamanho) e/ou para outra faixa de efeitos. */
export function moveEffect(p: EditProject, id: number, t0: number, lane?: string): EditProject {
  return {
    ...p,
    effects: p.effects.map((f) => (f.id === id ? { ...f, t0: Math.max(0, t0), t1: Math.max(0, t0) + (f.t1 - f.t0), lane: lane ?? f.lane } : f)).sort((a, b) => a.t0 - b.t0),
  };
}

export function moveSound(p: EditProject, id: number, at: number, lane?: string): EditProject {
  return { ...p, sounds: p.sounds.map((s) => (s.id === id ? { ...s, at: Math.max(0, at), lane: lane ?? s.lane } : s)) };
}

// ---------- faixas ----------

let laneCounter = 1;
const laneId = (prefix: string) => `${prefix}${Date.now().toString(36)}${laneCounter++}`;

export function addSoundLane(p: EditProject): EditProject {
  return { ...p, soundLanes: [...p.soundLanes, { id: laneId('s'), name: `Sons ${p.soundLanes.length + 1}`, ...defaultMix() }] };
}

export function addFxLane(p: EditProject, target: FxTarget = 'mix'): EditProject {
  return { ...p, fxLanes: [...p.fxLanes, { id: laneId('f'), name: `Efeitos ${p.fxLanes.length + 1}`, target }] };
}

export function removeSoundLane(p: EditProject, id: string): EditProject {
  if (p.soundLanes.length <= 1) return p;
  return { ...p, soundLanes: p.soundLanes.filter((l) => l.id !== id), sounds: p.sounds.filter((s) => s.lane !== id) };
}

export function removeFxLane(p: EditProject, id: string): EditProject {
  if (p.fxLanes.length <= 1) return p;
  return { ...p, fxLanes: p.fxLanes.filter((l) => l.id !== id), effects: p.effects.filter((f) => f.lane !== id) };
}

/** Atualiza volume/mudo/solo (ou nome/alvo) de qualquer faixa. 'main' = música principal. */
export function updateLane(p: EditProject, id: string, patch: Partial<Mix> & { name?: string; target?: FxTarget }): EditProject {
  if (id === 'main') return { ...p, main: { ...p.main, ...patch } };
  return {
    ...p,
    layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    soundLanes: p.soundLanes.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    fxLanes: p.fxLanes.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  };
}

export const clipLength = (c: LayerClip, rate: number) => (c.end - c.start) / rate;

export interface LayerSource {
  trackId: string;
  name: string;
  part: PartMode;
  bpm: number;
  firstBeat: number;
  duration: number;
}

/** Nova faixa de música: a música inteira, começando no "1" dela, no ponto `at`. */
export function addLayer(p: EditProject, g: Grid, src: LayerSource, at: number): EditProject {
  const id = laneId('m');
  const clip: LayerClip = { id: newId(), at, start: src.firstBeat, end: src.duration, gain: 1 };
  // Dobro/metade de BPM (75 ↔ 150) conta como o mesmo andamento
  let rate = g.bpm / (src.bpm || g.bpm);
  if (rate > 1.5) rate /= 2;
  else if (rate < 0.75) rate *= 2;
  return { ...p, layers: [...p.layers, { id, ...src, ...defaultMix(), rate, clips: [clip] }] };
}

export function removeLayer(p: EditProject, id: string): EditProject {
  return {
    ...p,
    layers: p.layers.filter((l) => l.id !== id),
    // faixas de efeitos que agiam nela passam a agir em tudo
    fxLanes: p.fxLanes.map((f) => (f.target === id ? { ...f, target: 'mix' } : f)),
  };
}

export function moveClip(p: EditProject, layerId: string, clipId: number, at: number): EditProject {
  return { ...p, layers: p.layers.map((l) => (l.id !== layerId ? l : { ...l, clips: l.clips.map((c) => (c.id === clipId ? { ...c, at: Math.max(0, at) } : c)) })) };
}

/** Divide um trecho no ponto `t` da linha do tempo. */
export function splitClip(p: EditProject, layerId: string, clipId: number, t: number): EditProject {
  return {
    ...p,
    layers: p.layers.map((l) => {
      if (l.id !== layerId) return l;
      const r = l.rate;
      const clips: LayerClip[] = [];
      for (const c of l.clips) {
        const end = c.at + clipLength(c, r);
        if (c.id === clipId && t > c.at + EPS && t < end - EPS) {
          const cut = c.start + (t - c.at) * r;
          clips.push({ ...c, end: cut }, { ...c, id: newId(), at: t, start: cut });
        } else clips.push(c);
      }
      return { ...l, clips };
    }),
  };
}

/** Apagar um trecho da música principal também "puxa" as faixas extras para a esquerda. */
function rippleDelete(p: EditProject, t0: number, t1: number): Layer[] {
  const len = t1 - t0;
  return (p.layers ?? []).map((l) => {
    const clips: LayerClip[] = [];
    for (const c of l.clips) {
      if (c.at >= t1 - EPS) clips.push({ ...c, at: c.at - len });
      else if (c.at >= t0 - EPS) {
        // começava dentro do trecho apagado: perde o pedaço apagado e passa a começar em t0
        clips.push({ ...c, at: t0, start: c.start + (t1 - c.at) * l.rate });
      } else clips.push(c);
    }
    return { ...l, clips: clips.filter((c) => c.end - c.start > EPS) };
  });
}

/** Onde o projeto termina (música principal, faixas extras e sons). */
export function timelineEnd(p: EditProject, g: Grid, soundDur: (id: string) => number = () => 0): number {
  let end = projectLength(p);
  void g;
  for (const l of p.layers) for (const c of l.clips) end = Math.max(end, c.at + clipLength(c, l.rate));
  for (const s of p.sounds) end = Math.max(end, s.at + soundDur(s.soundId));
  return end;
}

/** Volume efetivo de uma faixa considerando mudo e solo de todas. */
export function effectiveVolume(p: EditProject, m: Mix): number {
  const anySolo = p.main.solo || p.layers.some((l) => l.solo) || p.soundLanes.some((l) => l.solo);
  if (m.mute || (anySolo && !m.solo)) return 0;
  return m.volume;
}

/** "Saída com eco": eco no último compasso e corte depois — o eco "voa" sozinho no final. */
export function echoOut(p: EditProject, g: Grid, at: number, lane?: string): EditProject {
  const b = barLen(g);
  return addEffect(addEffect(p, 'eco', Math.max(0, at - b), at, lane), 'corte', at, Math.min(projectLength(p), at + 2 * b), lane);
}

/** "Subida pro drop": 4 compassos de subida terminando no ponto do drop. */
export function buildUp(p: EditProject, g: Grid, drop: number, riserId?: string, lane?: string): EditProject {
  const b = barLen(g);
  const t0 = Math.max(0, drop - 4 * b);
  let q = addEffect(p, 'subida', t0, drop, lane);
  if (riserId) q = addSound(q, riserId, t0, 0.8);
  return q;
}

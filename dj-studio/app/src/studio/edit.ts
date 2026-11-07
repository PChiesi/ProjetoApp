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

export interface EditProject {
  trackId: string;
  blocks: Block[];
  /** Fade de entrada e de saída (s). */
  fadeIn: number;
  fadeOut: number;
  palette: Clip[];
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
const newId = () => nextId++;

export function newProject(trackId: string, duration: number): EditProject {
  return { trackId, blocks: [{ id: newId(), start: 0, end: duration }], fadeIn: 0, fadeOut: 0, palette: [] };
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
  return { ...p, blocks: rest };
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
  return { ...p, blocks: [...bs.slice(0, i), ...copies, ...bs.slice(i)] };
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

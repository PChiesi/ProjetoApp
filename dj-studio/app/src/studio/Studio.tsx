import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine, Track } from '../audio/engine';
import { trackFromBuffer, AUDIO_ACCEPT } from '../audio/library';
import { createShifter } from '../audio/keylock';
import { fmtTime, useFrame } from '../hooks';
import {
  addEffect,
  addFxLane,
  addLayer,
  addSound,
  addSoundLane,
  applyTemplate,
  barLen,
  blockStarts,
  buildUp,
  clipLength,
  copyRange,
  deleteRange,
  duplicateRange,
  echoOut,
  extendIntro,
  extendOutro,
  FX_INFO,
  insertAt,
  moveClip,
  moveEffect,
  moveSound,
  newProject,
  projectLength,
  removeFxLane,
  removeItem,
  removeLayer,
  removeSoundLane,
  setItemGain,
  snapTime,
  splitClip,
  TEMPLATES,
  timelineEnd,
  toSource,
  updateLane,
  type EditProject,
  type FxType,
  type Grid,
  type Mix,
  type PartMode,
  type Section,
  type SectionKind,
} from './edit';
import { saveFile } from '../platform';
import { encodeWav, renderProject, StudioPlayer, type RenderOpts } from './render';
import { trimAndNormalize, type SoundAsset, type SoundBank } from './sounds';
import { VinhetaRecorder } from './VinhetaRecorder';
import { hasStems, PART_LABEL, PART_SHORT, partBuffer } from './parts';

const PART_SUFFIX: Record<PartMode, string> = { tudo: 'Edit', vocal: 'Acapella', instrumental: 'Instrumental', batida: 'Batida' };
const LAYER_COLORS = ['#f472b6', '#52e3a4', '#fbbf24', '#a78bfa', '#60a5fa', '#fb923c'];

interface Props {
  engine: AudioEngine;
  track: Track;
  library: Track[];
  onExit: () => void;
  onSaved: (t: Track) => void;
  toast: (text: string) => void;
  bank: SoundBank;
  onUserSound: (s: SoundAsset) => void;
  onRemoveUserSound: (id: string) => void;
}

const SECTION_COLORS: Record<SectionKind, string> = {
  intro: '#22d3ee',
  parte: '#a78bfa',
  break: '#fbbf24',
  outro: '#f472b6',
};
const WAVE = { low: '#4d7cff', mid: '#ffb03b', high: '#f4f1ff' };
const FADE_BARS = [0, 1, 2, 4, 8];

type Sel = { t0: number; t1: number } | null;
type RowKind = 'ruler' | 'sections' | 'main' | 'layer' | 'sound' | 'fx';
interface Row {
  kind: RowKind;
  id: string;
  y: number;
  h: number;
}
type ItemSel = { kind: 'sound' | 'fx' | 'clip'; id: number; layerId?: string } | null;

const H: Record<RowKind, number> = { ruler: 22, sections: 20, main: 100, layer: 62, sound: 32, fx: 30 };

function layoutRows(p: EditProject): Row[] {
  const rows: Row[] = [];
  let y = 0;
  const push = (kind: RowKind, id: string) => {
    rows.push({ kind, id, y, h: H[kind] });
    y += H[kind];
  };
  push('ruler', 'ruler');
  push('sections', 'sections');
  push('main', 'main');
  for (const l of p.layers) push('layer', l.id);
  for (const l of p.soundLanes) push('sound', l.id);
  for (const l of p.fxLanes) push('fx', l.id);
  return rows;
}

export function Studio({ engine, track, library, onExit, onSaved, toast, bank, onUserSound, onRemoveUserSound }: Props) {
  const grid: Grid = { bpm: track.bpm, firstBeat: track.firstBeat };
  const bar = barLen(grid);
  const [project, setProject] = useState<EditProject>(() => newProject(track.id, track.duration));
  const past = useRef<EditProject[]>([]);
  const future = useRef<EditProject[]>([]);
  const lastCoalesce = useRef<{ key: string; t: number }>({ key: '', t: 0 });
  const [sel, setSel] = useState<Sel>(null);
  const [cursor, setCursor] = useState(0);
  const [unit, setUnit] = useState<'bar' | 'beat'>('bar');
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const player = useMemo(() => new StudioPlayer(engine.ctx, engine.studioOut), [engine]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const clipCount = useRef(0);
  const [selItem, setSelItem] = useState<ItemSel>(null);
  const [activeSound, setActiveSound] = useState('s1');
  const [activeFx, setActiveFx] = useState('f1');
  const [recOpen, setRecOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [, setBankVer] = useState(0);
  useEffect(() => bank.subscribe(() => setBankVer((v) => v + 1)), [bank]);
  const importInput = useRef<HTMLInputElement>(null);
  const itemDrag = useRef<{ sel: NonNullable<ItemSel>; x: number; y: number; t0: number; lane?: string; moved: boolean } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: number; t: number; lane?: string } | null>(null);

  // Parte da música principal + áudio das faixas extras
  const [part, setPart] = useState<PartMode>('tudo');
  const [partBuf, setPartBuf] = useState<AudioBuffer | null>(null);
  const [stemsAvail, setStemsAvail] = useState(false);
  const [layerBufs, setLayerBufs] = useState<Record<string, AudioBuffer>>({});
  useEffect(() => {
    setPart('tudo');
    setPartBuf(null);
    hasStems(track.id).then(setStemsAvail);
  }, [track]);
  useEffect(() => {
    if (part === 'tudo') return setPartBuf(null);
    let alive = true;
    partBuffer(engine.ctx, track, part).then((b) => alive && setPartBuf(b));
    return () => {
      alive = false;
    };
  }, [part, track, engine]);
  // Carrega o áudio das faixas extras que ainda não têm
  useEffect(() => {
    for (const l of project.layers) {
      if (layerBufs[l.id]) continue;
      const t = library.find((x) => x.id === l.trackId);
      if (!t) continue;
      partBuffer(engine.ctx, t, l.part).then((b) => b && setLayerBufs((m) => ({ ...m, [l.id]: b })));
    }
  }, [project.layers, library, engine, layerBufs]);

  const audio = (part !== 'tudo' && partBuf) || track.buffer!;
  const opts: RenderOpts = {
    grid,
    sound: (id) => bank.get(id)?.buffer,
    layerAudio: (id) => layerBufs[id],
    pitch: engine.keyLockReady ? (c) => createShifter(c, true) : undefined,
  };
  const total = projectLength(project);
  const end = timelineEnd(project, grid, (id) => bank.get(id)?.buffer.duration ?? 0);
  const rows = layoutRows(project);
  const canvasH = rows.reduce((a, r) => a + r.h, 0);

  // Nova música no Estúdio: recomeça o projeto.
  useEffect(() => {
    player.stop();
    setPlaying(false);
    setProject(newProject(track.id, track.duration));
    past.current = [];
    future.current = [];
    setSel(null);
    setSelItem(null);
    setCursor(0);
    setViewStart(0);
    setZoom(1);
    setLayerBufs({});
    setActiveSound('s1');
    setActiveFx('f1');
  }, [track, player]);

  useEffect(() => () => player.stop(), [player]);

  const stop = useCallback(() => {
    player.stop();
    setPlaying(false);
  }, [player]);

  const play = (from: number, p: EditProject = project) => {
    engine.resume();
    const decks = [engine.decks.A, engine.decks.B].filter((d) => d.playing);
    if (decks.length) {
      decks.forEach((d) => d.pause());
      toast('Pausei os decks para você ouvir o Estúdio.');
    }
    const e = timelineEnd(p, grid, (id) => bank.get(id)?.buffer.duration ?? 0);
    player.play(audio, p, Math.min(from, e - 0.05), opts, () => setPlaying(false));
    setPlaying(true);
  };

  const replayTimer = useRef(0);
  /** Aplica uma mudança. `coalesce`: várias mudanças seguidas no mesmo controle viram um só "desfazer". */
  const commit = (next: EditProject, keepSel = false, coalesce?: string) => {
    if (next === project) return;
    const now = performance.now();
    const same = coalesce && lastCoalesce.current.key === coalesce && now - lastCoalesce.current.t < 1200;
    if (!same) {
      past.current.push(project);
      if (past.current.length > 200) past.current.shift();
    }
    lastCoalesce.current = { key: coalesce ?? '', t: now };
    future.current = [];
    const wasPlaying = player.playing;
    const at = player.position();
    setProject(next);
    if (!keepSel) setSel(null);
    if (wasPlaying) {
      // Mudança de volume: espera parar de mexer para não "gaguejar"
      clearTimeout(replayTimer.current);
      if (coalesce) replayTimer.current = window.setTimeout(() => play(player.position(), next), 160);
      else play(at, next);
    }
  };

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(project);
    stop();
    setProject(prev);
    setSel(null);
    setSelItem(null);
  };

  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(project);
    stop();
    setProject(next);
    setSel(null);
    setSelItem(null);
  };

  // ---------- ações ----------
  const barsOf = (s: number) => Math.round((s / bar) * 4) / 4;
  const addPaletteClip = (blocks: EditProject['blocks'], len: number) => {
    clipCount.current++;
    return { id: Date.now() + clipCount.current, name: `Trecho ${clipCount.current} · ${barsOf(len)} comp.`, blocks };
  };
  const soundLane = project.soundLanes.some((l) => l.id === activeSound) ? activeSound : project.soundLanes[0].id;
  const fxLane = project.fxLanes.some((l) => l.id === activeFx) ? activeFx : project.fxLanes[0].id;

  const actions = {
    cut: () => {
      if (!sel) return;
      const clip = addPaletteClip(copyRange(project, sel.t0, sel.t1), sel.t1 - sel.t0);
      const next = deleteRange(project, sel.t0, sel.t1);
      commit({ ...next, palette: [...next.palette, clip] });
      setCursor(sel.t0);
    },
    copy: () => {
      if (!sel) return;
      const clip = addPaletteClip(copyRange(project, sel.t0, sel.t1), sel.t1 - sel.t0);
      commit({ ...project, palette: [...project.palette, clip] }, true);
      toast('Trecho guardado na paleta. Clique nele para colar onde está o cursor.');
    },
    duplicate: () => sel && commit(duplicateRange(project, sel.t0, sel.t1)),
    remove: () => {
      if (!sel) return;
      commit(deleteRange(project, sel.t0, sel.t1));
      setCursor(sel.t0);
    },
    sound: (id: string) => {
      const at = snapTime(sel ? sel.t0 : cursor, grid, 'beat', end);
      const next = addSound(project, id, at, 1, soundLane);
      commit(next, true);
      setSelItem({ kind: 'sound', id: next.sounds[next.sounds.length - 1].id });
    },
    fx: (type: FxType) => {
      if (!sel) return;
      commit(addEffect(project, type, sel.t0, sel.t1, fxLane), true);
    },
    echoOut: () => commit(echoOut(project, grid, sel ? sel.t1 : cursor || total, fxLane), true),
    buildUp: () => {
      const drop = sel ? sel.t1 : cursor;
      if (drop < bar) return toast('Ponha o cursor no ponto do drop (onde a música "explode").');
      let next = buildUp(project, grid, drop, undefined, fxLane);
      const riser = bank.get('riser');
      if (riser) next = addSound(next, 'riser', Math.max(0, drop - riser.buffer.duration), 0.8, soundLane);
      commit(next, true);
    },
    removeSelected: () => {
      if (!selItem) return false;
      commit(removeItem(project, selItem.id), true);
      setSelItem(null);
      return true;
    },
    paste: (clipId: number) => {
      const c = project.palette.find((x) => x.id === clipId);
      if (!c) return;
      commit(insertAt(project, sel ? sel.t0 : cursor, c.blocks));
    },
  };

  const save = async (mode: 'library' | 'download') => {
    stop();
    setBusy(true);
    try {
      const buf = await renderProject(audio, project, opts);
      const suffix = project.layers.length ? 'Mashup' : PART_SUFFIX[part];
      const title = `${track.title.replace(/ \((Edit|Acapella|Instrumental|Batida|Mashup).*\)$/, '')} (${suffix})`;
      if (mode === 'download') {
        const where = await saveFile(encodeWav(buf), `${title}.wav`, { label: 'Áudio WAV', ext: 'wav' });
        if (where) toast(where === 'Downloads' ? 'WAV salvo na pasta Downloads.' : 'WAV salvo!');
      } else {
        onSaved(trackFromBuffer(buf, track, title, mapSections(track.sections, project)));
        toast(`"${title}" está na biblioteca — já dá para tocar nos decks!`);
      }
    } catch {
      toast('Não consegui gerar o áudio. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if ((tgt instanceof HTMLInputElement && tgt.type !== 'range') || tgt instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      let done = true;
      if (k === ' ') playing ? stop() : play(sel ? sel.t0 : cursor);
      else if (ctrl && k === 'z') e.shiftKey ? redo() : undo();
      else if (ctrl && k === 'y') redo();
      else if (ctrl && k === 'x') actions.cut();
      else if (ctrl && k === 'c') actions.copy();
      else if (ctrl && k === 'd') actions.duplicate();
      else if (k === 'delete' || k === 'backspace') {
        if (!actions.removeSelected()) actions.remove();
      } else if (k === 'escape') {
        setSel(null);
        setSelItem(null);
      } else if (k === 'home') setCursor(0);
      else done = false;
      if (done) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- desenho ----------
  const view = () => {
    const w = canvas.current?.clientWidth ?? 1000;
    const pps = (w / Math.max(1, end)) * zoom;
    const maxStart = Math.max(0, end - w / pps);
    return { w, pps, start: Math.min(viewStart, maxStart), maxStart };
  };

  useFrame(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const v = view();
    const x2t = (x: number) => v.start + x / v.pps;
    const t2x = (t: number) => (t - v.start) * v.pps;
    const row = (kind: RowKind, id?: string) => rows.find((r) => r.kind === kind && (!id || r.id === id))!;
    const ruler = row('ruler');
    const sections = row('sections');
    const main = row('main');
    const musicRows = rows.filter((r) => r.kind === 'main' || r.kind === 'layer');
    const musicTop = main.y;
    const musicBottom = musicRows[musicRows.length - 1].y + musicRows[musicRows.length - 1].h;

    // Auto-rolagem durante a reprodução
    const ph = player.position();
    if (player.playing && zoom > 1 && (ph > v.start + (w / v.pps) * 0.9 || ph < v.start)) setViewStart(Math.max(0, ph - (w / v.pps) * 0.1));

    // Fundo das faixas
    rows.forEach((r, i) => {
      if (r.kind === 'ruler' || r.kind === 'sections') return;
      g.fillStyle = r.kind === 'main' ? '#0f1017' : i % 2 ? '#0d0e15' : '#0b0c12';
      g.fillRect(0, r.y, w, r.h);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, r.y, w, 1);
      if ((r.kind === 'sound' && r.id === soundLane) || (r.kind === 'fx' && r.id === fxLane)) {
        g.fillStyle = 'rgba(167,139,250,0.07)';
        g.fillRect(0, r.y, w, r.h);
      }
    });

    // Blocos da música principal (alternados) — mostra os pedaços
    const starts = blockStarts(project.blocks);
    project.blocks.forEach((b, i) => {
      const x0 = t2x(starts[i]);
      const x1 = t2x(starts[i] + b.end - b.start);
      g.fillStyle = i % 2 ? '#13141d' : '#0f1017';
      g.fillRect(x0, main.y, x1 - x0, main.h);
    });

    // Onda da principal + faixa de seções
    const drawWave = (wf: Track['waveform'], srcAt: (t: number) => number | null, top: number, hh: number, x0: number, x1: number, spanSrc: number, alpha = 1) => {
      const cy = top + hh / 2;
      const HH = hh / 2 - 5;
      g.globalAlpha = alpha;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, x1); x++) {
        const src = srcAt(x2t(x));
        if (src == null) continue;
        const i0 = Math.floor(src * wf.rate);
        const i1 = Math.max(i0 + 1, Math.floor((src + spanSrc) * wf.rate));
        let l = 0;
        let m = 0;
        let hi = 0;
        for (let i = i0; i < i1 && i < wf.low.length; i++) {
          if (i < 0) continue;
          l = Math.max(l, wf.low[i]);
          m = Math.max(m, wf.mid[i]);
          hi = Math.max(hi, wf.high[i]);
        }
        g.fillStyle = WAVE.low;
        g.fillRect(x, cy - l * HH, 1, l * HH * 2);
        g.fillStyle = WAVE.mid;
        g.fillRect(x, cy - m * HH * 0.6, 1, m * HH * 1.2);
        g.fillStyle = WAVE.high;
        g.fillRect(x, cy - hi * HH * 0.35, 1, hi * HH * 0.7);
      }
      g.globalAlpha = 1;
    };
    const mainAlpha = project.main.mute ? 0.3 : 1;
    drawWave(track.waveform, (t) => (t <= total ? toSource(project, t) : null), main.y, main.h, 0, t2x(total), 1 / v.pps, mainAlpha);

    let lastKind: string | null = null;
    const labels: { x: number; text: string }[] = [];
    for (let x = 0; x < Math.min(w, t2x(total)); x++) {
      const sec = sectionAt(track.sections, toSource(project, x2t(x)));
      if (!sec) continue;
      g.fillStyle = SECTION_COLORS[sec.kind];
      g.globalAlpha = 0.85;
      g.fillRect(x, sections.y + 3, 1, sections.h - 6);
      g.globalAlpha = 1;
      const key = sec.name + sec.start;
      if (key !== lastKind) {
        labels.push({ x, text: sec.name.toUpperCase() });
        lastKind = key;
      }
    }
    g.fillStyle = '#0d0e14';
    g.font = '800 10px system-ui, sans-serif';
    for (const l of labels) g.fillText(l.text, l.x + 4, sections.y + 14);

    // Faixas extras (trechos de outras músicas)
    project.layers.forEach((l, li) => {
      const r = row('layer', l.id);
      const color = LAYER_COLORS[li % LAYER_COLORS.length];
      const src = library.find((x) => x.id === l.trackId);
      for (const c of l.clips) {
        const at = dragPreview?.id === c.id ? dragPreview.t : c.at;
        const len = clipLength(c, l.rate);
        const x0 = t2x(at);
        const x1 = t2x(at + len);
        if (x1 < 0 || x0 > w) continue;
        g.fillStyle = color;
        g.globalAlpha = l.mute ? 0.08 : 0.16;
        g.beginPath();
        g.roundRect(x0, r.y + 3, x1 - x0, r.h - 6, 6);
        g.fill();
        g.globalAlpha = 1;
        if (src) drawWave(src.waveform, (t) => (t >= at && t <= at + len ? c.start + (t - at) * l.rate : null), r.y + 12, r.h - 14, x0, x1, l.rate / v.pps, l.mute ? 0.3 : 0.85);
        g.strokeStyle = selItem?.kind === 'clip' && selItem.id === c.id ? '#ffffff' : color;
        g.lineWidth = selItem?.kind === 'clip' && selItem.id === c.id ? 2 : 1;
        g.beginPath();
        g.roundRect(x0, r.y + 3, x1 - x0, r.h - 6, 6);
        g.stroke();
        g.fillStyle = color;
        g.font = '800 10px system-ui, sans-serif';
        if (x1 - x0 > 40) g.fillText(`${l.name} · ${PART_SHORT[l.part]}${c.gain !== 1 ? ` · ${Math.round(c.gain * 100)}%` : ''}`, Math.max(x0, 0) + 6, r.y + 13);
      }
    });

    // Régua de compassos (linhas atravessam tudo)
    g.font = '600 10px system-ui, sans-serif';
    const pxPerBar = bar * v.pps;
    const every = [1, 2, 4, 8, 16, 32].find((n) => n * pxPerBar >= 34) ?? 64;
    const firstBar = Math.max(0, Math.floor((v.start - grid.firstBeat) / bar));
    for (let k = firstBar; ; k++) {
      const t = grid.firstBeat + k * bar;
      if (t > Math.min(end, v.start + w / v.pps)) break;
      const x = t2x(t);
      const major = k % every === 0;
      g.fillStyle = major ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.06)';
      g.fillRect(x, major ? 8 : 16, 1, major ? h : 6);
      if (major) {
        g.fillStyle = '#8a90a8';
        g.fillText(String(k + 1), x + 3, ruler.y + 12);
      }
    }

    // Emendas da principal
    g.fillStyle = '#ffffff';
    for (let i = 1; i < starts.length; i++) {
      const x = t2x(starts[i]);
      if (x < -5 || x > w + 5) continue;
      g.globalAlpha = 0.9;
      for (let y = main.y; y < main.y + main.h; y += 6) g.fillRect(x, y, 1, 3);
      g.font = '12px system-ui';
      g.fillText('✂', x - 5, main.y + 13);
      g.globalAlpha = 1;
    }

    // Fades (volume geral)
    const fade = (from: number, to: number, rising: boolean) => {
      const x0 = t2x(from);
      const x1 = t2x(to);
      const grad = g.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, rising ? 'rgba(13,14,20,0.85)' : 'rgba(13,14,20,0)');
      grad.addColorStop(1, rising ? 'rgba(13,14,20,0)' : 'rgba(13,14,20,0.85)');
      g.fillStyle = grad;
      g.fillRect(x0, musicTop, x1 - x0, musicBottom - musicTop);
      g.strokeStyle = '#52e3a4';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, rising ? musicBottom - 2 : musicTop + 2);
      g.lineTo(x1, rising ? musicTop + 2 : musicBottom - 2);
      g.stroke();
    };
    if (project.fadeIn > 0) fade(0, project.fadeIn, true);
    if (project.fadeOut > 0) fade(total - project.fadeOut, total, false);

    // Efeitos (cada faixa de efeitos) + tinta sobre o que eles afetam
    g.font = '700 11px system-ui, sans-serif';
    for (const f of project.effects) {
      const r = rows.find((x) => x.kind === 'fx' && x.id === (dragPreview?.id === f.id && dragPreview.lane ? dragPreview.lane : f.lane));
      if (!r) continue;
      const t0 = dragPreview?.id === f.id ? dragPreview.t : f.t0;
      const x0 = t2x(t0);
      const x1 = t2x(t0 + (f.t1 - f.t0));
      if (x1 < 0 || x0 > w) continue;
      const info = FX_INFO[f.type];
      const isSel = selItem?.kind === 'fx' && selItem.id === f.id;
      g.fillStyle = info.color;
      g.globalAlpha = isSel ? 1 : 0.75;
      g.fillRect(x0, r.y + 4, Math.max(3, x1 - x0), r.h - 8);
      const target = project.fxLanes.find((l) => l.id === f.lane)?.target ?? 'main';
      const tinted = target === 'mix' ? musicRows : musicRows.filter((m) => m.id === target);
      g.globalAlpha = 0.14;
      for (const m of tinted) g.fillRect(x0, m.y, Math.max(3, x1 - x0), m.h);
      g.globalAlpha = 1;
      g.fillStyle = '#0d0e14';
      if (x1 - x0 > 30) g.fillText(`${info.icon} ${info.name}`, x0 + 4, r.y + r.h / 2 + 4);
      if (isSel) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.strokeRect(x0, r.y + 3, x1 - x0, r.h - 6);
      }
    }
    // Sons
    for (const e of project.sounds) {
      const lane = dragPreview?.id === e.id && dragPreview.lane ? dragPreview.lane : e.lane;
      const r = rows.find((x) => x.kind === 'sound' && x.id === lane);
      if (!r) continue;
      const snd = bank.get(e.soundId);
      const atT = dragPreview?.id === e.id ? dragPreview.t : e.at;
      const x0 = t2x(atT);
      const x1 = x0 + Math.max(26, (snd?.buffer.duration ?? 1) * v.pps);
      if (x1 < 0 || x0 > w) continue;
      const isSel = selItem?.kind === 'sound' && selItem.id === e.id;
      g.fillStyle = isSel ? '#ffffff' : '#ff8a00';
      g.globalAlpha = (isSel ? 0.95 : 0.8) * (0.35 + 0.65 * Math.min(1, e.gain));
      g.beginPath();
      g.roundRect(x0, r.y + 4, x1 - x0, r.h - 8, 6);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#0d0e14';
      g.fillText(`${snd?.icon ?? '♪'} ${snd?.name ?? 'som'}${e.gain !== 1 ? ` ${Math.round(e.gain * 100)}%` : ''}`, x0 + 5, r.y + r.h / 2 + 4);
    }

    // Seleção, cursor e agulha
    if (sel) {
      const x0 = t2x(sel.t0);
      const x1 = t2x(sel.t1);
      g.fillStyle = 'rgba(167, 139, 250, 0.22)';
      g.fillRect(x0, ruler.h, x1 - x0, h - ruler.h);
      g.fillStyle = '#a78bfa';
      g.fillRect(x0, ruler.h, 2, h - ruler.h);
      g.fillRect(x1 - 2, ruler.h, 2, h - ruler.h);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(t2x(cursor) - 1, ruler.h, 2, h - ruler.h);
    if (player.playing) {
      g.fillStyle = '#ff3b5c';
      g.fillRect(t2x(ph) - 1, 0, 2, h);
    }
  });

  const tAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const v = view();
    return snapTime(v.start + (clientX - r.left) / v.pps, grid, unit, end);
  };
  const rowAt = (clientY: number): Row | undefined => {
    const y = clientY - canvas.current!.getBoundingClientRect().top;
    return rows.find((r) => y >= r.y && y < r.y + r.h);
  };

  /** Clicou num som, num efeito ou num trecho de faixa extra? */
  const hitItem = (clientX: number, r: Row | undefined): (NonNullable<ItemSel> & { t0: number; lane?: string }) | null => {
    if (!r) return null;
    const rect = canvas.current!.getBoundingClientRect();
    const vv = view();
    const t = vv.start + (clientX - rect.left) / vv.pps;
    if (r.kind === 'sound') {
      for (const e of [...project.sounds].reverse()) {
        if (e.lane !== r.id) continue;
        const dur = Math.max(26 / vv.pps, bank.get(e.soundId)?.buffer.duration ?? 1);
        if (t >= e.at && t <= e.at + dur) return { kind: 'sound', id: e.id, t0: e.at, lane: e.lane };
      }
    } else if (r.kind === 'fx') {
      for (const f of project.effects) if (f.lane === r.id && t >= f.t0 && t <= f.t1) return { kind: 'fx', id: f.id, t0: f.t0, lane: f.lane };
    } else if (r.kind === 'layer') {
      const l = project.layers.find((x) => x.id === r.id);
      for (const c of l?.clips ?? []) if (t >= c.at && t <= c.at + clipLength(c, l!.rate)) return { kind: 'clip', id: c.id, layerId: r.id, t0: c.at };
    }
    return null;
  };

  const importSound = async (file: File) => {
    try {
      const raw = await engine.ctx.decodeAudioData(await file.arrayBuffer());
      const s: SoundAsset = { id: `user-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, '').slice(0, 24), icon: '🎵', buffer: trimAndNormalize(engine.ctx, raw, 0.003), user: true };
      onUserSound(s);
      toast(`Som "${s.name}" adicionado.`);
    } catch {
      toast('Não consegui abrir esse arquivo de som.');
    }
  };

  // ---------- adicionar faixa de música ----------
  const addMusicLayer = async (t: Track, p: PartMode) => {
    setAddOpen(false);
    try {
      const buf = await partBuffer(engine.ctx, t, p);
      if (!buf) return toast('Essa música ainda não tem stems. Separe nos decks (✨ Separar) para usar só uma parte.');
      const at = snapTime(sel ? sel.t0 : cursor, grid, 'bar', end);
      const next = addLayer(project, grid, { trackId: t.id, name: t.title, part: p, bpm: t.bpm, firstBeat: t.firstBeat, duration: buf.duration }, at);
      const l = next.layers[next.layers.length - 1];
      setLayerBufs((m) => ({ ...m, [l.id]: buf }));
      commit(next, true);
      const pct = Math.round((l.rate - 1) * 100);
      toast(`"${t.title}" (${PART_SHORT[p]}) entrou numa faixa nova${Math.abs(pct) >= 1 ? `, ${pct > 0 ? 'acelerada' : 'freada'} ${Math.abs(pct)}% para o BPM do projeto, sem mudar o tom` : ''}.`);
    } catch {
      toast('Não consegui abrir essa música.');
    }
  };

  const selectedSound = selItem?.kind === 'sound' ? project.sounds.find((x) => x.id === selItem.id) : undefined;
  const selectedFx = selItem?.kind === 'fx' ? project.effects.find((x) => x.id === selItem.id) : undefined;
  const selectedLayer = selItem?.kind === 'clip' ? project.layers.find((l) => l.id === selItem.layerId) : undefined;
  const selectedClip = selectedLayer?.clips.find((c) => c.id === selItem?.id);

  const v = view();
  const selBars = sel ? barsOf(sel.t1 - sel.t0) : 0;
  const mixCtl = (id: string, m: Mix, label: string) => (
    <span className="mix-ctl">
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.01}
        value={m.volume}
        onChange={(e) => commit(updateLane(project, id, { volume: Number(e.target.value) }), true, `vol-${id}`)}
        onDoubleClick={() => commit(updateLane(project, id, { volume: 1 }), true)}
        aria-label={`Volume: ${label}`}
        title={`Volume ${Math.round(m.volume * 100)}% (duplo clique = 100%)`}
      />
      <button className={`ms ${m.mute ? 'on mute' : ''}`} onClick={() => commit(updateLane(project, id, { mute: !m.mute }), true)} title="Mudo">
        M
      </button>
      <button className={`ms ${m.solo ? 'on solo' : ''}`} onClick={() => commit(updateLane(project, id, { solo: !m.solo }), true)} title="Solo: só esta faixa (e outras em solo)">
        S
      </button>
    </span>
  );
  const fxTargets = [
    { id: 'mix', name: 'Tudo' },
    { id: 'main', name: 'Música principal' },
    ...project.layers.map((l) => ({ id: l.id, name: l.name })),
  ];

  return (
    <section className="studio" aria-label="Estúdio">
      <header className="studio-head">
        <button className="btn ghost" onClick={onExit}>
          ◀ Voltar aos decks
        </button>
        <div className="studio-title">
          <small>ESTÚDIO · MULTIPISTA</small>
          <strong>{track.title}</strong>
        </div>
        <div className="studio-dur">
          {fmtTime(track.duration)} → <b>{fmtTime(end)}</b>
        </div>
        <button className="btn" onClick={undo} disabled={!past.current.length} title="Desfazer (Ctrl+Z)">
          ↶
        </button>
        <button className="btn" onClick={redo} disabled={!future.current.length} title="Refazer (Ctrl+Y)">
          ↷
        </button>
        <button className="btn" onClick={() => save('download')} disabled={busy}>
          ⬇ Exportar WAV
        </button>
        <button className="btn primary small-primary" onClick={() => save('library')} disabled={busy}>
          {busy ? 'Gerando…' : '✔ Salvar na biblioteca'}
        </button>
      </header>

      <div className="studio-tools">
        <div className="tool-group">
          <button className={`btn play ${playing ? 'on' : ''}`} onClick={() => (playing ? stop() : play(sel ? sel.t0 : cursor))} aria-label={playing ? 'Pausar' : 'Tocar'} title="Espaço">
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn" onClick={() => { stop(); setCursor(0); setViewStart(0); }} title="Voltar ao início">
            ⏮
          </button>
        </div>
        <div className="tool-group" aria-label="Editar seleção">
          <button className="btn" disabled={!sel} onClick={actions.cut} title="Recortar para a paleta (Ctrl+X)">✂ Recortar</button>
          <button className="btn" disabled={!sel} onClick={actions.copy} title="Copiar para a paleta (Ctrl+C)">⧉ Copiar</button>
          <button className="btn" disabled={!sel} onClick={actions.duplicate} title="Repetir logo depois (Ctrl+D)">⧺ Repetir</button>
          <button className="btn" disabled={!sel} onClick={actions.remove} title="Apagar (Delete)">🗑 Apagar</button>
        </div>
        <div className="tool-group">
          <button className="btn" onClick={() => commit(extendIntro(project, grid, 8))} title="Repete os 8 primeiros compassos">Intro +8</button>
          <button className="btn" onClick={() => commit(extendOutro(project, grid, 8))} title="Repete os 8 últimos compassos">Final +8</button>
        </div>
        <label className="tool-select">
          Fade entrada
          <select value={Math.round(project.fadeIn / bar)} onChange={(e) => commit({ ...project, fadeIn: Number(e.target.value) * bar }, true)}>
            {FADE_BARS.map((n) => (
              <option key={n} value={n}>{n ? `${n} comp.` : 'sem'}</option>
            ))}
          </select>
        </label>
        <label className="tool-select">
          Fade saída
          <select value={Math.round(project.fadeOut / bar)} onChange={(e) => commit({ ...project, fadeOut: Number(e.target.value) * bar }, true)}>
            {FADE_BARS.map((n) => (
              <option key={n} value={n}>{n ? `${n} comp.` : 'sem'}</option>
            ))}
          </select>
        </label>
        <label className="tool-select master-vol" title="Volume geral do que você está fazendo">
          🔊 Volume geral
          <input type="range" min={0} max={1.5} step={0.01} value={project.master} onChange={(e) => commit({ ...project, master: Number(e.target.value) }, true, 'master')} onDoubleClick={() => commit({ ...project, master: 1 }, true)} />
          <b>{Math.round(project.master * 100)}%</b>
        </label>
        <div className="tool-group right">
          <span className="tool-label">Grade</span>
          <button className={`chip ${unit === 'bar' ? 'on' : ''}`} onClick={() => setUnit('bar')}>Compasso</button>
          <button className={`chip ${unit === 'beat' ? 'on' : ''}`} onClick={() => setUnit('beat')}>Batida</button>
          <span className="tool-label">Zoom</span>
          <button className="btn tiny" onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1}>−</button>
          <button className="btn tiny" onClick={() => setZoom((z) => Math.min(16, z * 2))} disabled={zoom >= 16}>+</button>
        </div>
      </div>

      <div className="mt">
        {/* Cabeçalhos das faixas */}
        <div className="mt-heads">
          {rows.map((r) => {
            if (r.kind === 'ruler') return <div key="ruler" className="mt-head spacer" style={{ height: r.h }} />;
            if (r.kind === 'sections') return <div key="sec" className="mt-head spacer" style={{ height: r.h }}><small className="muted">partes da música</small></div>;
            if (r.kind === 'main')
              return (
                <div key="main" className="mt-head main" style={{ height: r.h }}>
                  <div className="mt-name">🎵 Música principal</div>
                  <select value={part} disabled={!stemsAvail} onChange={(e) => { stop(); setPart(e.target.value as PartMode); }} title={stemsAvail ? 'Usar só uma parte (stems)' : 'Separe os stems desta música num deck para liberar'}>
                    {(Object.keys(PART_LABEL) as PartMode[]).map((k) => (
                      <option key={k} value={k}>{PART_LABEL[k]}</option>
                    ))}
                  </select>
                  {mixCtl('main', project.main, 'música principal')}
                </div>
              );
            if (r.kind === 'layer') {
              const l = project.layers.find((x) => x.id === r.id)!;
              const li = project.layers.indexOf(l);
              return (
                <div key={r.id} className="mt-head layer" style={{ height: r.h, ['--lc' as string]: LAYER_COLORS[li % LAYER_COLORS.length] }}>
                  <div className="mt-name" title={l.name}>
                    🎶 {l.name}
                    <button className="x" onClick={() => { commit(removeLayer(project, l.id), true); setSelItem(null); }} title="Remover faixa">✕</button>
                  </div>
                  <small className="muted">{PART_SHORT[l.part]} · {l.bpm.toFixed(0)} BPM{Math.abs(l.rate - 1) > 0.005 ? ` → ${(l.bpm * l.rate).toFixed(0)}` : ''}</small>
                  {mixCtl(l.id, l, l.name)}
                </div>
              );
            }
            if (r.kind === 'sound') {
              const l = project.soundLanes.find((x) => x.id === r.id)!;
              return (
                <div key={r.id} className={`mt-head small ${soundLane === r.id ? 'active' : ''}`} style={{ height: r.h }} onClick={() => setActiveSound(r.id)} title="Clique para os novos sons entrarem nesta faixa">
                  <div className="mt-name">
                    🔔 {l.name}
                    {project.soundLanes.length > 1 && <button className="x" onClick={(e) => { e.stopPropagation(); commit(removeSoundLane(project, l.id), true); }} title="Remover faixa (e os sons dela)">✕</button>}
                  </div>
                  {mixCtl(l.id, l, l.name)}
                </div>
              );
            }
            const l = project.fxLanes.find((x) => x.id === r.id)!;
            return (
              <div key={r.id} className={`mt-head small fx ${fxLane === r.id ? 'active' : ''}`} style={{ height: r.h }} onClick={() => setActiveFx(r.id)} title="Clique para os novos efeitos entrarem nesta faixa">
                <div className="mt-name">
                  ✨ {l.name}
                  {project.fxLanes.length > 1 && <button className="x" onClick={(e) => { e.stopPropagation(); commit(removeFxLane(project, l.id), true); }} title="Remover faixa (e os efeitos dela)">✕</button>}
                </div>
                <label className="fx-target" onClick={(e) => e.stopPropagation()}>
                  em
                  <select value={l.target} onChange={(e) => commit(updateLane(project, l.id, { target: e.target.value }), true)}>
                    {fxTargets.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
          <div className="mt-add">
            <button className="btn tiny" onClick={() => setAddOpen(true)}>+ Faixa de música</button>
            <button className="btn tiny" onClick={() => { const n = addSoundLane(project); commit(n, true); setActiveSound(n.soundLanes[n.soundLanes.length - 1].id); }}>+ Faixa de sons</button>
            <button className="btn tiny" onClick={() => { const n = addFxLane(project, 'mix'); commit(n, true); setActiveFx(n.fxLanes[n.fxLanes.length - 1].id); }}>+ Faixa de efeitos</button>
          </div>
        </div>

        <div className="studio-timeline">
          <canvas
            ref={canvas}
            className="studio-canvas"
            style={{ height: canvasH }}
            aria-label="Linha do tempo: arraste para selecionar compassos"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              const r = rowAt(e.clientY);
              if (r?.kind === 'sound') setActiveSound(r.id);
              if (r?.kind === 'fx') setActiveFx(r.id);
              const hit = hitItem(e.clientX, r);
              if (hit) {
                setSelItem({ kind: hit.kind, id: hit.id, layerId: hit.layerId });
                itemDrag.current = { sel: { kind: hit.kind, id: hit.id, layerId: hit.layerId }, x: e.clientX, y: e.clientY, t0: hit.t0, lane: hit.lane, moved: false };
                return;
              }
              setSelItem(null);
              drag.current = { x: e.clientX, t: tAt(e.clientX), moved: false };
            }}
            onPointerMove={(e) => {
              const it = itemDrag.current;
              if (it) {
                if (Math.abs(e.clientX - it.x) > 3 || Math.abs(e.clientY - it.y) > 6) it.moved = true;
                if (!it.moved) return;
                const t = snapTime(it.t0 + (e.clientX - it.x) / v.pps, grid, it.sel.kind === 'clip' ? unit : 'beat', end);
                const r = rowAt(e.clientY);
                const lane = it.sel.kind === 'sound' && r?.kind === 'sound' ? r.id : it.sel.kind === 'fx' && r?.kind === 'fx' ? r.id : undefined;
                setDragPreview({ id: it.sel.id, t, lane });
                return;
              }
              const d = drag.current;
              if (!d) return;
              if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
              if (d.moved) {
                const t = tAt(e.clientX);
                setSel(t === d.t ? null : { t0: Math.min(t, d.t), t1: Math.max(t, d.t) });
              }
            }}
            onPointerUp={() => {
              const it = itemDrag.current;
              itemDrag.current = null;
              if (it) {
                if (it.moved && dragPreview) {
                  const s = it.sel;
                  if (s.kind === 'sound') commit(moveSound(project, s.id, dragPreview.t, dragPreview.lane), true);
                  else if (s.kind === 'fx') commit(moveEffect(project, s.id, dragPreview.t, dragPreview.lane), true);
                  else if (s.layerId) commit(moveClip(project, s.layerId, s.id, dragPreview.t), true);
                }
                setDragPreview(null);
                return;
              }
              const d = drag.current;
              drag.current = null;
              if (d && !d.moved) {
                setSel(null);
                setCursor(d.t);
                if (playing) play(d.t);
              }
            }}
            onWheel={(e) => {
              if (e.ctrlKey) setZoom((z) => Math.min(16, Math.max(1, z * (e.deltaY > 0 ? 0.8 : 1.25))));
              else if (zoom > 1) setViewStart((s) => Math.max(0, Math.min(v.maxStart, s + ((e.deltaX || e.deltaY) / v.pps) * 0.8)));
            }}
          />
          {zoom > 1 && (
            <input type="range" className="studio-scroll" min={0} max={v.maxStart} step={0.01} value={v.start} onChange={(e) => setViewStart(Number(e.target.value))} aria-label="Rolar a linha do tempo" />
          )}
        </div>
      </div>

      <div className="studio-bottom">
        {/* Painel do item selecionado */}
        {selectedSound || selectedClip || selectedFx ? (
          <div className="item-panel">
            {selectedSound && (
              <>
                <b>{bank.get(selectedSound.soundId)?.icon} {bank.get(selectedSound.soundId)?.name ?? 'Som'}</b>
                <label className="tool-select">
                  Volume
                  <input type="range" min={0} max={1.5} step={0.01} value={selectedSound.gain} onChange={(e) => commit(setItemGain(project, selectedSound.id, Number(e.target.value)), true, `g-${selectedSound.id}`)} />
                  <b>{Math.round(selectedSound.gain * 100)}%</b>
                </label>
                <span className="muted">Arraste para mover (inclusive para outra faixa de sons).</span>
              </>
            )}
            {selectedClip && selectedLayer && (
              <>
                <b>🎶 {selectedLayer.name} · {PART_SHORT[selectedLayer.part]}</b>
                <label className="tool-select">
                  Volume do trecho
                  <input type="range" min={0} max={1.5} step={0.01} value={selectedClip.gain} onChange={(e) => commit(setItemGain(project, selectedClip.id, Number(e.target.value)), true, `g-${selectedClip.id}`)} />
                  <b>{Math.round(selectedClip.gain * 100)}%</b>
                </label>
                <button className="btn small" onClick={() => commit(splitClip(project, selectedLayer.id, selectedClip.id, cursor), true)} title="Divide o trecho onde está o cursor (para apagar ou mover só uma parte)">
                  ✂ Dividir no cursor
                </button>
                <span className="muted">Arraste para mover no tempo.</span>
              </>
            )}
            {selectedFx && (
              <>
                <b>{FX_INFO[selectedFx.type].icon} {FX_INFO[selectedFx.type].name}</b>
                <span className="muted">Arraste para mover (inclusive para outra faixa de efeitos).</span>
              </>
            )}
            <button className="btn small" onClick={() => actions.removeSelected()}>🗑 Remover</button>
          </div>
        ) : (
          <p className="studio-hint">
            {sel
              ? `Seleção: ${selBars} compasso${selBars === 1 ? '' : 's'} (${(sel.t1 - sel.t0).toFixed(1)} s). Recorte, copie, repita ou apague — ou aplique um efeito na faixa de efeitos ativa.`
              : 'Arraste na onda para selecionar compassos. Clique para pôr o cursor. Clique num som, efeito ou trecho para ajustar o volume ou mover.'}
          </p>
        )}
        <div className="studio-row">
          <span className="tool-label">Sons</span>
          <span className="muted lane-note">→ {project.soundLanes.find((l) => l.id === soundLane)?.name}</span>
          <button className="btn rec-btn" onClick={() => setRecOpen(true)}>
            🎤 Gravar vinheta
          </button>
          {bank.all().map((sd) => (
            <span key={sd.id} className={`sound-chip ${sd.user ? 'user' : ''}`}>
              <button onClick={() => actions.sound(sd.id)} title="Inserir no cursor">
                {sd.icon} {sd.name}
              </button>
              {sd.user && (
                <button className="x" aria-label={`Apagar ${sd.name}`} onClick={() => onRemoveUserSound(sd.id)}>
                  ✕
                </button>
              )}
            </span>
          ))}
          <button className="btn ghost" onClick={() => importInput.current?.click()}>
            + Importar som
          </button>
          <input ref={importInput} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importSound(f);
            e.target.value = '';
          }} />
        </div>
        <div className="studio-row">
          <span className="tool-label">Efeitos</span>
          <span className="muted lane-note">→ {project.fxLanes.find((l) => l.id === fxLane)?.name}</span>
          {(Object.keys(FX_INFO) as FxType[]).map((k) => (
            <button key={k} className="fx-btn" style={{ ['--fx' as string]: FX_INFO[k].color }} disabled={!sel} onClick={() => actions.fx(k)} title={`${FX_INFO[k].desc} (selecione um trecho antes)`}>
              {FX_INFO[k].icon} {FX_INFO[k].name}
            </button>
          ))}
          <span className="sep-v" />
          <button className="btn" onClick={actions.echoOut} title="Eco no último compasso e silêncio depois (no fim da seleção ou no cursor)">
            ◎ Saída com eco
          </button>
          <button className="btn" onClick={actions.buildUp} title="4 compassos de subida + riser terminando no cursor (o drop)">
            △ Subida pro drop
          </button>
        </div>
        <div className="studio-row">
          <span className="tool-label">Modelos</span>
          {TEMPLATES.map((tp) => (
            <button key={tp.id} className="btn" title={tp.desc} onClick={() => commit({ ...applyTemplate(tp.id, track.id, track.duration, grid, track.sections), layers: project.layers, soundLanes: project.soundLanes, fxLanes: project.fxLanes, master: project.master, main: project.main })}>
              {tp.name}
            </button>
          ))}
          <button className="btn ghost" onClick={() => commit({ ...newProject(track.id, track.duration), palette: project.palette })}>
            Voltar ao original
          </button>
        </div>
        <div className="studio-row">
          <span className="tool-label">Paleta</span>
          {project.palette.length === 0 && <span className="muted">Trechos que você recortar ou copiar aparecem aqui. Clique para colar no cursor.</span>}
          {project.palette.map((c) => (
            <button key={c.id} className="clip" onClick={() => actions.paste(c.id)} title="Colar no cursor">
              ▦ {c.name}
            </button>
          ))}
        </div>
        <div className="studio-row legend">
          {(['intro', 'parte', 'break', 'outro'] as SectionKind[]).map((k) => (
            <span key={k}>
              <i style={{ background: SECTION_COLORS[k] }} /> {k === 'break' ? 'Breakdown' : k[0].toUpperCase() + k.slice(1)}
            </span>
          ))}
          <span>✂ emenda</span>
          <span><i style={{ background: '#ff8a00' }} /> som</span>
          <span className="muted">M = mudo · S = solo · Atalhos: Espaço · Ctrl+X/C/D · Delete · Ctrl+Z/Y</span>
        </div>
      </div>
      {recOpen && <VinhetaRecorder ctx={engine.ctx} out={engine.studioOut} onSave={(snd) => { onUserSound(snd); toast(`Vinheta "${snd.name}" salva! Ela aparece em Sons.`); }} onClose={() => setRecOpen(false)} />}
      {addOpen && <AddLayerModal library={library} current={track} onAdd={addMusicLayer} onClose={() => setAddOpen(false)} />}
    </section>
  );
}

/** Escolher a música (e a parte) para uma faixa nova. */
function AddLayerModal({ library, current, onAdd, onClose }: { library: Track[]; current: Track; onAdd: (t: Track, p: PartMode) => void; onClose: () => void }) {
  const [id, setId] = useState(library.find((t) => t.id !== current.id)?.id ?? current.id);
  const [p, setP] = useState<PartMode>('tudo');
  const [stems, setStems] = useState(false);
  useEffect(() => {
    hasStems(id).then((h) => {
      setStems(h);
      if (!h) setP('tudo');
    });
  }, [id]);
  const t = library.find((x) => x.id === id);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Nova faixa de música" onClick={(e) => e.stopPropagation()}>
        <h2>🎶 Nova faixa de música</h2>
        <p>A música entra no cursor, já no BPM do projeto ({current.bpm.toFixed(0)}) e sem mudar o tom. Ótimo para mashups: o vocal de uma por cima da batida da outra.</p>
        <label className="field">
          <span>Música</span>
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {library.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} · {x.bpm.toFixed(0)} BPM{x.key ? ` · ${x.key}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Parte</span>
          <select value={p} onChange={(e) => setP(e.target.value as PartMode)}>
            {(Object.keys(PART_LABEL) as PartMode[]).map((k) => (
              <option key={k} value={k} disabled={k !== 'tudo' && !stems}>
                {PART_LABEL[k]}
                {k !== 'tudo' && !stems ? ' — separe os stems nos decks' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="row-btns">
          <button className="btn primary" disabled={!t} onClick={() => t && onAdd(t, p)}>
            Adicionar faixa
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function sectionAt(sections: Section[], t: number): Section | undefined {
  for (const s of sections) if (t >= s.start && t < s.end) return s;
  return undefined;
}

/** Leva as seções do original para a nova versão (cada bloco herda as seções do trecho de origem). */
function mapSections(sections: Section[], p: EditProject): Section[] {
  const out: Section[] = [];
  const starts = blockStarts(p.blocks);
  p.blocks.forEach((b, i) => {
    for (const s of sections) {
      const a = Math.max(s.start, b.start);
      const e = Math.min(s.end, b.end);
      if (e - a > 0.01) {
        const start = starts[i] + (a - b.start);
        const end = starts[i] + (e - b.start);
        const prev = out[out.length - 1];
        if (prev && prev.kind === s.kind && prev.name === s.name && Math.abs(prev.end - start) < 0.01) prev.end = end;
        else out.push({ ...s, start, end });
      }
    }
  });
  return out;
}

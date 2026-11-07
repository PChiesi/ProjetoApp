import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine, Track } from '../audio/engine';
import { trackFromBuffer } from '../audio/library';
import { fmtTime, useFrame } from '../hooks';
import {
  applyTemplate,
  barLen,
  blockStarts,
  copyRange,
  deleteRange,
  duplicateRange,
  extendIntro,
  extendOutro,
  insertAt,
  newProject,
  projectLength,
  snapTime,
  TEMPLATES,
  toSource,
  addEffect,
  addSound,
  buildUp,
  echoOut,
  removeItem,
  FX_INFO,
  type FxType,
  type EditProject,
  type Grid,
  type Section,
  type SectionKind,
} from './edit';
import { encodeWav, renderProject, StudioPlayer, type RenderOpts } from './render';
import { trimAndNormalize, type SoundAsset, type SoundBank } from './sounds';
import { VinhetaRecorder } from './VinhetaRecorder';
import { AUDIO_ACCEPT } from '../audio/library';

interface Props {
  engine: AudioEngine;
  track: Track;
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

export function Studio({ engine, track, onExit, onSaved, toast, bank, onUserSound, onRemoveUserSound }: Props) {
  const grid: Grid = { bpm: track.bpm, firstBeat: track.firstBeat };
  const bar = barLen(grid);
  const [project, setProject] = useState<EditProject>(() => newProject(track.id, track.duration));
  const past = useRef<EditProject[]>([]);
  const future = useRef<EditProject[]>([]);
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
  const [selItem, setSelItem] = useState<number | null>(null);
  const [recOpen, setRecOpen] = useState(false);
  const [, setBankVer] = useState(0);
  useEffect(() => bank.subscribe(() => setBankVer((v) => v + 1)), [bank]);
  const importInput = useRef<HTMLInputElement>(null);
  const itemDrag = useRef<{ id: number; x: number; at: number; moved: boolean } | null>(null);
  const [dragAt, setDragAt] = useState<{ id: number; at: number } | null>(null);
  const opts: RenderOpts = { grid, sound: (id) => bank.get(id)?.buffer };

  const total = projectLength(project);

  // Nova música no Estúdio: recomeça o projeto.
  useEffect(() => {
    player.stop();
    setPlaying(false);
    setProject(newProject(track.id, track.duration));
    past.current = [];
    future.current = [];
    setSel(null);
    setCursor(0);
    setViewStart(0);
    setZoom(1);
  }, [track, player]);

  useEffect(() => () => player.stop(), [player]);

  const stop = useCallback(() => {
    player.stop();
    setPlaying(false);
  }, [player]);

  const play = useCallback(
    (from: number, p: EditProject = project) => {
      engine.resume();
      const decks = [engine.decks.A, engine.decks.B].filter((d) => d.playing);
      if (decks.length) {
        decks.forEach((d) => d.pause());
        toast('Pausei os decks para você ouvir o Estúdio.');
      }
      player.play(track.buffer, p, Math.min(from, projectLength(p) - 0.05), opts, () => setPlaying(false));
      setPlaying(true);
    },
    [engine, player, project, toast, track.buffer],
  );

  const commit = useCallback(
    (next: EditProject, keepSel = false) => {
      if (next === project) return;
      past.current.push(project);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
      const wasPlaying = player.playing;
      const at = player.position();
      setProject(next);
      if (!keepSel) setSel(null);
      if (wasPlaying) play(Math.min(at, projectLength(next) - 0.1), next);
    },
    [project, player, play],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(project);
    stop();
    setProject(prev);
    setSel(null);
  }, [project, stop]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(project);
    stop();
    setProject(next);
    setSel(null);
  }, [project, stop]);

  // ---------- ações ----------
  const barsOf = (s: number) => Math.round((s / bar) * 4) / 4;
  const addClip = (blocks: EditProject['blocks'], len: number) => {
    clipCount.current++;
    return { id: Date.now() + clipCount.current, name: `Trecho ${clipCount.current} · ${barsOf(len)} comp.`, blocks };
  };

  const actions = {
    cut: () => {
      if (!sel) return;
      const clip = addClip(copyRange(project, sel.t0, sel.t1), sel.t1 - sel.t0);
      const next = deleteRange(project, sel.t0, sel.t1);
      commit({ ...next, palette: [...next.palette, clip] });
      setCursor(sel.t0);
    },
    copy: () => {
      if (!sel) return;
      const clip = addClip(copyRange(project, sel.t0, sel.t1), sel.t1 - sel.t0);
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
      const at = snapTime(sel ? sel.t0 : cursor, grid, 'beat', total);
      const next = addSound(project, id, at);
      commit(next, true);
      setSelItem(next.sounds[next.sounds.length - 1].id);
    },
    fx: (type: FxType) => {
      if (!sel) return;
      commit(addEffect(project, type, sel.t0, sel.t1), true);
    },
    echoOut: () => commit(echoOut(project, grid, sel ? sel.t1 : cursor || total), true),
    buildUp: () => {
      const drop = sel ? sel.t1 : cursor;
      if (drop < bar) return toast('Ponha o cursor no ponto do drop (onde a música "explode").');
      let next = buildUp(project, grid, drop);
      const riser = bank.get('riser');
      if (riser) next = addSound(next, 'riser', Math.max(0, drop - riser.buffer.duration), 0.8);
      commit(next, true);
    },
    removeSelected: () => {
      if (selItem == null) return false;
      commit(removeItem(project, selItem), true);
      setSelItem(null);
      return true;
    },
    paste: (clipId: number) => {
      const c = project.palette.find((x) => x.id === clipId);
      if (!c) return;
      const at = sel ? sel.t0 : cursor;
      commit(insertAt(project, at, c.blocks));
    },
  };

  const save = async (mode: 'library' | 'download') => {
    stop();
    setBusy(true);
    try {
      const buf = await renderProject(track.buffer, project, opts);
      const title = `${track.title.replace(/ \(Edit.*\)$/, '')} (Edit)`;
      if (mode === 'download') {
        const url = URL.createObjectURL(encodeWav(buf));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast('WAV salvo na pasta Downloads.');
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
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
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
      }
      else if (k === 'home') setCursor(0);
      else done = false;
      if (done) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- desenho ----------
  const view = () => {
    const w = canvas.current?.clientWidth ?? 1000;
    const pps = (w / Math.max(1, total)) * zoom;
    const maxStart = Math.max(0, total - w / pps);
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
    const RULER = 22;
    const SECT = 22;
    const LANE = 26;
    const top = RULER + SECT;
    const wh = h - top - 2 * LANE;
    const cy = top + wh / 2;
    const soundY = top + wh;
    const fxY = soundY + LANE;

    // Auto-rolagem durante a reprodução
    const ph = player.position();
    if (player.playing && zoom > 1 && (ph > v.start + (w / v.pps) * 0.9 || ph < v.start)) setViewStart(Math.max(0, ph - (w / v.pps) * 0.1));

    // Fundo dos blocos (alternado) para ela enxergar os pedaços
    const starts = blockStarts(project.blocks);
    project.blocks.forEach((b, i) => {
      const x0 = t2x(starts[i]);
      const x1 = t2x(starts[i] + b.end - b.start);
      g.fillStyle = i % 2 ? '#12131b' : '#0f1017';
      g.fillRect(x0, top, x1 - x0, wh);
    });
    g.fillStyle = '#0b0c12';
    g.fillRect(0, soundY, w, 2 * LANE);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, soundY, w, 1);
    g.fillRect(0, fxY, w, 1);

    // Onda + faixa de seções
    const wf = track.waveform;
    let lastKind: string | null = null;
    const labels: { x: number; text: string }[] = [];
    for (let x = 0; x < w; x++) {
      const t = x2t(x);
      if (t > total) break;
      const src = toSource(project, t);
      const i0 = Math.floor(src * wf.rate);
      const i1 = Math.max(i0 + 1, Math.floor((src + 1 / v.pps) * wf.rate));
      let l = 0;
      let m = 0;
      let hi = 0;
      for (let i = i0; i < i1 && i < wf.low.length; i++) {
        l = Math.max(l, wf.low[i]);
        m = Math.max(m, wf.mid[i]);
        hi = Math.max(hi, wf.high[i]);
      }
      const H = wh / 2 - 6;
      g.fillStyle = WAVE.low;
      g.fillRect(x, cy - l * H, 1, l * H * 2);
      g.fillStyle = WAVE.mid;
      g.fillRect(x, cy - m * H * 0.6, 1, m * H * 1.2);
      g.fillStyle = WAVE.high;
      g.fillRect(x, cy - hi * H * 0.35, 1, hi * H * 0.7);
      const sec = sectionAt(track.sections, src);
      if (sec) {
        g.fillStyle = SECTION_COLORS[sec.kind];
        g.globalAlpha = 0.85;
        g.fillRect(x, RULER + 3, 1, SECT - 6);
        g.globalAlpha = 1;
        const key = sec.name + sec.start;
        if (key !== lastKind) {
          labels.push({ x, text: sec.name.toUpperCase() });
          lastKind = key;
        }
      }
    }
    g.fillStyle = '#0d0e14';
    g.font = '800 11px system-ui, sans-serif';
    for (const l of labels) g.fillText(l.text, l.x + 4, RULER + 15);

    // Régua de compassos
    g.fillStyle = '#8a90a8';
    g.font = '600 10px system-ui, sans-serif';
    const pxPerBar = bar * v.pps;
    const every = [1, 2, 4, 8, 16, 32].find((n) => n * pxPerBar >= 34) ?? 64;
    const firstBar = Math.max(0, Math.floor((v.start - grid.firstBeat) / bar));
    for (let k = firstBar; ; k++) {
      const t = grid.firstBeat + k * bar;
      if (t > Math.min(total, v.start + w / v.pps)) break;
      const x = t2x(t);
      const major = k % every === 0;
      g.fillStyle = major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
      g.fillRect(x, major ? 8 : 16, 1, major ? h : 6);
      if (major) {
        g.fillStyle = '#8a90a8';
        g.fillText(String(k + 1), x + 3, 12);
      }
    }

    // Emendas (onde houve corte)
    g.fillStyle = '#ffffff';
    for (let i = 1; i < starts.length; i++) {
      const x = t2x(starts[i]);
      if (x < -5 || x > w + 5) continue;
      g.globalAlpha = 0.9;
      for (let y = top; y < h; y += 6) g.fillRect(x, y, 1, 3);
      g.font = '12px system-ui';
      g.fillText('✂', x - 5, top + 13);
      g.globalAlpha = 1;
    }

    // Fades
    const fade = (from: number, to: number, rising: boolean) => {
      const x0 = t2x(from);
      const x1 = t2x(to);
      const grad = g.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, rising ? 'rgba(13,14,20,0.85)' : 'rgba(13,14,20,0)');
      grad.addColorStop(1, rising ? 'rgba(13,14,20,0)' : 'rgba(13,14,20,0.85)');
      g.fillStyle = grad;
      g.fillRect(x0, top, x1 - x0, wh);
      g.strokeStyle = '#52e3a4';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, rising ? h - 2 : top + 2);
      g.lineTo(x1, rising ? top + 2 : h - 2);
      g.stroke();
    };
    if (project.fadeIn > 0) fade(0, project.fadeIn, true);
    if (project.fadeOut > 0) fade(total - project.fadeOut, total, false);

    // Efeitos (faixa de baixo)
    g.font = '700 11px system-ui, sans-serif';
    for (const f of project.effects) {
      const x0 = t2x(f.t0);
      const x1 = t2x(f.t1);
      if (x1 < 0 || x0 > w) continue;
      const info = FX_INFO[f.type];
      g.fillStyle = info.color;
      g.globalAlpha = f.id === selItem ? 1 : 0.75;
      g.fillRect(x0, fxY + 4, Math.max(3, x1 - x0), LANE - 8);
      g.globalAlpha = 0.18;
      g.fillRect(x0, top, Math.max(3, x1 - x0), wh);
      g.globalAlpha = 1;
      g.fillStyle = '#0d0e14';
      if (x1 - x0 > 30) g.fillText(`${info.icon} ${info.name}`, x0 + 4, fxY + 17);
      if (f.id === selItem) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.strokeRect(x0, fxY + 3, x1 - x0, LANE - 6);
      }
    }
    // Sons
    for (const e of project.sounds) {
      const snd = bank.get(e.soundId);
      const atT = dragAt?.id === e.id ? dragAt.at : e.at;
      const x0 = t2x(atT);
      const x1 = x0 + Math.max(26, (snd?.buffer.duration ?? 1) * v.pps);
      if (x1 < 0 || x0 > w) continue;
      g.fillStyle = e.id === selItem ? '#ffffff' : '#ff8a00';
      g.globalAlpha = e.id === selItem ? 0.95 : 0.8;
      g.beginPath();
      g.roundRect(x0, soundY + 3, x1 - x0, LANE - 6, 6);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#0d0e14';
      g.fillText(`${snd?.icon ?? '♪'} ${snd?.name ?? 'som'}`, x0 + 5, soundY + 17);
      g.fillStyle = '#ff8a00';
      g.fillRect(x0, top, 1, wh);
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '800 9px system-ui, sans-serif';
    if (!project.sounds.length) g.fillText('SONS', 6, soundY + 16);
    if (!project.effects.length) g.fillText('EFEITOS', 6, fxY + 16);

    // Seleção
    if (sel) {
      const x0 = t2x(sel.t0);
      const x1 = t2x(sel.t1);
      g.fillStyle = 'rgba(167, 139, 250, 0.25)';
      g.fillRect(x0, RULER, x1 - x0, h - RULER);
      g.fillStyle = '#a78bfa';
      g.fillRect(x0, RULER, 2, h - RULER);
      g.fillRect(x1 - 2, RULER, 2, h - RULER);
    }
    // Cursor e agulha
    g.fillStyle = '#ffffff';
    g.fillRect(t2x(cursor) - 1, RULER, 2, h - RULER);
    if (player.playing) {
      g.fillStyle = '#ff3b5c';
      g.fillRect(t2x(ph) - 1, 0, 2, h);
    }
  });

  const tAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const v = view();
    return snapTime(v.start + (clientX - r.left) / v.pps, grid, unit, total);
  };

  /** Clicou num som ou num efeito? */
  const hitItem = (clientX: number, clientY: number): { id: number; kind: 'sound' | 'fx'; at: number } | null => {
    const r = canvas.current!.getBoundingClientRect();
    const vv = view();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const LANE = 26;
    const t = vv.start + x / vv.pps;
    if (y >= r.height - 2 * LANE && y < r.height - LANE) {
      for (const e of [...project.sounds].reverse()) {
        const dur = Math.max(26 / vv.pps, bank.get(e.soundId)?.buffer.duration ?? 1);
        if (t >= e.at && t <= e.at + dur) return { id: e.id, kind: 'sound', at: e.at };
      }
    } else if (y >= r.height - LANE) {
      for (const f of project.effects) if (t >= f.t0 && t <= f.t1) return { id: f.id, kind: 'fx', at: f.t0 };
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

  const selected = project.sounds.find((x) => x.id === selItem) ?? project.effects.find((x) => x.id === selItem);

  const v = view();
  const selBars = sel ? barsOf(sel.t1 - sel.t0) : 0;

  return (
    <section className="studio" aria-label="Estúdio">
      <header className="studio-head">
        <button className="btn ghost" onClick={onExit}>
          ◀ Voltar aos decks
        </button>
        <div className="studio-title">
          <small>ESTÚDIO</small>
          <strong>{track.title}</strong>
        </div>
        <div className="studio-dur">
          {fmtTime(track.duration)} → <b>{fmtTime(total)}</b>
        </div>
        <button className="btn" onClick={undo} disabled={!past.current.length} title="Desfazer (Ctrl+Z)">
          ↶
        </button>
        <button className="btn" onClick={redo} disabled={!future.current.length} title="Refazer (Ctrl+Y)">
          ↷
        </button>
        <button className="btn" onClick={() => save('download')} disabled={busy}>
          ⬇ Baixar WAV
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
        <div className="tool-group right">
          <span className="tool-label">Grade</span>
          <button className={`chip ${unit === 'bar' ? 'on' : ''}`} onClick={() => setUnit('bar')}>Compasso</button>
          <button className={`chip ${unit === 'beat' ? 'on' : ''}`} onClick={() => setUnit('beat')}>Batida</button>
          <span className="tool-label">Zoom</span>
          <button className="btn tiny" onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1}>−</button>
          <button className="btn tiny" onClick={() => setZoom((z) => Math.min(16, z * 2))} disabled={zoom >= 16}>+</button>
        </div>
      </div>

      <div className="studio-timeline">
        <canvas
          ref={canvas}
          className="studio-canvas"
          aria-label="Linha do tempo: arraste para selecionar compassos"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            const hit = hitItem(e.clientX, e.clientY);
            if (hit) {
              setSelItem(hit.id);
              if (hit.kind === 'sound') itemDrag.current = { id: hit.id, x: e.clientX, at: hit.at, moved: false };
              return;
            }
            setSelItem(null);
            drag.current = { x: e.clientX, t: tAt(e.clientX), moved: false };
          }}
          onPointerMove={(e) => {
            const it = itemDrag.current;
            if (it) {
              if (Math.abs(e.clientX - it.x) > 3) it.moved = true;
              if (it.moved) setDragAt({ id: it.id, at: snapTime(it.at + (e.clientX - it.x) / v.pps, grid, 'beat', total) });
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
              if (it.moved && dragAt) commit({ ...project, sounds: project.sounds.map((x) => (x.id === it.id ? { ...x, at: dragAt.at } : x)) }, true);
              setDragAt(null);
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
          <input
            type="range"
            className="studio-scroll"
            min={0}
            max={v.maxStart}
            step={0.01}
            value={v.start}
            onChange={(e) => setViewStart(Number(e.target.value))}
            aria-label="Rolar a linha do tempo"
          />
        )}
      </div>

      <div className="studio-bottom">
        <p className="studio-hint">
          {selected
            ? 'soundId' in selected
              ? `${bank.get(selected.soundId)?.name ?? 'Som'} selecionado — arraste para mover, Delete para remover.`
              : `Efeito ${FX_INFO[selected.type].name} selecionado — Delete para remover.`
            : sel
            ? `Seleção: ${selBars} compasso${selBars === 1 ? '' : 's'} (${(sel.t1 - sel.t0).toFixed(1)} s). Recorte, copie, repita ou apague — o ritmo continua certinho.`
            : 'Arraste na onda para selecionar compassos. Clique para pôr o cursor. Espaço toca daqui.'}
        </p>
        <div className="studio-row">
          <span className="tool-label">Sons</span>
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
            <button key={tp.id} className="btn" title={tp.desc} onClick={() => commit(applyTemplate(tp.id, track.id, track.duration, grid, track.sections))}>
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
          <span className="muted">Atalhos: Espaço · Ctrl+X/C/D · Delete · Ctrl+Z/Y</span>
        </div>
      </div>
      {recOpen && <VinhetaRecorder ctx={engine.ctx} out={engine.studioOut} onSave={(snd) => { onUserSound(snd); toast(`Vinheta "${snd.name}" salva! Ela aparece em Sons.`); }} onClose={() => setRecOpen(false)} />}
    </section>
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

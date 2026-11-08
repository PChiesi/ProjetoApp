import { useEffect, useRef } from 'react';
import type { Deck } from '../audio/engine';
import { useFrame } from '../hooks';
import { CUE_COLORS } from './Pads';

const COLORS = { low: '#4d7cff', mid: '#ffb03b', high: '#f4f1ff' };

function setupCanvas(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

/** Onda rolando com a agulha no centro, grid de batidas e marcação de frases. */
export function ScrollingWaveform({ deck, color, zoom }: { deck: Deck; color: string; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; t: number; wasPlaying: boolean } | null>(null);

  useFrame(() => {
    const cv = ref.current;
    if (!cv) return;
    const { g, w, h } = setupCanvas(cv);
    g.clearRect(0, 0, w, h);
    const t = deck.track;
    const mid = w / 2;
    const cy = h / 2;
    if (!t) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = '14px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(`Deck ${deck.id} vazio — arraste uma música aqui`, mid, cy + 5);
      return;
    }
    const pos = deck.position();
    const rate = t.bpm ? deck.bpm / t.bpm : 1;
    const pps = zoom / rate; // pixels por segundo de música
    const wf = t.waveform;
    const per = wf.rate / pps; // pontos da onda por pixel
    for (let x = 0; x < w; x++) {
      const tt = pos + (x - mid) / pps;
      if (tt < 0 || tt > t.duration) continue;
      const i0 = Math.floor(tt * wf.rate);
      const i1 = Math.max(i0 + 1, Math.floor(i0 + per));
      let l = 0;
      let m = 0;
      let hi = 0;
      for (let i = i0; i < i1 && i < wf.low.length; i++) {
        if (wf.low[i] > l) l = wf.low[i];
        if (wf.mid[i] > m) m = wf.mid[i];
        if (wf.high[i] > hi) hi = wf.high[i];
      }
      const past = x < mid;
      g.globalAlpha = past ? 0.45 : 1;
      const H = cy - 4;
      g.fillStyle = COLORS.low;
      g.fillRect(x, cy - l * H, 1, l * H * 2);
      g.fillStyle = COLORS.mid;
      g.fillRect(x, cy - m * H * 0.6, 1, m * H * 1.2);
      g.fillStyle = COLORS.high;
      g.fillRect(x, cy - hi * H * 0.35, 1, hi * H * 0.7);
    }
    g.globalAlpha = 1;

    // Grid de batidas
    const beat = 60 / t.bpm;
    const first = Math.ceil((pos - mid / pps - t.firstBeat) / beat);
    const last = Math.floor((pos + mid / pps - t.firstBeat) / beat);
    g.font = '600 10px system-ui, sans-serif';
    g.textAlign = 'left';
    for (let k = first; k <= last; k++) {
      if (k < 0) continue;
      const x = mid + (t.firstBeat + k * beat - pos) * pps;
      const isBar = k % 4 === 0;
      const isPhrase = k % 32 === 0;
      if (isPhrase) {
        g.fillStyle = color;
        g.fillRect(x - 1, 0, 3, h);
        g.fillText(`FRASE ${k / 32 + 1}`, x + 5, 12);
      } else {
        g.fillStyle = isBar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
        g.fillRect(x, isBar ? 0 : h - 10, 1, isBar ? h : 10);
      }
    }

    // Loop ativo
    if (deck.loop) {
      const lx = mid + (deck.loop.start - pos) * pps;
      const rx = mid + (deck.loop.end - pos) * pps;
      g.fillStyle = 'rgba(82, 227, 164, 0.16)';
      g.fillRect(lx, 0, rx - lx, h);
      g.fillStyle = '#52e3a4';
      g.fillRect(lx, 0, 2, h);
      g.fillRect(rx - 2, 0, 2, h);
    }

    // Hot cues
    t.hotCues.forEach((hc, i) => {
      if (hc == null) return;
      const x = mid + (hc - pos) * pps;
      if (x < -20 || x > w + 20) return;
      g.fillStyle = CUE_COLORS[i];
      g.fillRect(x, 0, 2, h);
      g.fillRect(x, 0, 14, 14);
      g.fillStyle = '#0d0e14';
      g.font = '800 10px system-ui, sans-serif';
      g.fillText(String(i + 1), x + 4, 11);
    });

    // Ponto de CUE
    const cx = mid + (deck.cuePoint - pos) * pps;
    if (cx > -10 && cx < w + 10) {
      g.fillStyle = '#ff8a00';
      g.beginPath();
      g.moveTo(cx - 6, h);
      g.lineTo(cx + 6, h);
      g.lineTo(cx, h - 9);
      g.fill();
    }

    // Agulha
    g.fillStyle = '#ff3b5c';
    g.fillRect(mid - 1, 0, 2, h);
  });

  return (
    <canvas
      ref={ref}
      className="wave-scroll"
      aria-label={`Onda do deck ${deck.id}`}
      onPointerDown={(e) => {
        if (!deck.track) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, t: deck.position(), wasPlaying: deck.playing };
        if (deck.playing) deck.pause();
      }}
      onPointerMove={(e) => {
        if (!drag.current || !deck.track) return;
        const rate = deck.bpm / deck.track.bpm;
        deck.seek(drag.current.t - ((e.clientX - drag.current.x) / zoom) * rate);
      }}
      onPointerUp={() => {
        if (drag.current?.wasPlaying) deck.play();
        drag.current = null;
      }}
    />
  );
}

/** Visão geral da música inteira; clique para pular. */
export function OverviewWaveform({ deck, color }: { deck: Deck; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<{ id: string; img: HTMLCanvasElement } | null>(null);

  useEffect(() => {
    base.current = null;
  }, [deck.track]);

  useFrame(() => {
    const cv = ref.current;
    const t = deck.track;
    if (!cv) return;
    const { g, w, h } = setupCanvas(cv);
    g.clearRect(0, 0, w, h);
    if (!t) return;
    if (!base.current || base.current.id !== t.id + w) {
      const img = document.createElement('canvas');
      img.width = w;
      img.height = h;
      const ig = img.getContext('2d')!;
      const wf = t.waveform;
      const per = wf.low.length / w;
      for (let x = 0; x < w; x++) {
        let l = 0;
        let m = 0;
        for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) {
          l = Math.max(l, wf.low[i]);
          m = Math.max(m, wf.mid[i]);
        }
        ig.fillStyle = COLORS.low;
        ig.fillRect(x, h - l * h, 1, l * h);
        ig.fillStyle = COLORS.mid;
        ig.fillRect(x, h - m * h * 0.7, 1, m * h * 0.7);
      }
      base.current = { id: t.id + w, img };
    }
    const p = deck.position() / t.duration;
    g.globalAlpha = 0.4;
    g.drawImage(base.current.img, 0, 0, w, h);
    g.globalAlpha = 1;
    g.save();
    g.beginPath();
    g.rect(p * w, 0, w, h);
    g.clip();
    g.drawImage(base.current.img, 0, 0, w, h);
    g.restore();
    g.fillStyle = color;
    g.fillRect(p * w - 1, 0, 2, h);
    t.hotCues.forEach((hc, i) => {
      if (hc == null) return;
      g.fillStyle = CUE_COLORS[i];
      g.fillRect((hc / t.duration) * w - 1, 0, 3, h);
    });
    // Frases
    const beat = 60 / t.bpm;
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let tt = t.firstBeat; tt < t.duration; tt += beat * 32) g.fillRect((tt / t.duration) * w, 0, 1, 4);
  });

  return (
    <canvas
      ref={ref}
      className="wave-overview"
      aria-label={`Visão geral do deck ${deck.id} (clique para pular)`}
      onPointerDown={(e) => {
        if (!deck.track) return;
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        deck.seek(((e.clientX - r.left) / r.width) * deck.track.duration);
      }}
    />
  );
}

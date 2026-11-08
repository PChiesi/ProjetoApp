import { useRef } from 'react';
import type { AudioEngine, DeckId } from '../audio/engine';
import { useFrame } from '../hooks';
import { Knob } from './Knob';
import { Level, LevelContext } from './Level';
import { useContext } from 'react';

const db = (v: number) => (v <= -25.5 ? 'corte' : `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`);
const filt = (v: number) => (Math.abs(v) < 0.03 ? 'desligado' : v < 0 ? `graves ${Math.round(-v * 100)}%` : `agudos ${Math.round(v * 100)}%`);

function Channel({ engine, id }: { engine: AudioEngine; id: DeckId }) {
  const m = engine.mix;
  const color = id === 'A' ? 'var(--deck-a)' : 'var(--deck-b)';
  const set = (k: 'gain' | 'low' | 'mid' | 'high' | 'filter', v: number) => engine.setCh(k, id, v);
  return (
    <div className="channel" aria-label={`Canal ${id}`}>
      <div className="channel-name" style={{ color }}>
        {id}
      </div>
      <Level n={3}>
        <Knob label="GANHO" value={m.gain[id]} min={-12} max={12} center={0} onChange={(v) => set('gain', v)} format={db} color={color} size={36} />
      </Level>
      <Level n={2}>
        <Knob label="AGUDO" value={m.high[id]} min={-26} max={6} center={0} onChange={(v) => set('high', v)} format={db} color={color} size={40} />
        <Knob label="MÉDIO" value={m.mid[id]} min={-26} max={6} center={0} onChange={(v) => set('mid', v)} format={db} color={color} size={40} />
      </Level>
      <Knob label="GRAVE" coach="low" value={m.low[id]} min={-26} max={6} center={0} onChange={(v) => set('low', v)} format={db} color={color} size={52} title="Grave: gire para a esquerda para tirar o bumbo e o baixo" />
      <PflButton engine={engine} id={id} />
      <Knob label="FILTRO" value={m.filter[id]} min={-1} max={1} center={0} onChange={(v) => set('filter', v)} format={filt} color={color} size={52} title="Filtro: esquerda abafa, direita deixa só os agudos" />
    </div>
  );
}

function PflButton({ engine, id }: { engine: AudioEngine; id: DeckId }) {
  const level = useContext(LevelContext);
  if (level < 2 && engine.outputMode === 'normal') return null;
  const on = engine.decks[id].pfl;
  return (
    <button className={`btn tiny pfl ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => engine.setPfl(id, !on)} title="Ouvir este deck no fone (pré-escuta)">
      🎧
    </button>
  );
}

function Meters({ engine }: { engine: AudioEngine }) {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const hold = useRef({ A: 0, B: 0 });
  useFrame((dt) => {
    const p = engine.peaks();
    for (const [id, el] of [
      ['A', a.current],
      ['B', b.current],
    ] as const) {
      if (!el) continue;
      const v = Math.min(1, p[id] / 0.95);
      hold.current[id] = Math.max(v, hold.current[id] - dt * 1.2);
      el.style.setProperty('--lvl', String(hold.current[id]));
      el.classList.toggle('hot', p.clip);
    }
  });
  return (
    <div className="meters" aria-hidden>
      <div className="meter" ref={a} />
      <div className="meter" ref={b} />
    </div>
  );
}

function Fader({ engine, id }: { engine: AudioEngine; id: DeckId }) {
  return (
    <label className={`vfader vfader-${id.toLowerCase()}`}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={engine.mix.volume[id]}
        onChange={(e) => engine.setCh('volume', id, Number(e.target.value))}
        aria-label={`Volume do deck ${id}`}
      />
      <span>VOL</span>
    </label>
  );
}

export function Mixer({ engine }: { engine: AudioEngine }) {
  const m = engine.mix;
  return (
    <section className="mixer" aria-label="Mixer">
      <div className="mixer-top">
        <Channel engine={engine} id="A" />
        <Fader engine={engine} id="A" />
        <div className="mixer-center">
            <Knob label="MASTER" value={m.master} min={0} max={1} center={0.85} bipolar={false} onChange={(v) => engine.set('master', v)} format={(v) => `${Math.round(v * 100)}%`} size={36} />
          <Meters engine={engine} />
          <Level n={3}>
            <div className="mix-toggles">
              <button className={`chip ${engine.autoGain ? 'on' : ''}`} onClick={() => engine.setAutoGain(!engine.autoGain)} title="Iguala o volume entre as músicas">
                AUTO GAIN
              </button>
              <button className={`chip ${engine.decks.A.quantize ? 'on' : ''}`} onClick={() => engine.setQuantize(!engine.decks.A.quantize)} title="Cues e loops caem sempre na batida">
                QUANTIZE
              </button>
            </div>
          </Level>
        </div>
        <Fader engine={engine} id="B" />
        <Channel engine={engine} id="B" />
      </div>
      <div className="crossfader" data-coach="crossfader">
        <span className="xf-label a">A</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.001}
          value={m.crossfader}
          onChange={(e) => {
            let v = Number(e.target.value);
            if (Math.abs(v) < 0.04) v = 0; // ímã no centro
            engine.set('crossfader', v);
          }}
          onDoubleClick={() => engine.set('crossfader', 0)}
          aria-label="Crossfader"
        />
        <span className="xf-label b">B</span>
      </div>
    </section>
  );
}

/** Medidor de alinhamento das batidas entre os decks. */
export function AlignMeter({ engine }: { engine: AudioEngine }) {
  const ref = useRef<HTMLDivElement>(null);
  const smooth = useRef<number | null>(null);
  useFrame(() => {
    const el = ref.current;
    if (!el) return;
    const ms = engine.phaseOffsetMs();
    const a = engine.decks.A;
    const b = engine.decks.B;
    const label = el.querySelector<HTMLElement>('.align-text')!;
    if (ms === null) {
      smooth.current = null;
      el.dataset.state = 'idle';
      const both = a.playing && b.playing;
      label.textContent = both ? 'BPMs diferentes — use SYNC ou o TEMPO' : 'Toque os dois decks para comparar as batidas';
      el.style.setProperty('--off', '0');
      return;
    }
    smooth.current = smooth.current === null ? ms : smooth.current * 0.8 + ms * 0.2;
    const v = smooth.current;
    const beatMs = 60000 / b.bpm;
    el.style.setProperty('--off', String(Math.max(-1, Math.min(1, v / (beatMs / 2)))));
    const abs = Math.abs(v);
    el.dataset.state = abs < 15 ? 'good' : abs < 40 ? 'close' : 'bad';
    label.textContent =
      abs < 15 ? 'Batidas alinhadas ✓' : `${v > 0 ? 'B adiantado' : 'B atrasado'} ${abs.toFixed(0)} ms — ${v > 0 ? 'freie o B (◀)' : 'acelere o B (▶)'}`;
  });
  return (
    <div className="align" ref={ref} data-state="idle" role="status" aria-live="off">
      <div className="align-track">
        <span className="align-zone" />
        <span className="align-marker" />
      </div>
      <span className="align-text" />
    </div>
  );
}

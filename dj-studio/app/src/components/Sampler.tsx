import { useEffect, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import type { SoundBank } from '../studio/sounds';
import { storageGet, storageSet } from '../hooks';

export const SAMPLER_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];

function initialPads(bank: SoundBank): (string | null)[] {
  try {
    const saved = JSON.parse(storageGet('pista.sampler') ?? 'null');
    if (Array.isArray(saved) && saved.length === 8) return saved;
  } catch {
    /* ignora */
  }
  const ids = bank.all().map((s) => s.id);
  return Array.from({ length: 8 }, (_, i) => ids[i] ?? null);
}

/** 8 pads com vinheta, buzina, sirene… Tocam no tempo da música (meia batida). */
export function Sampler({ engine, bank, padsRef, onHit }: { engine: AudioEngine; bank: SoundBank; padsRef: { current: (i: number) => void }; onHit?: () => void }) {
  const [pads, setPads] = useState<(string | null)[]>(() => initialPads(bank));
  const [editing, setEditing] = useState<number | null>(null);
  const [vol, setVol] = useState(0.9);
  const [hit, setHit] = useState<number | null>(null);
  const [, setVer] = useState(0);
  useEffect(() => bank.subscribe(() => setVer((v) => v + 1)), [bank]);

  // Vinheta nova vai direto para um pad vazio (ou para o primeiro)
  useEffect(
    () =>
      bank.subscribe(() => {
        const user = bank.all().filter((s) => s.user);
        setPads((p) => {
          const missing = user.filter((u) => !p.includes(u.id));
          if (!missing.length) return p.map((id) => (id && !bank.get(id) ? null : id));
          const next = [...p];
          for (const m of missing) {
            const empty = next.indexOf(null);
            next[empty >= 0 ? empty : 0] = m.id;
          }
          storageSet('pista.sampler', JSON.stringify(next));
          return next;
        });
      }),
    [bank],
  );

  // Fecha o menu de troca de som ao clicar fora dele
  useEffect(() => {
    if (editing === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.sp-menu')) setEditing(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setEditing(null);
    const id = window.setTimeout(() => window.addEventListener('pointerdown', close), 0);
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [editing]);

  const trigger = (i: number) => {
    const s = pads[i] ? bank.get(pads[i]!) : undefined;
    if (!s) {
      setEditing(i);
      return;
    }
    engine.resume();
    engine.playSample(s.buffer);
    onHit?.();
    setHit(i);
    setTimeout(() => setHit((h) => (h === i ? null : h)), 160);
  };
  padsRef.current = trigger;

  const assign = (i: number, id: string | null) => {
    const next = [...pads];
    next[i] = id;
    setPads(next);
    storageSet('pista.sampler', JSON.stringify(next));
    setEditing(null);
  };

  return (
    <section className="sampler" aria-label="Sampler">
      <span className="fx-label">SAMPLER</span>
      <div className="sampler-pads">
        {pads.map((id, i) => {
          const s = id ? bank.get(id) : undefined;
          return (
            <div key={i} className="sp-wrap">
              <button
                className={`sp ${s ? '' : 'empty'} ${s?.user ? 'user' : ''} ${hit === i ? 'hit' : ''}`}
                onPointerDown={() => trigger(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditing(i);
                }}
                title={`${s ? s.name : 'Vazio'} — tecla ${SAMPLER_KEYS[i].toUpperCase()} · botão direito troca o som`}
              >
                <span className="sp-icon">{s?.icon ?? '+'}</span>
                <span className="sp-name">{s?.name ?? 'escolher'}</span>
                <kbd>{SAMPLER_KEYS[i].toUpperCase()}</kbd>
              </button>
              {editing === i && (
                <div className="sp-menu" role="menu" onMouseLeave={() => setEditing(null)}>
                  {bank.all().map((o) => (
                    <button key={o.id} role="menuitem" onClick={() => assign(i, o.id)}>
                      {o.icon} {o.name}
                    </button>
                  ))}
                  <button role="menuitem" className="muted" onClick={() => assign(i, null)}>
                    ✕ deixar vazio
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label className="sp-opt" title="Espera a próxima meia batida para o som entrar certinho no ritmo">
        <input type="checkbox" checked={engine.samplerQuantize} onChange={(e) => { engine.samplerQuantize = e.target.checked; setVer((v) => v + 1); }} /> no tempo
      </label>
      <label className="sp-opt">
        vol
        <input type="range" min={0} max={1.2} step={0.01} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); engine.setSamplerVolume(v); }} aria-label="Volume do sampler" />
      </label>
    </section>
  );
}

import { useState } from 'react';
import { LOOP_SIZES, type Deck } from '../audio/engine';

export const CUE_COLORS = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#52e3a4', '#22d3ee', '#4d7cff', '#b388ff', '#ff7ad9'];

const loopLabel = (b: number) => (b < 1 ? `1/${Math.round(1 / b)}` : String(b));

/** Pads de performance: HOT CUE ou LOOP (como nas controladoras). */
export function Pads({ deck }: { deck: Deck }) {
  const [mode, setMode] = useState<'cue' | 'loop'>('cue');
  const t = deck.track;
  return (
    <div className="pads">
      <div className="pad-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'cue'} className={`chip ${mode === 'cue' ? 'on' : ''}`} onClick={() => setMode('cue')}>
          HOT CUE
        </button>
        <button role="tab" aria-selected={mode === 'loop'} className={`chip ${mode === 'loop' ? 'on' : ''}`} onClick={() => setMode('loop')}>
          LOOP {deck.loop && <span className="loop-on">● {loopLabel(deck.loop.beats)}</span>}
        </button>
        {mode === 'cue' && (
          <button className="chip auto-cues" disabled={!t} onClick={() => deck.autoCues()} title="Marca hot cues no começo de cada parte da música (intro, drop, breakdown, outro)">
            ✨ Auto
          </button>
        )}
        <span className="pad-hint">
          {mode === 'cue' ? 'Vazio: marca · Marcado: pula · Botão direito: apaga' : 'Toque de novo para sair do loop'}
        </span>
      </div>
      {mode === 'cue' ? (
        <div className="pad-grid">
          {CUE_COLORS.map((c, i) => {
            const v = t?.hotCues[i];
            const set = v != null;
            return (
              <button
                key={i}
                className={`pad ${set ? 'set' : ''}`}
                style={set ? { background: c, borderColor: c } : { borderColor: c + '66' }}
                disabled={!t}
                onClick={(e) => (e.shiftKey ? deck.clearHotCue(i) : deck.hotCue(i))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  deck.clearHotCue(i);
                }}
                aria-label={set ? `Hot cue ${i + 1}: pular` : `Hot cue ${i + 1}: marcar aqui`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="pad-grid">
          {LOOP_SIZES.map((b) => (
            <button
              key={b}
              className={`pad loop ${deck.loop && Math.abs(deck.loop.beats - b) < 1e-9 ? 'active' : ''}`}
              disabled={!t}
              onClick={() => deck.autoLoop(b)}
              aria-label={`Loop de ${loopLabel(b)} batida${b > 1 ? 's' : ''}`}
            >
              {loopLabel(b)}
            </button>
          ))}
          <div className="loop-tools">
            <button className="btn tiny" disabled={!deck.loop} onClick={() => deck.resizeLoop(0.5)} title="Loop pela metade">
              ½
            </button>
            <button className="btn tiny" disabled={!deck.loop} onClick={() => deck.resizeLoop(2)} title="Loop em dobro">
              ×2
            </button>
            <button className="btn tiny" disabled={!deck.loop} onClick={() => deck.exitLoop()}>
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { DECK_FX, type AudioEngine, type DeckFxType, type DeckId } from '../audio/engine';
import { Knob } from './Knob';

/** Divisões de tempo por tipo de efeito (em batidas). */
const DIVS: Partial<Record<DeckFxType, [number, string][]>> = {
  eco: [[0.5, '1/2'], [0.75, '3/4'], [1, '1']],
  pingpong: [[0.5, '1/2'], [0.75, '3/4'], [1, '1']],
  dubeco: [[0.75, '3/4'], [1, '1']],
  roll: [[0.25, '1/4'], [0.5, '1/2'], [1, '1']],
  autofiltro: [[0.5, '1 bat.'], [0.75, '2 bat.'], [1, '4 bat.']],
};

const GROUPS = [...new Set(Object.values(DECK_FX).map((f) => f.group))];

/** Efeito ao vivo do deck: escolhe, liga/desliga (ou segura, no Roll) e ajusta a intensidade. */
export function DeckFxPanel({ engine, id }: { engine: AudioEngine; id: DeckId }) {
  const fx = engine.fx[id];
  const deck = engine.decks[id];
  const color = id === 'A' ? 'var(--deck-a)' : 'var(--deck-b)';
  const divs = DIVS[fx.type];
  const isRoll = fx.type === 'roll';

  const choose = (t: DeckFxType) => {
    const opts = DIVS[t];
    const div = opts && !opts.some(([v]) => v === fx.div) ? opts[Math.min(1, opts.length - 1)][0] : fx.div;
    engine.setFx(id, { type: t, div, on: t === 'roll' ? false : fx.on });
  };

  return (
    <div className="deck-fx" aria-label={`Efeitos do deck ${id}`}>
      <span className="fx-label">FX</span>
      <select className="fx-select" value={fx.type} onChange={(e) => choose(e.target.value as DeckFxType)} aria-label="Escolher efeito">
        {GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {(Object.keys(DECK_FX) as DeckFxType[])
              .filter((t) => DECK_FX[t].group === g)
              .map((t) => (
                <option key={t} value={t}>
                  {DECK_FX[t].name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {divs && (
        <div className="fx-divs" title="Tempo do efeito (em batidas)">
          {divs.map(([v, l]) => (
            <button key={v} className={`chip ${fx.div === v ? 'on' : ''}`} onClick={() => engine.setFx(id, { div: v })}>
              {l}
            </button>
          ))}
        </div>
      )}
      {!isRoll && (
        <Knob label="INTENS." value={fx.amount} min={0} max={1} center={0.5} bipolar={false} size={34} color={color} onChange={(v) => engine.setFx(id, { amount: v })} format={(v) => `${Math.round(v * 100)}%`} />
      )}
      {isRoll ? (
        <button
          className={`btn small fx-on ${fx.on ? 'on' : ''}`}
          disabled={!deck.playing}
          onPointerDown={() => engine.setFx(id, { on: true })}
          onPointerUp={() => engine.setFx(id, { on: false })}
          onPointerLeave={() => fx.on && engine.setFx(id, { on: false })}
          title="Segure para repetir; solte para a música voltar onde estaria"
        >
          SEGURE
        </button>
      ) : (
        <button className={`btn small fx-on ${fx.on ? 'on' : ''}`} aria-pressed={fx.on} onClick={() => engine.setFx(id, { on: !fx.on })} disabled={!deck.track}>
          {fx.on ? 'LIGADO' : 'LIGAR'}
        </button>
      )}
      <button className="btn small" onClick={() => deck.brake()} disabled={!deck.playing} title="Freio de vinil: a música desacelera até parar">
        ⏬ Freio
      </button>
      <button className="btn small" onClick={() => deck.spinback()} disabled={!deck.playing} title="Spinback: a música volta girando para trás e para">
        ⟲ Spinback
      </button>
      <p className="fx-desc">{DECK_FX[fx.type].desc}</p>
    </div>
  );
}

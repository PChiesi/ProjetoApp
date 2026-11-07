import { DECK_FX, type AudioEngine, type DeckFxType, type DeckId } from '../audio/engine';
import { Knob } from './Knob';

const DIVS: [number, string][] = [
  [0.5, '1/2'],
  [0.75, '3/4'],
  [1, '1'],
];

/** Efeito ao vivo do deck: escolhe, liga/desliga e ajusta a intensidade. */
export function DeckFxPanel({ engine, id }: { engine: AudioEngine; id: DeckId }) {
  const fx = engine.fx[id];
  const deck = engine.decks[id];
  const color = id === 'A' ? 'var(--deck-a)' : 'var(--deck-b)';
  return (
    <div className="deck-fx" aria-label={`Efeitos do deck ${id}`}>
      <span className="fx-label">FX</span>
      <div className="fx-types" role="radiogroup">
        {(Object.keys(DECK_FX) as DeckFxType[]).map((t) => (
          <button key={t} role="radio" aria-checked={fx.type === t} className={`chip ${fx.type === t ? 'on' : ''}`} title={DECK_FX[t].desc} onClick={() => engine.setFx(id, { type: t })}>
            {DECK_FX[t].name}
          </button>
        ))}
      </div>
      {fx.type === 'eco' && (
        <div className="fx-divs" title="Tempo do eco (em batidas)">
          {DIVS.map(([v, l]) => (
            <button key={v} className={`chip ${fx.div === v ? 'on' : ''}`} onClick={() => engine.setFx(id, { div: v })}>
              {l}
            </button>
          ))}
        </div>
      )}
      <Knob label="INTENS." value={fx.amount} min={0} max={1} center={0.5} bipolar={false} size={34} color={color} onChange={(v) => engine.setFx(id, { amount: v })} format={(v) => `${Math.round(v * 100)}%`} />
      <button className={`btn small fx-on ${fx.on ? 'on' : ''}`} aria-pressed={fx.on} onClick={() => engine.setFx(id, { on: !fx.on })} disabled={!deck.track}>
        {fx.on ? 'LIGADO' : 'LIGAR'}
      </button>
      <button className="btn small" onClick={() => deck.brake()} disabled={!deck.playing} title="Freio de vinil: a música desacelera até parar">
        ⏬ Freio
      </button>
    </div>
  );
}

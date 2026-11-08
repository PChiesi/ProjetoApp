import type { AudioEngine } from '../audio/engine';
import { TRANSITIONS, type TransitionId } from '../coach/transitions';

interface Props {
  engine: AudioEngine;
  running: string | null;
  automix: boolean;
  onRun: (id: TransitionId) => void;
  onCancel: () => void;
  onAutomix: (on: boolean) => void;
}

/** Transições prontas e Automix: o app faz e explica, para ela aprender vendo. */
export function AutoBar({ engine, running, automix, onRun, onCancel, onAutomix }: Props) {
  const ready = !!engine.decks.A.track && !!engine.decks.B.track && (engine.decks.A.playing || engine.decks.B.playing);
  return (
    <section className="autobar" aria-label="Transições prontas">
      <span className="fx-label">TRANSIÇÃO PRONTA</span>
      {(Object.keys(TRANSITIONS) as TransitionId[]).map((id) => (
        <button key={id} className="btn small tr-btn" disabled={!ready || !!running || automix} onClick={() => onRun(id)} title={TRANSITIONS[id].desc}>
          {TRANSITIONS[id].name}
          <small>{TRANSITIONS[id].short}</small>
        </button>
      ))}
      {running && !automix && (
        <button className="btn small ghost" onClick={onCancel}>
          ✕ Cancelar
        </button>
      )}
      <span className="sep-v" />
      <button className={`btn small automix ${automix ? 'on' : ''}`} aria-pressed={automix} onClick={() => onAutomix(!automix)} title="O app escolhe as músicas e mixa sozinho, explicando cada passo">
        🤖 Automix {automix ? 'ligado' : ''}
      </button>
    </section>
  );
}

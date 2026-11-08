import { STEM_IDS, STEM_INFO, type AudioEngine, type DeckId } from '../audio/engine';
import type { StemStatus } from '../audio/stems';

export interface StemJob {
  trackId: string;
  status: StemStatus;
}

interface Props {
  engine: AudioEngine;
  id: DeckId;
  job: StemJob | null;
  ready: boolean | null; // a música já tem stems salvos?
  onSeparate: (id: DeckId) => void;
}

function statusText(s: StemStatus): string {
  switch (s.phase) {
    case 'baixando':
      return `Baixando o modelo de IA (só na 1ª vez): ${Math.round(s.loaded / 1e6)} de ${Math.round(s.total / 1e6)} MB`;
    case 'preparando':
      return 'Preparando o modelo…';
    case 'separando':
      return `Separando no ${s.device}: ${Math.round(s.progress * 100)}%`;
    case 'salvando':
      return 'Salvando os stems…';
  }
}

function pct(s: StemStatus): number {
  return s.phase === 'baixando' ? s.loaded / s.total : s.phase === 'separando' ? s.progress : s.phase === 'salvando' ? 1 : 0;
}

/** Stems do deck: liga/desliga vocal, batida, baixo e melodia. */
export function StemsPanel({ engine, id, job, ready, onSeparate }: Props) {
  const deck = engine.decks[id];
  const t = deck.track;
  if (!t) return null;
  const mine = job?.trackId === t.id;

  if (deck.stems) {
    const only = (keep: (k: (typeof STEM_IDS)[number]) => boolean) => STEM_IDS.forEach((k) => deck.toggleStem(k, keep(k)));
    return (
      <div className="stems" aria-label={`Stems do deck ${id}`}>
        <span className="fx-label">STEMS</span>
        {STEM_IDS.map((k) => (
          <button key={k} className={`stem ${deck.stemOn[k] ? 'on' : ''} stem-${k}`} aria-pressed={deck.stemOn[k]} onClick={() => deck.toggleStem(k)} title={`${STEM_INFO[k].name}: ${deck.stemOn[k] ? 'tocando (clique para tirar)' : 'mudo (clique para voltar)'}`}>
            {STEM_INFO[k].icon} {STEM_INFO[k].name}
          </button>
        ))}
        <span className="sep-v" />
        <button className="chip" onClick={() => only((k) => k === 'vocals')} title="Só a voz">
          Acapella
        </button>
        <button className="chip" onClick={() => only((k) => k !== 'vocals')} title="Tudo menos a voz">
          Instrumental
        </button>
        <button className="chip" onClick={() => only(() => true)}>
          Tudo
        </button>
      </div>
    );
  }

  if (mine && job) {
    return (
      <div className="stems busy" role="status">
        <span className="fx-label">STEMS</span>
        <div className="stem-progress">
          <span style={{ width: `${Math.round(pct(job.status) * 100)}%` }} />
        </div>
        <small>{statusText(job.status)}</small>
      </div>
    );
  }

  return (
    <div className="stems">
      <span className="fx-label">STEMS</span>
      {ready ? (
        <small className="muted">Carregando stems…</small>
      ) : (
        <>
          <button className="btn small" disabled={!!job} onClick={() => onSeparate(id)} title="Separa a música em vocal, batida, baixo e melodia com IA (feito uma vez por música)">
            ✨ Separar vocal, batida, baixo e melodia
          </button>
          {job && <small className="muted">Outra música está sendo separada…</small>}
        </>
      )}
    </div>
  );
}

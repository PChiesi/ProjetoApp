import { useRef, useState } from 'react';
import type { AudioEngine, DeckId } from '../audio/engine';
import { beatInfo, camelotMatch } from '../audio/beat';
import { fmtTime, useFrame } from '../hooks';
import { Level } from './Level';
import { Pads } from './Pads';

interface Props {
  engine: AudioEngine;
  id: DeckId;
  onSyncFail: (id: DeckId) => void;
  onDropTrack: (id: DeckId, trackId: string) => void;
  onDropFiles: (id: DeckId, files: FileList) => void;
}

const MATCH_LABEL = {
  ok: { text: 'combina', cls: 'ok', icon: '●' },
  risco: { text: 'arriscado', cls: 'risk', icon: '▲' },
  conflito: { text: 'não combina', cls: 'bad', icon: '■' },
  desconhecido: { text: '', cls: '', icon: '' },
} as const;

export function DeckPanel({ engine, id, onDropTrack, onDropFiles, onSyncFail }: Props) {
  const deck = engine.decks[id];
  const other = engine.other(id);
  const t = deck.track;
  const [over, setOver] = useState(false);
  const counterRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  // Contador de batidas/compasso e tempo, atualizados a cada quadro sem re-render.
  useFrame(() => {
    const el = counterRef.current;
    if (!el || !deck.grid || !t) return;
    const pos = deck.position();
    const info = beatInfo(deck.grid, pos);
    const dots = el.querySelectorAll<HTMLElement>('.beat-dot');
    dots.forEach((d, i) => d.classList.toggle('on', info.beatInBar === i + 1));
    const bar = el.querySelector<HTMLElement>('.bar-count');
    if (bar) bar.textContent = info.phrase ? `Compasso ${info.barInPhrase}/8 · Frase ${info.phrase}` : 'Antes da 1ª batida';
    el.classList.toggle('phrase-soon', info.beatsToNextPhrase <= 4 && info.phrase > 0);
    if (timeRef.current) timeRef.current.textContent = `${fmtTime(pos)} / -${fmtTime(t.duration - pos)}`;
  });

  const match = MATCH_LABEL[camelotMatch(t?.key, other.track?.key)];
  const color = id === 'A' ? 'var(--deck-a)' : 'var(--deck-b)';
  const pct = (deck.bpm / (t?.bpm || 1) - 1) * 100;

  return (
    <section
      className={`deck deck-${id.toLowerCase()} ${over ? 'drop-over' : ''} ${deck.playing ? 'is-playing' : ''}`}
      aria-label={`Deck ${id}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const tid = e.dataTransfer.getData('text/pista-track');
        if (tid) onDropTrack(id, tid);
        else if (e.dataTransfer.files.length) onDropFiles(id, e.dataTransfer.files);
      }}
    >
      <header className="deck-head">
        <span className="deck-badge" style={{ background: color }}>
          {id}
        </span>
        <div className="deck-title">
          <strong>{t ? t.title : 'Vazio'}</strong>
          <span>{t ? t.artist : 'Arraste uma música da biblioteca para cá'}</span>
        </div>
        <span className="deck-time" ref={timeRef} />
      </header>

      <div className="deck-info">
        <div className="bpm" title="BPM = batidas por minuto">
          <b>{t ? deck.bpm.toFixed(1) : '--.-'}</b>
          <small>BPM</small>
          {t && Math.abs(pct) > 0.05 && <small className="pct">{(pct > 0 ? '+' : '') + pct.toFixed(1)}%</small>}
        </div>
        <div className={`key ${match.cls}`} title="Tom da música (roda de Camelot)">
          <b>{t?.key ?? '—'}</b>
          <small>TOM {match.text && <span className="key-match">{match.icon} {match.text}</span>}</small>
        </div>
        <div className="counter" ref={counterRef} aria-hidden>
          <div className="beat-dots">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className="beat-dot">
                {n}
              </span>
            ))}
          </div>
          <span className="bar-count">—</span>
        </div>
      </div>

      <div className="deck-controls">
        <button className="btn cue" data-coach={`cue-${id}`} onClick={() => deck.cue()} disabled={!t} title="CUE: tocando volta ao ponto; parado marca o ponto">
          CUE
        </button>
        <button
          className={`btn play ${deck.playing ? 'on' : ''}`}
          data-coach={`play-${id}`}
          onClick={() => {
            engine.resume();
            deck.toggle();
          }}
          disabled={!t}
          aria-label={deck.playing ? 'Pausar' : 'Tocar'}
          style={{ ['--beat' as string]: `${60 / (deck.bpm || 120)}s` }}
        >
          {deck.playing ? '❚❚' : '▶'}
        </button>
        <button
          className={`btn sync ${deck.synced ? 'on' : ''}`}
          data-coach={`sync-${id}`}
          onClick={() => {
            if (deck.synced) engine.unsync(id);
            else if (!engine.sync(id)) onSyncFail(id);
          }}
          disabled={!t || !other.track}
          title="SYNC: iguala o BPM e alinha as batidas com o outro deck"
        >
          SYNC
        </button>
        <Level n={2}>
          <div className="nudge" data-coach={`nudge-${id}`}>
            {(
              [
                [-1, '◀', 'Frear (segure)'],
                [1, '▶', 'Acelerar (segure)'],
              ] as const
            ).map(([dir, label, title]) => (
              <button
                key={dir}
                className="btn small"
                title={title}
                aria-label={title}
                disabled={!t}
                onPointerDown={() => deck.nudge(dir)}
                onPointerUp={() => deck.nudge(0)}
                onPointerLeave={() => deck.nudge(0)}
              >
                {label}
              </button>
            ))}
          </div>
        </Level>
      </div>

      <div className="tempo">
        <label>
          <span>TEMPO</span>
          <input
            type="range"
            className="tempo-slider"
            min={-1}
            max={1}
            step={0.001}
            value={deck.tempo}
            disabled={!t}
            onChange={(e) => {
              deck.synced = false;
              deck.setTempo(Number(e.target.value));
              engine.followTempo(id);
            }}
            onDoubleClick={() => {
              deck.setTempo(0);
              engine.followTempo(id);
            }}
            aria-label={`Tempo do deck ${id}`}
          />
        </label>
        <Level n={2}>
          <button className="btn tiny" onClick={() => deck.setRange(deck.range === 0.08 ? 0.16 : 0.08)} title="Alcance do tempo">
            ±{Math.round(deck.range * 100)}%
          </button>
        </Level>
      </div>

      <Level n={2}>
        <Pads deck={deck} />
      </Level>

      <Level n={3}>
        <div className="grid-tools" aria-label="Ajustar grid">
          <span>Grid</span>
          <button className="btn tiny" onClick={() => deck.adjustGrid({ bpmFactor: 0.5 })} disabled={!t} title="BPM pela metade">
            ÷2
          </button>
          <button className="btn tiny" onClick={() => deck.adjustGrid({ bpmFactor: 2 })} disabled={!t} title="BPM em dobro">
            ×2
          </button>
          <button className="btn tiny" onClick={() => deck.adjustGrid({ shiftBeats: -0.5 })} disabled={!t} title="Mover grid ½ batida para trás">
            ◀½
          </button>
          <button className="btn tiny" onClick={() => deck.adjustGrid({ shiftBeats: 0.5 })} disabled={!t} title="Mover grid ½ batida para frente">
            ½▶
          </button>
          <button className="btn tiny" onClick={() => deck.adjustGrid({ shiftBeats: 1 })} disabled={!t} title="O '1' está na batida errada? Avance 1 batida">
            1→
          </button>
          <span className="sep" />
          <span>Pular</span>
          <button className="btn tiny" onClick={() => deck.beatJump(-16)} disabled={!t}>
            −16
          </button>
          <button className="btn tiny" onClick={() => deck.beatJump(16)} disabled={!t}>
            +16
          </button>
        </div>
      </Level>
      {t && !t.demo && t.confidence < 0.35 && (
        <p className="deck-warn">⚠ Ritmo irregular (comum em rock ao vivo): o BPM pode variar. Use o ouvido e os botões ◀ ▶.</p>
      )}
    </section>
  );
}

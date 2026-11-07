import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine, DeckId, Track } from '../audio/engine';
import { camelotMatch } from '../audio/beat';
import { AUDIO_ACCEPT } from '../audio/library';
import { fmtTime } from '../hooks';

interface Props {
  engine: AudioEngine;
  tracks: Track[];
  pending: string[];
  onLoad: (deck: DeckId, track: Track) => void;
  onFiles: (files: FileList) => void;
  onEdit: (track: Track) => void;
  onRemove: (track: Track) => void;
  selectedId?: string;
  onSelect?: (id: string) => void;
  editing?: string;
}

type Filter = 'todas' | 'A' | 'B';

/** Combina com o deck: BPM até ±6% (ou dobro/metade) e tom compatível. */
function fits(t: Track, ref: Track | null): boolean {
  if (!ref || t.id === ref.id) return false;
  const r = t.bpm / ref.bpm;
  const near = [1, 2, 0.5].some((k) => Math.abs(r / k - 1) <= 0.06);
  const key = camelotMatch(t.key, ref.key);
  return near && key !== 'conflito';
}

export function Library({ engine, tracks, pending, onLoad, onFiles, onEdit, onRemove, editing, selectedId, onSelect }: Props) {
  // Linha escolhida pelo BROWSE da controladora fica visível
  useEffect(() => {
    if (selectedId) document.querySelector(`[data-track="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('todas');
  const input = useRef<HTMLInputElement>(null);
  const refA = engine.decks.A.track;
  const refB = engine.decks.B.track;

  // Referência para as cores de tom: o deck que está no ar.
  const live = (['A', 'B'] as DeckId[]).filter((d) => engine.decks[d].playing).sort((x, y) => engine.audibility(y) - engine.audibility(x))[0];
  const liveRef = live ? engine.decks[live].track : refA;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tracks.filter((t) => {
      if (s && !`${t.title} ${t.artist} ${t.genre ?? ''}`.toLowerCase().includes(s)) return false;
      if (filter === 'A') return fits(t, refA);
      if (filter === 'B') return fits(t, refB);
      return true;
    });
  }, [tracks, q, filter, refA, refB]);

  return (
    <section className="library" aria-label="Biblioteca">
      <div className="lib-bar">
        <h2>Biblioteca</h2>
        <input className="search" type="search" placeholder="Buscar música, artista ou gênero…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="tablist">
          {(
            [
              ['todas', 'Todas'],
              ['A', 'Combinam com A'],
              ['B', 'Combinam com B'],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn add" onClick={() => input.current?.click()}>
          + Adicionar músicas
        </button>
        <input
          ref={input}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="lib-table" role="table">
        <div className="lib-row lib-head" role="row">
          <span>Carregar</span>
          <span>Música</span>
          <span>Gênero</span>
          <span>BPM</span>
          <span title="Verde = combina com o deck que está tocando">Tom</span>
          <span>Duração</span>
        </div>
        {pending.map((name) => (
          <div key={name} className="lib-row pending" role="row">
            <span className="spinner" aria-hidden />
            <span>
              <strong>{name}</strong>
              <small>analisando batidas…</small>
            </span>
          </div>
        ))}
        {list.map((t) => {
          const kA = camelotMatch(t.key, liveRef?.key);
          return (
            <div
              key={t.id}
              className={`lib-row ${editing === t.id ? 'editing' : ''} ${selectedId === t.id ? 'selected' : ''}`}
              data-track={t.id}
              onClick={() => onSelect?.(t.id)}
              role="row"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/pista-track', t.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => onLoad(engine.decks.A.playing && !engine.decks.B.playing ? 'B' : 'A', t)}
            >
              <span className="load-btns">
                <button className="btn tiny a" onClick={() => onLoad('A', t)} aria-label={`Carregar ${t.title} no deck A`}>
                  A
                </button>
                <button className="btn tiny b" onClick={() => onLoad('B', t)} aria-label={`Carregar ${t.title} no deck B`}>
                  B
                </button>
                <button className={`btn tiny edit ${editing === t.id ? 'on' : ''}`} onClick={() => onEdit(t)} aria-label={`Editar ${t.title} no Estúdio`} title="Editar no Estúdio">
                  ✎
                </button>
              </span>
              <span>
                <strong>{t.title}</strong>
                <small>{t.artist}</small>
              </span>
              <span>{t.genre ?? '—'}</span>
              <span className="num">{t.bpm.toFixed(t.bpm % 1 ? 1 : 0)}</span>
              <span className={`key-cell ${kA === 'ok' ? 'ok' : kA === 'conflito' ? 'bad' : kA === 'risco' ? 'risk' : ''}`}>{t.key ?? '—'}</span>
              <span className="num dur-cell">
                {fmtTime(t.duration)}
                {!t.demo && (
                  <button className="row-x" onClick={() => onRemove(t)} aria-label={`Remover ${t.title} da biblioteca`} title="Remover da biblioteca">
                    ✕
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {list.length === 0 && pending.length === 0 && (
          <p className="lib-empty">{filter === 'todas' ? 'Nenhuma música encontrada.' : `Carregue uma música no deck ${filter} para ver as que combinam.`}</p>
        )}
      </div>
      <p className="lib-hint">Dica: arraste arquivos MP3/WAV/FLAC do seu computador para qualquer lugar da janela.</p>
    </section>
  );
}

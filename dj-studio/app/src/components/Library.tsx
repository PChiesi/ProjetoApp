import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine, DeckId, Track } from '../audio/engine';
import { camelotMatch } from '../audio/beat';
import { AUDIO_ACCEPT } from '../audio/library';
import { energyOf, suggestNext, type Suggestion } from '../audio/suggest';
import { fmtTime, storageGet, storageSet } from '../hooks';

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
  onShowSets?: () => void;
}

/** 'sugestoes' | 'todas' | 'A' | 'B' | 'tocadas' | 'pl:<nome>' */
type Filter = string;
type Playlists = Record<string, string[]>;

function loadPlaylists(): Playlists {
  try {
    const p = JSON.parse(storageGet('pista.playlists') ?? '{}');
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

const energyCache = new WeakMap<Track, number>();
const energy = (t: Track) => {
  let e = energyCache.get(t);
  if (e === undefined) energyCache.set(t, (e = energyOf(t.waveform)));
  return e;
};
const asSuggest = (t: Track) => ({ id: t.id, bpm: t.bpm, key: t.key, genre: t.genre, energy: energy(t) });

/** Combina com o deck: BPM até ±6% (ou dobro/metade) e tom compatível. */
function fits(t: Track, ref: Track | null): boolean {
  if (!ref || t.id === ref.id) return false;
  const r = t.bpm / ref.bpm;
  const near = [1, 2, 0.5].some((k) => Math.abs(r / k - 1) <= 0.06);
  const key = camelotMatch(t.key, ref.key);
  return near && key !== 'conflito';
}

export function Library({ engine, tracks, pending, onLoad, onFiles, onEdit, onRemove, editing, selectedId, onSelect, onShowSets }: Props) {
  const [playlists, setPlaylists] = useState<Playlists>(loadPlaylists);
  const [plMenu, setPlMenu] = useState<string | null>(null);
  const savePl = (p: Playlists) => {
    setPlaylists(p);
    storageSet('pista.playlists', JSON.stringify(p));
  };
  const newPlaylist = () => {
    const name = window.prompt('Nome da playlist (ex.: Baile de sexta, Aquecimento, Pop anos 2000):')?.trim();
    if (!name) return;
    if (!playlists[name]) savePl({ ...playlists, [name]: [] });
    setFilter(`pl:${name}`);
  };
  const toggleInPl = (name: string, id: string) => {
    const cur = playlists[name] ?? [];
    savePl({ ...playlists, [name]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
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

  // Sugestões a partir da música que está no ar
  const suggestions = useMemo(() => {
    const m = new Map<string, Suggestion & { rank: number }>();
    if (!liveRef) return m;
    suggestNext(asSuggest(liveRef), tracks.map(asSuggest), engine.played).forEach((x, i) => m.set(x.id, { ...x, rank: i }));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRef, tracks, engine.played.size]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (filter === 'sugestoes')
      return tracks
        .filter((t) => suggestions.has(t.id) && (!s || `${t.title} ${t.artist} ${t.genre ?? ''}`.toLowerCase().includes(s)))
        .sort((a, b) => suggestions.get(a.id)!.rank - suggestions.get(b.id)!.rank);
    return tracks.filter((t) => {
      if (s && !`${t.title} ${t.artist} ${t.genre ?? ''}`.toLowerCase().includes(s)) return false;
      if (filter === 'A') return fits(t, refA);
      if (filter === 'B') return fits(t, refB);
      if (filter === 'tocadas') return engine.played.has(t.id);
      if (filter.startsWith('pl:')) return (playlists[filter.slice(3)] ?? []).includes(t.id);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, q, filter, refA, refB, suggestions, playlists, engine.played.size]);

  return (
    <section className="library" aria-label="Biblioteca">
      <div className="lib-bar">
        <h2>Biblioteca</h2>
        <input className="search" type="search" placeholder="Buscar música, artista ou gênero…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="tablist">
          {(
            [
              ['sugestoes', '✨ Próxima'],
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
        {onShowSets && (
          <button className="btn ghost" onClick={onShowSets} title="Relatórios dos sets que você gravou">
            📊 Meus sets
          </button>
        )}
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
      <div className="chips pl-chips" role="tablist" aria-label="Playlists">
        <button role="tab" aria-selected={filter === 'tocadas'} className={`chip ${filter === 'tocadas' ? 'on' : ''}`} onClick={() => setFilter('tocadas')}>
          🕘 Tocadas hoje
        </button>
        {Object.keys(playlists).map((name) => (
          <button key={name} role="tab" aria-selected={filter === `pl:${name}`} className={`chip ${filter === `pl:${name}` ? 'on' : ''}`} onClick={() => setFilter(`pl:${name}`)}>
            📁 {name} <small>{playlists[name].length}</small>
          </button>
        ))}
        <button className="chip" onClick={newPlaylist}>
          + Playlist
        </button>
        {filter.startsWith('pl:') && (
          <button
            className="chip danger"
            onClick={() => {
              const n = filter.slice(3);
              if (!window.confirm(`Apagar a playlist "${n}"? (as músicas continuam na biblioteca)`)) return;
              const p = { ...playlists };
              delete p[n];
              savePl(p);
              setFilter('todas');
            }}
          >
            Apagar playlist
          </button>
        )}
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
                <strong>
                  {filter === 'sugestoes' && (suggestions.get(t.id)?.rank ?? 9) < 3 && <span className="top-pick">★</span>}
                  {t.title}
                </strong>
                <small>
                  {t.artist}
                  {filter === 'sugestoes' &&
                    suggestions.get(t.id)?.reasons.map((r) => (
                      <span key={r} className={`why ${r.startsWith('BPM longe') || r === 'já tocou' ? 'meh' : ''}`}>
                        {r}
                      </span>
                    ))}
                </small>
              </span>
              <span>{t.genre ?? '—'}</span>
              <span className="num">{t.bpm.toFixed(t.bpm % 1 ? 1 : 0)}</span>
              <span className={`key-cell ${kA === 'ok' ? 'ok' : kA === 'conflito' ? 'bad' : kA === 'risco' ? 'risk' : ''}`}>{t.key ?? '—'}</span>
              <span className="num dur-cell">
                {fmtTime(t.duration)}
                <span className="pl-wrap">
                  <button className="row-x pl-btn" onClick={(e) => { e.stopPropagation(); setPlMenu(plMenu === t.id ? null : t.id); }} aria-label={`Playlists de ${t.title}`} title="Adicionar a uma playlist">
                    📁
                  </button>
                  {plMenu === t.id && (
                    <span className="pl-menu" role="menu" onMouseLeave={() => setPlMenu(null)}>
                      {Object.keys(playlists).length === 0 && <span className="muted">Nenhuma playlist ainda</span>}
                      {Object.keys(playlists).map((name) => (
                        <label key={name}>
                          <input type="checkbox" checked={(playlists[name] ?? []).includes(t.id)} onChange={() => toggleInPl(name, t.id)} /> {name}
                        </label>
                      ))}
                      <button onClick={newPlaylist}>+ Nova playlist</button>
                    </span>
                  )}
                </span>
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
          <p className="lib-empty">
            {filter === 'todas'
              ? 'Nenhuma música encontrada.'
              : filter === 'sugestoes'
                ? 'Toque uma música para ver as melhores opções para entrar depois dela.'
                : filter === 'tocadas'
                  ? 'Nenhuma música tocou ainda nesta sessão.'
                  : filter.startsWith('pl:')
                    ? 'Playlist vazia. Use o 📁 ao lado de uma música para adicionar.'
                : `Carregue uma música no deck ${filter} para ver as que combinam.`}
          </p>
        )}
      </div>
      <p className="lib-hint">Dica: arraste arquivos MP3/WAV/FLAC do seu computador para qualquer lugar da janela.</p>
    </section>
  );
}

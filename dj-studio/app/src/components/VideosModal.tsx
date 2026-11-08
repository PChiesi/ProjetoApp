import { useState } from 'react';
import { searchUrl, VIDEO_TOPICS, youtubeUrl, type Video } from '../coach/videos';
import { LESSONS } from '../coach/lessons';
import { openExternal } from '../platform';
import { storageGet, storageSet } from '../hooks';

function loadWatched(): Record<string, number> {
  try {
    return JSON.parse(storageGet('pista.videos') ?? '{}');
  } catch {
    return {};
  }
}

/** Acervo de aulas: abre o vídeo no navegador e marca como assistido. */
export function VideosModal({ onClose, onLesson }: { onClose: () => void; onLesson: (lessonId: string) => void }) {
  const [watched, setWatched] = useState<Record<string, number>>(loadWatched);
  const [topic, setTopic] = useState(VIDEO_TOPICS[0].id);
  const [onlyPt, setOnlyPt] = useState(false);
  const t = VIDEO_TOPICS.find((x) => x.id === topic)!;
  const total = VIDEO_TOPICS.reduce((a, x) => a + x.videos.length, 0);
  const seen = Object.keys(watched).length;

  const mark = (v: Video, on: boolean) => {
    const next = { ...watched };
    if (on) next[v.id] = Date.now();
    else delete next[v.id];
    setWatched(next);
    storageSet('pista.videos', JSON.stringify(next));
  };

  const open = (v: Video) => {
    openExternal(youtubeUrl(v));
    mark(v, true);
  };

  const lesson = t.lesson ? LESSONS.find((l) => l.id === t.lesson) : undefined;
  const list = t.videos.filter((v) => !onlyPt || v.lang === 'pt');

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal videos" role="dialog" aria-label="Aulas em vídeo" onClick={(e) => e.stopPropagation()}>
        <div className="lessons-head">
          <h2>🎬 Aulas em vídeo</h2>
          <span className="muted">
            {seen} de {total} assistidos
          </span>
        </div>
        <p className="muted">Vídeos escolhidos para cada tema, em ordem. Eles abrem no YouTube; depois volte e pratique a lição da Pista do mesmo tema.</p>
        <div className="video-layout">
          <nav className="video-topics" aria-label="Temas">
            {VIDEO_TOPICS.map((x) => {
              const done = x.videos.filter((v) => watched[v.id]).length;
              return (
                <button key={x.id} className={`vt ${topic === x.id ? 'on' : ''}`} onClick={() => setTopic(x.id)}>
                  <span>{x.icon}</span>
                  <span className="vt-name">{x.title}</span>
                  <small>
                    {done}/{x.videos.length}
                  </small>
                </button>
              );
            })}
          </nav>
          <section className="video-list">
            <h3>
              {t.icon} {t.title}
            </h3>
            <p>{t.why}</p>
            <label className="sp-opt">
              <input type="checkbox" checked={onlyPt} onChange={(e) => setOnlyPt(e.target.checked)} /> só em português
            </label>
            {list.map((v, i) => (
              <div key={v.id} className={`video-row ${watched[v.id] ? 'seen' : ''}`}>
                <span className="vr-n">{watched[v.id] ? '✓' : i + 1}</span>
                <button className="vr-main" onClick={() => open(v)} title="Abrir no YouTube">
                  <strong>{v.title}</strong>
                  <small>
                    <span className={`lang ${v.lang}`}>{v.lang === 'pt' ? 'PT' : 'EN'}</span>
                    {v.short && <span className="lang">curtinho</span>}
                    {v.note}
                  </small>
                </button>
                <button className="btn tiny ghost" onClick={() => mark(v, !watched[v.id])}>
                  {watched[v.id] ? 'Desmarcar' : 'Já vi'}
                </button>
              </div>
            ))}
            {!list.length && <p className="muted">Nenhum vídeo em português neste tema ainda — desmarque o filtro ou busque mais abaixo.</p>}
            <div className="row-btns">
              <button className="btn ghost" onClick={() => openExternal(searchUrl(t.search))}>
                🔎 Buscar mais vídeos sobre "{t.title}"
              </button>
              {lesson && (
                <button
                  className="btn"
                  onClick={() => {
                    onClose();
                    onLesson(lesson.id);
                  }}
                >
                  🎓 Praticar: {lesson.title}
                </button>
              )}
            </div>
            <p className="muted tiny-note">Vídeos em inglês: no YouTube, use ⚙ → Legendas → Traduzir automaticamente → Português.</p>
          </section>
        </div>
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

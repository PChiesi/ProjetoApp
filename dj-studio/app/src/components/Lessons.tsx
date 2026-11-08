import { LESSONS, type Lesson } from '../coach/lessons';

export type Progress = Record<string, number>; // id → quando concluiu

export function LessonsModal({ progress, onStart, onClose }: { progress: Progress; onStart: (l: Lesson) => void; onClose: () => void }) {
  const done = LESSONS.filter((l) => progress[l.id]).length;
  const next = LESSONS.find((l) => !progress[l.id]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal lessons" role="dialog" aria-label="Lições" onClick={(e) => e.stopPropagation()}>
        <div className="lessons-head">
          <h2>🎓 Aprender a mixar</h2>
          <span className="muted">
            {done} de {LESSONS.length} lições
          </span>
        </div>
        <div className="lesson-progress" aria-hidden>
          <span style={{ width: `${(done / LESSONS.length) * 100}%` }} />
        </div>
        <p>Cada lição prepara os decks sozinha e confere cada passo enquanto você toca. Faça na ordem ou escolha a que quiser.</p>
        <div className="lesson-grid">
          {LESSONS.map((l, i) => {
            const ok = !!progress[l.id];
            return (
              <button key={l.id} className={`lesson-card ${ok ? 'done' : ''} ${next?.id === l.id ? 'next' : ''}`} onClick={() => onStart(l)}>
                <span className="lc-icon">{ok ? '✓' : l.icon}</span>
                <span className="lc-body">
                  <strong>
                    {i + 1}. {l.title}
                  </strong>
                  <small>{l.goal}</small>
                </span>
                <span className="lc-cta">{ok ? 'Refazer' : next?.id === l.id ? 'Começar ▶' : 'Abrir'}</span>
              </button>
            );
          })}
        </div>
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

/** Cartão flutuante da lição em andamento. */
export function LessonCard({ lesson, step, justPassed, onSkip, onExit }: { lesson: Lesson; step: number; justPassed: boolean; onSkip: () => void; onExit: () => void }) {
  return (
    <aside className={`lesson-live ${justPassed ? 'passed' : ''}`} role="status" aria-live="polite">
      <div className="ll-head">
        <span className="ll-icon">{lesson.icon}</span>
        <strong>{lesson.title}</strong>
        <span className="ll-dots" aria-label={`Passo ${step + 1} de ${lesson.steps.length}`}>
          {lesson.steps.map((_, i) => (
            <i key={i} className={i < step ? 'ok' : i === step ? 'cur' : ''} />
          ))}
        </span>
      </div>
      <p className="ll-text">{justPassed ? '✓ Isso!' : lesson.steps[step]?.text}</p>
      <div className="ll-actions">
        <span className="muted">
          Passo {Math.min(step + 1, lesson.steps.length)} de {lesson.steps.length}
        </span>
        <button className="btn tiny ghost" onClick={onSkip}>
          Pular passo
        </button>
        <button className="btn tiny ghost" onClick={onExit}>
          Sair da lição
        </button>
      </div>
    </aside>
  );
}

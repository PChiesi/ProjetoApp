import type { SetReport } from '../coach/report';
import { fmtTime } from '../hooks';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export function SetReportModal({ report, onClose }: { report: SetReport; onClose: () => void }) {
  const items = [
    ...report.tracks.map((t) => ({ at: t.at, kind: 'track' as const, t })),
    ...report.transitions.map((x) => ({ at: x.at, kind: 'tr' as const, x })),
  ].sort((a, b) => a.at - b.at);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal report" role="dialog" aria-label="Relatório do set" onClick={(e) => e.stopPropagation()}>
        <h2>{report.praise}</h2>
        <div className="report-stats">
          <div>
            <b>{fmtTime(report.duration)}</b>
            <small>duração</small>
          </div>
          <div>
            <b>{report.tracks.length}</b>
            <small>músicas</small>
          </div>
          <div>
            <b>{report.transitions.filter((t) => !t.auto).length}</b>
            <small>transições suas</small>
          </div>
          <div>
            <b className="gold">{report.avgStars ? report.avgStars.toFixed(1) + ' ★' : '—'}</b>
            <small>nota média</small>
          </div>
        </div>
        <div className="report-tip">
          <strong>🎯 Para treinar:</strong> {report.mainTip}
        </div>
        <div className="report-timeline">
          {items.map((it, i) =>
            it.kind === 'track' ? (
              <div key={i} className="rt-row track">
                <span className="rt-time">{fmtTime(it.at)}</span>
                <span>
                  ♪ <b>{it.t.title}</b> <small>{it.t.artist}</small>
                </span>
              </div>
            ) : (
              <div key={i} className="rt-row tr">
                <span className="rt-time">{fmtTime(it.at)}</span>
                <span>
                  <span className="rt-stars">{it.x.auto ? '🤖' : stars(it.x.stars)}</span> {it.x.from} → {it.x.to}
                  <small>
                    {it.x.auto ? 'feita pelo app' : `${Math.round(it.x.aligned * 100)}% alinhada · graves juntos ${Math.round(it.x.bassClash * 100)}% do tempo${it.x.clips ? ` · ${it.x.clips} estouro(s)` : ''}`}
                  </small>
                </span>
              </div>
            ),
          )}
          {!items.length && <p className="muted">Nada tocou durante a gravação.</p>}
        </div>
        <button className="btn primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

/** Lista dos sets gravados (relatórios salvos). */
export function SetsHistory({ sets, onOpen, onClose }: { sets: SetReport[]; onOpen: (r: SetReport) => void; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal report" role="dialog" aria-label="Meus sets" onClick={(e) => e.stopPropagation()}>
        <h2>📊 Meus sets</h2>
        {sets.length === 0 ? (
          <p>Nenhum set gravado ainda. Aperte ● REC, toque e pare a gravação para ver o relatório aqui.</p>
        ) : (
          <>
            <p className="muted">Sua evolução: compare a nota média dos sets ao longo do tempo.</p>
            <div className="sets-list">
              {sets.map((r, i) => (
                <button key={i} className="set-row" onClick={() => onOpen(r)}>
                  <span>{new Date(r.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{fmtTime(r.duration)}</span>
                  <span>{r.tracks.length} músicas</span>
                  <span className="gold">{r.avgStars ? `${r.avgStars.toFixed(1)} ★` : '—'}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

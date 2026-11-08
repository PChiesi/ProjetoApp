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

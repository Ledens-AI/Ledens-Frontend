import React from 'react';
import { eur, num, fechaHora, TIPO } from './format.js';
import { Kpi, Empty, ErrorBox } from './ui.jsx';

/* Landing screen of Gestión financiera: what is waiting, per table, and the
 * latest imputation changes (from ledens.imputation_audit). */
export default function Resumen({ summary, error, onRetry, go }) {
  if (error) return <ErrorBox message={error} onRetry={onRetry} />;
  const s = summary;
  return (
    <div className="fin-stack">
      <div className="fin-kpis">
        <Kpi label="Pendientes de asignación" value={s ? num(s.pendientes) : '…'} icon="ri-inbox-line" onClick={() => go('pendientes')} tone={s?.pendientes ? 'warn' : undefined} />
        <Kpi label="Importe sin proyecto" value={s ? eur(s.importePendiente) : '…'} icon="ri-money-euro-circle-line" onClick={() => go('pendientes')} />
        <Kpi label="Marcados para revisión" value={s ? num(s.revision) : '…'} icon="ri-flag-line" hint="Filtra por estado «Revisión» en cada tabla" />
        <Kpi label="Registros en total" value={s ? num(s.total) : '…'} icon="ri-stack-line" />
      </div>

      <div className="fin-grid-3">
        {Object.entries(TIPO).map(([t, d]) => {
          const x = s?.porTipo[t];
          const pct = x && x.total ? Math.round(((x.total - x.pendientes) / x.total) * 100) : 0;
          return (
            <button type="button" key={t} className="fin-card fin-typecard" onClick={() => go(t)}>
              <span className="fin-typecard-head"><i className={d.icon} style={{ background: d.bg, color: d.fg }}></i>{d.plural}</span>
              <span className="fin-typecard-num">{x ? `${num(x.pendientes)} sin proyecto` : '…'}</span>
              <span className="fin-muted">{x ? `de ${num(x.total)} registros · ${eur(x.importe_pendiente)} pendientes` : ''}</span>
              <span className="fin-progress" aria-label={`${pct}% imputado`}><span style={{ width: pct + '%' }}></span></span>
              <span className="fin-muted">{x ? `${pct} % imputado` : ''}</span>
            </button>
          );
        })}
      </div>

      <div className="fin-card">
        <div className="fin-card-head"><h2>Últimos cambios de imputación</h2></div>
        {s && !s.actividad.length ? <Empty icon="ri-history-line" title="Sin cambios todavía" text="Cada asignación, cambio o distribución aparecerá aquí con su autor y motivo." /> : null}
        <ol className="fin-history">
          {(s?.actividad || []).map((a) => (
            <li key={a.id}>
              <div><strong>{a.action}</strong>{` · ${TIPO[a.source_type].label}`}{a.old_label || a.new_label ? ` · ${a.old_label || 'sin proyecto'} → ${a.new_label || 'sin proyecto'}` : ''}</div>
              <div className="fin-muted">{`${fechaHora(a.at)} · ${a.actor_label}${a.origin === 'automatica' ? ' (automático)' : ''}`}</div>
              {a.reason ? <div className="fin-history-reason">{a.reason}</div> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

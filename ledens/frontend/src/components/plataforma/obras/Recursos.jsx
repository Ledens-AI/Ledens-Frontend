import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fecha } from '../finanzas/format.js';
import { Badge, Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';

/* Recursos (admin y jefe de obra; backend: presupuestos/recursos.js): each
 * worker of the list of Trabajadores with the obras whose cuadrillas they are
 * in (chosen in the Planificación / Gantt of each project), the dates each
 * obra occupies in its Gantt, and the overlaps — the same person in two obras
 * at once. Read-only: cuadrillas are changed from the Gantt. Spanish only. */
const ESTADO = {
  solape: { label: 'Solape', bg: '#FBE3E3', fg: '#A33A3A', icon: 'ri-error-warning-line' },
  en_obra: { label: 'En obra', bg: '#E3F1E7', fg: '#2E7A47', icon: 'ri-hammer-line' },
  reservado: { label: 'Reservado', bg: '#E4EEF8', fg: '#3A6A9C', icon: 'ri-calendar-check-line' },
  libre: { label: 'Libre', bg: '#EFEDE8', fg: '#5E5B54', icon: 'ri-checkbox-blank-circle-line' },
};
const ROL = { oficial: 'Oficial', peon: 'Peón' };

export default function Recursos() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const load = useCallback(() => api.recursos().then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.trabajadores || []).filter((t) => (!estado || t.estado === estado)
      && (!s || [t.name, t.puesto, ...t.asignaciones.flatMap((a) => [a.ref, a.title, a.project?.code, a.project?.name])].some((x) => String(x || '').toLowerCase().includes(s))));
  }, [data, q, estado]);

  const head = (
    <div className="fin-page-head">
      <h1>Recursos</h1>
      <p>Los trabajadores de la lista de Trabajadores y las obras en las que están, según las cuadrillas elegidas en la Planificación (Gantt) de cada proyecto. Las fechas son las que ocupa cada obra en su Gantt. Un solape es la misma persona en dos obras a la vez que aún no han terminado; se corrige cambiando la cuadrilla en el Gantt.</p>
    </div>
  );
  if (error) return <div className="fin obr">{head}<ErrorBox message={error} onRetry={load} /></div>;
  if (!data) return <div className="fin obr">{head}<div className="fin-loading fin-muted">Cargando recursos…</div></div>;

  const r = data.resumen;
  const kpi = (key, label, value, icon, tone) => <Kpi label={label} value={value} icon={icon} tone={tone} active={estado === key} onClick={() => setEstado(estado === key ? '' : key)} />;
  return (
    <div className="fin obr fin-stack">
      {head}
      <div className="fin-kpis">
        <Kpi label="Trabajadores activos" value={r.trabajadores} icon="ri-team-line" active={!estado} onClick={() => setEstado('')} />
        {kpi('en_obra', 'En obra hoy', r.enObra, 'ri-hammer-line')}
        {kpi('reservado', 'Reservados (próximas obras)', r.reservados, 'ri-calendar-check-line')}
        {kpi('libre', 'Libres', r.libres, 'ri-user-smile-line')}
        {kpi('solape', 'Con solape', r.conSolape, 'ri-error-warning-line', r.conSolape ? 'bad' : undefined)}
      </div>
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Trabajador, puesto, obra o proyecto" /></label>
        <label className="fin-field"><span>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
      </div>
      {!rows.length ? <Empty icon="ri-team-line" title="Nadie con ese filtro" text="Cambia la búsqueda o el estado." /> : (
        <div className="fin-card is-flush">
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>Trabajador</th><th>Puesto</th><th>Estado</th><th>Obras (cuadrilla · rol · fechas en el Gantt)</th></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const e = ESTADO[t.estado];
                  const clash = new Set(t.solapes.flatMap((s) => s.obras));
                  return (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong>{t.activo ? null : <div className="fin-muted fin-small">De baja</div>}</td>
                      <td>{t.puesto || <span className="fin-muted">—</span>}</td>
                      <td>
                        <Badge bg={e.bg} fg={e.fg} icon={e.icon}>{e.label}</Badge>
                        {t.solapes.map((s, i) => <div key={i} className="fin-small obr-rec-clash">{`${s.obras.join(' y ')}: ${fecha(s.desde)} → ${fecha(s.hasta)}`}</div>)}
                      </td>
                      <td>
                        {t.asignaciones.length ? (
                          <ul className="obr-rec-assign">
                            {t.asignaciones.map((a) => (
                              <li key={`${a.obraId}:${a.rol}`} className={clash.has(a.ref) ? 'is-clash' : a.terminada || (a.hasta && a.hasta < data.today) ? 'is-past' : ''}>
                                <strong>{a.ref}</strong>{` ${a.title}`}
                                {a.project?.code || a.project?.name ? <span className="fin-muted">{` · ${[a.project.code, a.project.name].filter(Boolean).join(' ')}`}</span> : null}
                                {` · cuadrilla ${a.cuadrilla} · ${ROL[a.rol]}`}
                                {a.planificada ? ` · ${fecha(a.desde)} → ${fecha(a.hasta)}` : <span className="fin-muted"> · sin planificación</span>}
                                {a.terminada ? <span className="fin-muted"> · terminada</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : <span className="fin-muted">Sin obra asignada</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

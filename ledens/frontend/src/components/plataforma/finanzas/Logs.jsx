import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Badge, Empty, ErrorBox, Pager } from './ui.jsx';

const STATUS = {
  ok: { label: 'Correcto', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-checkbox-circle-line' },
  rechazado: { label: 'Rechazado', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-forbid-line' },
  error: { label: 'Error', bg: '#FBE0EA', fg: '#B84371', icon: 'ri-error-warning-line' },
  en_curso: { label: 'En curso', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-loader-4-line' },
  sin_terminar: { label: 'Sin terminar', bg: '#FBE0EA', fg: '#B84371', icon: 'ri-time-line' },
};
const FILTERS = [['', 'Todos'], ['problemas', 'Con problemas'], ['error', 'Error'], ['rechazado', 'Rechazado'], ['sin_terminar', 'Sin terminar'], ['en_curso', 'En curso'], ['ok', 'Correcto']];
const pad = (n) => String(n).padStart(2, '0');
const when = (v) => { if (!v) return '—'; const d = new Date(v); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const ago = (v) => { if (!v) return 'nunca'; const m = Math.round((Date.now() - new Date(v)) / 60000); return m < 1 ? 'hace menos de 1 min' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
const dur = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const stateOf = (r) => (r.sin_terminar ? 'sin_terminar' : r.status);

/* Logs de transacciones (admins): every execution of the transaction processes
 * with how it ended. Data: GET /api/finanzas/logs and /logs/resumen. */
export default function Logs() {
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ proceso: '', estado: '', desde: '', hasta: '', vacios: false });
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [open, setOpen] = useState(null);
  const [auto, setAuto] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    Promise.all([
      api.logs({ proceso: filters.proceso, estado: filters.estado, desde: filters.desde, hasta: filters.hasta, q: query, vacios: filters.vacios ? 1 : '', pagina: page, tam: 50 }),
      api.logsSummary(),
    ]).then(([d, s]) => { if (!cancelled) { setData(d); setSummary(s); } }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [filters, query, page, reload]);
  // Optional auto-refresh every 30 s (the finance API allows 240 requests/min).
  useEffect(() => { if (!auto) return undefined; const t = setInterval(() => setReload((n) => n + 1), 30000); return () => clearInterval(t); }, [auto]);

  const set = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const processes = summary?.processes || {};
  const by = Object.fromEntries((summary?.last24h || []).map((r) => [r.process, r]));

  return (
    <div className="fin-stack">
      <div className="fin-log-cards">
        {Object.entries(processes).map(([k, label]) => {
          const s = by[k];
          const bad = s && (s.errores || s.sin_terminar);
          return (
            <button type="button" key={k} className={'fin-card fin-log-card' + (filters.proceso === k ? ' is-active' : '') + (bad ? ' is-bad' : '')}
              onClick={() => set('proceso', filters.proceso === k ? '' : k)} title="Últimas 24 horas">
              <span className="fin-log-card-title">{label}</span>
              {s ? (
                <span className="fin-log-counts">
                  <span className="is-ok">{s.ok} ok</span>
                  {s.rechazados ? <span className="is-warn">{s.rechazados} rechazados</span> : null}
                  {s.errores ? <span className="is-bad">{s.errores} errores</span> : null}
                  {s.sin_terminar ? <span className="is-bad">{s.sin_terminar} sin terminar</span> : null}
                </span>
              ) : <span className="fin-muted fin-small">Sin ejecuciones en 24 h</span>}
              <span className="fin-muted fin-small">{s ? `Última ejecución ${ago(s.ultima)}` : ''}</span>
              {s?.ultimo_problema ? <span className="fin-log-problem" title={s.ultimo_problema}>{s.ultimo_problema}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Paso, mensaje, código de error, registro o usuario" /></label>
        <label className="fin-field"><span>Proceso</span>
          <select value={filters.proceso} onChange={(e) => set('proceso', e.target.value)}>
            <option value="">Todos</option>{Object.entries(processes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="fin-field"><span>Estado</span>
          <select value={filters.estado} onChange={(e) => set('estado', e.target.value)}>{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="fin-field"><span>Desde</span><input type="date" value={filters.desde} onChange={(e) => set('desde', e.target.value)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={filters.hasta} onChange={(e) => set('hasta', e.target.value)} /></label>
        <label className="fin-check fin-self-end"><input type="checkbox" checked={filters.vacios} onChange={(e) => set('vacios', e.target.checked)} />Incluir ejecuciones sin actividad</label>
        <label className="fin-check fin-self-end"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Actualizar cada 30 s</label>
        <button type="button" className="fin-btn fin-self-end" onClick={() => setReload((n) => n + 1)}><i className="ri-refresh-line"></i>Actualizar</button>
      </div>

      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando logs…</div> : null}
        {data && !data.rows.length ? <Empty icon="ri-pulse-line" title="Sin ejecuciones con estos filtros" text="Los procesos se registran a partir de este despliegue." /> : null}
        {data && data.rows.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>Inicio</th><th>Proceso</th><th>Paso</th><th>Estado</th><th>Resultado</th><th>Registro</th><th className="fin-num">Duración</th><th>Usuario</th></tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const st = STATUS[stateOf(r)];
                  return (
                    <React.Fragment key={r.id}>
                      <tr className={'fin-log-row' + (open === r.id ? ' is-open' : '')} onClick={() => setOpen(open === r.id ? null : r.id)} tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(open === r.id ? null : r.id); }} aria-expanded={open === r.id}>
                        <td className="fin-nowrap">{when(r.started_at)}</td>
                        <td className="fin-nowrap">{processes[r.process] || r.process}</td>
                        <td>{r.step}</td>
                        <td><Badge {...st} icon={st.icon}>{st.label}</Badge></td>
                        <td className="fin-ellipsis is-wide" title={r.message || r.error_code || ''}>{r.message || r.error_code || <span className="fin-muted">—</span>}</td>
                        <td className="fin-nowrap fin-muted">{r.entity_type ? `${r.entity_type} ${String(r.entity_id || '').slice(0, 8)}` : '—'}</td>
                        <td className="fin-num fin-nowrap">{r.status === 'en_curso' ? '—' : dur(r.duration_ms)}</td>
                        <td className="fin-ellipsis">{r.actor_label || '—'}</td>
                      </tr>
                      {open === r.id ? (
                        <tr className="fin-log-detail"><td colSpan={8}>
                          <dl className="fin-dl">
                            <dt>Inicio</dt><dd>{new Date(r.started_at).toLocaleString('es-ES')}</dd>
                            <dt>Fin</dt><dd>{r.finished_at ? new Date(r.finished_at).toLocaleString('es-ES') : r.sin_terminar ? 'No terminó: el proceso se interrumpió (reinicio, tiempo de espera o fallo sin respuesta)' : 'Todavía en curso'}</dd>
                            {r.error_code ? <><dt>Código de error</dt><dd><code>{r.error_code}</code>{r.http_status ? ` · HTTP ${r.http_status}` : ''}</dd></> : null}
                            {r.entity_type ? <><dt>Registro</dt><dd><code>{r.entity_type} {r.entity_id}</code></dd></> : null}
                            <dt>Identificador del log</dt><dd><code>{r.id}</code></dd>
                          </dl>
                          {r.detail && Object.keys(r.detail).length ? <pre className="fin-log-json">{JSON.stringify(r.detail, null, 2)}</pre> : null}
                        </td></tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && data.total > data.pageSize ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </div>
    </div>
  );
}

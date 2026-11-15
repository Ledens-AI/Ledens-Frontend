import React, { useState } from 'react';
import { api } from './api.js';
import { ErrorBox } from '../finanzas/ui.jsx';
import { qty } from './PartidaReceta.jsx';

/* «Materiales y herramientas necesarios» of a presupuesto (team only, Spanish):
 * each counted line × the receta of its partida of the base (backend:
 * presupuestos/recetas.js → necesidades). Loaded when opened. Lines without a
 * partida, without receta or in another unit are listed so nothing is guessed. */
export default function Necesidades({ id, versionId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.necesidades(id, { version: versionId }).then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  return (
    <details className="fin-card obr-necesidades" onToggle={(e) => { if (e.currentTarget.open && !data) load(); }}>
      <summary><i className="ri-tools-line"></i> Materiales y herramientas necesarios</summary>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {!error && !data ? <div className="fin-loading fin-muted">Calculando…</div> : null}
      {data ? <NecesidadesBody data={data} /> : null}
    </details>
  );
}

export function NecesidadesBody({ data, tools = true }) {
  return (
    <>
      <p className="fin-muted fin-small">{`Calculado con la receta de cada partida (Operaciones → Partidas → Herramientas / Materiales) y la medición de ${data.lineas} ${data.lineas === 1 ? 'línea' : 'líneas'}${data.opcionalesExcluidas ? `; ${data.opcionalesExcluidas} opcionales o pendientes de decisión sin elegir no se cuentan` : ''}.`}</p>
      <div className="obr-necesidades-cols">
        <div>
          <h3 className="obr-h3">{`Materiales (${data.materiales.length})`}</h3>
          {data.materiales.length ? (
            <div className="fin-table-wrap"><table className="fin-table">
              <thead><tr><th>Material</th><th className="fin-num">Cantidad</th><th>Unidad</th></tr></thead>
              <tbody>{data.materiales.map((m) => (
                <tr key={`${m.name}|${m.unit}`} title={m.partidas.map((p) => `${p.code} · ${p.name}: ${qty(p.quantity)} ${m.unit}`).join('\n')}>
                  <td>{m.name}<div className="fin-muted fin-small">{[...new Set(m.partidas.map((p) => p.code))].join(', ')}</div></td>
                  <td className="fin-num fin-nowrap">{qty(m.quantity)}</td><td>{m.unit}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="fin-muted">Ninguna partida tiene materiales.</p>}
        </div>
        {tools ? (
          <div>
            <h3 className="obr-h3">{`Herramientas (${data.herramientas.length})`}</h3>
            {data.herramientas.length ? (
              <div className="fin-table-wrap"><table className="fin-table">
                <thead><tr><th>Herramienta</th><th>Categoría</th><th className="fin-num">Cantidad</th></tr></thead>
                <tbody>{data.herramientas.map((h) => (
                  <tr key={h.toolTypeId}><td>{h.name}<div className="fin-muted fin-small">{h.partidas.join(', ')}</div></td><td>{h.category}</td><td className="fin-num">{h.quantity}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="fin-muted">Ninguna partida tiene herramientas.</p>}
          </div>
        ) : null}
      </div>
      {data.sinReceta.length ? (
        <p className="fin-warn"><i className="ri-information-line"></i><span>{`No se cuentan ${data.sinReceta.length} ${data.sinReceta.length === 1 ? 'línea' : 'líneas'}: `}
          {data.sinReceta.map((s) => `${s.code ? `${s.code} ` : ''}«${s.name}» (${s.reason.toLowerCase()})`).join('; ')}</span></p>
      ) : null}
    </>
  );
}

import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, num, mesCorto } from './format.js';
import ProjectPicker from './ProjectPicker.jsx';
import { Kpi, Empty, ErrorBox } from './ui.jsx';

const C = { coste: '#5567AE', material: '#5567AE', trabajador: '#68C0B5', cobro: '#EC6090', presupuesto: '#CFD5EA' };

/* Profitability of one project, computed by the server from the confirmed
 * imputations only (splits counted by their parts). KPIs link to the records
 * that make them up. Figures without a reliable source are listed as
 * "no disponible" with the reason instead of being estimated. */
export default function Rentabilidad({ project, onProject, drill, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!project) return undefined;
    let cancelled = false;
    setData(null);
    api.profitability(project.id).then((d) => { if (!cancelled) { setData(d); setError(''); } }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [project, reload, version]);

  const k = data?.kpis;
  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <div className="fin-field fin-grow"><span>Proyecto</span>
          <ProjectPicker value={project} onChange={onProject} placeholder="Busca un proyecto por nombre, código o dirección" /></div>
      </div>
      {!project ? <div className="fin-card"><Empty icon="ri-line-chart-line" title="Elige un proyecto" text="Verás costes e ingresos reconocidos y, por separado, cobros y pagos." /></div> : null}
      {project && error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
      {project && !error && !data ? <div className="fin-loading">Calculando…</div> : null}
      {data ? (
        <>
          <div className="fin-project-head">
            <h2>{data.project.label}</h2>
            <span className="fin-muted">{[data.project.code, data.project.address, data.project.cliente, data.project.estado].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="fin-kpis">
            <Kpi label="Ingresos reconocidos" value={eur(k.ingresosReconocidos)} icon="ri-file-list-line" />
            <Kpi label="Resultado directo" value={eur(k.resultadoDirecto)} icon="ri-scales-line" />
            <Kpi label="Margen directo" value={k.margenDirectoPct===null?'—':num(k.margenDirectoPct)+' %'} icon="ri-percent-line" />
            <Kpi label="Pendiente de cobro" value={eur(k.cobrosPendientes)} icon="ri-time-line" />
            <Kpi label="Presupuesto aceptado" value={k.presupuesto === null ? 'Sin presupuesto' : eur(k.presupuesto)} icon="ri-file-list-3-line"
              hint={k.presupuesto === null ? 'No hay líneas de presupuesto aceptadas para este proyecto' : 'Versión aceptada y aprobada, importe sin IVA verificado'} />
            <Kpi label="Coste de materiales reconocido" value={eur(k.materiales)} icon="ri-hammer-line" onClick={() => drill('material')} hint={`${k.registros.material} registros`} />
            <Kpi label="Coste de trabajadores reconocido" value={eur(k.trabajadores)} icon="ri-user-settings-line" onClick={() => drill('trabajador')} hint={`${k.registros.trabajador} registros · coste reconocido`} />
            <Kpi label="Coste directo reconocido" value={eur(k.costeTotal)} icon="ri-calculator-line" hint="Materiales, mano de obra, subcontratas y otros costes directos aprobados" />
            <Kpi label="Cobros recibidos" value={eur(k.cobros)} icon="ri-hand-coin-line" onClick={() => drill('cliente')} hint={`${k.registros.cliente} pagos de clientes · no son ingresos reconocidos`} />
            <Kpi label="Margen previsto sobre presupuesto" value={k.margenPrevisto === null ? '—' : eur(k.margenPrevisto)} icon="ri-scales-3-line"
              tone={k.margenPrevisto !== null && Number(k.margenPrevisto) < 0 ? 'bad' : undefined}
              hint={k.margenPrevistoPct === null ? 'Necesita presupuesto aceptado' : `${num(k.margenPrevistoPct)} % · presupuesto − coste imputado`} />
            <Kpi label="Presupuesto consumido" value={k.consumoPresupuestoPct === null ? '—' : `${num(k.consumoPresupuestoPct)} %`} icon="ri-pie-chart-line" />
          </div>
          {k.distribucionesParciales ? (
            <div className="fin-warn"><i className="ri-alert-line"></i>{`${k.distribucionesParciales} registro(s) de este proyecto tienen una distribución incompleta: solo cuenta la parte asignada.`}</div>
          ) : null}

          <div className="fin-grid-2">
            <ChartCard title="Distribución de costes por categoría">
              <HBars rows={data.costesPorCategoria.map((r) => ({ label: r.categoria, value: Number(r.importe), color: C[r.type] }))}
                legend={[['Materiales', C.material], ['Mano de obra', C.trabajador]]} />
            </ChartCard>
            <ChartCard title="Evolución de costes e ingresos reconocidos">
              <MonthBars rows={data.evolucion} />
            </ChartCard>
            <ChartCard title="Presupuesto frente a coste real">
              {k.presupuesto === null ? <Empty icon="ri-file-list-3-line" title="Sin presupuesto aceptado" text="Se mostrará cuando el proyecto tenga líneas de presupuesto aceptadas." /> : (
                <PairBars rows={data.presupuestoVsCoste.map((r) => ({ label: r.categoria, a: Number(r.presupuesto), b: Number(r.coste) }))} aLabel="Presupuesto" bLabel="Coste imputado" />
              )}
            </ChartCard>
            <ChartCard title="Pagos y cobros">
              <PairBars rows={[{ label: 'Total del proyecto', a: Number(k.cobros), b: Number(k.pagos) }]} aLabel="Cobros de clientes" bLabel="Pagos realizados" aColor={C.cobro} />
              <p className="fin-muted fin-center">{`Diferencia de caja imputada: ${eur(k.flujoCaja)}`}</p>
            </ChartCard>
          </div>

          <div className="fin-card">
            <div className="fin-card-head"><h2>Criterios y registros pendientes</h2></div>
            <ul className="fin-na">
              {data.noDisponibles.map((n) => <li key={n.kpi}><strong>{n.kpi}</strong><span>{n.motivo}</span></li>)}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ChartCard({ title, children }) {
  return <div className="fin-card"><div className="fin-card-head"><h2>{title}</h2></div>{children}</div>;
}

function HBars({ rows, legend }) {
  if (!rows.length) return <Empty icon="ri-bar-chart-horizontal-line" title="Sin costes imputados" />;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <>
      <ul className="fin-hbars">
        {rows.slice(0, 10).map((r, i) => (
          <li key={i}><span className="fin-hbars-label" title={r.label}>{r.label}</span>
            <span className="fin-hbars-track"><span style={{ width: (Math.abs(r.value) / max) * 100 + '%', background: r.color }}></span></span>
            <span className="fin-hbars-val">{eur(r.value)}</span></li>
        ))}
      </ul>
      {rows.length > 10 ? <p className="fin-muted">{`Y ${rows.length - 10} categorías más.`}</p> : null}
      <Legend items={legend} />
    </>
  );
}

function PairBars({ rows, aLabel, bLabel, aColor = C.presupuesto, bColor = C.coste }) {
  if (!rows.length) return <Empty icon="ri-bar-chart-line" title="Sin datos" />;
  const max = Math.max(...rows.flatMap((r) => [Math.abs(r.a), Math.abs(r.b)]), 1);
  return (
    <>
      <ul className="fin-hbars is-pair">
        {rows.slice(0, 10).map((r, i) => (
          <li key={i}><span className="fin-hbars-label" title={r.label}>{r.label}</span>
            <span className="fin-hbars-stack">
              <span className="fin-hbars-track"><span style={{ width: (Math.abs(r.a) / max) * 100 + '%', background: aColor }} title={`${aLabel}: ${eur(r.a)}`}></span></span>
              <span className="fin-hbars-track"><span style={{ width: (Math.abs(r.b) / max) * 100 + '%', background: bColor }} title={`${bLabel}: ${eur(r.b)}`}></span></span>
            </span>
            <span className="fin-hbars-val">{eur(r.a)}<br />{eur(r.b)}</span></li>
        ))}
      </ul>
      <Legend items={[[aLabel, aColor], [bLabel, bColor]]} />
    </>
  );
}

function MonthBars({ rows }) {
  const months = [...new Set(rows.map((r) => r.mes))].sort().slice(-12);
  if (!months.length) return <Empty icon="ri-bar-chart-line" title="Sin movimientos fechados" />;
  const by = (m, types) => rows.filter((r) => r.mes === m && types.includes(r.type)).reduce((a, r) => a + Number(r.importe), 0);
  const data = months.map((m) => ({ m, coste: by(m, ['material', 'trabajador']), cobro: by(m, ['cliente']) }));
  const max = Math.max(...data.flatMap((d) => [d.coste, d.cobro]), 1);
  const W = 560, H = 220, P = 28, bw = Math.min(18, (W - P * 2) / months.length / 2.6);
  const x = (i) => P + ((W - P * 2) / months.length) * (i + 0.5);
  const lower=Math.min(0,...data.flatMap(d=>[d.coste,d.cobro]));
  const upper=Math.max(0,...data.flatMap(d=>[d.coste,d.cobro]));
  const y=v=>H-P-(v-lower)/(upper-lower||1)*(H-P*2);
  const zero=y(0);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="fin-svg" role="img" aria-label="Costes e ingresos reconocidos por mes">
        <line x1={P} x2={W - P} y1={zero} y2={zero} stroke="#D9D9D9" />
        {data.map((d, i) => (
          <g key={d.m}>
            <rect x={x(i) - bw - 1} y={Math.min(y(d.coste),zero)} width={bw} height={Math.abs(zero-y(d.coste))} fill={C.coste} rx="2"><title>{`${mesCorto(d.m)} · costes ${eur(d.coste)}`}</title></rect>
            <rect x={x(i) + 1} y={Math.min(y(d.cobro),zero)} width={bw} height={Math.abs(zero-y(d.cobro))} fill={C.cobro} rx="2"><title>{`${mesCorto(d.m)} · ingresos ${eur(d.cobro)}`}</title></rect>
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#6B6B68">{mesCorto(d.m)}</text>
          </g>
        ))}
        <text x={P} y={14} fontSize="11" fill="#6B6B68">{`máx. ${eur(max)}`}</text>
      </svg>
      <Legend items={[['Costes reconocidos', C.coste], ['Ingresos reconocidos', C.cobro]]} />
    </>
  );
}

function Legend({ items }) {
  return <div className="fin-legend">{items.map(([l, c]) => <span key={l}><i style={{ background: c }}></i>{l}</span>)}</div>;
}

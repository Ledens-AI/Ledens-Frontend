import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import RecordsView from './RecordsView.jsx';
import Resumen from './Resumen.jsx';
import Conciliacion from './Conciliacion.jsx';
import Rentabilidad from './Rentabilidad.jsx';
import { FIN_TABS } from './tabs.js';
import '../../../styles/finanzas.css';

const INTRO = {
  resumen: 'Estado de la imputación de materiales, pagos a trabajadores y cobros a proyectos.',
  pendientes: 'Registros sin proyecto. Elige el proyecto en cada fila o selecciona varios para asignarlos juntos.',
  material: 'Cada concepto de factura se imputa por separado: una misma factura puede repartirse entre obras.',
  trabajador: 'Un pago que cubre varias obras se distribuye por importes, sin duplicarlo.',
  cliente: 'Cobros recibidos de clientes. Son cobros, no ingresos reconocidos: un anticipo no es facturación.',
  concepto:'Líneas de facturas y documentos pendientes de clasificar, sin duplicar el original.',
  conciliacion: 'Movimientos bancarios pendientes de conciliar con sus documentos.',
  rentabilidad: 'Costes imputados, cobros y margen previsto de un proyecto.',
};

/* Gestión financiera (/plataforma, admins and jefes de obra). Data comes from
 * /api/finanzas, which enforces the same roles server-side. */
export default function GestionFinanciera({ tab, go, toast, onPending }) {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [version, setVersion] = useState(0);
  const [drill, setDrill] = useState(null); // { tab, project } from Rentabilidad
  const [rentProject, setRentProject] = useState(null);

  // Plataforma passes a new onPending on each render; a ref keeps loadSummary
  // stable so the summary is fetched on mount and after changes only.
  const pendingRef = useRef(onPending);
  pendingRef.current = onPending;
  const loadSummary = useCallback(() => api.summary().then(
    (s) => { setSummary(s); setSummaryError(''); pendingRef.current?.(s.pendientes); },
    (e) => setSummaryError(e.message),
  ), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const changed = useCallback(() => { setVersion((v) => v + 1); loadSummary(); }, [loadSummary]);
  // A drill-down filter only applies to the screen it was opened for.
  useEffect(() => { setDrill((d) => (d && d.tab !== tab ? null : d)); }, [tab]);

  const label = FIN_TABS.find((t) => t[0] === tab)?.[1] || '';
  const isRecords = ['pendientes', 'material', 'trabajador', 'cliente','concepto'].includes(tab);
  const project = drill && drill.tab === tab ? drill.project : null;

  return (
    <div className="fin">
      <div className="fin-page-head">
        <h1>{label}</h1>
        <p>{INTRO[tab]}</p>
      </div>
      {tab === 'resumen' ? <Resumen summary={summary} error={summaryError} onRetry={loadSummary} go={(t) => { setDrill(null); go(t); }} /> : null}
      {isRecords ? (
        <RecordsView mode={tab} summary={summary} initialProject={project} onChanged={changed} toast={toast} />
      ) : null}
      {tab === 'conciliacion' ? <Conciliacion /> : null}
      {tab === 'rentabilidad' ? (
        <Rentabilidad project={rentProject} onProject={setRentProject} version={version}
          drill={(t) => { setDrill({ tab: t, project: rentProject }); go(t); }} />
      ) : null}
    </div>
  );
}

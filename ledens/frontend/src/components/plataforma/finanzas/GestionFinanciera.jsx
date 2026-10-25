import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import RecordsView from './RecordsView.jsx';
import Resumen from './Resumen.jsx';
import Conciliacion from './Conciliacion.jsx';
import BridgeMovimientos from './BridgeMovimientos.jsx';
import PendienteTrabajador from './PendienteTrabajador.jsx';
import Proyectos from './Proyectos.jsx';
import Trabajadores from './Trabajadores.jsx';
import Logs from './Logs.jsx';
import Rentabilidad from './Rentabilidad.jsx';
import { FIN_TABS } from './tabs.js';
import '../../../styles/finanzas.css';

const INTRO = {
  resumen: 'Estado de la imputación de materiales, pagos a trabajadores y cobros a proyectos.',
  pendientes: 'Registros sin proyecto. Elige el proyecto en cada fila o selecciona varios para asignarlos juntos.',
  material: 'Cada concepto de factura se imputa por separado: una misma factura puede repartirse entre obras.',
  trabajador: 'Vista de consulta de los pagos a trabajadores, con su rol y proyecto. Los pagos nuevos se preparan en «Pendiente de trabajador».',
  cliente: 'Cobros recibidos de clientes. Son cobros, no ingresos reconocidos: un anticipo no es facturación.',
  concepto:'Líneas de facturas y documentos pendientes de clasificar, sin duplicar el original.',
  conciliacion: 'Movimientos bancarios pendientes de conciliar con sus documentos. Selecciona los pagos de nóminas y pulsa «Pago a trabajadores» para segregarlos.',
  bridge:'Enlaces entre movimientos y documentos existentes, con importes, estado y motivo de conciliación.',
  'pendiente-bridge':'Selecciona el documento existente y guarda la conciliación. Los movimientos completamente conciliados salen de esta bandeja.',
  'pendiente-trabajador': 'Pagos a trabajadores segregados de un movimiento bancario: más de 450 € en pagos de 100 € (Oficial), 450 € o menos en pagos de 60 € (Ayudante). Asigna trabajador y proyecto a cada uno y guárdalo.',
  rentabilidad: 'Costes imputados, cobros y margen previsto de un proyecto.',
  proyectos: 'Alta y edición de proyectos: código, cliente, dirección, estado y fechas. Los cambios quedan en la auditoría.',
  logs: 'Cada ejecución de los procesos de transacciones: cuándo empieza, si termina bien, si se rechaza o si falla, con su duración y el registro afectado.',
  trabajadores: 'Alta, edición, baja y reactivación de trabajadores. Una baja no borra nada: el trabajador conserva sus pagos y deja de ofrecerse para pagos nuevos.',
};

/* Gestión financiera (/plataforma, admins and jefes de obra). Data comes from
 * /api/finanzas, which enforces the same roles server-side. */
export default function GestionFinanciera({ tab, go, toast, onPending, onBridgePending }) {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [version, setVersion] = useState(0);
  const [drill, setDrill] = useState(null); // { tab, project } from Rentabilidad
  const [rentProject, setRentProject] = useState(null);

  // Plataforma passes a new onPending on each render; a ref keeps loadSummary
  // stable so the summary is fetched on mount and after changes only.
  const pendingRef = useRef(onPending);
  pendingRef.current = onPending;
  const bridgeRef=useRef(onBridgePending);bridgeRef.current=onBridgePending;
  const loadBridge=useCallback(()=>api.bridgeCounts().then(d=>bridgeRef.current?.(d.pending),()=>{}),[]);
  const loadSummary = useCallback(() => api.summary().then(
    (s) => { setSummary(s); setSummaryError(''); pendingRef.current?.(s.pendientes); },
    (e) => setSummaryError(e.message),
  ), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(()=>{loadBridge();},[loadBridge,tab]);
  const changed = useCallback(() => { setVersion((v) => v + 1); loadSummary(); loadBridge(); }, [loadSummary,loadBridge]);
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
      {tab === 'conciliacion' ? <Conciliacion toast={toast} onChanged={changed} go={go} /> : null}
      {tab==='bridge'||tab==='pendiente-bridge'?<BridgeMovimientos key={tab} pending={tab==='pendiente-bridge'} toast={toast} onChanged={changed} go={go} />:null}
      {tab === 'pendiente-trabajador' ? <PendienteTrabajador toast={toast} onChanged={changed} /> : null}
      {tab === 'proyectos' ? <Proyectos toast={toast} /> : null}
      {tab === 'trabajadores' ? <Trabajadores toast={toast} /> : null}
      {tab === 'logs' ? <Logs /> : null}
      {tab === 'rentabilidad' ? (
        <Rentabilidad project={rentProject} onProject={setRentProject} version={version}
          drill={(t) => { setDrill({ tab: t, project: rentProject }); go(t); }} />
      ) : null}
    </div>
  );
}

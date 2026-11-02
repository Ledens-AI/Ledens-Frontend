import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import RecordsView from './RecordsView.jsx';
import Resumen from './Resumen.jsx';
import Conciliacion from './Conciliacion.jsx';
import Conciliados from './Conciliados.jsx';
import BridgeMovimientos from './BridgeMovimientos.jsx';
import PendienteTrabajador from './PendienteTrabajador.jsx';
import Proyectos from './Proyectos.jsx';
import Trabajadores from './Trabajadores.jsx';
import Logs from './Logs.jsx';
import Rentabilidad from './Rentabilidad.jsx';
import ConceptoMovimientos from './ConceptoMovimientos.jsx';
import DocumentosSinAsignar from './DocumentosSinAsignar.jsx';
import { FIN_TABS } from './tabs.js';
import '../../../styles/finanzas.css';

const INTRO = {
  resumen: 'Estado de la imputación de materiales, pagos a trabajadores y cobros a proyectos.',
  pendientes: 'Materiales sin proyecto: compras importadas y facturas clasificadas como materiales. Los pagos a trabajadores y los cobros de clientes no aparecen aquí. Elige el proyecto en cada fila o selecciona varios para asignarlos juntos.',
  material: 'Cada concepto de factura se imputa por separado: una misma factura puede repartirse entre obras.',
  trabajador: 'Vista de consulta de los pagos a trabajadores, con su rol y proyecto. Los pagos nuevos se preparan en «Pendiente de trabajador».',
  cliente: 'Cobros recibidos de clientes. Son cobros, no ingresos reconocidos: un anticipo no es facturación.',
  'documentos-sin-asignar': 'Documentos procesados (facturas recibidas y emitidas) que todavía no tienen ningún movimiento asignado en el Bridge. Las entregas de Obramat ya pagadas con su anticipo no aparecen.',
  concepto: 'Todos los movimientos, bancarios y en efectivo, clasificados como pago de materiales, pago a trabajadores o cobro de clientes. La clasificación sale de los documentos conciliados en el Bridge; si no se puede deducir, el movimiento queda «Pendiente de clasificación». La rentabilidad por proyecto solo es completa cuando no queda ninguno pendiente.',
  conciliados: 'Movimientos ya conciliados con su factura y cómo está clasificado cada concepto: materiales, pagos a trabajadores o cobro de clientes. Si no estás de acuerdo, pulsa «Cambiar» e indica el motivo.',
  conciliacion: 'Movimientos bancarios pendientes de conciliar con sus documentos. Pulsa «Asignar documento» para conciliar un movimiento con una factura existente, o selecciona los pagos de nóminas y pulsa «Pago a trabajadores» para segregarlos.',
  bridge:'Enlaces entre movimientos y documentos existentes, con importes, estado y motivo de conciliación.',
  'pendiente-trabajador': 'Pagos a trabajadores segregados de un movimiento bancario: más de 450 € en pagos de 100 € (Oficial), 450 € o menos en pagos de 60 € (Ayudante). Asigna trabajador y proyecto a cada uno y guárdalo.',
  rentabilidad: 'Resultado (ingresos − costes) de cada proyecto a partir de los movimientos asignados, validados o no. Pulsa una barra o elige un proyecto para ver solo sus movimientos.',
  proyectos: 'Alta y edición de proyectos: código, cliente, dirección, estado y fechas. Los cambios quedan en la auditoría.',
  logs: 'Cada ejecución de los procesos de transacciones: cuándo empieza, si termina bien, si se rechaza o si falla, con su duración y el registro afectado.',
  trabajadores: 'Alta, edición, baja y reactivación de trabajadores. Una baja no borra nada: el trabajador conserva sus pagos y deja de ofrecerse para pagos nuevos.',
};

/* Gestión financiera (/plataforma, admins and jefes de obra). Data comes from
 * /api/finanzas, which enforces the same roles server-side. */
export default function GestionFinanciera({ tab, go, toast, onPending, onBridgePending, onConceptPending, onWorkerPending }) {
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
  const loadBridge=useCallback(()=>api.bridgeCounts().then(d=>bridgeRef.current?.(d.pending,d.reconciliation??d.pending),()=>{}),[]);
  // «Concepto de movimientos» badge (admins; anyone else gets 403 and keeps no badge).
  const conceptRef=useRef(onConceptPending);conceptRef.current=onConceptPending;
  const loadConcept=useCallback(()=>api.movementsPending().then(d=>conceptRef.current?.(d.pendientes),()=>{}),[]);
  // «Pendiente de trabajador» badge: amount still to assign (403 without the queue grant → no badge).
  const workerRef=useRef(onWorkerPending);workerRef.current=onWorkerPending;
  const loadWorker=useCallback(()=>api.workerQueueSummary().then(d=>workerRef.current?.(Number(d.importe)||0),()=>{}),[]);
  const loadSummary = useCallback(() => api.summary().then(
    (s) => { setSummary(s); setSummaryError(''); pendingRef.current?.(s.materiales?.pendientes ?? s.pendientes, s.clientes?.pendientes ?? 0); },
    (e) => setSummaryError(e.message),
  ), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(()=>{loadBridge();loadConcept();loadWorker();},[loadBridge,loadConcept,loadWorker,tab]);
  const changed = useCallback(() => { setVersion((v) => v + 1); loadSummary(); loadBridge(); loadConcept(); loadWorker(); }, [loadSummary,loadBridge,loadConcept,loadWorker]);
  // A drill-down filter only applies to the screen it was opened for.
  useEffect(() => { setDrill((d) => (d && d.tab !== tab ? null : d)); }, [tab]);

  const label = FIN_TABS.find((t) => t[0] === tab)?.[1] || '';
  const isRecords = ['pendientes', 'material', 'trabajador', 'cliente'].includes(tab);
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
      {tab === 'conciliados' ? <Conciliados toast={toast} onChanged={changed} /> : null}
      {tab === 'bridge' ? <BridgeMovimientos go={go} /> : null}
      {tab === 'documentos-sin-asignar' ? <DocumentosSinAsignar go={go} /> : null}
      {tab === 'concepto' ? <ConceptoMovimientos toast={toast} onChanged={changed} /> : null}
      {tab === 'pendiente-trabajador' ? <PendienteTrabajador toast={toast} onChanged={changed} /> : null}
      {tab === 'proyectos' ? <Proyectos toast={toast} /> : null}
      {tab === 'trabajadores' ? <Trabajadores toast={toast} /> : null}
      {tab === 'logs' ? <Logs /> : null}
      {tab === 'rentabilidad' ? (
        <Rentabilidad project={rentProject} onProject={setRentProject} version={version} toast={toast} />
      ) : null}
    </div>
  );
}

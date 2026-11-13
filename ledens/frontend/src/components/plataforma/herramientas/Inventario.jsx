import React, { useEffect, useRef, useState } from 'react';
import { tools } from './api.js';
import { ADMIN_FILTERS, FILTERS } from './labels.js';
import { ActionError, Sheet, ToolCard, useAction } from './ui.jsx';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';
import ToolForm from './ToolForm.jsx';

/* Inventario: search by name, category, brand or code, filter chips, cards on
 * every screen size (a table would not fit a phone). The server decides what
 * each card shows: outside a jefe's obras only «Otra obra», never who holds it
 * or what it cost. Administración also registers, imports and prints labels. */
export default function Inventario({ admin, initialFilter, readOnly, options, toast, onOpen, onPrint, onOptions }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(initialFilter || 'todas');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selecting, setSelecting] = useState(null); // Set of ids for labels
  const [tick, setTick] = useState(0); // reload
  const seq = useRef(0);

  useEffect(() => {
    const n = (seq.current += 1);
    const t = setTimeout(() => {
      tools.list({ q: q.trim() || undefined, estado: filter, pagina: page }).then((d) => {
        if (n !== seq.current) return; // an older search answering late
        setData((prev) => (page > 1 && prev ? { ...d, herramientas: [...prev.herramientas, ...d.herramientas] } : d)); setError('');
      }, (e) => n === seq.current && setError(e.message));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, filter, page, tick]);
  const reset = (fn) => (v) => { setPage(1); fn(v); };
  const chips = admin ? ADMIN_FILTERS : FILTERS;
  const toggle = (tool) => setSelecting((s) => { const n = new Set(s); if (n.has(tool.id)) n.delete(tool.id); else n.add(tool.id); return n; });

  return (
    <div className="tl">
      <div className="tl-head">
        <div><h2>Inventario</h2><p>{data ? `${data.total} herramienta${data.total === 1 ? '' : 's'}` : 'Herramientas y equipos de Ledens'}</p></div>
        {admin && !readOnly ? (
          <div className="obr-actions">
            {selecting ? <>
              <button type="button" className="fin-btn" onClick={() => setSelecting(null)}>Cancelar</button>
              <button type="button" className="fin-btn is-primary" disabled={!selecting.size} onClick={() => onPrint([...selecting])}><i className="ri-printer-line" aria-hidden="true"></i>{`Imprimir ${selecting.size} etiqueta${selecting.size === 1 ? '' : 's'}`}</button>
            </> : <>
              <button type="button" className="fin-btn" onClick={() => setSelecting(new Set())}><i className="ri-qr-code-line" aria-hidden="true"></i>Etiquetas QR</button>
              <button type="button" className="fin-btn" onClick={() => setImporting(true)}><i className="ri-upload-2-line" aria-hidden="true"></i>Importar CSV</button>
              <button type="button" className="fin-btn is-primary" onClick={() => setAdding(true)}><i className="ri-add-line" aria-hidden="true"></i>Dar de alta</button>
            </>}
          </div>
        ) : null}
      </div>
      <div className="tl-search">
        <div className="tl-search-row">
          <input type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Buscar por nombre, categoría, marca o código" aria-label="Buscar herramientas" enterKeyHint="search" />
        </div>
        <div className="tl-chips" role="tablist" aria-label="Filtrar">
          {chips.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={'tl-chip' + (filter === k ? ' is-on' : '')} onClick={() => reset(setFilter)(k)}>{l}</button>)}
        </div>
      </div>
      {error ? <ErrorBox message={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {!data && !error ? <div className="fin-loading fin-muted">Cargando inventario…</div> : null}
      {data && !data.herramientas.length ? <Empty icon="ri-hammer-line" title="No hay herramientas con este filtro" text={q ? 'Prueba con otro nombre o con el código de la etiqueta.' : undefined} /> : null}
      {data?.herramientas.length ? (
        <ul className="tl-cards">{data.herramientas.map((h) => <ToolCard key={h.id} tool={h} onOpen={(x) => onOpen(x.id)} selected={selecting?.has(h.id)} onSelect={selecting ? toggle : undefined} />)}</ul>
      ) : null}
      {data && data.herramientas.length < data.total ? <button type="button" className="fin-btn" style={{ alignSelf: 'center' }} onClick={() => setPage((p) => p + 1)}>Cargar más</button> : null}
      {adding ? <Sheet title="Dar de alta una herramienta" onClose={() => setAdding(false)}>
        <ToolForm options={options} toast={toast} onTypes={onOptions} onCancel={() => setAdding(false)} onSaved={(d) => { setAdding(false); onOpen(d.herramienta.id); }} />
      </Sheet> : null}
      {importing ? <ImportSheet toast={toast} onClose={(done) => { setImporting(false); if (done) { setPage(1); setTick((t) => t + 1); } }} /> : null}
    </div>
  );
}

// Initial inventory from a CSV: always simulated first; nothing is written while any row has an error.
function ImportSheet({ toast, onClose }) {
  const [text, setText] = useState('');
  const [report, setReport] = useState(null);
  const action = useAction(toast);
  const read = async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setReport(null); } };
  const simulate = async () => { const r = await action.run(() => tools.importCsv(text, true)); if (r) setReport(r); };
  const run = async () => { const r = await action.run(() => tools.importCsv(text, false)); if (r?.created) { toast?.(`${r.created} herramientas importadas`); onClose(true); } else if (r) setReport(r); };
  return (
    <Sheet title="Importar inventario (CSV)" onClose={() => onClose(false)} actions={<>
      <button type="button" className="fin-btn" onClick={() => onClose(false)}>Cerrar</button>
      <button type="button" className="fin-btn" disabled={!text || action.busy} onClick={simulate}>Comprobar</button>
      <button type="button" className="fin-btn is-primary" disabled={!report?.valid || action.busy} onClick={run}>{report?.valid ? `Importar ${report.rows}` : 'Importar'}</button>
    </>}>
      <p className="fin-muted" style={{ margin: 0 }}>Columnas (separadas por «;»): <code>tipo;categoria;seguimiento;nombre;marca;modelo;numero_serie;propiedad;propietario;fecha_adquisicion;coste;proveedor;garantia;ubicacion;observaciones</code>. Obligatorias: tipo, categoria y nombre. Se comprueba todo antes de guardar nada.</p>
      <input type="file" accept=".csv,text/csv" onChange={read} />
      {report ? (report.valid
        ? <div className="tl-banner is-ok"><i className="ri-checkbox-circle-line" aria-hidden="true"></i><div><strong>{`${report.rows} filas correctas`}</strong><span>Pulsa Importar para darlas de alta.</span></div></div>
        : <div className="tl-banner is-bad"><i className="ri-error-warning-line" aria-hidden="true"></i><div><strong>{`${report.errors.length} errores: no se ha importado nada`}</strong>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>{report.errors.slice(0, 30).map((e) => <li key={`${e.line}${e.error}`}>{`Fila ${e.line}: ${e.error}`}</li>)}</ul></div></div>) : null}
      <ActionError error={action.error} />
    </Sheet>
  );
}

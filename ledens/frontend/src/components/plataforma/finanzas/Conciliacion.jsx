import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Empty, ErrorBox, Pager } from './ui.jsx';

/* Read-only view over the existing reconciliation views (ledens.v_bank_balances,
 * ledens.v_document_balances): what is still unmatched. Matching itself is done
 * by the bank-sync / accounting process, not from this screen. */
export default function Conciliacion() {
  const [vista, setVista] = useState('movimientos');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    api.reconciliation({ vista, q: query, pagina: page, tam: 25 }).then(
      (d) => { if (!cancelled) { setData(d); setError(''); } },
      (e) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [vista, query, page, reload]);

  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <div className="fin-segmented" role="tablist">
          {[['movimientos', 'Movimientos sin conciliar'], ['documentos', 'Documentos con incidencia o pendientes']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={vista === k} className={vista === k ? 'is-on' : ''} onClick={() => { setVista(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <label className="fin-field fin-grow"><span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={vista === 'movimientos' ? 'Descripción, beneficiario, ordenante o referencia' : 'Emisor, número o descripción'} /></label>
      </div>
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
        {data && !data.rows.length ? <Empty icon="ri-checkbox-circle-line" title="Nada pendiente" text="No hay elementos sin conciliar con estos filtros." /> : null}
        {data && data.rows.length ? (
          <div className="fin-table-wrap">
            {vista === 'movimientos' ? (
              <table className="fin-table">
                <thead><tr><th>Fecha</th><th>Referencia</th><th>Banco</th><th>Descripción</th><th className="fin-num">Importe</th><th className="fin-num">Conciliado</th><th className="fin-num">Diferencia</th><th className="fin-num">Docs.</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="fin-nowrap">{fecha(r.completed_on)}</td><td className="fin-nowrap">{r.source_id}</td><td>{r.bank_account || '—'}</td>
                      <td className="fin-ellipsis is-wide" title={r.description || ''}>{r.description || r.beneficiary_name || r.payer || '—'}</td>
                      <td className="fin-num fin-nowrap">{eur(r.total_amount)}</td><td className="fin-num fin-nowrap">{eur(r.confirmed_allocated)}</td>
                      <td className="fin-num fin-nowrap"><strong>{eur(r.difference)}</strong></td><td className="fin-num">{r.document_links}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="fin-table">
                <thead><tr><th>Fecha</th><th>Número</th><th>Emisor / receptor</th><th>Descripción</th><th className="fin-num">Total</th><th className="fin-num">Pagado</th><th className="fin-num">Pendiente</th><th>Calidad</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="fin-nowrap">{fecha(r.document_on)}</td><td className="fin-nowrap">{r.numerodocumento || '—'}</td><td className="fin-ellipsis">{r.tercero || '—'}</td>
                      <td className="fin-ellipsis is-wide" title={r.descripcion || ''}>{r.descripcion || '—'}</td>
                      <td className="fin-num fin-nowrap">{eur(r.total)}</td><td className="fin-num fin-nowrap">{eur(r.paid)}</td>
                      <td className="fin-num fin-nowrap"><strong>{eur(r.balance)}</strong></td><td>{`${r.quality} · ${r.method}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
        {data && data.total > 0 ? <Pager page={page} pageSize={25} total={data.total} onPage={setPage} /> : null}
      </div>
    </div>
  );
}

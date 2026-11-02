import React, { useEffect, useState } from 'react';

/* DocumentoID / MovimientoID filters shared by Bridge Movimientos Documentos,
 * Pendiente de conciliación, Movimientos conciliados and Documentos sin asignar.
 * `ids` is the debounced value to send to the API ({ documentoid, movimientoid });
 * `onSettle` runs when it changes (back to the first page). */
export function useIdFilters(onSettle, delay = 300) {
  const [documentoid, setDocumentoid] = useState(''), [movimientoid, setMovimientoid] = useState('');
  const [ids, setIds] = useState({ documentoid: '', movimientoid: '' });
  useEffect(() => {
    const t = setTimeout(() => {
      const next = { documentoid: documentoid.trim(), movimientoid: movimientoid.trim() };
      if (next.documentoid === ids.documentoid && next.movimientoid === ids.movimientoid) return;
      setIds(next); onSettle?.();
    }, delay);
    return () => clearTimeout(t);
  }, [documentoid, movimientoid, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return { documentoid, setDocumentoid, movimientoid, setMovimientoid, ids, active: Boolean(ids.documentoid || ids.movimientoid) };
}

export function IdFields({ f }) {
  return <>
    <label className="fin-field"><span>DocumentoID</span><input type="search" value={f.documentoid} onChange={(e) => f.setDocumentoid(e.target.value)} /></label>
    <label className="fin-field"><span>MovimientoID</span><input type="search" value={f.movimientoid} onChange={(e) => f.setMovimientoid(e.target.value)} /></label>
  </>;
}

import React, { useEffect, useMemo, useState } from 'react';
import { tools } from './api.js';
import { drafts, todayISO } from './labels.js';
import { ActionError, BackLink, useAction } from './ui.jsx';

/* «Solicitar herramientas»: obra, herramientas y cantidades, fecha de
 * necesidad y de devolución, observaciones. Availability is shown per line
 * before sending; what was typed is kept as a local draft until the server
 * saves the request, and the same Idempotency-Key is reused on «Reintentar»
 * so a request is never sent twice. */
const DRAFT = 'solicitud';

export default function SolicitudForm({ options, preset, toast, onCancel, onSaved }) {
  const projects = (options?.projects || []).filter((p) => p.open !== false);
  const types = (options?.types || []).filter((t) => t.tracking !== 'consumible');
  const initial = useMemo(() => {
    const d = preset ? null : drafts.load(DRAFT);
    return d || {
      projectId: preset?.projectId || (projects.length === 1 ? projects[0].id : ''),
      neededFrom: todayISO(1), returnBy: todayISO(8), notes: '',
      items: preset?.tool ? [{ typeId: preset.tool.type.id, assetId: preset.tool.id, assetLabel: `${preset.tool.code} · ${preset.tool.name}`, quantity: 1 }] : [{ typeId: '', quantity: 1 }],
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [avail, setAvail] = useState({});
  const action = useAction(toast);
  useEffect(() => { if (!preset) drafts.save(DRAFT, f); }, [f, preset]);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setItem = (i, patch) => setF((x) => ({ ...x, items: x.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) }));

  // Availability of each type for the chosen dates (debounced).
  const typeIds = [...new Set(f.items.map((i) => i.typeId).filter(Boolean))].join(',');
  useEffect(() => {
    if (!typeIds || !f.neededFrom || !f.returnBy || f.returnBy < f.neededFrom) return undefined;
    const t = setTimeout(() => {
      for (const typeId of typeIds.split(',')) {
        tools.availability({ tipo: typeId, desde: f.neededFrom, hasta: f.returnBy, proyecto: f.projectId || undefined })
          .then((d) => setAvail((a) => ({ ...a, [typeId]: d })), () => setAvail((a) => ({ ...a, [typeId]: null })));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [typeIds, f.neededFrom, f.returnBy, f.projectId]);

  const datesOk = f.neededFrom && f.returnBy && f.returnBy >= f.neededFrom;
  const valid = f.projectId && datesOk && f.items.length && f.items.every((i) => i.typeId && i.quantity >= 1);
  const submit = async (draft) => {
    const body = { projectId: f.projectId, neededFrom: f.neededFrom, returnBy: f.returnBy, notes: f.notes.trim() || undefined, draft,
      items: f.items.map((i) => ({ typeId: i.typeId, assetId: i.assetId || undefined, quantity: Number(i.quantity), notes: i.notes || undefined })) };
    const out = await action.run((key) => tools.createRequest(body, key), draft ? 'Borrador guardado' : 'Solicitud enviada a administración');
    if (!out) return;
    drafts.clear(DRAFT);
    onSaved(out);
  };

  return (
    <div className="tl">
      <BackLink onBack={onCancel} />
      <div className="tl-head"><div><h2>Solicitar herramientas</h2><p>Administración revisa la disponibilidad y te confirma qué se reserva.</p></div></div>
      <div className="fin-card fin-form">
        <label className="fin-field"><span>1 · Obra</span>
          <select value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">Elige la obra…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
        <div className="fin-field"><span>2 · Herramientas y cantidades</span>
          <div className="fin-stack" style={{ gap: '8px' }}>
            {f.items.map((it, i) => {
              const a = avail[it.typeId];
              const short = a && a.available < it.quantity;
              return (
                <div key={i} className="tl-line">
                  {it.assetId ? <div className="fin-field"><span>Herramienta concreta</span><strong>{it.assetLabel}</strong></div> : (
                    <label className="fin-field"><span className="fin-sr">Tipo</span>
                      <select value={it.typeId} onChange={(e) => setItem(i, { typeId: e.target.value })} aria-label={`Herramienta ${i + 1}`}>
                        <option value="">Elige herramienta…</option>
                        {types.map((t) => <option key={t.id} value={t.id}>{`${t.name} (${t.category})`}</option>)}
                      </select>
                    </label>)}
                  <span className="tl-stepper" aria-label="Cantidad">
                    <button type="button" aria-label="Una menos" disabled={it.assetId || it.quantity <= 1} onClick={() => setItem(i, { quantity: it.quantity - 1 })}>−</button>
                    <input value={it.quantity} inputMode="numeric" aria-label="Cantidad" readOnly={!!it.assetId}
                      onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); setItem(i, { quantity: Math.max(1, Math.min(100, n || 1)) }); }} />
                    <button type="button" aria-label="Una más" disabled={!!it.assetId || it.quantity >= 100} onClick={() => setItem(i, { quantity: it.quantity + 1 })}>+</button>
                  </span>
                  <button type="button" className="fin-btn is-ghost tl-remove" aria-label="Quitar línea" disabled={f.items.length === 1} onClick={() => set({ items: f.items.filter((_, n) => n !== i) })}><i className="ri-delete-bin-line" aria-hidden="true"></i></button>
                  {it.typeId && datesOk ? (a === undefined ? <span className="tl-avail fin-muted">Comprobando disponibilidad…</span>
                    : a === null ? <span className="tl-avail fin-muted">No se ha podido comprobar la disponibilidad</span>
                      : <span className={'tl-avail ' + (short ? 'is-bad' : 'is-ok')}><i className={short ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} aria-hidden="true"></i>
                        {short ? `Solo ${a.available} libre${a.available === 1 ? '' : 's'} de ${a.total} esas fechas: administración puede aprobar una parte` : `${a.available} libre${a.available === 1 ? '' : 's'} de ${a.total} esas fechas`}</span>) : null}
                </div>
              );
            })}
            <button type="button" className="fin-btn" style={{ alignSelf: 'flex-start' }} onClick={() => set({ items: [...f.items, { typeId: '', quantity: 1 }] })}><i className="ri-add-line" aria-hidden="true"></i>Añadir herramienta</button>
          </div>
        </div>
        <div className="fin-grid-2">
          <label className="fin-field"><span>3 · La necesito desde</span><input type="date" value={f.neededFrom} min={todayISO()} onChange={(e) => set({ neededFrom: e.target.value })} /></label>
          <label className="fin-field"><span>4 · Devolución prevista</span><input type="date" value={f.returnBy} min={f.neededFrom || todayISO()} onChange={(e) => set({ returnBy: e.target.value })} /></label>
        </div>
        {!datesOk && f.neededFrom && f.returnBy ? <p className="fin-error-inline">La devolución no puede ser anterior a la fecha de necesidad.</p> : null}
        <label className="fin-field"><span>5 · Observaciones (opcional)</span><textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Para qué fase, dónde dejarla…" /></label>
        <ActionError error={action.error} onRetry={() => submit(false)} />
        <div className="obr-actions">
          <button type="button" className="fin-btn" disabled={!valid || action.busy} onClick={() => submit(true)}>Guardar borrador</button>
          <button type="button" className="fin-btn is-primary" disabled={!valid || action.busy} onClick={() => submit(false)}>{action.busy ? 'Enviando…' : 'Enviar solicitud'}</button>
        </div>
      </div>
    </div>
  );
}

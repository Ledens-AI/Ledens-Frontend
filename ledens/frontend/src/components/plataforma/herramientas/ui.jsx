import React, { useEffect, useRef, useState } from 'react';
import { newKey, tools } from './api.js';
import { statusOf, LOCATION_KIND, whereLine } from './labels.js';

// Building blocks of Ledens Tools. Styles: styles/herramientas.css (on top of
// finanzas.css). Spanish only, like every team screen of /plataforma.

export function StatusBadge({ status }) {
  const s = statusOf(status);
  return <span className="fin-badge" style={{ background: s.bg, color: s.fg }}><i className={s.icon} aria-hidden="true"></i>{s.label}</span>;
}

export function ToolThumb({ tool, large }) {
  const [failed, setFailed] = useState(false);
  const icon = tool?.kind === 'kit' ? 'ri-briefcase-4-line' : 'ri-hammer-line';
  return (
    <span className={'tl-thumb' + (large ? ' is-large' : '')} aria-hidden="true">
      {tool?.hasPhoto && !failed ? <img src={tools.photoSrc(tool.id, tool.version)} alt="" loading="lazy" onError={() => setFailed(true)} /> : <i className={icon}></i>}
    </span>
  );
}

export function ToolCard({ tool, onOpen, selected, onSelect }) {
  const kind = LOCATION_KIND[tool.location?.kind];
  return (
    <li>
      <button type="button" className={'tl-card' + (selected ? ' is-selected' : '')} onClick={() => (onSelect ? onSelect(tool) : onOpen(tool))}
        aria-pressed={onSelect ? !!selected : undefined} aria-label={`${tool.name}, ${tool.code}, ${statusOf(tool.status).label}`}>
        <ToolThumb tool={tool} />
        <span className="tl-card-body">
          <span className="tl-card-top"><span className="tl-card-name">{tool.name}</span><StatusBadge status={tool.status} /></span>
          <span className="tl-code">{tool.code}{tool.brand ? ` · ${tool.brand}` : ''}</span>
          <span className="tl-where"><i className={kind?.icon || 'ri-map-pin-line'} aria-hidden="true"></i><span>{whereLine(tool)}</span></span>
          {tool.pending ? <span className="tl-where" style={{ color: '#7A4E0E' }}><i className="ri-truck-line" aria-hidden="true"></i><span>{`Hacia ${tool.pending.to?.name}`}</span></span> : null}
        </span>
      </button>
    </li>
  );
}

// navigator.onLine is only a hint (it can say «online» with no real coverage):
// the request itself is what tells the truth; this banner only warns early.
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="tl-offline" role="status"><i className="ri-wifi-off-line" aria-hidden="true"></i><span>Sin conexión. Puedes consultar lo que ya está en pantalla; nada de lo que registres se guardará hasta que vuelva la red.</span></div>;
}

// One user action against the server. Success is shown only once the server
// confirmed it. A network failure or a 5xx keeps the same Idempotency-Key, so
// «Reintentar» can never register the movement twice; a definitive answer
// (4xx) ends the action and the next attempt is a new one.
export function useAction(toast) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyRef = useRef(null);
  const run = async (fn, okMessage) => {
    if (busy) return undefined;
    if (!keyRef.current) keyRef.current = newKey();
    setBusy(true); setError(null);
    try {
      const out = await fn(keyRef.current);
      keyRef.current = null;
      setBusy(false);
      if (okMessage) toast?.(out?.replayed ? `${okMessage} (ya estaba registrado)` : okMessage);
      return out ?? true;
    } catch (e) {
      if (e.status && e.status < 500) keyRef.current = null;
      setBusy(false); setError(e);
      return undefined;
    }
  };
  return { busy, error, run, clear: () => { keyRef.current = null; setError(null); } };
}

export function ActionError({ error, onRetry }) {
  if (!error) return null;
  const retriable = !error.status || error.status >= 500;
  return (
    <div className="fin-errorbox" role="alert">
      <i className={retriable ? 'ri-wifi-off-line' : 'ri-error-warning-line'} aria-hidden="true"></i>
      <span>{error.message}</span>
      {retriable && onRetry ? <button type="button" className="fin-btn" onClick={onRetry}>Reintentar</button> : null}
    </div>
  );
}

// A dialog that becomes a bottom sheet on a phone (styles: .tl-sheet).
export function Sheet({ title, children, actions, onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="fin-overlay tl-sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="fin-dialog">
        <h2>{title}</h2>
        <div className="fin-dialog-body fin-form">{children}</div>
        {actions ? <div className="fin-dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Tiles({ options, value, onChange, label }) {
  return (
    <div className="tl-tiles" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={'tl-tile' + (value === o.value ? ' is-on' : '') + (o.bad ? ' is-bad' : '')} onClick={() => onChange(o.value)}>
          {o.icon ? <i className={o.icon} aria-hidden="true"></i> : null}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function BackLink({ onBack, label = 'Volver' }) {
  return <button type="button" className="fin-btn is-ghost tl-noprint" style={{ alignSelf: 'flex-start' }} onClick={onBack}><i className="ri-arrow-left-line" aria-hidden="true"></i>{label}</button>;
}

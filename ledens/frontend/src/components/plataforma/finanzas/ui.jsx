import React, { useEffect, useRef } from 'react';

// Small building blocks shared by the Gestión financiera screens (styles in
// styles/finanzas.css, colours from the platform design).
export function Kpi({ label, value, icon, hint, onClick, active, tone }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={'fin-kpi' + (onClick ? ' is-clickable' : '') + (active ? ' is-active' : '') + (tone ? ' is-' + tone : '')}
      onClick={onClick} title={hint}>
      <span className="fin-kpi-label">{icon ? <i className={icon} aria-hidden="true"></i> : null}{label}</span>
      <span className="fin-kpi-value">{value}</span>
      {hint ? <span className="fin-kpi-hint">{hint}</span> : null}
    </Tag>
  );
}

export function Badge({ bg, fg, icon, children }) {
  return <span className="fin-badge" style={{ background: bg, color: fg }}>{icon ? <i className={icon} aria-hidden="true"></i> : null}{children}</span>;
}

export function Dialog({ title, children, actions, onClose, wide }) {
  const ref = useRef(null);
  // Callers pass a fresh onClose on every render; reading it through a ref
  // keeps this effect to mount/unmount, so focus is not yanked while typing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="fin-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={'fin-dialog' + (wide ? ' is-wide' : '')}>
        <h2>{title}</h2>
        <div className="fin-dialog-body">{children}</div>
        {actions ? <div className="fin-dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, children }) {
  return (
    <div className="fin-empty">
      <i className={icon} aria-hidden="true"></i>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="fin-errorbox" role="alert">
      <i className="ri-error-warning-line" aria-hidden="true"></i>
      <span>{message}</span>
      {onRetry ? <button type="button" className="fin-btn" onClick={onRetry}>Reintentar</button> : null}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage, extra }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="fin-pager">
      <span className="fin-muted">{`${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total}`}{extra ? ` · ${extra}` : ''}</span>
      <span className="fin-grow"></span>
      <button type="button" className="fin-btn is-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><i className="ri-arrow-left-s-line"></i></button>
      <span>{`Página ${page} de ${pages}`}</span>
      <button type="button" className="fin-btn is-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente"><i className="ri-arrow-right-s-line"></i></button>
    </div>
  );
}

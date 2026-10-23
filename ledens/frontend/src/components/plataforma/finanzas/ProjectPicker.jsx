import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';

/* Searchable project selector. Shows "Municipio — Nombre" with code, address
 * and client underneath; the uuid only travels in onChange. The list is
 * position:fixed so it is not clipped by scrolling tables. */
export default function ProjectPicker({ value, onChange, placeholder = 'Buscar proyecto…', disabled, compact, autoFocus, label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.projects(q).then(
        (d) => { if (!cancelled) { setItems(d.projects); setError(''); setActive(0); setLoading(false); } },
        (e) => { if (!cancelled) { setItems([]); setError(e.message); setLoading(false); } },
      );
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 320);
      const below = window.innerHeight - r.bottom;
      setPos({ left: Math.min(r.left, window.innerWidth - width - 8), width, ...(below < 280 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  const pick = (p) => { setOpen(false); setQ(''); onChange(p); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };

  return (
    <div className={'fin-picker' + (compact ? ' is-compact' : '')}>
      <i className="ri-search-line fin-picker-icon" aria-hidden="true"></i>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label || 'Proyecto'}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        disabled={disabled}
        value={open ? q : (value?.label || '')}
        placeholder={value?.label || placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); setQ(''); }, 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      {open && pos ? (
        <ul id={listId} role="listbox" className="fin-picker-list" style={pos}>
          {loading && !items.length ? <li className="fin-picker-empty">Buscando…</li> : null}
          {error ? <li className="fin-picker-empty is-error">{error}</li> : null}
          {!loading && !error && !items.length ? <li className="fin-picker-empty">{q ? `Ningún proyecto coincide con «${q}»` : 'No hay proyectos'}</li> : null}
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={'fin-picker-item' + (i === active ? ' is-active' : '') + (value?.id === p.id ? ' is-current' : '')}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="fin-picker-label">{p.label}</span>
              <span className="fin-picker-sub">{[p.code, p.address, p.cliente, p.estado].filter(Boolean).join(' · ') || 'Sin más datos'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

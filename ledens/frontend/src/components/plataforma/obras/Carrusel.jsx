import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useObrasI18n } from './i18n.js';

/* Photo carousel of an obra: previous/next buttons, arrow keys, swipe on touch
 * screens, full screen and a strip of thumbnails. `fotos` come from
 * /api/obras/:id/archivos; `actions(foto)` draws extra buttons for the team. */
export default function Carrusel({ fotos, actions }) {
  const { t, fecha } = useObrasI18n();
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState({});
  const [loaded, setLoaded] = useState({});
  const overlay = useRef(null);
  const strip = useRef(null);
  const touch = useRef(null);
  const n = fotos.length;
  const at = Math.min(i, n - 1);
  const foto = fotos[at];

  const go = useCallback((d) => setI((x) => (Math.min(x, n - 1) + d + n) % n), [n]);
  const close = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  // Full screen: our own overlay (iPhone Safari has no element full screen),
  // promoted to the browser's full screen where it exists.
  useEffect(() => {
    if (!full) return undefined;
    overlay.current?.focus();
    overlay.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') close();
    };
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); document.body.style.overflow = scroll; };
  }, [full, go, close]);

  useEffect(() => {
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [at]);

  // Neighbours load ahead so swiping does not wait.
  useEffect(() => {
    [at + 1, at - 1].forEach((k) => { const f = fotos[(k + n) % n]; if (f && f.id !== foto?.id) new Image().src = f.url; });
  }, [at, fotos, n, foto]);

  if (!n) return null;
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    if (!s || n < 2) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  const onKeyDown = (e) => {
    if (full) return; // the full-screen listener has it
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };

  const stage = (inFull) => (
    <div className={'obr-car-stage' + (inFull ? ' is-full' : '')} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {failed[foto.id] ? (
        <div className="obr-car-missing">
          <i className="ri-image-line" aria-hidden="true"></i>
          <span>{t.heic}</span>
          <a className="fin-btn is-small" href={foto.downloadUrl}><i className="ri-download-2-line"></i>{t.download}</a>
        </div>
      ) : (
        <>
          {!loaded[foto.id] ? <span className="obr-car-spinner" aria-hidden="true"></span> : null}
          <img key={foto.id} src={foto.url} alt={foto.title || foto.name} draggable={false}
            onLoad={() => setLoaded((s) => ({ ...s, [foto.id]: true }))}
            onError={() => setFailed((s) => ({ ...s, [foto.id]: true }))} />
        </>
      )}
      {n > 1 ? <>
        <button type="button" className="obr-car-nav is-prev" aria-label={t.prevPhoto} onClick={() => go(-1)}><i className="ri-arrow-left-s-line"></i></button>
        <button type="button" className="obr-car-nav is-next" aria-label={t.nextPhoto} onClick={() => go(1)}><i className="ri-arrow-right-s-line"></i></button>
      </> : null}
      <span className="obr-car-count" aria-live="polite">{`${at + 1} / ${n}`}</span>
      {inFull
        ? <button type="button" className="obr-car-full" aria-label={t.closeFull} onClick={close}><i className="ri-close-line"></i></button>
        : <button type="button" className="obr-car-full" aria-label={t.openFull} onClick={() => setFull(true)}><i className="ri-fullscreen-line"></i></button>}
    </div>
  );
  const caption = (
    <div className="obr-car-caption">
      <div>
        <strong>{foto.title || foto.name}</strong>
        <span className="fin-muted fin-small">{[fecha(foto.date), foto.uploadedBy ? t.photoBy(foto.uploadedBy) : null].filter(Boolean).join(' · ')}</span>
        {foto.description ? <p className="obr-pre">{foto.description}</p> : null}
      </div>
      {actions ? <div className="obr-actions">{actions(foto)}</div> : null}
    </div>
  );

  return (
    <div className="obr-car" tabIndex={0} onKeyDown={onKeyDown} aria-roledescription={t.carousel} aria-label={t.carouselLabel}>
      {stage(false)}
      {caption}
      {n > 1 ? (
        <div className="obr-car-strip" ref={strip}>
          {fotos.map((f, k) => (
            <button key={f.id} type="button" className={'obr-car-thumb' + (k === at ? ' is-on' : '')} aria-current={k === at} aria-label={t.photoN(k + 1, f.title || f.name)} onClick={() => setI(k)}>
              {f.thumbUrl || !/hei[cf]/.test(f.mime) ? <img src={f.thumbUrl || f.url} alt="" loading="lazy" draggable={false} /> : <i className="ri-image-line" aria-hidden="true"></i>}
            </button>
          ))}
        </div>
      ) : null}
      {full ? (
        <div className="obr-car-overlay" ref={overlay} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t.fullLabel}>
          {stage(true)}
          <div className="obr-car-overlay-caption">
            <strong>{foto.title || foto.name}</strong>
            <span>{fecha(foto.date)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

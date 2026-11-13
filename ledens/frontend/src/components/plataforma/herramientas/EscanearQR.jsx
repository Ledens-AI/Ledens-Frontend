import React, { useEffect, useRef, useState } from 'react';
import { tools } from './api.js';
import { parseScan } from './labels.js';

/* Escanear QR. The camera is read in the browser with BarcodeDetector where
 * it exists (Chrome on Android, recent Edge/Chrome desktop) and the user grants
 * it; on iPhone (Safari has no BarcodeDetector) the system Camera app reads the
 * label and opens its https link, which lands on the same ficha after login.
 * The manual search by code is always there. A label only identifies: the ficha
 * then applies the user's own permissions. */
export default function EscanearQR({ onFound, toast }) {
  const video = useRef(null);
  const [state, setState] = useState('idle'); // idle | starting | scanning | unsupported | denied | error
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const stream = useRef(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => stop, []);

  const open = async (text) => {
    const hit = parseScan(text);
    if (!hit) { setError('Eso no parece una etiqueta de Ledens Tools ni un código de herramienta.'); return; }
    setBusy(true); setError('');
    try {
      const id = hit.token ? (await tools.resolveLabel(hit.token)).id : hit.code;
      stop();
      onFound(id);
    } catch (e) {
      setError(e.status === 404 ? 'No se reconoce la etiqueta o el código (puede que la etiqueta se haya sustituido). Prueba a buscar la herramienta por su nombre.' : e.message);
      setBusy(false);
    }
  };

  const start = async () => {
    setError('');
    if (!supported) { setState('unsupported'); return; }
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.current.srcObject = stream.current;
      await video.current.play();
      setState('scanning');
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!stream.current) return;
        try {
          const codes = await detector.detect(video.current);
          if (codes[0]?.rawValue) { navigator.vibrate?.(60); await open(codes[0].rawValue); if (!stream.current) return; }
        } catch { /* frame not ready */ }
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      stop();
      setState(e?.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  };

  return (
    <div className="tl">
      <div className="tl-head"><div><h2>Escanear QR</h2><p>Apunta a la etiqueta de la herramienta.</p></div></div>
      <div className="fin-card fin-stack" style={{ alignItems: 'center' }}>
        <div className="tl-scan" hidden={state !== 'scanning' && state !== 'starting'}><video ref={video} muted playsInline aria-label="Vista de la cámara"></video></div>
        {state === 'idle' ? <button type="button" className="fin-btn is-primary" style={{ minHeight: '56px', fontSize: '16px' }} onClick={start}><i className="ri-camera-line" aria-hidden="true"></i>Abrir la cámara</button> : null}
        {state === 'scanning' ? <button type="button" className="fin-btn" onClick={() => { stop(); setState('idle'); }}>Cerrar la cámara</button> : null}
        {state === 'unsupported' ? <p className="tl-banner is-info" style={{ margin: 0 }}><i className="ri-information-line" aria-hidden="true"></i><span>Este navegador no lee QR dentro de la página. Abre la app <strong>Cámara</strong> del teléfono, apunta a la etiqueta y toca el enlace: te llevará a la ficha. O escribe el código aquí abajo.</span></p> : null}
        {state === 'denied' ? <p className="tl-banner" style={{ margin: 0 }}><i className="ri-camera-off-line" aria-hidden="true"></i><span>No hay permiso para usar la cámara. Puedes darlo en los ajustes del navegador, usar la app Cámara del teléfono o escribir el código.</span></p> : null}
        {state === 'error' ? <p className="tl-banner" style={{ margin: 0 }}><i className="ri-camera-off-line" aria-hidden="true"></i><span>No se ha podido abrir la cámara. Escribe el código de la etiqueta.</span></p> : null}
      </div>
      <form className="fin-card fin-form" onSubmit={(e) => { e.preventDefault(); open(manual); }}>
        <label className="fin-field"><span>O escribe el código de la etiqueta</span>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="LED-TOOL-000042" autoCapitalize="characters" autoComplete="off" inputMode="text" enterKeyHint="go" /></label>
        <button type="submit" className="fin-btn is-primary" disabled={!manual.trim() || busy}>{busy ? 'Buscando…' : 'Abrir ficha'}</button>
        {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
      </form>
    </div>
  );
}

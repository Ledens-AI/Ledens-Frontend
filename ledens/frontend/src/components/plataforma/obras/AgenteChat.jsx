import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox } from '../finanzas/ui.jsx';
import Editor from './Editor.jsx';

// Admin-only: a chat with the presupuestos agent, which can search projects
// and read their already-uploaded visita files itself (agenteChat.js) before
// proposing a draft. Nothing runs on its own — only while this is open and
// someone is writing. messages: full Claude-format history, kept here and
// sent back whole each turn (no server-side session).
const text = (m) => (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

export default function AgenteChat({ onCancel, onDone, toast }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);

  const send = async () => {
    const value = input.trim();
    if (!value || busy) return;
    const next = [...messages, { role: 'user', content: [{ type: 'text', text: value }] }];
    setMessages(next); setInput(''); setBusy(true); setError('');
    try {
      const r = await api.chatAgente(next);
      setMessages(r.messages);
      if (r.done) setDraft(r.draft);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (draft) {
    return <Editor mode="new" initial={draft} onCancel={onCancel} onSaved={async (d, { send: enviar }) => {
      let msg = 'Borrador guardado';
      if (enviar) { try { await api.send(d.id); msg = 'Presupuesto enviado: queda pendiente de que el cliente lo apruebe'; } catch (e) { msg = `Guardado como borrador; no se ha podido enviar (${e.message})`; } }
      toast?.(msg);
      onDone(d.id);
    }} />;
  }

  return (
    <div className="fin-stack">
      <div className="fin-page-head">
        <h1>Agente de presupuestos (chat)</h1>
        <p>Pídele que busque un proyecto y genere su presupuesto — puede buscar entre los proyectos existentes y leer las fotos y documentos ya subidos a su obra. Solo responde cuando le escribes; no hace nada por su cuenta.</p>
      </div>
      {error ? <ErrorBox message={error} /> : null}
      <div className="fin-card obr-chat">
        <div className="obr-chat-log">
          {!messages.length ? <p className="fin-muted">Por ejemplo: «Genera el presupuesto de la obra de los Ruiz, en Málaga».</p> : null}
          {messages.map((m, i) => {
            const t = text(m);
            if (!t) return null;
            return <div key={i} className={`obr-chat-msg ${m.role === 'user' ? 'is-user' : 'is-agent'}`}>{t}</div>;
          })}
          {busy ? <div className="obr-chat-msg is-agent fin-muted">Pensando…</div> : null}
        </div>
        <div className="obr-actions obr-start">
          <input className="obr-chat-input" value={input} disabled={busy} placeholder="Escribe un mensaje…"
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button type="button" className="fin-btn is-primary" onClick={send} disabled={busy || !input.trim()}><i className="ri-send-plane-line"></i>Enviar</button>
        </div>
      </div>
      <div className="obr-actions obr-start"><button type="button" className="fin-btn" onClick={onCancel}>Cerrar</button></div>
    </div>
  );
}

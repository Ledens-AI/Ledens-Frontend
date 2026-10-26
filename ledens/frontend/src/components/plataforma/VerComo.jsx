import React from 'react';
import { ROLE_LABEL } from './adminData.js';

/* «Ver como» (admins only): open the jefe de obra or client panel, either as
 * a plain panel or as one specific user sees it. Viewing as a user is
 * read-only and recorded in the audit log (backend: src/auth/viewAs.js and
 * POST /api/admin/view-as). Plataforma only renders this for real admins. */
const PANELS = [['admin', 'Administración'], ['worker', 'Jefe de obra'], ['client', 'Cliente']];
const ROLE_OF_PANEL = { worker: 'jefe', client: 'client' };
const label = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B6B68' };
const select = { width: '100%', border: '1px solid #DCDCD8', borderRadius: '8px', padding: '7px 8px', fontSize: '13px', background: '#fff', color: '#0C062B' };

export function VerComoSelector({ panel, viewAs, users, busy, onSwitch }) {
  const candidates = (users || []).filter((u) => u.role === ROLE_OF_PANEL[panel]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 8px', borderTop: '1px solid #EDEDEA' }}>
      <label style={label} htmlFor="ver-como-panel">Ver panel</label>
      <select id="ver-como-panel" style={select} value={panel} disabled={busy} onChange={(e) => onSwitch(e.target.value, null)}>
        {PANELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {panel !== 'admin' ? (
        <>
          <label style={label} htmlFor="ver-como-user">Como usuario</label>
          <select id="ver-como-user" style={select} value={viewAs?.id || ''} disabled={busy}
            onChange={(e) => onSwitch(panel, candidates.find((u) => u.id === e.target.value) || null)}>
            <option value="">Vista general</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </>
      ) : null}
    </div>
  );
}

export function VerComoBanner({ panel, viewAs, onExit }) {
  if (panel === 'admin') return null;
  const name = viewAs ? (viewAs.name || viewAs.email) : null;
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: '#FBF1DE', color: '#7A4E0E', border: '1px solid #F1DDB4', borderRadius: '10px', padding: '10px 14px', fontSize: '14px' }}>
      <i className="ri-eye-line" style={{ fontSize: '18px' }}></i>
      <span style={{ flex: 1, minWidth: '200px' }}>
        {name
          ? <>Estás viendo el panel de <strong>{ROLE_LABEL[viewAs.role]}</strong> como <strong>{name}</strong>. Solo lectura: no se puede guardar nada en su nombre.</>
          : <>Estás viendo el panel de <strong>{panel === 'worker' ? 'Jefe de obra' : 'Cliente'}</strong> con tu usuario de administrador.</>}
      </span>
      <button type="button" onClick={onExit} style={{ border: '1px solid #7A4E0E', background: '#fff', color: '#7A4E0E', borderRadius: '8px', padding: '6px 12px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
        Volver a Administración
      </button>
    </div>
  );
}

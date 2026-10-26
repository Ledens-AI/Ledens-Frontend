import { audit } from '../db/audit.js';
import { PresupuestosService, PresupuestoError, parseContent } from './service.js';

// Loads a presupuesto that was already approved outside the platform (e.g. a
// spreadsheet) as an obra: version 1 approved, start date set and, per line,
// the progress achieved so far as its first production declaration. The data
// file stays outside the repository (it carries client data); see
// src/scripts/presupuestos.js for the command and the file format.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR = { label: 'Sistema (importación)' };

export async function importApproved(pool, data) {
  if (!data || typeof data !== 'object') fail(400, 'Fichero de importación no válido');
  const vat = Number(data.vatRate ?? 21);
  if (!(vat >= 0 && vat < 100)) fail(400, 'Tipo de IVA no válido');
  for (const k of ['offeredOn', 'startDate']) if (!DATE.test(data[k] || '')) fail(400, `${k}: usa AAAA-MM-DD`);
  if (data.endDate && !DATE.test(data.endDate)) fail(400, 'endDate: usa AAAA-MM-DD');
  // Spreadsheet prices may include VAT; the platform keeps them net (6 decimals).
  const net = (p) => (data.pricesIncludeVat ? (Number(p) / (1 + vat / 100)).toFixed(6) : String(p));
  const progressOf = [];
  const content = parseContent({
    vatRate: String(vat), notes: data.notes,
    chapters: (data.chapters || []).map((c) => ({
      name: c.name,
      items: (c.items || []).map((i) => {
        const progress = Number(i.progress ?? 0);
        if (!(progress >= 0 && progress <= 10)) fail(400, `Avance no válido en «${i.name}»`);
        progressOf.push({ progress, note: i.progressNote ? String(i.progressNote).slice(0, 500) : null });
        return { ...i, quantity: String(i.quantity), unitPrice: net(i.unitPrice), kind: i.kind || 'confirmada' };
      }),
    })),
  });
  if (!progressOf.length) fail(400, 'El presupuesto no tiene partidas');

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const user = async (email, roles, label) => {
      const u = (await c.query('SELECT id, email, name, role FROM users WHERE lower(email)=lower($1)', [String(email || '')])).rows[0];
      if (!u) fail(400, `No existe la cuenta ${email} (${label})`);
      if (!roles.includes(u.role)) fail(400, `${email} no tiene un rol válido para ${label}`);
      return u;
    };
    const client = await user(data.clientEmail, ['client'], 'cliente');
    const jefe = data.jefeEmail ? await user(data.jefeEmail, ['jefe', 'admin'], 'jefe de obra') : null;
    if ((await c.query('SELECT 1 FROM presupuestos WHERE client_id=$1 AND lower(title)=lower($2)', [client.id, String(data.title || '').trim()])).rows.length) {
      fail(409, `${client.email} ya tiene un presupuesto «${data.title}»: no se importa dos veces`);
    }
    const p = (await c.query('INSERT INTO presupuestos (title, address, client_id, jefe_id, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, ref',
      [String(data.title || '').trim(), data.address || null, client.id, jefe?.id || null, data.startDate, data.endDate || null])).rows[0];
    const v = (await c.query("INSERT INTO presupuesto_versiones (presupuesto_id, number, status, sent_at, decided_at) VALUES ($1,1,'approved',$2,$2) RETURNING id",
      [p.id, data.offeredOn])).rows[0];
    await new PresupuestosService(pool, { role: 'admin' }).writeContent(c, v.id, content);
    const lines = (await c.query('SELECT id, quantity::text FROM presupuesto_partidas WHERE version_id=$1 ORDER BY (SELECT position FROM presupuesto_capitulos WHERE id=capitulo_id), position', [v.id])).rows;
    const note = `Avance importado${data.source ? ` de ${data.source}` : ''}`;
    let declared = 0;
    for (const [n, l] of lines.entries()) {
      const { progress, note: extra } = progressOf[n];
      if (!progress) continue;
      const executed = (Math.round(Number(l.quantity) * progress * 10000) / 10000).toFixed(4);
      await c.query('INSERT INTO presupuesto_produccion (partida_id, executed, note, declared_by) VALUES ($1,$2,$3,NULL)', [l.id, executed, extra ? `${note} · ${extra}` : note]);
      declared++;
    }
    await audit({ actor: ACTOR, action: 'Presupuesto importado', target: { id: client.id, label: p.ref },
      detail: `${p.ref} · ${data.title} · ${lines.length} partidas, ${declared} con avance${data.source ? ` · ${data.source}` : ''}` }, c);
    await c.query('COMMIT');
    return { id: p.id, ref: p.ref, lines: lines.length, declared };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

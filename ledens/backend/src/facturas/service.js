import { audit } from '../db/audit.js';
import { PresupuestoError, isUuid } from '../presupuestos/service.js';
import { EMISOR } from './emisor.js';
import { nifProblem, normalizeNif } from './nif.js';
import { facturaPdf } from './pdf.js';

// Facturas a clientes from a project's page in «Presupuestos y obras»
// (migration 049). Admins only: an invoice is a legal document with a
// correlative number, never changed or deleted once issued.
//
// The client's CIF/NIF is the project's own, from Gestión financiera →
// Proyectos (ledens.project_customer_tax_ids, migration 050), and nothing else:
// the dialog shows it read-only and, when the project has none (or a wrong
// one), sends the admin to the project's form to enter it; issue() refuses an
// invoice without it, whatever the request carries.
//
// The other client data (name, address, phone, email) comes, field by field,
// from the first source that has it: what the last invoice of the project used
// (proyecto_facturacion), the client's record in the accounting
// (ledens.customers, optional columns), an issued invoice already in the
// accounting for this project (ledens.documents tipo 'Cobrar'), the project
// itself and the client user of its obras. Whatever is missing, the admin fills
// in before issuing; it is kept for the next invoice.
//
// Numbers: «<trimestre>T<año>-<n>», like 4T2026-347: n is one more than the
// highest n of that year, among these invoices and those of the accounting
// (ledens.documents). The admin may type another one (the first time, to
// continue the series of invoices made outside Ledens); it must be unique.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => (Math.round(c) / 100).toFixed(2);
const NUMBER_FORM = /^([1-4])T(\d{4})-(\d+)$/i;
const MAX_TOTAL = 10_000_000_00;

const FIELDS = {
  nombre: { label: 'el nombre del cliente', max: 200, required: true },
  nif: { label: 'el CIF/NIF', max: 20, required: true },
  direccion: { label: 'la dirección del cliente', max: 300, required: true },
  telefono: { label: 'el teléfono', max: 40 },
  email: { label: 'el email', max: 200 },
};
// Optional columns of ledens.customers that may hold each field (the accounting
// import decides which exist; read through to_jsonb).
const CUSTOMER_COLUMNS = {
  nif: ['nif', 'cif', 'nif_cif', 'cif_nif', 'tax_id', 'vat_number', 'dni', 'documento'],
  direccion: ['billing_address', 'direccion_fiscal', 'direccion', 'address', 'domicilio'],
  telefono: ['telefono', 'phone', 'movil', 'mobile'],
  email: ['email', 'correo'],
};

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v).trim());

function text(v, field, { max, required } = {}) {
  if (v !== undefined && v !== null && typeof v !== 'string') fail(400, `Indica ${field}`);
  const t = clean(v);
  if (required && !t) fail(400, `Indica ${field}`);
  if (t.length > max) fail(400, `Revisa ${field}: máximo ${max} caracteres`);
  return t || null;
}
function amount(v, field, { max }) {
  const t = String(v ?? '').trim().replace(/\s|€/g, '');
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) fail(400, `${field} no válido`);
  const c = cents(norm);
  if (c <= 0) fail(400, `${field}: tiene que ser mayor que cero`);
  if (c > max) fail(400, `${field} demasiado alto`);
  return c;
}

export class FacturasService {
  constructor(pool, user, { now = () => new Date() } = {}) { this.pool = pool; this.user = user; this.now = now; }

  access() { if (this.user.role !== 'admin') fail(403, 'Solo un administrador emite facturas'); }
  actor() { return { id: this.user.id, name: this.user.name || this.user.email }; }

  async tx(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // Today in Madrid, YYYY-MM-DD: the invoice date.
  today() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(this.now()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  async exists(db, ...tables) {
    const r = (await db.query('SELECT bool_and(to_regclass(t) IS NOT NULL) ok FROM unnest($1::text[]) t', [tables])).rows[0];
    return !!r?.ok;
  }

  async project(db, projectId) {
    if (!isUuid(projectId)) fail(404, 'Proyecto no encontrado');
    const p = (await db.query(`
      SELECT p.id, p.project_id code, p.name, p.address, to_jsonb(p)->>'municipio' municipio, to_jsonb(p)->>'provincia' provincia,
             to_jsonb(p)->>'customer_name_source' customer_name, to_jsonb(c) customer, t.tax_id cif
        FROM ledens.projects p LEFT JOIN ledens.customers c ON c.id::text=to_jsonb(p)->>'customer_id'
        LEFT JOIN ledens.project_customer_tax_ids t ON t.project_id=p.id
       WHERE p.id=$1`, [projectId])).rows[0];
    if (!p) fail(404, 'Proyecto no encontrado');
    return p;
  }

  // The next number of the series for `fecha`'s year: «4T2026-348».
  async nextNumber(db, fecha) {
    const year = fecha.slice(0, 4), quarter = Math.floor((Number(fecha.slice(5, 7)) - 1) / 3) + 1;
    const re = `^[1-4]T${year}-([0-9]{1,9})$`;
    const sources = ['SELECT upper(btrim(numero)) n FROM facturas'];
    // Supplier invoices (Pagar) carry the supplier's own numbering.
    if (await this.exists(db, 'ledens.documents')) sources.push("SELECT upper(btrim(numerodocumento)) FROM ledens.documents WHERE tipo IS DISTINCT FROM 'Pagar'");
    const max = (await db.query(`SELECT coalesce(max(substring(n from $1)::bigint), 0) m FROM (${sources.join(' UNION ALL ')}) x WHERE n ~ $1`, [re])).rows[0].m;
    return `${quarter}T${year}-${Number(max) + 1}`;
  }

  async taken(db, numero) {
    const n = numero.toUpperCase();
    if ((await db.query('SELECT 1 FROM facturas WHERE upper(btrim(numero))=$1', [n])).rows.length) return true;
    if (!(await this.exists(db, 'ledens.documents'))) return false;
    // Supplier invoices (Pagar) have the supplier's own numbering.
    return (await db.query("SELECT 1 FROM ledens.documents WHERE upper(btrim(numerodocumento))=$1 AND tipo IS DISTINCT FROM 'Pagar' LIMIT 1", [n])).rows.length > 0;
  }

  // An invoice of this project already in the accounting with the client's
  // CIF/NIF (sales invoices made before Ledens issued them).
  async accountingInvoice(projectId) {
    if (!(await this.exists(this.pool, 'ledens.documents', 'ledens.financial_records', 'ledens.project_financial_allocations'))) return null;
    try {
      return (await this.pool.query(`
        SELECT d.numerodocumento numero, d.tercero, btrim(d.niftercero) nif
          FROM ledens.project_financial_allocations pa JOIN ledens.financial_records f ON f.id=pa.record_id
          JOIN ledens.documents d ON d.id=f.document_id
         WHERE pa.project_id=$1 AND d.tipo='Cobrar' AND nullif(btrim(d.niftercero),'') IS NOT NULL
         ORDER BY d.document_on DESC NULLS LAST, d.id LIMIT 1`, [projectId])).rows[0] || null;
    } catch {
      return null; // an accounting schema without these columns: nothing to suggest
    }
  }

  // The client of the obras of this project in the platform, when there is one.
  async clientUser(projectId) {
    const rows = (await this.pool.query(`SELECT DISTINCT u.id, u.name, u.email FROM presupuestos p JOIN users u ON u.id=p.client_id
      WHERE p.project_id=$1 AND p.parent_id IS NULL`, [projectId])).rows;
    return rows.length === 1 ? rows[0] : null;
  }

  // The VAT rate of the project's approved presupuestos when they all share it, else 21 %.
  async vatRate(projectId) {
    const rates = (await this.pool.query(`SELECT DISTINCT v.vat_rate::text r FROM presupuestos p LEFT JOIN presupuestos par ON par.id=p.parent_id
      JOIN presupuesto_versiones v ON v.presupuesto_id=p.id AND v.status='approved' WHERE coalesce(par.project_id, p.project_id)=$1`, [projectId])).rows;
    return rates.length === 1 ? String(Number(rates[0].r)) : '21';
  }

  // Where the obra is: the project's address (with its municipio), else that of
  // its approved obra.
  async workAddress(p) {
    const addr = clean(p.address), town = clean(p.municipio);
    if (addr) return town && !addr.toLowerCase().includes(town.toLowerCase()) ? `${addr}, ${town}` : addr;
    const obra = (await this.pool.query(`SELECT p.address FROM presupuestos p WHERE p.project_id=$1 AND p.parent_id IS NULL AND nullif(btrim(p.address),'') IS NOT NULL
      ORDER BY p.start_date DESC NULLS LAST, p.created_at DESC LIMIT 1`, [p.id])).rows[0];
    return clean(obra?.address) || (town || null);
  }

  async invoices(projectId, db = this.pool) {
    return (await db.query(`SELECT id, numero, fecha::text fecha, concepto, cliente_nombre, base::text base, iva_pct::text iva_pct, iva::text iva, total::text total,
      porcentaje::text porcentaje, created_at FROM facturas WHERE project_id=$1 ORDER BY fecha DESC, created_at DESC`, [projectId])).rows
      .map((f) => ({ id: f.id, numero: f.numero, fecha: f.fecha, concepto: f.concepto, cliente: f.cliente_nombre, base: f.base,
        ivaPct: String(Number(f.iva_pct)), iva: f.iva, total: f.total, porcentaje: f.porcentaje === null ? null : String(Number(f.porcentaje)), createdAt: f.created_at }));
  }

  // What the «Generar factura» dialog starts from.
  async prepare(projectId) {
    this.access();
    const p = await this.project(this.pool, projectId);
    const [saved, doc, user, ivaPct, work, facturas] = await Promise.all([
      this.pool.query('SELECT nombre, nif, direccion, telefono, email FROM proyecto_facturacion WHERE project_id=$1', [p.id]).then((r) => r.rows[0] || null),
      this.accountingInvoice(p.id), this.clientUser(p.id), this.vatRate(p.id), this.workAddress(p), this.invoices(p.id),
    ]);
    const customer = p.customer || {};
    const fromCustomer = (field) => CUSTOMER_COLUMNS[field].map((k) => clean(customer[k])).find(Boolean) || null;
    const candidates = {
      nombre: [[saved?.nombre, 'guardado'], [customer.display_name, 'proyecto'], [p.customer_name, 'proyecto'], [doc?.tercero, 'contabilidad'], [user?.name, 'plataforma']],
      nif: [[p.cif, 'cifProyecto']],
      direccion: [[saved?.direccion, 'guardado'], [fromCustomer('direccion'), 'ficha'], [work, 'obra']],
      telefono: [[saved?.telefono, 'guardado'], [fromCustomer('telefono'), 'ficha']],
      email: [[saved?.email, 'guardado'], [fromCustomer('email'), 'ficha'], [user?.email, 'plataforma']],
    };
    const ORIGIN = {
      cifProyecto: 'CIF del cliente del proyecto (Gestión financiera → Proyectos)',
      guardado: 'Usado en la última factura de este proyecto',
      proyecto: 'Cliente del proyecto',
      ficha: 'Ficha del cliente en la contabilidad',
      contabilidad: doc?.numero ? `Factura ${doc.numero} de la contabilidad` : 'Una factura de la contabilidad',
      obra: 'Dirección de la obra: compruébala',
      plataforma: 'Cliente de la obra en la plataforma',
    };
    const cliente = {}, origen = {};
    for (const [field, list] of Object.entries(candidates)) {
      const hit = list.find(([v]) => clean(v));
      cliente[field] = hit ? clean(hit[0]) : '';
      if (hit) origen[field] = ORIGIN[hit[1]];
    }
    const faltan = Object.keys(FIELDS).filter((f) => FIELDS[f].required && !cliente[f]);
    // A CIF/NIF that is there but would be refused also has to be entered again (in the project).
    const cifProblema = cliente.nif ? nifProblem(cliente.nif) : null;
    if (cifProblema && !faltan.includes('nif')) faltan.push('nif');
    // Without one, what other sources say, only as a hint for the project's form.
    const sugerido = cliente.nif && !cifProblema ? null
      : [[saved?.nif, 'guardado'], [fromCustomer('nif'), 'ficha'], [doc?.nif, 'contabilidad']]
        .map(([v, o]) => [normalizeNif(v), o]).find(([v]) => v && v !== normalizeNif(cliente.nif) && !nifProblem(v));
    const fecha = this.today();
    return {
      project: { id: p.id, code: p.code, name: p.name },
      cliente, origen, faltan,
      // The project's CIF/NIF: entered only in Proyectos (null problema = fine).
      cif: { falta: !cliente.nif, problema: cifProblema, sugerido: sugerido ? { nif: sugerido[0], origen: ORIGIN[sugerido[1]] } : null },
      fecha, numero: await this.nextNumber(this.pool, fecha), ivaPct,
      concepto: work ? `Reforma en ${work}` : `Reforma: ${clean(p.name) || 'obra'}`,
      emisor: EMISOR,
      facturas,
      facturado: money(facturas.reduce((a, f) => a + cents(f.total), 0)),
    };
  }

  // Issues the invoice: amounts from the total with VAT (base = total / (1 + IVA)),
  // the client's data kept for the next one, audited. Returns the invoice.
  async issue(projectId, body = {}) {
    this.access();
    const c = body.cliente || {};
    const cliente = {};
    // The CIF/NIF is the project's (below), never the one in the request.
    for (const [f, rule] of Object.entries(FIELDS)) if (f !== 'nif') cliente[f] = text(c[f], rule.label, rule);
    if (cliente.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) fail(400, 'El email del cliente no es válido');
    const concepto = text(body.concepto, 'el concepto', { max: 500, required: true });
    const total = amount(body.total, 'Importe', { max: MAX_TOTAL });
    const rate = String(body.ivaPct ?? '').trim().replace(',', '.');
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(rate)) fail(400, 'IVA no válido');
    const base = Math.round(total / (1 + Number(rate) / 100)), iva = total - base;
    if (base <= 0) fail(400, 'Importe demasiado bajo');
    let porcentaje = null;
    if (body.porcentaje !== undefined && body.porcentaje !== null && body.porcentaje !== '') {
      porcentaje = Number(body.porcentaje);
      if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) fail(400, 'Porcentaje no válido');
    }
    const typed = text(body.numero, 'el número de factura', { max: 30 });
    if (typed && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(typed)) fail(400, 'El número de factura solo puede tener letras, números, espacios y . _ / -');

    const id = await this.tx(async (db) => {
      const p = await this.project(db, projectId);
      if (!p.cif) fail(400, 'Falta el CIF del cliente: añádelo en el proyecto (Gestión financiera → Proyectos) antes de facturar');
      const nifError = nifProblem(p.cif);
      if (nifError) fail(400, `El CIF del cliente del proyecto no es válido (${nifError}): corrígelo en Gestión financiera → Proyectos`);
      cliente.nif = normalizeNif(p.cif);
      // One invoice at a time: two never take the same number.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7))', ['facturas-numero']);
      const fecha = this.today();
      const numero = typed || await this.nextNumber(db, fecha);
      if (await this.taken(db, numero)) fail(409, `Ya existe una factura con el número ${numero}`);
      const row = (await db.query(`INSERT INTO facturas (numero, fecha, project_id, project_code, project_name, emisor, cliente_nombre, cliente_nif, cliente_direccion,
          cliente_telefono, cliente_email, concepto, base, iva_pct, iva, total, porcentaje, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [numero, fecha, p.id, p.code, p.name, JSON.stringify(EMISOR), cliente.nombre, cliente.nif, cliente.direccion, cliente.telefono, cliente.email,
        concepto, money(base), rate, money(iva), money(total), porcentaje, this.user.id || null])).rows[0];
      await db.query(`INSERT INTO proyecto_facturacion (project_id, nombre, nif, direccion, telefono, email, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (project_id) DO UPDATE SET nombre=EXCLUDED.nombre, nif=EXCLUDED.nif, direccion=EXCLUDED.direccion, telefono=EXCLUDED.telefono,
          email=EXCLUDED.email, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [p.id, cliente.nombre, cliente.nif, cliente.direccion, cliente.telefono, cliente.email, this.user.id || null]);
      await audit({ actor: this.actor(), action: 'Factura emitida', target: { label: `Factura ${numero}` },
        detail: `${numero} · ${[p.code, p.name].filter(Boolean).join(' · ')} · ${cliente.nombre} (${cliente.nif}) · ${money(total)} € con IVA (${Number(rate)} %)` }, db);
      return row.id;
    });
    return (await this.invoices(projectId)).find((f) => f.id === id);
  }

  // The PDF of one invoice of the project, with its download name.
  async pdf(projectId, facturaId) {
    this.access();
    if (!isUuid(projectId) || !isUuid(facturaId)) fail(404, 'Factura no encontrada');
    const f = (await this.pool.query('SELECT *, fecha::text fecha FROM facturas WHERE id=$1 AND project_id=$2', [facturaId, projectId])).rows[0];
    if (!f) fail(404, 'Factura no encontrada');
    const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
    return { filename: `Factura_${plain(f.numero)}_${plain(f.cliente_nombre)}.pdf`, bytes: await facturaPdf(f) };
  }
}

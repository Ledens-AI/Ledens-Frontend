import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { FacturasService } from '../src/facturas/service.js';
import { nifProblem } from '../src/facturas/nif.js';
import { euros, facturaPdf } from '../src/facturas/pdf.js';
import { EMISOR } from '../src/facturas/emisor.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
import { ProjectsService } from '../src/finanzas/projects.js';
// Facturas a clientes of a project (migration 049) on PGlite: users/audit_log,
// the presupuestos migrations and the ledens.* tables the invoices read
// (projects, customers with an optional NIF column, documents and the
// allocations that tie an accounting invoice to its project). The client's
// CIF/NIF is the project's, entered in Gestión financiera → Proyectos (050).
let db, pool, admin, jefe, cliente, velez, marbella, vacio;
const NOW = () => new Date('2026-11-25T10:00:00Z');
const as = (u, now = NOW) => new FacturasService(pool, u, { now });
const migration = (m) => fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8');
const datos = (extra = {}) => ({ nombre: 'Comunidad de propietarios Monte Azul', nif: 'H29123452', direccion: 'C/ Concepción 12, 29700 Vélez-Málaga', telefono: '', email: '', ...extra });

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.project_statuses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
    CREATE TABLE ledens.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL, nif text);
    CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
      project_id text, name text, customer_name_source text, salesman text, address text, start_date date, municipio text,
      provincia text, customer_id uuid REFERENCES ledens.customers (id), status_id uuid REFERENCES ledens.project_statuses (id), end_date date);
    CREATE TABLE ledens.documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), numerodocumento text, document_on date, tipo text,
      tercero text, niftercero text, total numeric);
    CREATE TABLE ledens.financial_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid REFERENCES ledens.documents(id));
    CREATE TABLE ledens.project_financial_allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES ledens.financial_records(id),
      project_id uuid NOT NULL REFERENCES ledens.projects(id), allocated_amount numeric NOT NULL);
    CREATE TABLE ledens.finance_project_permissions (user_id uuid NOT NULL, project_id uuid NOT NULL, PRIMARY KEY (user_id, project_id));`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql',
    '033_presupuestos_proyecto.sql', '048_partidas_eliminadas.sql', '049_facturas.sql', '050_cif_cliente_proyecto.sql']) await db.exec(await migration(m));
  [admin, jefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@fa.test','Admin','admin'),('jefe@fa.test','Jefe','jefe'),('ana@fa.test','Ana María Pérez Rosa','client') RETURNING id,email,name,role`)).rows;
  const [monteAzul, ana] = (await db.query(`INSERT INTO ledens.customers(display_name, nif) VALUES ('Comunidad de propietarios Monte Azul', NULL), ('Ana María Pérez Rosa', NULL) RETURNING id`)).rows.map((r) => r.id);
  [velez, marbella, vacio] = (await db.query(`INSERT INTO ledens.projects(project_id,name,address,municipio,customer_id,customer_name_source) VALUES
    ('P2026-026','Comunidad Concepción Velez','C/ Concepción 12','Vélez-Málaga',$1,NULL),
    ('P2026-014','Casa Antequera','Urbanización parque sol bloque 4 primero A, Antequera 29200','Antequera',$2,NULL),
    ('P2026-030','Sin datos',NULL,NULL,NULL,NULL) RETURNING id`, [monteAzul, ana])).rows.map((r) => r.id);
  // An invoice of Casa Antequera made before Ledens, in the accounting: it carries the client's NIF.
  const doc = (await db.query(`INSERT INTO ledens.documents(numerodocumento,document_on,tipo,tercero,niftercero,total) VALUES
    ('4T2026-347','2026-11-18','Cobrar','Ana María Pérez Rosa','25333033M',1200),
    ('4T2026-900','2026-11-18','Pagar','Proveedor','B19753805',-50),
    ('3T2025-999','2025-09-01','Cobrar','Otro','25333033M',10) RETURNING id`)).rows[0].id;
  const rec = (await db.query('INSERT INTO ledens.financial_records(document_id) VALUES ($1) RETURNING id', [doc])).rows[0].id;
  await db.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES ($1,$2,1200)', [rec, marbella]);
});
after(() => db?.close());
// The CIF entered in the project's form, as Gestión financiera → Proyectos saves it.
const setCif = async (projectId, cif) => {
  const p = await new ProjectsService(pool, admin).one(projectId);
  return new ProjectsService(pool, admin).update(projectId, { name: p.name, customerId: p.customer_id, customerName: p.customer_name_source, cif,
    salesman: p.salesman, address: p.address, municipio: p.municipio, provincia: p.provincia, statusId: p.status_id, startDate: p.start_date, endDate: p.end_date, version: p.version });
};

test('the CIF/NIF is checked with its control character; amounts print in Spanish', () => {
  for (const ok of ['25333033M', '25333033-m', 'B19753805', 'X1234567L', 'H29123452', 'ESB19753805', 'FR40303265045']) assert.equal(nifProblem(ok), null, ok);
  assert.match(nifProblem('25333033A'), /letra/);
  assert.match(nifProblem('B19753806'), /control/);
  assert.match(nifProblem(''), /Indica/);
  assert.equal(euros('1200'), '1.200,00 €');
  assert.equal(euros('991.735'), '991,74 €');
  assert.equal(euros('1234567.8'), '1.234.567,80 €');
});

test('only an admin prepares, issues or downloads invoices', async () => {
  for (const u of [jefe, cliente]) {
    await assert.rejects(as(u).prepare(velez), { status: 403 });
    await assert.rejects(as(u).issue(velez, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21' }), { status: 403 });
  }
  await assert.rejects(as(admin).prepare('00000000-0000-0000-0000-0000000000ff'), { status: 404 });
  await assert.rejects(as(admin).prepare('nope'), { status: 404 });
});

test('the dialog starts from the project: name and address known, the CIF/NIF missing', async () => {
  const d = await as(admin).prepare(velez);
  assert.equal(d.cliente.nombre, 'Comunidad de propietarios Monte Azul');
  assert.equal(d.origen.nombre, 'Cliente del proyecto');
  assert.equal(d.cliente.direccion, 'C/ Concepción 12, Vélez-Málaga');
  assert.match(d.origen.direccion, /obra/);
  assert.equal(d.cliente.nif, '');
  assert.deepEqual(d.faltan, ['nif']);
  assert.deepEqual(d.cif, { falta: true, problema: null, sugerido: null });
  assert.equal(d.fecha, '2026-11-25');
  // The series continues from the accounting's own sales invoices (4T2026-347), never a supplier's (4T2026-900).
  assert.equal(d.numero, '4T2026-348');
  assert.equal(d.ivaPct, '21');
  assert.equal(d.concepto, 'Reforma en C/ Concepción 12, Vélez-Málaga');
  assert.deepEqual(d.facturas, []);
  assert.equal(d.facturado, '0.00');
  // A project with nothing: everything required is missing.
  assert.deepEqual((await as(admin).prepare(vacio)).faltan, ['nombre', 'nif', 'direccion']);
});

test('the CIF/NIF is only the project\'s: an accounting invoice only suggests what to enter in Proyectos', async () => {
  const d = await as(admin).prepare(marbella);
  assert.equal(d.cliente.nif, '', 'never taken from the accounting');
  assert.deepEqual(d.faltan, ['nif']);
  assert.deepEqual(d.cif, { falta: true, problema: null, sugerido: { nif: '25333033M', origen: 'Factura 4T2026-347 de la contabilidad' } });
  assert.equal(d.cliente.direccion, 'Urbanización parque sol bloque 4 primero A, Antequera 29200', 'the municipio is not repeated');
  // Entered in the project's form, the dialog takes it from there.
  await setCif(marbella, '25333033-m');
  const e = await as(admin).prepare(marbella);
  assert.equal(e.cliente.nif, '25333033M');
  assert.equal(e.origen.nif, 'CIF del cliente del proyecto (Gestión financiera → Proyectos)');
  assert.deepEqual(e.faltan, []);
  assert.deepEqual(e.cif, { falta: false, problema: null, sugerido: null });
});

test('a wrong CIF stored for the project is not used: the dialog asks to correct it in Proyectos and issuing is refused', async () => {
  // Written straight into the table (a value from before the check), not through the form.
  await db.query("INSERT INTO ledens.project_customer_tax_ids(project_id,tax_id) VALUES ($1,'H29123453')", [vacio]);
  const d = await as(admin).prepare(vacio);
  assert.ok(d.faltan.includes('nif'));
  assert.equal(d.cif.falta, false);
  assert.match(d.cif.problema, /control/);
  await assert.rejects(as(admin).issue(vacio, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21' }), { status: 400, message: /Proyectos/ });
  await db.query('DELETE FROM ledens.project_customer_tax_ids WHERE project_id=$1', [vacio]);
});

test('issuing: base and VAT from the total, client data kept, numbers correlative and unique, audited', async () => {
  const s = as(admin);
  // Without a CIF in the project, no invoice: not even with one in the request.
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: 'Reforma', total: '1200', ivaPct: '21' }), { status: 400, message: /Falta el CIF del cliente.*Proyectos/ });
  assert.equal((await db.query('SELECT count(*)::int n FROM facturas')).rows[0].n, 0);
  await setCif(velez, 'H29123452');
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: 'Reforma', total: '0', ivaPct: '21' }), { status: 400 });
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: 'Reforma', total: '12,345', ivaPct: '21' }), { status: 400 });
  await assert.rejects(s.issue(velez, { cliente: datos({ email: 'no-es-un-email' }), concepto: 'Reforma', total: '10', ivaPct: '21' }), { status: 400 });
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: '', total: '10', ivaPct: '21' }), { status: 400 });

  // Another CIF in the request is ignored: the invoice carries the project's.
  const f = await s.issue(velez, { cliente: datos({ nif: 'B19753805' }), concepto: 'Reforma en C/ Concepción 12', total: '1.200,00', ivaPct: '21', porcentaje: 50 });
  assert.equal(f.numero, '4T2026-348');
  assert.equal(f.fecha, '2026-11-25');
  assert.deepEqual([f.base, f.iva, f.total, f.ivaPct, f.porcentaje], ['991.74', '208.26', '1200.00', '21', '50']);
  const row = (await db.query('SELECT cliente_nif, emisor FROM facturas WHERE id=$1', [f.id])).rows[0];
  assert.equal(row.cliente_nif, 'H29123452', 'the project\'s CIF');
  assert.equal(row.emisor.cif, 'B19753805');

  // The next dialog offers what this invoice used, and the next number.
  const d = await s.prepare(velez);
  assert.equal(d.cliente.nif, 'H29123452');
  assert.equal(d.origen.nif, 'CIF del cliente del proyecto (Gestión financiera → Proyectos)');
  assert.deepEqual(d.faltan, []);
  assert.equal(d.numero, '4T2026-349');
  assert.equal(d.facturas.length, 1);
  assert.equal(d.facturado, '1200.00');

  // 10 % VAT on 758,50 €: base 689,55, IVA 68,95.
  const g = await s.issue(velez, { cliente: datos(), concepto: 'Segundo pago', total: '758.50', ivaPct: '10' });
  assert.deepEqual([g.numero, g.base, g.iva, g.total], ['4T2026-349', '689.55', '68.95', '758.50']);
  // A number typed by hand: unique among these and the accounting's own invoices.
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21', numero: '4t2026-348' }), { status: 409 });
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21', numero: '4T2026-347' }), { status: 409 });
  await assert.rejects(s.issue(velez, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21', numero: '4T2026<script>' }), { status: 400 });
  const h = await s.issue(velez, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21', numero: '4T2026-500' });
  assert.equal(h.numero, '4T2026-500');
  assert.equal((await s.prepare(velez)).numero, '4T2026-501', 'the series continues from the highest');
  // A supplier's number may coincide: it is the supplier's own series.
  assert.equal((await s.issue(velez, { cliente: datos(), concepto: 'x', total: '10', ivaPct: '21', numero: '4T2026-900' })).numero, '4T2026-900');

  const log = (await db.query("SELECT target_label, detail FROM audit_log WHERE action='Factura emitida' ORDER BY id")).rows;
  assert.equal(log.length, 4);
  assert.equal(log[0].target_label, 'Factura 4T2026-348');
  assert.match(log[0].detail, /P2026-026 · Comunidad Concepción Velez · Comunidad de propietarios Monte Azul \(H29123452\) · 1200\.00 € con IVA \(21 %\)/);
});

test('a new year starts its own series; the quarter follows the date', async () => {
  const d = await as(admin, () => new Date('2026-12-31T23:30:00Z')).prepare(velez);
  assert.equal(d.fecha, '2027-01-01', 'Madrid is already in 2027');
  assert.equal(d.numero, '1T2027-1');
  assert.equal((await as(admin, () => new Date('2026-05-10T10:00:00Z')).prepare(velez)).numero, '2T2026-901', 'our own 4T2026-900 counts');
});

test('the default VAT is that of the project\'s approved presupuestos', async () => {
  const obra = (await db.query(`INSERT INTO presupuestos(title,client_id,project_id) VALUES ('Casa Antequera',$1,$2) RETURNING id`, [cliente.id, marbella])).rows[0].id;
  await db.query(`INSERT INTO presupuesto_versiones(presupuesto_id,number,status,vat_rate) VALUES ($1,1,'approved',10)`, [obra]);
  const d = await as(admin).prepare(marbella);
  assert.equal(d.ivaPct, '10');
  assert.equal(d.cliente.email, 'ana@fa.test');
  assert.equal(d.origen.email, 'Cliente de la obra en la plataforma');
});

test('an issued invoice never changes; its PDF is the one of its own project', async () => {
  const f = (await as(admin).prepare(velez)).facturas.find((x) => x.numero === '4T2026-348');
  await assert.rejects(db.query("UPDATE facturas SET total=1 WHERE id=$1", [f.id]), /rectificativa/);
  await assert.rejects(db.query('DELETE FROM facturas WHERE id=$1', [f.id]), /rectificativa/);
  const { filename, bytes } = await as(admin).pdf(velez, f.id);
  assert.equal(filename, 'Factura_4T2026-348_Comunidad_de_propietarios_Monte_Azul.pdf');
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(as(admin).pdf(marbella, f.id), { status: 404 });
  await assert.rejects(as(jefe).pdf(velez, f.id), { status: 403 });
});

test('the longest client data and concept never push the payment details off the page', async () => {
  // Every text item of the PDF, with its page and height on it.
  const read = async (bytes) => {
    const pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
    const items = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      for (const it of (await (await pdf.getPage(n)).getTextContent()).items) if (it.str.trim()) items.push({ page: n, y: it.transform[5], str: it.str });
    }
    return { pages: pdf.numPages, items };
  };
  // Wide letters at the limits the service accepts (200 / 300 / 500 characters).
  const wide = (n) => Array.from({ length: n }, () => 'WMWMW').join(' ').slice(0, n);
  const base = { numero: '4T2026-348', fecha: '2026-11-25', emisor: EMISOR, cliente_nif: '25333033M', cliente_telefono: '670397233', cliente_email: '',
    base: '991.74', iva_pct: '21', iva: '208.26', total: '1200.00', created_at: new Date('2026-11-25T10:00:00Z') };
  const long = await read(await facturaPdf({ ...base, cliente_nombre: wide(200), cliente_direccion: wide(300), cliente_email: `${'W'.repeat(190)}@b.es`, concepto: wide(500) }));
  assert.equal(long.pages, 2, 'what does not fit goes to a second page');
  assert.ok(long.items.every((i) => i.y >= 20 && i.y <= 842), 'nothing is drawn outside a page');
  assert.ok(long.items.some((i) => /IBAN: ES43 1583 0001 1893 7510 2265/.test(i.str)), 'the payment details are printed');
  assert.ok(long.items.some((i) => /Ley 37\/1992/.test(i.str)), 'the legal note is printed');
  assert.ok(long.items.some((i) => i.page === 2 && /Página 2 de 2/.test(i.str)));
  // The usual invoice stays on one page, without page numbers.
  const usual = await read(await facturaPdf({ ...base, cliente_nombre: 'Ana María Pérez Rosa', cliente_direccion: 'Urbanización parque sol bloque 4 primero A, Antequera 29200',
    concepto: 'Reforma en Urbanización parque sol bloque 4 primero A, Antequera 29200' }));
  assert.equal(usual.pages, 1);
  assert.ok(!usual.items.some((i) => /Página/.test(i.str)));
});

test('routes: JSON to prepare and issue, the PDF as a download', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/presupuestos', createPresupuestosRouter({ authenticate: (req, _res, next) => { req.user = admin; next(); }, findUser: async () => null,
    pool, ocr: null, translator: null, anthropic: null, storage: {}, origin: 'http://ok.test' }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/presupuestos/proyectos/${velez}`;
  try {
    const prep = await (await fetch(`${base}/facturacion`)).json();
    assert.equal(prep.project.code, 'P2026-026');
    const post = await fetch(`${base}/facturas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://ok.test' },
      body: JSON.stringify({ cliente: datos(), concepto: 'Por ruta', total: '100', ivaPct: '21' }) });
    assert.equal(post.status, 200);
    const { factura } = await post.json();
    assert.equal(factura.total, '100.00');
    const foreign = await fetch(`${base}/facturas`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.test' }, body: '{}' });
    assert.equal(foreign.status, 403);
    const pdf = await fetch(`${base}/facturas/${factura.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), /^attachment; filename="Factura_4T2026-/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`${base}/facturas/00000000-0000-0000-0000-000000000000/pdf`)).status, 404);
  } finally {
    server.close();
  }
});

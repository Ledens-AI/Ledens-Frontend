import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { AlertService } from '../src/notifications/service.js';
import { delayMinutes } from '../src/presupuestos/avisoAvance.js';
// Aviso de avance al cliente (src/presupuestos/avisoAvance.js) on PGlite: what
// «Actualizar avance» queues, who gets it, how several updates fold into one
// email, and what the email says.
let db, pool, admin, jefe, cliente, invitado, pendiente, obraId, lines;
const as = (u) => new PresupuestosService(pool, u);
const alerts = async () => (await db.query("SELECT * FROM ledens.transaction_alerts WHERE event_type='obra_avance' ORDER BY created_at, id")).rows;
const due = () => db.query("UPDATE ledens.transaction_alerts SET next_attempt_at=now() WHERE delivered_at IS NULL");
const claim = async () => (await new AlertService(pool).claim()).messages;
const deliver = (ms) => Promise.all(ms.map((m) => new AlertService(pool).acknowledge(m.id, m.lease_token, true)));
const id = (code) => lines.find((l) => l.code === code).id;

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT true, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz DEFAULT now());
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.transaction_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, event_type text NOT NULL, status text NOT NULL,
      reason text, document_id uuid, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, lease_token uuid,
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '032_traducciones_presupuesto.sql', '033_presupuestos_proyecto.sql']) {
    await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  }
  [admin, jefe, cliente, invitado, pendiente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@av.test','Admin','admin'),('jefe@av.test','Ana Jefa','jefe'),('cliente@av.test','Clara Cliente','client'),
    ('invitado@av.test','Ivo Invitado','client'),('pendiente@av.test','pendiente@av.test','client') RETURNING id,email,name,role`)).rows;
  await db.query('UPDATE users SET registered_at=NULL WHERE id=$1', [pendiente.id]);
  const d = await as(admin).create({ title: 'Reforma de baño', vatRate: '21', clientId: cliente.id, jefeId: jefe.id, chapters: [
    { name: 'Fontanería', items: [
      { code: 'PA-026', name: 'Tubería de agua fría', unit: 'ml', quantity: '50', unitPrice: '10' },
      { code: 'PA-158', name: 'Tubería de agua caliente', unit: 'ml', quantity: '50', unitPrice: '10' }] }] });
  obraId = d.id;
  await as(admin).send(obraId);
  await as(cliente).approve(obraId, { versionId: (await as(cliente).get(obraId)).version.id });
  await as(jefe).schedule(obraId, { startDate: '2026-11-02' });
  lines = (await as(jefe).get(obraId)).obra.chapters.flatMap((c) => c.items);
  // Ivo follows the obra (invited, in English); the pending one never got in.
  const inv = (await db.query(`INSERT INTO invitaciones (presupuesto_id,user_id,email,lang,expires_at,accepted_at,access_granted) VALUES ($1,$2,$3,'en',now()+interval '7 days',now(),true) RETURNING id`, [obraId, invitado.id, invitado.email])).rows[0];
  await db.query('INSERT INTO obra_clientes (presupuesto_id,user_id,invitacion_id) VALUES ($1,$2,$3),($1,$4,NULL)', [obraId, invitado.id, inv.id, pendiente.id]);
});
after(() => db?.close());

test('the wait before sending: 30 minutes unless AVISO_AVANCE_MINUTOS says otherwise', () => {
  assert.equal(delayMinutes({}), 30);
  assert.equal(delayMinutes({ AVISO_AVANCE_MINUTOS: '0' }), 0);
  assert.equal(delayMinutes({ AVISO_AVANCE_MINUTOS: '5' }), 5);
  assert.equal(delayMinutes({ AVISO_AVANCE_MINUTOS: 'pronto' }), 30);
  assert.equal(delayMinutes({ AVISO_AVANCE_MINUTOS: '99999' }), 30);
});

test('an update queues one email per client who follows the obra, not before the wait', async () => {
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '10' }] });
  const a = await alerts();
  assert.deepEqual(a.map((x) => x.payload.user_id).sort(), [cliente.id, invitado.id].sort(), 'titular and invited; not the one pending of registration');
  assert.equal(a.find((x) => x.payload.user_id === invitado.id).payload.lang, 'en');
  assert.ok(a.every((x) => new Date(x.next_attempt_at) - Date.now() > 25 * 60 * 1000), 'waits for the working session to end');
  assert.equal((await claim()).length, 0, 'nothing is due yet');
});

test('later updates fold into the waiting email, which tells before → now with notes', async () => {
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '25' }, { partidaId: id('PA-158'), executed: '0', note: 'Esperando material' }] });
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '25' }] }); // unchanged: nothing recorded
  assert.equal((await alerts()).length, 2, 'still one per client');
  await db.query("INSERT INTO presupuesto_traducciones (lang, source_hash, translated) VALUES ('en', encode(sha256(convert_to('Tubería de agua fría','UTF8')),'hex'), 'Cold water pipe')");
  await due();
  const ms = await claim();
  assert.equal(ms.length, 2);
  const es = ms.find((m) => m.to === cliente.email), en = ms.find((m) => m.to === invitado.email);
  assert.equal(es.subject, 'Ledens · Avance de tu obra «Reforma de baño»');
  assert.match(es.html, /Hola Clara Cliente:/);
  assert.match(es.html, /Ana Jefa, de Ledens,/);
  // 0 → 25 of 50 ml on one of two equal lines: the obra goes 0 % → 25 %.
  assert.match(es.html, /Ejecución de la obra:<\/strong> 0 % → <strong>25 %/);
  assert.match(es.html, /Tubería de agua fría[\s\S]*0 de 50 ml[\s\S]*25 de 50 ml[\s\S]*50 %/);
  assert.match(es.html, /Tubería de agua caliente<br><em[^>]*>Esperando material<\/em>[\s\S]*Sin cambio de cantidad/);
  assert.match(es.html, /\/plataforma"/);
  assert.doesNotMatch(es.html, /€|10,00|500/, 'no amounts in the email');
  assert.equal(en.subject, 'Ledens · Progress on “Reforma de baño”', 'no translator here: the Spanish texts stay');
  assert.match(en.html, /Project completion/);
  assert.match(en.html, /Cold water pipe[\s\S]*0 of 50 ml[\s\S]*25 of 50 ml/, 'a text already translated for the client area is read in English');
  assert.doesNotMatch(es.html, /Cold water pipe/);
  await deliver(ms);
  assert.equal((await claim()).length, 0);
});

test('a retry sends the same summary; an update meanwhile starts a new email', async () => {
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-158'), executed: '10' }] });
  await due();
  const first = await claim();
  assert.equal(first.length, 2);
  await Promise.all(first.map((m) => new AlertService(pool).acknowledge(m.id, m.lease_token, false))); // Outlook failed
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-158'), executed: '40' }] });
  await due();
  const again = await claim();
  assert.equal(again.length, 4, 'the retry of each, plus a new one each');
  const retry = again.find((m) => m.id === first.find((f) => f.to === cliente.email).id);
  assert.match(retry.html, /0 de 50 ml[\s\S]*10 de 50 ml/, 'the retry keeps its range');
  assert.doesNotMatch(retry.html, /40 de 50 ml/);
  const fresh = again.find((m) => m.to === cliente.email && m.id !== retry.id);
  assert.match(fresh.html, /10 de 50 ml[\s\S]*40 de 50 ml/);
  await deliver(again);
});

test('a client who no longer follows the obra gets nothing; an obra with no client to tell queues nothing', async () => {
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-158'), executed: '45' }] });
  await db.query('DELETE FROM obra_clientes WHERE user_id=$1', [invitado.id]);
  await due();
  const ms = await claim();
  assert.deepEqual(ms.map((m) => m.to), [cliente.email]);
  assert.equal((await db.query("SELECT count(*)::int n FROM ledens.transaction_alerts WHERE last_error='obra_avance_not_pending'")).rows[0].n, 1, 'closed without sending');
  await deliver(ms);
  await db.query('UPDATE users SET access_held=true, email_verified=false WHERE id=$1', [cliente.id]);
  const before = (await alerts()).length;
  await as(jefe).declare(obraId, { items: [{ partidaId: id('PA-158'), executed: '50' }] });
  assert.equal((await alerts()).length, before, 'an account whose access is held sees no obra, so it is not told either');
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { AlertService } from '../src/notifications/service.js';
// «Nueva alta» email (migration 052, notifications/altas.js) on PGlite: one
// message per user, queued when users.registered_at is first set (whatever
// set it), never for accounts registered before, built at claim time for its
// own recipient.
let db, pool, admin, veterano;
const migration = (m) => fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8');
const alertsOf = async (id) => (await db.query("SELECT * FROM ledens.transaction_alerts WHERE event_type='user_registered' AND payload->>'user_id'=$1", [id])).rows;
// createSession's own statement (auth/sessions.js): the first session registers the account.
const firstSession = (id) => db.query('UPDATE users SET registered_at = now() WHERE id = $1 AND registered_at IS NULL', [id]);
const user = async (email, name, extra = '') => (await db.query(`INSERT INTO users(email,name,role${extra ? ',' + extra.split('=')[0] : ''}) VALUES ($1,$2,'client'${extra ? ',' + extra.split('=')[1] : ''}) RETURNING id,email,name,role`, [email, name])).rows[0];
const claimAll = async () => (await new AlertService(pool).claim()).messages;

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text NOT NULL, password_hash text,
      email_verified boolean NOT NULL DEFAULT false, role text NOT NULL DEFAULT 'client', access_held boolean NOT NULL DEFAULT false, registered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
    CREATE TABLE auth_identities(id bigint GENERATED ALWAYS AS IDENTITY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, provider text, provider_user_id text);
    CREATE TABLE sessions(id bigint GENERATED ALWAYS AS IDENTITY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, token_hash text);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.transaction_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, event_type text NOT NULL, status text NOT NULL,
      reason text, document_id uuid, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, lease_token uuid,
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql', '023_invitaciones_cliente.sql',
    '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '047_auth_handoffs.sql', '048_partidas_eliminadas.sql', '051_obra_enlaces.sql']) await db.exec(await migration(m));
  [admin, veterano] = (await db.query(`INSERT INTO users(email,name,role,email_verified,registered_at) VALUES
    ('admin@alta.test','Admin','admin',true,now()),('veterano@alta.test','Veterano','client',true,now()) RETURNING id,email,name,role`)).rows;
  await db.exec(await migration('052_aviso_alta_usuario.sql'));
});
after(() => db?.close());

test('an account is announced once, when it is registered; never the ones registered before', async () => {
  assert.deepEqual(await alertsOf(veterano.id), [], 'no burst when the migration runs');
  assert.deepEqual(await alertsOf(admin.id), []);
  // A client the team chose for an obra or invited: not registered yet, not announced.
  const pendiente = await user('pendiente@alta.test', 'pendiente@alta.test');
  assert.deepEqual(await alertsOf(pendiente.id), []);
  await db.query("UPDATE users SET name='Ya con nombre' WHERE id=$1", [pendiente.id]);
  assert.deepEqual(await alertsOf(pendiente.id), [], 'other changes do not count');
  await firstSession(pendiente.id);
  const [a] = await alertsOf(pendiente.id);
  assert.deepEqual([a.status, a.payload, a.delivered_at], ['registered', { user_id: pendiente.id }, null]);
  await firstSession(pendiente.id);
  await db.query('UPDATE users SET registered_at = now() WHERE id=$1', [pendiente.id]);
  await db.query('UPDATE users SET registered_at = NULL WHERE id=$1', [pendiente.id]);
  await db.query('UPDATE users SET registered_at = now() WHERE id=$1', [pendiente.id]);
  assert.equal((await alertsOf(pendiente.id)).length, 1, 'once per user');
  // Created registered at once (a password registration that takes a prepared row, staff from the CLI).
  const staff = (await db.query("INSERT INTO users(email,name,role,registered_at) VALUES ('jefe@alta.test','Jefa Nueva','jefe',now()) RETURNING id")).rows[0];
  assert.equal((await alertsOf(staff.id)).length, 1);
});

test('the message goes to its own recipient and says who they are, how they get in and what they see', async () => {
  await db.query("UPDATE ledens.transaction_alerts SET delivered_at=now() WHERE delivered_at IS NULL");
  const laura = await user('laura@alta.test', 'Laura <b>García</b>', "password_hash='x'");
  await db.query("INSERT INTO auth_identities(user_id,provider,provider_user_id) VALUES ($1,'google','g-1')", [laura.id]);
  const as = (u) => new PresupuestosService(pool, u);
  const content = { chapters: [{ name: 'Obra', items: [{ name: 'Encimera', unit: 'ud', quantity: '1', unitPrice: '900' }] }] };
  const propia = await as(admin).create({ ...content, title: 'Cocina de Laura', clientId: laura.id });
  const otro = await user('otro@alta.test', 'Otro', "registered_at=now()");
  const ajena = await as(admin).create({ ...content, title: 'Obra compartida', clientId: otro.id });
  const enlace = (await db.query("INSERT INTO obra_enlaces(presupuesto_id,token_hash,expires_at) VALUES ($1,'h',now()+interval '1 day') RETURNING id", [ajena.id])).rows[0];
  await db.query('INSERT INTO obra_clientes(presupuesto_id,user_id,enlace_id) VALUES ($1,$2,$3)', [ajena.id, laura.id, enlace.id]);
  await firstSession(laura.id);

  const mine = (await claimAll()).filter((m) => m.subject.includes('laura@alta.test'));
  assert.equal(mine.length, 1);
  const [m] = mine;
  assert.equal(m.to, 'alvaro.navarro@ledens.es');
  assert.equal(m.subject, 'Ledens · Nueva alta: Laura <b>García</b> (laura@alta.test)');
  assert.ok(m.html.includes('Laura &lt;b&gt;García&lt;/b&gt;') && !m.html.includes('<b>García'), 'escaped');
  for (const text of ['Cliente', 'Google, email y contraseña', `${propia.ref} · Cocina de Laura — cliente principal`, `${ajena.ref} · Obra compartida — solo lectura (enlace para compartir)`, '/plataforma']) {
    assert.ok(m.html.includes(text), text);
  }
  assert.ok(!m.html.includes('no verá ninguna obra'));
});

test('a held account is flagged; AVISO_ALTAS_TO changes the recipient; a user gone since is not announced', async () => {
  await db.query("UPDATE ledens.transaction_alerts SET delivered_at=now() WHERE delivered_at IS NULL");
  const held = await user('held@alta.test', 'Held', 'access_held=true');
  await firstSession(held.id);
  const gone = await user('gone@alta.test', 'Gone');
  await firstSession(gone.id);
  const [goneAlert] = await alertsOf(gone.id);
  await db.query('DELETE FROM users WHERE id=$1', [gone.id]);
  process.env.AVISO_ALTAS_TO = 'altas@ledens.es;otra@ledens.es';
  try {
    const messages = await claimAll();
    const m = messages.find((x) => x.subject.includes('held@alta.test'));
    assert.equal(m.to, 'altas@ledens.es;otra@ledens.es');
    assert.ok(m.html.includes('no verá ninguna obra'));
    assert.ok(!messages.some((x) => x.subject.includes('gone@alta.test')));
    const closed = (await db.query('SELECT delivered_at, last_error FROM ledens.transaction_alerts WHERE id=$1', [goneAlert.id])).rows[0];
    assert.ok(closed.delivered_at);
    assert.equal(closed.last_error, 'user_registered_not_pending');
  } finally {
    delete process.env.AVISO_ALTAS_TO;
  }
});

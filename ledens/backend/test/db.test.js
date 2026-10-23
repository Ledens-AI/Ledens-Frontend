import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isDbConfigured, getPool, closePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';

// Needs a real Postgres: `docker compose up -d db` then
//   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm test
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

before(async () => {
  if (!skip) await runMigrations();
});
after(closePool);

// Every test runs inside a transaction that is rolled back, so the database is
// left exactly as it was found.
async function inTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const newUser = (client, email = 'ana@example.com') =>
  client.query(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [email, 'Ana', null],
  );

test('migrations are idempotent', { skip }, async () => {
  await runMigrations();
  const { rows } = await getPool().query('SELECT count(*)::int AS n FROM schema_migrations');
  assert.ok(rows[0].n >= 1);
});

test('creates a user with defaults', { skip }, () =>
  inTransaction(async (c) => {
    const { rows } = await newUser(c);
    assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
    assert.equal(rows[0].password_hash, null);
    assert.ok(rows[0].created_at instanceof Date);
  }));

test('email is unique regardless of case', { skip }, () =>
  inTransaction(async (c) => {
    await newUser(c, 'Ana@Example.com');
    await assert.rejects(newUser(c, 'ana@example.COM'), { code: '23505' });
  }));

test('one user can have several login methods', { skip }, () =>
  inTransaction(async (c) => {
    const { rows } = await newUser(c);
    const id = rows[0].id;
    const add = (provider, sub) =>
      c.query(
        'INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)',
        [id, provider, sub],
      );
    await add('google', 'g-123');
    await add('microsoft', 'm-456');
    const { rows: found } = await c.query(
      'SELECT count(*)::int AS n FROM auth_identities WHERE user_id = $1',
      [id],
    );
    assert.equal(found[0].n, 2);
  }));

test('the same provider account cannot belong to two users', { skip }, () =>
  inTransaction(async (c) => {
    const a = (await newUser(c, 'a@example.com')).rows[0].id;
    const b = (await newUser(c, 'b@example.com')).rows[0].id;
    const add = (id) =>
      c.query(
        "INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, 'google', 'same-sub')",
        [id],
      );
    await add(a);
    await assert.rejects(add(b), { code: '23505' });
  }));

test('unknown providers are rejected', { skip }, () =>
  inTransaction(async (c) => {
    const { rows } = await newUser(c);
    await assert.rejects(
      c.query(
        "INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, 'facebook', 'x')",
        [rows[0].id],
      ),
      { code: '23514' },
    );
  }));

test('deleting a user removes their login methods', { skip }, () =>
  inTransaction(async (c) => {
    const { rows } = await newUser(c);
    await c.query(
      "INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, 'apple', 'a-1')",
      [rows[0].id],
    );
    await c.query('DELETE FROM users WHERE id = $1', [rows[0].id]);
    const { rows: left } = await c.query(
      'SELECT count(*)::int AS n FROM auth_identities WHERE user_id = $1',
      [rows[0].id],
    );
    assert.equal(left[0].n, 0);
  }));

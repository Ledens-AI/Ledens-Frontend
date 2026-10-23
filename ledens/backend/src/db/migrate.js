import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, 'migrations');

// Arbitrary constant. Postgres advisory lock so that several backend replicas
// starting at once do not run the same migration twice.
const LOCK_ID = 727001;

/**
 * Applies every migrations/*.sql file, in filename order, that has not been
 * applied yet. Each file runs in its own transaction and is recorded in the
 * schema_migrations table. Never edit a migration that has already shipped —
 * add a new numbered file instead.
 */
export async function runMigrations() {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const client = await getPool().connect();
  let failure;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[db] applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        failure = new Error(`Migration ${file} failed: ${err.message}`);
        throw failure;
      }
    }
  } catch (err) {
    failure = failure || err;
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    // Pass any failure to release() so node-postgres discards a connection
    // that may be in a bad state, instead of handing it back to the pool for
    // an unrelated later query to inherit.
    client.release(failure);
  }
}

// `npm run migrate` — run the migrations by hand and exit.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => console.log('[db] migrations up to date'))
    .catch((err) => {
      console.error('[db]', err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}

import pg from 'pg';

const { Pool } = pg;

let pool = null;

// The database is optional: without DATABASE_URL the backend still serves
// /api/contact and /api/health exactly as before.
export const isDbConfigured = () => Boolean(process.env.DATABASE_URL);

export function getPool() {
  if (!isDbConfigured()) throw new Error('DATABASE_URL is not set');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Azure Database for PostgreSQL requires TLS.
      ssl: process.env.DATABASE_SSL === 'true' ? true : undefined,
      max: 5,
      // pg's default is 0 (wait forever). Without this, an unreachable DB at
      // startup hangs runMigrations() indefinitely, so index.js never reaches
      // app.listen() — breaking the "a DB outage must never take down the
      // lead form" guarantee the rest of this file's comments promise.
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => console.error('[db] idle client error', err));
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

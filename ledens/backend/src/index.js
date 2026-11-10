import { createApp } from './app.js';
import { getPool, isDbConfigured } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startPayablesScheduler } from './finanzas/payables.js';
import { runRepararNombresOnce } from './presupuestos/repararNombres.js';

const PORT = Number(process.env.PORT || 4000);

async function start() {
  if (isDbConfigured()) {
    try {
      await runMigrations();
      // Cuentas por pagar: the jornales of each day that passes (hourly, idempotent).
      startPayablesScheduler(getPool());
      // One-off: partida names the old PDF reader cut, restored from the obra's PDF.
      runRepararNombresOnce(getPool()).catch((e) => console.error('[reparar-nombres] failed; retried at next start', e));
    } catch (err) {
      // Do not take the whole API down (and with it the lead form) because the
      // database is unreachable — log loudly and keep serving.
      console.error('[db] startup migrations failed — continuing without a ready database', err);
    }
  } else {
    console.log('[db] DATABASE_URL not set — database features disabled');
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Ledens backend listening on :${PORT}`);
  });
}

start();

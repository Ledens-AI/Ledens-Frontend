import { createApp } from './app.js';
import { isDbConfigured } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

const PORT = Number(process.env.PORT || 4000);

async function start() {
  if (isDbConfigured()) {
    try {
      await runMigrations();
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

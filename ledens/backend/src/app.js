import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import contactRouter from './routes/contact.js';
import authRouter from './routes/auth.js';
import oauthRouter from './routes/oauth.js';

// Builds the Express app without starting it listening — used both by
// src/index.js (real server) and by the tests (ephemeral server on a random
// port, so several test files can run without colliding on :4000).
export function createApp() {
  const app = express();
  const ORIGIN = process.env.CORS_ORIGIN || '*';

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  // credentials: true lets the session cookie travel on cross-origin calls
  // (e.g. hitting the Container App FQDN directly in dev). Same-origin calls
  // through the SWA/nginx proxy work regardless. Browsers flatly reject
  // Access-Control-Allow-Origin: * paired with credentials: true for any
  // cookie-bearing request, so only turn credentials on once an actual
  // origin is configured — never silently combine it with the wildcard.
  app.use(cors({ origin: ORIGIN, credentials: ORIGIN !== '*' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ledens-backend', ts: new Date().toISOString() });
  });

  app.use('/api/contact', contactRouter);
  // oauthRouter mounted FIRST: authRouter's "DB not configured" guard is a
  // path-less router.use(), so once it sends a 503 nothing downstream ever
  // runs — mounting it first would silently swallow /api/auth/google and
  // /api/auth/microsoft behind its generic message, before oauth.js's own
  // per-provider isGoogleConfigured()/isMicrosoftConfigured() checks (and
  // their more specific error text) ever got a chance to run. Requests that
  // don't match any oauthRouter route (/register, /login, /logout, /me)
  // fall through to authRouter normally.
  app.use('/api/auth', oauthRouter);
  app.use('/api/auth', authRouter);

  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

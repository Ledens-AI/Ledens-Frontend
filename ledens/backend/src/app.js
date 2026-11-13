import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import contactRouter from './routes/contact.js';
import authRouter from './routes/auth.js';
import oauthRouter from './routes/oauth.js';
import { createMobileAuthRouter } from './routes/mobileAuth.js';
import adminRouter from './routes/admin.js';
import { createIngestionRouter } from './routes/ingestion.js';
import { createFinanzasRouter } from './routes/finanzas.js';
import { createPresupuestosRouter } from './routes/presupuestos.js';
import { createObrasRouter } from './routes/obras.js';
import { createInvitacionesRouter } from './routes/invitaciones.js';
import { createHerramientasRouter } from './routes/herramientas.js';
import bridgeRouter from './routes/bridge.js';
import financeRouter from './routes/finance.js';

// Builds the Express app without starting it listening — used both by
// src/index.js (real server) and by the tests (ephemeral server on a random
// port, so several test files can run without colliding on :4000).
export function trustProxyHops(value = process.env.TRUST_PROXY_HOPS) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isInteger(n) && n >= 0 && n <= 5 ? n : 2;
}

export function createApp() {
  const app = express();
  const ORIGIN = process.env.CORS_ORIGIN || '*';

  // How many proxies in front of Express add an X-Forwarded-For entry; req.ip
  // (the rate limiters' key) is the address the outermost trusted one saw.
  // Production: browser/app → Static Web App (adds the client's IP) → Container
  // Apps ingress (adds the SWA hop's IP) → Express. Verified with
  // /api/auth/mobile/diagnostico on 13 Nov 2026: two Azure entries, and with
  // `1` req.ip was the SWA hop, shared by every user, so 10 failed logins by
  // anyone blocked everyone's login. `2` reads the client's IP as SWA saw it;
  // anything a client prepends stays to its left and is ignored. The Container
  // App is only reachable through SWA (direct calls get 401), so nobody can
  // skip a hop. TRUST_PROXY_HOPS overrides it (e.g. 1 behind docker-compose's
  // single nginx).
  app.set('trust proxy', trustProxyHops());
  app.use('/api/v1/facturas/ingesta', rateLimit({
    windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false,
  }), createIngestionRouter());
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  // credentials: true lets the session cookie travel on cross-origin calls
  // (e.g. hitting the Container App FQDN directly in dev). Same-origin calls
  // through the SWA/nginx proxy work regardless. Browsers flatly reject
  // Access-Control-Allow-Origin: * paired with credentials: true for any
  // cookie-bearing request, so only turn credentials on once an actual
  // origin is configured — never silently combine it with the wildcard.
  app.use(cors({ origin: ORIGIN, credentials: ORIGIN !== '*' }));

  // Mounted before the shared /api limiter: it has its own (see the router).
  app.use('/api/finanzas', createFinanzasRouter());
  app.use('/api/presupuestos', createPresupuestosRouter());
  app.use('/api/obras', createObrasRouter());
  app.use('/api/invitaciones', createInvitacionesRouter());
  app.use('/api/herramientas', createHerramientasRouter());

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
  // Ledens Mobile login/logout (Bearer token in the body, never a cookie).
  // Mounted before both /api/auth routers so authRouter's path-less 503
  // guard never answers for it; it answers 404 itself while
  // MOBILE_AUTH_ENABLED is not exactly 'true'.
  app.use('/api/auth/mobile', createMobileAuthRouter());
  app.use('/api/auth', oauthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/bridge', bridgeRouter);
  app.use('/api', financeRouter);

  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

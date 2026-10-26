# Ledens — Architecture & Development Guide

<!-- verified: dev environment + push access confirmed 2026-08-20 -->

## Project Overview
Ledens is a lead-capture landing page for a home-renovation company (Sociedad Inversora Navarro Robinson S.L., Málaga).
It is a separated frontend/backend deployment on Azure:

- **Frontend** → Azure Static Web Apps (SWA)
- **Backend** → Azure Container Apps (ACA)
- **Database** → Azure Files share mounted at `/data` (leads stored as `leads.jsonl`)

---

## Repository Layout

```
ledens/
  frontend/          React 18 + Vite SPA (deployed to SWA)
  backend/           Express 4 API server (deployed to ACA via Docker)
  infra/
    deploy-new-subscription.sh  Full provisioning script (run once per new subscription) — current
    setup-database.sh           Adds PostgreSQL + Key Vault to an existing deployment — current
    setup.sh, setup2.sh         Historical — targeted the old, now-abandoned subscription
  docker-compose.yml Local full-stack dev with Docker
  .env.example       Root-level env var reference
.github/
  workflows/
    azure-static-web-apps.yml   Frontend CI/CD → SWA
    deploy-backend.yml          Backend CI/CD → ACA via ACR
```

---

## Architecture

```
Browser
  │
  └─► Azure Static Web Apps (swa-ledens)
        • Hostname: ambitious-island-05d1d8a03.2.azurestaticapps.net
        • Serves the Vite build (ledens/frontend/dist)
        • /api/* requests → proxied automatically to Container App
        │                   (SWA Linked Backend — no CORS headers needed in frontend)
        │
        └─► Azure Container App (ledens-backend)
              • FQDN: ledens-backend.gentlebay-cc058f77.westeurope.azurecontainerapps.io
              •        (direct calls now rejected with 401 — only reachable via the SWA hostname)
              • Express server on port 4000
              • Image pulled from ACR via user-assigned managed identity (no passwords)
              │
              ├─► Azure Files share (ledens-data) mounted at /data
              │     • Persists leads.jsonl across container restarts / revisions
              │
              └─► PostgreSQL Flexible Server (psql-ledens-ee069061) + Key Vault (kv-ledens-ee069061)
                    • Users, sessions, login identities — see "Database" under Backend
```

> The `/api/*` proxy is configured at the Azure level via `az staticwebapp backends link`.
> No frontend code change is needed to route API calls — they use relative paths (`/api/...`).

---

## Azure Resources

**Subscription:** `Ledens-subscription-1` (`ee069061-db06-4a57-8ce7-c752a2985d27`), resource group `rg-ledens`, `westeurope`, tagged `proyecto=ledens`. `<sfx>` below = first 8 hex chars of the subscription id (`ee069061`) — used for globally-unique names.

> **History:** everything originally lived in a different subscription (`550f2d00…`, "MCAPS-Support-alvaron", resource group `rg-ledens-mvp`), which couldn't be migrated across Azure AD tenants. The whole stack was rebuilt from scratch here on 4 Oct 2026 via `deploy-new-subscription.sh`; the database and Key Vault were added on 14 Oct via `setup-database.sh`. Almost every resource name changed along with it — if you see `rg-ledens-mvp`, `cregledensmvp1`, or a `*.azurecontainerapps.io`/`*.azurestaticapps.net` hostname that doesn't match the table below, it's a leftover reference to the old subscription.

| Resource | Name | Notes |
|---|---|---|
| Resource Group | `rg-ledens` | Region: westeurope |
| Static Web App | `swa-ledens` | Frontend host + `/api/*` proxy. Hostname: `ambitious-island-05d1d8a03.2.azurestaticapps.net` |
| Container App | `ledens-backend` | Express API. FQDN: `ledens-backend.gentlebay-cc058f77.westeurope.azurecontainerapps.io` (direct calls rejected with 401 — only reachable via the SWA hostname) |
| Container Apps Env | `ledens-env` | Linked to Log Analytics workspace |
| Container Registry | `crledens<sfx>` | i.e. `crledensee069061`. Login server: `crledensee069061.azurecr.io` |
| Managed Identity | `id-ledens-acr-pull` | AcrPull on the registry; attached to Container App |
| Managed Identity | `id-ledens-backend` | Key Vault Secrets User; attached to Container App for `DATABASE_URL`/`JWT_SECRET` secret references |
| Storage Account | `stledens<sfx>` | i.e. `stledensee069061`. Azure Files share `ledens-data` → mounted at `/data` |
| Log Analytics | `log-ledens` | 30-day retention, 0.5 GB/day cap. Linked to `ledens-env` |
| Key Vault | `kv-ledens<sfx>` | i.e. `kv-ledens-ee069061`. RBAC mode. Secrets: `database-url`, `jwt-secret`, OAuth placeholders (`google-*`/`microsoft-*`/`apple-*` — still `CHANGE_ME`, no app registered with any provider yet) |
| PostgreSQL Flexible Server | `psql-ledens<sfx>` | i.e. `psql-ledens-ee069061`. PG 16, Burstable B1ms, 32 GB, db `ledens`, ~15 €/month. Firewall: `allow-azure-services` (`0.0.0.0` — Azure-origin traffic only; password + TLS still required) |

---

## Backend (ledens/backend)

**Stack:** Node 20, Express 4, ESM modules
**Port:** 4000 (set via `PORT` env var)
**Image:** `crledensee069061.azurecr.io/ledens-backend:latest`

### API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check — returns `{ status: "ok", db: "ok" \| "migrating" \| "disabled" \| "error" }` |
| POST | `/api/contact` | Lead capture — appends to `/data/leads.jsonl` |
| POST | `/api/auth/register` | Create an account (name, email, password). Logs in and sets the session cookie. |
| POST | `/api/auth/login` | Email + password login. Sets the session cookie. Rate-limited (10 / 15 min per IP). |
| POST | `/api/auth/logout` | Deletes the current session and clears the cookie. |
| GET | `/api/auth/me` | Returns the logged-in user from the session cookie, or 401. |
| GET | `/api/auth/google` | Starts Google login — redirects to Google, sets a short-lived `oauth_state` cookie. |
| GET | `/api/auth/google/callback` | Google's redirect target. Finds, creates or reclaims the user, sets the session cookie, redirects to `/`. Any failure redirects to `/auth?error=...` instead of showing a raw error. |
| GET | `/api/auth/microsoft` | Starts Microsoft login (personal + work/school accounts). Same shape as `/google`. |
| GET | `/api/auth/microsoft/callback` | Same shape as `/google/callback`. |
| GET | `/api/admin/users` | **Admin only.** Every user with role, email verification, sign-in methods and last login. |
| PATCH | `/api/admin/users/:id/role` | **Admin only.** `{ role, reason }` — changes a role (never your own) and writes an `audit_log` row. |
| POST | `/api/admin/view-as` | **Admin only.** `{ userId }` — starts «Ver como» that user (writes an `audit_log` row, returns the user). See "Roles". |
| GET | `/api/admin/audit` | **Admin only.** Last 200 `audit_log` entries. |
| * | `/api/presupuestos/*` | **Every role, checked per row** (`src/presupuestos/service.js`). Presupuestos para clientes and obras en curso: an admin creates and sends a budget (chapters, coded lines, net prices, one VAT rate per version) to a client; the client approves (choosing optional lines), asks for changes (the team sends a new version) or rejects; the team sets the start date and the assigned jefe declares the executed quantity per line. Clients only see their own non-draft budgets; a jefe only those assigned to them (`jefe_id`). |
| * | `/api/obras/:id/archivos*` | **Same per-row access as presupuestos** (`src/obras/archivos.js`). Fotos (JPG/PNG/HEIC, 15 MB) y documentos PDF (20 MB) de una obra (root presupuesto): the assigned jefe or an admin uploads (`POST`, raw file as body, metadata in `X-Archivo-*` headers) and withdraws (`DELETE`); the client of the obra lists and downloads (`GET …/:fileId`, `?descargar=1` → attachment; `…/miniatura` → browser-made JPEG thumbnail). Format checked from the bytes (`src/obras/validation.js`). Own rate limit (600/min), mounted before the shared one. |
| * | `/api/finanzas/*` | **Admin + explicitly authorized jefe.** Gestión financiera: imputing `ledens.material_expenses` / `worker_payments` / `customer_payments` to `ledens.projects`, splits, review flags, profitability. See `ledens/backend/FINANZAS.md`. |

All `/api/auth/*` routes return `503` if `DATABASE_URL` isn't set (production, until the DB is provisioned). The OAuth routes also return `503` until their own `*_CLIENT_ID`/`*_CLIENT_SECRET`/`*_REDIRECT_URI` are set (no app is registered with either provider yet — see the build log's open questions for who should own them).

### Contact endpoint payload
```json
{ "name": "string (required)", "phone": "string (required)", "email": "string (optional)", "message": "string (optional, max 2000)" }
```

### Environment variables (production)
| Variable | Value | Source |
|---|---|---|
| `NODE_ENV` | `production` | Set in ACA |
| `PORT` | `4000` | Set in ACA |
| `CORS_ORIGIN` | `https://ambitious-island-05d1d8a03.2.azurestaticapps.net` | Set in ACA (SWA hostname) |
| `DATA_DIR` | `/data` | Set in ACA |
| `DATABASE_URL` | PostgreSQL connection string, `sslmode=require` | `secretref:database-url` — Key Vault → ACA secret, provisioned by `infra/setup-database.sh`. Unset ⇒ database features are off and the API behaves as before (never blocks `/api/contact`). |
| `DATABASE_SSL` | `true` | Set alongside `DATABASE_URL` in ACA. Belt-and-braces: the connection string's own `sslmode=require` likely already forces TLS, but this makes it explicit regardless of how the string was built. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud Console | **Still placeholder `CHANGE_ME` in Key Vault** — no app registered yet (who should own it is an open question). Google login returns 503 until this exists. |
| `GOOGLE_REDIRECT_URI` | e.g. `https://ambitious-island-05d1d8a03.2.azurestaticapps.net/api/auth/google/callback` | Must exactly match a redirect URI registered in the Google Cloud Console. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | from an Entra app registration | **Still placeholder `CHANGE_ME`** — same open question as Google. |
| `MICROSOFT_REDIRECT_URI` | e.g. `https://ambitious-island-05d1d8a03.2.azurestaticapps.net/api/auth/microsoft/callback` | Must exactly match a redirect URI registered in the Entra app. |
| `OBRA_ARCHIVOS_BLOB_URL` | `https://stledensee069061.blob.core.windows.net` | Set in ACA. Enables Azure Blob for obra photos/documents (private container `OBRA_ARCHIVOS_CONTAINER`, default `obra-archivos`). **Unset in production ⇒ uploads answer 503** — never falls back to the 1 GB `/data` share. |
| `AZURE_CLIENT_ID` | client id of `id-ledens-backend` | Set in ACA. The managed identity `DefaultAzureCredential` uses for Blob; needs «Storage Blob Data Contributor» on the container. |

### Database (PostgreSQL)

**Decision:** PostgreSQL over Cosmos DB — the data is relational/tabular (users with unique emails, and later the budget agent's catalogue and past budgets), and Postgres gives unique constraints and transactions that `leads.jsonl` cannot.

**Status:** provisioned and live — `psql-ledens-ee069061` (Burstable B1ms, PostgreSQL 16, `westeurope`), created by `infra/setup-database.sh`. Firewall admits Azure-origin traffic only (`0.0.0.0` rule — the ACA consumption environment has ~320 possible outbound IPs, making per-IP rules impractical); the Key Vault-only password and TLS are what actually gate access. Hardening path, not yet done: VNet-integrated ACA environment + private endpoint. Leads still go to `leads.jsonl` (that flow is deliberately separate from users).

- Driver: `pg`. Connection pool in `src/db/pool.js`, only created when `DATABASE_URL` is set.
- Migrations: numbered `.sql` files in `src/db/migrations/`, applied in order at backend startup (guarded by a Postgres advisory lock so several replicas don't race) and via `npm run migrate`. Applied files are recorded in `schema_migrations`. **Never edit a shipped migration — add a new numbered file.** If migrations fail at startup the error is logged and the API keeps serving (so the lead form never goes down because of the DB).
- Schema (`001_users_and_identities.sql`):
  - `users` — `id` (uuid), `email` (unique, case-insensitive), `name`, `password_hash` (NULL for social-only users), timestamps.
  - `auth_identities` — links a user to Google / Microsoft / Apple (`provider`, `provider_user_id`, unique together). One user can have several, so one person never ends up as two accounts.
- `004_roles_and_audit.sql` adds `users.role` (`admin` / `jefe` / `client`, default `client`) and the `audit_log` table, and seeds the initial accounts (see "Roles").
- `020_presupuestos_cliente.sql` adds the client budget flow in `public` (not `ledens.*`, so the accounting budgets that feed profitability are untouched): `presupuestos` (client, jefe, dates, `parent_id` for an ampliación approved separately that adds to its obra), `presupuesto_versiones` (draft → sent → approved / changes_requested / rejected; superseded when a newer one is sent), `presupuesto_capitulos`, `presupuesto_partidas` (net unit price; kind confirmada/condicionada always count, decision/opcion only when the client selects them), `presupuesto_comentarios` and `presupuesto_produccion` (every declaration kept; the latest per line is the executed quantity). % de ejecución caps each line at its budgeted quantity; % de presupuesto consumido is executed × unit price over the approved total, so an excess shows only in the consumed figure. `021_presupuestos_precision.sql` widens `unit_price` to 6 decimals and `executed` to 4 (imports of VAT-inclusive spreadsheets add back up exactly) and makes references keep every digit past 999.
- `022_obra_archivos.sql` adds `obra_archivos`: metadata of the photos and PDFs of an obra (hanging from the root `presupuestos.id`), never the bytes — those live in Azure Blob (`src/obras/storage.js`; a local folder `OBRA_ARCHIVOS_DIR` / `<DATA_DIR>/obra-archivos` outside production). Withdrawing a file deletes its bytes and keeps the row with `deleted_at`/`deleted_by`.
- `003_users_email_verified.sql` adds `users.email_verified` (default `false`). See the account-linking security note under "Google login" — this column exists specifically to stop a password registration being used to pre-hijack an account someone later proves ownership of via social login.
- Tests: `cd ledens/backend && npm test` (needs the local DB; skipped if `DATABASE_URL` is unset).
- **Accounting schema (`ledens.*`) is owned by the accounting import tooling, not this repo.** Production's `schema_migrations` also lists `004_ledens_business` … `009_revolut_daily_sync` from that tooling, so new files here must use names that can't collide (next free: `011_`). Never alter or replace the accounting tables; `005_bank_bridge.sql` and `006_project_finance.sql` are the canonical finance model. `010_finanzas_imputacion.sql` only adds `finance_review_flags` with a foreign key to `financial_records`; never introduce a parallel allocation table. All UI project writes use FinanceService and project_financial_allocations, with finance_events as audit. Real column names are in `ledens/backend/test/fixtures/ledens-accounting.sql` (copied from the production catalog) — business names like "FactMateriales" are not table names.

### Authentication (email/password, issue #10)

Sessions, not JWT: a `sessions` row per login (`002_sessions.sql`), the cookie only holds a random token. This makes "log this session out" a one-row delete, which OAuth login (#11–13) and later admin controls will also rely on.

- `src/auth/passwords.js` — hashes with Node's built-in `crypto.scrypt` (no native module to compile in the Alpine Docker image, unlike `bcrypt`).
- `src/auth/sessions.js` — creates/reads/destroys sessions; only a SHA-256 hash of the token is stored in the DB, not the token itself. Also exports `requireAuth`, the middleware any future protected route (e.g. the CEO budget screen) should use.
- `src/routes/auth.js` — the four routes above. Login and registration return the same generic error either way, so the API can't be used to check which emails are registered.
- Session cookie: `ledens_session`, `httpOnly`, `sameSite=lax`, 30 days, `secure` follows `req.secure` (works in both plain-HTTP local dev and HTTPS production without an env var, because `trust proxy` is set).
- `src/app.js` builds the Express app (routes, middleware) without starting it; `src/index.js` runs migrations then calls `app.listen`. This split lets tests start the real app on a random port instead of importing a file that auto-binds `:4000`.

### Roles

Every user has one role in `users.role`; it decides what they get in `/plataforma`:

| Role | Platform view | Can reach |
|---|---|---|
| `admin` | Administración (panel, usuarios, auditoría) + Gestión financiera | `/api/admin/*`, `/api/finanzas/*` |
| `jefe` | Workspace de jefe de obra + Gestión financiera | `/api/finanzas/*`, `/api/presupuestos/*` (assigned obras) |
| `client` | Área de cliente | `/api/presupuestos/*` (own budgets) |

- **Enforced on the backend**: `requireRole('admin')` from `src/auth/sessions.js` guards `/api/admin` (401 logged out, 403 wrong role). The frontend mirrors the role to pick the view.
- **«Ver como» (admins only):** the sidebar of an admin has «Ver panel» (Administración / Jefe de obra / Cliente) and «Como usuario». A panel on its own is seen with the admin's own identity; choosing a user first calls `POST /api/admin/view-as` (audited) and then every request carries `X-Ledens-View-As: <id>`. `src/auth/viewAs.js` — applied in `/api/finanzas`, `/api/finance`, `/api/bridge` and `/api/presupuestos` before the role check — accepts it only from an admin and only on `GET` (anything else is 403 «solo lectura»), and answers as that user: their role and finance permissions apply, so a client target gets 403 from finance just like the client would. Frontend: `plataforma/VerComo.jsx`, `finanzas/api.js` (`setViewAs`).
- New registrations are always `client`. Admins change roles from the user's page in `/plataforma` (needs a reason, logged in `audit_log`); an admin can't change their own role, so there is always at least one admin.
- **Seeded accounts** (migration 004): `ajnavarrosilva@gmail.com` and `alvaro.navarro@ledens.es` → admin, `ana.anzola@ledens.es` → jefe (admin since migration `019_ana_admin.sql`, 26 Oct 2026), `alvaronavarrosilva@outlook.es` → client. Missing ones were created **without a password** — so nobody can register those emails themselves (409) — and existing ones only had their role changed. A passwordless account gets in via Google/Microsoft on that email (claims it, see the security note below) or with a temporary password from the CLI.
- **CLI** (`src/scripts/users.js`), run where `DATABASE_URL` points at the right DB — in production inside the Container App:
  ```bash
  az containerapp exec -g rg-ledens -n ledens-backend --command "npm run users -- set-password ana.anzola@ledens.es"
  npm run users -- set-password <email>           # random temporary password, printed once
  npm run users -- set-role <email> <admin|jefe|client>
  npm run users -- create <email> <role> <nombre completo>
  ```
  Every CLI change is also written to `audit_log` (actor "Sistema (consola)").
- **Schema report** (`src/scripts/schema.js`): read-only Markdown dump of the real database structure — tables, columns, keys, relations, indexes, views, triggers; catalog only, never row data, inside a `READ ONLY` transaction. The accounting tables (documents, bank movements, cost/payment facts, projects) live in production but are **not defined in this repo**; anything built on them starts from this report:
  ```bash
  az containerapp exec -g rg-ledens -n ledens-backend --command "npm run -s schema"
  npm run -s schema -- ledens            # only some schemas
  ```
- **Importing an already-approved budget** (`src/scripts/presupuestos.js`, `src/presupuestos/import.js`): `npm run presupuestos -- importar <fichero.json>` creates the presupuesto as approved, with its start date and, per line, the progress so far as the first production declaration (format in the script header; VAT-inclusive spreadsheet prices are converted to net with 6 decimals so totals match exactly). The file carries client data: keep it out of the repo; in production put it on the `/data` share, run the command through `az containerapp exec` and delete the file afterwards. The client account must exist (`npm run users -- create …`); an import never runs twice for the same client and title.

### Google &amp; Microsoft login (issues #11–12)

- `src/auth/providers/google.js` / `microsoft.js` — all the provider-specific HTTP calls (build the authorize URL, trade the code for a token, fetch the profile). Each provider's endpoint URLs are overridable via env vars (`GOOGLE_AUTH_URL`/`GOOGLE_TOKEN_URL`/`GOOGLE_USERINFO_URL`, same pattern for `MICROSOFT_*`) so tests can point them at a local stand-in instead of the real provider — see `test/oauth-google.test.js` and `test/oauth-microsoft.test.js`. Read per-call, not cached at module load — a cached value silently ignores a test's override.
- **No JWT signature verification written by hand.** Instead of validating a provider's `id_token` ourselves (easy to get subtly wrong), we call its own userinfo endpoint with the access token — that call is itself authenticated by HTTPS. Microsoft's userinfo response does **not** include `email_verified` (confirmed with real ledens.es accounts, 26 Oct 2026: staff accounts seeded by migration 004 could not log in with Microsoft). Anything other than an explicit `true` still counts as unverified, with one exception in `providers/microsoft.js` (`trustedOrganizationEmail`): an account of the company's own Entra tenant (`89aa3c28-…`) on the company domain (`ledens.es`) is verified when the `id_token` — received with the access token straight from Microsoft's token endpoint over TLS, which OIDC Core §3.1.3.7 accepts instead of a signature check, never from the browser — has our `aud`, that tenant's `iss` and `preferred_username` equal to the email (external guests have `#EXT#` names). `MICROSOFT_TRUSTED_TENANT_IDS` / `MICROSOFT_TRUSTED_DOMAINS` override the defaults; set either to an empty string to switch it off.
- Microsoft uses the `common` tenant endpoint, accepting both personal and work/school accounts, per #12's scope.
- `src/auth/identities.js` — `findOrCreateUserFromIdentity(...)`, shared by every provider, reusing `auth_identities` from #9.
  - **Security fix (found and closed while building #12, before Microsoft could inherit it):** the first version linked a new *verified* social login to any existing account with a matching email. Since #10's password registration never proves anyone owns the email they typed in, an attacker could pre-register someone else's email with a password; the real owner's first Google/Microsoft login would then have silently handed their account to that attacker's password. Fixed via `users.email_verified` (`003_users_email_verified.sql`): only an account that has *itself* reached `email_verified = true` (via a prior social login) is a safe link target. A verified login landing on an unverified account instead **reclaims** it — marks it verified, clears the unproven password, and deletes any session already open under it — rather than creating a second account, since `users.email` is unique and a duplicate isn't possible anyway. See `test/oauth-google.test.js`'s reclaim test for the exact scenario this closes.
- `src/routes/oauth.js` — both providers' routes, mounted at `/api/auth` alongside `routes/auth.js` (Express allows two routers at the same prefix). CSRF protection via a one-time `oauth_state` cookie (shared across providers — only one OAuth attempt is ever in flight per browser), checked on the callback before anything else runs.
- Session creation reuses `createSession`/`sessionCookieOptions` from `src/auth/sessions.js` — any login method ends in exactly the same kind of session.

> **`JWT_SECRET`** is also present in Key Vault and wired into ACA (`secretref:jwt-secret`), left over from an earlier, independent attempt at this same feature set (see the 14 Oct decision log entry below). **This codebase doesn't use JWTs anywhere** — sessions are DB-backed (above). Harmless to leave wired, but don't be misled by its presence into thinking there's a JWT flow here.
>
> Also worth adopting later: that earlier attempt's `/api/health` reported `db: "ok"/"migrating"/"error"/"disabled"` — a nice, credential-free way to confirm a deploy actually reached the database. Not implemented here yet.

### Adding a new backend route
1. Create `ledens/backend/src/routes/myroute.js` (export a Router)
2. Mount it in `ledens/backend/src/app.js`: `app.use('/api/myroute', myrouteRouter)`
3. Push to `main` — CI rebuilds the image and rolls a new ACA revision automatically

---

## Frontend (ledens/frontend)

**Stack:** React 18, Vite 5, react-router-dom v6
**Build output:** `dist/` (built by the SWA action at deploy time — do not commit `dist/`)
**SPA fallback:** all unknown routes → `index.html` (configured in `staticwebapp.config.json`)

### Routes

| Path | Component | Notes |
|---|---|---|
| `/` | `LandingPage` | Full landing (Hero, Proceso, Galeria, etc.) |
| `/auth` | `AuthPage` | Email/password + Google/Microsoft login, built and owned by this project (issue #14) — no third-party auth SDK |
| `/registro` | `RegistroPage` | Account creation (design from Claude Design); posts to `/api/auth/register`; no site header |
| `/plataforma` | `plataforma/Plataforma` | Client area / jefe de obra workspace / admin panel, chosen by the user's role (see Backend → "Roles"); logged-in users only (`RequireAuth` → `/auth?redirect=`); no site header. Admin screens use real data from `/api/admin`; Gestión financiera (admin + jefe, lazy-loaded from `plataforma/finanzas/`) uses real data from `/api/finanzas`; presupuestos, «Obra en curso» and their notifications (lazy-loaded from `plataforma/obras/`) use `/api/presupuestos`; Mi perfil is still demo |
| `/servicios/:slug` | `ServicioPage` | Individual service detail page |
| `/privacidad` | `PrivacidadPage` | Privacy policy |
| `/terminos` | `TerminosPage` | Terms of service |
| `/cookies` | `CookiesPage` | Cookie policy |
| `*` | `LandingPage` | Fallback |

### Global components
- `Header` — rendered on every route except `/registro` and `/plataforma`; shows login/register links or the logged-in user + logout, via `useAuth()`
- `CookieConsent` — cookie consent modal, mounted once in `App.jsx` outside `<Routes>`
  - Public API: `window.LedensCookies = { open, close, get, reset }`
  - Saves preferences to `localStorage` key `ledens.cookieConsent.v1`
- `LeadModal` — contact form, opens on CTA clicks, posts to `/api/contact`
- **Language (ES / EN)** — `src/i18n/I18nContext.jsx` (`I18nProvider` in `main.jsx`, `useI18n()`, `useT(DICT)`), no library. Each component keeps its own `{ es, en }` dictionary next to its JSX; legal pages have their English text in `components/legal/*En.jsx`, services in `data/servicios.en.js`, the client area in `plataforma/i18n.js` and `plataforma/obras/i18n.js`. `LangSwitch` sits in `Header`, the `/plataforma` top bar and `/registro`. Choice saved in `localStorage` `ledens.lang.v1` (first visit: browser language, Spanish unless it is English); `<html lang>` and the title follow it. Backend errors are Spanish: `i18n/apiErrors.js` maps the client-visible ones. Admin panel, jefe de obra screens and Gestión financiera are Spanish-only.

### Frontend auth (issue #14)

Clerk is gone — `/auth` and `Header` now talk directly to the backend's `/api/auth/*` routes (see "Authentication" and "Google & Microsoft login" under Backend). No frontend environment variable is needed for auth at all; the backend's own `GOOGLE_*`/`MICROSOFT_*`/`DATABASE_*` variables decide what works.

- `src/context/AuthContext.jsx` — `AuthProvider` (wraps the app in `main.jsx`) and `useAuth()`. Calls `/api/auth/me` once on load; exposes `{ user, loading, refresh, logout }`. The httpOnly session cookie is the real source of truth — this context is just a convenient read of it.
- `src/components/AuthPage.jsx` — one component, not two (Clerk's version split into a Clerk-enabled and a Clerk-disabled variant; the backend's own graceful degrade — e.g. 503 with a DB not yet configured — makes that split unnecessary now). Google/Microsoft are plain `<a href="/api/auth/google">` links, not JS handlers — the backend does the entire redirect and token exchange itself. Apple is shown but `disabled` (issue #13 isn't built yet). Reads `?error=google_failed` etc. from the URL (what the backend's OAuth callback redirects to on failure) and shows it as a normal alert.
- **`/sso-callback` is gone, not replaced.** Clerk needed a client-side page to finish a login in the browser; this project's OAuth exchange happens entirely on the backend (`routes/oauth.js`), so the browser just lands on `/` already logged in. `App.jsx` no longer special-cases any route around `Header`.
- Known rough edge: clicking "Continuar con Google/Microsoft" before `GOOGLE_*`/`MICROSOFT_*` exist shows the backend's raw JSON `503` response, not a styled page — acceptable pre-launch, worth revisiting once those credentials exist.

### Adding a new frontend page
1. Create `ledens/frontend/src/components/MyPage.jsx`
2. Add route in `ledens/frontend/src/App.jsx`
3. Push to `main` on any change under `ledens/frontend/**` — SWA CI rebuilds and deploys automatically

---

## CI/CD

### Frontend — `.github/workflows/azure-static-web-apps.yml`
- **Triggers:** push to `main` touching `ledens/frontend/**` or the workflow file; PR open/sync/close
- **Action:** `Azure/static-web-apps-deploy@v1`
  - `app_location`: `ledens/frontend`
  - `output_location`: `dist`
- **Secret required:** `AZURE_STATIC_WEB_APPS_API_TOKEN`

### Backend — `.github/workflows/deploy-backend.yml`
- **Triggers:** push to `main` touching `ledens/backend/**` or the workflow file; `workflow_dispatch`
- **Steps:**
  1. Azure login (service principal)
  2. Resolve the ACR name/login-server dynamically from `rg-ledens` (`az acr list`), then `az acr login`
  3. `docker build` + push with `${{ github.sha }}` tag and `latest` tag
  4. `az containerapp update --image <sha-tagged-image>` → new ACA revision
  5. Health-check loop (10 attempts, 6 s apart) against `/api/health` — **through the SWA hostname**, not the Container App's own FQDN directly (that now rejects direct calls with 401, since it's a linked backend)
- **Secret required:** `AZURE_CREDENTIALS` (service principal JSON from `az ad sp create-for-rbac --sdk-auth`)

### Required GitHub Secrets
| Secret | Used by | How to obtain |
|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA workflow | Azure Portal → Static Web Apps → `swa-ledens` → Manage deployment token |
| `AZURE_CREDENTIALS` | Backend workflow | Run `az ad sp create-for-rbac --name sp-ledens-github --role Contributor --scopes /subscriptions/ee069061-db06-4a57-8ce7-c752a2985d27/resourceGroups/rg-ledens --sdk-auth` |

---

## Local Development

### Prerequisites
- Node 20+
- Docker + Docker Compose

### Option A — Vite dev server (frontend only)
```bash
cd ledens/frontend
npm install
npm run dev                        # http://localhost:5173
```
Vite proxies `/api/*` → `http://localhost:4000`. Start the backend separately.

### Option B — Docker Compose (full stack)
```bash
cd ledens
cp .env.example .env              # set CORS_ORIGIN=http://localhost:8080
docker compose up --build         # frontend on :8080, backend on :4000
```
This also starts a local PostgreSQL (`ledens-db`, published on `127.0.0.1:5432`, dev password in `docker-compose.yml`). To run only the database and use `npm run dev` for the backend:
```bash
cd ledens && docker compose up -d db
cd backend
DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm run dev
DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm test
```
(PowerShell: set `$env:DATABASE_URL = "..."` first.)

---

## Infra Scripts

| Script | When to use |
|---|---|
| `ledens/infra/setup.sh` | **Historical** — targeted the old `rg-ledens-mvp` / `550f2d00…` subscription, which couldn't migrate across tenants (see "New subscription" above). Not usable against the current environment. |
| `ledens/infra/setup2.sh` | **Historical**, same reason as `setup.sh`. |
| `ledens/infra/deploy-new-subscription.sh` | **Current.** Provisions the full stack from scratch in an empty subscription (`rg-ledens`, tagged `proyecto=ledens`) with cost guardrails: Log Analytics 0.5 GB/day cap, ACR Basic, 1–2 replicas, RG budget. Prints the two GitHub secrets at the end. This built what's running today. |
| `ledens/infra/setup-database.sh` | **Current.** Adds PostgreSQL + Key Vault + the `id-ledens-backend` identity to `rg-ledens`, wires `DATABASE_URL`/`JWT_SECRET` into the Container App as secret references. Idempotent — safe to re-run. |

`deploy-new-subscription.sh` and `setup-database.sh` both auto-detect names dynamically (ACR login-server via `az acr list`, a deterministic suffix from the subscription id for globally-unique names) — no hardcoded values to go stale if the subscription changes again.

---

## Key Design Decisions

1. **SWA Linked Backend** — `/api/*` is proxied by Azure SWA to the Container App. The frontend uses only relative paths (`/api/...`). No CORS is needed in production; CORS in the Express server only affects direct calls to the ACA FQDN.

2. **Managed Identity for ACR pull** — The Container App uses `id-ledens-api-acr-pull` (user-assigned managed identity) to pull images from ACR. No registry passwords or admin credentials are used anywhere.

3. **Azure Files for persistence** — Lead data (`leads.jsonl`) is appended to `/data` inside the container, which is mounted from the `ledens-data` Azure Files share. Data survives container restarts and new revisions.

4. **Clerk removed (issue #14)** — Auth is now entirely our own: backend sessions (see "Authentication") plus a thin frontend (`AuthContext`, `AuthPage`). No publishable key, no `@clerk/clerk-react`, no `/sso-callback` client-side step. Replaced because the project needed its own user database regardless (issues #8–#13), at which point a third-party identity SDK stopped pulling its weight.

5. **ACR login-server ≠ resource name** — The ACR resource name is `crledensee069061` but the login server is `crledensee069061.azurecr.io`. Always use the full login-server URL for `az acr login` and Docker tags. Use the resource name for `az acr build`. (`deploy-backend.yml` now resolves this dynamically rather than hardcoding either — see CI/CD.)

6. **Real database for users, not for leads (yet)** — User accounts live in PostgreSQL, ~15 €/month on the cheapest always-on tier (B1ms). See "Database" for the schema/firewall/cost reasoning in full. Secrets such as `DATABASE_URL` must come from Key Vault / Container App secrets, never the repo or `VITE_*` variables.

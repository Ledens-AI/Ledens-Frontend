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
    setup.sh         Full provisioning script (run once per new subscription)
    setup2.sh        Targeted recovery script (fix partially-provisioned env)
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
  └─► Azure Static Web Apps (webapp-ledens-landing-1)
        • Hostname: wonderful-mushroom-01c0aee03.7.azurestaticapps.net
        • Serves the Vite build (ledens/frontend/dist)
        • /api/* requests → proxied automatically to Container App
        │                   (SWA Linked Backend — no CORS headers needed in frontend)
        │
        └─► Azure Container App (ledens-backend)
              • FQDN: ledens-backend.agreeablebeach-f99c1b78.westeurope.azurecontainerapps.io
              • Express server on port 4000
              • Image pulled from ACR via user-assigned managed identity (no passwords)
              │
              └─► Azure Files share (ledens-data) mounted at /data
                    • Persists leads.jsonl across container restarts / revisions
```

> The `/api/*` proxy is configured at the Azure level via `az staticwebapp backends link`.
> No frontend code change is needed to route API calls — they use relative paths (`/api/...`).

---

## Azure Resources

| Resource | Name | Notes |
|---|---|---|
| Resource Group | `rg-ledens-mvp` | Region: westeurope |
| Static Web App | `webapp-ledens-landing-1` | Frontend host + `/api/*` proxy |
| Container App | `ledens-backend` | Express API, min 1 replica |
| Container Apps Env | `ledens-env` | Linked to Log Analytics workspace |
| Container Registry | `cregledensmvp1` | Login server: `cregledensmvp1-f0b3hcbabag9d3dp.azurecr.io` |
| Managed Identity | `id-ledens-api-acr-pull` | Has AcrPull on the registry; attached to Container App |
| Storage Account | `stledensmvp1` | Azure Files share `ledens-data` → mounted at `/data` |
| Log Analytics | `workspace-rgledensmvpxLsR` | Linked to `ledens-env` |
| Key Vault | `kv-ledens-mvp-1` | Available for secrets (not yet actively used) |
| Subscription ID | `550f2d00-7d8d-4699-8b84-6eccff979f88` | MCAPS-Support-alvaron |

---

## Backend (ledens/backend)

**Stack:** Node 20, Express 4, ESM modules
**Port:** 4000 (set via `PORT` env var)
**Image:** `cregledensmvp1-f0b3hcbabag9d3dp.azurecr.io/ledens-backend:latest`

### API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check — returns `{ status: "ok" }` |
| POST | `/api/contact` | Lead capture — appends to `/data/leads.jsonl` |

### Contact endpoint payload
```json
{ "name": "string (required)", "phone": "string (required)", "email": "string (optional)", "message": "string (optional, max 2000)" }
```

### Environment variables (production)
| Variable | Value | Source |
|---|---|---|
| `NODE_ENV` | `production` | Set in ACA |
| `PORT` | `4000` | Set in ACA |
| `CORS_ORIGIN` | `https://wonderful-mushroom-01c0aee03.7.azurestaticapps.net` | Set in ACA (SWA hostname) |
| `DATA_DIR` | `/data` | Set in ACA |

### Adding a new backend route
1. Create `ledens/backend/src/routes/myroute.js` (export a Router)
2. Mount it in `ledens/backend/src/index.js`: `app.use('/api/myroute', myrouteRouter)`
3. Push to `main` — CI rebuilds the image and rolls a new ACA revision automatically

---

## Frontend (ledens/frontend)

**Stack:** React 18, Vite 5, react-router-dom v6, @clerk/clerk-react
**Build output:** `dist/` (built by the SWA action at deploy time — do not commit `dist/`)
**SPA fallback:** all unknown routes → `index.html` (configured in `staticwebapp.config.json`)

### Routes

| Path | Component | Notes |
|---|---|---|
| `/` | `LandingPage` | Full landing (Hero, Proceso, Galeria, etc.) |
| `/auth` | `AuthPage` | Clerk sign-in/sign-up |
| `/sso-callback` | `SsoCallback` | Clerk OAuth redirect handler |
| `/registro` | `RegistroPage` | Account creation (Clerk sign-up, email code); no site header |
| `/plataforma` | `plataforma/Plataforma` | Client area / site-manager workspace / admin panel (demo data, role switcher); no site header |
| `/servicios/:slug` | `ServicioPage` | Individual service detail page |
| `/privacidad` | `PrivacidadPage` | Privacy policy |
| `/terminos` | `TerminosPage` | Terms of service |
| `/cookies` | `CookiesPage` | Cookie policy |
| `*` | `LandingPage` | Fallback |

### Global components
- `Header` — rendered on every route except `/sso-callback`, `/registro` and `/plataforma`
- `CookieConsent` — cookie consent modal, mounted once in `App.jsx` outside `<Routes>`
  - Public API: `window.LedensCookies = { open, close, get, reset }`
  - Saves preferences to `localStorage` key `ledens.cookieConsent.v1`
- `LeadModal` — contact form, opens on CTA clicks, posts to `/api/contact`

### Environment variables
| Variable | Where | Description |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | GitHub Actions env / `.env.local` | Clerk publishable key (safe to commit in CI) |

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
  - `VITE_CLERK_PUBLISHABLE_KEY` injected at build time
- **Secret required:** `AZURE_STATIC_WEB_APPS_API_TOKEN`

### Backend — `.github/workflows/deploy-backend.yml`
- **Triggers:** push to `main` touching `ledens/backend/**` or the workflow file; `workflow_dispatch`
- **Steps:**
  1. Azure login (service principal)
  2. `az acr login --name cregledensmvp1-f0b3hcbabag9d3dp.azurecr.io` (full URL bypasses name validator)
  3. `docker build` + push with `${{ github.sha }}` tag and `latest` tag
  4. `az containerapp update --image <sha-tagged-image>` → new ACA revision
  5. Health-check loop (10 attempts, 6 s apart) against `/api/health`
- **Secret required:** `AZURE_CREDENTIALS` (service principal JSON from `az ad sp create-for-rbac --sdk-auth`)

### Required GitHub Secrets
| Secret | Used by | How to obtain |
|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA workflow | Azure Portal → Static Web Apps → webapp-ledens-landing-1 → Manage deployment token |
| `AZURE_CREDENTIALS` | Backend workflow | Run `az ad sp create-for-rbac --name sp-ledens-github --role Contributor --scopes /subscriptions/550f2d00-7d8d-4699-8b84-6eccff979f88/resourceGroups/rg-ledens-mvp --sdk-auth` |

---

## Local Development

### Prerequisites
- Node 20+
- Docker + Docker Compose
- A Clerk publishable key (from https://dashboard.clerk.com)

### Option A — Vite dev server (frontend only)
```bash
cd ledens/frontend
cp .env.example .env.local        # add real VITE_CLERK_PUBLISHABLE_KEY
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

---

## Infra Scripts

| Script | When to use |
|---|---|
| `ledens/infra/setup.sh` | First-time provisioning of a new subscription. Builds the image, creates all Azure resources. |
| `ledens/infra/setup2.sh` | Recovery: re-creates `ledens-env` linked to the correct Log Analytics workspace without rebuilding the image. |

Both scripts auto-detect ACR name and login-server dynamically via `az acr list` — no hardcoded ACR URL.

---

## Key Design Decisions

1. **SWA Linked Backend** — `/api/*` is proxied by Azure SWA to the Container App. The frontend uses only relative paths (`/api/...`). No CORS is needed in production; CORS in the Express server only affects direct calls to the ACA FQDN.

2. **Managed Identity for ACR pull** — The Container App uses `id-ledens-api-acr-pull` (user-assigned managed identity) to pull images from ACR. No registry passwords or admin credentials are used anywhere.

3. **Azure Files for persistence** — Lead data (`leads.jsonl`) is appended to `/data` inside the container, which is mounted from the `ledens-data` Azure Files share. Data survives container restarts and new revisions.

4. **Clerk for auth** — Frontend uses `@clerk/clerk-react`. The publishable key is a public identifier (safe in CI env vars). If the key is missing, the app renders without auth — Clerk calls degrade gracefully.

5. **ACR login-server ≠ resource name** — The ACR resource name is `cregledensmvp1` but the login server is `cregledensmvp1-f0b3hcbabag9d3dp.azurecr.io`. Always use the full login-server URL for `az acr login` and Docker tags. Use the resource name for `az acr build`.

# Ledens — Landing Reformas

Landing page for Ledens (Reformas inteligentes en Málaga) — React frontend +
Node.js (Express) backend, served behind nginx and packaged with Docker
Compose. Single command to deploy locally or on a web server.

## Stack

- **Frontend**: React 18 + Vite, served as static assets by **nginx**.
- **Backend**: Node.js 20 + Express, exposes `/api/health` and `/api/contact`.
  Leads are appended to `/data/leads.jsonl` inside a named Docker volume.
- **Reverse proxy**: nginx (in the `frontend` container) serves the SPA and
  proxies `/api/*` to the backend container over the internal Docker network.
- **Orchestration**: `docker-compose.yml` (one network, one volume).

## Project layout

```
ledens/
├── docker-compose.yml
├── .env.example
├── frontend/
│   ├── Dockerfile          # multi-stage: vite build → nginx
│   ├── nginx.conf          # SPA fallback + /api proxy
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── components/     # Header, Hero, Carousel, Compromisos, …
│       └── styles/         # tokens.css (brand) + app.css (layout)
└── backend/
    ├── Dockerfile          # node:20-alpine, runs as non-root
    ├── package.json
    └── src/
        ├── index.js        # express bootstrap
        └── routes/
            └── contact.js  # POST /api/contact → leads.jsonl
```

## Authentication

The `INICIA SESIÓN` / `REGÍSTRATE` buttons go to `/auth`, a page built and
owned by this project — email/password, Google and Microsoft login, all
handled by the backend itself (no third-party auth SDK). Full detail —
sessions, password hashing, the `/api/auth/*` routes, the OAuth flow — is in
`CLAUDE.md`, not duplicated here. The frontend needs no auth-related
environment variable at all; it just calls those endpoints.

Google and Microsoft login need `GOOGLE_*`/`MICROSOFT_*` variables on the
**backend** (see `.env.example`) — until those exist, their buttons on
`/auth` respond "not configured" rather than breaking anything. Apple login
isn't built yet (see CLAUDE.md, issue #13).

## Deploy on your PC (local)

Prerequisites: Docker Desktop running.

```bash
cd ledens
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:8080>. The contact form submits to `/api/contact`,
which nginx forwards to the backend container. Stored leads:

```bash
docker compose exec backend cat /data/leads.jsonl
```

Change the host port if 8080 is taken — set `HOST_PORT=3000` in `.env`.

To stop:

```bash
docker compose down            # keep the leads volume
docker compose down -v         # also wipe leads
```

## Deploy on your web server

Same commands. Two things to set in `.env` on the server:

```env
HOST_PORT=80                                 # or whatever your edge expects
CORS_ORIGIN=https://reformas.tudominio.com   # public origin of the site
```

Then:

```bash
docker compose up -d --build
```

### TLS / HTTPS

The bundled nginx serves plain HTTP on port 80. For HTTPS in production put a
reverse proxy in front (Caddy, Traefik, Cloudflare Tunnel, or another nginx
with Let's Encrypt) and point it at the `frontend` container. Do **not**
expose the backend container directly — keep `/api/*` flowing through nginx
so origin and rate limiting are enforced.

### Health check

```bash
curl http://localhost:8080/api/health
# → {"status":"ok","service":"ledens-backend","ts":"…"}
```

## Local development without Docker

Two terminals:

```bash
# terminal 1 — backend on :4000
cd backend
npm install
npm run dev

# terminal 2 — frontend on :5173 (vite proxies /api → :4000)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## Notes for production handoff

- **Carousel + gallery photos** are placeholder Unsplash URLs. Replace with
  real Ledens project shots in `frontend/src/components/Carousel.jsx` and
  `Galeria.jsx`.
- **Contact details** (`952 00 00 00`, `hola@ledens.es`, prices in FAQ) are
  examples from the design — update before publishing.
- **Lead storage** is intentionally simple (JSONL on a Docker volume). When
  volume grows, swap `backend/src/routes/contact.js` for a database write
  and/or an outbound webhook to your CRM.
- **Security headers** are set in `frontend/nginx.conf`. Add a stricter CSP
  before exposing on a public domain (currently relaxed because the design
  pulls images from `images.unsplash.com` and fonts from Google).

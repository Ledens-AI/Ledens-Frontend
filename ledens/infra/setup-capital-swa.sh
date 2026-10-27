#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# ledens/infra/setup-capital-swa.sh
# Adds a SECOND Static Web App for the "capital" business line
# (capital.ledens.es), in the same resource group, sharing the EXISTING
# backend (ledens-backend / same Postgres, same users table — logins are
# shared because the account system is shared, not because of a shared
# browser cookie: see the note printed at the end). Run deploy-new-subscription.sh
# and setup-database.sh first. Idempotent: safe to re-run.
#
# This script only provisions the Azure resource and links it to the
# existing backend. It does NOT create the capital frontend app or its
# CI workflow — add those separately once this SWA exists.
#
# Run from Azure Cloud Shell (Bash) inside a clone of the repo:
#   bash ledens/infra/setup-capital-swa.sh
#
# Optional overrides (env vars):
#   SUBSCRIPTION    subscription id       (default: current az account)
#   RESOURCE_GROUP  resource group name   (default: rg-ledens)
#   SWA_NAME        new SWA resource name (default: swa-ledens-capital)
#   CUSTOM_DOMAIN   hostname to attach    (default: capital.ledens.es)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

log()  { echo -e "\n\033[1;34m▶  $*\033[0m"; }
ok()   { echo -e "\033[1;32m✔  $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }

# ── ❶  CONFIGURATION ─────────────────────────────────────────────────────────
SUBSCRIPTION="${SUBSCRIPTION:-$(az account show --query id -o tsv)}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-ledens}"
LOCATION="westeurope"
TAGS=("proyecto=ledens" "linea=capital")

ACA_NAME="ledens-backend"
SWA_NAME="${SWA_NAME:-swa-ledens-capital}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-capital.ledens.es}"
GITHUB_SP_NAME="sp-ledens-capital-github"
# ─────────────────────────────────────────────────────────────────────────────

log "Subscription ${SUBSCRIPTION}"
az account set --subscription "$SUBSCRIPTION"
az extension add --name containerapp --upgrade --yes --only-show-errors
az group show -n "$RESOURCE_GROUP" -o none \
  || { echo "Resource group ${RESOURCE_GROUP} not found — run deploy-new-subscription.sh first"; exit 1; }
az containerapp show -n "$ACA_NAME" -g "$RESOURCE_GROUP" -o none \
  || { echo "Container App ${ACA_NAME} not found — run deploy-new-subscription.sh first"; exit 1; }

# ── ❷  Static Web App (Standard: required for the linked /api backend) ───────
log "Static Web App ${SWA_NAME}"
if ! az staticwebapp show -n "$SWA_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az staticwebapp create -n "$SWA_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --sku Standard --tags "${TAGS[@]}" -o none
fi
SWA_HOST=$(az staticwebapp show -n "$SWA_NAME" -g "$RESOURCE_GROUP" --query defaultHostname -o tsv)
ok "SWA: https://${SWA_HOST}"

# ── ❸  Link the SAME Container App as this SWA's /api backend ────────────────
log "Linking /api/* → ${ACA_NAME} (shared backend ⇒ shared users/sessions table)"
ACA_ID=$(az containerapp show -n "$ACA_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
if [ -z "$(az staticwebapp backends show -n "$SWA_NAME" -g "$RESOURCE_GROUP" -o tsv 2>/dev/null)" ]; then
  az staticwebapp backends link -n "$SWA_NAME" -g "$RESOURCE_GROUP" \
    --backend-resource-id "$ACA_ID" --backend-region "$LOCATION" -o none
fi
ok "Backend linked"

# ── ❹  Custom domain ─────────────────────────────────────────────────────────
log "Custom domain ${CUSTOM_DOMAIN}"
if ! az staticwebapp hostname show -n "$SWA_NAME" -g "$RESOURCE_GROUP" --hostname "$CUSTOM_DOMAIN" &>/dev/null; then
  warn "Before this succeeds, create a DNS CNAME record (at your DNS provider, not in Azure):"
  warn "  ${CUSTOM_DOMAIN}  CNAME  ${SWA_HOST}"
  warn "Waiting for you to add it — press Enter once the CNAME is created and has propagated"
  read -r -p "  (or Ctrl+C to skip the custom domain for now and add it later) " _
  az staticwebapp hostname set -n "$SWA_NAME" -g "$RESOURCE_GROUP" --hostname "$CUSTOM_DOMAIN" -o none
fi
ok "Custom domain attached (Azure issues the TLS cert automatically, can take up to ~1h)"

# ── ❺  Secrets for GitHub Actions (printed once — do not share) ──────────────
log "Service principal ${GITHUB_SP_NAME} (Contributor on ${RESOURCE_GROUP})"
SP_JSON=$(az ad sp create-for-rbac --name "$GITHUB_SP_NAME" --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}" \
  --sdk-auth --only-show-errors 2>/dev/null || true)
SWA_TOKEN=$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RESOURCE_GROUP" \
  --query properties.apiKey -o tsv)

cat <<EOF

════════════════════════════════════════════════════════════════
  CAPITAL SWA READY
════════════════════════════════════════════════════════════════
  SWA name        : ${SWA_NAME}
  Default host    : https://${SWA_HOST}
  Custom domain   : https://${CUSTOM_DOMAIN}  (pending if the CNAME step was skipped)
  Linked backend  : ${ACA_NAME}  (shared — same DB, same /api/*)

  Add this new secret in GitHub → Settings → Secrets and variables → Actions:
  https://github.com/AlvaroNS/Ledens-Frontend/settings/secrets/actions

  ── AZURE_STATIC_WEB_APPS_API_TOKEN_CAPITAL ─────────────────────
${SWA_TOKEN}

  Still needed before anything deploys here:
  1. A frontend app to deploy (e.g. ledens/capital-frontend) — not created
     by this script.
  2. A GitHub Actions workflow mirroring azure-static-web-apps.yml, pointed
     at that app_location and using the secret above (triggered on changes
     under that folder, not ledens/frontend/**).

  ⚠  Login is shared via the ACCOUNT in Postgres, not via a shared browser
     cookie: the backend sets a host-only session cookie (no explicit
     "Domain=", see src/auth/sessions.js), so a user logged in on the main
     site will NOT automatically appear logged in on ${CUSTOM_DOMAIN} — they
     log in once per domain against the same account. True single sign-on
     across both would need the cookie's Domain set to ".ledens.es" and both
     sites actually served from *.ledens.es (today the main site is still on
     its azurestaticapps.net hostname, not a ledens.es domain).
════════════════════════════════════════════════════════════════
EOF

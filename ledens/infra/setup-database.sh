#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# ledens/infra/setup-database.sh
# Adds the user database and secret store to an existing Ledens deployment
# (run deploy-new-subscription.sh first). Idempotent: safe to re-run.
#
#   • Azure Database for PostgreSQL Flexible Server (Burstable B1ms, PG 16)
#   • Key Vault (RBAC) holding database-url, jwt-secret and OAuth placeholders
#   • User-assigned identity so the Container App reads Key Vault secrets
#   • DATABASE_URL / JWT_SECRET wired into the Container App as secretrefs
#
# The schema itself is created by the backend on startup
# (ledens/backend/src/db/migrations), so nothing here connects to the DB.
#
# Run from Azure Cloud Shell (Bash) inside a clone of the repo:
#   bash ledens/infra/setup-database.sh
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

log()  { echo -e "\n\033[1;34m▶  $*\033[0m"; }
ok()   { echo -e "\033[1;32m✔  $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }

# ── ❶  CONFIGURATION ─────────────────────────────────────────────────────────
SUBSCRIPTION="${SUBSCRIPTION:-$(az account show --query id -o tsv)}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-ledens}"
LOCATION="westeurope"
TAGS=("proyecto=ledens")

SUFFIX="$(echo "$SUBSCRIPTION" | tr -d '-' | cut -c1-8)"
KEY_VAULT="kv-ledens-${SUFFIX}"
PG_SERVER="psql-ledens-${SUFFIX}"
PG_DATABASE="ledens"
PG_ADMIN="ledensadmin"
ACA_NAME="ledens-backend"
SWA_NAME="swa-ledens"
BACKEND_IDENTITY="id-ledens-backend"

# Created empty so each OAuth sub-issue only has to fill its values in.
OAUTH_PLACEHOLDERS=(google-client-id google-client-secret
                    microsoft-client-id microsoft-client-secret
                    apple-client-id apple-team-id apple-key-id apple-private-key)
# ─────────────────────────────────────────────────────────────────────────────

retry() {  # retry <description> <command...> — for RBAC propagation delays
  local what="$1"; shift
  for i in $(seq 1 12); do
    "$@" &>/dev/null && return 0
    warn "${what}: not ready yet — retrying in 15 s ($i/12)"
    sleep 15
  done
  echo "Gave up waiting for: ${what}"; exit 1
}

assign_role() {  # assign_role <role> <scope> <object-id> <principal-type>, skips if present
  local existing
  existing=$(az role assignment list --role "$1" --scope "$2" --assignee "$3" --query "[0].id" -o tsv 2>/dev/null || true)
  [ -n "$existing" ] && return 0
  az role assignment create --role "$1" --scope "$2" \
    --assignee-object-id "$3" --assignee-principal-type "$4" -o none
}

kv_get() { az keyvault secret show --vault-name "$KEY_VAULT" -n "$1" --query value -o tsv 2>/dev/null || true; }
kv_set() { az keyvault secret set --vault-name "$KEY_VAULT" -n "$1" --value "$2" -o none; }

log "Subscription ${SUBSCRIPTION}"
az account set --subscription "$SUBSCRIPTION"
az extension add --name containerapp --upgrade --yes --only-show-errors
az group show -n "$RESOURCE_GROUP" -o none \
  || { echo "Resource group ${RESOURCE_GROUP} not found — run deploy-new-subscription.sh first"; exit 1; }
for ns in Microsoft.DBforPostgreSQL Microsoft.KeyVault; do
  az provider register --namespace "$ns" --wait
done
ok "Providers registered"

# ── ❷  Key Vault (RBAC) + permission for whoever runs this script ────────────
log "Key Vault ${KEY_VAULT}"
if ! az keyvault show -n "$KEY_VAULT" -g "$RESOURCE_GROUP" &>/dev/null; then
  az keyvault create -n "$KEY_VAULT" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --enable-rbac-authorization true --retention-days 7 --tags "${TAGS[@]}" -o none
fi
KV_ID=$(az keyvault show -n "$KEY_VAULT" --query id -o tsv)
KV_URI=$(az keyvault show -n "$KEY_VAULT" --query properties.vaultUri -o tsv)

ME=$(az ad signed-in-user show --query id -o tsv)
assign_role "Key Vault Secrets Officer" "$KV_ID" "$ME" User
retry "Key Vault access for current user" az keyvault secret list --vault-name "$KEY_VAULT"
ok "Key Vault ready: ${KV_URI}"

# ── ❸  PostgreSQL Flexible Server ────────────────────────────────────────────
# The admin password is generated once and only ever stored inside database-url
# in Key Vault; it is never printed.
log "PostgreSQL server ${PG_SERVER} (first creation takes ~5-10 min)"
PG_HOST="${PG_SERVER}.postgres.database.azure.com"
DATABASE_URL="$(kv_get database-url)"
NEW_PASSWORD=""
[ -z "$DATABASE_URL" ] && NEW_PASSWORD="Ld$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)9"

if ! az postgres flexible-server show -g "$RESOURCE_GROUP" -n "$PG_SERVER" &>/dev/null; then
  [ -n "$NEW_PASSWORD" ] || { echo "database-url exists in Key Vault but the server does not — delete that secret and re-run"; exit 1; }
  az postgres flexible-server create -g "$RESOURCE_GROUP" -n "$PG_SERVER" -l "$LOCATION" \
    --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
    --admin-user "$PG_ADMIN" --admin-password "$NEW_PASSWORD" \
    --public-access Enabled --backup-retention 7 \
    --tags "${TAGS[@]}" --yes -o none
elif [ -n "$NEW_PASSWORD" ]; then
  warn "Server exists but database-url is missing — resetting the admin password"
  az postgres flexible-server update -g "$RESOURCE_GROUP" -n "$PG_SERVER" \
    --admin-password "$NEW_PASSWORD" -o none
fi

if ! az postgres flexible-server db show -g "$RESOURCE_GROUP" --server-name "$PG_SERVER" --name "$PG_DATABASE" &>/dev/null; then
  az postgres flexible-server db create -g "$RESOURCE_GROUP" --server-name "$PG_SERVER" --name "$PG_DATABASE" -o none
fi

if [ -n "$NEW_PASSWORD" ]; then
  kv_set database-url "postgresql://${PG_ADMIN}:${NEW_PASSWORD}@${PG_HOST}:5432/${PG_DATABASE}?sslmode=require"
fi
ok "Server ${PG_HOST}, database ${PG_DATABASE}"

# ── ❹  Firewall: allow traffic from Azure services only ──────────────────────
# The Container Apps consumption environment has hundreds of possible outbound
# IPs (321 here), so per-IP rules are impractical. The 0.0.0.0 rule admits
# connections only from Azure datacenter IPs; access still requires the
# Key Vault-only admin password and TLS. Next step up: VNet + private endpoint.
log "Postgres firewall ← Azure services"
if [ "$(az postgres flexible-server show -g "$RESOURCE_GROUP" -n "$PG_SERVER" \
        --query network.publicNetworkAccess -o tsv)" != "Enabled" ]; then
  az postgres flexible-server update -g "$RESOURCE_GROUP" -n "$PG_SERVER" \
    --public-access Enabled -o none
fi
if [ -z "$(az postgres flexible-server firewall-rule list -g "$RESOURCE_GROUP" --server-name "$PG_SERVER" \
             --query "[?startIpAddress=='0.0.0.0' && endIpAddress=='0.0.0.0'].name" -o tsv)" ]; then
  az postgres flexible-server firewall-rule create -g "$RESOURCE_GROUP" --server-name "$PG_SERVER" \
    --name allow-azure-services --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none
fi
ok "Firewall allows Azure services (password + TLS still required)"

# ── ❺  Application secrets ───────────────────────────────────────────────────
log "Secrets in Key Vault"
[ -n "$(kv_get jwt-secret)" ] || kv_set jwt-secret "$(openssl rand -base64 64 | tr -d '\n')"
for name in "${OAUTH_PLACEHOLDERS[@]}"; do
  [ -n "$(kv_get "$name")" ] || kv_set "$name" "CHANGE_ME"
done
ok "database-url, jwt-secret and ${#OAUTH_PLACEHOLDERS[@]} OAuth placeholders present"

# ── ❻  Container App → Key Vault via managed identity ───────────────────────
log "Identity ${BACKEND_IDENTITY} (Key Vault Secrets User)"
az identity create -n "$BACKEND_IDENTITY" -g "$RESOURCE_GROUP" -l "$LOCATION" \
  --tags "${TAGS[@]}" -o none
BI_ID=$(az identity show -n "$BACKEND_IDENTITY" -g "$RESOURCE_GROUP" --query id -o tsv)
BI_PRINCIPAL=$(az identity show -n "$BACKEND_IDENTITY" -g "$RESOURCE_GROUP" --query principalId -o tsv)
retry "Key Vault Secrets User role" assign_role "Key Vault Secrets User" "$KV_ID" "$BI_PRINCIPAL" ServicePrincipal
az containerapp identity assign -n "$ACA_NAME" -g "$RESOURCE_GROUP" --user-assigned "$BI_ID" -o none
ok "Identity attached to ${ACA_NAME}"

log "Wiring DATABASE_URL and JWT_SECRET into ${ACA_NAME}"
retry "Container App Key Vault references" az containerapp secret set -n "$ACA_NAME" -g "$RESOURCE_GROUP" \
  --secrets "database-url=keyvaultref:${KV_URI}secrets/database-url,identityref:${BI_ID}" \
            "jwt-secret=keyvaultref:${KV_URI}secrets/jwt-secret,identityref:${BI_ID}"
az containerapp update -n "$ACA_NAME" -g "$RESOURCE_GROUP" \
  --set-env-vars "DATABASE_URL=secretref:database-url" "JWT_SECRET=secretref:jwt-secret" -o none
ok "New revision rolling out"

# ── ❼  Verify through SWA: /api/health must report db: ok ───────────────────
SWA_HOST=$(az staticwebapp show -n "$SWA_NAME" -g "$RESOURCE_GROUP" --query defaultHostname -o tsv)
log "Checking https://${SWA_HOST}/api/health"
DB="unknown"
for i in $(seq 1 15); do
  DB=$(curl -s "https://${SWA_HOST}/api/health" | sed -n 's/.*"db":"\([a-z]*\)".*/\1/p')
  echo "Attempt $i: db=${DB:-<no answer>}"
  [ "$DB" = "ok" ] && break
  sleep 10
done
if [ "$DB" = "ok" ]; then
  ok "Backend connected to PostgreSQL — 'users' table created by migrations"
else
  warn "db is not ok yet. 'migrating' = still retrying (wait and re-check /api/health)."
  warn "'disabled' = the backend image predates the DB code:"
  warn "run the 'Deploy Backend' workflow. If 'error', check: az containerapp logs show -n ${ACA_NAME} -g ${RESOURCE_GROUP}"
fi

cat <<EOF

════════════════════════════════════════════════════════════════
  DATABASE READY
════════════════════════════════════════════════════════════════
  PostgreSQL : ${PG_HOST}  (db ${PG_DATABASE}, B1ms, PG 16)
  Key Vault  : ${KV_URI}
  Secrets    : database-url, jwt-secret, OAuth placeholders (CHANGE_ME)
  Identity   : ${BACKEND_IDENTITY} → Key Vault Secrets User
  Est. cost  : ~15 €/month (B1ms compute + 32 GB storage)
════════════════════════════════════════════════════════════════
EOF

#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# ledens/infra/deploy-new-subscription.sh
# Provisions the whole Ledens stack from scratch in an EMPTY subscription,
# with cost guardrails built in (Log Analytics daily cap, cheap SKUs, capped
# replicas, resource-group budget). Idempotent: safe to re-run.
#
# Run from Azure Cloud Shell (Bash) inside a clone of the repo:
#   git clone https://github.com/AlvaroNS/Ledens-Frontend.git
#   cd Ledens-Frontend
#   bash ledens/infra/deploy-new-subscription.sh
#
# Optional overrides (env vars):
#   SUBSCRIPTION   subscription id            (default: current az account)
#   RESOURCE_GROUP resource group name        (default: rg-ledens)
#   MIN_REPLICAS   0 = scale to zero, cheaper (default: 1)
#   BUDGET_AMOUNT  monthly RG budget          (default: 50)
#   ALERT_EMAIL    budget alert recipient     (default: signed-in user)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

log()  { echo -e "\n\033[1;34m▶  $*\033[0m"; }
ok()   { echo -e "\033[1;32m✔  $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠  $*\033[0m"; }

[ -d "ledens/backend" ] || { echo "Run this script from the repository root"; exit 1; }

# ── ❶  CONFIGURATION ─────────────────────────────────────────────────────────
SUBSCRIPTION="${SUBSCRIPTION:-$(az account show --query id -o tsv)}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-ledens}"
LOCATION="westeurope"
TAGS=("proyecto=ledens")
MIN_REPLICAS="${MIN_REPLICAS:-1}"
MAX_REPLICAS=2
BUDGET_AMOUNT="${BUDGET_AMOUNT:-50}"
ALERT_EMAIL="${ALERT_EMAIL:-$(az account show --query user.name -o tsv)}"

# Globally-unique names get a deterministic suffix from the subscription id.
SUFFIX="$(echo "$SUBSCRIPTION" | tr -d '-' | cut -c1-8)"
ACR_NAME="crledens${SUFFIX}"
STORAGE_ACCOUNT="stledens${SUFFIX}"

LOG_WORKSPACE="log-ledens"
ACA_ENV_NAME="ledens-env"
ACA_NAME="ledens-backend"
MANAGED_IDENTITY="id-ledens-acr-pull"
SWA_NAME="swa-ledens"
SHARE_NAME="ledens-data"
IMAGE_NAME="ledens-backend"
GITHUB_SP_NAME="sp-ledens-github"
# ─────────────────────────────────────────────────────────────────────────────

# ── ❷  Subscription, extensions, resource providers ──────────────────────────
log "Setting subscription ${SUBSCRIPTION}"
az account set --subscription "$SUBSCRIPTION"
az extension add --name containerapp --upgrade --yes --only-show-errors

log "Registering resource providers (first time can take a few minutes)"
for ns in Microsoft.App Microsoft.ContainerRegistry Microsoft.Storage \
          Microsoft.OperationalInsights Microsoft.Web Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait
  ok "$ns"
done

# ── ❸  Resource group (tag required by policy) ───────────────────────────────
log "Resource group ${RESOURCE_GROUP}"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" --tags "${TAGS[@]}" -o none
ok "Resource group ready"

# ── ❹  Log Analytics with 30-day retention and 0.5 GB/day cap ────────────────
log "Log Analytics workspace ${LOG_WORKSPACE}"
if ! az monitor log-analytics workspace show -g "$RESOURCE_GROUP" -n "$LOG_WORKSPACE" &>/dev/null; then
  az monitor log-analytics workspace create -g "$RESOURCE_GROUP" -n "$LOG_WORKSPACE" \
    -l "$LOCATION" --retention-time 30 --tags "${TAGS[@]}" -o none
fi
az monitor log-analytics workspace update -g "$RESOURCE_GROUP" -n "$LOG_WORKSPACE" \
  --quota 0.5 -o none
LOG_WS_ID=$(az monitor log-analytics workspace show -g "$RESOURCE_GROUP" -n "$LOG_WORKSPACE" \
  --query customerId -o tsv)
LOG_WS_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RESOURCE_GROUP" -n "$LOG_WORKSPACE" \
  --query primarySharedKey -o tsv)
ok "Workspace ready (retention 30 d, cap 0.5 GB/day)"

# ── ❺  Container registry (Basic) + backend image ────────────────────────────
log "Container registry ${ACR_NAME}"
if ! az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az acr create -n "$ACR_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --sku Basic --admin-enabled false --tags "${TAGS[@]}" -o none
fi
REGISTRY=$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)
IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"
ok "Registry: ${REGISTRY}"

log "Building ${IMAGE} in ACR (no local Docker needed)"
az acr build --registry "$ACR_NAME" --image "${IMAGE_NAME}:latest" \
  --platform linux/amd64 ledens/backend
ok "Image pushed"

# ── ❻  Managed identity with AcrPull ─────────────────────────────────────────
log "Managed identity ${MANAGED_IDENTITY}"
az identity create -n "$MANAGED_IDENTITY" -g "$RESOURCE_GROUP" -l "$LOCATION" \
  --tags "${TAGS[@]}" -o none
MI_ID=$(az identity show -n "$MANAGED_IDENTITY" -g "$RESOURCE_GROUP" --query id -o tsv)
MI_PRINCIPAL=$(az identity show -n "$MANAGED_IDENTITY" -g "$RESOURCE_GROUP" --query principalId -o tsv)
ACR_ID=$(az acr show -n "$ACR_NAME" --query id -o tsv)

for i in 1 2 3 4 5 6; do
  if az role assignment create --role AcrPull --scope "$ACR_ID" \
       --assignee-object-id "$MI_PRINCIPAL" --assignee-principal-type ServicePrincipal \
       -o none 2>/dev/null; then
    break
  fi
  warn "Identity not propagated yet — retrying in 10 s ($i/6)"
  sleep 10
done
ok "AcrPull assigned"

# ── ❼  Container Apps environment ────────────────────────────────────────────
log "Container Apps environment ${ACA_ENV_NAME} (takes a few minutes)"
if ! az containerapp env show -n "$ACA_ENV_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az containerapp env create -n "$ACA_ENV_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --logs-workspace-id "$LOG_WS_ID" --logs-workspace-key "$LOG_WS_KEY" \
    --tags "${TAGS[@]}" -o none
fi
ok "Environment ready"

# ── ❽  Storage account + Azure Files share for leads.jsonl ───────────────────
log "Storage account ${STORAGE_ACCOUNT}"
if ! az storage account show -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" &>/dev/null; then
  az storage account create -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
    --allow-blob-public-access false --tags "${TAGS[@]}" -o none
fi
STORAGE_KEY=$(az storage account keys list -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" \
  --query "[0].value" -o tsv)
az storage share create --name "$SHARE_NAME" --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" --quota 1 -o none
az containerapp env storage set -n "$ACA_ENV_NAME" -g "$RESOURCE_GROUP" \
  --storage-name "$SHARE_NAME" --account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" --azure-file-share-name "$SHARE_NAME" \
  --access-mode ReadWrite -o none
ok "File share ${SHARE_NAME} linked to the environment"

# ── ❾  Static Web App (Standard: required for the linked /api backend) ───────
log "Static Web App ${SWA_NAME}"
if ! az staticwebapp show -n "$SWA_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az staticwebapp create -n "$SWA_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
    --sku Standard --tags "${TAGS[@]}" -o none
fi
SWA_HOST=$(az staticwebapp show -n "$SWA_NAME" -g "$RESOURCE_GROUP" --query defaultHostname -o tsv)
ok "SWA: https://${SWA_HOST}"

# ── ❿  Container App ─────────────────────────────────────────────────────────
log "Container App ${ACA_NAME}"
if az containerapp show -n "$ACA_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
  az containerapp update -n "$ACA_NAME" -g "$RESOURCE_GROUP" --image "$IMAGE" \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" -o none
else
  az containerapp create -n "$ACA_NAME" -g "$RESOURCE_GROUP" \
    --environment "$ACA_ENV_NAME" --image "$IMAGE" \
    --registry-server "$REGISTRY" --registry-identity "$MI_ID" --user-assigned "$MI_ID" \
    --target-port 4000 --ingress external \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
    --cpu 0.25 --memory 0.5Gi --tags "${TAGS[@]}" \
    --env-vars "NODE_ENV=production" "PORT=4000" \
               "CORS_ORIGIN=https://${SWA_HOST}" "DATA_DIR=/data" \
    -o none
fi
ok "Container App ready (replicas ${MIN_REPLICAS}-${MAX_REPLICAS})"

log "Mounting Azure Files at /data"
if ! az containerapp show -n "$ACA_NAME" -g "$RESOURCE_GROUP" -o yaml | grep -q "storageName: ${SHARE_NAME}"; then
  # The containers list is replaced as a whole, so the full spec is restated.
  PATCH=$(mktemp)
  cat > "$PATCH" <<YAML
properties:
  template:
    volumes:
      - name: data
        storageType: AzureFile
        storageName: ${SHARE_NAME}
    containers:
      - name: ${ACA_NAME}
        image: ${IMAGE}
        resources:
          cpu: 0.25
          memory: 0.5Gi
        env:
          - name: NODE_ENV
            value: production
          - name: PORT
            value: "4000"
          - name: CORS_ORIGIN
            value: https://${SWA_HOST}
          - name: DATA_DIR
            value: /data
        volumeMounts:
          - volumeName: data
            mountPath: /data
YAML
  az containerapp update -n "$ACA_NAME" -g "$RESOURCE_GROUP" --yaml "$PATCH" -o none
  rm -f "$PATCH"
fi
ok "Volume mounted"

# ── ⓫  Link Container App as the SWA /api backend ────────────────────────────
log "Linking /api/* → Container App"
ACA_ID=$(az containerapp show -n "$ACA_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
if [ -z "$(az staticwebapp backends show -n "$SWA_NAME" -g "$RESOURCE_GROUP" -o tsv 2>/dev/null)" ]; then
  az staticwebapp backends link -n "$SWA_NAME" -g "$RESOURCE_GROUP" \
    --backend-resource-id "$ACA_ID" --backend-region "$LOCATION" -o none
fi
ok "Backend linked"

# ── ⓬  Resource-group budget ─────────────────────────────────────────────────
log "Budget budget-ledens (${BUDGET_AMOUNT}/month on ${RESOURCE_GROUP})"
AG_ID=$(az monitor action-group show -g rg-governance -n ag-costes --query id -o tsv 2>/dev/null || echo "")
AG_JSON=""
[ -n "$AG_ID" ] && AG_JSON=", \"contactGroups\": [\"${AG_ID}\"]"
notif() {
  echo "\"$1\": { \"enabled\": true, \"operator\": \"GreaterThan\", \"threshold\": $2, \"thresholdType\": \"$3\", \"contactEmails\": [\"${ALERT_EMAIL}\"]${AG_JSON} }"
}
BUDGET_FILE=$(mktemp)
cat > "$BUDGET_FILE" <<JSON
{ "properties": {
    "category": "Cost", "amount": ${BUDGET_AMOUNT}, "timeGrain": "Monthly",
    "timePeriod": { "startDate": "$(date -u +%Y-%m-01)T00:00:00Z", "endDate": "2029-12-31T00:00:00Z" },
    "notifications": { $(notif real80 80 Actual), $(notif real100 100 Actual), $(notif prevision100 100 Forecasted) }
} }
JSON
az rest --method put \
  --url "https://management.azure.com/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Consumption/budgets/budget-ledens?api-version=2023-05-01" \
  --body "@${BUDGET_FILE}" -o none
rm -f "$BUDGET_FILE"
ok "Budget set"

# ── ⓭  Health check through SWA ──────────────────────────────────────────────
log "Health check via https://${SWA_HOST}/api/health"
STATUS="000"
for i in $(seq 1 10); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://${SWA_HOST}/api/health" || echo "000")
  echo "Attempt $i: HTTP $STATUS"
  [ "$STATUS" = "200" ] && break
  sleep 10
done
[ "$STATUS" = "200" ] && ok "Backend reachable through SWA" \
  || warn "Health check not 200 yet — the frontend isn't deployed until CI runs; re-check later"

# ── ⓮  Secrets for GitHub Actions (printed once — do not share) ──────────────
log "Service principal ${GITHUB_SP_NAME} (Contributor on ${RESOURCE_GROUP})"
SP_JSON=$(az ad sp create-for-rbac --name "$GITHUB_SP_NAME" --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}" \
  --sdk-auth --only-show-errors)
SWA_TOKEN=$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RESOURCE_GROUP" \
  --query properties.apiKey -o tsv)

cat <<EOF

════════════════════════════════════════════════════════════════
  DEPLOYMENT COMPLETE
════════════════════════════════════════════════════════════════
  Frontend (SWA)  : https://${SWA_HOST}
  Backend (ACA)   : ${ACA_NAME}  (image ${IMAGE})
  Registry        : ${REGISTRY}
  Storage / share : ${STORAGE_ACCOUNT} / ${SHARE_NAME}
  Resource group  : ${RESOURCE_GROUP}

  ⚠  The two values below are SECRETS. Paste them only into
     GitHub → Settings → Secrets and variables → Actions:
     https://github.com/AlvaroNS/Ledens-Frontend/settings/secrets/actions

  ── AZURE_STATIC_WEB_APPS_API_TOKEN ─────────────────────────────
${SWA_TOKEN}

  ── AZURE_CREDENTIALS ───────────────────────────────────────────
${SP_JSON}

════════════════════════════════════════════════════════════════
EOF

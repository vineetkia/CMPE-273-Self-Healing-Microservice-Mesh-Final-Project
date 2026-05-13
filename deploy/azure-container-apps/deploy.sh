#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-aca-rg}"
LOCATION="${AZURE_LOCATION:-westus2}"
ENV_NAME="${AZURE_CONTAINERAPP_ENV:-mesh-aca-env}"
ACR_NAME="${AZURE_ACR_NAME:-}"
WORKSPACE_NAME="${AZURE_LOG_WORKSPACE:-mesh-aca-logs}"
TAG="${IMAGE_TAG:-demo}"

if [ -z "$ACR_NAME" ]; then
  SUB_HASH="$(az account show --query id -o tsv | tr -d '-' | cut -c1-8)"
  ACR_NAME="meshcontrol${SUB_HASH}"
fi

ACR_SERVER="${ACR_NAME}.azurecr.io"
HEALER_API_KEY="${GROQ_API_KEY:-${OPENAI_API_KEY:-}}"
HEALER_BASE_URL="${OPENAI_BASE_URL:-}"
HEALER_CHAT_MODEL="${OPENAI_CHAT_MODEL:-}"

if [ -n "${GROQ_API_KEY:-}" ]; then
  HEALER_BASE_URL="${GROQ_BASE_URL:-https://api.groq.com/openai/v1}"
  HEALER_CHAT_MODEL="${GROQ_CHAT_MODEL:-llama-3.3-70b-versatile}"
fi

echo "Using:"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  location:       ${LOCATION}"
echo "  environment:    ${ENV_NAME}"
echo "  registry:       ${ACR_NAME}"
echo "  tag:            ${TAG}"

az extension add --name containerapp --upgrade >/dev/null
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.Network --wait

if az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group exists; reusing ${RESOURCE_GROUP}."
else
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o table
fi

if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "ACR exists; reusing ${ACR_NAME}."
else
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Basic \
    --admin-enabled true \
    -o table
fi

ACR_USER="$(az acr credential show --name "$ACR_NAME" --query username -o tsv)"
ACR_PASS="$(az acr credential show --name "$ACR_NAME" --query 'passwords[0].value' -o tsv)"

if az monitor log-analytics workspace show --resource-group "$RESOURCE_GROUP" --workspace-name "$WORKSPACE_NAME" >/dev/null 2>&1; then
  echo "Log Analytics workspace exists; reusing ${WORKSPACE_NAME}."
else
  az monitor log-analytics workspace create \
    --resource-group "$RESOURCE_GROUP" \
    --workspace-name "$WORKSPACE_NAME" \
    --location "$LOCATION" \
    -o table
fi

WORKSPACE_ID="$(az monitor log-analytics workspace show --resource-group "$RESOURCE_GROUP" --workspace-name "$WORKSPACE_NAME" --query customerId -o tsv)"
WORKSPACE_KEY="$(az monitor log-analytics workspace get-shared-keys --resource-group "$RESOURCE_GROUP" --workspace-name "$WORKSPACE_NAME" --query primarySharedKey -o tsv)"

if az containerapp env show --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Container Apps environment exists; reusing ${ENV_NAME}."
else
  az containerapp env create \
    --name "$ENV_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --logs-workspace-id "$WORKSPACE_ID" \
    --logs-workspace-key "$WORKSPACE_KEY" \
    -o table
fi

build_python() {
  local service="$1"
  local service_dir="$2"
  local image="${ACR_SERVER}/${service}:${TAG}"
  if az acr repository show-tags --name "$ACR_NAME" --repository "$service" --query "[?@=='${TAG}']" -o tsv 2>/dev/null | grep -qx "$TAG"; then
    echo "Image ${image} already exists; skipping build."
    return
  fi
  echo "Building ${image}"
  az acr build \
    --registry "$ACR_NAME" \
    --image "${service}:${TAG}" \
    --file Dockerfile.python \
    --build-arg "SERVICE_DIR=${service_dir}" \
    --build-arg "ENTRYPOINT_MODULE=main" \
    . \
    -o none
}

build_config_image() {
  local image_name="$1"
  local dockerfile="$2"
  local image="${ACR_SERVER}/${image_name}:${TAG}"
  echo "Building ${image}"
  az acr build \
    --registry "$ACR_NAME" \
    --image "${image_name}:${TAG}" \
    --file "deploy/azure-container-apps/${dockerfile}" \
    deploy/azure-container-apps \
    -o none
}

create_or_update_app() {
  local name="$1"
  shift
  if az containerapp show --name "$name" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    local image=""
    local args=("$@")
    for ((i = 0; i < ${#args[@]}; i++)); do
      if [ "${args[$i]}" = "--image" ] && [ $((i + 1)) -lt ${#args[@]} ]; then
        image="${args[$((i + 1))]}"
        break
      fi
    done

    if [ -n "$image" ]; then
      echo "Container app ${name} exists; updating image to ${image}."
      az containerapp update \
        --name "$name" \
        --resource-group "$RESOURCE_GROUP" \
        --image "$image" \
        -o none
    else
      echo "Container app ${name} already exists; leaving it unchanged."
    fi
  else
    az containerapp create --name "$name" --resource-group "$RESOURCE_GROUP" --environment "$ENV_NAME" "$@" -o table
  fi
}

patch_additional_ports() {
  local name="$1"
  local mappings_json="$2"
  local app_id
  app_id="$(az containerapp show --name "$name" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
  az rest \
    --method patch \
    --url "https://management.azure.com${app_id}?api-version=2024-03-01" \
    --body "{\"properties\":{\"configuration\":{\"ingress\":{\"additionalPortMappings\":${mappings_json}}}}}" \
    -o none
}

common_registry_args=(
  --registry-server "$ACR_SERVER"
  --registry-username "$ACR_USER"
  --registry-password "$ACR_PASS"
)

echo "Building backend images..."
build_python auth services/auth
build_python order services/order
build_python inventory services/inventory
build_python notification services/notification
build_python payments services/payments
build_python fraud services/fraud
build_python shipping services/shipping
build_python recommendation services/recommendation
build_python gateway services/gateway
build_python healer agents/healer
build_config_image prometheus prometheus.Dockerfile
build_config_image otel-collector otel-collector.Dockerfile

echo "Creating internal infrastructure apps..."
create_or_update_app etcd \
  --image quay.io/coreos/etcd:v3.5.13 \
  --cpu 0.25 --memory 0.5Gi \
  --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 2379 --exposed-port 2379 \
  --env-vars \
    ETCD_NAME=etcd0 \
    ETCD_DATA_DIR=/tmp/etcd-data \
    ETCD_LISTEN_CLIENT_URLS=http://0.0.0.0:2379 \
    ETCD_ADVERTISE_CLIENT_URLS=http://etcd:2379 \
    ETCD_LISTEN_PEER_URLS=http://0.0.0.0:2380

create_or_update_app nats \
  --image nats:2.10-alpine \
  --cpu 0.25 --memory 0.5Gi \
  --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 4222 --exposed-port 4222

create_or_update_app jaeger \
  --image jaegertracing/all-in-one:1.57 \
  --cpu 0.5 --memory 1Gi \
  --min-replicas 1 --max-replicas 1 \
  --ingress external --transport http --target-port 16686 \
  --env-vars COLLECTOR_OTLP_ENABLED=true
patch_additional_ports jaeger '[{"external":false,"targetPort":4317,"exposedPort":4317}]'

create_or_update_app otelcollector \
  --image "${ACR_SERVER}/otel-collector:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi \
  --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 4317 --exposed-port 4317
patch_additional_ports otelcollector '[{"external":false,"targetPort":4318,"exposedPort":4318}]'

service_env=(
  ETCD_HOST=etcd
  ETCD_PORT=2379
  NATS_URL=nats://nats:4222
  OTEL_EXPORTER_OTLP_ENDPOINT=http://otelcollector:4317
)

echo "Creating internal gRPC service apps..."
create_or_update_app auth \
  --image "${ACR_SERVER}/auth:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50051 --exposed-port 50051 \
  --env-vars SERVICE_NAME=auth PORT=50051 METRICS_PORT=9101 "${service_env[@]}"
patch_additional_ports auth '[{"external":false,"targetPort":9101,"exposedPort":9101}]'

create_or_update_app order \
  --image "${ACR_SERVER}/order:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50052 --exposed-port 50052 \
  --env-vars SERVICE_NAME=order PORT=50052 METRICS_PORT=9102 "${service_env[@]}"
patch_additional_ports order '[{"external":false,"targetPort":9102,"exposedPort":9102}]'

create_or_update_app inventory \
  --image "${ACR_SERVER}/inventory:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50053 --exposed-port 50053 \
  --env-vars SERVICE_NAME=inventory PORT=50053 METRICS_PORT=9103 "${service_env[@]}"
patch_additional_ports inventory '[{"external":false,"targetPort":9103,"exposedPort":9103}]'

create_or_update_app notification \
  --image "${ACR_SERVER}/notification:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50054 --exposed-port 50054 \
  --env-vars SERVICE_NAME=notification PORT=50054 METRICS_PORT=9104 "${service_env[@]}"
patch_additional_ports notification '[{"external":false,"targetPort":9104,"exposedPort":9104}]'

create_or_update_app payments \
  --image "${ACR_SERVER}/payments:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50055 --exposed-port 50055 \
  --env-vars SERVICE_NAME=payments PORT=50055 METRICS_PORT=9105 "${service_env[@]}"
patch_additional_ports payments '[{"external":false,"targetPort":9105,"exposedPort":9105}]'

create_or_update_app fraud \
  --image "${ACR_SERVER}/fraud:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50056 --exposed-port 50056 \
  --env-vars SERVICE_NAME=fraud PORT=50056 METRICS_PORT=9106 "${service_env[@]}"
patch_additional_ports fraud '[{"external":false,"targetPort":9106,"exposedPort":9106}]'

create_or_update_app shipping \
  --image "${ACR_SERVER}/shipping:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50057 --exposed-port 50057 \
  --env-vars SERVICE_NAME=shipping PORT=50057 METRICS_PORT=9107 "${service_env[@]}"
patch_additional_ports shipping '[{"external":false,"targetPort":9107,"exposedPort":9107}]'

create_or_update_app recommendation \
  --image "${ACR_SERVER}/recommendation:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress internal --transport tcp --target-port 50058 --exposed-port 50058 \
  --env-vars SERVICE_NAME=recommendation PORT=50058 METRICS_PORT=9108 "${service_env[@]}"
patch_additional_ports recommendation '[{"external":false,"targetPort":9108,"exposedPort":9108}]'

echo "Creating public gateway and healer apps..."
create_or_update_app gateway \
  --image "${ACR_SERVER}/gateway:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --ingress external --transport http --target-port 8080 \
  --env-vars \
    SERVICE_NAME=gateway PORT=8080 "${service_env[@]}" \
    FRONTEND_URL="${FRONTEND_URL:-https://frontend-placeholder}" \
    GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}" \
    GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
    GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-}" \
    GOOGLE_OAUTH_STATE_SECRET="${GOOGLE_OAUTH_STATE_SECRET:-}" \
    GOOGLE_OAUTH_ALLOWED_DOMAIN="${GOOGLE_OAUTH_ALLOWED_DOMAIN:-}" \
    GOOGLE_OAUTH_ALLOWED_ORIGINS="${GOOGLE_OAUTH_ALLOWED_ORIGINS:-}"

create_or_update_app healer \
  --image "${ACR_SERVER}/healer:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --ingress external --transport http --target-port 8090 \
  --env-vars \
    SERVICE_NAME=healer PORT=8090 "${service_env[@]}" \
    OPENAI_API_KEY="${HEALER_API_KEY}" \
    OPENAI_BASE_URL="${HEALER_BASE_URL}" \
    OPENAI_CHAT_MODEL="${HEALER_CHAT_MODEL}" \
    LOGFIRE_TOKEN="${LOGFIRE_TOKEN:-}"

if [ -n "$HEALER_API_KEY" ]; then
  az containerapp secret set \
    --name healer \
    --resource-group "$RESOURCE_GROUP" \
    --secrets healer-api-key="$HEALER_API_KEY" \
    -o none
  az containerapp update \
    --name healer \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars \
      OPENAI_API_KEY=secretref:healer-api-key \
      OPENAI_BASE_URL="$HEALER_BASE_URL" \
      OPENAI_CHAT_MODEL="$HEALER_CHAT_MODEL" \
    -o none
fi

if [ -n "${LOGFIRE_TOKEN:-}" ]; then
  az containerapp secret set \
    --name healer \
    --resource-group "$RESOURCE_GROUP" \
    --secrets logfire-token="$LOGFIRE_TOKEN" \
    -o none
  az containerapp update \
    --name healer \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars LOGFIRE_TOKEN=secretref:logfire-token \
    -o none
fi

echo "Refreshing OTel exporter endpoint on app services..."
for app in auth order inventory notification payments fraud shipping recommendation gateway healer; do
  az containerapp update \
    --name "$app" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars OTEL_EXPORTER_OTLP_ENDPOINT=http://otelcollector:4317 \
    -o none
done

GATEWAY_FQDN="$(az containerapp show --name gateway --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
HEALER_FQDN="$(az containerapp show --name healer --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
GATEWAY_URL="https://${GATEWAY_FQDN}"
HEALER_URL="https://${HEALER_FQDN}"

create_or_update_app prometheus \
  --image "${ACR_SERVER}/prometheus:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --ingress external --transport http --target-port 9090

JAEGER_FQDN="$(az containerapp show --name jaeger --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
PROMETHEUS_FQDN="$(az containerapp show --name prometheus --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
JAEGER_URL="https://${JAEGER_FQDN}"
PROMETHEUS_URL="https://${PROMETHEUS_FQDN}"

echo "Building frontend image with gateway URL ${GATEWAY_URL}"
if az acr repository show-tags --name "$ACR_NAME" --repository frontend --query "[?@=='${TAG}']" -o tsv 2>/dev/null | grep -qx "$TAG"; then
  echo "Image ${ACR_SERVER}/frontend:${TAG} already exists; skipping frontend build."
else
  az acr build \
    --registry "$ACR_NAME" \
    --image "frontend:${TAG}" \
    --file frontend/Dockerfile \
    --build-arg "VITE_GATEWAY_URL=${GATEWAY_URL}" \
    --build-arg "VITE_HEALER_URL=${HEALER_URL}" \
    --build-arg "VITE_JAEGER_URL=${JAEGER_URL}" \
    --build-arg "VITE_PROM_URL=${PROMETHEUS_URL}" \
    --build-arg "VITE_FRONTEND_URL=" \
    frontend \
    -o none
fi

create_or_update_app frontend \
  --image "${ACR_SERVER}/frontend:${TAG}" "${common_registry_args[@]}" \
  --cpu 0.25 --memory 0.5Gi --min-replicas 1 --max-replicas 1 \
  --ingress external --transport http --target-port 8080

FRONTEND_FQDN="$(az containerapp show --name frontend --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
FRONTEND_URL="https://${FRONTEND_FQDN}"

gateway_update_env=(
  "FRONTEND_URL=${FRONTEND_URL}"
  "GOOGLE_OAUTH_ALLOWED_ORIGINS=${FRONTEND_URL}"
  "GOOGLE_OAUTH_REDIRECT_URI=${GATEWAY_URL}/auth/google/callback"
)

for optional_var in \
  GOOGLE_OAUTH_CLIENT_ID \
  GOOGLE_OAUTH_CLIENT_SECRET \
  GOOGLE_OAUTH_STATE_SECRET \
  GOOGLE_OAUTH_ALLOWED_DOMAIN
do
  if [ -n "${!optional_var:-}" ]; then
    gateway_update_env+=("${optional_var}=${!optional_var}")
  fi
done

az containerapp update \
  --name gateway \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars "${gateway_update_env[@]}" \
  -o none

echo
echo "Azure Container Apps deployment complete."
echo "Frontend: ${FRONTEND_URL}"
echo "Gateway:  ${GATEWAY_URL}"
echo "Healer:   ${HEALER_URL}"
echo "Jaeger:   https://${JAEGER_FQDN}"
echo "Prom:     https://${PROMETHEUS_FQDN}"
echo
echo "Google OAuth Authorized JavaScript origin:"
echo "${FRONTEND_URL}"
echo
echo "Google OAuth Authorized redirect URI:"
echo "${GATEWAY_URL}/auth/google/callback"

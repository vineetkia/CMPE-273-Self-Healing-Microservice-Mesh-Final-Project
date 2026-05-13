#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-aca-rg}"
APPS=(frontend gateway healer prometheus otelcollector otel-collector jaeger auth order inventory notification payments fraud shipping recommendation nats etcd)

for app in "${APPS[@]}"; do
  if az containerapp show --name "$app" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "Stopping ${app}"
    az containerapp update --name "$app" --resource-group "$RESOURCE_GROUP" --min-replicas 0 --max-replicas 0 -o none
  fi
done

echo "All Container Apps scaled to zero."
